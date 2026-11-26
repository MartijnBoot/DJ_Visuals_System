// B-07 T11 (spec SD13, SD15, SD20, AC28, AC29, AC32, AC37, AC38, AC40; plan PD1, PD15): the
// preview's one-stream rule and its relay on the real sockets, with `boot()` in process and the
// address seam on 127.0.0.1 (the `control-sender.int.test.ts` pattern). The server relays the
// screen's offer to the one controller holding the stream and that controller's answer back, and
// reads nothing inside either; a sender may send none of it.
import {
  toDeviceSchema,
  toScreenSchema,
  type ControlStatus,
  type ToDevice,
  type ToScreen,
} from "@djv/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, type Booted } from "../src/boot.ts";
import { loadConfig } from "../src/config.ts";
import { closeAll, connect, testRoot, type Client } from "./control-client.ts";
import { freePort, repoRoot } from "./spawn-server.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

let tmp: string;
let booted: Booted | undefined;
let port: number;
let controlPort: number;
let lines: Record<string, unknown>[];
let screen: Client<ToScreen>;
let code: string;

const isStatus = (m: ToScreen): m is Extract<ToScreen, { type: "status" }> => m.type === "status";
const is =
  <T extends ToDevice["type"]>(type: T) =>
  (m: ToDevice): m is Extract<ToDevice, { type: T }> =>
    m.type === type;
const toScreen =
  <T extends ToScreen["type"]>(type: T) =>
  (m: ToScreen): m is Extract<ToScreen, { type: T }> =>
    m.type === type;

const statusWhere = async (pred: (s: ControlStatus) => boolean) =>
  (await screen.next((m) => isStatus(m) && pred(m.status), 10_000)) as Extract<
    ToScreen,
    { type: "status" }
  >;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-preview-"));
  lines = [];
  port = await freePort();
  controlPort = await freePort();
  booted = await boot(
    loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "debug",
      APP_MODE: "local",
      PORT: String(port),
      CONTROL_PORT: String(controlPort),
      DATA_DIR: join(tmp, "data"),
    }),
    {
      migrationsDir: resolve(repoRoot, "server/migrations"),
      controlAddresses: () => [{ address: "127.0.0.1", name: "loopback (test)" }],
    },
    pino(
      { level: "debug" },
      { write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
    ),
  );
  screen = await connect(`ws://127.0.0.1:${port}/api/control/screen`, toScreenSchema, {
    origin: `http://127.0.0.1:${port}`,
  });
  await screen.find(isStatus);
  const answer = screen.next(isStatus);
  screen.send({ type: "enable" });
  code = (await answer).status.code!;
});

afterEach(async () => {
  closeAll();
  await booted?.close();
  booted = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

/** An approved device from `localAddress`; a controller unless `sends` is given. */
async function approved(localAddress: string, sends?: ("video" | "audio")[]) {
  const client = await connect(
    `wss://127.0.0.1:${controlPort}/api/control/device`,
    toDeviceSchema,
    {
      origin: `https://127.0.0.1:${controlPort}`,
      ca: testRoot(join(tmp, "data")),
      headers: { "user-agent": UA },
      localAddress,
    },
  );
  const seen = statusWhere((s) => s.pending.length > 0);
  client.send({ type: "hello", code, ...(sends ? { sends } : {}) });
  await client.find(is("waiting"));
  const deviceId = (await seen).status.pending.at(-1)!.deviceId;
  screen.send({ type: "accept", deviceId });
  await client.find(is("approved"));
  return { client, deviceId };
}

const SDP = (size: number) => `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n${"a=x\r\n".repeat(size / 5)}`;
const CANDIDATE = {
  candidate: "candidate:1 1 udp 2122260223 127.0.0.1 50000 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
};
const warns = (type: string) =>
  lines.filter((l) => l.level === 40 && l.msg === "control message dropped" && l.type === type);
async function until(pred: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const warned = (type: string) => until(() => warns(type).length >= 1);
const holder = (client: Client<ToDevice>) => client.messages.filter(is("preview")).at(-1);

describe("the holder (SD13, SD15, AC29)", () => {
  it("a controller's previewStream makes it the holder and the screen hears its id; a second takes over", async () => {
    const a = await approved("127.0.0.3");
    const b = await approved("127.0.0.4");
    expect(holder(a.client)).toEqual({ type: "preview", holder: false });
    a.client.send({ type: "previewStream", watching: true });
    expect(await screen.next(toScreen("preview"))).toEqual({
      type: "preview",
      deviceId: a.deviceId,
    });
    await until(() => holder(a.client)?.holder === true);
    b.client.send({ type: "previewStream", watching: true });
    expect(await screen.next(toScreen("preview"))).toEqual({
      type: "preview",
      deviceId: b.deviceId,
    });
    await until(() => holder(a.client)?.holder === false && holder(b.client)?.holder === true);
    const info = lines.filter(
      (l) => typeof l.msg === "string" && l.msg.startsWith("preview stream"),
    );
    expect(info.map((l) => [l.msg, l.device])).toEqual([
      ["preview stream opened", "Device 1"],
      ["preview stream ended", "Device 1"],
      ["preview stream opened", "Device 2"],
    ]);
  });

  it("the holder's socket closing tells the screen no one holds it (AC32)", async () => {
    const a = await approved("127.0.0.3");
    a.client.send({ type: "previewStream", watching: true });
    await screen.next(toScreen("preview"));
    const cleared = screen.next(toScreen("preview"));
    a.client.ws.close();
    expect(await cleared).toEqual({ type: "preview", deviceId: null });
  });
});

describe("the relay (SD15, AC28)", () => {
  it("the screen's offer and candidates reach only the holder, without an id; the holder's answer reaches the screen with it", async () => {
    const a = await approved("127.0.0.3");
    const b = await approved("127.0.0.4");
    a.client.send({ type: "previewStream", watching: true });
    await screen.next(toScreen("preview"));
    screen.send({ type: "previewOffer", deviceId: a.deviceId, sdp: SDP(10_000) });
    screen.send({ type: "previewCandidate", deviceId: a.deviceId, ...CANDIDATE });
    screen.send({ type: "previewOffer", deviceId: b.deviceId, sdp: SDP(100) });
    expect(await a.client.find(is("previewOffer"))).toEqual({
      type: "previewOffer",
      sdp: SDP(10_000),
    });
    expect(await a.client.find(is("previewCandidate"))).toEqual({
      type: "previewCandidate",
      ...CANDIDATE,
    });
    a.client.send({ type: "previewAnswer", sdp: SDP(100) });
    a.client.send({ type: "previewCandidate", ...CANDIDATE });
    expect(await screen.next(toScreen("previewAnswer"))).toEqual({
      type: "previewAnswer",
      deviceId: a.deviceId,
      sdp: SDP(100),
    });
    expect(await screen.find(toScreen("previewCandidate"))).toEqual({
      type: "previewCandidate",
      deviceId: a.deviceId,
      ...CANDIDATE,
    });
    // A marker after: once it is in, the non-holder's offer would have been too.
    screen.send({ type: "applied", entries: [{ deviceId: b.deviceId, seq: 9 }] });
    await b.client.find(is("applied"));
    expect(
      b.client.messages.filter((m) => m.type.startsWith("preview") && m.type !== "preview"),
    ).toEqual([]);
  });

  it("a non-holder's answer is dropped at debug, never relayed and never warned", async () => {
    const a = await approved("127.0.0.3");
    const b = await approved("127.0.0.4");
    a.client.send({ type: "previewStream", watching: true });
    await screen.next(toScreen("preview"));
    b.client.send({ type: "previewAnswer", sdp: SDP(100) });
    a.client.send({ type: "previewAnswer", sdp: SDP(50) }); // the marker
    expect(await screen.next(toScreen("previewAnswer"))).toMatchObject({ sdp: SDP(50) });
    expect(screen.messages.filter(toScreen("previewAnswer"))).toHaveLength(1);
    expect(warns("previewAnswer")).toEqual([]);
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 20, msg: "preview setup dropped", type: "previewAnswer" }),
    );
  });
});

