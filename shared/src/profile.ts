// The profile (B-02 spec SD1, SD11, SD12, SD14; Data → Profile definition) and its file format
// (SD7). Defined once here and validated identically by the builder, the server and import
// (SDR decision B). `engine/` declares the same shape on its own side; `web/` checks at type
// level that the two stay compatible (AC19).
import { z } from "zod";

/** The library, in the spec's table order (SD3). */
export const EFFECT_TYPES = [
  "pixelate",
  "posterise",
  "smear",
  "zoom",
  "displace",
  "flash",
  "grain",
  "edges",
  "brightness",
  "paletteMap",
  "mirror",
  "rgbSplit",
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

/** The five B-01 audio features a binding may name (SD4). */
export const FEATURE_NAMES = ["level", "low", "mid", "high", "beat"] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

export const LIMITS = {
  nameLength: 60,
  effects: 12,
  paletteMin: 2,
  paletteMax: 6,
  segmentsMin: 2,
  segmentsMax: 8,
} as const;

/** A custom effect's limits (B-03 SD16). Apart from `LIMITS`, which B-02 fixed. */
export const CUSTOM_LIMITS = {
  labelLength: 40,
  params: 4,
  paramNameLength: 24,
  codeBytes: 8192,
} as const;

/** Effects whose own parameter is a palette slot for their colour (SD11). */
export const COLOUR_SLOT_TYPES = ["flash", "grain", "edges"] as const;

const unit = z.number().min(0).max(1);
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a colour as #rrggbb");

const bindingSchema = z.strictObject({ feature: z.enum(FEATURE_NAMES), amount: unit });
/** `dj` and `vj`: a fader for this effect on `/control` in that mode (B-18 SD3); absent is off. */
const common = {
  amount: unit,
  binding: bindingSchema.optional(),
  dj: z.boolean().optional(),
  vj: z.boolean().optional(),
};
const colourSlot = z.number().int().nonnegative();

const plain = <T extends EffectType>(type: T) =>
  z.strictObject({ type: z.literal(type), ...common });
const slotted = <T extends EffectType>(type: T) =>
  z.strictObject({ type: z.literal(type), ...common, colourSlot });

/** Text without a non-space character is empty for a label or a parameter name. */
const named = (max: number, what: string) =>
  z
    .string()
    .max(max, `${what} is 1 to ${max} characters`)
    .regex(/\S/, `${what} is 1 to ${max} characters`);

/**
 * The code checks of B-03 SD16 (plan PD6): one message per rule the code breaks. They keep a
 * body inside its function; the compiler is the real check. Line ends are read as the GLSL
 * compiler reads them (CR, LF or CRLF, so a lone CR ends a `//` comment), and a backslash before
 * one is joined first, as the compiler joins it, so a continued line cannot hide anything.
 */
export function customCodeIssues(code: string): string[] {
  const issues: string[] = [];
  if (utf8Bytes(code) > CUSTOM_LIMITS.codeBytes) {
    issues.push(`code is at most ${CUSTOM_LIMITS.codeBytes} bytes`);
  }
  if (code.includes("#")) issues.push("code may not contain # (no preprocessor)");
  const joined = code.replace(/\r\n?/g, "\n").replace(/\\\n/g, "");
  if (/\buniform\b/.test(joined)) issues.push("code may not use the word uniform");
  if (/^[ \t]*(?:in|out|inout)\s/m.test(joined)) {
    issues.push("code may not declare in, out or inout at the start of a line");
  }
  const braces = braceProblem(joined);
  if (braces) issues.push(braces);
  return issues;
}

/** The UTF-8 length, as `TextEncoder` gives it (a lone surrogate is U+FFFD, 3 bytes). */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Braces counted outside comments must never close the function and must end balanced. */
function braceProblem(code: string): string | null {
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const pair = code.slice(i, i + 2);
    if (pair === "//") {
      const end = code.indexOf("\n", i);
      if (end < 0) break;
      i = end;
    } else if (pair === "/*") {
      const end = code.indexOf("*/", i + 2);
      if (end < 0) return "code has a /* comment that is never closed";
      i = end + 1;
    } else if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth < 0) return "code has a closing brace with no opening one";
  }
  return depth === 0 ? null : "code has an opening brace that is never closed";
}

