// The controller's link (B-04 spec SD4, SD5, SD12, SD17, SD19, AC10, AC11, AC27, AC28; plan PD4,
// PD14): one socket to the External control listener, the pairing hello, the link state shown on
// one line, and reconnecting. Every browser API enters through `DeviceLinkDeps`, so it is tested
// without a browser. Rules:
// - The code comes from `#code=` (then the fragment is cleared) or the code field; a stored key
//   reconnects without a new approval. After an approval only the key is used.
// - The controls are locked until the screen's state has arrived on this connection; a control
//   sent while locked is dropped, never queued (SD12).
// - A dropped socket reconnects at 0.5 s doubling to 5 s, and at once when the page becomes
//   visible or the network comes back. A server that does not answer at all is retried for ever:
//   a browser cannot tell a stopped server from a Wi-Fi drop (PD4).
// - "Pairing ended" (ended, or a key refused) removes the key and stops trying; any other refusal
//   stops trying until a code is entered again.
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  toDeviceSchema,
  type Control,
  type DeviceEntry,
  type ScreenState,
  type ToDevice,
} from "@djv/shared";
import { createBackoff } from "./backoff.ts";
import { createRoundTrip, type RoundTripReading } from "./round-trip.ts";

export type LinkStatus =
  | "needs_code"
  | "connecting"
  | "waiting"
  | "rejected"
  | "expired"
  | "wrong_code"
  | "too_many"
  | "throttled"
  | "reconnecting"
  | "screen_off"
  | "ended"
  | "live";

/** The link line (spec UI, "/control, link states"). */
export const LINK_TEXT: Readonly<Record<LinkStatus, string>> = {
  needs_code: "Scan the code on the screen machine",
  connecting: "Connecting…",
  waiting: "Waiting for approval",
  rejected: "Request rejected",
  expired: "Request expired — try again",
  wrong_code: "Wrong code",
  too_many: "Too many devices",
  throttled: "Too many wrong codes — try again in a minute",
  reconnecting: "Reconnecting…",
  screen_off: "Screen not connected",
  ended: "Pairing ended — scan the code again",
  live: "Connected",
};

/** The browser's WebSocket, as much of it as the link uses. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

/**
 * The browser's WebSocket as a `SocketLike`. Its handler properties take `Event`/`MessageEvent`,
 * so the types do not line up, but every member `SocketLike` names behaves as described: text
 * frames arrive as `MessageEvent`s whose `data` is a string.
 */
export const openSocket = (url: string): SocketLike => new WebSocket(url) as unknown as SocketLike;

export interface DeviceLinkDeps {
  url: string;
  connect(url: string): SocketLike;
  /** `djv.controlKey` on this device's LAN origin. */
  storage: { load(): string | null; save(key: string): void; clear(): void };
  location: { hash(): string; clearHash(): void };
  events: { onVisible(fn: () => void): void; onOnline(fn: () => void): void };
  now(): number;
}

/** A control as the page sends it: the link adds the `seq`. */
export type ControlInput = Control extends infer C
  ? C extends Control
    ? Omit<C, "seq">
    : never
  : never;
export type Approval = { type: "accept" | "reject"; deviceId: string };

export interface LinkView {
  status: LinkStatus;
  text: string;
  locked: boolean;
  /** The screen's last state; shown while locked, usable only while live. */
  state: ScreenState | null;
  pending: DeviceEntry[];
  /** This device's own id, once approved. */
  deviceId: string | null;
}

export interface DeviceLink {
  start(): void;
  submitCode(raw: string): void;
  /** A control's `seq`, `true` for an approval, or null when dropped (locked). */
  send(message: ControlInput): number | null;
  send(message: Approval): true | null;
  view(): LinkView;
  roundTrip(): RoundTripReading;
  subscribe(listener: () => void): () => void;
  stop(): void;
}

const OPEN = 1;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const normalise = (raw: string) => raw.toUpperCase().replace(/\s+/g, "");

