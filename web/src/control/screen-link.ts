// The screen page's External control socket (B-04 spec SD5, SD13, SD22, SD25, AC29 to AC31; plan
// PD3, PD12, PD17): one WebSocket to `/api/control/screen` on its own origin, opened on load. It
// hands received controls on, keeps the server's status for the panel, sends the page's state at
// most once per frame (a dirty flag, flushed with that frame's acknowledgements from
// `beforeFrame`), and carries the panel's actions. A device id not seen before lists the profiles
// (SD22: a controller connecting is a user action; nothing polls). It reconnects quietly with the
// shared backoff; nothing else on the screen page depends on it. After `superseded` it does
// nothing further (AC31). B-06 (T13): a sender's `offer` and `candidate` go to the page's
// sources, which answer through `relay`; every status's senders go there too, so a sender that
// left has its peer closed; and the state carries the remote cameras and the main audio.
// B-07 (T12, PD14, PD15): the preview's holder and its setup go to the page's preview, never to
// the remote sources; a close or a supersede forgets the holder; the state carries the preview.
import {
  toScreenSchema,
  type AppliedEntry,
  type Control,
  type ControlStatus,
  type ScreenMessage,
  type SceneEntry,
  type SceneRequest,
  type SceneResult,
  type ScreenState,
  type Staged,
  type ToScreen,
  type TransitionChoice,
} from "@djv/shared";
import type { DeviceOption } from "../capture/devices.ts";
import type { SessionState } from "../capture/session.ts";
import type { ActiveState } from "../profiles/active.ts";
import { createBackoff } from "./backoff.ts";
import type { SocketLike } from "./device-link.ts";

export type PanelAction = Extract<
  ScreenMessage,
  { type: "enable" | "disable" | "newCode" | "disconnect" | "accept" | "reject" }
>;

type FromSender = Extract<ToScreen, { type: "offer" | "candidate" }>;
/** What the screen page sends a sender through the server (B-06 SD16), or the preview's holder. */
export type ToSender = Extract<
  ScreenMessage,
  { type: "answer" | "candidate" | "stream" | "previewOffer" | "previewCandidate" }
>;
/** B-07 PD15: the preview's holder (null: no one) and the holder's setup. */
export type ToPreview = Extract<
  ToScreen,
  { type: "preview" | "previewAnswer" | "previewCandidate" }
>;

export interface ScreenLinkDeps {
  url: string;
  connect(url: string): SocketLike;
  buildState(): ScreenState;
  onControl(deviceId: string, control: Control): void;
  onNewDevice(): void;
  /** A sender's offer or candidate (B-06). */
  onSetup?(message: FromSender): void;
  /** The approved senders in each status (B-06). */
  onSenders?(senders: ControlStatus["senders"]): void;
  /**
   * B-07 PD9: the saved scenes, asked for on every open and replaced by every reply that carries
   * them; null when the list could not load. Without it the page asks for no list.
   */
  onScenes?(list: SceneEntry[] | null): void;
  /** B-07 PD15: the preview's messages; `{ deviceId: null }` too when the socket goes. */
  onPreview?(message: ToPreview): void;
}

/** A scene request as the page asks it; the link adds the `requestId` (PD9). */
export type SceneAsk = SceneRequest extends infer R
  ? R extends SceneRequest
    ? Omit<R, "requestId">
    : never
  : never;

export interface ScreenLinkView {
  connection: "connecting" | "open" | "down";
  superseded: boolean;
  /** The server's last status; null while down. */
  status: ControlStatus | null;
}

export interface ScreenLink {
  start(): void;
  stop(): void;
  /** Something the state carries changed: the next frame sends it. */
  markDirty(): void;
  /** From `beforeFrame`: this frame's acknowledgements, then the state if it changed. */
  flush(applied: AppliedEntry[]): void;
  send(action: PanelAction): boolean;
  /** A setup message for a sender; false when the socket is not open (B-06). */
  relay(message: ToSender): boolean;
  /** B-07 PD9: one scene request; its reply, or null when the socket is not open or closes. */
  scenes(ask: SceneAsk): Promise<SceneResult | null>;
  view(): ScreenLinkView;
  subscribe(listener: () => void): () => void;
}

const OPEN = 1;
/** `applied.entries.max(1000)` in `shared/src/control.ts`. */
const APPLIED_MAX = 1000;

/** What the screen page knows, for `toScreenState`. */
export interface ScreenFacts {
  profiles: ActiveState;
  dials: ScreenState["dials"];
  capture: Pick<SessionState, "camera" | "audio" | "cameraId">;
  cameras: readonly DeviceOption[];
  started: boolean;
  /** B-09 SD5: the current transition choice. */
  transition: TransitionChoice;
  /** B-07 PD2: the staged look as controllers show it; null or absent while there is none. */
  staged?: Staged | null;
  /** B-07 PD2: the saved scenes; null or absent when the list could not load. */
  scenes?: SceneEntry[] | null;
  /** B-07 PD2: the preview stream's state; absent is off. */
  preview?: ScreenState["preview"];
  /** B-06: the remote cameras, a picked remote camera's id, the main audio. */
  remote?: {
    cameras: ScreenState["cameras"];
    cameraId: string | null;
    mainAudio: ScreenState["mainAudio"];
  };
}

/**
 * The state every controller mirrors (SD5, SD8): the picker's list, the active profile with its
 * live palette and primary slot, the dials, the cameras with their labels, the source states,
 * Start, the panel's profile reason word for word (AC26) and the transition choice (B-09). Lists
 * are cut to the schema's bounds so a long list never makes the whole state invalid.
 */
