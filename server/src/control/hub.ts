// External control's hub (B-04 spec SD4, SD5, SD12, SD13, SD18, SD27; plan PD3, PD12, T5, T7):
// the screen sockets and which one is the target, the device sockets, the last state the target
// sent, and the status the panel shows. The screen page is the single source of truth: the server
// keeps its last `state` only to hand a (re)connecting controller first, and relays. The last
// screen to connect is the target; the one before gets `superseded` and nothing further (AC31).
// Logs name a device by its sequence label only, never its hint, key or anything it sent (SD27);
// a sender's lines also name its role (B-06 SD25) and say "sender" where a controller's say
// "device". Approved senders are listed apart, with whether their socket is open (B-06 PD5).
// B-07 (T11, SD13, SD15, PD15): one controller at a time holds the preview stream. The hub keeps
// which, tells each controller whether it is the one and the screen which it is, relays the
// screen's setup to the holder only and the holder's setup to the screen only, and clears the
// holder whenever its socket, its approval or the screen goes away.
import {
  screenMessageSchema,
  type Control,
  type ControlStatus,
  type SceneRequest,
  type ScreenMessage,
  type ScreenState,
  type SendKind,
  type ToDevice,
  type ToScreen,
} from "@djv/shared";
import type { WebSocket } from "ws";
import type { Logger } from "../log.ts";
import type { SceneStore } from "../scenes/store.ts";
import { receive, screenMaxBytes, send } from "./channel.ts";
import type { DeviceHub } from "./device.ts";
import type { Lan } from "./lan.ts";
import type { Pairing } from "./pairing.ts";
import { createSceneRequests, type SceneRequests } from "./scenes.ts";

export interface HubDeps {
  log: Logger;
  controlPort: number;
  now(): number;
  pairing: Pairing;
  lan: Lan;
  /**
   * B-12 SD2, PD19: called when the target screen's `started` changes — a state message, a new
   * screen attaching (not running until it says so) or the target's close. Sync pauses on it.
   */
  onRunning?(running: boolean): void;
  /** B-07 PD10: the local install's scene store; the target screen's `scenes.*` go to it. */
  scenes?: SceneStore;
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
  /** What it sends; empty for a controller (B-06). */
  sends: readonly SendKind[];
}

/** Close codes: the message before the close says which. */
const ENDED = 4000;
const REFUSED = 4001;
/** `WebSocket.OPEN`. */
const OPEN = 1;

