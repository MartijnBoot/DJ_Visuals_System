// B-06 T7, T8 (spec SD6, SD15, SD16, SD25, AC8 to AC12, AC34): senders on the real device socket,
// with `boot()` in process, the address seam on 127.0.0.1 and the LAN listener's TLS trusting
// the test's own root alone. T7: the role in the request, the approval and the reconnect. T8:
// what a sender may send, the relay of setup messages, and what a sender never receives.
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
import { closeAll, connect, testRoot, type Client, type ConnectOptions } from "./control-client.ts";
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

async function openScreen(): Promise<Client<ToScreen>> {
  const client = await connect(`ws://127.0.0.1:${port}/api/control/screen`, toScreenSchema, {
    origin: `http://127.0.0.1:${port}`,
  });
  await client.find(isStatus);
  return client;
}

/** A panel action; resolves with the status that answers it. */
async function act(message: { type: string; deviceId?: string }): Promise<ControlStatus> {
  const answer = screen.next(isStatus);
  screen.send(message);
  return (await answer).status;
}

/** Resolves with the first status from now on that `pred` holds for. */
const statusWhere = async (pred: (s: ControlStatus) => boolean) =>
  (await screen.next((m) => isStatus(m) && pred(m.status), 10_000)) as Extract<
    ToScreen,
    { type: "status" }
  >;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-sender-"));
  lines = [];
  port = await freePort();
  controlPort = await freePort();
  booted = await boot(
    loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "debug",
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
  screen = await openScreen();
  code = (await act({ type: "enable" })).code!;
});

