// The staged look's preview on the screen page (B-07 spec SD12, SD14, SD15, AC18, AC28, AC30 to
// AC32, AC34; plan PD12 to PD14; ADR 0004). A second engine draws the staged look on a canvas that
// is never in the page, at 320×180 and 10 fps, fed the same features and the same video element
// as the output each frame; its picture goes to the one controller holding the stream over the
// sender's own peer (`send/peer.ts`), no ICE server, video only. It runs exactly while a holder
// is set and a staged look exists; it yields to the output (`pause.ts`) by stopping its engine, so
// the controller keeps the last picture. An unreachable peer gives up until the holder asks again.
// It never touches the output's engine, the camera or the live look.
import type { AudioFeatures, Engine, EngineOptions } from "@djv/engine";
import type { ScreenMessage } from "@djv/shared";
import { sharedToEngine } from "../profile-compat.ts";
import { createSenderPeer, type SenderPeer } from "../send/peer.ts";
import { buildScene } from "./build.ts";
import { createPauseRule, type PauseRule } from "./pause.ts";
import type { StagedDefinition } from "./staged.ts";

/** PD13: the preview's drawing size and frame rate (ADR 0004's ceiling). */
export const PREVIEW_SIZE = { width: 320, height: 180 } as const;
export const PREVIEW_FPS = 10;

export type PreviewEngine = Pick<
  Engine,
  "start" | "stop" | "setFeatures" | "setDials" | "setSource" | "setProfile" | "dispose"
>;
export type PreviewSetup = Extract<ScreenMessage, { type: "previewOffer" | "previewCandidate" }>;
export type PreviewState = "off" | "on" | "paused";

export interface PreviewDeps {
  createEngine(canvas: HTMLCanvasElement, options: EngineOptions): PreviewEngine;
  /** A canvas that is never put in the page (AC34). */
  createCanvas(): HTMLCanvasElement;
  createPeer?: (config: RTCConfiguration) => RTCPeerConnection;
  /** The staged look now; null while there is none. */
  staged(): StagedDefinition | null;
  /** The offer and candidates, for the holder (through the server). */
  send(message: PreviewSetup): void;
  /** The state changed: the next frame's screen state carries it. */
  onChange(): void;
}

export interface Preview {
  /** The server's `preview { deviceId }`; a repeat asks again (after a give-up, say). */
  holder(deviceId: string | null): void;
  /** The staged look changed, appeared or went. */
  changed(): void;
  /** From the output's frame: its features, its video element and its own readings. */
  frame(
    now: number,
    features: AudioFeatures,
    video: HTMLVideoElement | null,
    live: { overBudget: boolean; transitioning: boolean },
  ): void;
  answer(deviceId: string, sdp: string): Promise<void>;
  candidate(deviceId: string, init: RTCIceCandidateInit): Promise<void>;
  state(): PreviewState;
}

interface Running {
  deviceId: string;
  engine: PreviewEngine;
  track: MediaStreamTrack;
  peer: SenderPeer;
  pause: PauseRule;
  paused: boolean;
  video: HTMLVideoElement | null;
}

export function createPreview(deps: PreviewDeps): Preview {
  let holder: string | null = null;
  let gaveUp = false;
  let running: Running | null = null;
  let last: PreviewState = "off";

  const state = (): PreviewState => (!running ? "off" : running.paused ? "paused" : "on");
  const report = () => {
    const next = state();
    if (next === last) return;
    last = next;
    deps.onChange();
  };

  /** The staged look as the engine draws it: its palette and strengths baked in, its dials. */
  const draw = (engine: PreviewEngine, look: StagedDefinition) => {
    engine.setProfile(sharedToEngine(buildScene(look).profile)).catch(() => {
      // A look that does not link keeps the last one in the preview; the output is untouched.
    });
    engine.setDials(look.dials);
  };

  const close = () => {
    const current = running;
    if (!current) return;
    running = null;
    current.peer.close();
    current.engine.dispose();
    current.track.stop();
  };

  const open = (deviceId: string, look: StagedDefinition) => {
    const canvas = deps.createCanvas();
    let engine: PreviewEngine;
    try {
      engine = deps.createEngine(canvas, { size: PREVIEW_SIZE, maxFps: PREVIEW_FPS });
    } catch {
      gaveUp = true; // no second WebGL context: no preview, the output carries on
      return;
    }
    const stream = canvas.captureStream(PREVIEW_FPS);
    const track = stream.getVideoTracks()[0]!;
    const peer = createSenderPeer({
      tracks: [track],
      stream,
      maxFramerate: PREVIEW_FPS,
      ...(deps.createPeer ? { createPeer: deps.createPeer } : {}),
      // PD1: the sender's own setup, renamed for the preview and addressed to the holder.
      send: (message) =>
        deps.send(
          message.type === "offer"
            ? { type: "previewOffer", deviceId, sdp: message.sdp }
            : { ...message, type: "previewCandidate", deviceId },
        ),
      onChange: () => {
        if (running?.peer !== peer || peer.state() !== "unreachable") return;
        gaveUp = true;
        close();
        report();
      },
    });
    running = {
      deviceId,
      engine,
      track,
      peer,
      pause: createPauseRule(),
      paused: false,
      video: null,
    };
    draw(engine, look);
    engine.start();
    peer.connect();
    void peer.setActive("video", true);
  };

  /** Runs exactly while a holder is set and a staged look exists, unless it gave up. */
  const reconcile = (restart = false) => {
    const look = deps.staged();
    const want = holder !== null && look !== null && !gaveUp;
    if (running && (!want || restart || running.deviceId !== holder)) close();
    if (want && !running) open(holder!, look!);
    else if (running && look) draw(running.engine, look);
    report();
  };

  return {
    holder(deviceId) {
      holder = deviceId;
      gaveUp = false;
      reconcile(deviceId !== null);
    },
    changed: () => reconcile(),
    frame(now, features, video, live) {
      const current = running;
      if (!current) return;
      const paused = current.pause.update(now, live);
      if (paused !== current.paused) {
        current.paused = paused;
        if (paused) current.engine.stop();
        else current.engine.start();
        report();
      }
      current.engine.setFeatures(features);
      if (video !== current.video) current.engine.setSource((current.video = video));
    },
    async answer(deviceId, sdp) {
      if (running?.deviceId === deviceId) await running.peer.answer(sdp);
    },
    async candidate(deviceId, init) {
      if (running?.deviceId === deviceId) await running.peer.candidate(init);
    },
    state,
  };
}
