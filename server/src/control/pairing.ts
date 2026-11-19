// External control's pairing rules (B-04 spec SD2, SD4, SD15, SD18, SD19, SD21; plan T4), in
// memory and nothing else: the switch, the code, pending requests, approvals with session keys
// bound to the approved IP, the limits, the wrong-code throttle and request expiry. No socket and
// no timer: the clock and the random source are injected, and the caller asks `expire()` when
// `nextExpiry()` comes due. Everything dies with the process (spec, Data).
// B-06 (SD6, SD8, SD12, SD15, PD4; T7): a request names what the device sends — nothing for a
// controller — and the role is stored on the entry. Limits by role, at request and again at
// accept: 8 controllers, 4 video senders, 1 audio sender (a device sending both counts in both),
// 4 pending shared by every role. A second audio sender is `audio_taken`, checked before
// `too_many` when both apply.
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  PAIRING_LIMITS,
  type DeviceEntry,
  type SendKind,
} from "@djv/shared";
import { createRateWindow } from "../rate-window.ts";

export interface PairingDeps {
  now(): number;
  /** `size` random bytes (`crypto.getRandomValues` in the product). */
  random(size: number): Uint8Array;
}

export type RequestResult =
  | { kind: "waiting"; device: DeviceEntry }
  | { kind: "refused"; reason: "wrong_code" | "throttled" | "too_many" | "audio_taken" | "ended" };

export type AcceptResult =
  | { kind: "approved"; device: DeviceEntry; key: string }
  | { kind: "refused"; reason: "too_many" | "audio_taken" }
  | { kind: "unknown" };

export type ResumeResult =
  | { kind: "ok"; device: DeviceEntry }
  /** `dropped`: a key presented from another IP ends that device's approval (AC12). */
  | { kind: "refused"; reason: "ended"; dropped?: string };

export interface Pairing {
  isOn(): boolean;
  code(): string | null;
  /** Switches on with a new code. */
  enable(): void;
  /** Switches off; returns every device, pending or approved, whose socket must close. */
  disable(): string[];
  /** A new code; every pending request and approval ends. Returns the devices to close. */
  newCode(): string[];
  /** `sends`: what the device sends; empty (the default) for a controller. */
  request(ip: string, code: string, hint: string, sends?: readonly SendKind[]): RequestResult;
  accept(deviceId: string): AcceptResult;
  reject(deviceId: string): boolean;
  /** Removes the requests unanswered for 60 s and returns their ids. */
  expire(): string[];
  /** When the oldest pending request expires, or null with none pending. */
  nextExpiry(): number | null;
  resume(ip: string, key: string): ResumeResult;
  disconnect(deviceId: string): boolean;
  isApproved(deviceId: string): boolean;
  /** Approved controllers. */
  devices(): DeviceEntry[];
  /** Approved senders (B-06). */
  senders(): DeviceEntry[];
  /** An approved device's role, or null for none. */
  sendsOf(deviceId: string): SendKind[] | null;
  pending(): DeviceEntry[];
}

interface Pending {
  entry: DeviceEntry;
  /** The requesting socket's address: the key is bound to it on approval (SD15). */
  ip: string;
  at: number;
}

interface Approved {
  entry: DeviceEntry;
  ip: string;
  key: string;
}

