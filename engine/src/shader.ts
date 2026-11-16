// The look as one shader pass built from a profile's ordered effect list (B-02 spec SD1, SD12,
// SD15; plan PD3). `fx0` is the source (camera or noise, tint included); each effect is one
// function `fxN` that calls `fx(N-1)`: a warp at a moved coordinate, a colour effect at `uv`
// and then changes the result. The first effect in the list is therefore applied to the
// picture first, exactly as separate passes would, at the cost of one pass. Strengths, colours
// and segments are uniforms (`profileUniforms`), so only a change to the list needs a new
// program. A custom effect (B-03 SD1, SD3) is the one exception: its GLSL body becomes one
// link of the chain, wrapped by the engine (`customLink`).
import { FLASH_MAX } from "./look.ts";
import { CUSTOM_SLOTS, type EffectType } from "./profile.ts";

/** `FLASH_MAX` as a GLSL float literal. */
const FLASH_LIMIT = Number.isInteger(FLASH_MAX) ? `${FLASH_MAX}.0` : `${FLASH_MAX}`;

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
  // The picture's luma spread over the palette from slot 0 (dark) to the last (light).
  paletteMap: (p) => `
  vec3 colour = ${p}(uv);
  float position = clamp(dot(colour, vec3(0.299, 0.587, 0.114)), 0.0, 1.0) * (uPaletteSize - 1.0);
  int low = int(floor(position));
  int high = int(min(float(low) + 1.0, uPaletteSize - 1.0));
  vec3 mapped = mix(uPalette[low], uPalette[high], position - float(low));
  return mix(colour, mapped, uPaletteMix);`,
  // A kaleidoscope: the coordinate folded into mirrored wedges about the centre (aspect
  // corrected), moved toward that from the plain one by the strength.
  mirror: (p) => `
  float aspect = uResolution.x / uResolution.y;
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  float wedge = 6.283185307 / uSegments;
  float angle = mod(atan(q.y, q.x), wedge);
  angle = abs(angle - 0.5 * wedge);
  vec2 folded = vec2(cos(angle), sin(angle)) * length(q);
  return ${p}(mix(uv, folded / vec2(aspect, 1.0) + 0.5, uMirror));`,
  // Red and blue sampled either side of green, uRgbSplit frame widths apart.
  rgbSplit: (p) => `
  vec2 offset = vec2(uRgbSplit, 0.0);
  return vec3(${p}(uv + offset).r, ${p}(uv).g, ${p}(uv - offset).b);`,
  // Bounded by the uniform alone (spec AC24): the engine never sets uFlash above FLASH_MAX.
  flash: (p) => `
  return mix(${p}(uv), uFlashColour, uFlash);`,
};

/** A type with no snippet yet passes the picture through, so any valid profile renders. */
const passThrough: Snippet = (p) => `
  return ${p}(uv);`;

/** A custom effect's code (B-03 SD1): the body of a function that returns a `vec3`. */
export interface CustomEntry {
  type: "custom";
  code: string;
}

/** One link of the chain: a built-in type, or custom code. */
export type FragmentEntry = EffectType | CustomEntry;

/**
 * The custom effect contract (B-03 SD3, PD7), as `docs/custom-effects.md` documents it. The
 * defines exist only around a body, so they are reserved words inside it; the functions are
 * the shader's own helpers; `audio` has these fields.
 */
export const CUSTOM_CONTRACT = {
  defines: [
    "source",
    "lastFrame",
    "resolution",
    "time",
    "audio",
    "palette",
    "paletteSize",
    "strength",
    "param",
  ],
  functions: ["hash", "valueNoise"],
  audio: ["level", "low", "mid", "high", "beat"],
} as const;

/** Declared only in a fragment with a custom entry, so built-in-only text is unchanged (AC8). */
const CUSTOM_HEADER = `
struct Audio {
  float level;
  float low;
  float mid;
  float high;
  float beat;
};
uniform Audio uAudio;
uniform float uCustomStrength[${CUSTOM_SLOTS}];
uniform vec4 uCustomParam[${CUSTOM_SLOTS}];
`;

/** The contract's names for the body of the `slot`-th custom effect, whose input is `previous`. */
const contractDefines = (previous: string, slot: number): string[] => [
  `#define source ${previous}`,
  "#define lastFrame(p) texture(uPrevious, (p)).rgb",
  "#define resolution uResolution",
  "#define time uTime",
  "#define audio uAudio",
  "#define palette uPalette",
  "#define paletteSize int(uPaletteSize)",
  `#define strength uCustomStrength[${slot}]`,
  `#define param uCustomParam[${slot}]`,
];

