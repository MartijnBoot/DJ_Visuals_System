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
import {
  toScreenSchema,
  type AppliedEntry,
  type Control,
  type ControlStatus,
  type ScreenMessage,
  type ScreenState,
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
/** What the screen page sends a sender through the server (B-06 SD16). */
export type ToSender = Extract<ScreenMessage, { type: "answer" | "candidate" | "stream" }>;

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
}

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
  const isOpen = () => !view.superseded && socket !== null && socket.readyState === OPEN;
  const write = (message: ScreenMessage) => socket!.send(JSON.stringify(message));

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
    if (message.type === "superseded") return update({ superseded: true });
    if (message.type === "offer" || message.type === "candidate") return deps.onSetup?.(message);
    if (message.type === "scenes.result") return; // B-07: the page asks nothing yet (T7)
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
    };
    ws.onmessage = (event) => {
      if (socket === ws && !view.superseded) onMessage(event.data);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
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
    view: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
