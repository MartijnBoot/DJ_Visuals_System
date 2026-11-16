// Test support for the sender's peer connection (B-06 T17): a track, an RTP sender and an
// RTCPeerConnection, as much of each as `peer.ts` uses. Never imported by the app.

export class FakeTrack {
  readonly kind: "audio" | "video";
  readyState: "live" | "ended" = "live";
  contentHint = "";
  constructor(kind: "audio" | "video") {
    this.kind = kind;
  }
  stop() {
    this.readyState = "ended";
  }
}

export class FakeSender {
  readonly track: FakeTrack;
  parameters: { encodings: { active?: boolean; maxBitrate?: number }[] };
  constructor(track: FakeTrack, encodings: { active?: boolean; maxBitrate?: number }[]) {
    this.track = track;
    this.parameters = { encodings: encodings.map((e) => ({ ...e })) };
  }
  getParameters() {
    return structuredClone(this.parameters);
  }
  async setParameters(p: { encodings: { active?: boolean; maxBitrate?: number }[] }) {
    this.parameters = structuredClone(p);
  }
}

export class FakePeer extends EventTarget {
  static all: FakePeer[] = [];
  readonly config: RTCConfiguration;
  connectionState: RTCPeerConnectionState = "new";
  closed = false;
  senders: FakeSender[] = [];
  transceivers: { direction: string; streams: unknown[] }[] = [];
  local: RTCSessionDescriptionInit | null = null;
  remote: RTCSessionDescriptionInit | null = null;
  candidates: RTCIceCandidateInit[] = [];
  constructor(config: RTCConfiguration) {
    super();
    this.config = config;
    FakePeer.all.push(this);
  }
  addTransceiver(
    track: FakeTrack,
    init: { direction: string; streams: unknown[]; sendEncodings: { active?: boolean }[] },
  ) {
    const sender = new FakeSender(track, init.sendEncodings);
    this.senders.push(sender);
    this.transceivers.push({ direction: init.direction, streams: init.streams });
    return { sender };
  }
  getSenders() {
    return this.senders;
  }
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: "offer",
      sdp: "v=0\r\nm=audio 9 RTP/AVP 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n",
    };
  }
  async setLocalDescription(d: RTCSessionDescriptionInit) {
    this.local = d;
  }
  async setRemoteDescription(d: RTCSessionDescriptionInit) {
    this.remote = d;
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
  candidate(init: RTCIceCandidateInit) {
    this.dispatchEvent(
      Object.assign(new Event("icecandidate"), { candidate: { toJSON: () => init } }),
    );
  }
}
