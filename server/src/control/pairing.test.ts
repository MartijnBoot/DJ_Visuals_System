// T4 (B-04 spec SD4, SD18, SD19, SD21, AC9, AC10, AC12 to AC15): the pairing rules with a fake
// clock and a fake random source, no socket.
import { CODE_ALPHABET } from "@djv/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createPairing, type Pairing } from "./pairing.ts";

const IP = "192.168.1.20";
const OTHER_IP = "192.168.1.21";
const HINT = "Safari on iPhone";

let clock: number;
let counter: number;
let pairing: Pairing;

/** Deterministic bytes: 0, 1, 2, … so codes and keys differ on every call. */
const random = (size: number) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = counter++ % 256;
  return bytes;
};

beforeEach(() => {
  clock = 1_000_000;
  counter = 0;
  pairing = createPairing({ now: () => clock, random });
});

function waiting(ip = IP, code = pairing.code()!) {
  const result = pairing.request(ip, code, HINT);
  if (result.kind !== "waiting") throw new Error(`request gave ${JSON.stringify(result)}`);
  return result.device;
}

function approved(ip = IP) {
  const device = waiting(ip);
  const result = pairing.accept(device.deviceId);
  if (result.kind !== "approved") throw new Error(`accept gave ${result.kind}`);
  return { device, key: result.key };
}

const wrongCode = () => (pairing.code() === "222222" ? "333333" : "222222");

describe("the switch and the code (SD2, SD19)", () => {
  it("is off with no code until enabled", () => {
    expect(pairing.isOn()).toBe(false);
    expect(pairing.code()).toBeNull();
    expect(pairing.request(IP, "ABCDEF", HINT)).toEqual({ kind: "refused", reason: "ended" });
  });

  it("enables with a 6-character code from the alphabet", () => {
    pairing.enable();
    expect(pairing.isOn()).toBe(true);
    const code = pairing.code()!;
    expect(code).toHaveLength(6);
    for (const c of code) expect(CODE_ALPHABET).toContain(c);
  });

  it("draws codes by rejection sampling: bytes at or above 248 are skipped", () => {
    const bytes = [255, 248, 0, 30, 31, 247, 62, 93];
    let i = 0;
    const fixed = createPairing({
      now: () => clock,
      random: (size) => Uint8Array.from({ length: size }, () => bytes[i++ % bytes.length]!),
    });
    fixed.enable();
    // 0 → A, 30 → 9, 31 → A, 247 → 247 % 31 = 30 → 9, 62 → A, 93 → A
    expect(fixed.code()).toBe([0, 30, 31, 247, 62, 93].map((b) => CODE_ALPHABET[b % 31]).join(""));
  });

  it("disable discards the code, pending requests and approvals, and names the devices", () => {
    pairing.enable();
    const { device, key } = approved();
    const asking = waiting(OTHER_IP);
    expect(pairing.disable().sort()).toEqual([device.deviceId, asking.deviceId].sort());
    expect(pairing.isOn()).toBe(false);
    expect(pairing.code()).toBeNull();
    expect(pairing.devices()).toEqual([]);
    expect(pairing.pending()).toEqual([]);
    pairing.enable();
    expect(pairing.resume(IP, key)).toEqual({ kind: "refused", reason: "ended" });
  });

  it("new code invalidates every key and the old code, and names the devices (AC13)", () => {
    pairing.enable();
    const old = pairing.code()!;
    const first = approved();
    const second = approved(OTHER_IP);
    const affected = pairing.newCode();
    expect(affected.sort()).toEqual([first.device.deviceId, second.device.deviceId].sort());
    expect(pairing.code()).not.toBe(old);
    expect(pairing.resume(IP, first.key)).toEqual({ kind: "refused", reason: "ended" });
    expect(pairing.resume(OTHER_IP, second.key)).toEqual({ kind: "refused", reason: "ended" });
    expect(pairing.request(IP, old, HINT)).toEqual({ kind: "refused", reason: "wrong_code" });
    expect(pairing.devices()).toEqual([]);
  });
});

describe("requests, approval and rejection (SD4, SD18, AC10)", () => {
  beforeEach(() => pairing.enable());

  it("a right code waits, with the hint and a sequence label", () => {
    const device = waiting();
    expect(device).toEqual({ deviceId: expect.any(String), hint: HINT, label: "Device 1" });
    expect(pairing.pending()).toEqual([device]);
    expect(waiting(OTHER_IP).label).toBe("Device 2");
  });

  it("accept gives a 128-bit base64url key and moves the device to the approved list", () => {
    const { device, key } = approved();
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(pairing.pending()).toEqual([]);
    expect(pairing.devices()).toEqual([device]);
    expect(pairing.accept(device.deviceId)).toEqual({ kind: "unknown" });
  });

  it("reject removes the request; an unknown id changes nothing", () => {
    const device = waiting();
    expect(pairing.reject(device.deviceId)).toBe(true);
    expect(pairing.reject(device.deviceId)).toBe(false);
    expect(pairing.pending()).toEqual([]);
  });

  it("expires a request at 60 000 ms and not before", () => {
    const device = waiting();
    clock += 59_999;
    expect(pairing.expire()).toEqual([]);
    expect(pairing.pending()).toEqual([device]);
    clock += 1;
    expect(pairing.expire()).toEqual([device.deviceId]);
    expect(pairing.pending()).toEqual([]);
    expect(pairing.accept(device.deviceId)).toEqual({ kind: "unknown" });
  });

  it("reports when the next request expires", () => {
    expect(pairing.nextExpiry()).toBeNull();
    waiting();
    clock += 10_000;
    waiting(OTHER_IP);
    expect(pairing.nextExpiry()).toBe(1_000_000 + 60_000);
  });
});

