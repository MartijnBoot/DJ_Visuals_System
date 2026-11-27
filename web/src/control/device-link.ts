// The controller's link (B-04 spec SD4, SD5, SD12, SD17, SD19, AC10, AC11, AC27, AC28; plan PD4,
// PD14): the pairing link (`pair-link.ts`: hello, key, backoff, refusals, "Pairing ended") and,
// on top of it, what only a controller has — the link state shown on one line, the lock, the
// screen's state, the pending requests, `seq` and the round trip. Every browser API enters
// through `DeviceLinkDeps`, so it is tested without a browser. Rules beyond the pairing link's:
// - The controls are locked until the screen's state has arrived on this connection; a control
//   sent while locked is dropped, never queued (SD12).
import type { Control, DeviceEntry, DeviceMessage, ScreenState, ToDevice } from "@djv/shared";
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

/**
 * The status bar's colour group for each link state (B-19 spec SD4; plan PD10): live is ok; needs
 * action or in progress is attention; ended or refused is stop. The colour is a second signal,
 * never the only one: the text is always shown.
 */
export const LINK_GROUP: Readonly<Record<LinkStatus, "ok" | "attention" | "stop">> = {
  live: "ok",
  needs_code: "attention",
  connecting: "attention",
  waiting: "attention",
  reconnecting: "attention",
  screen_off: "attention",
  rejected: "stop",
  expired: "stop",
  wrong_code: "stop",
  too_many: "stop",
  audio_taken: "stop",
  throttled: "stop",
  ended: "stop",
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
/** B-07 PD1: the preview's messages, out (no `seq`, no acknowledgement) and in. */
export type PreviewOut = Extract<
  DeviceMessage,
  { type: "previewStream" | "previewAnswer" | "previewCandidate" }
>;
export type PreviewIn = Extract<ToDevice, { type: "previewOffer" | "previewCandidate" }>;

export interface LinkView {
  status: LinkStatus;
  text: string;
  locked: boolean;
  /** The screen's last state; shown while locked, usable only while live. */
  state: ScreenState | null;
  pending: DeviceEntry[];
  /** This device's own id, once approved. */
  deviceId: string | null;
  /** B-07 PD15: this controller holds the preview stream. */
  previewHolder: boolean;
}

export interface DeviceLink {
  start(): void;
  submitCode(raw: string): void;
  /** A control's `seq`, `true` for an approval, or null when dropped (locked). */
  send(message: ControlInput): number | null;
  send(message: Approval): true | null;
  /** B-07 PD14: a preview message on the socket; false while locked. */
  preview(message: PreviewOut): boolean;
  /** B-07 PD14: the screen's offer and candidates; one listener. */
  onPreview(listener: ((message: PreviewIn) => void) | null): void;
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
  let previewHolder = false;
  let onPreview: ((message: PreviewIn) => void) | null = null;

  const snapshot = (): LinkView => {
    const status = link.status();
    return {
      status,
      text: LINK_TEXT[status],
      locked: status !== "live",
      state,
      pending,
      deviceId: link.deviceId(),
      previewHolder,
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
      case "preview":
        previewHolder = message.holder;
        return emit();
      case "previewOffer":
      case "previewCandidate":
        return onPreview?.(message);
      default:
        return; // a sender's messages are never sent to a controller
    }
  };

  const link = createPairLink<"screen_off" | "live">(deps, {
    onChange: () => {
      if (link.status() !== "live") previewHolder = false; // the hub tells it again on a welcome
      emit();
    },
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
    preview: (message) => link.status() === "live" && link.send(message),
    onPreview: (listener) => void (onPreview = listener),
    view: () => (current ??= snapshot()),
    roundTrip: () => trip.read(deps.now()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => link.stop(),
  };
}