export function createDeviceLink(deps: DeviceLinkDeps): DeviceLink {
  const backoff = createBackoff();
  const trip = createRoundTrip();
  const listeners = new Set<() => void>();
  let socket: SocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let status: LinkStatus = "needs_code";
  let code: string | null = null;
  let approved = false;
  /** No reconnecting: a refusal, an ended pairing, or stopped. */
  let halted = false;
  let deviceId: string | null = null;
  let state: ScreenState | null = null;
  let pending: DeviceEntry[] = [];
  let seq = 0;

  const snapshot = (): LinkView => ({
    status,
    text: LINK_TEXT[status],
    locked: status !== "live",
    state,
    pending,
    deviceId,
  });
  // One object per change, so a React `useSyncExternalStore` sees a stable snapshot.
  let current = snapshot();
  const emit = () => {
    current = snapshot();
    listeners.forEach((l) => l());
  };
  const set = (next: LinkStatus) => {
    status = next;
    emit();
  };

  const drop = () => {
    const current = socket;
    socket = null;
    current?.close();
  };

  const end = () => {
    deps.storage.clear();
    halted = true;
    approved = false;
    drop();
    set("ended");
  };

  const onMessage = (message: ToDevice) => {
    switch (message.type) {
      case "waiting":
        return set("waiting");
      case "approved":
        deps.storage.save(message.key);
        code = null; // from now on the key reconnects
        approved = true;
        deviceId = message.deviceId;
        return set("connecting"); // locked until the state arrives (SD12)
      case "refused":
        if (message.reason === "ended") return end();
        halted = true;
        drop();
        return set(message.reason);
      case "ended":
        return end();
      case "screen":
        if (!approved) return;
        if (!message.connected) return set("screen_off");
        if (status === "screen_off") set("connecting");
        return;
      case "pending":
        pending = message.requests;
        return emit();
      case "state":
        if (!approved) return;
        state = message.state;
        return set("live");
      case "applied":
        return trip.applied(message.seq, deps.now());
    }
  };

  const connect = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (halted) return;
    approved = false;
    const ws = deps.connect(deps.url);
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      backoff.reset();
      const key = deps.storage.load();
      ws.send(JSON.stringify(code !== null ? { type: "hello", code } : { type: "hello", key }));
    };
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      const result = toDeviceSchema.safeParse(parsed);
      if (result.success) onMessage(result.data);
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      approved = false;
      if (halted) return;
      set("reconnecting");
      timer = setTimeout(connect, backoff.next());
    };
  };

  /** Online again, or visible again: try now instead of waiting out the delay. */
  const now = () => {
    if (!halted && socket === null && status === "reconnecting") connect();
  };

  function send(message: ControlInput): number | null;
  function send(message: Approval): true | null;
  function send(message: ControlInput | Approval): number | true | null {
    if (status !== "live" || socket === null || socket.readyState !== OPEN) return null;
    if (message.type === "accept" || message.type === "reject") {
      socket.send(JSON.stringify(message));
      return true;
    }
    const mine = ++seq;
    socket.send(JSON.stringify({ ...message, seq: mine }));
    trip.sent(mine, deps.now());
    return mine;
  }

  const begin = () => {
    halted = false;
    drop();
    set("connecting");
    connect();
  };

  return {
    start() {
      deps.events.onVisible(now);
      deps.events.onOnline(now);
      const match = /(?:^#|&)code=([^&]*)/.exec(deps.location.hash());
      if (match) {
        deps.location.clearHash();
        const presented = normalise(decodeURIComponent(match[1]!));
        if (!CODE_PATTERN.test(presented)) return set("wrong_code");
        code = presented;
      }
      if (code !== null || deps.storage.load() !== null) begin();
      else set("needs_code");
    },

    submitCode(raw) {
      const presented = normalise(raw);
      if (!CODE_PATTERN.test(presented)) return set("wrong_code");
      code = presented;
      begin();
    },

    send,

    view: () => current,

    roundTrip: () => trip.read(deps.now()),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    stop() {
      halted = true;
      if (timer) clearTimeout(timer);
      timer = null;
      drop();
    },
  };
}