export function createHub({
  log,
  controlPort,
  now,
  pairing,
  lan,
  onRunning,
  scenes: sceneStore,
}: HubDeps): Hub {
  const scenes = sceneStore ? createSceneRequests(sceneStore, log) : null;
  const screens = new Set<WebSocket>();
  let target: WebSocket | null = null;
  /** B-07 PD15: the controller holding the preview stream. */
  let previewHolder: string | null = null;
  let cached: ScreenState | null = null;
  let running = false;
  /** Every change of the cached state goes through here, so `onRunning` hears each edge. */
  const setCached = (next: ScreenState | null) => {
    cached = next;
    if ((next?.started === true) !== running) {
      running = !running;
      onRunning?.(running);
    }
  };
  const links = new Map<string, Link>();
  let expiry: ReturnType<typeof setTimeout> | null = null;
  // Panel actions run one at a time: two quick `enable`s must not bind twice.
  let actions: Promise<unknown> = Promise.resolve();

  const online = (deviceId: string) => {
    const link = links.get(deviceId);
    return link !== undefined && link.approved && link.socket.readyState === OPEN;
  };

  const status = (error?: ControlStatus["error"]): ControlStatus => ({
    on: pairing.isOn(),
    addresses: lan.addresses(),
    port: controlPort,
    code: pairing.code(),
    devices: pairing.devices(),
    pending: pairing.pending(),
    senders: pairing.senders().map((entry) => ({ ...entry, online: online(entry.deviceId) })),
    fingerprint: lan.fingerprint(),
    ...(error ? { error } : {}),
  });

  const toTarget = (message: ToScreen) => {
    if (target) send(target, message);
  };

  const toApproved = (message: ToDevice) => {
    for (const link of links.values()) if (link.approved) send(link.socket, message);
  };
  /** The state and the requests reach controllers only: a sender receives neither (B-06 SD6). */
  const toControllers = (message: ToDevice) => {
    for (const link of links.values()) {
      if (link.approved && link.sends.length === 0) send(link.socket, message);
    }
  };
  const toSenders = (message: ToDevice) => {
    for (const link of links.values()) {
      if (link.approved && link.sends.length > 0) send(link.socket, message);
    }
  };

  /** The panel's status and every approved controller's pending list (SD18). */
  const changed = () => {
    toTarget({ type: "status", status: status() });
    toControllers({ type: "pending", requests: pairing.pending() });
  };

  const entryOf = (deviceId: string) =>
    [...pairing.devices(), ...pairing.senders(), ...pairing.pending()].find(
      (d) => d.deviceId === deviceId,
    );
  const labelOf = (deviceId: string) => links.get(deviceId)?.label ?? entryOf(deviceId)?.label;
  const sendsOf = (deviceId: string) => links.get(deviceId)?.sends ?? entryOf(deviceId)?.sends;

  /** One info line about a device: "sender <event>" with its role, or "device <event>". */
  const note = (
    label: string | undefined,
    sends: readonly SendKind[] | undefined,
    event: string,
  ) =>
    sends && sends.length > 0
      ? log.info({ device: label, sends: [...sends] }, `sender ${event}`)
      : log.info({ device: label }, `device ${event}`);

  /**
   * B-07 PD15: no one holds the preview any more. The screen hears it (it stops the stream), and
   * the old holder too unless its socket is going away.
   */
  const clearHolder = (tellHolder: boolean) => {
    const old = previewHolder;
    if (old === null) return;
    previewHolder = null;
    log.info({ device: labelOf(old) }, "preview stream ended");
    const link = links.get(old);
    if (tellHolder && link) send(link.socket, { type: "preview", holder: false });
    toTarget({ type: "preview", deviceId: null });
  };

  /** B-07 PD15: `deviceId` asks to watch (taking over) or to stop. */
  const watch = (deviceId: string, watching: boolean) => {
    const link = links.get(deviceId);
    if (!link) return;
    if (!watching) {
      if (previewHolder === deviceId) clearHolder(true);
      return;
    }
    if (previewHolder !== deviceId) {
      if (previewHolder !== null) {
        log.info({ device: labelOf(previewHolder) }, "preview stream ended");
        const old = links.get(previewHolder);
        if (old) send(old.socket, { type: "preview", holder: false });
      }
      previewHolder = deviceId;
      log.info({ device: link.label }, "preview stream opened");
    }
    // A repeated ask is answered again, so the screen may start the stream afresh.
    send(link.socket, { type: "preview", holder: true });
    toTarget({ type: "preview", deviceId });
  };

  /** Sends `message` and closes the device's socket. */
  const end = (deviceId: string, message: ToDevice = { type: "ended" }) => {
    const link = links.get(deviceId);
    if (!link) return;
    if (previewHolder === deviceId) clearHolder(false);
    links.delete(deviceId);
    send(link.socket, message);
    link.socket.close(message.type === "ended" ? ENDED : REFUSED, message.type);
  };

  const refuse = (socket: WebSocket, reason: Extract<ToDevice, { type: "refused" }>["reason"]) => {
    send(socket, { type: "refused", reason });
    socket.close(REFUSED, "refused");
  };

  /**
   * What a device receives first once approved: a controller the full state, then the requests
   * (SD5); a sender only whether the target screen is there (B-06 SD16), to offer to it.
   */
  const welcome = (deviceId: string, link: Link) => {
    if (link.sends.length > 0) {
      send(link.socket, { type: "screen", connected: target !== null });
      return;
    }
    send(
      link.socket,
      cached ? { type: "state", state: cached } : { type: "screen", connected: target !== null },
    );
    send(link.socket, { type: "pending", requests: pairing.pending() });
    send(link.socket, { type: "preview", holder: previewHolder === deviceId });
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
          const link = links.get(deviceId);
          note(link?.label, link?.sends, "request expired");
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
    const sends = sendsOf(deviceId);
    const result = pairing.accept(deviceId);
    if (result.kind === "approved") {
      const link = links.get(deviceId);
      note(label, sends, "accepted");
      if (link) {
        link.approved = true;
        send(link.socket, {
          type: "approved",
          key: result.key,
          deviceId,
          sends: result.device.sends,
        });
        welcome(deviceId, link);
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
    const sends = sendsOf(deviceId);
    if (pairing.reject(deviceId)) {
      note(label, sends, "rejected");
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
    const sends = sendsOf(deviceId);
    if (pairing.disconnect(deviceId)) {
      note(label, sends, "disconnected");
      end(deviceId);
    }
    changed();
  };

  const onScreen = async (message: ScreenMessage) => {
    switch (message.type) {
      case "state":
        setCached(message.state);
        return toControllers({ type: "state", state: message.state });
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
      case "answer":
      case "candidate":
      case "stream": {
        // To that approved sender only, without the id (B-06 SD16); anyone else hears nothing.
        const link = links.get(message.deviceId);
        if (!link?.approved || link.sends.length === 0) return;
        if (message.type === "answer")
          return send(link.socket, { type: "answer", sdp: message.sdp });
        if (message.type === "stream") {
          return send(link.socket, { type: "stream", kind: message.kind, active: message.active });
        }
        const { candidate, sdpMid, sdpMLineIndex } = message;
        return send(link.socket, { type: "candidate", candidate, sdpMid, sdpMLineIndex });
      }
      case "previewOffer":
      case "previewCandidate": {
        // B-07 PD15: to the holder only, without the id. One in flight across a takeover is
        // normal, so a stray is a debug line, not a warning.
        const link = message.deviceId === previewHolder ? links.get(message.deviceId) : undefined;
        if (!link) return log.debug({ type: message.type }, "preview setup dropped");
        if (message.type === "previewOffer") {
          return send(link.socket, { type: "previewOffer", sdp: message.sdp });
        }
        const { candidate, sdpMid, sdpMLineIndex } = message;
        return send(link.socket, { type: "previewCandidate", candidate, sdpMid, sdpMLineIndex });
      }
    }
  };

  const isSceneRequest = (message: ScreenMessage): message is SceneRequest =>
    message.type.startsWith("scenes.");

  /**
   * A store error (a busy or read-only database) must not escape the socket's listener, which
   * would end the process mid-set: the screen hears "unavailable" and the log names the type
   * only, since an error's text may quote a scene (SD20).
   */
  const answerScene = (requests: SceneRequests, message: SceneRequest): ToScreen => {
    try {
      return requests.answer(message);
    } catch {
      log.error({ type: message.type }, "scene request failed");
      return { type: "scenes.result", requestId: message.requestId, ok: false };
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
        clearHolder(true); // the stream was the old page's (PD15)
        // The old page's state is void, and its close may arrive after this (a reload): devices
        // lock now and unlock on the new page's state (SD12, SD13).
        toApproved({ type: "screen", connected: false });
      }
      target = socket;
      scenes?.discard(); // an import belongs to the screen that started it (PD9)
      setCached(null); // a new page sends its own state; the old one is no longer true (SD13)
      log.info("screen connected");
      toSenders({ type: "screen", connected: true }); // they offer to it (B-06 SD18)
      receive(socket, {
        schema: screenMessageSchema,
        maxBytes: screenMaxBytes,
        ratePerSecond: null,
        now,
        log,
        socket: "screen",
        onMessage: (message) => {
          if (socket !== target) return;
          // B-07 PD9: answered at once to the screen that asked, never queued behind an action.
          if (isSceneRequest(message)) {
            if (scenes) send(socket, answerScene(scenes, message));
            return;
          }
          run(() => onScreen(message));
        },
      });
      socket.on("close", () => {
        screens.delete(socket);
        if (socket !== target) return;
        target = null;
        scenes?.discard();
        setCached(null);
        log.info("screen disconnected");
        clearHolder(true);
        toApproved({ type: "screen", connected: false });
      });
      send(socket, { type: "status", status: status() });
    },

    state: () => cached,

    request(socket, ip, code, hint, sends) {
      const result = pairing.request(ip, code, hint, sends);
      if (result.kind === "refused") {
        log.info({ reason: result.reason }, "device refused");
        refuse(socket, result.reason);
        return null;
      }
      const { deviceId, label } = result.device;
      links.set(deviceId, { socket, approved: false, label, sends: result.device.sends });
      note(label, result.device.sends, "requested");
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
          note(labelOf(result.dropped), sendsOf(result.dropped), "disconnected");
          end(result.dropped);
          changed();
        }
        log.info({ reason: result.reason }, "device refused");
        refuse(socket, result.reason);
        return null;
      }
      const { deviceId, label, sends } = result.device;
      const previous = links.get(deviceId);
      if (previous && previous.socket !== socket) {
        // AC32: the old link is closed, so its stream ends; its late close finds a new socket.
        if (previewHolder === deviceId) clearHolder(false);
        previous.socket.terminate();
      }
      const link: Link = { socket, approved: true, label, sends };
      links.set(deviceId, link);
      note(label, sends, sends.length > 0 ? "connected" : "reconnected");
      send(socket, { type: "approved", key, deviceId, sends });
      welcome(deviceId, link);
      if (sends.length > 0) changed(); // the panel shows it online again (PD5)
      return deviceId;
    },

    isApproved: (deviceId, socket) => {
      const link = links.get(deviceId);
      return link?.socket === socket && link.approved && pairing.isApproved(deviceId);
    },

    control(deviceId: string, control: Control) {
      toTarget({ type: "control", deviceId, control });
    },

    sendsOf: (deviceId) => pairing.sendsOf(deviceId),

    setup(deviceId, message) {
      // B-06 SD16: to the target screen with the sender's id; with none, the sender offers again
      // when one connects. Read nothing inside.
      toTarget({ ...message, deviceId });
    },

    preview(deviceId, message) {
      if (message.type === "previewStream") return watch(deviceId, message.watching);
      // The holder's answer and candidates to the screen, with its id; anyone else's dropped.
      if (deviceId !== previewHolder) {
        return log.debug({ type: message.type }, "preview setup dropped");
      }
      toTarget({ ...message, deviceId });
    },

    accept: (deviceId) => run(() => accept(deviceId)),
    reject: (deviceId) => run(() => reject(deviceId)),

    closed(deviceId, socket) {
      const link = links.get(deviceId);
      if (link?.socket !== socket) return;
      if (previewHolder === deviceId) clearHolder(false); // AC32: the screen stops the stream
      links.delete(deviceId);
      // A request whose page went away leaves the lists; an approval stays for a reconnect.
      if (!link.approved && pairing.reject(deviceId)) {
        scheduleExpiry();
        changed();
      } else if (link.approved && link.sends.length > 0) {
        note(link.label, link.sends, "disconnected");
        changed(); // offline in the panel (PD5)
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
      scenes?.discard();
      await actions;
      pairing.disable();
      await lan.disable();
    },
  };
}