/** A custom effect (B-03 SD1, SD4, SD12, SD16): GLSL code as one more link in the chain. */
const customEffectSchema = z.strictObject({
  type: z.literal("custom"),
  label: named(CUSTOM_LIMITS.labelLength, "a label"),
  ...common,
  abstraction: z.boolean(),
  params: z
    .array(
      z.strictObject({
        name: named(CUSTOM_LIMITS.paramNameLength, "a parameter name"),
        value: unit,
      }),
    )
    .max(CUSTOM_LIMITS.params),
  code: z.string().superRefine((code, ctx) => {
    for (const message of customCodeIssues(code)) ctx.addIssue({ code: "custom", message });
  }),
});

export const effectSchema = z.discriminatedUnion("type", [
  plain("pixelate"),
  plain("posterise"),
  plain("smear"),
  plain("zoom"),
  plain("displace"),
  slotted("flash"),
  slotted("grain"),
  slotted("edges"),
  plain("brightness"),
  plain("paletteMap"),
  z.strictObject({
    type: z.literal("mirror"),
    ...common,
    segments: z.number().int().min(LIMITS.segmentsMin).max(LIMITS.segmentsMax),
  }),
  plain("rgbSplit"),
  customEffectSchema,
]);

/** The profile's fields, for the shapes that add to them (`profile-api.ts`). */
export const profileFields = {
  name: z.string().trim().min(1).max(LIMITS.nameLength),
  palette: z.array(colour).min(LIMITS.paletteMin).max(LIMITS.paletteMax),
  dials: z.strictObject({ recognisability: unit, reactivity: unit }),
  effects: z.array(effectSchema).max(LIMITS.effects),
  /** The palette slot a one-tap colour control aims at (B-04 SD10); derived when absent. */
  primary: z.number().int().nonnegative().optional(),
};

type ProfileShape = z.infer<z.ZodObject<typeof profileFields>>;

/**
 * The cross-field rules: each built-in type at most once (SD12), every slot inside the palette
 * (SD11), and the primary slot inside the palette (B-04 SD10). A custom effect may repeat, with
 * a label unique in the profile (trimmed, case-sensitive) and parameter names unique in the
 * effect (B-03 SD4, PD5). At most one effect has the DJ fader (B-18 SD2).
 */
export function checkProfileRules(profile: ProfileShape, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  const labels = new Set<string>();
  let djTaken = false;
  profile.effects.forEach((effect, i) => {
    if (effect.dj === true) {
      if (djTaken) {
        ctx.addIssue({
          code: "custom",
          path: ["effects", i, "dj"],
          message: `effect ${i} is the second with the DJ fader; one effect has it`,
        });
      }
      djTaken = true;
    }
    if (effect.type === "custom") {
      const label = effect.label.trim();
      if (labels.has(label)) {
        ctx.addIssue({
          code: "custom",
          path: ["effects", i, "label"],
          message: `the label "${label}" appears more than once`,
        });
      }
      labels.add(label);
      const names = new Set<string>();
      effect.params.forEach((param, j) => {
        if (names.has(param.name)) {
          ctx.addIssue({
            code: "custom",
            path: ["effects", i, "params", j, "name"],
            message: `the parameter "${param.name}" appears more than once`,
          });
        }
        names.add(param.name);
      });
      return;
    }
    if (seen.has(effect.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["effects", i, "type"],
        message: `"${effect.type}" appears more than once`,
      });
    }
    seen.add(effect.type);
    if ("colourSlot" in effect && effect.colourSlot >= profile.palette.length) {
      ctx.addIssue({
        code: "custom",
        path: ["effects", i, "colourSlot"],
        message: `colour slot ${effect.colourSlot} is outside a palette of ${profile.palette.length}`,
      });
    }
  });
  if (profile.primary !== undefined && profile.primary >= profile.palette.length) {
    ctx.addIssue({
      code: "custom",
      path: ["primary"],
      message: `primary slot ${profile.primary} is outside a palette of ${profile.palette.length}`,
    });
  }
}

