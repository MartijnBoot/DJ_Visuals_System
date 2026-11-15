// External control's messages (B-04 spec SD20, API contract; plan PD3, PD11): every message on
// the screen socket and the device socket, both ways, defined once. The server validates every
// message it receives before acting or relaying, and each page validates every message it
// receives. Field names are the plan's; colours are `#rrggbb` as in the profile.
import { z } from "zod";
import { LIMITS } from "./profile.ts";

/** A device socket's message size limit (SD20). */
export const MAX_DEVICE_MESSAGE = 4096;
/** The screen socket's: same-origin and `127.0.0.1` only, and it carries the list (PD3). */
export const MAX_SCREEN_MESSAGE = 262144;
/** Messages per sliding second a device socket may send; the excess is dropped (SD20). */
export const DEVICE_RATE_PER_SECOND = 120;

/** Uppercase letters and digits without `0 O 1 I L` (SD19). */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/** SD18, SD19, SD21. */
export const PAIRING_LIMITS = {
  approved: 8,
  pending: 4,
  requestExpiryMs: 60_000,
  wrongCodes: 5,
  wrongCodeWindowMs: 60_000,
  throttleMs: 60_000,
} as const;

const unit = z.number().min(0).max(1);
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a colour as #rrggbb");
const slot = z
  .number()
  .int()
  .nonnegative()
  .lt(LIMITS.paletteMax, `a slot is below ${LIMITS.paletteMax}`);
const seq = z.number().int().nonnegative();
const id = z.string().min(1).max(200);
const deviceId = z.string().min(1).max(64);
const code = z
  .string()
  .length(CODE_LENGTH)
  .regex(new RegExp(`^[${CODE_ALPHABET}]+$`), "not a pairing code");
/** 128 bits as base64url: 22 characters. */
const key = z.string().regex(/^[A-Za-z0-9_-]{22}$/, "not a session key");

const message = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), ...shape });

// ---- Controls: what a controller asks the screen page to do. Each carries `seq`. ----

export const controlSchema = z.discriminatedUnion("type", [
  message("pick", { seq, id }),
  message("dials", {
    seq,
    recognisability: unit.optional(),
    reactivity: unit.optional(),
  }).refine((m) => m.recognisability !== undefined || m.reactivity !== undefined, {
    message: "names at least one dial",
  }),
  message("colour", { seq, slot, value: colour }),
  message("resetColour", { seq, slot }),
  message("camera", { seq, deviceId: z.string().min(1).max(500) }),
  message("refresh", { seq }),
]);
export type Control = z.infer<typeof controlSchema>;
export type ControlType = Control["type"];

// ---- Controller → server. `newCode` and `disconnect` are not here (AC17). ----

export const deviceMessageSchema = z.discriminatedUnion("type", [
  message("hello", { code: code.optional(), key: key.optional() }).refine(
    (m) => (m.code === undefined) !== (m.key === undefined),
    { message: "carries a code or a key" },
  ),
  ...controlSchema.options,
  message("accept", { deviceId }),
  message("reject", { deviceId }),
]);
export type DeviceMessage = z.infer<typeof deviceMessageSchema>;

// ---- The state the screen page sends, relayed to every approved controller (SD5). ----

const sourceState = z.enum(["idle", "ok", "lost", "none"]);

export const screenStateSchema = z.strictObject({
  profiles: z.array(z.strictObject({ id, name: z.string().max(200) })).max(1000),
  activeId: id,
  /** The live palette (SD7). */
  palette: z.array(colour).min(LIMITS.paletteMin).max(LIMITS.paletteMax),
  /** The stored palette, for the wheel's "stored colour" and Reset. */
  storedPalette: z.array(colour).min(LIMITS.paletteMin).max(LIMITS.paletteMax),
  /** Stored, or derived when absent (SD10). */
  primary: slot,
  dials: z.strictObject({ recognisability: unit, reactivity: unit }),
  cameras: z
    .array(z.strictObject({ deviceId: z.string().max(500), label: z.string().max(500) }))
    .max(64),
  cameraId: z.string().max(500).nullable(),
  camera: sourceState,
  audio: sourceState,
  started: z.boolean(),
  /** The panel's profile reason, word for word (AC26); null when there is none. */
  reason: z.string().max(500).nullable(),
});
export type ScreenState = z.infer<typeof screenStateSchema>;

/** A device as the panel and controllers list it: the hint and the sequence label (SD26). */
export const deviceEntrySchema = z.strictObject({
  deviceId,
  hint: z.string().max(100),
  label: z.string().max(40),
});
export type DeviceEntry = z.infer<typeof deviceEntrySchema>;

export const REFUSAL_REASONS = [
  "wrong_code",
  "throttled",
  "too_many",
  "ended",
  "expired",
  "rejected",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

// ---- Server → controller. ----

export const toDeviceSchema = z.discriminatedUnion("type", [
  message("waiting", {}),
  message("approved", { key, deviceId }),
  message("refused", { reason: z.enum(REFUSAL_REASONS) }),
  message("ended", {}),
  message("screen", { connected: z.boolean() }),
  message("pending", { requests: z.array(deviceEntrySchema).max(PAIRING_LIMITS.pending) }),
  message("state", { state: screenStateSchema }),
  message("applied", { seq }),
]);
export type ToDevice = z.infer<typeof toDeviceSchema>;

// ---- Screen page → server. ----

export const appliedEntrySchema = z.strictObject({ deviceId, seq });
export type AppliedEntry = z.infer<typeof appliedEntrySchema>;

export const screenMessageSchema = z.discriminatedUnion("type", [
  message("state", { state: screenStateSchema }),
  /** One per frame: every control that frame applied (PD3). */
  message("applied", { entries: z.array(appliedEntrySchema).min(1).max(1000) }),
  message("enable", {}),
  message("disable", {}),
  message("newCode", {}),
  message("disconnect", { deviceId }),
  message("accept", { deviceId }),
  message("reject", { deviceId }),
]);
export type ScreenMessage = z.infer<typeof screenMessageSchema>;

// ---- Server → screen page. ----

export const CONTROL_ERRORS = ["no_address", "port_in_use", "unavailable"] as const;
export type ControlError = (typeof CONTROL_ERRORS)[number];

export const statusSchema = z.strictObject({
  on: z.boolean(),
  /** The bound addresses with their adapter names, in the order bound (SD14). */
  addresses: z.array(z.strictObject({ address: z.string(), name: z.string() })),
  /** `CONTROL_PORT`, for the URL in the QR code. */
  port: z.number().int().min(1).max(65535),
  code: code.nullable(),
  devices: z.array(deviceEntrySchema),
  pending: z.array(deviceEntrySchema),
  error: z.enum(CONTROL_ERRORS).optional(),
});
export type ControlStatus = z.infer<typeof statusSchema>;

export const toScreenSchema = z.discriminatedUnion("type", [
  message("control", { deviceId, control: controlSchema }),
  message("status", { status: statusSchema }),
  message("superseded", {}),
]);
export type ToScreen = z.infer<typeof toScreenSchema>;

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  ...deviceMessageSchema.options.map((o) => o.shape.type.value),
  ...screenMessageSchema.options.map((o) => o.shape.type.value),
]);

/**
 * The type to name in a dropped message's `warn` (SD20): a known message type, `"unknown"` for
 * any other type (a sender's own text never reaches a log line, SD27), or `"unparseable"`.
 */
export function typeOf(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "unparseable";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "unparseable";
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string") return "unparseable";
  return KNOWN_TYPES.has(type) ? type : "unknown";
}
