// The profile as the engine takes it (B-02 spec SD1, SD2, SD4, SD8, SD17; plan PD5, PD6). The
// engine's own copy of the shape: `engine/` never imports `shared/` or any package, and `web/`
// checks at type level that this `Profile` and the shared schema's stay compatible (AC19).
// The strength of each effect, and every uniform the shader reads, is a pure function here, so
// the built-in profile's equality with B-01's `lookUniforms` is tested without a GPU (AC15).
import { driftColour, type Rgb } from "./colour.ts";
import type { AudioFeatures, Dials } from "./features.ts";
import {
  BLOCKS_ACROSS_AT_MAX,
  BRIGHTNESS_MAX,
  DISPLACE_MAX,
  EDGE_MAX,
  FEEDBACK_MAX,
  FLASH_MAX,
  GRAIN_MAX,
  LEVELS_AT_MAX,
  TIME_WRAP_S,
  ZOOM_MAX,
} from "./look.ts";

export type FeatureName = "level" | "low" | "mid" | "high" | "beat";

export interface Binding {
  feature: FeatureName;
  amount: number;
}

interface EffectOf<T extends string> {
  type: T;
  /** Base strength, 0 to 1. */
  amount: number;
  binding?: Binding;
  /** A fader on the controller in DJ or VJ mode (B-18 SD3). The engine never reads them. */
  dj?: boolean;
  vj?: boolean;
}

type Slotted<T extends string> = EffectOf<T> & { colourSlot: number };

/** A custom effect's named parameter (B-03 SD4). */
export interface CustomParam {
  name: string;
  /** 0 to 1. */
  value: number;
}

/** GLSL code as one more link in the chain (B-03 SD1, SD3, SD4, SD12). */
export interface CustomEffect {
  type: "custom";
  /** Unique in the profile. */
  label: string;
  /** Base strength, 0 to 1. */
  amount: number;
  binding?: Binding;
  /** A fader on the controller in DJ or VJ mode (B-18 SD3). The engine never reads them. */
  dj?: boolean;
  vj?: boolean;
  /** Scaled by recognisability (SD12). */
  abstraction: boolean;
  /** 0 to 4, in the order the code reads them. */
  params: CustomParam[];
  /** A GLSL function body; it only ever reaches `shaderSource`. */
  code: string;
}

/** The twelve effects of the library (B-02 SD3). */
export type BuiltInEffect =
  | EffectOf<"pixelate">
  | EffectOf<"posterise">
  | EffectOf<"smear">
  | EffectOf<"zoom">
  | EffectOf<"displace">
  | Slotted<"flash">
  | Slotted<"grain">
  | Slotted<"edges">
  | EffectOf<"brightness">
  | EffectOf<"paletteMap">
  | (EffectOf<"mirror"> & { segments: number })
  | EffectOf<"rgbSplit">;

export type Effect = BuiltInEffect | CustomEffect;

/** The built-in types only: `custom` is not in the library (B-03 PD5). */
export type EffectType = BuiltInEffect["type"];

export interface Profile {
  name: string;
  /** 2 to 6 colours as `#rrggbb`. */
  palette: string[];
  /** The dials' starting values (SD2). */
  dials: Dials;
  /** Draw order: the first is applied to the picture first (SD12). */
  effects: Effect[];
  /** The primary colour's palette slot (B-04 SD10). The engine never reads it. */
  primary?: number;
}

export interface EffectInfo {
  /** Scaled by recognisability (SD2). */
  abstraction: boolean;
  /** The effect's own parameter, if it has one. */
  parameter: "colourSlot" | "segments" | null;
}

/** The library (SD3), in the spec's table order. */
export const EFFECTS: Readonly<Record<EffectType, EffectInfo>> = Object.freeze({
  pixelate: { abstraction: true, parameter: null },
  posterise: { abstraction: true, parameter: null },
  smear: { abstraction: true, parameter: null },
  zoom: { abstraction: false, parameter: null },
  displace: { abstraction: false, parameter: null },
  flash: { abstraction: false, parameter: "colourSlot" },
  grain: { abstraction: false, parameter: "colourSlot" },
  edges: { abstraction: false, parameter: "colourSlot" },
  brightness: { abstraction: false, parameter: null },
  paletteMap: { abstraction: false, parameter: null },
  mirror: { abstraction: false, parameter: "segments" },
  rgbSplit: { abstraction: false, parameter: null },
});

