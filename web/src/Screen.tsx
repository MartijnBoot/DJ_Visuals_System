// The one route, `/` (spec UI): a full-window canvas running the engine, no chrome. If the
// engine cannot get a WebGL2 context, one line of text takes the canvas's place. Keys, with no
// modifier: `o` toggles the overlay (Phase 0), `s` the settings panel (B-01 SD6), `f` fullscreen
// (SD13). The panel is open on load with Start; capture begins only from that click (AC1, AC2,
// PD12), and from then on the page holds a screen wake lock (AC16). Profiles (B-02): nothing is
// fetched on load; Start and each opening of the panel fetch the list, and picking a profile
// re-fetches it and cuts to it, applying its starting dials (`profiles/active.ts`). External
// control (B-04): the page opens one WebSocket to its own server on load (`control/
// screen-link.ts`); received controls are applied at the start of the next frame, before the
// engine draws (`control/apply.ts`), and the page sends its state at most once per frame.
// Remote input (B-06): the page answers each sender's offer (`remote/peers.ts`) and, at the start
// of each frame, `remote/sources.ts` decides which features and which video element the engine
// gets — the session's local ones or a sender's — so a loss falls back in the frame it is seen.
// The panel lists the senders' cameras and the main audio from the sources' facts, and each
// sender's connection from the page's own peer (PD5); nothing about a peer goes to the server.
// Transitions (B-09): the current choice is loaded from `djv.transition` at mount and is part of
// the state every controller mirrors; a `transition` control merges into it and saves it. Each
// pick reads it then (`profiles/active.ts`), and each frame tells the engine whether the audio
// that feeds the looks is ok, for Beat cut (`remote/sources.ts`). Scenes (B-07): the panel's scene
// row stages and goes through the applier, as a controller does, and asks the server over the
// screen socket for the rest (rename, delete, export, import).
import { createFeatureSource, ZERO_FEATURES } from "@djv/audio";
import processorUrl from "@djv/audio/processor?worker&url";
import {
  createEngine,
  DEFAULT_DIALS,
  type Dials,
  type Engine,
  type LatencyReading,
  type RenderScale,
} from "@djv/engine";
import type { SceneEntry, Staged, TransitionChoice } from "@djv/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { createLatencyWindow } from "../../engine/src/latency.ts";
import { listDevices, supportsSystemAudio, type DeviceOption } from "./capture/devices.ts";
import { loadRemembered, type AudioChoice } from "./capture/remembered.ts";
import { createSession, type Session, type SessionState } from "./capture/session.ts";
import type { SenderEntry, SenderState } from "./control/ExternalControl.tsx";
import { createVideo, hasFrame, videoReady } from "./capture/video.ts";
import { createApplier } from "./control/apply.ts";
import { openSocket } from "./control/device-link.ts";
import { hostedSession } from "./auth/session.ts";
import { createScreenLink, toScreenState, type SceneAsk } from "./control/screen-link.ts";
import type { AudioSource } from "./remote/main-audio.ts";
import { createPeers } from "./remote/peers.ts";
import { createSources, type Sources } from "./remote/sources.ts";
import { UNREACHABLE_MS } from "./send/peer.ts";
import { audioToEngine } from "./features-compat.ts";
import { startFrameFeed } from "./frame-feed.ts";
import { Overlay } from "./Overlay.tsx";
import { Panel } from "./Panel.tsx";
import { sharedToEngine } from "./profile-compat.ts";
import { createActiveProfile } from "./profiles/active.ts";
import { feedOf, matchFeed, type OnScreen, type VideoSender } from "./scenes/feed.ts";
import { createStagedLook } from "./scenes/staged.ts";
import { getProfile, listProfiles } from "./profiles/api.ts";
import { loadProfileId, saveProfileId } from "./profiles/remembered.ts";
import { loadTransition, saveTransition } from "./profiles/transition.ts";
import { createWakeLock } from "./wake-lock.ts";

const IDLE: SessionState = { camera: "idle", audio: "idle", video: null, contextState: "none" };

/** B-07 AC16: the note when Go finds no camera for a scene's feed. */
const FEED_NOTE = "Feed unavailable — kept the current camera";
/** B-06 SD21: a sender's camera id. */
const REMOTE_ID = "remote:";

/** What the panel shows of the remote sources (B-06 AC14, SD22). */
interface PanelRemote {
  cameras: DeviceOption[];
  cameraId: string | null;
  mainAudio: { choice: AudioSource; line: string } | null;
}

