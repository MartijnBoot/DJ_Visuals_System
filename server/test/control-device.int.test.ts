// T7 (B-04 spec SD4, SD5, SD12, SD15, SD18, SD27, AC6 to AC17, AC34, AC35): the device socket on
// the External control listener, with `boot()` in process, the address seam on 127.0.0.1, a fake
// screen client and `ws` device clients. Request expiry (60 s) is `hub.test.ts`'s, on fake timers.
import {
  toDeviceSchema,
  toScreenSchema,
  type ControlStatus,
  type ScreenState,
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
import {
  closeAll,
  connect,
  rawUpgrade,
  refused,
  testRoot,
  type Client,
  type ConnectOptions,
} from "./control-client.ts";
import { freePort, repoRoot } from "./spawn-server.ts";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const HINT = "Safari on iPhone";
const CAMERA_LABEL = "Studio camera left";
const COLOUR = "#a1b2c3";

let tmp: string;
let booted: Booted | undefined;
let port: number;
let controlPort: number;
let lines: Record<string, unknown>[];
let screen: Client<ToScreen>;
let code: string;

const state: ScreenState = {
  profiles: [{ id: "builtin", name: "Built-in" }],
  activeId: "builtin",
  palette: ["#000000", COLOUR],
  storedPalette: ["#000000", "#ffffff"],
  primary: 1,
  dials: { recognisability: 0.3, reactivity: 0.7 },
  cameras: [{ deviceId: "cam-1", label: CAMERA_LABEL, remote: false }],
  cameraId: "cam-1",
  camera: "ok",
  audio: "ok",
  started: true,
  reason: null,
  mainAudio: null,
  transition: { kind: "cut", duration: 2, keepColour: false },
  effects: [],
};

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-device-"));
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
  screen = await openScreen();
  code = (await act({ type: "enable" })).code!;
});