describe("keys bound to the IP (SD15, AC11, AC12, AC14)", () => {
  beforeEach(() => pairing.enable());

  it("resumes with the key from the approved IP", () => {
    const { device, key } = approved();
    expect(pairing.resume(IP, key)).toEqual({ kind: "ok", device });
  });

  it("refuses a key from another IP and drops its approval", () => {
    const { device, key } = approved();
    expect(pairing.resume(OTHER_IP, key)).toEqual({
      kind: "refused",
      reason: "ended",
      dropped: device.deviceId,
    });
    expect(pairing.devices()).toEqual([]);
    expect(pairing.resume(IP, key)).toEqual({ kind: "refused", reason: "ended" });
  });

  it("refuses an unknown key", () => {
    expect(pairing.resume(IP, "A".repeat(22))).toEqual({ kind: "refused", reason: "ended" });
  });

  it("disconnect ends one device's key and leaves the others (AC14)", () => {
    const first = approved();
    const second = approved(OTHER_IP);
    expect(pairing.disconnect(first.device.deviceId)).toBe(true);
    expect(pairing.disconnect(first.device.deviceId)).toBe(false);
    expect(pairing.resume(IP, first.key)).toEqual({ kind: "refused", reason: "ended" });
    expect(pairing.resume(OTHER_IP, second.key)).toEqual({ kind: "ok", device: second.device });
  });

  it("isApproved answers for approved devices only", () => {
    const asking = waiting();
    expect(pairing.isApproved(asking.deviceId)).toBe(false);
    pairing.accept(asking.deviceId);
    expect(pairing.isApproved(asking.deviceId)).toBe(true);
  });
});

describe("the wrong-code throttle (SD19, AC9)", () => {
  beforeEach(() => pairing.enable());

  it("refuses a wrong code, then the IP for 60 s after the fifth within 60 s, a right code included", () => {
    for (let i = 0; i < 5; i++) {
      expect(pairing.request(IP, wrongCode(), HINT)).toEqual({
        kind: "refused",
        reason: "wrong_code",
      });
      clock += 1000;
    }
    expect(pairing.request(IP, pairing.code()!, HINT)).toEqual({
      kind: "refused",
      reason: "throttled",
    });
    expect(waiting(OTHER_IP).hint).toBe(HINT); // another IP is unaffected
    clock += 60_000 - 1001; // the fifth wrong code was at +4000; refused until +64 000
    expect(pairing.request(IP, pairing.code()!, HINT).kind).toBe("refused");
    clock += 1;
    expect(pairing.request(IP, pairing.code()!, HINT).kind).toBe("waiting");
  });

  it("forgets wrong codes older than 60 s, and a right code does not reset the count", () => {
    for (let i = 0; i < 4; i++) pairing.request(IP, wrongCode(), HINT);
    waiting(); // a right code in between does not reset the count
    pairing.request(IP, wrongCode(), HINT);
    expect(pairing.request(IP, pairing.code()!, HINT)).toEqual({
      kind: "refused",
      reason: "throttled",
    });

    const fresh = createPairing({ now: () => clock, random });
    fresh.enable();
    const wrong = fresh.code() === "222222" ? "333333" : "222222";
    for (let i = 0; i < 4; i++) fresh.request(IP, wrong, HINT);
    clock += 60_000;
    fresh.request(IP, wrong, HINT); // the four before have left the window
    expect(fresh.request(IP, fresh.code()!, HINT).kind).toBe("waiting");
  });
});

describe("the limits (SD21, AC15)", () => {
  beforeEach(() => pairing.enable());

  it("refuses a fifth pending request at once", () => {
    for (let i = 0; i < 4; i++) waiting(`192.168.1.${30 + i}`);
    expect(pairing.request(IP, pairing.code()!, HINT)).toEqual({
      kind: "refused",
      reason: "too_many",
    });
  });

  it("refuses a request beyond eight approved devices", () => {
    for (let i = 0; i < 8; i++) approved(`192.168.1.${30 + i}`);
    expect(pairing.devices()).toHaveLength(8);
    expect(pairing.request(IP, pairing.code()!, HINT)).toEqual({
      kind: "refused",
      reason: "too_many",
    });
  });

  it("refuses an accept that would make a ninth approved device", () => {
    for (let i = 0; i < 7; i++) approved(`192.168.1.${30 + i}`);
    const a = waiting("192.168.1.50");
    const b = waiting("192.168.1.51");
    expect(pairing.accept(a.deviceId).kind).toBe("approved");
    expect(pairing.accept(b.deviceId)).toEqual({ kind: "refused", reason: "too_many" });
    expect(pairing.pending()).toEqual([]);
    expect(pairing.devices()).toHaveLength(8);
  });
});
