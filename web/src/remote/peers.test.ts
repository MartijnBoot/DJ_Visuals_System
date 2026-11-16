// T10 (B-06 spec SD10, SD12, SD16, SD20, AC12; plan PD8, PD11): the screen page's peer
// connections against a fake RTCPeerConnection, with fake timers for the mute rule.
import type { ScreenMessage } from "@djv/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MUTE_LOSS_MS } from "../capture/session.ts";
import { createPeers, type Peers } from "./peers.ts";

class FakeTrack extends EventTarget {
  muted = false;
  readyState: "live" | "ended" = "live";
  readonly kind: "audio" | "video";
  constructor(kind: "audio" | "video") {
    super();
    this.kind = kind;
  }
  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
  mute() {
    this.muted = true;
    this.dispatchEvent(new Event("mute"));
  }
  unmute() {
    this.muted = false;
    this.dispatchEvent(new Event("unmute"));
  }
}

class FakePeer extends EventTarget {
  static all: FakePeer[] = [];
  readonly config: RTCConfiguration;
  connectionState: RTCPeerConnectionState = "new";
  closed = false;
  remote: RTCSessionDescriptionInit | null = null;
  local: RTCSessionDescriptionInit | null = null;
  candidates: RTCIceCandidateInit[] = [];
  receivers: { track: FakeTrack; jitterBufferTarget?: number | null }[] = [];
  transceivers: { direction: RTCRtpTransceiverDirection }[] = [
    { direction: "sendrecv" },
    { direction: "sendrecv" },
  ];
  stats = new Map<string, unknown>();
  constructor(config: RTCConfiguration) {
    super();
    this.config = config;
    FakePeer.all.push(this);
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remote = d;
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: "answer",
      sdp: "v=0\r\nm=audio 9 RTP/AVP 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n",
    };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.local = d;
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    this.candidates.push(c);
  }
  getReceivers() {
    return this.receivers;
  }
  getTransceivers() {
    return this.transceivers;
  }
  async getStats() {
    return this.stats;
  }
  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
  // The test's side:
  track(kind: "audio" | "video") {
    const track = new FakeTrack(kind);
    const stream = { id: `stream-${kind}` } as unknown as MediaStream;
    this.receivers.push({ track, jitterBufferTarget: null });
    this.dispatchEvent(Object.assign(new Event("track"), { track, streams: [stream] }));
    return { track, stream };
  }
  state(next: RTCPeerConnectionState) {
    this.connectionState = next;
    this.dispatchEvent(new Event("connectionstatechange"));
  }
  candidate(init: RTCIceCandidateInit | null) {
    this.dispatchEvent(
      Object.assign(new Event("icecandidate"), {
        candidate: init && { ...init, toJSON: () => init },
      }),
    );
  }
}

let sent: ScreenMessage[];
let logged: [string, string][];
let changes: number;
let peers: Peers;
const latest = () => FakePeer.all.at(-1)!;
const settle = () => vi.advanceTimersByTimeAsync(0);
const feed = (deviceId: string, kind: "audio" | "video") =>
  peers.feeds().find((f) => f.deviceId === deviceId && f.kind === kind);

beforeEach(() => {
  vi.useFakeTimers();
  FakePeer.all = [];
  sent = [];
  logged = [];
  changes = 0;
  peers = createPeers({
    createPeer: (config) => new FakePeer(config) as unknown as RTCPeerConnection,
    send: (m) => void sent.push(m),
    now: () => Date.now(),
    log: (event, deviceId) => void logged.push([event, deviceId]),
    onChange: () => void (changes += 1),
  });
});
afterEach(() => vi.useRealTimers());

