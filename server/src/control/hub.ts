// External control's hub (B-04 spec SD5, SD13, SD27; plan PD3, PD12, T5): the screen sockets,
// which one is the target, the last state it sent, and the status the panel shows. The screen
// page is the single source of truth: the server keeps its last `state` only to hand a
// (re)connecting controller, and relays. The last screen to connect is the target; the one
// before gets `superseded` and nothing further (AC31).
import {
  MAX_SCREEN_MESSAGE,
  screenMessageSchema,
  type ControlStatus,
  type ScreenMessage,
  type ScreenState,
  type ToScreen,
} from "@djv/shared";
import type { WebSocket } from "ws";
import type { Logger } from "../log.ts";
import { receive, send } from "./channel.ts";

export interface HubDeps {
  log: Logger;
  controlPort: number;
  now(): number;
}

export interface Hub {
  attachScreen(socket: WebSocket): void;
  /** The last state the target screen sent, or null before the first. */
  state(): ScreenState | null;
  /** Closes every socket the hub holds. */
  close(): void;
}

export function createHub({ log, controlPort, now }: HubDeps): Hub {
  const screens = new Set<WebSocket>();
  let target: WebSocket | null = null;
  let cached: ScreenState | null = null;

  const status = (extra: Partial<ControlStatus> = {}): ControlStatus => ({
    on: false,
    addresses: [],
    port: controlPort,
    code: null,
    devices: [],
    pending: [],
    ...extra,
  });

  const toTarget = (message: ToScreen) => {
    if (target) send(target, message);
  };

  const onScreen = (message: ScreenMessage) => {
    switch (message.type) {
      case "state":
        cached = message.state;
        return;
      case "enable":
        // T6 brings the LAN listener; until then switching on is unavailable.
        toTarget({ type: "status", status: status({ error: "unavailable" }) });
        return;
      default:
        return;
    }
  };

  return {
    attachScreen(socket) {
      screens.add(socket);
      if (target) {
        send(target, { type: "superseded" });
        log.info("screen superseded");
      }
      target = socket;
      cached = null; // a new page sends its own state; the old one is no longer true (SD13)
      log.info("screen connected");
      receive(socket, {
        schema: screenMessageSchema,
        maxBytes: MAX_SCREEN_MESSAGE,
        ratePerSecond: null,
        now,
        log,
        socket: "screen",
        onMessage: (message) => {
          if (socket === target) onScreen(message);
        },
      });
      socket.on("close", () => {
        screens.delete(socket);
        if (socket === target) {
          target = null;
          cached = null;
          log.info("screen disconnected");
        }
      });
      send(socket, { type: "status", status: status() });
    },
    state: () => cached,
    close() {
      for (const socket of screens) socket.terminate();
      screens.clear();
      target = null;
    },
  };
}