afterEach(async () => {
  closeAll();
  await booted?.close();
  booted = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function openScreen(): Promise<Client<ToScreen>> {
  const client = await connect(`ws://127.0.0.1:${port}/api/control/screen`, toScreenSchema, {
    origin: `http://127.0.0.1:${port}`,
  });
  await client.find((m) => m.type === "status");
  return client;
}

const isStatus = (m: ToScreen): m is Extract<ToScreen, { type: "status" }> => m.type === "status";

/** Sends a panel action and returns the status that answers it. */
async function act(message: unknown): Promise<ControlStatus> {
  const answer = screen.next(isStatus);
  screen.send(message);
  const found = await answer;
  if (!isStatus(found)) throw new Error("not a status");
  return found.status;
}

/** Where the screen's messages stand now: `statusWhere` looks only at what arrives after. */
const mark = () => screen.messages.length;

/** The first status from message `from` on that satisfies `pred`, waiting for it. */
async function statusWhere(pred: (s: ControlStatus) => boolean, from = 0): Promise<ControlStatus> {
  let found: ControlStatus | undefined;
  await until(() => {
    for (const m of screen.messages.slice(from)) {
      if (isStatus(m) && pred(m.status)) {
        found = m.status;
        return true;
      }
    }
    return false;
  });
  return found!;
}

const deviceUrl = () => `wss://127.0.0.1:${controlPort}/api/control/device`;
const deviceOrigin = () => `https://127.0.0.1:${controlPort}`;
/** The only CA a device trusts: the root this test's DATA_DIR made at switch-on (B-06 T5). */
const root = () => testRoot(join(tmp, "data"));

function device(options: ConnectOptions = {}): Promise<Client<ToDevice>> {
  return connect(deviceUrl(), toDeviceSchema, {
    origin: deviceOrigin(),
    ca: root(),
    headers: { "user-agent": UA },
    ...options,
  });
}

const is =
  <T extends ToDevice["type"]>(type: T) =>
  (m: ToDevice): m is Extract<ToDevice, { type: T }> =>
    m.type === type;

/** A device that presented the code and is waiting; returns it with its id. */
async function waiting(options: ConnectOptions = {}) {
  const client = await device(options);
  const before = screen.messages.length;
  client.send({ type: "hello", code });
  await client.find(is("waiting"));
  const status = await screen.find(
    (m) => isStatus(m) && screen.messages.indexOf(m) >= before && m.status.pending.length > 0,
  );
  if (!isStatus(status)) throw new Error("not a status");
  const deviceId = status.status.pending.at(-1)!.deviceId;
  return { client, deviceId };
}

/** A device approved from the panel; returns it with its id and key. */
async function approved(options: ConnectOptions = {}) {
  const { client, deviceId } = await waiting(options);
  screen.send({ type: "accept", deviceId });
  const message = await client.find(is("approved"));
  return { client, deviceId, key: message.key };
}

/** Resolves once `pred` holds, checked every 20 ms, or rejects after `timeoutMs`. */
async function until(pred: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A status round trip on the screen socket: every message sent before it has been handled. */
const quiet = () => act({ type: "accept", deviceId: "dnone" });

describe("the device socket's Origin (AC16)", () => {
  it.each([
    ["a foreign origin", "http://evil.example"],
    ["the main listener's origin", () => `http://127.0.0.1:${port}`],
    ["no Origin", undefined],
  ])("refuses %s with 403", async (_label, origin) => {
    const value = typeof origin === "function" ? origin() : origin;
    await expect(
      connect(deviceUrl(), toDeviceSchema, {
        ca: root(),
        ...(value === undefined ? {} : { origin: value }),
      }),
    ).rejects.toThrow("HTTP 403");
  });

  it("is not on the main listener", async () => {
    await expect(
      connect(`ws://127.0.0.1:${port}/api/control/device`, toDeviceSchema, {
        origin: `http://127.0.0.1:${port}`,
      }),
    ).rejects.toThrow("HTTP 404");
  });
});

describe("requests (AC8, AC9, AC15, AC34)", () => {
  it("a valid code waits, and the panel lists the request with its hint and label", async () => {
    const { client, deviceId } = await waiting();
    expect(client.messages).toEqual([{ type: "waiting" }]);
    const status = await statusWhere((s) => s.pending.length === 1);
    expect(status.pending).toEqual([{ deviceId, hint: HINT, label: "Device 1", sends: [] }]);
  });

  it("an approved controller is sent the pending list on every change", async () => {
    const first = await approved();
    const second = await waiting();
    const pending = await first.client.find((m) => m.type === "pending" && m.requests.length === 1);
    expect(pending).toEqual({
      type: "pending",
      requests: [{ deviceId: second.deviceId, hint: HINT, label: "Device 2", sends: [] }],
    });
  });

  it("a wrong code is refused and closed; five within 60 s refuse the right code too", async () => {
    for (let i = 0; i < 5; i++) {
      const client = await device();
      client.send({ type: "hello", code: code === "222222" ? "333333" : "222222" });
      expect(await client.find(is("refused"))).toEqual({ type: "refused", reason: "wrong_code" });
      await client.closed;
    }
    const client = await device();
    client.send({ type: "hello", code });
    expect(await client.find(is("refused"))).toEqual({ type: "refused", reason: "throttled" });
  });

  it("refuses a fifth pending request at once with too_many", async () => {
    for (let i = 0; i < 4; i++) await waiting();
    const client = await device();
    client.send({ type: "hello", code });
    expect(await client.find(is("refused"))).toEqual({ type: "refused", reason: "too_many" });
    await client.closed;
  });

  it("refuses a request beyond eight approved devices with too_many", async () => {
    for (let i = 0; i < 8; i++) await approved();
    const client = await device();
    client.send({ type: "hello", code });
    expect(await client.find(is("refused"))).toEqual({ type: "refused", reason: "too_many" });
  });

  it("drops every control from a waiting device: the screen receives none", async () => {
    const { client, deviceId } = await waiting();
    client.send({ type: "dials", seq: 1, recognisability: 0.9 });
    client.send({ type: "pick", seq: 2, id: "builtin" });
    client.send({ type: "accept", deviceId });
    await quiet();
    expect(screen.messages.filter((m) => m.type === "control")).toEqual([]);
    expect((await act({ type: "accept", deviceId: "dnone" })).devices).toEqual([]);
  });

  it("drops a message before hello", async () => {
    const client = await device();
    client.send({ type: "dials", seq: 1, recognisability: 0.9 });
    client.send({ type: "hello", code });
    await client.find(is("waiting"));
    expect(screen.messages.filter((m) => m.type === "control")).toEqual([]);
  });
});

describe("approval (AC10, AC11, SD5)", () => {
  it("accept from the panel sends the key, then the full state, before anything else", async () => {
    screen.send({ type: "state", state });
    const { client } = await approved();
    await client.find(is("state"));
    expect(client.messages.slice(0, 3).map((m) => m.type)).toEqual([
      "waiting",
      "approved",
      "state",
    ]);
    expect(client.messages[2]).toEqual({ type: "state", state });
  });

  it("with no screen connected, a device accepted by a controller hears screen not connected", async () => {
    const helper = await approved();
    screen.ws.close();
    await helper.client.find(is("screen"));
    const client = await device();
    client.send({ type: "hello", code });
    await client.find(is("waiting"));
    const pending = await helper.client.find((m) => m.type === "pending" && m.requests.length > 0);
    if (pending.type !== "pending") throw new Error("not pending");
    helper.client.send({ type: "accept", deviceId: pending.requests[0]!.deviceId });
    await client.find(is("approved"));
    // Over TLS the two may arrive in separate reads (B-06 T5): wait for both, then check order.
    await client.find(is("screen"));
    expect(client.messages.slice(1, 3).map((m) => m.type)).toEqual(["approved", "screen"]);
    expect(client.messages[2]).toEqual({ type: "screen", connected: false });
  });

  it("accept from an approved controller works like the panel's", async () => {
    const first = await approved();
    const second = await waiting();
    first.client.send({ type: "accept", deviceId: second.deviceId });
    await second.client.find(is("approved"));
    const status = await statusWhere((s) => s.devices.length === 2);
    expect(status.pending).toEqual([]);
  });

  it("reject from the panel refuses the device and removes the request", async () => {
    const { client, deviceId } = await waiting();
    const from = mark();
    screen.send({ type: "reject", deviceId });
    expect(await client.find(is("refused"))).toEqual({ type: "refused", reason: "rejected" });
    await client.closed;
    expect((await statusWhere((s) => s.pending.length === 0, from)).devices).toEqual([]);
  });

  it("reject from an approved controller works like the panel's", async () => {
    const first = await approved();
    const second = await waiting();
    first.client.send({ type: "reject", deviceId: second.deviceId });
    expect(await second.client.find(is("refused"))).toEqual({
      type: "refused",
      reason: "rejected",
    });
  });

  it("a device reconnecting with its key from the same IP is approved again, state first", async () => {
    screen.send({ type: "state", state });
    const { client, deviceId, key } = await approved();
    client.ws.close();
    await client.closed;
    const again = await device();
    again.send({ type: "hello", key });
    const first = await again.find(() => true);
    expect(first).toEqual({ type: "approved", key, deviceId, sends: [] });
    expect(await again.find(is("state"))).toEqual({ type: "state", state });
    expect(again.messages[1]?.type).toBe("state");
  });

  it("a waiting device that closes its page leaves the list", async () => {
    const { client } = await waiting();
    const from = mark();
    client.ws.close();
    expect((await statusWhere((s) => s.pending.length === 0, from)).pending).toEqual([]);
  });
});

describe("relaying (SD5, AC19, AC20)", () => {
  it("relays an approved device's controls to the screen with its id", async () => {
    const { client, deviceId } = await approved();
    client.send({ type: "colour", seq: 7, slot: 1, value: COLOUR });
    expect(await screen.find((m) => m.type === "control")).toEqual({
      type: "control",
      deviceId,
      control: { type: "colour", seq: 7, slot: 1, value: COLOUR },
    });
  });

  // B-18 SD7, AC10: the effect control is one more relayed control, with no server change.
  it("relays an approved device's effect to the screen, and a state's effects to the devices", async () => {
    const { client, deviceId } = await approved();
    const effect = { type: "effect", seq: 8, profile: "w1", index: 2, value: 0.75 } as const;
    client.send(effect);
    expect(await screen.find((m) => m.type === "control")).toEqual({
      type: "control",
      deviceId,
      control: effect,
    });
    const effects = [{ index: 2, name: "Swirl", stored: 0.5, value: 0.75, dj: true, vj: false }];
    screen.send({ type: "state", state: { ...state, effects } });
    expect(await client.find(is("state"))).toEqual({
      type: "state",
      state: { ...state, effects },
    });
  });

  it("broadcasts the screen's state to every approved device, and applied to its own only", async () => {
    const a = await approved();
    const b = await approved();
    screen.send({ type: "state", state });
    await a.client.find(is("state"));
    await b.client.find(is("state"));
    screen.send({ type: "applied", entries: [{ deviceId: a.deviceId, seq: 3 }] });
    expect(await a.client.find(is("applied"))).toEqual({ type: "applied", seq: 3 });
    await quiet();
    expect(b.client.messages.filter((m) => m.type === "applied")).toEqual([]);
  });

  it("tells approved devices when the screen goes and sends the new screen's state", async () => {
    const { client } = await approved();
    screen.ws.close();
    await client.find((m) => m.type === "screen" && !m.connected);
    screen = await openScreen();
    screen.send({ type: "state", state });
    expect(await client.find(is("state"))).toEqual({ type: "state", state });
  });

  it("a new screen that connects before the old one closes locks devices until its state (SD13)", async () => {
    // A reload whose new socket reaches the server before the old one's close does: the old
    // close is then not the target's, so only the takeover itself can tell devices.
    screen.send({ type: "state", state });
    const { client } = await approved();
    await client.find(is("state"));
    const from = client.messages.length;
    screen = await openScreen();
    await client.next((m) => m.type === "screen" && !m.connected);
    const fresh: ScreenState = { ...state, dials: { recognisability: 0.2, reactivity: 0.9 } };
    screen.send({ type: "state", state: fresh });
    await client.next((m) => m.type === "state");
    expect(client.messages.slice(from).map((m) => m.type)).toEqual(["screen", "state"]);
    expect(client.messages.at(-1)).toEqual({ type: "state", state: fresh });
  });
});

describe("keys bound to the IP (AC12, SD15)", () => {
  it("refuses a key from another IP, X-Forwarded-For ignored, and the approval is gone", async () => {
    const { client, key } = await approved();
    await statusWhere((s) => s.devices.length === 1);
    const from = mark();
    const thief = await device({
      localAddress: "127.0.0.2",
      headers: { "user-agent": UA, "x-forwarded-for": "127.0.0.1" },
    });
    thief.send({ type: "hello", key });
    expect(await thief.find(is("refused"))).toEqual({ type: "refused", reason: "ended" });
    expect(await client.find(is("ended"))).toEqual({ type: "ended" });
    await client.closed;
    expect((await statusWhere((s) => s.devices.length === 0, from)).devices).toEqual([]);
    const back = await device();
    back.send({ type: "hello", key });
    expect(await back.find(is("refused"))).toEqual({ type: "refused", reason: "ended" });
  });
});

describe("ending pairings (AC6, AC13, AC14, AC17)", () => {
  it("new code ends every device, refuses every key and the old code, and shows the new code", async () => {
    const a = await approved();
    const b = await waiting();
    const from = mark();
    screen.send({ type: "newCode" });
    const status = await statusWhere((s) => s.code !== code, from);
    expect(status.devices).toEqual([]);
    expect(status.pending).toEqual([]);
    expect(await a.client.find(is("ended"))).toEqual({ type: "ended" });
    expect(await b.client.find(is("ended"))).toEqual({ type: "ended" });
    await a.client.closed;
    await b.client.closed;
    const back = await device();
    back.send({ type: "hello", key: a.key });
    expect(await back.find(is("refused"))).toEqual({ type: "refused", reason: "ended" });
    const old = await device();
    old.send({ type: "hello", code });
    expect(await old.find(is("refused"))).toEqual({ type: "refused", reason: "wrong_code" });
  });

  it("disconnect ends one device, refuses its key, and leaves the others connected", async () => {
    const a = await approved();
    const b = await approved();
    await statusWhere((s) => s.devices.length === 2);
    const from = mark();
    screen.send({ type: "disconnect", deviceId: a.deviceId });
    const status = await statusWhere((s) => s.devices.length === 1, from);
    expect(status.devices.map((d) => d.deviceId)).toEqual([b.deviceId]);
    expect(await a.client.find(is("ended"))).toEqual({ type: "ended" });
    await a.client.closed;
    b.client.send({ type: "refresh", seq: 1 });
    expect(await screen.find((m) => m.type === "control")).toMatchObject({
      deviceId: b.deviceId,
    });
    const back = await device();
    back.send({ type: "hello", key: a.key });
    expect(await back.find(is("refused"))).toEqual({ type: "refused", reason: "ended" });
  });

  it("switching off ends every device socket", async () => {
    const a = await approved();
    const b = await waiting();
    await act({ type: "disable" });
    expect(await a.client.find(is("ended"))).toEqual({ type: "ended" });
    expect(await b.client.find(is("ended"))).toEqual({ type: "ended" });
    await a.client.closed;
    await b.client.closed;
  });

  it("switching off also closes a socket that never said hello, and the switch completes", async () => {
    const silent = await device();
    const off = await act({ type: "disable" });
    expect(off.on).toBe(false);
    await silent.closed;
    expect(await refused("127.0.0.1", controlPort)).toBe(true);
    // The panel's action queue is not stuck behind the switch-off.
    expect((await act({ type: "enable" })).on).toBe(true);
  });

  it("answers 404 to an upgrade whose request target is not a URL, and keeps running (AC5)", async () => {
    expect(await rawUpgrade("127.0.0.1", controlPort, "http://[", deviceOrigin(), root())).toMatch(
      /^HTTP\/1\.1 404 /,
    );
    const a = await waiting();
    expect(a.client.ws.readyState).toBe(a.client.ws.OPEN);
  });

  it("refuses newCode and disconnect from a controller (AC17)", async () => {
    const a = await approved();
    const b = await approved();
    a.client.send({ type: "newCode" });
    a.client.send({ type: "disconnect", deviceId: b.deviceId });
    // Both are dropped on the device socket: wait for their two warns.
    const dropped = () => lines.filter((l) => l.msg === "control message dropped");
    await until(() => dropped().length === 2);
    expect(dropped().map((l) => l.type)).toEqual(["newCode", "disconnect"]);
    const status = await act({ type: "accept", deviceId: "dnone" });
    expect(status.code).toBe(code);
    expect(status.devices).toHaveLength(2);
    expect(b.client.ws.readyState).toBe(b.client.ws.OPEN);
  });

  // B-07 T5 (SD4, AC4): a target that is neither live nor staged fails the schema.
  it("drops a pick with target sideways with one warn naming pick, and the socket stays open (B-07 AC4)", async () => {
    screen.send({ type: "state", state });
    const a = await approved();
    a.client.send({ type: "pick", seq: 1, id: "builtin", target: "sideways" });
    const dropped = () => lines.filter((l) => l.msg === "control message dropped");
    await until(() => dropped().length === 1);
    expect(dropped()[0]).toMatchObject({ socket: "device", type: "pick" });
    a.client.send({ type: "pick", seq: 2, id: "builtin", target: "staged" });
    const relayed = await screen.find((m) => m.type === "control");
    expect(relayed).toMatchObject({ control: { seq: 2, target: "staged" } });
    expect(a.client.ws.readyState).toBe(a.client.ws.OPEN);
  });
});

describe("logging (AC7, AC35, SD27)", () => {
  it("logs every step by sequence label, never a code, key, User-Agent, hint, camera label or colour", async () => {
    screen.send({ type: "state", state });
    const a = await approved();
    a.client.send({ type: "colour", seq: 1, slot: 1, value: COLOUR });
    await screen.find((m) => m.type === "control");
    const b = await waiting();
    screen.send({ type: "reject", deviceId: b.deviceId });
    await b.client.closed;
    const thief = await device({ localAddress: "127.0.0.2" });
    thief.send({ type: "hello", key: a.key });
    await thief.closed;
    const c = await approved();
    await act({ type: "disconnect", deviceId: c.deviceId });
    const renewed = await act({ type: "newCode" });
    await act({ type: "disable" });

    const msgs = lines.map((l) => l.msg);
    for (const msg of [
      "device requested",
      "device accepted",
      "device rejected",
      "device disconnected",
      "new code issued",
      "external control off",
    ]) {
      expect(msgs, msg).toContain(msg);
    }
    expect(lines.find((l) => l.msg === "device accepted")).toMatchObject({ device: "Device 1" });
    const text = JSON.stringify(lines);
    for (const secret of [code, renewed.code!, a.key, UA, HINT, CAMERA_LABEL, "iPhone"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
