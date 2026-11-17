// A stand-in between a local install and the cloud (B-12 T9, T10): it forwards, or drops the
// connection, holds the request unanswered, or answers a status of its own. `passFor(n)` lets
// the next n requests through and then switches to the mode given. Every request it sees is
// recorded as "METHOD /path", so a test can tell that nothing was asked (AC9, AC19).
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";

export type ProxyMode =
  { kind: "pass" } | { kind: "drop" } | { kind: "hold" } | { kind: "status"; status: number };

export interface CloudProxy {
  url: string;
  /** Every request seen, "METHOD /path", in order. */
  requests: string[];
  mode: ProxyMode;
  /** The next `count` requests pass; after them, `then`. */
  passFor(count: number, then: ProxyMode): void;
  /** Points the proxy at a cloud (it may start before the cloud does). */
  target: string;
  close(): Promise<void>;
}

export async function startCloudProxy(target = ""): Promise<CloudProxy> {
  let passes = 0;
  let after: ProxyMode = { kind: "pass" };
  const held = new Set<IncomingMessage>();
  const proxy = {
    requests: [] as string[],
    mode: { kind: "pass" } as ProxyMode,
    target,
    passFor(count: number, then: ProxyMode) {
      passes = count;
      after = then;
      proxy.mode = { kind: "pass" };
    },
  };

  const server: Server = createServer((req, res) => {
    proxy.requests.push(`${req.method} ${new URL(req.url ?? "/", "http://x").pathname}`);
    let mode = proxy.mode;
    if (passes > 0) {
      passes -= 1;
      mode = { kind: "pass" };
      if (passes === 0) proxy.mode = after;
    }
    if (mode.kind === "drop") {
      req.socket.destroy();
      return;
    }
    if (mode.kind === "hold") {
      held.add(req);
      req.on("close", () => held.delete(req));
      return;
    }
    if (mode.kind === "status") {
      res.statusCode = mode.status;
      res.end(JSON.stringify({ error: "stand-in" }));
      return;
    }
    const to = new URL(req.url ?? "/", proxy.target);
    const forward = httpRequest(
      to,
      { method: req.method, headers: { ...req.headers, host: to.host } },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    forward.on("error", () => req.socket.destroy());
    req.pipe(forward);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return Object.assign(proxy, {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        for (const req of held) req.socket.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
}