export function toScreenState({
  profiles,
  dials,
  capture,
  cameras,
  started,
  transition,
  remote,
  staged = null,
  scenes = null,
  preview = "off",
}: ScreenFacts) {
  const local = cameras.map(({ deviceId, label }) => ({ deviceId, label, remote: false }));
  const state: ScreenState = {
    profiles: profiles.entries.slice(0, 1000).map(({ id, name }) => ({ id, name })),
    activeId: profiles.activeId,
    palette: profiles.palette,
    storedPalette: profiles.storedPalette,
    primary: profiles.primary,
    dials: { recognisability: dials.recognisability, reactivity: dials.reactivity },
    cameras: [...local, ...(remote?.cameras ?? [])].slice(0, 64),
    cameraId: remote?.cameraId ?? capture.cameraId ?? null,
    camera: capture.camera,
    audio: capture.audio,
    started,
    reason: profiles.reason,
    mainAudio: remote?.mainAudio ?? null,
    transition: {
      kind: transition.kind,
      duration: transition.duration,
      keepColour: transition.keepColour,
    },
    effects: profiles.effects.map(({ index, name, stored, value, dj, vj }) => ({
      index,
      name,
      stored,
      value,
      dj,
      vj,
    })),
    staged,
    scenes: scenes === null ? null : scenes.slice(0, 200).map(({ id, name }) => ({ id, name })),
    preview,
  };
  return state;
}

export function createScreenLink(deps: ScreenLinkDeps): ScreenLink {
  const backoff = createBackoff();
  const listeners = new Set<() => void>();
  const seen = new Set<string>();
  let socket: SocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let dirty = true;
  let view: ScreenLinkView = { connection: "connecting", superseded: false, status: null };

  const update = (next: Partial<ScreenLinkView>) => {
    view = { ...view, ...next };
    listeners.forEach((l) => l());
  };
  /** B-07 PD15: the page holds no stream once its socket is gone or superseded. */
  const forgetHolder = () => deps.onPreview?.({ type: "preview", deviceId: null });
  const isOpen = () => !view.superseded && socket !== null && socket.readyState === OPEN;
  const write = (message: ScreenMessage) => socket!.send(JSON.stringify(message));

  /** B-07 PD9: each scene request waits for its reply by id; a close answers them all null. */
  let nextRequest = 0;
  const waiting = new Map<number, (result: SceneResult | null) => void>();
  const ask = (request: SceneAsk): Promise<SceneResult | null> => {
    if (!isOpen()) return Promise.resolve(null);
    const requestId = ++nextRequest;
    write({ ...request, requestId } as ScreenMessage);
    return new Promise((resolve) => waiting.set(requestId, resolve));
  };
  const abandon = () => {
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
  };
  const onResult = (result: SceneResult) => {
    const resolve = waiting.get(result.requestId);
    if (!resolve) return; // not ours, or no longer waited for
    waiting.delete(result.requestId);
    if (result.list) deps.onScenes?.(result.list);
    resolve(result);
  };
  /** On every open: the list, or null when it cannot be read. */
  const listScenes = () => {
    if (!deps.onScenes) return;
    void ask({ type: "scenes.list" }).then((result) => {
      if (!result?.ok) deps.onScenes?.(null);
    });
  };

  const onMessage = (data: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const result = toScreenSchema.safeParse(parsed);
    if (!result.success) return;
    const message = result.data;
    if (message.type === "control") return deps.onControl(message.deviceId, message.control);
    if (message.type === "superseded") {
      forgetHolder();
      return update({ superseded: true });
    }
    if (message.type === "offer" || message.type === "candidate") return deps.onSetup?.(message);
    if (message.type === "scenes.result") return onResult(message);
    if (message.type !== "status") return deps.onPreview?.(message);
    const fresh = message.status.devices.filter((d) => !seen.has(d.deviceId));
    for (const d of fresh) seen.add(d.deviceId);
    update({ status: message.status });
    deps.onSenders?.(message.status.senders);
    if (fresh.length > 0) deps.onNewDevice();
  };

  const connect = () => {
    timer = null;
    if (stopped || view.superseded) return;
    const ws = deps.connect(deps.url);
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      backoff.reset();
      dirty = true; // a (re)connected page sends its state first thing (SD13)
      update({ connection: "open" });
      listScenes();
    };
    ws.onmessage = (event) => {
      if (socket === ws && !view.superseded) onMessage(event.data);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      abandon();
      forgetHolder();
      if (stopped || view.superseded) return;
      update({ connection: "down", status: null });
      timer = setTimeout(connect, backoff.next());
    };
  };

  return {
    start() {
      stopped = false; // React's development double mount stops, then starts again
      connect();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const current = socket;
      socket = null;
      abandon();
      current?.close();
    },
    markDirty() {
      dirty = true;
    },
    flush(applied) {
      if (!isOpen()) return;
      // A frame can acknowledge more than one message holds (after a paused tab, say).
      for (let i = 0; i < applied.length; i += APPLIED_MAX) {
        write({ type: "applied", entries: applied.slice(i, i + APPLIED_MAX) });
      }
      if (!dirty) return;
      dirty = false;
      write({ type: "state", state: deps.buildState() });
    },
    send(action) {
      if (!isOpen()) return false;
      write(action);
      return true;
    },
    relay(message) {
      if (!isOpen()) return false;
      write(message);
      return true;
    },
    scenes: ask,
    view: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
