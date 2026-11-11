// The look (spec SD5, SD10; plan PD5, PD8, PD22): one shader pass that draws the camera, or a
// slow noise field when there is none, through the two dials and the audio features. The
// mapping from inputs to uniforms is a pure function so it is tested without a GPU. Every
// strength is named here; B-02 lifts them as the starting values of a configurable look.
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

/**
 * Every term is a function of the block (`cell`) only, never of the pixel inside it, so at
 * recognisability 1 no detail is finer than a block at any reactivity (PD22). With a camera,
 * block 1, 256 levels, no feedback and no audio terms, the pass is the identity (PD8).
 */
export const LOOK_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform sampler2D uPrevious;
uniform vec2 uResolution;
uniform vec2 uCover;
uniform float uHasSource;
uniform float uTime;
uniform vec3 uTint;
uniform float uTintWeight;
uniform float uBlock;
uniform float uLevels;
uniform float uFeedback;
uniform float uZoom;
uniform float uDisplace;
uniform float uFlash;
uniform float uGrain;
uniform float uEdges;
uniform float uBrightness;
out vec4 outColour;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// The camera, cover-fitted, or the generative input (SD10): slow two-octave noise.
vec3 source(vec2 uv) {
  if (uHasSource > 0.5) return texture(uSource, (uv - 0.5) * uCover + 0.5).rgb;
  vec2 p = uv * vec2(uResolution.x / uResolution.y, 1.0) * 3.0;
  float t = uTime * 0.06;
  float n = 0.65 * valueNoise(p + vec2(t, -0.7 * t)) + 0.35 * valueNoise(2.3 * p - vec2(1.3 * t, t));
  return vec3(0.3 + 0.7 * n);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uBlock);
  vec2 centre = (cell + 0.5) * uBlock / uResolution;
  float seed = floor(uTime * 12.0);
  vec2 jitter = vec2(hash(cell + seed), hash(cell + seed + 17.0)) - 0.5;
  vec2 uv = (centre - 0.5) / uZoom + 0.5 + jitter * uDisplace;

  vec3 colour = source(uv);
  if (uEdges > 0.001) {
    vec2 step = uBlock / uResolution;
    colour += (abs(source(uv + vec2(step.x, 0.0)) - colour) +
               abs(source(uv + vec2(0.0, step.y)) - colour)) * uEdges;
  }
  colour *= mix(vec3(1.0), 1.5 * uTint, uTintWeight);
  colour = mix(colour, texture(uPrevious, centre).rgb, uFeedback);
  float steps = uLevels - 1.0;
  colour = floor(clamp(colour, 0.0, 1.0) * steps + 0.5) / steps;

  colour *= 1.0 + uBrightness;
  colour += (hash(cell + seed + 31.0) - 0.5) * uGrain;
  colour = mix(colour, vec3(1.0), uFlash);
  outColour = vec4(clamp(colour, 0.0, 1.0), 1.0);
}`;
