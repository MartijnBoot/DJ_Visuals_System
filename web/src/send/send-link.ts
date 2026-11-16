// The sender's link (B-06 spec SD6, SD12, SD15, SD17, SD18, AC13, AC25, AC26, AC32; plan PD3,
// PD7, T17): the pairing link (`control/pair-link.ts`, as a controller has it) with what it sends
// in the hello, and on top of it the sender's peer connection (`peer.ts`). After the approval it
// offers whenever the target screen is connected, closes the connection and keeps its capture
// while the screen is gone ("Screen reconnecting…", SD18), pauses and resumes on the screen's
// `stream`, and stops its capture when the pairing ends ("Pairing ended — scan the code again").
// The page shows one line per thing sent (PD3): video "On screen" or "Standing by", audio
// "Sending audio" or "Standing by".
import type { SendKind } from "@djv/shared";
import { LINK_TEXT } from "../control/device-link.ts";
import { createPairLink, type AfterPairing, type PairLinkDeps } from "../control/pair-link.ts";
import { createSenderPeer, type SenderPeerDeps } from "./peer.ts";

export type SendStatus = keyof typeof LINK_TEXT;

/** The link line (spec UI, "Sender"); the pairing states B-04 already words keep B-04's words. */
export const SEND_TEXT: Readonly<Record<SendStatus, string>> = {
  ...LINK_TEXT,
  screen_off: "Screen reconnecting…",
  live: "Connected",
};

/** AC13, SD10. */
export const UNREACHABLE_TEXT =
  "Could not reach the screen machine — the network may block devices from talking to each other";

export interface SendLinkDeps extends PairLinkDeps, Pick<SenderPeerDeps, "createPeer"> {
  sends: readonly SendKind[];
  /** The capture, opened before the request (SD14); stopped when the pairing ends. */
  tracks: readonly MediaStreamTrack[];
  stream: MediaStream;
}

export interface SendView {
  status: SendStatus;
  /** The link line: the status's words, or AC13's message. */
  text: string;
  /** One line per thing sent while connected to the screen (PD3); empty otherwise. */
  lines: Partial<Record<SendKind, string>>;
  unreachable: boolean;
}

export interface SendLink {
  start(): void;
  submitCode(raw: string): void;
  view(): SendView;
  subscribe(listener: () => void): () => void;
  /** Ends everything this page holds: the socket, the connection and the capture. */
  stop(): void;
}

export function createSendLink(deps: SendLinkDeps): SendLink {
  const listeners = new Set<() => void>();
  let screen = false;

  const snapshot = (): SendView => {
    const status = link.status();
    const unreachable = status === "live" && peer.state() === "unreachable";
    const lines: Partial<Record<SendKind, string>> = {};
    if (status === "live" && !unreachable) {
      const on = peer.active();
      for (const kind of deps.sends) {
        lines[kind] = !on ? "Standing by" : kind === "video" ? "On screen" : "Sending audio";
      }
    }
    return { status, text: unreachable ? UNREACHABLE_TEXT : SEND_TEXT[status], lines, unreachable };
  };
  let current: SendView | null = null;
  const emit = () => {
    current = snapshot();
    listeners.forEach((l) => l());
  };

  const peer = createSenderPeer({
    tracks: deps.tracks,
    stream: deps.stream,
    ...(deps.createPeer ? { createPeer: deps.createPeer } : {}),
    send: (message) => void link.send(message),
    onChange: emit,
  });

  const onMessage = (message: AfterPairing) => {
    switch (message.type) {
      case "screen":
        if (!link.approved()) return;
        screen = message.connected;
        if (message.connected) {
          peer.connect();
          return link.set("live");
        }
        peer.close();
        return link.set("screen_off");
      case "answer":
        return void peer.answer(message.sdp);
      case "candidate":
        return void peer.candidate({
          candidate: message.candidate,
          sdpMid: message.sdpMid,
          sdpMLineIndex: message.sdpMLineIndex,
        });
      case "stream":
        if (screen) void peer.setActive(message.active);
        return;
      default:
        return; // a controller's messages are never sent to a sender
    }
  };

  const link = createPairLink<"screen_off" | "live">(deps, {
    sends: deps.sends,
    onChange: () => {
      // Any refusal or an ended pairing stops the capture; a reconnect keeps it (SD18).
      const status = link.status();
      if (status !== "live" && status !== "screen_off") screen = false;
      if (status === "reconnecting") peer.close();
      else if (!["connecting", "waiting", "live", "screen_off", "needs_code"].includes(status)) {
        peer.end();
      }
      emit();
    },
    onMessage,
  });

  return {
    start: () => link.start(),
    submitCode: (raw) => link.submitCode(raw),
    view: () => (current ??= snapshot()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      link.stop();
      peer.end();
    },
  };
}
