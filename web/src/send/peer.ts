// The sender's peer connection (B-06 spec SD10, SD11, SD12, SD18, SD20, AC13; plan PD7, PD11,
// T17): one at a time, made when the target screen is connected, with no ICE server. Each track
// goes `sendonly`; video carries `contentHint = "motion"`, audio is held to 128 kb/s, and the
// offer's Opus line asks for stereo music. A new connection starts paused; the screen's `stream`
// sets `active` on the encodings of its kind (SD12), so a sender of both pauses its video apart. No `connected` within 10 s of the offer is the AC13
// state. `close` keeps the tracks (a screen reload, SD18); `end` stops them (the pairing ended).
// B-07 (T12, PD13, PD14): the screen's preview reuses it with one video track held to 10 fps.
import type { DeviceMessage, SendKind } from "@djv/shared";
import { opusMusic } from "../remote/sdp.ts";

/** No peer connection reached within this long: the AC13 message (SD10). */
export const UNREACHABLE_MS = 10_000;
/** Opus at 128 kb/s (SD20). */
export const AUDIO_BITRATE = 128_000;

export type SenderPeerState = "idle" | "connecting" | "connected" | "unreachable";

type Setup = Extract<DeviceMessage, { type: "offer" | "candidate" }>;

export interface SenderPeerDeps {
  tracks: readonly MediaStreamTrack[];
  stream: MediaStream;
  createPeer?: (config: RTCConfiguration) => RTCPeerConnection;
  send(message: Setup): void;
  /** B-07 PD13: caps the video encoding's frame rate; absent for `/send`, which sets none. */
  maxFramerate?: number;
  /** The state or `active` changed. */
  onChange?(): void;
}

export interface SenderPeer {
  /** A new connection and offer; any previous connection is closed. */
  connect(): void;
  answer(sdp: string): Promise<void>;
  candidate(init: RTCIceCandidateInit): Promise<void>;
  setActive(kind: SendKind, active: boolean): Promise<void>;
  /** Whether the screen asked for this kind's stream (SD12). */
  active(kind: SendKind): boolean;
  state(): SenderPeerState;
  /** Closes the connection; the tracks keep running. */
  close(): void;
  /** Closes the connection and stops the tracks. */
  end(): void;
}

const defaultPeer = (config: RTCConfiguration) => new RTCPeerConnection(config);

export function createSenderPeer(deps: SenderPeerDeps): SenderPeer {
  const createPeer = deps.createPeer ?? defaultPeer;
  let pc: RTCPeerConnection | null = null;
  let state: SenderPeerState = "idle";
  const paused = (): Record<SendKind, boolean> => ({ video: false, audio: false });
  let active = paused();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const changed = () => deps.onChange?.();

  const set = (next: SenderPeerState) => {
    if (state === next) return;
    state = next;
    changed();
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const shut = () => {
    clearTimer();
    pc?.close();
    pc = null;
    active = paused();
  };

  /** Every encoding of every sender to its kind's `active`; one not ready takes it at the answer. */
  const apply = async (connection: RTCPeerConnection) => {
    for (const sender of connection.getSenders()) {
      const kind = sender.track?.kind;
      if (kind !== "video" && kind !== "audio") continue;
      const parameters = sender.getParameters();
      if (!parameters.encodings || parameters.encodings.length === 0) continue;
      for (const encoding of parameters.encodings) encoding.active = active[kind];
      try {
        await sender.setParameters(parameters);
      } catch {
        // Not negotiated yet: the answer applies it.
      }
    }
  };

  const offer = async (connection: RTCPeerConnection) => {
    const made = await connection.createOffer();
    const sdp = opusMusic(made.sdp ?? "");
    await connection.setLocalDescription({ type: "offer", sdp });
    if (pc === connection) deps.send({ type: "offer", sdp });
  };

  return {
    connect() {
      shut();
      const connection = createPeer({ iceServers: [] });
      pc = connection;
      for (const track of deps.tracks) {
        const audio = track.kind === "audio";
        if (!audio) track.contentHint = "motion";
        connection.addTransceiver(track, {
          direction: "sendonly",
          streams: [deps.stream],
          sendEncodings: [
            audio
              ? { active: false, maxBitrate: AUDIO_BITRATE }
              : {
                  active: false,
                  ...(deps.maxFramerate ? { maxFramerate: deps.maxFramerate } : {}),
                },
          ],
        });
      }
      connection.addEventListener("icecandidate", (event) => {
        if (pc !== connection || !event.candidate) return;
        const { candidate, sdpMid, sdpMLineIndex } = event.candidate.toJSON();
        deps.send({
          type: "candidate",
          candidate: candidate ?? "",
          sdpMid: sdpMid ?? null,
          sdpMLineIndex: sdpMLineIndex ?? null,
        });
      });
      connection.addEventListener("connectionstatechange", () => {
        if (pc !== connection) return;
        if (connection.connectionState === "connected") {
          clearTimer();
          set("connected");
        }
      });
      set("connecting");
      changed();
      timer = setTimeout(() => {
        timer = null;
        if (pc === connection && connection.connectionState !== "connected") set("unreachable");
      }, UNREACHABLE_MS);
      void offer(connection).catch(() => {
        // A failed offer is the same as an unreachable screen to the person holding the device.
      });
    },

    async answer(sdp) {
      const connection = pc;
      if (!connection) return;
      try {
        await connection.setRemoteDescription({ type: "answer", sdp });
      } catch {
        return;
      }
      if (pc === connection) await apply(connection);
    },

    async candidate(init) {
      await pc?.addIceCandidate(init).catch(() => {});
    },

    async setActive(kind, next) {
      active = { ...active, [kind]: next };
      changed();
      if (pc) await apply(pc);
    },

    active: (kind) => active[kind],
    state: () => state,

    close() {
      shut();
      set("idle");
    },

    end() {
      shut();
      for (const track of deps.tracks) track.stop();
      set("idle");
    },
  };
}
