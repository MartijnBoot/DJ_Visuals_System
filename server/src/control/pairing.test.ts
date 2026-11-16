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
    expect(device).toEqual({
      deviceId: expect.any(String),
      hint: HINT,
      label: "Device 1",
      sends: [],
    });
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

describe("roles and the sender limits (B-06 T7, SD6, SD8, SD12, SD15, AC8, AC10)", () => {
  beforeEach(() => pairing.enable());
  let ip = 0;
  /** Each request from its own address, as each device is. */
  const nextIp = () => `192.168.2.${++ip}`;

  function requestAs(sends: ("video" | "audio")[]) {
    return pairing.request(nextIp(), pairing.code()!, HINT, sends);
  }
  function senderWaiting(sends: ("video" | "audio")[]) {
    const result = requestAs(sends);
    if (result.kind !== "waiting") throw new Error(`request gave ${JSON.stringify(result)}`);
    return result.device;
  }
  function sender(sends: ("video" | "audio")[]) {
    const device = senderWaiting(sends);
    const result = pairing.accept(device.deviceId);
    if (result.kind !== "approved") throw new Error(`accept gave ${JSON.stringify(result)}`);
    return { device, key: result.key };
  }
  const controller = () => {
    const device = waiting(nextIp());
    expect(pairing.accept(device.deviceId).kind).toBe("approved");
    return device;
  };

  it("stores the role on the entry; a controller's is empty", () => {
    expect(senderWaiting(["video", "audio"]).sends).toEqual(["video", "audio"]);
    expect(waiting(nextIp()).sends).toEqual([]);
    expect(pairing.pending().map((d) => d.sends)).toEqual([["video", "audio"], []]);
  });

  it("lists controllers in devices() and senders in senders(); sendsOf names the role", () => {
    const c = controller();
    const s = sender(["audio"]);
    expect(pairing.devices().map((d) => d.deviceId)).toEqual([c.deviceId]);
    expect(pairing.senders().map((d) => d.deviceId)).toEqual([s.device.deviceId]);
    expect(pairing.sendsOf(s.device.deviceId)).toEqual(["audio"]);
    expect(pairing.sendsOf(c.deviceId)).toEqual([]);
    expect(pairing.sendsOf("dnone")).toBeNull();
  });

  it("resume returns the role", () => {
    const deviceIp = nextIp();
    const result = pairing.request(deviceIp, pairing.code()!, HINT, ["video"]);
    if (result.kind !== "waiting") throw new Error("not waiting");
    const accepted = pairing.accept(result.device.deviceId);
    if (accepted.kind !== "approved") throw new Error("not approved");
    expect(pairing.resume(deviceIp, accepted.key)).toEqual({
      kind: "ok",
      device: expect.objectContaining({ sends: ["video"] }),
    });
  });

  it("one audio sender approved → a second request is audio_taken", () => {
    sender(["audio"]);
    expect(requestAs(["audio"])).toEqual({ kind: "refused", reason: "audio_taken" });
    expect(requestAs(["video", "audio"])).toEqual({ kind: "refused", reason: "audio_taken" });
    expect(requestAs(["video"]).kind).toBe("waiting");
  });

  it("two pending audio requests: the second accept is audio_taken", () => {
    const first = senderWaiting(["audio"]);
    const second = senderWaiting(["audio"]);
    expect(pairing.accept(first.deviceId).kind).toBe("approved");
    expect(pairing.accept(second.deviceId)).toEqual({ kind: "refused", reason: "audio_taken" });
    expect(pairing.pending()).toEqual([]);
  });

  it("four video senders → the fifth is too_many, at request and at accept", () => {
    const waitingFifth = senderWaiting(["video"]);
    for (let i = 0; i < 4; i += 1) sender(["video"]);
    expect(requestAs(["video"])).toEqual({ kind: "refused", reason: "too_many" });
    expect(pairing.accept(waitingFifth.deviceId)).toEqual({ kind: "refused", reason: "too_many" });
  });

  it("eight controllers and four video senders and an audio sender coexist", () => {
    for (let i = 0; i < 8; i += 1) controller();
    for (let i = 0; i < 4; i += 1) sender(["video"]);
    sender(["audio"]);
    expect(pairing.devices()).toHaveLength(8);
    expect(pairing.senders()).toHaveLength(5);
    expect(pairing.request(nextIp(), pairing.code()!, HINT)).toEqual({
      kind: "refused",
      reason: "too_many",
    });
  });

  it("a video and audio device counts in both limits", () => {
    sender(["video", "audio"]);
    expect(requestAs(["audio"])).toEqual({ kind: "refused", reason: "audio_taken" });
    for (let i = 0; i < 3; i += 1) sender(["video"]);
    expect(requestAs(["video"])).toEqual({ kind: "refused", reason: "too_many" });
  });

  it("audio_taken wins over too_many when both apply", () => {
    sender(["video", "audio"]);
    for (let i = 0; i < 3; i += 1) sender(["video"]);
    expect(requestAs(["video", "audio"])).toEqual({ kind: "refused", reason: "audio_taken" });
  });

  it("the 4 pending places are shared by every role", () => {
    senderWaiting(["video"]);
    senderWaiting(["audio"]);
    waiting(nextIp());
    waiting(nextIp());
    expect(requestAs(["video"])).toEqual({ kind: "refused", reason: "too_many" });
  });

  it("a disconnected audio sender frees the place", () => {
    const { device } = sender(["audio"]);
    expect(pairing.disconnect(device.deviceId)).toBe(true);
    expect(requestAs(["audio"]).kind).toBe("waiting");
  });

  it("newCode ends senders too", () => {
    const { device, key } = sender(["video"]);
    expect(pairing.newCode()).toContain(device.deviceId);
    expect(pairing.senders()).toEqual([]);
    expect(pairing.resume("192.168.2.1", key)).toEqual({ kind: "refused", reason: "ended" });
  });
});
