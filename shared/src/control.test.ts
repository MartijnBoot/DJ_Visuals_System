// T3 (B-04 spec SD19, SD20, SD21, AC17, AC33; plan PD11): every control message, both ways.
import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  DEVICE_RATE_PER_SECOND,
  deviceMessageSchema,
  MAX_DEVICE_MESSAGE,
  MAX_SCREEN_MESSAGE,
  MAX_SETUP_MESSAGE,
  PAIRING_LIMITS,
  REFUSAL_REASONS,
  screenMessageSchema,
  toDeviceSchema,
  toScreenSchema,
  typeOf,
  type ScreenState,
} from "./control.ts";

const KEY = "AAAAAAAAAAAAAAAAAAAAAA"; // 22 base64url characters
const state: ScreenState = {
  profiles: [{ id: "builtin", name: "Built-in" }],
  activeId: "builtin",
  palette: ["#000000", "#ffffff"],
  storedPalette: ["#000000", "#ffffff"],
  primary: 1,
  dials: { recognisability: 0.3, reactivity: 0.7 },
  cameras: [
    { deviceId: "cam-1", label: "Front camera", remote: false },
    { deviceId: "remote:d123", label: "Safari on iPhone — Device 2", remote: true },
  ],
  cameraId: "cam-1",
  camera: "ok",
  audio: "idle",
  started: true,
  reason: null,
  mainAudio: { choice: "remote", playing: "local", label: "Device 3" },
  transition: { kind: "cut", duration: 2, keepColour: false },
  effects: [],
};
/** B-18 SD7, PD5: one flagged effect as the state lists it. */
const flaggedEntry = { index: 2, name: "Swirl", stored: 0.4, value: 0.9, dj: true, vj: false };
const entry = { deviceId: "d1", hint: "Safari on iPhone", label: "Device 1", sends: [] };
const senderEntry = {
  deviceId: "d3",
  hint: "Chrome on Windows",
  label: "Device 3",
  sends: ["video", "audio"],
};
const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n";
const CANDIDATE = {
  candidate: "candidate:1 1 udp 1 192.168.1.5 50000 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
};
const status = {
  on: true,
  addresses: [{ address: "192.168.1.5", name: "Wi-Fi" }],
  port: 8001,
  code: "ABC234",
  devices: [entry],
  pending: [],
  senders: [{ ...senderEntry, online: true }],
  fingerprint: "0123456789ABCDEF",
};

const examples = {
  device: [
    { type: "hello", code: "ABC234" },
    { type: "hello", key: KEY },
    { type: "hello", code: "ABC234", sends: ["video"] },
    { type: "hello", code: "ABC234", sends: ["audio", "video"] },
    { type: "offer", sdp: SDP },
    { type: "candidate", ...CANDIDATE },
    { type: "candidate", candidate: "", sdpMid: null, sdpMLineIndex: null },
    { type: "mainAudio", seq: 8, source: "local" },
    { type: "pick", seq: 1, id: "builtin" },
    { type: "dials", seq: 2, recognisability: 0.5 },
    { type: "dials", seq: 3, reactivity: 0, recognisability: 1 },
    { type: "colour", seq: 4, slot: 0, value: "#ff8800" },
    { type: "resetColour", seq: 5, slot: 5 },
    { type: "camera", seq: 6, deviceId: "cam-2" },
    { type: "camera", seq: 6, deviceId: "remote:d123" },
    { type: "refresh", seq: 7 },
    { type: "transition", seq: 9, kind: "crossfade" },
    { type: "transition", seq: 10, duration: 0.5 },
    { type: "transition", seq: 11, keepColour: true },
    { type: "transition", seq: 12, kind: "dip", duration: 8, keepColour: false },
    { type: "effect", seq: 13, profile: "w1", index: 0, value: 0 },
    { type: "effect", seq: 14, profile: "builtin", index: 11, value: 1 },
    { type: "accept", deviceId: "d2" },
    { type: "reject", deviceId: "d2" },
  ],
  toDevice: [
    { type: "waiting" },
    { type: "approved", key: KEY, deviceId: "d1", sends: [] },
    { type: "approved", key: KEY, deviceId: "d3", sends: ["audio"] },
    { type: "refused", reason: "wrong_code" },
    { type: "refused", reason: "audio_taken" },
    { type: "answer", sdp: SDP },
    { type: "candidate", ...CANDIDATE },
    { type: "stream", kind: "video", active: false },
    { type: "refused", reason: "rejected" },
    { type: "ended" },
    { type: "screen", connected: false },
    { type: "pending", requests: [entry, senderEntry] },
    { type: "state", state },
    { type: "state", state: { ...state, effects: [flaggedEntry] } },
    { type: "applied", seq: 9 },
  ],
  screen: [
    { type: "state", state },
    { type: "applied", entries: [{ deviceId: "d1", seq: 3 }] },
    { type: "enable" },
    { type: "disable" },
    { type: "newCode" },
    { type: "disconnect", deviceId: "d1" },
    { type: "accept", deviceId: "d1" },
    { type: "reject", deviceId: "d1" },
    { type: "answer", deviceId: "d3", sdp: SDP },
    { type: "candidate", deviceId: "d3", ...CANDIDATE },
    { type: "stream", deviceId: "d3", kind: "audio", active: true },
  ],
  toScreen: [
    { type: "control", deviceId: "d1", control: { type: "pick", seq: 1, id: "x" } },
    { type: "status", status },
    { type: "status", status: { ...status, on: false, code: null, error: "no_address" } },
    { type: "status", status: { ...status, on: false, fingerprint: null, error: "cert_store" } },
    { type: "offer", deviceId: "d3", sdp: SDP },
    { type: "candidate", deviceId: "d3", ...CANDIDATE },
    { type: "superseded" },
  ],
} as const;

