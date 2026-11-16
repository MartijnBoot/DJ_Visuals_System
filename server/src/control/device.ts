// The device socket (B-04 spec SD4, SD15, SD18, AC9 to AC12, AC17, AC34; plan T7): one per
// controller on the External control listener. Its first message must be `hello` with a code (a
// new request) or a session key (a reconnect). Until the device is approved every other message
// is dropped (AC34); once approved, its controls go to the screen and its `accept`/`reject` act
// like the panel's. `newCode` and `disconnect` are not in the device union, so they fail
// validation and are dropped with a warn (AC17). The IP the key is bound to is the socket's own
// remote address: no header is read for it (`X-Forwarded-For` included, AC12).
import {
  DEVICE_RATE_PER_SECOND,
  deviceMessageSchema,
  MAX_DEVICE_MESSAGE,
  type Control,
  type SendKind,
} from "@djv/shared";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { Logger } from "../log.ts";
import { receive } from "./channel.ts";
import { hint } from "./hint.ts";

/** What a device socket asks of the hub. */
export interface DeviceHub {
  /** A code presented: returns the new request's id, or null when refused (the hub answers). */
  request(
    socket: WebSocket,
    ip: string,
    code: string,
    hint: string,
    sends: readonly SendKind[],
  ): string | null;
  /** A key presented: returns the device's id, or null when refused (the hub answers). */
  resume(socket: WebSocket, ip: string, key: string): string | null;
  /** True while `socket` is the approved socket of `deviceId`. */
  isApproved(deviceId: string, socket: WebSocket): boolean;
  control(deviceId: string, control: Control): void;
  accept(deviceId: string): void;
  reject(deviceId: string): void;
  closed(deviceId: string, socket: WebSocket): void;
}

export interface DeviceDeps {
  hub: DeviceHub;
  log: Logger;
  now(): number;
}

/** The socket's own peer address, IPv4-mapped IPv6 written as IPv4. */
const ipOf = (request: IncomingMessage) =>
  (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");

export function attachDevice(
  socket: WebSocket,
  request: IncomingMessage,
  { hub, log, now }: DeviceDeps,
): void {
  const ip = ipOf(request);
  const deviceHint = hint(request.headers["user-agent"]);
  let greeted = false;
  let deviceId: string | null = null;

  receive(socket, {
    schema: deviceMessageSchema,
    maxBytes: MAX_DEVICE_MESSAGE,
    ratePerSecond: DEVICE_RATE_PER_SECOND,
    now,
    log,
    socket: "device",
    onMessage(message) {
      if (!greeted) {
        if (message.type !== "hello") return; // nothing before hello
        greeted = true;
        deviceId =
          message.code !== undefined
            ? hub.request(socket, ip, message.code, deviceHint, message.sends ?? [])
            : hub.resume(socket, ip, message.key!);
        return;
      }
      if (deviceId === null || !hub.isApproved(deviceId, socket)) return; // AC34
      switch (message.type) {
        case "hello":
          return;
        case "accept":
          return hub.accept(message.deviceId);
        case "reject":
          return hub.reject(message.deviceId);
        case "offer":
        case "candidate":
          // Relayed from B-06 T8 on, for senders only; until then dropped as before.
          return log.warn({ socket: "device", type: message.type }, "control message dropped");
        default:
          return hub.control(deviceId, message);
      }
    },
  });
  socket.on("close", () => {
    if (deviceId !== null) hub.closed(deviceId, socket);
  });
}
