// T9 (B-06 spec SD15; plan PD4): the pairing link a controller and a sender share — hello with
// what the device sends, refusals, "Pairing ended" clearing the key, an approval for the other
// role. The controller's own cases stay in `device-link.test.ts`, unchanged.
import type { ToDevice } from "@djv/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPairLink, type PairLink } from "./pair-link.ts";

const KEY = "AAAAAAAAAAAAAAAAAAAAAA";
const CODE = "ABC234";

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.drop();
  }
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
let received: ToDevice[];
let ended: number;
let link: PairLink;
const latest = () => FakeSocket.all.at(-1)!;

function make(sends?: ("video" | "audio")[]) {
  link = createPairLink(
    {
      url: "wss://192.168.1.5:8001/api/control/device",
      connect: () => new FakeSocket(),
      storage: {
        load: () => storage.get("key") ?? null,
        save: (key) => void storage.set("key", key),
        clear: () => void storage.delete("key"),
      },
      location: { hash: () => hash, clearHash: () => void (hash = "") },
      events: { onVisible: () => {}, onOnline: () => {} },
    },
    {
      ...(sends ? { sends } : {}),
      onChange: () => {},
      onMessage: (m) => void received.push(m),
      onEnded: () => void (ended += 1),
    },
  );
  link.start();
  return link;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  storage = new Map();
  hash = "";
  received = [];
  ended = 0;
});
afterEach(() => vi.useRealTimers());

describe("hello", () => {
  it("names what a sender sends with the code", () => {
    hash = `#code=${CODE}`;
    make(["video", "audio"]);
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", code: CODE, sends: ["video", "audio"] }]);
  });

  it("a controller's hello has no sends", () => {
    hash = `#code=${CODE}`;
    make();
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", code: CODE }]);
  });

  it("a stored key reconnects with the key alone, sender or not", () => {
    storage.set("key", KEY);
    make(["audio"]);
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", key: KEY }]);
  });
});

describe("refusals", () => {
  it("audio_taken halts like too_many and keeps the key", () => {
    hash = `#code=${CODE}`;
    make(["audio"]);
    latest().open();
    latest().deliver({ type: "refused", reason: "audio_taken" });
    expect(link.status()).toBe("audio_taken");
    expect(latest().readyState).toBe(3);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("ended clears the key, stops trying and says so", () => {
    storage.set("key", KEY);
    make(["video"]);
    latest().open();
    latest().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: ["video"] });
    latest().deliver({ type: "ended" });
    expect(link.status()).toBe("ended");
    expect(storage.has("key")).toBe(false);
    expect(ended).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});

describe("approval", () => {
  it("stores the key, takes the id and hands on what comes after", () => {
    hash = `#code=${CODE}`;
    make(["video"]);
    latest().open();
    latest().deliver({ type: "approved", key: KEY, deviceId: "d7", sends: ["video"] });
    expect(storage.get("key")).toBe(KEY);
    expect(link.approved()).toBe(true);
    expect(link.deviceId()).toBe("d7");
    latest().deliver({ type: "screen", connected: true });
    latest().deliver({ type: "stream", active: false });
    expect(received).toEqual([
      { type: "screen", connected: true },
      { type: "stream", active: false },
    ]);
  });

  it("an approval for another role ends the pairing here (PD4)", () => {
    storage.set("key", KEY);
    make(["video"]);
    latest().open();
    latest().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: [] });
    expect(link.status()).toBe("ended");
    expect(storage.has("key")).toBe(false);
    expect(latest().readyState).toBe(3);
  });

  it("sends the same kinds in another order is the same role", () => {
    storage.set("key", KEY);
    make(["video", "audio"]);
    latest().open();
    latest().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: ["audio", "video"] });
    expect(link.status()).toBe("connecting");
  });

  it("send writes to the open socket only", () => {
    storage.set("key", KEY);
    make(["video"]);
    expect(link.send({ type: "offer", sdp: "v=0" })).toBe(false);
    latest().open();
    expect(link.send({ type: "offer", sdp: "v=0" })).toBe(true);
    expect(latest().sent.at(-1)).toEqual({ type: "offer", sdp: "v=0" });
  });

  it("a dropped socket reconnects with the key after the backoff", () => {
    storage.set("key", KEY);
    make(["video"]);
    latest().open();
    latest().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: ["video"] });
    latest().drop();
    expect(link.status()).toBe("reconnecting");
    expect(link.approved()).toBe(false);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all).toHaveLength(2);
    latest().open();
    expect(latest().sent).toEqual([{ type: "hello", key: KEY }]);
  });
});