const schemas = {
  device: deviceMessageSchema,
  toDevice: toDeviceSchema,
  screen: screenMessageSchema,
  toScreen: toScreenSchema,
} as const;

describe("every message type", () => {
  for (const [name, list] of Object.entries(examples)) {
    const schema = schemas[name as keyof typeof schemas];
    for (const example of list) {
      it(`${name}: parses a valid ${example.type} and rejects an extra key`, () => {
        expect(schema.parse(example)).toEqual(example);
        expect(schema.safeParse({ ...example, extra: 1 }).success).toBe(false);
      });
    }
  }
});

describe("the device union (AC17, SD20)", () => {
  const fails = (message: unknown) => deviceMessageSchema.safeParse(message).success === false;

  it("has no newCode, disconnect, enable or disable", () => {
    expect(fails({ type: "newCode" })).toBe(true);
    expect(fails({ type: "disconnect", deviceId: "d1" })).toBe(true);
    expect(fails({ type: "enable" })).toBe(true);
    expect(fails({ type: "disable" })).toBe(true);
    expect(fails({ type: "state", state })).toBe(true);
  });

  it("refuses a colour outside #rrggbb and a slot outside the palette's maximum", () => {
    expect(fails({ type: "colour", seq: 1, slot: 0, value: "red" })).toBe(true);
    expect(fails({ type: "colour", seq: 1, slot: 0, value: "#ff880" })).toBe(true);
    expect(fails({ type: "colour", seq: 1, slot: 6, value: "#ff8800" })).toBe(true);
    expect(fails({ type: "resetColour", seq: 1, slot: -1 })).toBe(true);
    expect(fails({ type: "colour", seq: 1, slot: 0.5, value: "#ff8800" })).toBe(true);
  });

  it("requires a non-negative integer seq on every control", () => {
    expect(fails({ type: "pick", id: "x" })).toBe(true);
    expect(fails({ type: "refresh", seq: -1 })).toBe(true);
    expect(fails({ type: "refresh", seq: 1.5 })).toBe(true);
  });

  it("refuses dials outside 0 to 1 and dials naming neither", () => {
    expect(fails({ type: "dials", seq: 1, reactivity: 1.5 })).toBe(true);
    expect(fails({ type: "dials", seq: 1 })).toBe(true);
  });

  it("takes a transition naming each kind, and refuses a bad one (B-09 SD19, AC25)", () => {
    for (const kind of ["cut", "crossfade", "dissolve", "wipe", "beatCut", "dip"]) {
      expect(fails({ type: "transition", seq: 1, kind })).toBe(false);
    }
    expect(fails({ type: "transition", seq: 1, kind: "zoom" })).toBe(true);
    expect(fails({ type: "transition", seq: 1, duration: 0.49 })).toBe(true);
    expect(fails({ type: "transition", seq: 1, duration: 8.01 })).toBe(true);
    expect(fails({ type: "transition", seq: 1 })).toBe(true);
    expect(fails({ type: "transition", seq: 1, keepColour: "yes" })).toBe(true);
    expect(fails({ type: "transition", seq: 1, kind: "cut", extra: 1 })).toBe(true);
    expect(fails({ type: "transition", kind: "cut" })).toBe(true);
  });

  it("takes an effect naming a profile, an index below 12 and a 0 to 1 value (B-18 SD7)", () => {
    const ok = { type: "effect", seq: 1, profile: "w1", index: 3, value: 0.5 };
    expect(fails(ok)).toBe(false);
    expect(fails({ ...ok, index: 12 })).toBe(true);
    expect(fails({ ...ok, index: -1 })).toBe(true);
    expect(fails({ ...ok, index: 1.5 })).toBe(true);
    expect(fails({ ...ok, value: 1.1 })).toBe(true);
    expect(fails({ ...ok, value: -0.1 })).toBe(true);
    const { profile: _p, ...noProfile } = ok;
    expect(fails(noProfile)).toBe(true);
    expect(fails({ ...ok, profile: "" })).toBe(true);
    const { seq: _s, ...noSeq } = ok;
    expect(fails(noSeq)).toBe(true);
    expect(fails({ ...ok, extra: 1 })).toBe(true);
    expect(typeOf(JSON.stringify(ok))).toBe("effect");
  });

  it("takes a hello with exactly one of a code or a key, the code from the alphabet", () => {
    expect(fails({ type: "hello" })).toBe(true);
    expect(fails({ type: "hello", code: "ABC234", key: KEY })).toBe(true);
    expect(fails({ type: "hello", code: "ABC23" })).toBe(true);
    expect(fails({ type: "hello", code: "ABC230" })).toBe(true); // 0 is not in the alphabet
    expect(fails({ type: "hello", code: "abc234" })).toBe(true);
    expect(fails({ type: "hello", key: "short" })).toBe(true);
  });
});