/** The largest multiple of the alphabet's length below 256: bytes from here up are skipped. */
const SAMPLE_LIMIT = 256 - (256 % CODE_ALPHABET.length);

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export function createPairing({ now, random }: PairingDeps): Pairing {
  let on = false;
  let code: string | null = null;
  let sequence = 0;
  const pending = new Map<string, Pending>();
  const approved = new Map<string, Approved>();
  const byKey = new Map<string, string>();
  // The wrong-code throttle (SD19): the fifth wrong code within the window refuses the IP for
  // 60 s. The window is shared with the cloud's token guard (B-12 PD11).
  const throttle = createRateWindow({
    limit: PAIRING_LIMITS.wrongCodes,
    windowMs: PAIRING_LIMITS.wrongCodeWindowMs,
    blockMs: PAIRING_LIMITS.throttleMs,
    now,
  });

  /** Rejection sampling keeps every character equally likely (SD19). */
  const drawCode = (): string => {
    let out = "";
    while (out.length < CODE_LENGTH) {
      for (const byte of random(CODE_LENGTH)) {
        if (byte < SAMPLE_LIMIT && out.length < CODE_LENGTH) {
          out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
        }
      }
    }
    return out;
  };

  const newId = (): string => {
    let id: string;
    do id = `d${base64url(random(9))}`;
    while (pending.has(id) || approved.has(id));
    return id;
  };

  /** The role limit a device of `sends` would break with the approvals as they are, if any. */
  const roleRefusal = (sends: readonly SendKind[]): "audio_taken" | "too_many" | null => {
    const roles = [...approved.values()].map((d) => d.entry.sends);
    const count = (kind: SendKind) => roles.filter((r) => r.includes(kind)).length;
    if (sends.includes("audio") && count("audio") >= PAIRING_LIMITS.audioSenders) {
      return "audio_taken";
    }
    if (sends.includes("video") && count("video") >= PAIRING_LIMITS.videoSenders) {
      return "too_many";
    }
    if (
      sends.length === 0 &&
      roles.filter((r) => r.length === 0).length >= PAIRING_LIMITS.approved
    ) {
      return "too_many";
    }
    return null;
  };

  const endAll = (): string[] => {
    const ids = [...pending.keys(), ...approved.keys()];
    pending.clear();
    approved.clear();
    byKey.clear();
    return ids;
  };

  const drop = (deviceId: string): boolean => {
    const device = approved.get(deviceId);
    if (!device) return false;
    approved.delete(deviceId);
    byKey.delete(device.key);
    return true;
  };

  return {
    isOn: () => on,
    code: () => code,

    enable() {
      on = true;
      code = drawCode();
    },

    disable() {
      on = false;
      code = null;
      throttle.clear();
      return endAll();
    },

    newCode() {
      const ids = endAll();
      if (on) code = drawCode();
      return ids;
    },

    request(ip, presented, hint, sends = []) {
      if (!on || code === null) return { kind: "refused", reason: "ended" };
      const at = now();
      if (throttle.blocked(ip)) return { kind: "refused", reason: "throttled" };
      if (presented !== code) {
        throttle.record(ip);
        return { kind: "refused", reason: "wrong_code" };
      }
      const refusal = roleRefusal(sends);
      if (refusal) return { kind: "refused", reason: refusal };
      if (pending.size >= PAIRING_LIMITS.pending) return { kind: "refused", reason: "too_many" };
      const entry: DeviceEntry = {
        deviceId: newId(),
        hint,
        label: `Device ${++sequence}`,
        sends: [...sends],
      };
      pending.set(entry.deviceId, { entry, ip, at });
      return { kind: "waiting", device: entry };
    },

    accept(deviceId) {
      const request = pending.get(deviceId);
      if (!request) return { kind: "unknown" };
      pending.delete(deviceId);
      const refusal = roleRefusal(request.entry.sends);
      if (refusal) return { kind: "refused", reason: refusal };
      const key = base64url(random(16));
      approved.set(deviceId, { entry: request.entry, ip: request.ip, key });
      byKey.set(key, deviceId);
      return { kind: "approved", device: request.entry, key };
    },

    reject: (deviceId) => pending.delete(deviceId),

    expire() {
      const at = now();
      const gone: string[] = [];
      for (const [id, request] of pending) {
        if (at - request.at >= PAIRING_LIMITS.requestExpiryMs) {
          pending.delete(id);
          gone.push(id);
        }
      }
      return gone;
    },

    nextExpiry() {
      let oldest: number | null = null;
      for (const { at } of pending.values()) oldest = oldest === null ? at : Math.min(oldest, at);
      return oldest === null ? null : oldest + PAIRING_LIMITS.requestExpiryMs;
    },

    resume(ip, key) {
      const deviceId = byKey.get(key);
      const device = deviceId === undefined ? undefined : approved.get(deviceId);
      if (!on || !device) return { kind: "refused", reason: "ended" };
      if (device.ip !== ip) {
        drop(device.entry.deviceId);
        return { kind: "refused", reason: "ended", dropped: device.entry.deviceId };
      }
      return { kind: "ok", device: device.entry };
    },

    disconnect: drop,
    isApproved: (deviceId) => approved.has(deviceId),
    devices: () => [...approved.values()].map((d) => d.entry).filter((e) => e.sends.length === 0),
    senders: () => [...approved.values()].map((d) => d.entry).filter((e) => e.sends.length > 0),
    sendsOf: (deviceId) => {
      const device = approved.get(deviceId);
      return device ? [...device.entry.sends] : null;
    },
    pending: () => [...pending.values()].map((p) => p.entry),
  };
}
