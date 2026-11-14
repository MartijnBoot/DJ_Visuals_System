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
import type { Lan } from "./lan.ts";
import type { Pairing } from "./pairing.ts";

export interface HubDeps {
  log: Logger;
  controlPort: number;
  now(): number;
  pairing: Pairing;
  lan: Lan;
}

export interface Hub {
  attachScreen(socket: WebSocket): void;
  /** The last state the target screen sent, or null before the first. */
  state(): ScreenState | null;
  /** Closes every socket the hub holds and the LAN listener. */
  close(): Promise<void>;
}

export function createHub({ log, controlPort, now, pairing, lan }: HubDeps): Hub {
  const screens = new Set<WebSocket>();
  let target: WebSocket | null = null;
  let cached: ScreenState | null = null;

  // Panel actions run one at a time: two quick `enable`s must not bind twice.
  let actions = Promise.resolve();

  const status = (error?: ControlStatus["error"]): ControlStatus => ({
    on: pairing.isOn(),
    addresses: lan.addresses(),
    port: controlPort,
    code: pairing.code(),
    devices: pairing.devices(),
    pending: pairing.pending(),
    ...(error ? { error } : {}),
  });

  const toTarget = (message: ToScreen) => {
    if (target) send(target, message);
  };

  const enable = async () => {
    if (!pairing.isOn()) {
      const result = await lan.enable();
      if (!result.ok) return toTarget({ type: "status", status: status(result.error) });
      pairing.enable();
      log.info(
        { addresses: result.addresses.map((a) => a.address), port: controlPort },
        "external control on",
      );
    }
    toTarget({ type: "status", status: status() });
  };

  const disable = async () => {
    if (pairing.isOn() || lan.isOn()) {
      pairing.disable();
      await lan.disable();
      log.info({ port: controlPort }, "external control off");
    }
    toTarget({ type: "status", status: status() });
  };

  const newCode = () => {
    if (pairing.isOn()) {
      pairing.newCode();
      log.info("new code issued");
    }
    toTarget({ type: "status", status: status() });
  };

  const onScreen = async (message: ScreenMessage) => {
    switch (message.type) {
      case "state":
        cached = message.state;
        return;
      case "enable":
        return enable();
      case "disable":
        return disable();
      case "newCode":
        return newCode();
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
          if (socket !== target) return;
          actions = actions
            .then(() => onScreen(message))
            .catch((error: unknown) => log.error({ err: error }, "control action failed"));
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
    async close() {
      for (const socket of screens) socket.terminate();
      screens.clear();
      target = null;
      await actions;
      pairing.disable();
      await lan.disable();
    },
  };
}