describe("roles and setup messages (B-06 SD6, SD16, PD4)", () => {
  const fails = (message: unknown) => deviceMessageSchema.safeParse(message).success === false;

  it("takes sends only with a code: one or two kinds, no repeats", () => {
    expect(fails({ type: "hello", key: KEY, sends: ["video"] })).toBe(true);
    expect(fails({ type: "hello", code: "ABC234", sends: ["audio", "audio"] })).toBe(true);
    expect(fails({ type: "hello", code: "ABC234", sends: [] })).toBe(true);
    expect(fails({ type: "hello", code: "ABC234", sends: ["video", "audio", "video"] })).toBe(true);
    expect(fails({ type: "hello", code: "ABC234", sends: ["screen"] })).toBe(true);
  });

  it("refuses an sdp over 16 000 characters and a candidate over 1 000", () => {
    expect(fails({ type: "offer", sdp: "x".repeat(16_000) })).toBe(false);
    expect(fails({ type: "offer", sdp: "x".repeat(16_001) })).toBe(true);
    expect(fails({ ...CANDIDATE, type: "candidate", candidate: "c".repeat(1_001) })).toBe(true);
    const answer = { type: "answer", deviceId: "d3", sdp: "x".repeat(16_001) };
    expect(screenMessageSchema.safeParse(answer).success).toBe(false);
  });

  it("takes mainAudio with remote or local only", () => {
    expect(fails({ type: "mainAudio", seq: 1, source: "remote" })).toBe(false);
    expect(fails({ type: "mainAudio", seq: 1, source: "laptop" })).toBe(true);
    expect(fails({ type: "mainAudio", source: "local" })).toBe(true);
  });

  it("takes a screen state whose main audio is null and refuses one without remote", () => {
    const toDevice = (s: unknown) => toDeviceSchema.safeParse({ type: "state", state: s }).success;
    expect(toDevice({ ...state, mainAudio: null })).toBe(true);
    expect(
      toDevice({ ...state, mainAudio: { choice: "laptop", playing: "local", label: "x" } }),
    ).toBe(false);
    expect(toDevice({ ...state, cameras: [{ deviceId: "cam-1", label: "Front camera" }] })).toBe(
      false,
    );
  });

  it("requires the transition choice in a screen state (B-09 SD19, PD14)", () => {
    const toDevice = (s: unknown) => toDeviceSchema.safeParse({ type: "state", state: s }).success;
    const { transition: _omitted, ...without } = state;
    expect(toDevice(without)).toBe(false);
    expect(
      toDevice({ ...state, transition: { kind: "wipe", duration: 8, keepColour: true } }),
    ).toBe(true);
    expect(toDevice({ ...state, transition: { kind: "cut", duration: 2 } })).toBe(false);
    expect(
      toDevice({ ...state, transition: { kind: "cut", duration: 9, keepColour: false } }),
    ).toBe(false);
  });

  it("requires the effects list in a screen state, at most 12, each entry whole (B-18 PD1, PD5)", () => {
    const toDevice = (s: unknown) => toDeviceSchema.safeParse({ type: "state", state: s }).success;
    const { effects: _omitted, ...without } = state;
    expect(toDevice(without)).toBe(false);
    const twelve = Array.from({ length: 12 }, (_, i) => ({ ...flaggedEntry, index: i }));
    expect(toDevice({ ...state, effects: twelve })).toBe(true);
    expect(toDevice({ ...state, effects: [...twelve, flaggedEntry] })).toBe(false);
    expect(toDevice({ ...state, effects: [{ ...flaggedEntry, name: "x".repeat(41) }] })).toBe(
      false,
    );
    expect(toDevice({ ...state, effects: [{ ...flaggedEntry, index: 12 }] })).toBe(false);
    expect(toDevice({ ...state, effects: [{ ...flaggedEntry, value: 1.5 }] })).toBe(false);
    const { vj: _vj, ...noVj } = flaggedEntry;
    expect(toDevice({ ...state, effects: [noVj] })).toBe(false);
    expect(toDevice({ ...state, effects: [{ ...flaggedEntry, extra: 1 }] })).toBe(false);
  });

  it("refuses a fingerprint that is not 16 hex characters", () => {
    const parses = (fingerprint: unknown) =>
      toScreenSchema.safeParse({ type: "status", status: { ...status, fingerprint } }).success;
    expect(parses("0123456789abcdef")).toBe(false);
    expect(parses("0123456789ABCDE")).toBe(false);
    expect(parses(null)).toBe(true);
  });

  it("knows audio_taken as a refusal", () => {
    expect(REFUSAL_REASONS).toContain("audio_taken");
  });

  it("typeOf names the setup messages and the transition control", () => {
    for (const type of ["offer", "answer", "candidate", "stream", "mainAudio", "transition"]) {
      expect(typeOf(JSON.stringify({ type }))).toBe(type);
    }
  });
});

