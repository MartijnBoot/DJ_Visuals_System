// B-12 T10 (AC6–AC10, AC16, AC17, AC19; spec Verification steps 3 and 4): when a local install
// syncs, with A as a real child process (so it can be killed and restarted), a hosted cloud and
// the fake issuer in this process, and `cloud-proxy` as A's only way to the cloud.
import {
  cloudConnectSchema,
  cloudStatusSchema,
  profileListSchema,
  type Profile,
  type ScreenState,
} from "@djv/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { boot, type Booted } from "../src/boot.ts";
import { loadConfig } from "../src/config.ts";
import { startCloudProxy, type CloudProxy } from "./cloud-proxy.ts";
import { startFakeIssuer, type FakeIssuer } from "./fake-issuer.ts";
import { baseEnv, freePort, repoRoot, spawnServer, type SpawnedServer } from "./spawn-server.ts";

const CLIENT = "schedule-client";

let tmp: string;
let issuer: FakeIssuer;
let proxy: CloudProxy;
let cloud: Booted;
let cloudBase: string;
let a: SpawnedServer | undefined;
let aBase: string;
let aPort: number;

const look = (name: string): Profile => ({
  name,
  palette: ["#000000", "#444444", "#ffffff"],
  dials: { recognisability: 0.5, reactivity: 0.5 },
  effects: [{ type: "paletteMap", amount: 1 }],
});

const screenState = (started: boolean): ScreenState => ({
  profiles: [{ id: "builtin", name: "Built-in" }],
  activeId: "builtin",
  palette: ["#000000", "#ffffff"],
  storedPalette: ["#000000", "#ffffff"],
  primary: 1,
  dials: { recognisability: 0.3, reactivity: 0.7 },
  cameras: [],
  cameraId: null,
  camera: "ok",
  audio: "ok",
  started,
  reason: null,
  mainAudio: null,
});

async function startA(withCloud = true): Promise<void> {
  a = spawnServer(
    baseEnv({
      PORT: String(aPort),
      DATA_DIR: join(tmp, "a"),
      ...(withCloud
        ? { CLOUD_URL: proxy.url, OIDC_ISSUER: issuer.url, OIDC_CLIENT_ID: CLIENT }
        : {}),
    }),
  );
  await a.waitForLine((l) => l.msg === "listening");
}

async function restartA(): Promise<void> {
  await a!.kill();
  await startA();
}

async function call(base: string, method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
}

async function connectA() {
  const { url } = cloudConnectSchema.parse(
    (await call(aBase, "POST", "/api/cloud/connect", {})).body,
  );
  const back = new URL((await fetch(url, { redirect: "manual" })).headers.get("location")!);
  expect((await fetch(`${aBase}${back.pathname}${back.search}`)).status).toBe(200);
}

const status = async () =>
  cloudStatusSchema.parse((await call(aBase, "GET", "/api/cloud/status")).body);
const cloudNames = async () =>
  profileListSchema
    .parse((await call(cloudBase, "GET", "/api/profiles", undefined, issuer.token())).body)
    .profiles.map((p) => p.name)
    .sort();
const create = async (name: string) => {
  const answer = await call(aBase, "POST", "/api/profiles", look(name));
  expect(answer.status).toBe(201);
  return answer.body as { id: string };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A connected, idle A: connected, and its first sync done. */
async function connectedA() {
  await startA();
  await connectA();
  await expect.poll(async () => (await status()).state, { timeout: 10_000 }).toBe("connected");
  await expect.poll(async () => (await status()).lastSyncAt, { timeout: 10_000 }).not.toBeNull();
}

/** The screen page's socket on A, with A's own Origin. */
async function screen(): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${aPort}/api/control/screen`, {
    origin: `http://127.0.0.1:${aPort}`,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return socket;
}
const report = (socket: WebSocket, started: boolean) =>
  socket.send(JSON.stringify({ type: "state", state: screenState(started) }));

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-schedule-"));
  issuer = await startFakeIssuer({ clientId: CLIENT });
  const port = await freePort();
  cloudBase = `http://127.0.0.1:${port}`;
  cloud = await boot(
    loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "warn",
      APP_MODE: "hosted",
      PORT: String(port),
      CONTROL_PORT: String(port + 1),
      DATA_DIR: join(tmp, "cloud"),
      OIDC_ISSUER: issuer.url,
      OIDC_CLIENT_ID: CLIENT,
      ALLOWED_SUBJECT: issuer.subject,
    }),
    { migrationsDir: resolve(repoRoot, "server/migrations") },
    pino({ level: "silent" }),
  );
  proxy = await startCloudProxy(cloudBase);
  aPort = await freePort();
  aBase = `http://127.0.0.1:${aPort}`;
});

