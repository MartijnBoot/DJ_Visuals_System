// B-07 T13 (SD13, SD15, AC28, AC33; plan PD14): the controller's receiving end of the preview
// against a fake RTCPeerConnection: it answers the screen's offer with no ICE server, sends its
// candidates, hands the track to the <video>, and closes when told.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewPeer, type PreviewPeer } from "./preview-peer.ts";

class FakeReceiver extends EventTarget {
  static all: FakeReceiver[] = [];
  readonly config: RTCConfiguration;
  connectionState: RTCPeerConnectionState = "new";
  closed = false;
  remote: RTCSessionDescriptionInit | null = null;
  local: RTCSessionDescriptionInit | null = null;
  candidates: RTCIceCandidateInit[] = [];
  constructor(config: RTCConfiguration) {
    super();
    this.config = config;
    FakeReceiver.all.push(this);
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remote = d;
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: "v=0 answer" };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.local = d;
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    this.candidates.push(c);
  }
  close() {
    this.closed = true;
  }
  // The test's side:
  state(next: RTCPeerConnectionState) {
    this.connectionState = next;
    this.dispatchEvent(new Event("connectionstatechange"));
  }
  track(stream: MediaStream) {
    this.dispatchEvent(Object.assign(new Event("track"), { streams: [stream] }));
  }
  candidate(init: RTCIceCandidateInit) {
    this.dispatchEvent(
      Object.assign(new Event("icecandidate"), { candidate: { toJSON: () => init } }),
    );
  }
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const latest = () => FakeReceiver.all.at(-1)!;

let sent: unknown[];
let streams: (MediaStream | null)[];
let changes: number;
let peer: PreviewPeer;

beforeEach(() => {
  vi.useFakeTimers();
  FakeReceiver.all = [];
  sent = [];
  streams = [];
  changes = 0;
  peer = createPreviewPeer({
    createPeer: (config) => new FakeReceiver(config) as unknown as RTCPeerConnection,
    send: (message) => void sent.push(message),
    onStream: (stream) => void streams.push(stream),
    onChange: () => void changes++,
  });
});
afterEach(() => vi.useRealTimers());

describe("createPreviewPeer (PD14)", () => {
  it("answers an offer over a connection with no ICE server", async () => {
    await peer.offer("v=0 offer");
    expect(latest().config).toEqual({ iceServers: [] });
    expect(latest().remote).toEqual({ type: "offer", sdp: "v=0 offer" });
    expect(latest().local).toEqual({ type: "answer", sdp: "v=0 answer" });
    expect(sent).toEqual([{ type: "previewAnswer", sdp: "v=0 answer" }]);
  });

  it("sends its candidates and adds the screen's", async () => {
    await peer.offer("v=0 offer");
    latest().candidate({ candidate: "candidate:2", sdpMid: "0", sdpMLineIndex: 0 });
    expect(sent.at(-1)).toEqual({
      type: "previewCandidate",
      candidate: "candidate:2",
      sdpMid: "0",
      sdpMLineIndex: 0,
    });
    await peer.candidate({ candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 });
    expect(latest().candidates).toEqual([
      { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 },
    ]);
  });

  it("hands the track's stream to the video and says when it is connected", async () => {
    await peer.offer("v=0 offer");
    const stream = {} as MediaStream;
    latest().track(stream);
    expect(streams).toEqual([stream]);
    expect(peer.connected()).toBe(false);
    latest().state("connected");
    expect(peer.connected()).toBe(true);
    expect(changes).toBeGreaterThan(0);
  });

  it("a new offer replaces the connection; close ends it and clears the video", async () => {
    await peer.offer("v=0 one");
    const first = latest();
    await peer.offer("v=0 two");
    expect(first.closed).toBe(true);
    peer.close();
    expect(latest().closed).toBe(true);
    expect(streams.at(-1)).toBeNull();
    expect(peer.connected()).toBe(false);
    await peer.candidate({ candidate: "candidate:9", sdpMid: "0", sdpMLineIndex: 0 });
    expect(latest().candidates).toEqual([]);
  });

  it("an answer for a connection replaced meanwhile is never sent", async () => {
    const one = peer.offer("v=0 one");
    const two = peer.offer("v=0 two");
    await Promise.all([one, two]);
    await settle();
    expect(sent).toEqual([{ type: "previewAnswer", sdp: "v=0 answer" }]);
  });
});