const NO_REMOTE: PanelRemote = { cameras: [], cameraId: null, mainAudio: null };

function panelRemote(sources: Sources, now: number): PanelRemote {
  const facts = sources.facts(now);
  const line = sources.audioLine(now);
  return {
    cameras: facts.cameras.map(({ deviceId, label }) => ({ deviceId, label })),
    cameraId: facts.cameraId,
    mainAudio: facts.mainAudio && line ? { choice: facts.mainAudio.choice, line } : null,
  };
}

/** B-06 PD12: a remote audio track reaches Web Audio only while a media element plays it. */
function attachAudio(stream: MediaStream) {
  const element = document.createElement("audio");
  element.muted = true; // never to the speakers
  element.srcObject = stream;
  void element.play().catch((e: unknown) => console.warn("remote audio did not play", e));
  return {
    release() {
      element.pause();
      element.srcObject = null;
    },
  };
}

/**
 * B-06 PD15: one remote leg, read from the receiver's statistics on each overlay poll and kept
 * for 10 s like B-01's latency. Null — the line absent — while no sender's leg is in use; a new
 * sender starts a new window.
 */
function legReader(
  inUse: () => string | null,
  stats: (deviceId: string) => Promise<number | null>,
): () => Promise<LatencyReading | null> {
  let device: string | null = null;
  let window = createLatencyWindow();
  return async () => {
    const id = inUse();
    if (id !== device) {
      device = id;
      window = createLatencyWindow();
    }
    if (id === null) return null;
    const ms = await stats(id);
    if (inUse() !== id) return null; // fell back while the statistics were read
    if (ms !== null) window.record(ms, performance.now());
    return window.read(performance.now());
  };
}

