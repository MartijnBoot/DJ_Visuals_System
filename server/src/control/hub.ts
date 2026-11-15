// External control's hub (B-04 spec SD4, SD5, SD12, SD13, SD18, SD27; plan PD3, PD12, T5, T7):
// the screen sockets and which one is the target, the device sockets, the last state the target
// sent, and the status the panel shows. The screen page is the single source of truth: the server
// keeps its last `state` only to hand a (re)connecting controller first, and relays. The last
// screen to connect is the target; the one before gets `superseded` and nothing further (AC31).
// Logs name a device by its sequence label only, never its hint, key or anything it sent (SD27).
import {
  MAX_SCREEN_MESSAGE,
  screenMessageSchema,
  type Control,
  type ControlStatus,
  type ScreenMessage,
  type ScreenState,
  type ToDevice,
  type ToScreen,
} from "@djv/shared";
import type { WebSocket } from "ws";
import type { Logger } from "../log.ts";
import { receive, send } from "./channel.ts";
import type { DeviceHub } from "./device.ts";
import type { Lan } from "./lan.ts";
import type { Pairing } from "./pairing.ts";

export interface HubDeps {
  log: Logger;
  controlPort: number;
  now(): number;
  pairing: Pairing;
  lan: Lan;
}

export interface Hub extends DeviceHub {
  attachScreen(socket: WebSocket): void;
  /** The last state the target screen sent, or null before the first. */
  state(): ScreenState | null;
  /** Closes every socket the hub holds and the LAN listener. */
  close(): Promise<void>;
}

/** A device socket: waiting for approval, or approved. */
interface Link {
  socket: WebSocket;
  approved: boolean;
  label: string;
}

/** Close codes: the message before the close says which. */
const ENDED = 4000;
const REFUSED = 4001;

