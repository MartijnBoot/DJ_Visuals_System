// The builder's preview canvas (B-02 spec SD5, SD19, AC4; plan T14, PD15, AD3): the profile being
// edited, on its own engine instance. Every draft change goes to `setProfile`: a value edit shows
// on the next frame, a stack edit after the prepared swap while the old program keeps drawing
// (AD3). The draft's starting dials are the dials (PD15). Before Start the features are the
// synthetic loop and the source is the noise field, so a profile can be built alone at a desk
// with no media request; after Start they are the capture session's, as on the output screen.
// The preview exists only in the builder tree.
import { createFeatureSource, syntheticFeatures } from "@djv/audio";
import processorUrl from "@djv/audio/processor?worker&url";
import {
  createEngine,
  ProfileCompileError,
  ProfileSupersededError,
  type CompileIssue,
  type Engine,
  type GuardEvent,
} from "@djv/engine";
import type { Profile } from "@djv/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { listDevices, supportsSystemAudio, type DeviceOption } from "../capture/devices.ts";
import { loadRemembered, type AudioChoice } from "../capture/remembered.ts";
import { createSession, type Session, type SessionState } from "../capture/session.ts";
import { createVideo } from "../capture/video.ts";
import { audioToEngine } from "../features-compat.ts";
import { sharedToEngine } from "../profile-compat.ts";
import { SourcePickers } from "../SourcePickers.tsx";

const IDLE: SessionState = { camera: "idle", audio: "idle", video: null, contextState: "none" };

/** What one compile of the preview gave (B-03 PD10); "checking" is a draft with no report yet. */
export type CompileState =
  | { kind: "ok" }
  | { kind: "failed"; issues: readonly CompileIssue[] }
  /** The preview has no WebGL2: nothing can be checked. */
  | { kind: "unavailable" }
  /**
   * The engine took the draft while its WebGL context was lost, so nothing compiled; after the
   * restore it draws without the code until the code is edited (B-03 review, finding 3).
   */
  | { kind: "unchecked" };

/** A compile result and the program key it belongs to; `null` belongs to every draft. */
export interface CompileReport {
  key: string | null;
  state: CompileState;
}

/**
 * What a compile depends on: the effect list and every custom body's code. A slider or a colour
 * keeps it, so only an edit to the code or the stack waits for a new compile.
 */
export function programKey(draft: Profile): string {
  return JSON.stringify(draft.effects.map((e) => (e.type === "custom" ? [e.code] : e.type)));
}

/** Code edits reach the engine after this pause, so typing does not compile every key (PD10). */
const CODE_DEBOUNCE_MS = 150;

const GUARD_TEXT = {
  slow: "custom effects are off: this look is too heavy for this GPU; edit the code to retry",
  lost: "the graphics context was lost and restored",
  lostCustom:
    "the graphics context was lost and restored; custom effects are off; edit the code to retry",
} as const;

const guardText = (event: GuardEvent): string => {
  if (event.kind === "slow") return GUARD_TEXT.slow;
  return event.customBypassed ? GUARD_TEXT.lostCustom : GUARD_TEXT.lost;
};

export interface PreviewProps {
  draft: Profile;
  /** Every compile result of the preview's engine (B-03 PD10). */
  onCompile(report: CompileReport): void;
}