export const profileSchema = z.strictObject(profileFields).superRefine(checkProfileRules);

export type Profile = z.infer<typeof profileSchema>;
export type Effect = Profile["effects"][number];
export type CustomEffect = Extract<Effect, { type: "custom" }>;

/**
 * The primary colour's slot (B-04 SD10, AC38): the stored `primary`, else the `colourSlot` of
 * the first effect in stack order that has one, else 0. The built-in derives 1.
 */
export function derivePrimary(profile: Pick<Profile, "effects" | "primary">): number {
  if (profile.primary !== undefined) return profile.primary;
  for (const effect of profile.effects) {
    if ("colourSlot" in effect) return effect.colourSlot;
  }
  return 0;
}

/**
 * The file versions import reads (B-03 SD15, PD13; B-18 SD3): 1 holds no custom effect, so a
 * B-02 instance reads it; 2 may hold custom effects; 3 may hold the fader flags.
 */
export const SUPPORTED_FORMAT_VERSIONS = [1, 2, 3] as const;

/** Whether import reads this `formatVersion`; any other is "unsupported", checked first. */
export function isSupportedFormatVersion(version: number): boolean {
  return (SUPPORTED_FORMAT_VERSIONS as readonly number[]).includes(version);
}

const holdsCustom = (profile: Pick<Profile, "effects">) =>
  profile.effects.some((e) => e.type === "custom");

/** Whether any effect has a fader flag set (B-18 SD3): such a file is version 3. */
export const holdsFlags = (profile: Pick<Profile, "effects">) =>
  profile.effects.some((e) => e.dj === true || e.vj === true);

const FLAG_KEYS = ["dj", "vj"] as const;

/** The export and import file (SD7): one profile or a bundle, one code path. */
export const profileFileSchema = z
  .strictObject({
    formatVersion: z.literal(SUPPORTED_FORMAT_VERSIONS),
    profiles: z.array(profileSchema).min(1),
  })
  .superRefine((file, ctx) => {
    if (file.formatVersion === 1 && file.profiles.some(holdsCustom)) {
      ctx.addIssue({
        code: "custom",
        path: ["formatVersion"],
        message: "a file with a custom effect is formatVersion 2",
      });
    }
    // B-18 SD3, plan PD3: before version 3 the flags are stray keys, refused as one is today.
    if (file.formatVersion === 3) return;
    file.profiles.forEach((profile, n) => {
      profile.effects.forEach((effect, m) => {
        const keys = FLAG_KEYS.filter((key) => key in effect);
        if (keys.length > 0) {
          ctx.addIssue({ code: "unrecognized_keys", keys, path: ["profiles", n, "effects", m] });
        }
      });
    });
  });

export type ProfileFile = z.infer<typeof profileFileSchema>;

/** An effect as the file writes it: a flag only when it is on (B-18 SD3, plan PD3). */
function fileEffect(effect: Effect): Effect {
  if (effect.dj === undefined && effect.vj === undefined) return effect;
  const { dj, vj, ...rest } = effect;
  return { ...rest, ...(dj ? { dj } : {}), ...(vj ? { vj } : {}) } as Effect;
}

/**
 * The file for some profiles: their definitions only, never an id, revision or timestamp (AC9).
 * `primary` only when set, so a file without it stays what B-02 wrote (B-04 AC39). Version 1
 * unless a profile holds a custom effect (B-03 SD15), 3 when an effect has a flag on (B-18 SD3).
 */
export function toProfileFile(profiles: readonly Profile[]): ProfileFile {
  const formatVersion = profiles.some(holdsFlags) ? 3 : profiles.some(holdsCustom) ? 2 : 1;
  return {
    formatVersion,
    profiles: profiles.map(({ name, palette, dials, effects, primary }) => ({
      name,
      palette,
      dials,
      effects: effects.map(fileEffect),
      ...(primary === undefined ? {} : { primary }),
    })),
  };
}
