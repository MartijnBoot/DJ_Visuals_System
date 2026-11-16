// T11 (B-04 spec SD12, SD17, SD19, AC11, AC27, AC28, AC43): the controller's link state machine
// with a fake socket, fake timers, fake storage and fake page events.
import type { ScreenState, ToDevice } from "@djv/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeviceLink, LINK_TEXT, type DeviceLink } from "./device-link.ts";

const KEY = "AAAAAAAAAAAAAAAAAAAAAA";
const CODE = "ABC234";

const state: ScreenState = {
  profiles: [{ id: "builtin", name: "Built-in" }],
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
};

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error("send on a socket that is not open");
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.drop();
  }
  // The test's side:
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(message: ToDevice) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  drop() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
}

let storage: Map<string, string>;
let hash: string;
let visible: (() => void) | null;
let online: (() => void) | null;
let link: DeviceLink;

const latest = () => FakeSocket.all.at(-1)!;

function make(
  store = {
    load: () => storage.get("key") ?? null,
    save: (key: string) => void storage.set("key", key),
    clear: () => void storage.delete("key"),
  },
) {
  link = createDeviceLink({
    url: "ws://192.168.1.5:8001/api/control/device",
    connect: (url) => new FakeSocket(url),
    storage: store,
    location: {
      hash: () => hash,
      clearHash: () => void (hash = ""),
    },
    events: {
      onVisible: (fn) => void (visible = fn),
      onOnline: (fn) => void (online = fn),
    },
    now: () => Date.now(),
  });
  link.start();
  return link;
}

/** A link that is approved with the state in hand: the controls are unlocked. */
function live() {
  storage.set("key", KEY);
  make();
  latest().open();
  latest().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: [] });
  latest().deliver({ type: "state", state });
  expect(link.view().locked).toBe(false);
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  storage = new Map();
  hash = "";
  visible = null;
  online = null;
});

afterEach(() => {
  link?.stop();
  vi.useRealTimers();
});

describe("opening (SD19)", () => {
  it("asks for the code when opened without a code or a key, and connects to nothing", () => {
    make();
    expect(link.view()).toMatchObject({ status: "needs_code", locked: true });
    expect(LINK_TEXT.needs_code).toBe("Scan the code on the screen machine");
    expect(FakeSocket.all).toEqual([]);
  });

  it("reads #code=, clears the fragment, and presents the code on the socket", () => {
    hash = `#code=${CODE}`;
    make();
    expect(hash).toBe("");
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", code: CODE }]);
  });

  it("reads a fragment that is not valid percent-encoding as a wrong code", () => {
    hash = "#code=%";
    expect(() => make()).not.toThrow();
    expect(hash).toBe("");
    expect(link.view().status).toBe("wrong_code");
    expect(FakeSocket.all).toEqual([]);
  });

  it("presents a stored key instead", () => {
    storage.set("key", KEY);
    make();
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", key: KEY }]);
  });

  it("takes a typed code, upper-cased and trimmed, and ignores one that cannot be a code", () => {
    make();
    link.submitCode("  abc 234 ");
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", code: CODE }]);
    link.stop();
    FakeSocket.all = [];
    make();
    link.submitCode("ABC0");
    expect(FakeSocket.all).toEqual([]);
    expect(link.view().status).toBe("wrong_code");
  });
});

describe("pairing (AC8, AC10)", () => {
  it("waits, then stores the key and stays locked until the first state", () => {
    hash = `#code=${CODE}`;
    make();
    latest().open();
    latest().deliver({ type: "waiting" });
    expect(link.view()).toMatchObject({ status: "waiting", locked: true });
    expect(LINK_TEXT.waiting).toBe("Waiting for approval");
    latest().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: [] });
    expect(storage.get("key")).toBe(KEY);
    expect(link.view()).toMatchObject({ locked: true, deviceId: "d1" });
    latest().deliver({ type: "state", state });
    expect(link.view()).toMatchObject({ status: "live", locked: false, state });
  });

  it.each([
    ["rejected", "Request rejected"],
    ["expired", "Request expired — try again"],
    ["wrong_code", "Wrong code"],
    ["too_many", "Too many devices"],
  ] as const)("shows %s with its text and does not reconnect", (reason, text) => {
    hash = `#code=${CODE}`;
    make();
    latest().open();
    latest().deliver({ type: "refused", reason });
    latest().drop();
    expect(link.view().status).toBe(reason);
    expect(LINK_TEXT[reason]).toBe(text);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("can try again with the same code after a refusal", () => {
    hash = `#code=${CODE}`;
    make();
    latest().open();
    latest().deliver({ type: "refused", reason: "expired" });
    latest().drop();
    link.submitCode(CODE);
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", code: CODE }]);
  });

  it("keeps the pending requests and the screen's absence", () => {
    live();
    latest().deliver({
      type: "pending",
      requests: [{ deviceId: "d2", hint: "Chrome on Android", label: "Device 2", sends: [] }],
    });
    expect(link.view().pending).toHaveLength(1);
    latest().deliver({ type: "screen", connected: false });
    expect(link.view()).toMatchObject({ status: "screen_off", locked: true });
    expect(LINK_TEXT.screen_off).toBe("Screen not connected");
    latest().deliver({ type: "state", state });
    expect(link.view()).toMatchObject({ status: "live", locked: false });
  });
});