/** RGB split at strength 1: red and blue offset by 3% of the width (spec Data table). */
export const RGB_SPLIT_MAX = 0.03;

/** Palette slots the shader holds (spec SD11). */
export const PALETTE_SLOTS = 6;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * SD4: `clamp01(base × (abstraction ? recognisability : 1) + binding × feature × reactivity)`.
 * A custom effect carries its own abstraction flag (B-03 SD12).
 */
export function effectStrength(effect: Effect, features: AudioFeatures, dials: Dials): number {
  const abstraction =
    effect.type === "custom" ? effect.abstraction : EFFECTS[effect.type].abstraction;
  const scale = abstraction ? clamp01(dials.recognisability) : 1;
  const base = clamp01(effect.amount) * scale;
  const binding = effect.binding;
  const bound = binding
    ? clamp01(binding.amount) * clamp01(features[binding.feature]) * clamp01(dials.reactivity)
    : 0;
  return clamp01(base + bound);
}

export interface ProfileUniforms {
  /** Seconds, wrapped. Drives the noise field and the grain seed. */
  time: number;
  tint: Rgb;
  /** 1 without a camera, 0 with one: the camera is never tinted. */
  tintWeight: number;
  /** Block size in render pixels: 1 is no pixelation; also keys the per-block noise. */
  block: number;
  /** Posterise levels per channel: 256 is none. */
  levels: number;
  /** Share of the previous frame mixed in. */
  feedback: number;
  zoom: number;
  displace: number;
  /** Mix toward the flash colour, never above `FLASH_MAX` (AC24). */
  flash: number;
  grain: number;
  edges: number;
  brightness: number;
  /** Mix toward the palette-mapped picture. */
  paletteMix: number;
  /** Move from the plain coordinate toward the mirrored one. */
  mirror: number;
  segments: number;
  /** Red and blue offset, in frame widths. */
  rgbSplit: number;
  /** Always `PALETTE_SLOTS` long; the first `paletteSize` are the profile's. */
  palette: Rgb[];
  paletteSize: number;
  flashColour: Rgb;
  grainColour: Rgb;
  edgesColour: Rgb;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [1, 1, 1];

/** `#rrggbb` as 0–1 channels; anything else is black. */
export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return BLACK;
  return [1, 2, 3].map((i) => parseInt(match[i]!, 16) / 255) as unknown as Rgb;
}

/** Every uniform of a frame (PD6): the built-in's equal B-01's `lookUniforms` (AC15). */
export function profileUniforms(
  profile: Profile,
  features: AudioFeatures,
  dials: Dials,
  timestamp: number,
  hasSource: boolean,
  width: number,
): ProfileUniforms {
  const palette = profile.palette.slice(0, PALETTE_SLOTS).map(hexToRgb);
  const slot = (index: number): Rgb =>
    palette[Math.min(Math.max(0, Math.floor(index) || 0), palette.length - 1)] ?? WHITE;
  const t = Number.isFinite(timestamp) ? timestamp : 0;
  const maxBlock = Math.max(1, (Number.isFinite(width) ? width : 0) / BLOCKS_ACROSS_AT_MAX);

  const u: ProfileUniforms = {
    time: (t / 1000) % TIME_WRAP_S,
    tint: driftColour(t),
    tintWeight: hasSource ? 0 : 1,
    block: 1,
    levels: 256,
    feedback: 0,
    zoom: 1,
    displace: 0,
    flash: 0,
    grain: 0,
    edges: 0,
    brightness: 0,
    paletteMix: 0,
    mirror: 0,
    segments: 2,
    rgbSplit: 0,
    palette: Array.from({ length: PALETTE_SLOTS }, (_, i) => palette[i] ?? BLACK),
    paletteSize: palette.length,
    flashColour: WHITE,
    grainColour: WHITE,
    edgesColour: WHITE,
  };

  for (const effect of profile.effects) {
    const s = effectStrength(effect, features, dials);
    switch (effect.type) {
      // Geometric between the ends, as B-01: exact 1 and 256 at 0, width/32 and 4 at 1.
      case "pixelate":
        u.block = maxBlock ** s;
        break;
      case "posterise":
        u.levels = 256 ** (1 - s) * LEVELS_AT_MAX ** s;
        break;
      case "smear":
        u.feedback = FEEDBACK_MAX * s;
        break;
      case "zoom":
        u.zoom = 1 + ZOOM_MAX * s;
        break;
      case "displace":
        u.displace = DISPLACE_MAX * s;
        break;
      case "flash":
        u.flash = FLASH_MAX * s;
        u.flashColour = slot(effect.colourSlot);
        break;
      case "grain":
        u.grain = GRAIN_MAX * s;
        u.grainColour = slot(effect.colourSlot);
        break;
      case "edges":
        u.edges = EDGE_MAX * s;
        u.edgesColour = slot(effect.colourSlot);
        break;
      case "brightness":
        u.brightness = BRIGHTNESS_MAX * s;
        break;
      case "paletteMap":
        u.paletteMix = s;
        break;
      case "mirror":
        u.mirror = s;
        u.segments = Math.min(8, Math.max(2, Math.round(effect.segments) || 2));
        break;
      case "rgbSplit":
        u.rgbSplit = RGB_SPLIT_MAX * s;
        break;
    }
  }
  return u;
}

