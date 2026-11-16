// The controller's link (B-04 spec SD4, SD5, SD12, SD17, SD19, AC10, AC11, AC27, AC28; plan PD4,
// PD14): the pairing link (`pair-link.ts`: hello, key, backoff, refusals, "Pairing ended") and,
// on top of it, what only a controller has — the link state shown on one line, the lock, the
// screen's state, the pending requests, `seq` and the round trip. Every browser API enters
// through `DeviceLinkDeps`, so it is tested without a browser. Rules beyond the pairing link's:
// - The controls are locked until the screen's state has arrived on this connection; a control
//   sent while locked is dropped, never queued (SD12).
import type { Control, DeviceEntry, ScreenState } from "@djv/shared";
import {
  createPairLink,
  type AfterPairing,
  type PairLinkDeps,
  type PairStatus,
} from "./pair-link.ts";
import { createRoundTrip, type RoundTripReading } from "./round-trip.ts";

export { openSocket, type SocketLike } from "./pair-link.ts";

export type LinkStatus = PairStatus | "screen_off" | "live";

/** The link line (spec UI, "/control, link states"). */
export const LINK_TEXT: Readonly<Record<LinkStatus, string>> = {
  needs_code: "Scan the code on the screen machine",
  connecting: "Connecting…",
  waiting: "Waiting for approval",
  rejected: "Request rejected",
  expired: "Request expired — try again",
  wrong_code: "Wrong code",
  too_many: "Too many devices",
  audio_taken: "Another device is sending audio",
  throttled: "Too many wrong codes — try again in a minute",
  reconnecting: "Reconnecting…",
  screen_off: "Screen not connected",
  ended: "Pairing ended — scan the code again",
  live: "Connected",
};

export interface DeviceLinkDeps extends PairLinkDeps {
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

export function createDeviceLink(deps: DeviceLinkDeps): DeviceLink {
  const trip = createRoundTrip();
  const listeners = new Set<() => void>();
  let state: ScreenState | null = null;
  let pending: DeviceEntry[] = [];
  let seq = 0;

  const snapshot = (): LinkView => {
    const status = link.status();
    return {
      status,
      text: LINK_TEXT[status],
      locked: status !== "live",
      state,
      pending,
      deviceId: link.deviceId(),
    };
  };
  // One object per change, so a React `useSyncExternalStore` sees a stable snapshot.
  let current: LinkView | null = null;
  const emit = () => {
    current = snapshot();
    listeners.forEach((l) => l());
  };

  const onMessage = (message: AfterPairing) => {
    switch (message.type) {
      case "screen":
        if (!link.approved()) return;
        if (!message.connected) return link.set("screen_off");
        if (link.status() === "screen_off") link.set("connecting");
        return;
      case "pending":
        pending = message.requests;
        return emit();
      case "state":
        if (!link.approved()) return;
        state = message.state;
        return link.set("live");
      case "applied":
        return trip.applied(message.seq, deps.now());
      default:
        return; // a sender's messages are never sent to a controller
    }
  };

  const link = createPairLink<"screen_off" | "live">(deps, {
    onChange: emit,
    onMessage,
    onEnded: () => void (pending = []),
  });

  function send(message: ControlInput): number | null;
  function send(message: Approval): true | null;
  function send(message: ControlInput | Approval): number | true | null {
    if (link.status() !== "live") return null;
    if (message.type === "accept" || message.type === "reject") {
      return link.send(message) ? true : null;
    }
    const mine = seq + 1;
    if (!link.send({ ...message, seq: mine })) return null;
    seq = mine;
    trip.sent(mine, deps.now());
    return mine;
  }

  return {
    start: () => link.start(),
    submitCode: (raw) => link.submitCode(raw),
    send,
    view: () => (current ??= snapshot()),
    roundTrip: () => trip.read(deps.now()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => link.stop(),
  };
}