afterEach(async () => {
  await a?.kill();
  a = undefined;
  await proxy.close();
  await cloud.close();
  await issuer.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("offline, a restart, and back (AC6, AC7, AC8, AC17)", () => {
  it("keeps a save and a delete through a restart and pushes them in order when the cloud answers", async () => {
    await connectedA();
    const y = await create("Y");
    // AC6: a write is pushed within 10 s.
    await expect.poll(cloudNames, { timeout: 10_000 }).toEqual(["Y"]);
    proxy.mode = { kind: "status", status: 503 };
    const x = await create("X");
    expect((await call(aBase, "DELETE", `/api/profiles/${y.id}`)).status).toBe(204);
    await expect.poll(async () => (await status()).state, { timeout: 10_000 }).toBe("offline");
    await restartA(); // AC8: the queue is in the database
    await sleep(500);
    expect(await cloudNames()).toEqual(["Y"]);
    const from = proxy.requests.length;
    proxy.mode = { kind: "pass" };
    await expect.poll(cloudNames, { timeout: 20_000 }).toEqual(["X"]);
    const sent = proxy.requests.slice(from);
    const put = sent.indexOf(`PUT /api/sync/profiles/${x.id}`);
    const del = sent.indexOf(`DELETE /api/sync/profiles/${y.id}`);
    expect(put).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThan(put); // AC7: in order
    await expect.poll(async () => (await status()).state, { timeout: 10_000 }).toBe("connected");
  });
});

describe("a running set (AC9, AC10, SD2)", () => {
  it("makes no request while started, refuses Sync now, and syncs within 10 s of the end", async () => {
    await connectedA();
    const page = await screen();
    report(page, true);
    await a!.waitForLine((l) => l.msg === "sync paused: a set is running");
    const mark = proxy.requests.length;
    await create("During the set");
    const refused = await call(aBase, "POST", "/api/cloud/sync", {});
    expect(refused).toEqual({ status: 409, body: { error: "paused" } });
    expect((await status()).state).toBe("paused");
    await sleep(12_000); // past the 2 s debounce and a 5 s retry
    expect(proxy.requests.slice(mark)).toEqual([]);

    report(page, false);
    await expect.poll(cloudNames, { timeout: 10_000 }).toEqual(["During the set"]);

    report(page, true);
    await expect.poll(async () => (await status()).state, { timeout: 5000 }).toBe("paused");
    const again = proxy.requests.length;
    page.close();
    await expect.poll(() => proxy.requests.length, { timeout: 10_000 }).toBeGreaterThan(again);
  });
});

describe("a cloud that never answers (AC17)", () => {
  it("leaves A's own API answering under 1 s, and the run ends offline", async () => {
    await connectedA();
    proxy.mode = { kind: "hold" };
    const pending = call(aBase, "POST", "/api/cloud/sync", {});
    for (const wait of [500, 3000, 4000]) {
      await sleep(wait);
      const started = performance.now();
      expect((await call(aBase, "GET", "/api/profiles")).status).toBe(200);
      expect(performance.now() - started).toBeLessThan(1000);
    }
    const answer = await pending;
    expect(cloudStatusSchema.parse(answer.body).state).toBe("offline");
  });
});

describe("a kill mid-push (AC16)", () => {
  it("leaves no partial profile, and the restarted A completes the push", async () => {
    await connectedA();
    proxy.passFor(1, { kind: "hold" }); // the pull passes, the first push hangs
    for (const name of ["One", "Two", "Three"]) await create(name);
    await expect
      .poll(() => proxy.requests.some((r) => r.startsWith("PUT ")), { timeout: 10_000 })
      .toBe(true);
    await a!.kill();
    expect(await cloudNames()).toEqual([]);
    proxy.mode = { kind: "pass" };
    await startA();
    await expect.poll(cloudNames, { timeout: 15_000 }).toEqual(["One", "Three", "Two"]);
  });
});

describe("no cloud settings (AC19)", () => {
  it("has no /api/cloud and asks nothing of the cloud", async () => {
    await startA(false);
    expect((await call(aBase, "GET", "/api/cloud/status")).status).toBe(404);
    expect((await call(aBase, "POST", "/api/cloud/sync", {})).status).toBe(404);
    await create("Local only");
    await sleep(3000);
    expect(proxy.requests).toEqual([]);
  });
});
