// Profiles with custom effects for the check-script specs (B-03 T13, T14), as files an author
// would write: plain definitions, written to a temporary folder by the spec.
import type { Definition } from "./profiles.ts";

/** One custom effect; `code` is a GLSL function body (docs/custom-effects.md). */
export function customEffect(label: string, code: string, extra: Record<string, unknown> = {}) {
  return { type: "custom", label, amount: 1, abstraction: false, params: [], code, ...extra };
}

/** A look an author might write: a swirl over a palette map, bound to the beat. */
export function swirl(name = "Swirl"): Definition {
  return {
    name,
    palette: ["#0b1d51", "#f5c518", "#e0e0e0"],
    dials: { recognisability: 0.6, reactivity: 0.8 },
    effects: [
      { type: "paletteMap", amount: 0.7 },
      customEffect(
        "Swirl",
        [
          "vec2 c = uv - 0.5;",
          "float a = strength * param[0] * 3.0 * length(c);",
          "vec2 r = vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a));",
          "return source(r + 0.5);",
        ].join("\n"),
        {
          amount: 0.1, // low at rest, so the beat binding shows on a kick
          params: [{ name: "turn", value: 0.6 }],
          binding: { feature: "beat", amount: 1 },
        },
      ),
    ],
  };
}

/** Every other frame white then black, if nothing limited it: the limiter's case (SD5). */
export function strobe(name = "Strobe"): Definition {
  return {
    name,
    palette: ["#000000", "#ffffff"],
    dials: { recognisability: 0.5, reactivity: 0.5 },
    effects: [
      customEffect(
        "Strobe",
        "float y = dot(lastFrame(uv), vec3(0.299, 0.587, 0.114));\nreturn vec3(y < 0.5 ? 1.0 : 0.0);",
      ),
    ],
  };
}

/** Built-ins only, shaped like the built-in profile: never anywhere near the limit. */
export function builtInShaped(name = "Calm"): Definition {
  return {
    name,
    palette: ["#000000", "#ffffff"],
    dials: { recognisability: 0.3, reactivity: 0.7 },
    effects: [
      { type: "zoom", amount: 0, binding: { feature: "low", amount: 1 } },
      { type: "posterise", amount: 1 },
    ],
  };
}

/** At dials (0, 0) a flagged, unbound custom effect is off: the picture is the camera (SD13). */
export function cameraThrough(name = "Through"): Definition {
  return {
    name,
    palette: ["#000000", "#ffffff"],
    dials: { recognisability: 0.5, reactivity: 0.5 },
    effects: [
      customEffect("Tint", "return source(uv) * vec3(0.2, 1.0, 0.2);", { abstraction: true }),
    ],
  };
}

/** A file in the export format; version 2 when any profile holds a custom effect. */
export function fileOf(...profiles: Definition[]): string {
  const custom = profiles.some((p) => p.effects.some((e) => e.type === "custom"));
  return JSON.stringify({ formatVersion: custom ? 2 : 1, profiles }, null, 2);
}