describe("the constants (SD19, SD20, SD21, PD3)", () => {
  it("are the spec's numbers", () => {
    expect(MAX_DEVICE_MESSAGE).toBe(4096);
    expect(MAX_SCREEN_MESSAGE).toBe(262144);
    expect(MAX_SETUP_MESSAGE).toBe(16384);
    expect(DEVICE_RATE_PER_SECOND).toBe(120);
    expect(CODE_LENGTH).toBe(6);
    expect(PAIRING_LIMITS).toEqual({
      approved: 8,
      pending: 4,
      requestExpiryMs: 60_000,
      wrongCodes: 5,
      wrongCodeWindowMs: 60_000,
      throttleMs: 60_000,
      videoSenders: 4,
      audioSenders: 1,
    });
  });

  it("has a 31-character alphabet of upper-case letters and digits without 0 O 1 I L", () => {
    expect(CODE_ALPHABET).toHaveLength(31);
    expect(new Set(CODE_ALPHABET).size).toBe(31);
    expect(CODE_ALPHABET).toMatch(/^[A-Z2-9]+$/);
    for (const c of "0O1IL") expect(CODE_ALPHABET).not.toContain(c);
  });
});

describe("typeOf (SD20)", () => {
  it("names a known type, 'unknown' for any other, 'unparseable' for the rest", () => {
    expect(typeOf('{"type":"colour","slot":9}')).toBe("colour");
    expect(typeOf('{"type":"newCode"}')).toBe("newCode");
    expect(typeOf('{"type":"ABC234"}')).toBe("unknown");
    expect(typeOf("not json")).toBe("unparseable");
    expect(typeOf("[1,2]")).toBe("unparseable");
    expect(typeOf("null")).toBe("unparseable");
    expect(typeOf('{"type":7}')).toBe("unparseable");
    expect(typeOf("{}")).toBe("unparseable");
  });
});
