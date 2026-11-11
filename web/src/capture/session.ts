// The capture session (spec SD3, SD6, SD7, SD9; plan PD9, PD11, PD15, PD17): one camera and one
// audio source, their state (`idle`, `ok`, `lost`, `none`), loss detection and the retry that
// reattaches them without a click. No UI. Every browser API enters through `SessionDeps`, so
// the tests run in Node.
import { ZERO_FEATURES, type AudioFeatures, type FeatureSource } from "@djv/audio";
import { audioConstraints, cameraConstraints, systemAudioConstraints } from "./devices.ts";
import { saveRemembered, type AudioChoice, type Remembered } from "./remembered.ts";

/** Lost or absent sources are asked for again this often (SD7). */
export const RETRY_MS = 2000;

/** A track muted longer than this is lost (PD9). */
export const MUTE_LOSS_MS = 1000;

export type SourceState = "idle" | "ok" | "lost" | "none";
type Kind = "camera" | "audio";

export interface SessionState {
  camera: SourceState;
  audio: SourceState;
  /** One line for any source problem; no device label. */
  reason?: string;
  video: HTMLVideoElement | null;
  contextState: AudioContextState | "none";
  cameraId?: string;
  audioChoice?: AudioChoice;
}

export interface SessionDeps {
  mediaDevices: Pick<
    MediaDevices,
    "getUserMedia" | "enumerateDevices" | "addEventListener" | "removeEventListener"
  > &
    Partial<Pick<MediaDevices, "getDisplayMedia">>;
  createContext: () => AudioContext;
  createFeatureSource: (
    context: AudioContext,
    stream: MediaStream,
    moduleUrl: string,
  ) => Promise<FeatureSource>;
  moduleUrl: string;
  createVideo: (stream: MediaStream) => HTMLVideoElement;
  /** Where a click to resume a suspended context is heard (the document). */
  gestures: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** Capture state changes (PD17): started, lost, retry, restored. */
  log?: (kind: Kind, state: string, reason?: string) => void;
}

export interface Session {
  /** Call from the Start click: the context and the media requests need its activation. */
  start(choice: Remembered): Promise<void>;
  setCamera(deviceId: string): Promise<void>;
  setAudio(choice: AudioChoice): Promise<void>;
  stop(): void;
  state(): SessionState;
  read(now: number): AudioFeatures;
  subscribe(fn: (state: SessionState) => void): () => void;
}

const REASON = {
  cameraDenied: "camera permission denied: allow it in the browser's site settings",
  cameraAbsent: "no camera found",
  cameraKept: "could not open that camera: kept the previous one",
  cameraLost: "camera lost: retrying",
  audioDenied: "microphone permission denied: allow it in the browser's site settings",
  audioAbsent: "no audio input found",
  audioKept: "could not open that input: kept the previous one",
  audioLost: "audio source lost: retrying",
  systemCancelled: "system audio share cancelled: kept the previous source",
  systemNoAudio: "the shared source has no audio (tick 'share audio'): kept the previous source",
  systemStopped: "system audio stopped: choose it again in the panel",
  suspended: "audio paused by the browser: click anywhere to resume",
};

interface Held {
  track: MediaStreamTrack;
  release(): void;
}

