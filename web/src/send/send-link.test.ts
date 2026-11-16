// T17 (B-06 spec SD6, SD12, SD15, SD18, AC13, AC25, AC26, AC32; plan PD3, PD7): the sender's
// link on the pairing link, driving its peer connection; fake socket, fake peer, fake timers.
import type { ToDevice } from "@djv/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePeer, FakeTrack } from "./fake-peer.ts";
import { UNREACHABLE_MS } from "./peer.ts";
import { createSendLink, GIVE_UP_MS, SEND_TEXT, type SendLink } from "./send-link.ts";

const KEY = "AAAAAAAAAAAAAAAAAAAAAA";
const CODE = "ABC234";
const UNREACHABLE =
  "Could not reach the screen machine — the network may block devices from talking to each other";

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: { type: string }[] = [];
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
let video: FakeTrack;
let audio: FakeTrack;
let link: SendLink;
const socket = () => FakeSocket.all.at(-1)!;
const peer = () => FakePeer.all.at(-1)!;
const offers = () => FakeSocket.all.flatMap((s) => s.sent).filter((m) => m.type === "offer");
const settle = () => vi.advanceTimersByTimeAsync(0);

function make(sends: ("video" | "audio")[] = ["video", "audio"]) {
  link = createSendLink({
    url: "wss://192.168.1.5:8001/api/control/device",
    connect: () => new FakeSocket(),
    storage: {
      load: () => storage.get("key") ?? null,
      save: (key) => void storage.set("key", key),
      clear: () => void storage.delete("key"),
    },
    location: { hash: () => hash, clearHash: () => void (hash = "") },
    events: { onVisible: () => {}, onOnline: () => {} },
    sends,
    tracks: [video, audio].filter((t) => sends.includes(t.kind)) as unknown as MediaStreamTrack[],
    stream: {} as MediaStream,
    createPeer: (config) => new FakePeer(config) as unknown as RTCPeerConnection,
  });
  link.start();
  return link;
}

/** Paired and the screen connected: one offer sent. */
async function live(sends: ("video" | "audio")[] = ["video", "audio"]) {
  hash = `#code=${CODE}`;
  make(sends);
  socket().open();
  socket().deliver({ type: "waiting" });
  socket().deliver({ type: "approved", key: KEY, deviceId: "d1", sends });
  socket().deliver({ type: "screen", connected: true });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  FakePeer.all = [];
  storage = new Map();
  hash = "";
  video = new FakeTrack("video");
  audio = new FakeTrack("audio");
});
afterEach(() => vi.useRealTimers());

describe("pairing (SD6, SD15)", () => {
  it("asks with the code and what it sends, then waits", () => {
    hash = `#code=${CODE}`;
    make(["audio"]);
    socket().open();
    expect(socket().sent).toEqual([{ type: "hello", code: CODE, sends: ["audio"] }]);
    socket().deliver({ type: "waiting" });
    expect(link.view().text).toBe("Waiting for approval");
  });

  it.each([
    ["expired", "Request expired — try again"],
    ["audio_taken", "Another device is sending audio"],
    ["too_many", "Too many devices"],
  ] as const)("refused %s reads %s and stops the tracks", (reason, text) => {
    hash = `#code=${CODE}`;
    make();
    socket().open();
    socket().deliver({ type: "refused", reason });
    expect(link.view().text).toBe(text);
    expect([video.readyState, audio.readyState]).toEqual(["ended", "ended"]);
  });

  it("stores the key from the approval", () => {
    hash = `#code=${CODE}`;
    make();
    socket().open();
    socket().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: ["video", "audio"] });
    expect(storage.get("key")).toBe(KEY);
  });
});

describe("the screen (SD18, AC25)", () => {
  it("approval then screen true → one offer; the factory gets no ICE server", async () => {
    await live();
    expect(offers()).toHaveLength(1);
    expect(peer().config).toEqual({ iceServers: [] });
  });

  it("screen false then true → the first connection closed, a second offer, tracks never stopped", async () => {
    await live();
    const first = peer();
    socket().deliver({ type: "screen", connected: false });
    expect(first.closed).toBe(true);
    expect(link.view().text).toBe("Screen reconnecting…");
    socket().deliver({ type: "screen", connected: true });
    await settle();
    expect(offers()).toHaveLength(2);
    expect(FakePeer.all).toHaveLength(2);
    expect([video.readyState, audio.readyState]).toEqual(["live", "live"]);
  });

  it("screen true before approval offers nothing", async () => {
    hash = `#code=${CODE}`;
    make();
    socket().open();
    socket().deliver({ type: "screen", connected: true });
    await settle();
    expect(offers()).toHaveLength(0);
  });

  it("relays answer and candidates to the peer and the peer's candidates out", async () => {
    await live();
    socket().deliver({ type: "answer", sdp: "v=0\r\n" });
    const init = {
      candidate: "candidate:1 1 udp 1 127.0.0.1 5 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };
    socket().deliver({ type: "candidate", ...init });
    await settle();
    expect(peer().remote).toEqual({ type: "answer", sdp: "v=0\r\n" });
    expect(peer().candidates).toEqual([init]);
    peer().candidate(init);
    expect(socket().sent.at(-1)).toEqual({ type: "candidate", ...init });
  });

  it("a socket drop reconnects with the key and makes a new offer", async () => {
    await live();
    socket().drop();
    expect(link.view().text).toBe("Reconnecting…");
    await vi.advanceTimersByTimeAsync(500);
    socket().open();
    expect(socket().sent).toEqual([{ type: "hello", key: KEY }]);
    socket().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: ["video", "audio"] });
    socket().deliver({ type: "screen", connected: true });
    await settle();
    expect(offers()).toHaveLength(2);
    expect([video.readyState, audio.readyState]).toEqual(["live", "live"]);
  });
});

