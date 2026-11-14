// The builder's preview canvas (B-02 spec SD5, SD19, AC4; plan T14, PD15, AD3): the profile being
// edited, on its own engine instance. Every draft change goes to `setProfile`: a value edit shows
// on the next frame, a stack edit after the prepared swap while the old program keeps drawing
// (AD3). The draft's starting dials are the dials (PD15). Before Start the features are the
// synthetic loop and the source is the noise field, so a profile can be built alone at a desk
// with no media request; after Start they are the capture session's, as on the output screen.
// The preview exists only in the builder tree.
import { createFeatureSource, syntheticFeatures } from "@djv/audio";
import processorUrl from "@djv/audio/processor?worker&url";
import { createEngine, ProfileSupersededError, type Engine } from "@djv/engine";
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

export function Preview({ draft }: { draft: Profile }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
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
      session.stop();
      engine.stop();
      engineRef.current = null;
      sessionRef.current = null;
    };
  }, []);

  // Every edit goes to the engine: a value edit on the next frame, a stack edit at the swap (AD3).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setDials(draft.dials);
    engine.setProfile(sharedToEngine(draft)).catch((e: unknown) => {
      if (!(e instanceof ProfileSupersededError)) console.warn("preview profile not applied", e);
    });
  }, [draft]);

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