export function createHub({ log, controlPort, now, pairing, lan }: HubDeps): Hub {
  const screens = new Set<WebSocket>();
  let target: WebSocket | null = null;
  let cached: ScreenState | null = null;
  const links = new Map<string, Link>();
  let expiry: ReturnType<typeof setTimeout> | null = null;
  // Panel actions run one at a time: two quick `enable`s must not bind twice.
  let actions: Promise<unknown> = Promise.resolve();

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

  const toApproved = (message: ToDevice) => {
    for (const link of links.values()) if (link.approved) send(link.socket, message);
  };

  /** The panel's status and every approved controller's pending list (SD18). */
  const changed = () => {
    toTarget({ type: "status", status: status() });
    toApproved({ type: "pending", requests: pairing.pending() });
  };

  const labelOf = (deviceId: string) =>
    links.get(deviceId)?.label ??
    [...pairing.devices(), ...pairing.pending()].find((d) => d.deviceId === deviceId)?.label;

  /** Sends `message` and closes the device's socket. */
  const end = (deviceId: string, message: ToDevice = { type: "ended" }) => {
    const link = links.get(deviceId);
    if (!link) return;
    links.delete(deviceId);
    send(link.socket, message);
    link.socket.close(message.type === "ended" ? ENDED : REFUSED, message.type);
  };

  const refuse = (socket: WebSocket, reason: Extract<ToDevice, { type: "refused" }>["reason"]) => {
    send(socket, { type: "refused", reason });
    socket.close(REFUSED, "refused");
  };

  /** What a device receives first once approved: the full state, then the requests (SD5). */
  const welcome = (link: Link) => {
    send(
      link.socket,
      cached ? { type: "state", state: cached } : { type: "screen", connected: target !== null },
    );
    send(link.socket, { type: "pending", requests: pairing.pending() });
  };

  const scheduleExpiry = () => {
    if (expiry) clearTimeout(expiry);
    expiry = null;
    const at = pairing.nextExpiry();
    if (at === null) return;
    expiry = setTimeout(
      () => {
        expiry = null;
        const gone = pairing.expire();
        for (const deviceId of gone) {
          log.info({ device: links.get(deviceId)?.label }, "device request expired");
          end(deviceId, { type: "refused", reason: "expired" });
        }
        if (gone.length > 0) changed();
        scheduleExpiry();
      },
      Math.max(0, at - now()),
    );
  };

  const accept = (deviceId: string) => {
    const label = labelOf(deviceId);
    const result = pairing.accept(deviceId);
    if (result.kind === "approved") {
      const link = links.get(deviceId);
      log.info({ device: label }, "device accepted");
      if (link) {
        link.approved = true;
        send(link.socket, { type: "approved", key: result.key, deviceId });
        welcome(link);
      }
    } else if (result.kind === "refused") {
      log.info({ device: label, reason: result.reason }, "device refused");
      end(deviceId, { type: "refused", reason: result.reason });
    }
    scheduleExpiry();
    changed();
  };

  const reject = (deviceId: string) => {
    const label = labelOf(deviceId);
    if (pairing.reject(deviceId)) {
      log.info({ device: label }, "device rejected");
      end(deviceId, { type: "refused", reason: "rejected" });
    }
    scheduleExpiry();
    changed();
  };

  /** Ends every device the pairing let go of, by id. */
  const endAll = (deviceIds: string[]) => {
    for (const deviceId of deviceIds) end(deviceId);
    scheduleExpiry();
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
    changed();
  };

  const disable = async () => {
    if (pairing.isOn() || lan.isOn()) {
      endAll(pairing.disable());
      await lan.disable();
      log.info({ port: controlPort }, "external control off");
    }
    changed();
  };

  const newCode = () => {
    if (pairing.isOn()) {
      endAll(pairing.newCode());
      log.info("new code issued");
    }
    changed();
  };

  const disconnect = (deviceId: string) => {
    const label = labelOf(deviceId);
    if (pairing.disconnect(deviceId)) {
      log.info({ device: label }, "device disconnected");
      end(deviceId);
    }
    changed();
  };

  const onScreen = async (message: ScreenMessage) => {
    switch (message.type) {
      case "state":
        cached = message.state;
        return toApproved({ type: "state", state: message.state });
      case "applied":
        for (const { deviceId, seq } of message.entries) {
          const link = links.get(deviceId);
          if (link?.approved) send(link.socket, { type: "applied", seq });
        }
        return;
      case "enable":
        return enable();
      case "disable":
        return disable();
      case "newCode":
        return newCode();
      case "disconnect":
        return disconnect(message.deviceId);
      case "accept":
        return accept(message.deviceId);
      case "reject":
        return reject(message.deviceId);
    }
  };

  const run = (action: () => unknown) => {
    actions = actions
      .then(action)
      .catch((error: unknown) => log.error({ err: error }, "control action failed"));
  };

  return {
    attachScreen(socket) {
      screens.add(socket);
      if (target) {
        send(target, { type: "superseded" });
        log.info("screen superseded");
        // The old page's state is void, and its close may arrive after this (a reload): devices
        // lock now and unlock on the new page's state (SD12, SD13).
        toApproved({ type: "screen", connected: false });
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
          if (socket === target) run(() => onScreen(message));
        },
      });
      socket.on("close", () => {
        screens.delete(socket);
        if (socket !== target) return;
        target = null;
        cached = null;
        log.info("screen disconnected");
        toApproved({ type: "screen", connected: false });
      });
      send(socket, { type: "status", status: status() });
    },

    state: () => cached,

    request(socket, ip, code, hint) {
      const result = pairing.request(ip, code, hint);
      if (result.kind === "refused") {
        log.info({ reason: result.reason }, "device refused");
        refuse(socket, result.reason);
        return null;
      }
      const { deviceId, label } = result.device;
      links.set(deviceId, { socket, approved: false, label });
      log.info({ device: label }, "device requested");
      send(socket, { type: "waiting" });
      scheduleExpiry();
      changed();
      return deviceId;
    },

    resume(socket, ip, key) {
      const result = pairing.resume(ip, key);
      if (result.kind === "refused") {
        if (result.dropped !== undefined) {
          // A key from another IP: that approval ends (AC12).
          log.info({ device: labelOf(result.dropped) }, "device disconnected");
          end(result.dropped);
          changed();
        }
        log.info({ reason: result.reason }, "device refused");
        refuse(socket, result.reason);
        return null;
      }
      const { deviceId, label } = result.device;
      const previous = links.get(deviceId);
      if (previous && previous.socket !== socket) previous.socket.terminate();
      const link: Link = { socket, approved: true, label };
      links.set(deviceId, link);
      log.info({ device: label }, "device reconnected");
      send(socket, { type: "approved", key, deviceId });
      welcome(link);
      return deviceId;
    },

    isApproved: (deviceId, socket) => {
      const link = links.get(deviceId);
      return link?.socket === socket && link.approved && pairing.isApproved(deviceId);
    },

    control(deviceId: string, control: Control) {
      toTarget({ type: "control", deviceId, control });
    },

    accept: (deviceId) => run(() => accept(deviceId)),
    reject: (deviceId) => run(() => reject(deviceId)),

    closed(deviceId, socket) {
      const link = links.get(deviceId);
      if (link?.socket !== socket) return;
      links.delete(deviceId);
      // A request whose page went away leaves the lists; an approval stays for a reconnect.
      if (!link.approved && pairing.reject(deviceId)) {
        scheduleExpiry();
        changed();
      }
    },

    async close() {
      for (const socket of screens) socket.terminate();
      screens.clear();
      target = null;
      for (const link of links.values()) link.socket.terminate();
      links.clear();
      if (expiry) clearTimeout(expiry);
      expiry = null;
      await actions;
      pairing.disable();
      await lan.disable();
    },
  };
}
