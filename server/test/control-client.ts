// A `ws` client for the External control tests (B-04 T5 to T7): keeps every message it receives,
// parsed with the shared schema it is given, and waits on them. The LAN listener is HTTPS
// (B-06 T5): its clients trust the test's own root and nothing else (`ca`), so a broken chain
// fails here.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { connect as tcpConnect } from "node:net";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import type { z } from "zod";
import WebSocket from "ws";

export interface Client<T> {
  ws: WebSocket;
  messages: T[];
  /** The first message matching `pred` already received or still to come. */
  find<S extends T>(pred: (m: T) => m is S, timeoutMs?: number): Promise<S>;
  find(pred: (m: T) => boolean, timeoutMs?: number): Promise<T>;
  /** The first matching message received after this call. */
  next<S extends T>(pred: (m: T) => m is S, timeoutMs?: number): Promise<S>;
  next(pred: (m: T) => boolean, timeoutMs?: number): Promise<T>;
  send(message: unknown): void;
  closed: Promise<{ code: number; reason: string }>;
}

export interface ConnectOptions {
  origin?: string;
  headers?: Record<string, string>;
  localAddress?: string;
  /** The only CA a `wss:` connection trusts: the test's own root. */
  ca?: string | Buffer;
}

/** The root `DATA_DIR/tls/` holds once External control was switched on (PEM). */
export const testRoot = (dataDir: string): Buffer => readFileSync(join(dataDir, "tls", "root.crt"));

/**
 * A request to the LAN listener over TLS, trusting `ca` alone (B-06 T5), as a `Response`: the
 * same shape `fetch` gives the tests of the plain-HTTP listener before it.
 */
export function lanGet(
  url: string,
  ca: string | Buffer,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      { method: init.method ?? "GET", headers: init.headers ?? {}, ca, timeout: 10_000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          const status = res.statusCode ?? 0;
          const body = status === 204 || status === 304 ? null : Buffer.concat(chunks);
          resolve(new Response(body, { status, headers }));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("no answer within 10000 ms")));
    req.on("error", reject);
    req.end(init.body);
  });
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
  { origin, headers, localAddress, ca }: ConnectOptions = {},
): Promise<Client<T>> {
  const ws = new WebSocket(url, {
    ...(origin === undefined ? {} : { origin }),
    ...(ca === undefined ? {} : { ca }),
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
    find: (pred: (m: T) => boolean, timeoutMs = 5000) => wait(0, pred, timeoutMs),
    next: (pred: (m: T) => boolean, timeoutMs = 5000) => wait(messages.length, pred, timeoutMs),
    send: (message) => ws.send(typeof message === "string" ? message : JSON.stringify(message)),
  };
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(client));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

/**
 * Sends a WebSocket upgrade with a raw request target over TCP (over TLS trusting `ca` alone,
 * when given), bypassing every client's URL handling, and resolves with the first line of the
 * answer ("" if the socket closes first).
 */
export function rawUpgrade(
  host: string,
  port: number,
  target: string,
  origin: string,
  ca?: string | Buffer,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = ca === undefined ? tcpConnect({ host, port }) : tlsConnect({ host, port, ca });
    let answer = "";
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("no answer within 5000 ms"));
    });
    socket.once(ca === undefined ? "connect" : "secureConnect", () =>
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: ${host}:${port}\r\nOrigin: ${origin}\r\n` +
          "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n" +
          `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\n\r\n`,
      ),
    );
    socket.on("data", (chunk) => (answer += String(chunk)));
    socket.once("error", () => {});
    socket.once("close", () => resolve(answer.split("\r\n")[0] ?? ""));
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
