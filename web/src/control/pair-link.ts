// The pairing link a controller and a sender share (B-04 spec SD4, SD12, SD19; B-06 SD6, SD15;
// plan PD4, T9): one socket to the External control listener, the pairing hello, the stored key,
// the reconnect backoff, the refusals and "Pairing ended". What comes after the approval belongs
// to the caller (`device-link.ts` for a controller, `send/send-link.ts` for a sender): every
// message beyond the pairing ones is handed on. Rules:
// - The code comes from `#code=` (then the fragment is cleared) or the code field; a stored key
//   reconnects without a new approval. After an approval only the key is used.
// - A dropped socket reconnects at 0.5 s doubling to 5 s, and at once when the page becomes
//   visible or the network comes back. A server that does not answer at all is retried for ever:
//   a browser cannot tell a stopped server from a Wi-Fi drop (B-04 PD4).
// - "Pairing ended" (ended, a key refused, or an approval for another role) removes the key and
//   stops trying; any other refusal stops trying until a code is entered again.
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  toDeviceSchema,
  type SendKind,
  type ToDevice,
} from "@djv/shared";
import { createBackoff } from "./backoff.ts";

/** The browser's WebSocket, as much of it as the links use. */
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

export type PairStatus =
  | "needs_code"
  | "connecting"
  | "waiting"
  | "rejected"
  | "expired"
  | "wrong_code"
  | "too_many"
  | "audio_taken"
  | "throttled"
  | "reconnecting"
  | "ended";

export interface PairLinkDeps {
  url: string;
  connect(url: string): SocketLike;
  /** The session key on this device's LAN origin (`djv.controlKey`, `djv.sendKey`). */
  storage: { load(): string | null; save(key: string): void; clear(): void };
  location: { hash(): string; clearHash(): void };
  events: { onVisible(fn: () => void): void; onOnline(fn: () => void): void };
}

/** What the link hands on: everything after the pairing messages. */
export type AfterPairing = Exclude<
  ToDevice,
  { type: "waiting" | "approved" | "refused" | "ended" }
>;

export interface PairHandlers {
  /** What this device asks to send; absent for a controller. */
  sends?: readonly SendKind[];
  /** The status changed. */
  onChange(): void;
  onMessage(message: AfterPairing): void;
  /** The pairing ended, before the status says so. */
  onEnded?(): void;
}

export interface PairLink<S extends string = never> {
  start(): void;
  submitCode(raw: string): void;
  stop(): void;
  status(): PairStatus | S;
  /** The caller's own statuses, and `connecting` again. */
  set(status: PairStatus | S): void;
  /** Approved on the open connection. */
  approved(): boolean;
  /** This device's own id, once approved. */
  deviceId(): string | null;
  /** Writes to the open socket; false when there is none. */
  send(message: object): boolean;
}

const OPEN = 1;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const normalise = (raw: string) => raw.toUpperCase().replace(/\s+/g, "");
const sameKinds = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join() === [...b].sort().join();

export function createPairLink<S extends string = never>(
  deps: PairLinkDeps,
  handlers: PairHandlers,
): PairLink<S> {
  const backoff = createBackoff();
  let socket: SocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let status: PairStatus | S = "needs_code";
  let code: string | null = null;
  /**
   * This tab's session key, held here once read or approved: storage may not keep it, and a
   * second tab on the same origin overwrites it there.
   */
  let key: string | null = null;
  let approved = false;
  /** No reconnecting: a refusal, an ended pairing, or stopped. */
  let halted = false;
  let deviceId: string | null = null;

  const set = (next: PairStatus | S) => {
    status = next;
    handlers.onChange();
  };

  const drop = () => {
    const current = socket;
    socket = null;
    current?.close();
  };

  const end = () => {
    deps.storage.clear();
    key = null;
    handlers.onEnded?.();
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
        // A key for the other role (a sender's on /control, say) is not this page's (PD4).
        if (!sameKinds(message.sends, handlers.sends ?? [])) return end();
        deps.storage.save(message.key);
        key = message.key;
        code = null; // from now on the key reconnects
        approved = true;
        deviceId = message.deviceId;
        return set("connecting");
      case "refused":
        if (message.reason === "ended") return end();
        halted = true;
        drop();
        return set(message.reason);
      case "ended":
        return end();
      default:
        return handlers.onMessage(message);
    }
  };

  const hello = () =>
    code !== null
      ? { type: "hello", code, ...(handlers.sends ? { sends: handlers.sends } : {}) }
      : { type: "hello", key };

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
      ws.send(JSON.stringify(hello()));
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
        let presented: string;
        try {
          presented = normalise(decodeURIComponent(match[1]!));
        } catch {
          return set("wrong_code"); // not valid percent-encoding
        }
        if (!CODE_PATTERN.test(presented)) return set("wrong_code");
        code = presented;
      }
      key = deps.storage.load();
      if (code !== null || key !== null) begin();
      else set("needs_code");
    },

    submitCode(raw) {
      const presented = normalise(raw);
      if (!CODE_PATTERN.test(presented)) return set("wrong_code");
      code = presented;
      begin();
    },

    stop() {
      halted = true;
      if (timer) clearTimeout(timer);
      timer = null;
      drop();
    },

    status: () => status,
    set,
    approved: () => approved,
    deviceId: () => deviceId,

    send(message) {
      if (socket === null || socket.readyState !== OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
  };
}