/**
 * A custom entry as two functions: its body, between the contract's defines, and the link
 * `fxN`, which passes the picture through without running the body under strength 0.001
 * (SD13). The body ends on its own line so a closing `//` comment cannot reach the brace.
 */
function customLink(code: string, index: number, slot: number): { text: string; codeAt: number } {
  const previous = `fx${index - 1}`;
  const undefs = CUSTOM_CONTRACT.defines.map((name) => `#undef ${name}`);
  const before = [
    `// custom ${slot}`,
    ...contractDefines(previous, slot),
    `vec3 fx${index}Custom(vec2 uv) {`,
  ].join("\n");
  const after = [
    "}",
    ...undefs,
    `vec3 fx${index}(vec2 uv) {`,
    `  if (uCustomStrength[${slot}] < 0.001) return ${previous}(uv);`,
    `  return fx${index}Custom(uv);`,
    "}",
    "",
  ].join("\n");
  return { text: `${before}\n${code}\n${after}`, codeAt: before.length + 1 };
}

/** Where a custom body sits in its fragment, 1-based (B-03 PD9). */
export interface BodyLayout {
  /** Index in the entry list, which is the profile's effect list. */
  effectIndex: number;
  firstLine: number;
  lineCount: number;
}

/** The fragment and the lines each custom body occupies in it: built together, never apart. */
function assemble(entries: readonly FragmentEntry[]): { source: string; bodies: BodyLayout[] } {
  let slot = 0;
  const placed: { text: string; code?: { at: number; effectIndex: number; lineCount: number } }[] =
    entries.map((entry, i) => {
      if (typeof entry !== "string") {
        // GLSL ends a line at CR, LF or CRLF; one form keeps the layout's count the compiler's.
        const code = entry.code.replace(/\r\n?/g, "\n");
        const link = customLink(code, i + 1, slot++);
        const lineCount = code.split("\n").length;
        return { text: link.text, code: { at: link.codeAt, effectIndex: i, lineCount } };
      }
      const snippet = SNIPPETS[entry] ?? passThrough;
      return { text: `// ${entry}\nvec3 fx${i + 1}(vec2 uv) {${snippet(`fx${i}`)}\n}\n` };
    });
  const last = `fx${entries.length}(gl_FragCoord.xy / uResolution)`;
  const main =
    slot > 0
      ? limitedMain(last)
      : `void main() {
  outColour = vec4(clamp(${last}, 0.0, 1.0), 1.0);
}`;
  const prefix = `${HEADER}${slot > 0 ? CUSTOM_HEADER : ""}\n`;
  const bodies: BodyLayout[] = [];
  // The prefix's newlines, then each piece's own plus the one that joins it to the next.
  let linesBefore = prefix.split("\n").length - 1;
  for (const piece of placed) {
    if (piece.code) {
      const firstLine = linesBefore + piece.text.slice(0, piece.code.at).split("\n").length;
      bodies.push({
        effectIndex: piece.code.effectIndex,
        firstLine,
        lineCount: piece.code.lineCount,
      });
    }
    linesBefore += piece.text.split("\n").length;
  }
  const source = `${prefix}${placed.map((p) => p.text).join("\n")}
${main}
`;
  return { source, bodies };
}

/** The fragment shader for an ordered effect list (PD3), custom code included (B-03 SD3). */
export function buildFragment(entries: readonly FragmentEntry[]): string {
  return assemble(entries).source;
}

/** The lines each custom body occupies in `buildFragment(entries)`, for compile errors (PD9). */
export function fragmentLayout(entries: readonly FragmentEntry[]): BodyLayout[] {
  return assemble(entries).bodies;
}

/**
 * The flash limiter (B-03 SD5, PD3), engine code after the chain, so no body can skip it: a
 * colour that is not finite becomes the previous output (read by exponent bits, which no fast
 * math folds away), and a luma step above `FLASH_MAX` from the previous output at this pixel is
 * moved back along the line to it, so the step is exactly `FLASH_MAX`.
 */
function limitedMain(last: string): string {
  return `void main() {
  vec3 previous = texelFetch(uPrevious, ivec2(gl_FragCoord.xy), 0).rgb;
  vec3 colour = ${last};
  uvec3 exponent = floatBitsToUint(colour) & uvec3(0x7f800000u);
  if (any(equal(exponent, uvec3(0x7f800000u)))) colour = previous;
  colour = clamp(colour, 0.0, 1.0);
  float delta = dot(colour - previous, vec3(0.299, 0.587, 0.114));
  if (abs(delta) > ${FLASH_LIMIT}) colour = previous + (colour - previous) * (${FLASH_LIMIT} / abs(delta));
  outColour = vec4(colour, 1.0);
}`;
}
