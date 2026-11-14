// What every received control message goes through before anything acts on it (B-04 spec SD20,
// SD27, AC33; plan PD3): the socket's rate limit, its size limit, JSON, the shared schema. A
// message that fails is dropped with one `warn` naming its type (or "unparseable") and the socket
// stays open; the excess beyond the rate is dropped quietly, so a flood cannot flood the log
// either. An accepted message is logged at `debug`, type only — never a value.
import { typeOf } from "@djv/shared";
import type { z } from "zod";

export type SocketKind = "screen" | "device";

export interface ChannelLog {
  warn(fields: { socket: SocketKind; type: string }, message: string): void;
  debug(fields: { socket: SocketKind; type: string }, message: string): void;
}

export interface Receiver<T> {
  schema: z.ZodType<T>;
  maxBytes: number;
  /** Messages per sliding second; null for none (the screen socket, PD3). */
  ratePerSecond: number | null;
  now(): number;
  log: ChannelLog;
  socket: SocketKind;
  onMessage(message: T): void;
}

/** What `ws` hands a message listener: a Buffer, or fragments, or an ArrayBuffer. */
type RawData = Buffer | ArrayBuffer | Buffer[];

const toBuffer = (data: RawData): Buffer =>
  Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);

export function receive<T>(
  socket: { on(event: "message", listener: (data: RawData, isBinary: boolean) => void): unknown },
  r: Receiver<T>,
): void {
  const recent: number[] = [];
  socket.on("message", (data, isBinary) => {
    if (r.ratePerSecond !== null) {
      const at = r.now();
      while (recent.length > 0 && at - recent[0]! >= 1000) recent.shift();
      if (recent.length >= r.ratePerSecond) return;
      recent.push(at);
    }
    const bytes = toBuffer(data);
    const text = isBinary ? null : bytes.toString("utf8");
    const drop = () =>
      r.log.warn(
        { socket: r.socket, type: text === null ? "unparseable" : typeOf(text) },
        "control message dropped",
      );
    if (text === null || bytes.length > r.maxBytes) return drop();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return drop();
    }
    const result = r.schema.safeParse(parsed);
    if (!result.success) return drop();
    r.log.debug({ socket: r.socket, type: typeOf(text) }, "control message");
    r.onMessage(result.data);
  });
}

/** Sends `message` as JSON when the socket is open; a closing socket is skipped. */
export function send(
  socket: { readyState: number; send(data: string): void },
  message: unknown,
): void {
  if (socket.readyState === OPEN) socket.send(JSON.stringify(message));
}

/** `WebSocket.OPEN` in `ws` and in browsers. */
const OPEN = 1;