describe("what it shows while sending (AC15, AC32, PD3)", () => {
  it("one line per kind: Standing by, then On screen and Sending audio on stream true", async () => {
    await live();
    expect(link.view().lines).toEqual({ video: "Standing by", audio: "Standing by" });
    socket().deliver({ type: "stream", kind: "audio", active: true });
    await settle();
    expect(link.view().lines).toEqual({ video: "Standing by", audio: "Sending audio" });
    socket().deliver({ type: "stream", kind: "video", active: true });
    await settle();
    expect(link.view().lines).toEqual({ video: "On screen", audio: "Sending audio" });
    expect(peer().senders.every((s) => s.parameters.encodings[0]!.active === true)).toBe(true);
  });

  it("stream false sets active false on every encoding", async () => {
    await live();
    socket().deliver({ type: "stream", kind: "video", active: true });
    socket().deliver({ type: "stream", kind: "audio", active: true });
    await settle();
    socket().deliver({ type: "stream", kind: "video", active: false });
    await settle();
    expect(link.view().lines).toEqual({ video: "Standing by", audio: "Sending audio" });
    socket().deliver({ type: "stream", kind: "audio", active: false });
    await settle();
    expect(peer().senders.every((s) => s.parameters.encodings[0]!.active === false)).toBe(true);
    expect(link.view().lines).toEqual({ video: "Standing by", audio: "Standing by" });
  });

  it("names only what it sends", async () => {
    await live(["audio"]);
    expect(link.view().lines).toEqual({ audio: "Standing by" });
  });

  it("10 000 ms without connected shows the AC13 message, 9 999 not", async () => {
    await live();
    await vi.advanceTimersByTimeAsync(UNREACHABLE_MS - 2);
    expect(link.view().text).not.toBe(UNREACHABLE);
    await vi.advanceTimersByTimeAsync(2);
    expect(link.view().text).toBe(UNREACHABLE);
    expect(link.view().lines).toEqual({});
  });
});

describe("pairing ended (SD18, AC26)", () => {
  it("ended → tracks stopped, key cleared, the Pairing ended text", async () => {
    await live();
    socket().deliver({ type: "ended" });
    expect([video.readyState, audio.readyState]).toEqual(["ended", "ended"]);
    expect(storage.has("key")).toBe(false);
    expect(link.view().text).toBe("Pairing ended — scan the code again");
    expect(peer().closed).toBe(true);
  });

  it("a refused key ends the same way", async () => {
    storage.set("key", KEY);
    make();
    socket().open();
    socket().deliver({ type: "refused", reason: "ended" });
    expect([video.readyState, audio.readyState]).toEqual(["ended", "ended"]);
    expect(link.view().text).toBe("Pairing ended — scan the code again");
  });

  it("a server that stays unreachable for 30 s ends the pairing: capture stopped, key cleared (AC26 restart, review C7)", async () => {
    await live();
    socket().drop(); // the server stopped; nothing listens on CONTROL_PORT after it restarts
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS - 1);
    expect(link.view().text).toBe("Reconnecting…");
    expect([video.readyState, audio.readyState]).toEqual(["live", "live"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(link.view().text).toBe("Pairing ended — scan the code again");
    expect([video.readyState, audio.readyState]).toEqual(["ended", "ended"]);
    expect(storage.has("key")).toBe(false);
    const sockets = FakeSocket.all.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all.length).toBe(sockets); // it stops trying
  });

  it("a socket that opens again within the 30 s keeps the pairing and the capture (SD18)", async () => {
    await live();
    socket().drop();
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS - 5_000);
    socket().open();
    socket().deliver({ type: "approved", key: KEY, deviceId: "d1", sends: ["video", "audio"] });
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS);
    expect(link.view().status).toBe("connecting");
    expect([video.readyState, audio.readyState]).toEqual(["live", "live"]);
  });

  it("stop closes everything and stops the tracks", async () => {
    await live();
    link.stop();
    expect(peer().closed).toBe(true);
    expect([video.readyState, audio.readyState]).toEqual(["ended", "ended"]);
  });
});

describe("the texts (spec UI, PD3)", () => {
  it("are the spec's words", () => {
    expect(SEND_TEXT).toMatchObject({
      waiting: "Waiting for approval",
      screen_off: "Screen reconnecting…",
      ended: "Pairing ended — scan the code again",
      expired: "Request expired — try again",
      audio_taken: "Another device is sending audio",
      too_many: "Too many devices",
      reconnecting: "Reconnecting…",
    });
  });
});
