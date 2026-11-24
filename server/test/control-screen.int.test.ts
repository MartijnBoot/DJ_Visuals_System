// T5 (B-04 spec SD13, SD16, SD20, SD25, SD27, AC16, AC31, AC33; plan PD1, PD2, PD3): the screen
// socket on 127.0.0.1:PORT against the spawned server, with `ws` clients.
import { toScreenSchema, type ScreenState, type ToScreen } from "@djv/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { pino } from "pino";
import { boot } from "../src/boot.ts";
import { loadConfig } from "../src/config.ts";
import { closeAll, connect as connectClient, rawUpgrade, type Client } from "./control-client.ts";
import { baseEnv, freePort, repoRoot, spawnServer, type SpawnedServer } from "./spawn-server.ts";

let tmp: string;
let server: SpawnedServer | undefined;
let port: number;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-screen-"));
  port = await freePort();
  server = spawnServer(
    baseEnv({ PORT: String(port), DATA_DIR: join(tmp, "data"), LOG_LEVEL: "info" }),
  );
  await server.waitForLine((l) => l.msg === "listening");
});

afterEach(async () => {
  closeAll();
  await server?.kill();
  server = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

const url = () => `ws://127.0.0.1:${port}/api/control/screen`;

const connect = (origin: string | undefined) =>
  connectClient(url(), toScreenSchema, origin === undefined ? {} : { origin });

const status = (m: ToScreen) => m.type === "status";

/** The first status arrives on connect; wait for it. */
async function connected(origin: string) {
  const client = await connect(origin);
  await client.find(status);
  return client;
}

const own = () => `http://127.0.0.1:${port}`;

const state = (profiles: number): ScreenState => ({
  profiles: Array.from({ length: profiles }, (_, i) => ({
    id: `9f1c5a1e-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: `Profile number ${i} with a long enough name`,
  })),
  activeId: "builtin",
  palette: ["#000000", "#ffffff"],
  storedPalette: ["#000000", "#ffffff"],
  primary: 1,
  dials: { recognisability: 0.3, reactivity: 0.7 },
  cameras: [],
  cameraId: null,
  camera: "idle",
  audio: "idle",
  started: false,
  reason: null,
  mainAudio: null,
  transition: { kind: "cut", duration: 2, keepColour: false },
  effects: [],
});

const warns = () => server!.lines().filter((l) => l.level === 40);

/**
 * `disable` is answered with a status: proof every message before it was handled. Never
 * `enable`: this spawned server has no address seam, and the gate never binds a LAN address
 * (B-04 SD29).
 */
async function roundTrip(client: Client<ToScreen>) {
  const answer = client.next(status);
  client.send({ type: "disable" });
  return answer;
}

describe("the screen socket's Origin (AC16, SD25, PD2)", () => {
  it.each([
    ["its own origin", () => own()],
    ["localhost on PORT", () => `http://localhost:${port}`],
    ["the Vite dev origin", () => "http://localhost:5173"],
  ])("accepts %s, and sends the status first: off", async (_label, origin) => {
    const client = await connected(origin());
    expect(client.messages[0]).toEqual({
      type: "status",
      status: {
        on: false,
        addresses: [],
        port: 8001,
        code: null,
        devices: [],
        pending: [],
        senders: [],
        fingerprint: null,
      },
    });
  });

  it.each([
    ["a foreign origin", "http://evil.example"],
    ["another port", "http://127.0.0.1:1"],
    ["https on its own host", "https://127.0.0.1"],
    ["no Origin", undefined],
  ])("refuses %s with 403", async (_label, origin) => {
    await expect(connect(origin)).rejects.toThrow("HTTP 403");
    expect(server!.lines().some((l) => l.msg === "screen connected")).toBe(false);
  });

  it("answers 404 to an upgrade on any other path", async () => {
    await expect(
      connectClient(`ws://127.0.0.1:${port}/api/health`, toScreenSchema, { origin: own() }),
    ).rejects.toThrow("HTTP 404");
  });

  it("answers 404 to an upgrade whose request target is not a URL, and keeps running", async () => {
    expect(await rawUpgrade("127.0.0.1", port, "http://[", own())).toMatch(/^HTTP\/1\.1 404 /);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(200);
  });
});

describe("messages on the screen socket (AC33, PD3)", () => {
  it("takes a 5 KB message, over a device's limit, without a warn", async () => {
    const client = await connected(own());
    const message = JSON.stringify({ type: "state", state: state(50) });
    expect(message.length).toBeGreaterThan(5000);
    client.send(message);
    await roundTrip(client);
    expect(warns()).toEqual([]);
  });

  it("drops a 300 KB message with one warn naming its type, and stays open", async () => {
    const client = await connected(own());
    const message = JSON.stringify({ type: "state", state: state(1000) });
    const big = message + " ".repeat(300 * 1024 - message.length);
    expect(big.length).toBe(300 * 1024);
    client.send(big);
    await roundTrip(client);
    expect(warns().map((l) => [l.socket, l.type, l.msg])).toEqual([
      ["screen", "state", "control message dropped"],
    ]);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("drops garbage and a message from the device union with one warn each", async () => {
    const client = await connected(own());
    client.send("garbage");
    client.send({ type: "colour", seq: 1, slot: 0, value: "#ff0000" });
    await roundTrip(client);
    expect(warns().map((l) => l.type)).toEqual(["unparseable", "colour"]);
    for (const line of server!.lines()) expect(JSON.stringify(line)).not.toContain("#ff0000");
  });
});

describe("two screen pages (AC31, SD13, SD27)", () => {
  it("makes the last to connect the target; the first gets superseded and nothing further", async () => {
    const first = await connected(own());
    const second = await connected(own());
    await first.find((m) => m.type === "superseded");
    const before = first.messages.length;
    await roundTrip(second);
    first.send({ type: "disable" });
    await roundTrip(second);
    expect(first.messages.length).toBe(before);
    const msgs = server!.lines().map((l) => l.msg);
    expect(msgs.filter((m) => m === "screen connected")).toHaveLength(2);
    expect(msgs.filter((m) => m === "screen superseded")).toHaveLength(1);
  });
});

describe("shutdown", () => {
  it("closes every socket when the booted server closes", async () => {
    const inProcess = await freePort();
    const booted = await boot(
      loadConfig({
        APP_ENV: "test",
        LOG_LEVEL: "warn",
        APP_MODE: "local",
        PORT: String(inProcess),
        CONTROL_PORT: "8001",
        DATA_DIR: join(tmp, "in-process"),
      }),
      { migrationsDir: resolve(repoRoot, "server/migrations") },
      pino({ level: "silent" }),
    );
    const client = await connectClient(
      `ws://127.0.0.1:${inProcess}/api/control/screen`,
      toScreenSchema,
      { origin: `http://127.0.0.1:${inProcess}` },
    );
    await client.find(status);
    await booted.close();
    await client.closed;
  });
});
