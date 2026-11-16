// External control's pairing rules (B-04 spec SD2, SD4, SD15, SD18, SD19, SD21; plan T4), in
// memory and nothing else: the switch, the code, pending requests, approvals with session keys
// bound to the approved IP, the limits, the wrong-code throttle and request expiry. No socket and
// no timer: the clock and the random source are injected, and the caller asks `expire()` when
// `nextExpiry()` comes due. Everything dies with the process (spec, Data).
import { CODE_ALPHABET, CODE_LENGTH, PAIRING_LIMITS, type DeviceEntry } from "@djv/shared";

export interface PairingDeps {
  now(): number;
  /** `size` random bytes (`crypto.getRandomValues` in the product). */
  random(size: number): Uint8Array;
}

export type RequestResult =
  | { kind: "waiting"; device: DeviceEntry }
  | { kind: "refused"; reason: "wrong_code" | "throttled" | "too_many" | "ended" };

export type AcceptResult =
  | { kind: "approved"; device: DeviceEntry; key: string }
  | { kind: "refused"; reason: "too_many" }
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
  request(ip: string, code: string, hint: string): RequestResult;
  accept(deviceId: string): AcceptResult;
  reject(deviceId: string): boolean;
  /** Removes the requests unanswered for 60 s and returns their ids. */
  expire(): string[];
  /** When the oldest pending request expires, or null with none pending. */
  nextExpiry(): number | null;
  resume(ip: string, key: string): ResumeResult;
  disconnect(deviceId: string): boolean;
  isApproved(deviceId: string): boolean;
  devices(): DeviceEntry[];
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
  const wrong = new Map<string, number[]>();
  const throttledUntil = new Map<string, number>();

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

  /** Records a wrong code; the fifth within the window refuses the IP for 60 s (SD19). */
  const wrongCode = (ip: string, at: number) => {
    const recent = (wrong.get(ip) ?? []).filter((t) => at - t < PAIRING_LIMITS.wrongCodeWindowMs);
    recent.push(at);
    wrong.set(ip, recent);
    if (recent.length >= PAIRING_LIMITS.wrongCodes) {
      throttledUntil.set(ip, at + PAIRING_LIMITS.throttleMs);
      wrong.delete(ip);
    }
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
      wrong.clear();
      throttledUntil.clear();
      return endAll();
    },

    newCode() {
      const ids = endAll();
      if (on) code = drawCode();
      return ids;
    },

    request(ip, presented, hint) {
      if (!on || code === null) return { kind: "refused", reason: "ended" };
      const at = now();
      const until = throttledUntil.get(ip);
      if (until !== undefined && at < until) return { kind: "refused", reason: "throttled" };
      if (until !== undefined) throttledUntil.delete(ip);
      if (presented !== code) {
        wrongCode(ip, at);
        return { kind: "refused", reason: "wrong_code" };
      }
      if (approved.size >= PAIRING_LIMITS.approved || pending.size >= PAIRING_LIMITS.pending) {
        return { kind: "refused", reason: "too_many" };
      }
      const entry: DeviceEntry = {
        deviceId: newId(),
        hint,
        label: `Device ${++sequence}`,
        sends: [],
      };
      pending.set(entry.deviceId, { entry, ip, at });
      return { kind: "waiting", device: entry };
    },

    accept(deviceId) {
      const request = pending.get(deviceId);
      if (!request) return { kind: "unknown" };
      pending.delete(deviceId);
      if (approved.size >= PAIRING_LIMITS.approved) return { kind: "refused", reason: "too_many" };
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
    devices: () => [...approved.values()].map((d) => d.entry),
    pending: () => [...pending.values()].map((p) => p.entry),
  };
}