/** Custom effects a profile can hold, and so the length of their uniform arrays (B-03 SD4). */
export const CUSTOM_SLOTS = 12;

/** Parameters a custom effect can have; each slot is a `vec4` (B-03 SD4). */
const CUSTOM_PARAMS = 4;

export interface CustomUniforms {
  /** Each custom effect's effective strength, in stack order; the rest 0. */
  strength: number[];
  /** Four values per custom effect, in declaration order, unset ones 0. */
  params: number[];
  /** Each feature × reactivity (PD1, owner 2026-11-15): at reactivity 0 code hears nothing. */
  audio: Record<FeatureName, number>;
}

/** The custom effects' uniforms of a frame (B-03 SD3, SD4, SD12; plan PD1, PD7). */
export function customUniforms(
  profile: Profile,
  features: AudioFeatures,
  dials: Dials,
): CustomUniforms {
  const strength = new Array<number>(CUSTOM_SLOTS).fill(0);
  const params = new Array<number>(CUSTOM_SLOTS * CUSTOM_PARAMS).fill(0);
  let slot = 0;
  for (const effect of profile.effects) {
    if (effect.type !== "custom" || slot >= CUSTOM_SLOTS) continue;
    strength[slot] = effectStrength(effect, features, dials);
    effect.params.slice(0, CUSTOM_PARAMS).forEach((param, i) => {
      params[slot * CUSTOM_PARAMS + i] = clamp01(param.value);
    });
    slot++;
  }
  const reactivity = clamp01(dials.reactivity);
  const heard = (name: FeatureName) => clamp01(features[name]) * reactivity;
  return {
    strength,
    params,
    audio: {
      level: heard("level"),
      low: heard("low"),
      mid: heard("mid"),
      high: heard("high"),
      beat: heard("beat"),
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * B-01's look as a profile (SD8, PD5). Composed in this order it is B-01's shader term for
 * term: block centre, zoom, displace, the source with edges; posterise, smear, brightness,
 * grain, flash. White in slot 1 is B-01's flash, grain and edge colour.
 */
export const BUILT_IN_PROFILE: Omit<Profile, "effects"> & { effects: BuiltInEffect[] } = deepFreeze(
  {
    name: "Built-in",
    palette: ["#000000", "#ffffff"],
    dials: { recognisability: 0.3, reactivity: 0.7 },
    effects: [
      { type: "edges", amount: 0, binding: { feature: "high", amount: 1 }, colourSlot: 1 },
      { type: "displace", amount: 0, binding: { feature: "beat", amount: 1 } },
      { type: "zoom", amount: 0, binding: { feature: "low", amount: 1 } },
      { type: "posterise", amount: 1 },
      { type: "smear", amount: 1 },
      { type: "brightness", amount: 0, binding: { feature: "level", amount: 1 } },
      { type: "grain", amount: 0, binding: { feature: "high", amount: 1 }, colourSlot: 1 },
      { type: "flash", amount: 0, binding: { feature: "beat", amount: 1 }, colourSlot: 1 },
      { type: "pixelate", amount: 1 },
    ],
  },
);