describe("roles and limits (AC37, AC38)", () => {
  it.each([
    { type: "previewStream", watching: true },
    { type: "previewAnswer", sdp: SDP(100) },
    { type: "previewCandidate", ...CANDIDATE },
    { type: "saveScene", seq: 1, name: "Warm crowd" },
  ])("drops a sender's $type with one warn naming it", async (message) => {
    const { client } = await approved("127.0.0.2", ["video"]);
    const before = screen.messages.length;
    client.send(message);
    await warned(message.type);
    expect(warns(message.type)).toHaveLength(1);
    expect(screen.messages.slice(before).filter((m) => m.type !== "status")).toEqual([]);
    expect(client.ws.readyState).toBe(client.ws.OPEN);
  });

  it("still drops a controller's offer with one warn", async () => {
    const { client } = await approved("127.0.0.3");
    client.send({ type: "offer", sdp: SDP(100) });
    await warned("offer");
    expect(warns("offer")).toHaveLength(1);
  });

  it("drops a 17 KB previewAnswer with one warn and keeps the socket open", async () => {
    const a = await approved("127.0.0.3");
    a.client.send({ type: "previewStream", watching: true });
    await screen.next(toScreen("preview"));
    a.client.send({ type: "previewAnswer", sdp: SDP(15_900), pad: "x".repeat(1_500) });
    await warned("previewAnswer");
    expect(warns("previewAnswer")).toHaveLength(1);
    expect(a.client.ws.readyState).toBe(a.client.ws.OPEN);
    a.client.send({ type: "previewAnswer", sdp: SDP(50) });
    expect(await screen.next(toScreen("previewAnswer"))).toMatchObject({ sdp: SDP(50) });
  });
});

describe("logging (SD20, AC40)", () => {
  it("no line holds an SDP, a candidate or a label beyond the sequence label", async () => {
    const a = await approved("127.0.0.3");
    a.client.send({ type: "previewStream", watching: true });
    await screen.next(toScreen("preview"));
    screen.send({ type: "previewOffer", deviceId: a.deviceId, sdp: SDP(1_000) });
    await a.client.find(is("previewOffer"));
    a.client.send({ type: "previewAnswer", sdp: SDP(100) });
    a.client.send({ type: "previewCandidate", ...CANDIDATE });
    await screen.find(toScreen("previewCandidate"));
    a.client.send({ type: "previewStream", watching: false });
    await until(() => lines.some((l) => l.msg === "preview stream ended"));
    const text = JSON.stringify(lines);
    expect(text).not.toContain("v=0");
    expect(text).not.toContain("candidate:");
    expect(text).not.toContain("Chrome");
  });
});
