// B-01's look as a pure mapping (spec SD5, SD10; plan PD5, PD8, PD22): its constants, and
// `lookUniforms`, the reference the built-in profile is proven equal to (B-02 AC15, PD7). The
// constants are the effects' values at strength 1 (`profile.ts` imports them); the shader text
// is `shader.ts`, one snippet per effect.
import { driftColour, type Rgb } from "./colour.ts";
import type { AudioFeatures, Dials } from "./features.ts";

/** Audio terms at full reactivity and full feature (SD5's mapping). */
export const ZOOM_MAX = 0.12; // low band: the picture scales up by up to 12%
export const DISPLACE_MAX = 0.03; // beat: blocks jump by up to 3% of the frame
export const FLASH_MAX = 0.35; // beat: a mix toward white, bounded (spec Accessibility)
export const GRAIN_MAX = 0.2; // high band: per-block noise
export const EDGE_MAX = 1.2; // high band: brightened edges between blocks
export const BRIGHTNESS_MAX = 0.4; // level: up to 40% brighter

/** Recognisability terms at 1: blocks a 32nd of the width, 4 levels, heavy smear (PD8). */
export const BLOCKS_ACROSS_AT_MAX = 32;
export const LEVELS_AT_MAX = 4;
export const FEEDBACK_MAX = 0.85;

/** Shader time wraps so float precision holds over a long set; the field jumps once an hour. */
export const TIME_WRAP_S = 3600;

export interface LookUniforms {
  /** Seconds, wrapped. Drives the noise field and the grain seed. */
  time: number;
  tint: Rgb;
  /** 1 without a camera, 0 with one: the camera is never tinted (PD22). */
  tintWeight: number;
  /** Block size in render pixels: 1 is no pixelation. */
  block: number;
  /** Posterise levels per channel: 256 is none. */
  levels: number;
  /** Share of the previous frame mixed in: 0 is none. */
  feedback: number;
  zoom: number;
  displace: number;
  flash: number;
  grain: number;
  edges: number;
  brightness: number;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function lookUniforms(
  features: AudioFeatures,
  dials: Dials,
  timestamp: number,
  hasSource: boolean,
  width: number,
): LookUniforms {
  const r = clamp01(dials.recognisability);
  const k = clamp01(dials.reactivity);
  const maxBlock = Math.max(1, width / BLOCKS_ACROSS_AT_MAX);
  return {
    time: (timestamp / 1000) % TIME_WRAP_S,
    tint: driftColour(timestamp),
    tintWeight: hasSource ? 0 : 1,
    // Geometric between the ends: exact 1 and 256 at 0, exact width/32 and 4 at 1.
    block: maxBlock ** r,
    levels: 256 ** (1 - r) * LEVELS_AT_MAX ** r,
    feedback: FEEDBACK_MAX * r,
    zoom: 1 + ZOOM_MAX * clamp01(features.low) * k,
    displace: DISPLACE_MAX * clamp01(features.beat) * k,
    flash: FLASH_MAX * clamp01(features.beat) * k,
    grain: GRAIN_MAX * clamp01(features.high) * k,
    edges: EDGE_MAX * clamp01(features.high) * k,
    brightness: BRIGHTNESS_MAX * clamp01(features.level) * k,
  };
}