/** `cloud`: a local install with cloud settings shows the panel's cloud row (B-12 PD8). */
export function Screen({ cloud = false }: { cloud?: boolean } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const sourcesRef = useRef<Sources | null>(null);
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
  const [remote, setRemote] = useState<PanelRemote>(NO_REMOTE);
  const [wakeLock] = useState(() => createWakeLock(navigator, document));
  // B-09 SD9: the remembered transition choice, read once at mount.
  const [transition, setTransition] = useState(() => loadTransition());
  // What the screen's state is built from, read at the start of a frame rather than from React
  // state, whose updates land after it (B-04 PD5).
  const facts = useRef({
    dials: DEFAULT_DIALS,
    capture: IDLE,
    cameras: [] as DeviceOption[],
    transition,
  });
  const startedRef = useRef(false);
  /** Dials go to the engine at once and to the panel's sliders (B-04 AC19). */
  const applyDials = useCallback((next: Dials) => {
    facts.current.dials = next;
    engineRef.current?.setDials(next);
    setDials(next);
  }, []);
  // The controller reaches the engine through the ref, which is set once the canvas mounts.
  const [active] = useState(() =>
    createActiveProfile({
      api: { list: () => listProfiles(), get: (id) => getProfile(id) },
      storage: { load: () => loadProfileId(), save: (id) => saveProfileId(id) },
      setProfile: (profile, options) =>
        engineRef.current?.setProfile(sharedToEngine(profile), options) ?? Promise.resolve(),
      setDials: (next) => applyDials(next),
      log: (id) => console.info("profile", { id }),
      transition: () => facts.current.transition, // the choice at the moment of each pick (B-09)
    }),
  );
  const [profiles, setProfiles] = useState(() => active.state());
  useEffect(() => active.subscribe(() => setProfiles(active.state())), [active]);
  // B-07 AC16, PD6: the feed note, held until the next Go or pick, shown through the profile
  // reason line when the look has no reason of its own (the panel and every controller).
  const feedNote = useRef(false);
  const [noted, setNoted] = useState(false);
  const reasonOf = (state: ReturnType<typeof active.state>) =>
    state.reason ?? (feedNote.current ? FEED_NOTE : null);

  // B-07 (SD10): what the panel's scene row shows — the list and the staged look.
  const [sceneView, setSceneView] = useState<{ list: SceneEntry[] | null; staged: Staged | null }>({
    list: null,
    staged: null,
  });

  const [control] = useState(() => {
    // B-07 (SD2): the staged look, beside the live one; a change marks the next frame's state.
    const staged = createStagedLook({
      api: { get: (id) => getProfile(id) },
      onChange: () => {
        link.markDirty();
        setSceneView((view) => ({ ...view, staged: staged.state() }));
      },
    });
    const applier = createApplier({
      dials: () => facts.current.dials,
      setDials: (next) => applyDials(next),
      setColour: (slot, value) => active.setColour(slot, value),
      resetColour: (slot) => active.resetColour(slot),
      setCamera: (deviceId) => sourcesRef.current?.setCamera(deviceId),
      setMainAudio: (source) => sourcesRef.current?.setMainAudio(source),
      setTransition: (change) => changeTransition(change),
      setStrength: (profile, index, value) => active.setStrength(profile, index, value),
      pick: (id) => {
        setFeedNote(false);
        return active.pick(id);
      },
      refresh: () => void active.open(),
      started: () => startedRef.current,
      staged,
      snapshot: () => active.snapshot(),
      feedOnScreen: () => feedOf(onScreen(), facts.current.cameras, videoSenders()),
      feedOf: (id) =>
        feedOf(
          id.startsWith(REMOTE_ID)
            ? { kind: "remote", deviceId: id.slice(REMOTE_ID.length) }
            : { kind: "local", deviceId: id },
          facts.current.cameras,
          videoSenders(),
        ),
      transition: () => facts.current.transition,
      matchFeed: (feed) => matchFeed(feed, facts.current.cameras, videoSenders()),
      setFeedNote: (on) => setFeedNote(on),
      adopt: (look, choice) => active.adopt(look, choice),
      scenes: { ask: (request) => link.scenes(request), list: () => sceneList },
    });
    /** B-07 PD9: the saved scenes by name; null until listed, or when the list failed. */
    let sceneList: SceneEntry[] | null = null;
    /** B-07 PD6: the camera on screen — what the sources draw, else the session's open camera. */
    const onScreen = (): OnScreen | null => {
      const drawn = sourcesRef.current?.analysing(performance.now()).video ?? null;
      if (drawn) return { kind: "remote", deviceId: drawn };
      const capture = sessionRef.current?.state();
      return capture?.camera === "ok" && capture.cameraId
        ? { kind: "local", deviceId: capture.cameraId }
        : null;
    };
    /** The senders whose video is connected now, with their hints (B-04 SD26). */
    const videoSenders = (): VideoSender[] =>
      (sourcesRef.current?.facts(performance.now()).cameras ?? []).flatMap(({ deviceId }) => {
        const sender = senders.find((s) => `${REMOTE_ID}${s.deviceId}` === deviceId);
        return sender ? [{ deviceId: sender.deviceId, hint: sender.hint }] : [];
      });
    const setFeedNote = (on: boolean) => {
      if (feedNote.current === on) return;
      feedNote.current = on;
      setNoted(on);
      link.markDirty();
    };
    // B-06: the senders' labels, for log lines (never a device's own label, SD25).
    const labels = new Map<string, string>();
    let senders: Parameters<Sources["setSenders"]>[0] = [];
    const peers = createPeers({
      send: (message) => void link.relay(message),
      now: () => Date.now(),
      log: (event, deviceId) =>
        console.info("remote", { event, device: labels.get(deviceId) ?? "unknown" }),
      onChange: () => link.markDirty(),
    });
    const link = createScreenLink({
      url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/control/screen`,
      connect: openSocket,
      buildState: () =>
        toScreenState({
          ...facts.current,
          profiles: { ...active.state(), reason: reasonOf(active.state()) },
          staged: staged.state(),
          scenes: sceneList,
          started: startedRef.current,
          ...(sourcesRef.current ? { remote: sourcesRef.current.facts(performance.now()) } : {}),
        }),
      onControl: (deviceId, received) => applier.receive(deviceId, received),
      onNewDevice: () => void active.open(), // a controller connecting is a user action (SD22)
      onSetup: (message) =>
        message.type === "offer"
          ? peers.offer(message.deviceId, message.sdp)
          : peers.candidate(message.deviceId, {
              candidate: message.candidate,
              sdpMid: message.sdpMid,
              sdpMLineIndex: message.sdpMLineIndex,
            }),
      onSenders: (list) => {
        for (const s of list) labels.set(s.deviceId, s.label);
        senders = list;
        sourcesRef.current?.setSenders(list);
      },
      onScenes: (list) => {
        sceneList = list;
        link.markDirty();
        setSceneView((view) => ({ ...view, list }));
      },
    });
    /** B-07 (SD10): the panel's scene requests; a rename keeps the staged look tied (as `apply`). */
    const askScenes = async (request: SceneAsk) => {
      const result = await link.scenes(request);
      const scene = request.type === "scenes.rename" && result?.ok ? result.scene : undefined;
      if (scene && staged.state()?.fromScene?.id === scene.id) {
        staged.tie({ id: scene.id, name: scene.name });
      }
      return result;
    };
    /** Senders whose peer has been connected since their first offer (PD5). */
    const reached = new Set<string>();
    /**
     * B-06 PD5: a sender's state from this page's peer. Not connected within 10 s of the first
     * offer, and never before, is "could not reach" (AC13); a lost feed or a dropped peer is
     * "lost"; the camera drawn is "on screen". No peer and no socket is "lost" too.
     */
    const senderState = (entry: SenderEntry): SenderState => {
      const peer = peers.connection(entry.deviceId);
      if (!peer) return entry.online ? "connecting" : "lost";
      if (!peer.connected) {
        if (reached.has(entry.deviceId)) return "connecting";
        return Date.now() - peer.firstOfferAt >= UNREACHABLE_MS ? "could not reach" : "connecting";
      }
      reached.add(entry.deviceId);
      const down = peer.state === "disconnected" || peer.state === "failed";
      if (down || peers.feeds().some((f) => f.deviceId === entry.deviceId && f.lost)) return "lost";
      const drawn = sourcesRef.current?.analysing(performance.now()).video;
      return drawn === entry.deviceId ? "on screen" : "connected";
    };
    /** B-09 SD5, SD9: merged into the current choice, saved, and in the next frame's state. */
    const changeTransition = (change: Partial<TransitionChoice>) => {
      const next = { ...facts.current.transition, ...change };
      facts.current.transition = next;
      saveTransition(next);
      setTransition(next);
      link.markDirty();
    };
    return {
      applier,
      link,
      peers,
      senders: () => senders,
      senderState,
      changeTransition,
      setFeedNote,
      scenes: {
        stage: (id: string) => applier.local({ type: "stage", seq: 0, from: { scene: id } }),
        go: () => applier.local({ type: "go", seq: 0 }),
        ask: askScenes,
      },
    };
  });
  // B-12 SD1, AC21: hosted use has no External control and no remote input, so the screen link
  // never starts and `/api/control/screen` is never asked for.
  const [hosted] = useState(() => hostedSession());
  const [signedOut, setSignedOut] = useState(() => hosted?.isSignedOut() ?? false);
  useEffect(() => hosted?.onSignedOut(() => setSignedOut(true)), [hosted]);
  useEffect(() => {
    if (hosted) return;
    control.link.start();
    return () => control.link.stop();
  }, [control, hosted]);
  const [controlView, setControlView] = useState(() => control.link.view());
  useEffect(() => control.link.subscribe(() => setControlView(control.link.view())), [control]);
  // Mirrors `panel` so a key handler can tell an opening from a closing without an updater side effect.
  const panelRef = useRef(true);
  const showPanel = useCallback((next: boolean) => {
    panelRef.current = next;
    setPanel(next);
  }, []);

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
    // The guard's reason reaches the panel and every controller through the profile reason
    // (B-03 SD8, PD8); each is logged with the profile on screen.
    const stopGuard = engine.onGuard((event) => {
      active.guard(event);
      console.warn("profile guard", { id: active.state().activeId, ...event });
    });
    const session = createSession({
      mediaDevices: navigator.mediaDevices,
      createContext: () => new AudioContext(),
      createFeatureSource,
      moduleUrl: processorUrl,
      createVideo,
      videoReady, // a camera switch keeps the old picture until the new one's frame (B-06 PD14)
      gestures: document,
      log: (kind, state, reason) => console.info("capture", { kind, state, reason }),
    });
    sessionRef.current = session;
    const sources = createSources({
      session,
      peers: control.peers,
      createFeatureSource,
      moduleUrl: processorUrl,
      attachAudio,
      createVideo,
      hasFrame,
      log: (state, label) => console.info("capture", { kind: "audio", state, device: label }),
      onChange: () => {
        control.link.markDirty();
        setRemote(panelRemote(sources, performance.now()));
      },
    });
    sources.setSenders(control.senders());
    sourcesRef.current = sources;
    const unsubscribe = session.subscribe((state) => setCapture(state));
    let video: HTMLVideoElement | null = null;
    // Each frame reads the features just before the engine draws with them (frame-feed.ts).
    // B-04: received controls first, then this frame's acknowledgements and state. B-06: then the
    // sources decide this frame's video and features, from flags read now.
    const stopFeed = startFrameFeed(
      engine,
      () => audioToEngine(sources.read(performance.now())),
      () => {
        control.link.flush(control.applier.drain());
        sources.frame(performance.now());
        engine.setAudioOk(sources.audioOk(performance.now())); // Beat cut's rule (B-09 SD10)
        const next = sources.video();
        if (next !== video) engine.setSource((video = next));
      },
    );
    return () => {
      stopFeed();
      unsubscribe();
      sources.stop();
      sourcesRef.current = null;
      stopGuard();
      session.stop();
      engine.stop();
      engineRef.current = null;
      sessionRef.current = null;
    };
  }, [control, active]);

  // Every change a controller mirrors marks the state for the next frame (B-04 SD5).
  useEffect(() => {
    facts.current.capture = capture;
    facts.current.cameras = devices.cameras;
    facts.current.dials = dials;
    startedRef.current = started;
    control.link.markDirty();
  }, [control, profiles, capture, devices, dials, started]);

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
    sourcesRef.current?.start(); // the context exists now: remote audio can be analysed (B-06 SD17)
    void wakeLock.hold();
    void active.open(); // Start is a user action: the first profile request (B-02 PD1)
    await capturing;
    refreshDevices(); // labels and ids are readable once permission is granted
    const { camera, audio } = session.state();
    const down = (s: string) => s === "none" || s === "lost";
    if (!(down(camera) && down(audio))) showPanel(false); // both failed: keep the reasons up
  }, [active, remembered, refreshDevices, showPanel, wakeLock]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      // A focused picker does type-ahead on these letters: leave form controls to themselves.
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "o") setOverlay((shown) => !shown);
      if (e.key === "s") {
        const opening = !panelRef.current;
        showPanel(opening);
        if (opening) void active.open(); // every opening re-fetches the list (B-02 AC11)
      }
      if (e.key === "f") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, showPanel]);

  const stats = useCallback(() => engineRef.current?.stats() ?? null, []);
  const latency = useCallback(() => engineRef.current?.latency() ?? null, []);
  const lockState = useCallback(() => wakeLock.state(), [wakeLock]);
  const read = useCallback((now: number) => sourcesRef.current?.read(now) ?? ZERO_FEATURES, []);
  // B-06 AC28, AC29, SD22: the overlay's remote lines, from what the sources analyse and draw.
  const [legs] = useState(() => {
    const inUse = () => sourcesRef.current?.analysing(performance.now()) ?? null;
    return {
      network: legReader(
        () => inUse()?.audio ?? null,
        (id) => control.peers.stats(id, "audio"),
      ),
      video: legReader(
        () => inUse()?.video ?? null,
        (id) => control.peers.stats(id, "video"),
      ),
    };
  });
  const remoteLines = useCallback(() => {
    const now = performance.now();
    const sources = sourcesRef.current;
    const drawn = sources?.analysing(now).video ?? null;
    const label = control.senders().find((s) => s.deviceId === drawn)?.label;
    return {
      audio: sources?.audioLine(now) ?? null,
      camera: label === undefined ? null : `camera: remote (${label}) ok`,
    };
  }, [control]);

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
          profileName={profiles.activeName}
          network={legs.network}
          video={legs.video}
          remote={remoteLines}
        />
      )}
      {panel && !error && (
        <Panel
          started={started}
          onStart={() => void start()}
          capture={capture}
          cameraId={started ? (remote.cameraId ?? capture.cameraId) : remembered.cameraId}
          audioChoice={started ? capture.audioChoice : remembered.audio}
          cameras={devices.cameras}
          audioInputs={devices.audioInputs}
          systemAudio={supportsSystemAudio(navigator.mediaDevices)}
          onCamera={(id) => sourcesRef.current?.setCamera(id)}
          onAudio={(choice: AudioChoice) => void sessionRef.current?.setAudio(choice)}
          remoteCameras={remote.cameras}
          mainAudio={remote.mainAudio}
          onMainAudio={(source) => sourcesRef.current?.setMainAudio(source)}
          senderState={control.senderState}
          dials={dials}
          onDials={applyDials}
          cap={cap}
          onCap={setCap}
          read={read}
          profiles={noted ? { ...profiles, reason: reasonOf(profiles) } : profiles}
          onProfile={(id) => {
            control.setFeedNote(false);
            void active.pick(id);
          }}
          transition={transition}
          onTransition={control.changeTransition}
          control={controlView}
          onControl={(action) => void control.link.send(action)}
          {...(hosted ? { hosted: { signedOut, onSignInAgain: () => void hosted.signIn() } } : {})}
          cloud={cloud}
          {...(hosted ? {} : { scenes: { ...sceneView, ...control.scenes } })}
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