afterEach(async () => {
  closeAll();
  await booted?.close();
  booted = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

function device(options: ConnectOptions = {}): Promise<Client<ToDevice>> {
  return connect(`wss://127.0.0.1:${controlPort}/api/control/device`, toDeviceSchema, {
    origin: `https://127.0.0.1:${controlPort}`,
    ca: testRoot(join(tmp, "data")),
    headers: { "user-agent": UA },
    ...options,
  });
}

/** A device that asked to send `sends` and is waiting: its client and id. */
async function asking(sends: ("video" | "audio")[], options: ConnectOptions = {}) {
  const client = await device(options);
  const seen = statusWhere((s) => s.pending.length > 0);
  client.send({ type: "hello", code, sends });
  await client.find(is("waiting"));
  const status = (await seen).status;
  return { client, deviceId: status.pending.at(-1)!.deviceId, status };
}

/** A sender approved from the panel: its client, id and key. */
async function sender(sends: ("video" | "audio")[], options: ConnectOptions = {}) {
  const { client, deviceId } = await asking(sends, options);
  screen.send({ type: "accept", deviceId });
  const approved = await client.find(is("approved"));
  return { client, deviceId, key: approved.key };
}

describe("a sender's request and approval (T7, SD6, SD15, AC8)", () => {
  it("a hello with sends reaches the screen's status as pending with its role", async () => {
    const { status, deviceId } = await asking(["video", "audio"]);
    expect(status.pending).toEqual([
      { deviceId, hint: "Chrome on Windows", label: "Device 1", sends: ["video", "audio"] },
    ]);
    expect(lines).toContainEqual(
      expect.objectContaining({
        msg: "sender requested",
        device: "Device 1",
        sends: ["video", "audio"],
      }),
    );
  });

  it("accept → approved with sends, and the sender is listed apart, online", async () => {
    const seen = statusWhere((s) => s.senders.length === 1);
    const { client, deviceId } = await sender(["video"]);
    expect(client.messages.find(is("approved"))).toEqual({
      type: "approved",
      key: expect.any(String),
      deviceId,
      sends: ["video"],
    });
    const { status } = await seen;
    expect(status.devices).toEqual([]);
    expect(status.senders).toEqual([
      { deviceId, hint: "Chrome on Windows", label: "Device 1", sends: ["video"], online: true },
    ]);
  });

  it("the key reconnects as a sender from the same IP, and offline in between", async () => {
    const { client, deviceId, key } = await sender(["audio"]);
    const offline = statusWhere((s) => s.senders[0]?.online === false);
    client.ws.close();
    await client.closed;
    await offline;
    const back = statusWhere((s) => s.senders[0]?.online === true);
    const again = await device();
    again.send({ type: "hello", key });
    expect(await again.find(is("approved"))).toEqual({
      type: "approved",
      key,
      deviceId,
      sends: ["audio"],
    });
    await back;
  });

  it("the key from another IP is refused and ends that sender", async () => {
    const { key } = await sender(["video"]);
    const gone = statusWhere((s) => s.senders.length === 0);
    const other = await device({ localAddress: "127.0.0.2" });
    other.send({ type: "hello", key });
    expect(await other.find(is("refused"))).toEqual({ type: "refused", reason: "ended" });
    await gone;
  });

  it("a second audio sender is refused with audio_taken", async () => {
    await sender(["audio"]);
    const second = await device({ localAddress: "127.0.0.2" });
    second.send({ type: "hello", code, sends: ["audio"] });
    expect(await second.find(is("refused"))).toEqual({ type: "refused", reason: "audio_taken" });
  });
});

const STATE = {
  profiles: [{ id: "builtin", name: "Built-in" }],
  activeId: "builtin",
  palette: ["#000000", "#ffffff"],
  storedPalette: ["#000000", "#ffffff"],
  primary: 1,
  dials: { recognisability: 0.3, reactivity: 0.7 },
  cameras: [],
  cameraId: null,
  camera: "idle" as const,
  audio: "idle" as const,
  started: false,
  reason: null,
  mainAudio: null,
};
const SDP = (size: number) => `v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n${"a=x\r\n".repeat(size / 5)}`;
const CANDIDATE = {
  candidate: "candidate:1 1 udp 2122260223 127.0.0.1 50000 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
};
const warns = (type: string) =>
  lines.filter((l) => l.level === 40 && l.msg === "control message dropped" && l.type === type);
/** Resolves once `pred` holds, checked every 20 ms, or rejects after 5 s. */
async function until(pred: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Waits for the warn a drop writes on receipt. */
const warned = (type: string, count = 1) => until(() => warns(type).length >= count);
/** Resolves once `client` holds a message after index `from` that `pred` holds for. */
const arrived = <T>(client: Client<T>, from: number, pred: (m: T) => boolean) =>
  until(() => client.messages.slice(from).some(pred));

async function controller() {
  const client = await device({ localAddress: "127.0.0.3" });
  const seen = statusWhere((s) => s.pending.length > 0);
  client.send({ type: "hello", code });
  await client.find(is("waiting"));
  const deviceId = (await seen).status.pending.at(-1)!.deviceId;
  screen.send({ type: "accept", deviceId });
  await client.find(is("approved"));
  return { client, deviceId };
}

describe("what a sender may send (T8, SD6, AC9)", () => {
  it.each([
    { type: "dials", seq: 1, reactivity: 0.5 },
    { type: "pick", seq: 1, id: "builtin" },
    { type: "camera", seq: 1, deviceId: "cam-1" },
    { type: "mainAudio", seq: 1, source: "local" },
    { type: "accept", deviceId: "dnone" },
    { type: "reject", deviceId: "dnone" },
  ])(
    "drops a sender's $type with one warn naming it, and the screen hears nothing",
    async (message) => {
      const { client } = await sender(["video"]);
      const before = screen.messages.length;
      client.send(message);
      await warned(message.type);
      expect(warns(message.type)).toHaveLength(1);
      expect(screen.messages.slice(before).filter((m) => m.type === "control")).toEqual([]);
      expect(client.ws.readyState).toBe(client.ws.OPEN);
    },
  );

  it("relays a 10 KB offer and a candidate to the screen with the sender's id", async () => {
    const { client, deviceId } = await sender(["video", "audio"]);
    const sdp = SDP(10_000);
    client.send({ type: "offer", sdp });
    client.send({ type: "candidate", ...CANDIDATE });
    expect(await screen.find((m) => m.type === "offer")).toEqual({ type: "offer", deviceId, sdp });
    expect(await screen.find((m) => m.type === "candidate")).toEqual({
      type: "candidate",
      deviceId,
      ...CANDIDATE,
    });
  });

  it("drops a 17 KB offer with one warn naming offer and keeps the socket open", async () => {
    const { client } = await sender(["video"]);
    client.send({ type: "offer", sdp: SDP(15_900), pad: "x".repeat(1_500) });
    await warned("offer");
    expect(warns("offer")).toHaveLength(1);
    expect(client.ws.readyState).toBe(client.ws.OPEN);
    client.send({ type: "offer", sdp: SDP(100) });
    await screen.find((m) => m.type === "offer");
    expect(screen.messages.filter((m) => m.type === "offer")).toEqual([
      expect.objectContaining({ sdp: SDP(100) }),
    ]);
  });

  it("drops a controller's offer and candidate with one warn each, and a 5 KB dials", async () => {
    const { client } = await controller();
    client.send({ type: "offer", sdp: SDP(100) });
    client.send({ type: "candidate", ...CANDIDATE });
    client.send({ type: "dials", seq: 1, reactivity: 0.5, pad: "x".repeat(5_000) });
    await warned("offer");
    await warned("candidate");
    await warned("dials");
    expect(warns("offer")).toHaveLength(1);
    expect(warns("candidate")).toHaveLength(1);
    expect(warns("dials")).toHaveLength(1);
    expect(screen.messages.filter((m) => m.type === "offer" || m.type === "control")).toEqual([]);
  });
});

describe("the screen's answers (T8, SD16, AC11, AC12)", () => {
  it("answer, candidate and stream reach the named sender only, without the id", async () => {
    const a = await sender(["video"]);
    const b = await sender(["video"], { localAddress: "127.0.0.2" });
    const c = await controller();
    screen.send({ type: "answer", deviceId: a.deviceId, sdp: SDP(100) });
    screen.send({ type: "candidate", deviceId: a.deviceId, ...CANDIDATE });
    screen.send({ type: "stream", deviceId: a.deviceId, active: true });
    // Markers sent after, one each: once they arrive, anything before them would have too.
    screen.send({ type: "stream", deviceId: b.deviceId, active: false });
    screen.send({ type: "applied", entries: [{ deviceId: c.deviceId, seq: 7 }] });
    expect(await a.client.find(is("answer"))).toEqual({ type: "answer", sdp: SDP(100) });
    expect(await a.client.find(is("candidate"))).toEqual({ type: "candidate", ...CANDIDATE });
    expect(await a.client.find(is("stream"))).toEqual({ type: "stream", active: true });
    expect(await b.client.find(is("stream"))).toEqual({ type: "stream", active: false });
    await c.client.find(is("applied"));
    const setup = (m: ToDevice) => ["answer", "candidate", "stream"].includes(m.type);
    expect(b.client.messages.filter(setup)).toEqual([{ type: "stream", active: false }]);
    expect(c.client.messages.filter(setup)).toEqual([]);
  });

  it("an answer naming a controller or an unknown id reaches nobody", async () => {
    const a = await sender(["video"]);
    const c = await controller();
    screen.send({ type: "answer", deviceId: c.deviceId, sdp: SDP(100) });
    screen.send({ type: "answer", deviceId: "dunknown", sdp: SDP(100) });
    screen.send({ type: "answer", deviceId: a.deviceId, sdp: SDP(50) }); // the marker
    screen.send({ type: "applied", entries: [{ deviceId: c.deviceId, seq: 7 }] });
    await a.client.find(is("answer"));
    await c.client.find(is("applied"));
    expect(a.client.messages.filter(is("answer"))).toEqual([{ type: "answer", sdp: SDP(50) }]);
    expect(c.client.messages.filter((m) => m.type === "answer")).toEqual([]);
  });

  it("drops a 17 KB answer from the screen with one warn naming answer; the screen socket stays open", async () => {
    const a = await sender(["video"]);
    screen.send({ type: "answer", deviceId: a.deviceId, sdp: SDP(15_900), pad: "x".repeat(1_500) });
    await warned("answer");
    expect(warns("answer")).toHaveLength(1);
    expect(warns("answer")[0]).toMatchObject({ socket: "screen" });
    expect(screen.ws.readyState).toBe(screen.ws.OPEN);
    // The socket still carries the next one, and the dropped one never reached the sender.
    screen.send({ type: "answer", deviceId: a.deviceId, sdp: SDP(50) });
    await a.client.find(is("answer"));
    expect(a.client.messages.filter(is("answer"))).toEqual([{ type: "answer", sdp: SDP(50) }]);
  });
});

describe("what a sender receives (T8, SD6, SD18)", () => {
  it("screen connected after approval and after a second screen attaches, never state or pending", async () => {
    screen.send({ type: "state", state: STATE });
    const { client } = await sender(["video"]);
    await client.find(is("screen"));
    expect(client.messages.filter(is("screen"))).toEqual([{ type: "screen", connected: true }]);
    const from = client.messages.length;
    const second = await openScreen();
    await arrived(client, from, (m) => m.type === "screen" && m.connected === true);
    expect(client.messages.slice(from)).toEqual([
      { type: "screen", connected: false },
      { type: "screen", connected: true },
    ]);
    screen = second; // the first is superseded and hears nothing further
    // A request arriving now must not reach the sender as a pending list.
    await asking(["audio"], { localAddress: "127.0.0.2" });
    const c = await controller();
    screen.send({ type: "state", state: STATE });
    await c.client.find(is("state")); // controllers get it; the sender must not
    await c.client.find(is("pending"));
    expect(
      client.messages.map((m) => m.type).filter((t) => t === "state" || t === "pending"),
    ).toEqual([]);
  });

  it("a sender hears screen not connected when the target screen goes", async () => {
    const { client } = await sender(["audio"]);
    await client.find(is("screen"));
    const from = client.messages.length;
    screen.ws.close();
    await arrived(client, from, (m) => m.type === "screen" && m.connected === false);
  });
});

describe("logs (T8, SD25, AC34)", () => {
  it("at debug, no line holds an SDP, a candidate, the key, the code or the User-Agent", async () => {
    const { client, deviceId, key } = await sender(["video", "audio"]);
    client.send({ type: "offer", sdp: SDP(200) });
    client.send({ type: "candidate", ...CANDIDATE });
    screen.send({ type: "answer", deviceId, sdp: SDP(200) });
    screen.send({ type: "candidate", deviceId, ...CANDIDATE });
    await client.find(is("candidate"));
    await screen.find((m) => m.type === "candidate");
    await until(() => lines.some((l) => l.socket === "screen" && l.type === "candidate"));
    const text = JSON.stringify(lines);
    for (const secret of ["v=0", "candidate:", key, code, UA, "Chrome on Windows"]) {
      expect(text).not.toContain(secret);
    }
    expect(lines.some((l) => l.level === 20 && l.type === "offer")).toBe(true);
  });
});
