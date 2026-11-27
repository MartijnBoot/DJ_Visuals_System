// The controller's end of the staged look's preview (B-07 spec SD13, SD15, AC28, AC33; plan PD14;
// ADR 0004): the screen offers, this answers. One connection at a time, no ICE server, receive
// only; the track's stream goes to the Scenes section's <video>. A new offer replaces the
// connection; `close` ends it when this controller no longer holds the stream.
import type { DeviceMessage } from "@djv/shared";

type Out = Extract<DeviceMessage, { type: "previewAnswer" | "previewCandidate" }>;

export interface PreviewPeerDeps {
  createPeer?: (config: RTCConfiguration) => RTCPeerConnection;
  send(message: Out): void;
  /** The picture to show; null once closed. */
  onStream(stream: MediaStream | null): void;
  /** The connection's state changed. */
  onChange?(): void;
}

export interface PreviewPeer {
  offer(sdp: string): Promise<void>;
  candidate(init: RTCIceCandidateInit): Promise<void>;
  connected(): boolean;
  close(): void;
}

const defaultPeer = (config: RTCConfiguration) => new RTCPeerConnection(config);

export function createPreviewPeer(deps: PreviewPeerDeps): PreviewPeer {
  const createPeer = deps.createPeer ?? defaultPeer;
  let pc: RTCPeerConnection | null = null;

  const shut = () => {
    pc?.close();
    pc = null;
  };

  return {
    async offer(sdp) {
      shut();
      const connection = createPeer({ iceServers: [] });
      pc = connection;
      connection.addEventListener("track", (event) => {
        if (pc === connection) deps.onStream(event.streams[0] ?? new MediaStream([event.track]));
      });
      connection.addEventListener("icecandidate", (event) => {
        if (pc !== connection || !event.candidate) return;
        const { candidate, sdpMid, sdpMLineIndex } = event.candidate.toJSON();
        deps.send({
          type: "previewCandidate",
          candidate: candidate ?? "",
          sdpMid: sdpMid ?? null,
          sdpMLineIndex: sdpMLineIndex ?? null,
        });
      });
      connection.addEventListener("connectionstatechange", () => {
        if (pc === connection) deps.onChange?.();
      });
      try {
        await connection.setRemoteDescription({ type: "offer", sdp });
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        if (pc === connection) deps.send({ type: "previewAnswer", sdp: answer.sdp ?? "" });
      } catch {
        // An offer that cannot be answered: the 10 s line says "Preview unavailable".
      }
    },
    async candidate(init) {
      await pc?.addIceCandidate(init).catch(() => {});
    },
    connected: () => pc?.connectionState === "connected",
    close() {
      shut();
      deps.onStream(null);
      deps.onChange?.();
    },
  };
}
