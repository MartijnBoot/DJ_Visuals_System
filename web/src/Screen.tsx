// The one route, `/` (spec UI): a full-window canvas running the engine, no chrome. If the
// engine cannot get a WebGL2 context, one line of text takes the canvas's place. Keys, with no
// modifier: `o` toggles the overlay (Phase 0), `s` the settings panel (B-01 SD6), `f` fullscreen
// (SD13). The panel is open on load with Start; capture begins only from that click (AC1, AC2,
// PD12), and from then on the page holds a screen wake lock (AC16).
import { createFeatureSource, ZERO_FEATURES } from "@djv/audio";
import processorUrl from "@djv/audio/processor?worker&url";
import {
  createEngine,
  DEFAULT_DIALS,
  type Dials,
  type Engine,
  type RenderScale,
} from "@djv/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { listDevices, supportsSystemAudio, type DeviceOption } from "./capture/devices.ts";
import { loadRemembered, type AudioChoice } from "./capture/remembered.ts";
import { createSession, type Session, type SessionState } from "./capture/session.ts";
import { audioToEngine } from "./features-compat.ts";
import { Overlay } from "./Overlay.tsx";
import { Panel } from "./Panel.tsx";
import { createWakeLock } from "./wake-lock.ts";

const IDLE: SessionState = { camera: "idle", audio: "idle", video: null, contextState: "none" };

/** The camera's frames reach the engine through a muted, never-shown video element. */
function createVideo(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  void video.play().catch((e: unknown) => console.warn("camera video did not play", e));
  return video;
}

export function Screen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [panel, setPanel] = useState(true);
  const [started, setStarted] = useState(false);
  const [capture, setCapture] = useState<SessionState>(IDLE);
  const [dials, setDials] = useState<Dials>(DEFAULT_DIALS);
  const [cap, setCap] = useState<RenderScale>(1);
  const [devices, setDevices] = useState<{ cameras: DeviceOption[]; audioInputs: DeviceOption[] }>({
    cameras: [],
    audioInputs: [],
  });
  const [remembered] = useState(() => loadRemembered());
  const [wakeLock] = useState(() => createWakeLock(navigator, document));

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
    // Registered before the engine's loop: frame callbacks run in registration order, so each
    // frame's features are read just before the engine draws with them.
    let feed = requestAnimationFrame(function tick() {
      feed = requestAnimationFrame(tick);
      engine.setFeatures(audioToEngine(session.read(performance.now())));
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

  // Dials and the cap go straight to the engine: the next frame uses them, capture runs on (AC9).
  useEffect(() => engineRef.current?.setDials(dials), [dials]);
  useEffect(() => engineRef.current?.setScaleCap(cap), [cap]);

  const refreshDevices = useCallback(() => {
    void listDevices(navigator.mediaDevices).then(setDevices);
  }, []);
  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  const start = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    setStarted(true);
    const capturing = session.start(remembered); // within the click: the context and requests need it
    void wakeLock.hold();
    await capturing;
    refreshDevices(); // labels and ids are readable once permission is granted
    const { camera, audio } = session.state();
    const down = (s: string) => s === "none" || s === "lost";
    if (!(down(camera) && down(audio))) setPanel(false); // both failed: keep the reasons up
  }, [remembered, refreshDevices, wakeLock]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "o") setOverlay((shown) => !shown);
      if (e.key === "s") setPanel((shown) => !shown);
      if (e.key === "f") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const stats = useCallback(() => engineRef.current?.stats() ?? null, []);
  const latency = useCallback(() => engineRef.current?.latency() ?? null, []);
  const lockState = useCallback(() => wakeLock.state(), [wakeLock]);
  const read = useCallback((now: number) => sessionRef.current?.read(now) ?? ZERO_FEATURES, []);

  return (
    <>
      {error ? (
        <p
          data-testid="engine-error"
          style={{ color: "#fff", fontFamily: "monospace", margin: 16 }}
        >
          {error}
        </p>
      ) : (
        <canvas
          ref={canvasRef}
          data-testid="screen"
          style={{ display: "block", width: "100vw", height: "100vh" }}
        />
      )}
      {overlay && (
        <Overlay
          stats={stats}
          latency={latency}
          wakeLock={lockState}
          audio={capture.audio}
          camera={capture.camera}
        />
      )}
      {panel && !error && (
        <Panel
          started={started}
          onStart={() => void start()}
          capture={capture}
          cameraId={started ? capture.cameraId : remembered.cameraId}
          audioChoice={started ? capture.audioChoice : remembered.audio}
          cameras={devices.cameras}
          audioInputs={devices.audioInputs}
          systemAudio={supportsSystemAudio(navigator.mediaDevices)}
          onCamera={(id) => void sessionRef.current?.setCamera(id)}
          onAudio={(choice: AudioChoice) => void sessionRef.current?.setAudio(choice)}
          dials={dials}
          onDials={setDials}
          cap={cap}
          onCap={setCap}
          read={read}
        />
      )}
    </>
  );
}

/** `f`: the whole page, so the overlay and panel stay reachable in fullscreen. */
function toggleFullscreen() {
  const request = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();
  request.catch((e: unknown) => console.warn("fullscreen request refused", e));
}
