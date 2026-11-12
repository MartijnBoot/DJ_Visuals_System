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

/** Effects whose own parameter is a palette slot for their colour (SD11). */
export const COLOUR_SLOT_TYPES = ["flash", "grain", "edges"] as const;

const unit = z.number().min(0).max(1);
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected a colour as #rrggbb");

const bindingSchema = z.strictObject({ feature: z.enum(FEATURE_NAMES), amount: unit });
const common = { amount: unit, binding: bindingSchema.optional() };
const colourSlot = z.number().int().nonnegative();

const plain = <T extends EffectType>(type: T) =>
  z.strictObject({ type: z.literal(type), ...common });
const slotted = <T extends EffectType>(type: T) =>
  z.strictObject({ type: z.literal(type), ...common, colourSlot });

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
]);

/** The profile's fields, for the shapes that add to them (`profile-api.ts`). */
export const profileFields = {
  name: z.string().trim().min(1).max(LIMITS.nameLength),
  palette: z.array(colour).min(LIMITS.paletteMin).max(LIMITS.paletteMax),
  dials: z.strictObject({ recognisability: unit, reactivity: unit }),
  effects: z.array(effectSchema).max(LIMITS.effects),
};

type ProfileShape = z.infer<z.ZodObject<typeof profileFields>>;

/** The cross-field rules: each type at most once (SD12), every slot inside the palette (SD11). */
export function checkProfileRules(profile: ProfileShape, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  profile.effects.forEach((effect, i) => {
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
}

export const profileSchema = z.strictObject(profileFields).superRefine(checkProfileRules);

export type Profile = z.infer<typeof profileSchema>;
export type Effect = Profile["effects"][number];

export const FORMAT_VERSION = 1;

/** The export and import file (SD7): one profile or a bundle, one code path. */
export const profileFileSchema = z.strictObject({
  formatVersion: z.literal(FORMAT_VERSION),
  profiles: z.array(profileSchema).min(1),
});

export type ProfileFile = z.infer<typeof profileFileSchema>;

/** The file for some profiles: their definitions only, never an id, revision or timestamp (AC9). */
export function toProfileFile(profiles: readonly Profile[]): ProfileFile {
  return {
    formatVersion: FORMAT_VERSION,
    profiles: profiles.map(({ name, palette, dials, effects }) => ({
      name,
      palette,
      dials,
      effects,
    })),
  };
}
