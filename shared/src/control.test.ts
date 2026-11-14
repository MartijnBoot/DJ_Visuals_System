// T3 (B-04 spec SD19, SD20, SD21, AC17, AC33; plan PD11): every control message, both ways.
import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  DEVICE_RATE_PER_SECOND,
  deviceMessageSchema,
  MAX_DEVICE_MESSAGE,
  MAX_SCREEN_MESSAGE,
  PAIRING_LIMITS,
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
  cameras: [{ deviceId: "cam-1", label: "Front camera" }],
  cameraId: "cam-1",
  camera: "ok",
  audio: "idle",
  started: true,
  reason: null,
};
const entry = { deviceId: "d1", hint: "Safari on iPhone", label: "Device 1" };
const status = {
  on: true,
  addresses: [{ address: "192.168.1.5", name: "Wi-Fi" }],
  port: 8001,
  code: "ABC234",
  devices: [entry],
  pending: [],
};

const examples = {
  device: [
    { type: "hello", code: "ABC234" },
    { type: "hello", key: KEY },
    { type: "pick", seq: 1, id: "builtin" },
    { type: "dials", seq: 2, recognisability: 0.5 },
    { type: "dials", seq: 3, reactivity: 0, recognisability: 1 },
    { type: "colour", seq: 4, slot: 0, value: "#ff8800" },
    { type: "resetColour", seq: 5, slot: 5 },
    { type: "camera", seq: 6, deviceId: "cam-2" },
    { type: "refresh", seq: 7 },
    { type: "accept", deviceId: "d2" },
    { type: "reject", deviceId: "d2" },
  ],
  toDevice: [
    { type: "waiting" },
    { type: "approved", key: KEY, deviceId: "d1" },
    { type: "refused", reason: "wrong_code" },
    { type: "refused", reason: "rejected" },
    { type: "ended" },
    { type: "screen", connected: false },
    { type: "pending", requests: [entry] },
    { type: "state", state },
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
  ],
  toScreen: [
    { type: "control", deviceId: "d1", control: { type: "pick", seq: 1, id: "x" } },
    { type: "status", status },
    { type: "status", status: { ...status, on: false, code: null, error: "no_address" } },
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

  it("takes a hello with exactly one of a code or a key, the code from the alphabet", () => {
    expect(fails({ type: "hello" })).toBe(true);
    expect(fails({ type: "hello", code: "ABC234", key: KEY })).toBe(true);
    expect(fails({ type: "hello", code: "ABC23" })).toBe(true);
    expect(fails({ type: "hello", code: "ABC230" })).toBe(true); // 0 is not in the alphabet
    expect(fails({ type: "hello", code: "abc234" })).toBe(true);
    expect(fails({ type: "hello", key: "short" })).toBe(true);
  });
});

describe("the constants (SD19, SD20, SD21, PD3)", () => {
  it("are the spec's numbers", () => {
    expect(MAX_DEVICE_MESSAGE).toBe(4096);
    expect(MAX_SCREEN_MESSAGE).toBe(262144);
    expect(DEVICE_RATE_PER_SECOND).toBe(120);
    expect(CODE_LENGTH).toBe(6);
    expect(PAIRING_LIMITS).toEqual({
      approved: 8,
      pending: 4,
      requestExpiryMs: 60_000,
      wrongCodes: 5,
      wrongCodeWindowMs: 60_000,
      throttleMs: 60_000,
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