export function Preview({ draft, onCompile }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [guard, setGuard] = useState<string | null>(null);
  const [frameMs, setFrameMs] = useState(0);
  const [started, setStarted] = useState(false);
  const [capture, setCapture] = useState<SessionState>(IDLE);
  const [devices, setDevices] = useState<{ cameras: DeviceOption[]; audioInputs: DeviceOption[] }>({
    cameras: [],
    audioInputs: [],
  });
  const [remembered] = useState(() => loadRemembered());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: Engine;
    try {
      engine = createEngine(canvas);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    engineRef.current = engine;
    // B-03 SD8, AC16: why custom effects are off, and the frame time about four times a second.
    const stopGuard = engine.onGuard((event: GuardEvent) => setGuard(guardText(event)));
    const frameTimer = setInterval(() => setFrameMs(engine.stats().frameTimeMs), 250);
    // The same session the output screen creates (`Screen.tsx`): nothing is requested until Start.
    const session = createSession({
      mediaDevices: navigator.mediaDevices,
      createContext: () => new AudioContext(),
      createFeatureSource,
      moduleUrl: processorUrl,
      createVideo,
      gestures: document,
      log: (kind, state, reason) => console.info("capture", { kind, state, reason }),
    });
    sessionRef.current = session;
    let video: HTMLVideoElement | null = null;
    const unsubscribe = session.subscribe((state) => {
      setCapture(state);
      if (state.video !== video) engine.setSource((video = state.video));
    });
    // Registered before the engine's loop, so each frame's features are read just before it draws.
    // After Start a lost or absent source reads as zero features, and the picture falls back to
    // the noise field (SD5); before Start it is the synthetic loop (SD19).
    let feed = requestAnimationFrame(function tick() {
      feed = requestAnimationFrame(tick);
      const now = performance.now();
      engine.setFeatures(
        audioToEngine(startedRef.current ? session.read(now) : syntheticFeatures(now)),
      );
    });
    engine.start();
    return () => {
      cancelAnimationFrame(feed);
      unsubscribe();
      stopGuard();
      clearInterval(frameTimer);
      session.stop();
      engine.stop();
      engineRef.current = null;
      sessionRef.current = null;
    };
  }, []);

  // Without WebGL2 no code can be checked, so a draft with code cannot be saved (PD10).
  useEffect(() => {
    if (error) onCompile({ key: null, state: { kind: "unavailable" } });
  }, [error, onCompile]);

  // Every edit goes to the engine: a value edit on the next frame, a stack edit at the swap (AD3).
  // A new program key (code or stack) waits a moment first, and each result is reported with
  // the key it belongs to (B-03 PD10).
  const sentKey = useRef<string | null>(null);
  /**
   * The key the engine took while its context was lost: not compiled, and after the restore the
   * engine keeps it without its code until another key (finding 3). Read the loss from the
   * context itself, which knows it at once, before any event listener has run.
   */
  const uncheckedKey = useRef<string | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setDials(draft.dials);
    const key = programKey(draft);
    const contextLost = () => canvasRef.current?.getContext("webgl2")?.isContextLost() ?? false;
    const report = (state: CompileState) => {
      if (contextLost()) uncheckedKey.current = key;
      else if (uncheckedKey.current !== key) uncheckedKey.current = null;
      onCompile({ key, state: uncheckedKey.current === key ? { kind: "unchecked" } : state });
    };
    const send = () => {
      engine.setProfile(sharedToEngine(draft)).then(
        () => report({ kind: "ok" }),
        (e: unknown) => {
          if (e instanceof ProfileSupersededError) return;
          const issues = e instanceof ProfileCompileError ? e.issues : [];
          if (!(e instanceof ProfileCompileError) && !contextLost()) {
            console.warn("preview profile not applied", e);
          }
          report({ kind: "failed", issues });
        },
      );
    };
    if (key === sentKey.current) return send();
    sentKey.current = key;
    setGuard(null); // a code or stack edit retries custom effects the guard turned off (PD8)
    const timer = setTimeout(send, CODE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, onCompile]);

  const refreshDevices = useCallback(() => {
    void listDevices(navigator.mediaDevices).then(setDevices);
  }, []);
  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  const start = async () => {
    const session = sessionRef.current;
    if (!session) return;
    startedRef.current = true;
    setStarted(true);
    const capturing = session.start(remembered); // within the click: the context and requests need it
    await capturing;
    refreshDevices(); // labels and ids are readable once permission is granted
  };

  return (
    <section aria-label="Preview" style={{ display: "grid", gap: 6 }}>
      {error ? (
        <p data-testid="preview-error">{error}</p>
      ) : (
        <canvas
          ref={canvasRef}
          data-testid="preview"
          style={{
            display: "block",
            width: "100%",
            maxWidth: 640,
            aspectRatio: "16 / 9",
            background: "#000",
          }}
        />
      )}
      {!error && (
        <span data-testid="preview-frame-time" title="this GPU's time per frame for this look">
          frame {frameMs.toFixed(1)} ms
        </span>
      )}
      {guard && (
        <span data-testid="preview-guard" role="status" style={{ color: "#fc8" }}>
          {guard}
        </span>
      )}
      {!started ? (
        <button type="button" data-testid="preview-start" onClick={() => void start()}>
          Start camera and audio
        </button>
      ) : (
        <div style={{ display: "grid", gap: 4, maxWidth: 640 }}>
          <span data-testid="preview-camera-state">camera: {capture.camera}</span>
          <span data-testid="preview-audio-state">audio: {capture.audio}</span>
          {capture.reason && <span data-testid="preview-reason">{capture.reason}</span>}
          <SourcePickers
            started={started}
            capture={capture}
            cameraId={capture.cameraId}
            audioChoice={capture.audioChoice}
            cameras={devices.cameras}
            audioInputs={devices.audioInputs}
            systemAudio={supportsSystemAudio(navigator.mediaDevices)}
            onCamera={(id) => void sessionRef.current?.setCamera(id)}
            onAudio={(choice: AudioChoice) => void sessionRef.current?.setAudio(choice)}
          />
        </div>
      )}
    </section>
  );
}
