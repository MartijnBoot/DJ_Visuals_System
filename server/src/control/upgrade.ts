// WebSocket upgrade routing (B-04 spec SD16, SD25, AC16; plan PD1): `ws` in `noServer` mode
// behind a listener's own `upgrade` event, routed by path and checked by `Origin`. A path no route
// names is 404 and a foreign or missing `Origin` is 403, both before any handshake; everything
// after the handshake (framing, masking, ping, close) is `ws`'s. WebSockets are not covered by
// CORS, so without the Origin check any page open in the browser could talk to these sockets.
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

export interface UpgradeRoute {
  path: string;
  /** The `Origin` values this route accepts, exactly. */
  origins(request: IncomingMessage): readonly string[];
  /** `noServer` mode, with the route's own `maxPayload`. */
  wss: WebSocketServer;
  onConnection(socket: WebSocket, request: IncomingMessage): void;
}

const refuse = (socket: Duplex, status: 403 | 404) => {
  const text = status === 403 ? "Forbidden" : "Not Found";
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
};

/** A `noServer` socket server: the upgrade listener below hands it the sockets it accepts. */
export const socketServer = (maxPayload: number) =>
  new WebSocketServer({ noServer: true, maxPayload });

export function routeUpgrades(server: Server, routes: readonly UpgradeRoute[]): void {
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    // A request target Node's parser accepts can still fail URL parsing; thrown here it would
    // escape the listener and end the process, so it is a path no route names.
    const path = URL.parse(request.url ?? "/", "http://upgrade.invalid")?.pathname;
    const route = routes.find((r) => r.path === path);
    if (!route) return refuse(socket, 404);
    const origin = request.headers.origin;
    if (origin === undefined || !route.origins(request).includes(origin)) {
      return refuse(socket, 403);
    }
    route.wss.handleUpgrade(request, socket, head, (ws) => route.onConnection(ws, request));
  });
}