export function createSession(deps: SessionDeps): Session {
  const { mediaDevices, log = () => {} } = deps;
  const status: Record<Kind, SourceState> = { camera: "idle", audio: "idle" };
  const reasons: Partial<Record<Kind, string>> = {};
  const held: Partial<Record<Kind, Held>> = {};
  const busy: Record<Kind, boolean> = { camera: false, audio: false };
  const listeners = new Set<(s: SessionState) => void>();
  let started = false;
  let stopped = false;
  let context: AudioContext | null = null;
  let source: FeatureSource | null = null;
  let sourceLive = false;
  let video: HTMLVideoElement | null = null;
  let cameraId: string | undefined;
  let audioChoice: AudioChoice | undefined;
  let wantedAudio: AudioChoice | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const state = (): SessionState => {
    const suspended = context?.state === "suspended";
    const reason = [reasons.camera, reasons.audio, suspended ? REASON.suspended : undefined]
      .filter(Boolean)
      .join(" · ");
    return {
      camera: status.camera,
      audio: suspended && status.audio === "ok" ? "lost" : status.audio,
      ...(reason ? { reason } : {}),
      video,
      contextState: context?.state ?? "none",
      ...(cameraId ? { cameraId } : {}),
      ...(audioChoice ? { audioChoice } : {}),
    };
  };
  const notify = () => {
    const s = state();
    for (const fn of listeners) fn(s);
  };

  const setStatus = (kind: Kind, next: SourceState, reason?: string) => {
    const previous = status[kind];
    status[kind] = next;
    if (reason) reasons[kind] = reason;
    else delete reasons[kind];
    if (next !== previous) {
      log(kind, next === "ok" && previous !== "idle" ? "restored" : next, reason);
    }
    if (next === "lost" || next === "none") scheduleRetry();
    notify();
  };

  const stopTracks = (stream: MediaStream) => {
    for (const t of stream.getTracks()) t.stop();
  };
  const stopSource = () => {
    if (sourceLive) source?.stop();
    sourceLive = false;
  };

  /** Watches a track for loss (PD9). Its release removes the listeners before the stop. */
  const hold = (kind: Kind, stream: MediaStream, track: MediaStreamTrack) => {
    let muteTimer: ReturnType<typeof setTimeout> | null = null;
    const lose = () => {
      if (held[kind]?.track === track) lost(kind);
    };
    const onMute = () => {
      muteTimer ??= setTimeout(() => {
        muteTimer = null;
        if (track.muted) lose();
      }, MUTE_LOSS_MS);
    };
    const onUnmute = () => {
      if (muteTimer) clearTimeout(muteTimer);
      muteTimer = null;
    };
    track.addEventListener("ended", lose);
    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    held[kind]?.release();
    held[kind] = {
      track,
      release() {
        track.removeEventListener("ended", lose);
        track.removeEventListener("mute", onMute);
        track.removeEventListener("unmute", onUnmute);
        onUnmute();
        stopTracks(stream); // the session's own stop, never read as a loss
      },
    };
  };

  const lost = (kind: Kind) => {
    held[kind]?.release();
    delete held[kind];
    if (kind === "camera") {
      video = null;
      setStatus("camera", "lost", REASON.cameraLost);
    } else {
      stopSource(); // `read` keeps answering from it, decaying to zero (AC12)
      setStatus(
        "audio",
        "lost",
        audioChoice?.kind === "system" ? REASON.systemStopped : REASON.audioLost,
      );
    }
  };

  /** A request failed: keep what runs (PD11, AC4), stay lost, or become none. */
  const failed = (kind: Kind, error: unknown, kept: string, denied: string, absent: string) => {
    const name = error instanceof Error ? error.name : String(error);
    const current = status[kind];
    if (current === "ok") return setStatus(kind, "ok", kept);
    if (current === "lost") return setStatus(kind, "lost", reasons[kind]);
    setStatus(kind, "none", name === "NotAllowedError" ? denied : absent);
  };

  const openCamera = async (id: string | undefined) => {
    let stream: MediaStream;
    try {
      stream = await mediaDevices.getUserMedia(cameraConstraints(id));
    } catch (e) {
      return failed("camera", e, REASON.cameraKept, REASON.cameraDenied, REASON.cameraAbsent);
    }
    const track = stream.getVideoTracks()[0];
    if (stopped || !track) return stopTracks(stream);
    hold("camera", stream, track);
    video = deps.createVideo(stream);
    cameraId = track.getSettings().deviceId ?? id;
    saveRemembered({ cameraId }, deps.storage);
    setStatus("camera", "ok");
  };

  const openAudio = async (choice: AudioChoice | undefined) => {
    const system = choice?.kind === "system";
    const keep = (e: unknown, systemReason: string) => {
      if (!system)
        return failed("audio", e, REASON.audioKept, REASON.audioDenied, REASON.audioAbsent);
      // A share that failed keeps whatever runs (AC4); with nothing running it is none.
      setStatus("audio", status.audio === "idle" ? "none" : status.audio, systemReason);
    };
    let stream: MediaStream;
    try {
      stream = system
        ? await mediaDevices.getDisplayMedia!(systemAudioConstraints())
        : await mediaDevices.getUserMedia(
            audioConstraints(choice?.kind === "input" ? choice.deviceId : undefined),
          );
    } catch (e) {
      return keep(e, REASON.systemCancelled);
    }
    for (const t of stream.getVideoTracks()) t.stop(); // a share's picture is not wanted
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stopTracks(stream);
      return keep("NoAudioTrack", REASON.systemNoAudio);
    }
    let next: FeatureSource;
    try {
      next = await deps.createFeatureSource(context!, stream, deps.moduleUrl);
    } catch (e) {
      stopTracks(stream);
      return keep(e, REASON.systemNoAudio);
    }
    if (stopped) {
      stopTracks(stream);
      return next.stop();
    }
    stopSource();
    source = next;
    sourceLive = true;
    hold("audio", stream, track);
    audioChoice = system
      ? { kind: "system" }
      : { kind: "input", deviceId: track.getSettings().deviceId ?? "default" };
    wantedAudio = audioChoice;
    saveRemembered({ audio: audioChoice }, deps.storage);
    setStatus("audio", "ok");
  };

  /** One request per kind at a time. */
  const attempt = async (kind: Kind, open: () => Promise<void>) => {
    if (busy[kind] || stopped) return;
    busy[kind] = true;
    try {
      await open();
    } finally {
      busy[kind] = false;
    }
  };

  const needs = (kind: Kind) => status[kind] === "lost" || status[kind] === "none";
  // System audio needs a click to be asked for again; only an input is retried.
  const retryable = (kind: Kind) =>
    needs(kind) && (kind === "camera" || wantedAudio?.kind !== "system");

  const retry = async () => {
    const tasks: Promise<void>[] = [];
    if (retryable("camera")) {
      log("camera", "retry");
      tasks.push(attempt("camera", () => openCamera(cameraId)));
    }
    if (retryable("audio")) {
      log("audio", "retry");
      tasks.push(attempt("audio", () => openAudio(wantedAudio)));
    }
    await Promise.all(tasks);
  };

  function scheduleRetry() {
    if (retryTimer || stopped || !(retryable("camera") || retryable("audio"))) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void retry().then(scheduleRetry);
    }, RETRY_MS);
  }

  /** A device plugged or unplugged: the chosen one gone is a loss; a missing one is retried now. */
  const onDeviceChange = async () => {
    const list = await mediaDevices.enumerateDevices().catch(() => null);
    const kinds: [Kind, MediaDeviceKind][] = [
      ["camera", "videoinput"],
      ["audio", "audioinput"],
    ];
    for (const [kind, deviceKind] of kinds) {
      const id = held[kind]?.track.getSettings().deviceId;
      if (!list || !id || (kind === "audio" && audioChoice?.kind === "system")) continue;
      if (!list.some((d) => d.kind === deviceKind && d.deviceId === id)) lost(kind);
    }
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    await retry();
    scheduleRetry();
  };

  const resume = () => void context?.resume();
  const onContextState = () => {
    if (context?.state === "suspended") {
      log("audio", "suspended", REASON.suspended);
      deps.gestures.addEventListener("pointerdown", resume, { once: true });
    }
    notify();
  };

  return {
    async start(choice) {
      if (started) return;
      started = true;
      context = deps.createContext();
      context.addEventListener("statechange", onContextState);
      mediaDevices.addEventListener("devicechange", onDeviceChange);
      cameraId = choice.cameraId;
      wantedAudio = choice.audio;
      await Promise.all([
        attempt("camera", () => openCamera(choice.cameraId)),
        attempt("audio", () => openAudio(choice.audio)),
      ]);
      if (context.state === "suspended") onContextState();
    },
    // Before Start the pickers are disabled (PD12), so a choice only ever switches a running source.
    async setCamera(deviceId) {
      if (started) await attempt("camera", () => openCamera(deviceId));
    },
    async setAudio(choice) {
      if (started) await attempt("audio", () => openAudio(choice));
    },
    stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      for (const kind of ["camera", "audio"] as const) held[kind]?.release();
      stopSource();
      video = null;
      mediaDevices.removeEventListener("devicechange", onDeviceChange);
      deps.gestures.removeEventListener("pointerdown", resume);
      context?.removeEventListener("statechange", onContextState);
      void context?.close();
    },
    state,
    read(now) {
      return source ? source.read(now) : ZERO_FEATURES;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