describe("offer → answer (SD10, SD16, PD11)", () => {
  it("makes the connection with no ICE server and answers recvonly with the Opus line", async () => {
    peers.offer("d1", "v=0\r\n");
    await settle();
    expect(latest().config).toEqual({ iceServers: [] });
    expect(latest().remote).toEqual({ type: "offer", sdp: "v=0\r\n" });
    expect(latest().transceivers.map((t) => t.direction)).toEqual(["recvonly", "recvonly"]);
    expect(sent).toHaveLength(1);
    const answer = sent[0]!;
    expect(answer).toMatchObject({ type: "answer", deviceId: "d1" });
    expect((answer as { sdp: string }).sdp).toContain(
      "a=fmtp:111 minptime=10;stereo=1;sprop-stereo=1;maxaveragebitrate=128000;usedtx=0",
    );
    expect(latest().local?.sdp).toBe((answer as { sdp: string }).sdp);
  });

  it("asks each receiver that has the property for the smallest jitter buffer", async () => {
    peers.offer("d1", "v=0\r\n");
    latest().track("audio");
    latest().receivers.push({ track: new FakeTrack("video") }); // no property: left alone
    await settle();
    peers.offer("d1", "v=0\r\n");
    const peer = latest();
    peer.track("audio");
    peer.receivers.push({ track: new FakeTrack("video") });
    await settle();
    expect(peer.receivers[0]!.jitterBufferTarget).toBe(0);
    expect("jitterBufferTarget" in peer.receivers[1]!).toBe(false);
  });

  it("a second offer for the same device closes the first connection", async () => {
    peers.offer("d1", "v=0\r\n");
    await settle();
    const first = latest();
    peers.offer("d1", "v=0\r\n");
    await settle();
    expect(first.closed).toBe(true);
    expect(FakePeer.all).toHaveLength(2);
    expect(latest().closed).toBe(false);
  });

  it("hands candidates both ways, with the device id", async () => {
    peers.offer("d1", "v=0\r\n");
    const init = {
      candidate: "candidate:1 1 udp 1 127.0.0.1 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };
    peers.candidate("d1", init);
    await settle();
    expect(latest().candidates).toEqual([init]);
    latest().candidate(init);
    latest().candidate(null); // the end of candidates: nothing to send
    expect(sent.filter((m) => m.type === "candidate")).toEqual([
      { type: "candidate", deviceId: "d1", ...init },
    ]);
  });

  it("a candidate for a device without a connection is ignored", async () => {
    peers.candidate("d9", { candidate: "", sdpMid: null, sdpMLineIndex: null });
    await settle();
    expect(FakePeer.all).toHaveLength(0);
  });

  it("logs the device id and an event, never an SDP or a candidate", async () => {
    peers.offer("d1", "v=0\r\nsecret-sdp\r\n");
    latest().track("audio");
    latest().state("connected");
    await settle();
    for (const [event] of logged) {
      expect(event).not.toMatch(/v=0|candidate:|secret/);
    }
    expect(logged.every(([, id]) => id === "d1")).toBe(true);
  });
});

describe("feeds and loss (PD8)", () => {
  it("lists each track by device and kind", async () => {
    peers.offer("d1", "v=0\r\n");
    const { track, stream } = latest().track("video");
    await settle();
    expect(feed("d1", "video")).toEqual({
      deviceId: "d1",
      kind: "video",
      track,
      stream,
      lost: false,
    });
    expect(changes).toBeGreaterThan(0);
  });

  it.each(["ended"] as const)("a track %s is lost at once", async () => {
    peers.offer("d1", "v=0\r\n");
    const { track } = latest().track("audio");
    track.end();
    expect(feed("d1", "audio")?.lost).toBe(true);
  });

  it.each(["disconnected", "failed"] as const)(
    "the peer %s marks every feed lost at once",
    async (state) => {
      peers.offer("d1", "v=0\r\n");
      latest().track("audio");
      latest().track("video");
      latest().state(state);
      expect(feed("d1", "audio")?.lost).toBe(true);
      expect(feed("d1", "video")?.lost).toBe(true);
      latest().state("connected");
      expect(feed("d1", "audio")?.lost).toBe(false);
    },
  );

  it("a mute is a loss after 1 000 ms, not at 999; unmute clears it", async () => {
    peers.offer("d1", "v=0\r\n");
    const { track } = latest().track("audio");
    track.mute();
    vi.advanceTimersByTime(MUTE_LOSS_MS - 1);
    expect(feed("d1", "audio")?.lost).toBe(false);
    vi.advanceTimersByTime(1);
    expect(feed("d1", "audio")?.lost).toBe(true);
    track.unmute();
    expect(feed("d1", "audio")?.lost).toBe(false);
  });

  it("an unmute inside the second cancels the loss", async () => {
    peers.offer("d1", "v=0\r\n");
    const { track } = latest().track("audio");
    track.mute();
    vi.advanceTimersByTime(500);
    track.unmute();
    vi.advanceTimersByTime(1000);
    expect(feed("d1", "audio")?.lost).toBe(false);
  });

  it("drop closes the connection and forgets its feeds", async () => {
    peers.offer("d1", "v=0\r\n");
    latest().track("audio");
    peers.drop("d1");
    expect(latest().closed).toBe(true);
    expect(peers.feeds()).toEqual([]);
    expect(peers.connection("d1")).toBeNull();
  });

  it("a new offer replaces the old connection's feeds", async () => {
    peers.offer("d1", "v=0\r\n");
    latest().track("audio");
    peers.offer("d1", "v=0\r\n");
    expect(peers.feeds()).toEqual([]);
  });
});

describe("setActive (SD12)", () => {
  it("sends stream once per change", async () => {
    peers.offer("d1", "v=0\r\n");
    await settle();
    sent = [];
    peers.setActive("d1", false);
    peers.setActive("d1", false);
    peers.setActive("d1", true);
    peers.setActive("d1", true);
    expect(sent).toEqual([
      { type: "stream", deviceId: "d1", active: false },
      { type: "stream", deviceId: "d1", active: true },
    ]);
  });

  it("sends again after a new offer: a new connection starts paused at the sender", async () => {
    peers.offer("d1", "v=0\r\n");
    await settle();
    peers.setActive("d1", true);
    peers.offer("d1", "v=0\r\n");
    await settle();
    sent = [];
    peers.setActive("d1", true);
    expect(sent).toEqual([{ type: "stream", deviceId: "d1", active: true }]);
  });

  it("does nothing for a device without a connection", () => {
    peers.setActive("d9", true);
    expect(sent).toEqual([]);
  });
});

describe("connection (PD5)", () => {
  it("reports the state and when the first offer came", async () => {
    vi.setSystemTime(5_000);
    peers.offer("d1", "v=0\r\n");
    await settle();
    vi.setSystemTime(8_000);
    peers.offer("d1", "v=0\r\n"); // a second offer keeps the first time
    expect(peers.connection("d1")).toEqual({ state: "new", firstOfferAt: 5_000, connected: false });
    latest().state("connected");
    expect(peers.connection("d1")).toEqual({
      state: "connected",
      firstOfferAt: 5_000,
      connected: true,
    });
  });
});

describe("stats (PD15)", () => {
  it("reads the leg of a kind from the connection's statistics", async () => {
    peers.offer("d1", "v=0\r\n");
    await settle();
    const stats = latest().stats;
    stats.set("T", { id: "T", type: "transport", selectedCandidatePairId: "P" });
    stats.set("P", { id: "P", type: "candidate-pair", currentRoundTripTime: 0.02 });
    stats.set("A", {
      id: "A",
      type: "inbound-rtp",
      kind: "audio",
      jitterBufferDelay: 4.8,
      jitterBufferEmittedCount: 480,
    });
    expect(await peers.stats("d1", "audio")).toBeCloseTo(20, 9);
    // Nothing emitted since: no sample.
    expect(await peers.stats("d1", "audio")).toBeNull();
    expect(await peers.stats("d9", "audio")).toBeNull();
  });
});
