// A `ws` client for the External control tests (B-04 T5 to T7): keeps every message it receives,
// parsed with the shared schema it is given, and waits on them.
import { connect as tcpConnect } from "node:net";
import type { z } from "zod";
import WebSocket from "ws";

export interface Client<T> {
  ws: WebSocket;
  messages: T[];
  /** The first message matching `pred` already received or still to come. */
  find(pred: (m: T) => boolean, timeoutMs?: number): Promise<T>;
  /** The first matching message received after this call. */
  next(pred: (m: T) => boolean, timeoutMs?: number): Promise<T>;
  send(message: unknown): void;
  closed: Promise<{ code: number; reason: string }>;
}

export interface ConnectOptions {
  origin?: string;
  headers?: Record<string, string>;
  localAddress?: string;
}

const opened = new Set<WebSocket>();

/** Terminates every socket a test opened; call from `afterEach`. */
export function closeAll(): void {
  for (const ws of opened) {
    ws.on("error", () => {}); // a refused socket reports its own closing as an error
    ws.terminate();
  }
  opened.clear();
}

export function connect<T>(
  url: string,
  schema: z.ZodType<T>,
  { origin, headers, localAddress }: ConnectOptions = {},
): Promise<Client<T>> {
  const ws = new WebSocket(url, {
    ...(origin === undefined ? {} : { origin }),
    ...(headers ? { headers } : {}),
    ...(localAddress ? { localAddress } : {}),
  });
  opened.add(ws);
  const messages: T[] = [];
  const waiters = new Set<() => void>();
  ws.on("message", (data) => {
    messages.push(schema.parse(JSON.parse(String(data))));
    for (const w of waiters) w();
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.once("close", (code, reason) => resolve({ code, reason: String(reason) })),
  );
  const wait = (from: number, pred: (m: T) => boolean, timeoutMs: number) =>
    new Promise<T>((resolve, reject) => {
      const check = () => {
        const found = messages.slice(from).find(pred);
        if (found === undefined) return;
        waiters.delete(check);
        clearTimeout(timer);
        resolve(found);
      };
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(new Error(`no matching message within ${timeoutMs} ms`));
      }, timeoutMs);
      waiters.add(check);
      check();
    });
  const client: Client<T> = {
    ws,
    messages,
    closed,
    find: (pred, timeoutMs = 5000) => wait(0, pred, timeoutMs),
    next: (pred, timeoutMs = 5000) => wait(messages.length, pred, timeoutMs),
    send: (message) => ws.send(typeof message === "string" ? message : JSON.stringify(message)),
  };
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(client));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

/** True when nothing accepts a TCP connection on `host:port`. */
export function refused(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tcpConnect({ host, port });
    socket.setTimeout(10_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(true));
  });
}
