// The look as one shader pass built from a profile's ordered effect list (B-02 spec SD1, SD12,
// SD15; plan PD3). `fx0` is the source (camera or noise, tint included); each effect is one
// function `fxN` that calls `fx(N-1)`: a warp at a moved coordinate, a colour effect at `uv`
// and then changes the result. The first effect in the list is therefore applied to the
// picture first, exactly as separate passes would, at the cost of one pass. Strengths, colours
// and segments are uniforms (`profileUniforms`), so only a change to the list needs a new
// program. No profile carries code: the profile selects and orders these snippets, nothing else.
import type { EffectType } from "./profile.ts";

const HEADER = `#version 300 es
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
uniform vec3 uFlashColour;
uniform float uGrain;
uniform vec3 uGrainColour;
uniform float uEdges;
uniform vec3 uEdgesColour;
uniform float uBrightness;
uniform vec3 uPalette[6];
uniform float uPaletteSize;
uniform float uPaletteMix;
uniform float uMirror;
uniform float uSegments;
uniform float uRgbSplit;
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

// The output pixel's block: every per-block noise is keyed on it, never on the pixel inside it,
// so at recognisability 1 no detail is finer than a block at any reactivity (B-01 PD22).
vec2 blockCell() {
  return floor(gl_FragCoord.xy / uBlock);
}

float noiseSeed() {
  return floor(uTime * 12.0);
}

// The camera, cover-fitted, or the generative input (B-01 SD10): slow two-octave noise, tinted.
// The camera is never tinted (uTintWeight 0).
vec3 fx0(vec2 uv) {
  vec3 colour;
  if (uHasSource > 0.5) {
    colour = texture(uSource, (uv - 0.5) * uCover + 0.5).rgb;
  } else {
    vec2 p = uv * vec2(uResolution.x / uResolution.y, 1.0) * 3.0;
    float t = uTime * 0.06;
    float n = 0.65 * valueNoise(p + vec2(t, -0.7 * t)) + 0.35 * valueNoise(2.3 * p - vec2(1.3 * t, t));
    colour = vec3(0.3 + 0.7 * n);
  }
  return colour * mix(vec3(1.0), 1.5 * uTint, uTintWeight);
}
`;

/** One effect's function body, given the name of the function before it. */
type Snippet = (previous: string) => string;

const SNIPPETS: Partial<Record<EffectType, Snippet>> = {
  // The block centre: every term below it sees one coordinate per block.
  pixelate: (p) => `
  vec2 centre = (floor(uv * uResolution / uBlock) + 0.5) * uBlock / uResolution;
  return ${p}(centre);`,
  zoom: (p) => `
  return ${p}((uv - 0.5) / uZoom + 0.5);`,
  displace: (p) => `
  vec2 cell = blockCell();
  float seed = noiseSeed();
  vec2 jitter = vec2(hash(cell + seed), hash(cell + seed + 17.0)) - 0.5;
  return ${p}(uv + jitter * uDisplace);`,
  edges: (p) => `
  vec3 colour = ${p}(uv);
  if (uEdges > 0.001) {
    vec2 step = uBlock / uResolution;
    colour += (abs(${p}(uv + vec2(step.x, 0.0)) - colour) +
               abs(${p}(uv + vec2(0.0, step.y)) - colour)) * uEdges * uEdgesColour;
  }
  return colour;`,
  // Posterise before the smear: the smear is then a convergent average toward the posterised
  // picture. Quantising after the mix lets a level absorb any change under 1/(2 steps) per
  // frame, which the 0.85 feedback never exceeds, so the picture froze (B-01 review C1).
  posterise: (p) => `
  float steps = uLevels - 1.0;
  return floor(clamp(${p}(uv), 0.0, 1.0) * steps + 0.5) / steps;`,
  // The previous frame holds brightness and flash; undo them (grain is zero-mean) so they decay
  // through the smear instead of ratcheting up through it.
  smear: (p) => `
  vec3 previous = texture(uPrevious, uv).rgb;
  previous = clamp((previous - uFlash * uFlashColour) / (1.0 - uFlash) / (1.0 + uBrightness), 0.0, 1.0);
  return mix(${p}(uv), previous, uFeedback);`,
  brightness: (p) => `
  return ${p}(uv) * (1.0 + uBrightness);`,
  grain: (p) => `
  return ${p}(uv) + (hash(blockCell() + noiseSeed() + 31.0) - 0.5) * uGrain * uGrainColour;`,
  // Bounded by the uniform alone (spec AC24): the engine never sets uFlash above FLASH_MAX.
  flash: (p) => `
  return mix(${p}(uv), uFlashColour, uFlash);`,
};

/** A type with no snippet yet passes the picture through, so any valid profile renders. */
const passThrough: Snippet = (p) => `
  return ${p}(uv);`;

/** The fragment shader for an ordered effect list (PD3). */
export function buildFragment(types: readonly EffectType[]): string {
  const functions = types.map((type, i) => {
    const snippet = SNIPPETS[type] ?? passThrough;
    return `// ${type}\nvec3 fx${i + 1}(vec2 uv) {${snippet(`fx${i}`)}\n}\n`;
  });
  return `${HEADER}
${functions.join("\n")}
void main() {
  outColour = vec4(clamp(fx${types.length}(gl_FragCoord.xy / uResolution), 0.0, 1.0), 1.0);
}
`;
}