describe("controls (AC27)", () => {
  it("sends a control with a rising seq while live", () => {
    live();
    expect(link.send({ type: "dials", recognisability: 0.5 })).toBe(1);
    expect(link.send({ type: "refresh" })).toBe(2);
    expect(link.send({ type: "accept", deviceId: "d2" })).toBe(true);
    expect(latest().sent.slice(1)).toEqual([
      { type: "dials", seq: 1, recognisability: 0.5 },
      { type: "refresh", seq: 2 },
      { type: "accept", deviceId: "d2" },
    ]);
  });

  it("drops a control while locked; it is never on the wire after reconnecting", () => {
    live();
    latest().drop();
    expect(link.view()).toMatchObject({ status: "reconnecting", locked: true });
    expect(link.send({ type: "dials", reactivity: 0.1 })).toBeNull();
    vi.advanceTimersByTime(500);
    latest().open();
    latest().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: [] });
    latest().deliver({ type: "state", state });
    expect(latest().sent).toEqual([{ type: "hello", key: KEY }]);
  });
});

describe("reconnecting (SD12, AC11, AC27, AC28)", () => {
  it("reconnects at 0.5 s doubling to 5 s while the socket is down", () => {
    live();
    const times: number[] = [];
    let last = Date.now();
    for (let i = 0; i < 6; i++) {
      latest().drop();
      const count = FakeSocket.all.length;
      while (FakeSocket.all.length === count) vi.advanceTimersByTime(100);
      times.push(Date.now() - last);
      last = Date.now();
    }
    expect(times).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
    expect(LINK_TEXT.reconnecting).toBe("Reconnecting…");
  });

  it("starts the sequence again after a connect", () => {
    live();
    latest().drop();
    vi.advanceTimersByTime(500);
    latest().drop();
    vi.advanceTimersByTime(1000);
    latest().open();
    latest().drop();
    const count = FakeSocket.all.length;
    vi.advanceTimersByTime(499);
    expect(FakeSocket.all).toHaveLength(count);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(count + 1);
  });

  it("tries at once when the network comes back or the page becomes visible", () => {
    live();
    latest().drop();
    vi.advanceTimersByTime(500);
    latest().drop(); // the next wait is 1 s
    const count = FakeSocket.all.length;
    online!();
    expect(FakeSocket.all).toHaveLength(count + 1);
    latest().drop();
    visible!();
    expect(FakeSocket.all).toHaveLength(count + 2);
  });

  it("ignores online and visible while the socket is up", () => {
    live();
    online!();
    visible!();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("ends on 'Pairing ended', removes the key and stops trying on ended", () => {
    live();
    latest().deliver({ type: "ended" });
    latest().drop();
    expect(link.view()).toMatchObject({ status: "ended", locked: true });
    expect(LINK_TEXT.ended).toBe("Pairing ended — scan the code again");
    expect(storage.has("key")).toBe(false);
    vi.advanceTimersByTime(60_000);
    online!();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("ends the same way when a reconnect's key is refused (PD4)", () => {
    live();
    latest().drop();
    vi.advanceTimersByTime(500);
    latest().open();
    latest().deliver({ type: "refused", reason: "ended" });
    latest().drop();
    expect(link.view().status).toBe("ended");
    expect(storage.has("key")).toBe(false);
  });

  it("reconnects with the key it was approved with when storage did not keep it", () => {
    hash = `#code=${CODE}`;
    make({ load: () => null, save: () => {}, clear: () => {} });
    latest().open();
    latest().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: [] });
    latest().drop();
    vi.advanceTimersByTime(500);
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", key: KEY }]);
  });

  it("reconnects with its own key after another tab stored a different one", () => {
    live();
    storage.set("key", "BBBBBBBBBBBBBBBBBBBBBB");
    latest().drop();
    vi.advanceTimersByTime(500);
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", key: KEY }]);
  });

  it("clears the pending requests when the pairing ends", () => {
    live();
    latest().deliver({
      type: "pending",
      requests: [{ deviceId: "d2", hint: "Chrome on Android", label: "Device 2", sends: [] }],
    });
    latest().deliver({ type: "ended" });
    expect(link.view().pending).toEqual([]);
  });

  it("keeps reconnecting while the server does not answer at all (PD4)", () => {
    live();
    for (let i = 0; i < 20; i++) {
      latest().drop();
      vi.advanceTimersByTime(5000);
    }
    expect(link.view().status).toBe("reconnecting");
    expect(FakeSocket.all.length).toBeGreaterThan(20);
  });
});

describe("round trip (AC43)", () => {
  it("times a control from send to its applied", () => {
    live();
    const seq = link.send({ type: "colour", slot: 0, value: "#ff0000" });
    vi.advanceTimersByTime(42);
    latest().deliver({ type: "applied", seq: seq as number });
    expect(link.roundTrip()).toMatchObject({ last: 42, p95: 42, samples: 1 });
  });
});

describe("subscribe", () => {
  it("notifies on every change of the view", () => {
    storage.set("key", KEY);
    make();
    const listener = vi.fn();
    link.subscribe(listener);
    latest().open();
    latest().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: [] });
    latest().deliver({ type: "state", state });
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores a message that fails the schema", () => {
    live();
    latest().onmessage?.({ data: '{"type":"state","state":{}}' });
    latest().onmessage?.({ data: "garbage" });
    expect(link.view()).toMatchObject({ status: "live", state });
  });
});

describe("view snapshots", () => {
  it("returns the same object until something changes, then a new one", () => {
    live();
    const first = link.view();
    expect(link.view()).toBe(first);
    latest().deliver({ type: "pending", requests: [] });
    expect(link.view()).not.toBe(first);
  });
});
