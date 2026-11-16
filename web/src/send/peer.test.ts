// T17 (B-06 spec SD10, SD12, SD18, SD20, AC13; plan PD7, PD11): the sender's peer connection
// against a fake RTCPeerConnection, with fake timers for the 10 s rule.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePeer, FakeTrack } from "./fake-peer.ts";
import { createSenderPeer, UNREACHABLE_MS, type SenderPeer } from "./peer.ts";

const settle = () => vi.advanceTimersByTimeAsync(0);

let video: FakeTrack;
let audio: FakeTrack;
let sent: unknown[];
let states: string[];
let peer: SenderPeer;
const latest = () => FakePeer.all.at(-1)!;

beforeEach(() => {
  vi.useFakeTimers();
  FakePeer.all = [];
  video = new FakeTrack("video");
  audio = new FakeTrack("audio");
  sent = [];
  states = [];
  peer = createSenderPeer({
    tracks: [video, audio] as unknown as MediaStreamTrack[],
    stream: {} as MediaStream,
    createPeer: (config) => new FakePeer(config) as unknown as RTCPeerConnection,
    send: (m) => void sent.push(m),
    onChange: () => void states.push(peer.state()),
  });
});
afterEach(() => vi.useRealTimers());

describe("connect (SD10, SD20, PD11)", () => {
  it("makes a connection with no ICE server and sends one offer with the Opus line", async () => {
    peer.connect();
    await settle();
    expect(latest().config).toEqual({ iceServers: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "offer" });
    expect((sent[0] as { sdp: string }).sdp).toContain(
      "a=fmtp:111 minptime=10;stereo=1;sprop-stereo=1;maxaveragebitrate=128000;usedtx=0",
    );
    expect(latest().local?.sdp).toBe((sent[0] as { sdp: string }).sdp);
  });

  it("sends each track sendonly, paused, video as motion, audio at 128 kb/s", async () => {
    peer.connect();
    await settle();
    expect(latest().transceivers.map((t) => t.direction)).toEqual(["sendonly", "sendonly"]);
    expect(video.contentHint).toBe("motion");
    const [v, a] = latest().senders;
    expect(v!.parameters.encodings).toEqual([{ active: false }]);
    expect(a!.parameters.encodings).toEqual([{ active: false, maxBitrate: 128_000 }]);
  });

  it("hands its candidates on and takes the screen's", async () => {
    peer.connect();
    await settle();
    const init = {
      candidate: "candidate:1 1 udp 1 127.0.0.1 5 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };
    latest().candidate(init);
    expect(sent.at(-1)).toEqual({ type: "candidate", ...init });
    await peer.candidate(init);
    expect(latest().candidates).toEqual([init]);
  });

  it("takes the answer", async () => {
    peer.connect();
    await settle();
    await peer.answer("v=0\r\n");
    expect(latest().remote).toEqual({ type: "answer", sdp: "v=0\r\n" });
  });
});

describe("pause and resume (SD12)", () => {
  it("stream false sets active false on every encoding, true sets it true", async () => {
    peer.connect();
    await settle();
    await peer.setActive(true);
    expect(latest().senders.flatMap((s) => s.parameters.encodings.map((e) => e.active))).toEqual([
      true,
      true,
    ]);
    await peer.setActive(false);
    expect(latest().senders.flatMap((s) => s.parameters.encodings.map((e) => e.active))).toEqual([
      false,
      false,
    ]);
    expect(latest().senders[1]!.parameters.encodings[0]!.maxBitrate).toBe(128_000);
  });

  it("a new connection starts paused again", async () => {
    peer.connect();
    await settle();
    await peer.setActive(true);
    peer.connect();
    await settle();
    expect(latest().senders.every((s) => s.parameters.encodings[0]!.active === false)).toBe(true);
    expect(peer.active()).toBe(false);
  });
});

describe("the 10 s rule (AC13)", () => {
  it("is unreachable 10 000 ms after the offer without connected, not at 9 999", async () => {
    peer.connect();
    await vi.advanceTimersByTimeAsync(UNREACHABLE_MS - 1);
    expect(peer.state()).toBe("connecting");
    await vi.advanceTimersByTimeAsync(1);
    expect(peer.state()).toBe("unreachable");
    expect(UNREACHABLE_MS).toBe(10_000);
  });

  it("connected in time is never unreachable", async () => {
    peer.connect();
    await settle();
    latest().state("connected");
    await vi.advanceTimersByTimeAsync(UNREACHABLE_MS * 2);
    expect(peer.state()).toBe("connected");
  });

  it("connected after the message clears it", async () => {
    peer.connect();
    await vi.advanceTimersByTimeAsync(UNREACHABLE_MS);
    latest().state("connected");
    expect(peer.state()).toBe("connected");
  });
});

describe("close and end (SD18)", () => {
  it("close closes the connection and keeps the tracks", async () => {
    peer.connect();
    await settle();
    const first = latest();
    peer.close();
    expect(first.closed).toBe(true);
    expect(peer.state()).toBe("idle");
    expect([video.readyState, audio.readyState]).toEqual(["live", "live"]);
    await vi.advanceTimersByTimeAsync(UNREACHABLE_MS * 2);
    expect(peer.state()).toBe("idle");
  });

  it("a second connect closes the first", async () => {
    peer.connect();
    await settle();
    const first = latest();
    peer.connect();
    await settle();
    expect(first.closed).toBe(true);
    expect(FakePeer.all).toHaveLength(2);
    expect(sent.filter((m) => (m as { type: string }).type === "offer")).toHaveLength(2);
  });

  it("end stops the tracks and the connection", async () => {
    peer.connect();
    await settle();
    peer.end();
    expect(latest().closed).toBe(true);
    expect([video.readyState, audio.readyState]).toEqual(["ended", "ended"]);
  });
});
