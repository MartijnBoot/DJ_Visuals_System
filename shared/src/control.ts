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
/** A WebRTC setup message's size limit on any socket (B-06 SD16, PD4): an SDP does not fit 4 KB. */
export const MAX_SETUP_MESSAGE = 16384;
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
  /** B-06 SD12, SD8: a device sending both counts in both. */
  videoSenders: 4,
  audioSenders: 1,
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

/** What a sender sends (B-06 SD6, SD14): empty for a controller. */
export const SEND_KINDS = ["video", "audio"] as const;
export type SendKind = (typeof SEND_KINDS)[number];
const sendKind = z.enum(SEND_KINDS);
const unique = (list: readonly string[]) => new Set(list).size === list.length;
/** A request's kinds: one or two, no repeats. */
const sendsRequest = z.array(sendKind).min(1).max(2).refine(unique, "no repeated kind");
/** A device's kinds as the server lists them: empty for a controller. */
const sends = z.array(sendKind).max(2).refine(unique, "no repeated kind");

/** WebRTC setup (B-06 SD16, PD4): the server relays these and reads nothing inside them. */
const sdp = z.string().min(1).max(16_000);
const candidateShape = {
  candidate: z.string().max(1_000),
  sdpMid: z.string().max(64).nullable(),
  sdpMLineIndex: z.number().int().nonnegative().max(65535).nullable(),
};

const message = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), ...shape });

/** B-09 SD1, SD19: how a pick switches. */
export const TRANSITION_KINDS = ["cut", "crossfade", "dissolve", "wipe", "beatCut", "dip"] as const;
export const transitionKind = z.enum(TRANSITION_KINDS);
export type TransitionKind = z.infer<typeof transitionKind>;
/** B-09 SD6: the duration in seconds. */
const transitionDuration = z.number().min(0.5).max(8);

/** B-09 SD5, SD9: the current transition, in the screen state and in `djv.transition`. */
export const transitionChoiceSchema = z.strictObject({
  kind: transitionKind,
  duration: transitionDuration,
  keepColour: z.boolean(),
});
export type TransitionChoice = z.infer<typeof transitionChoiceSchema>;

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
  /** B-06 SD22: the main-audio choice. */
  message("mainAudio", { seq, source: z.enum(["remote", "local"]) }),
  /** B-09 SD19: changes the current transition; at least one field. */
  message("transition", {
    seq,
    kind: transitionKind.optional(),
    duration: transitionDuration.optional(),
    keepColour: z.boolean().optional(),
  }).refine((m) => m.kind !== undefined || m.duration !== undefined || m.keepColour !== undefined, {
    message: "names at least one of kind, duration and keepColour",
  }),
]);
export type Control = z.infer<typeof controlSchema>;
export type ControlType = Control["type"];

// ---- Device → server. `newCode` and `disconnect` are not here (AC17). A sender may send only
// `hello`, `offer` and `candidate`; the server enforces the role (B-06 SD6). ----

export const deviceMessageSchema = z.discriminatedUnion("type", [
  message("hello", {
    code: code.optional(),
    key: key.optional(),
    sends: sendsRequest.optional(),
  })
    .refine((m) => (m.code === undefined) !== (m.key === undefined), {
      message: "carries a code or a key",
    })
    .refine((m) => m.sends === undefined || m.code !== undefined, {
      message: "names what it sends only with a code",
    }),
  ...controlSchema.options,
  message("accept", { deviceId }),
  message("reject", { deviceId }),
  message("offer", { sdp }),
  message("candidate", candidateShape),
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
    .array(
      z.strictObject({
        deviceId: z.string().max(500),
        label: z.string().max(500),
        /** A sender's camera, id `remote:<deviceId>` (B-06 SD21). */
        remote: z.boolean(),
      }),
    )
    .max(64),
  cameraId: z.string().max(500).nullable(),
  camera: sourceState,
  audio: sourceState,
  started: z.boolean(),
  /** The panel's profile reason, word for word (AC26); null when there is none. */
  reason: z.string().max(500).nullable(),
  /** B-06 SD22: null while no audio sender is approved. */
  mainAudio: z
    .strictObject({
      choice: z.enum(["remote", "local"]),
      playing: z.enum(["remote", "local"]),
      /** The audio sender's sequence label. */
      label: z.string().max(40),
    })
    .nullable(),
  /** B-09 SD19: the current transition. */
  transition: transitionChoiceSchema,
});
export type ScreenState = z.infer<typeof screenStateSchema>;

/** A device as the panel and controllers list it: the hint and the sequence label (SD26). */
export const deviceEntrySchema = z.strictObject({
  deviceId,
  hint: z.string().max(100),
  label: z.string().max(40),
  /** B-06 SD6: what it sends; empty for a controller. */
  sends,
});
export type DeviceEntry = z.infer<typeof deviceEntrySchema>;

export const REFUSAL_REASONS = [
  "wrong_code",
  "throttled",
  "too_many",
  "ended",
  "expired",
  "rejected",
  "audio_taken",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

// ---- Server → device. A sender receives only the pairing messages, `screen`, and setup. ----

export const toDeviceSchema = z.discriminatedUnion("type", [
  message("waiting", {}),
  message("approved", { key, deviceId, sends }),
  message("refused", { reason: z.enum(REFUSAL_REASONS) }),
  message("ended", {}),
  message("screen", { connected: z.boolean() }),
  message("pending", { requests: z.array(deviceEntrySchema).max(PAIRING_LIMITS.pending) }),
  message("state", { state: screenStateSchema }),
  message("applied", { seq }),
  message("answer", { sdp }),
  message("candidate", candidateShape),
  /** B-06 SD12: pause (false) or resume (true) the sender's encoding of one kind. */
  message("stream", { kind: sendKind, active: z.boolean() }),
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
  message("answer", { deviceId, sdp }),
  message("candidate", { deviceId, ...candidateShape }),
  message("stream", { deviceId, kind: sendKind, active: z.boolean() }),
]);
export type ScreenMessage = z.infer<typeof screenMessageSchema>;

// ---- Server → screen page. ----

export const CONTROL_ERRORS = ["no_address", "port_in_use", "unavailable", "cert_store"] as const;
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
  /** B-06 PD5: approved senders; `online` while the sender's socket is open. */
  senders: z.array(deviceEntrySchema.extend({ online: z.boolean() })),
  /** The local root's fingerprint while on (B-06 SD24): 16 hex characters. */
  fingerprint: z
    .string()
    .regex(/^[0-9A-F]{16}$/)
    .nullable(),
  error: z.enum(CONTROL_ERRORS).optional(),
});
export type ControlStatus = z.infer<typeof statusSchema>;

export const toScreenSchema = z.discriminatedUnion("type", [
  message("control", { deviceId, control: controlSchema }),
  message("status", { status: statusSchema }),
  message("superseded", {}),
  message("offer", { deviceId, sdp }),
  message("candidate", { deviceId, ...candidateShape }),
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
