// T5 (B-02 spec SD12, SD15, AC24; plan PD3): the fragment shader generated from a profile's
// ordered effect list, checked as text. `tests/browser/shader.spec.ts` compiles it.
import { describe, expect, it } from "vitest";
import { BUILT_IN_PROFILE, type EffectType } from "./profile.ts";
import { buildFragment } from "./shader.ts";

/** The body of `vec3 fxN(vec2 uv)` in `source`. */
function body(source: string, n: number): string {
  const match = new RegExp(String.raw`vec3 fx${n}\(vec2 uv\) \{([\s\S]*?)\n\}`).exec(source);
  if (!match) throw new Error(`no fx${n} in the source`);
  return match[1]!;
}

const mainOf = (source: string) => /void main\(\) \{([\s\S]*?)\n\}/.exec(source)![1]!;

describe("buildFragment (PD3)", () => {
  it("emits one function per effect in stack order, each calling the one before", () => {
    const source = buildFragment(["zoom", "posterise", "flash"]);
    expect(source.indexOf("vec3 fx0(")).toBeLessThan(source.indexOf("vec3 fx1("));
    expect(source.indexOf("vec3 fx1(")).toBeLessThan(source.indexOf("vec3 fx2("));
    expect(source.indexOf("vec3 fx2(")).toBeLessThan(source.indexOf("vec3 fx3("));
    expect(source).not.toContain("vec3 fx4(");
    expect(body(source, 1)).toContain("uZoom");
    expect(body(source, 2)).toContain("uLevels");
    expect(body(source, 3)).toContain("uFlash");
    for (const n of [1, 2, 3]) {
      expect(body(source, n)).toMatch(new RegExp(String.raw`\bfx${n - 1}\(`));
      if (n >= 2) expect(body(source, n)).not.toMatch(new RegExp(String.raw`\bfx${n - 2}\(`));
    }
    expect(mainOf(source)).toMatch(/\bfx3\(/);
  });

  it("gives another source for the same types in another order", () => {
    expect(buildFragment(["zoom", "posterise"])).not.toBe(buildFragment(["posterise", "zoom"]));
  });

  it("gives the source alone for an empty list", () => {
    const source = buildFragment([]);
    expect(source).toContain("vec3 fx0(");
    expect(source).not.toContain("vec3 fx1(");
    expect(mainOf(source)).toMatch(/\bfx0\(/);
  });

  it("is deterministic", () => {
    const types = BUILT_IN_PROFILE.effects.map((e) => e.type);
    expect(buildFragment(types)).toBe(buildFragment([...types]));
  });

  it("keeps the flash a mix by a uniform, with no constant above 0.35 (AC24)", () => {
    const flash = body(buildFragment(["flash"]), 1);
    expect(flash).toMatch(/mix\(.*uFlash\)/);
    const literals = (flash.match(/\d+\.\d*|\.\d+|\b\d+\b/g) ?? []).map(Number);
    expect(literals.every((v) => v <= 0.35)).toBe(true);
  });

  it("keys displace's and grain's noise on the output pixel's block", () => {
    for (const type of ["displace", "grain"] as const) {
      expect(body(buildFragment([type]), 1)).toContain("blockCell()");
    }
    expect(buildFragment([])).toMatch(
      /vec2 blockCell\(\) \{\s*return floor\(gl_FragCoord\.xy \/ uBlock\);/,
    );
  });

  it("samples the predecessor three times for edges and once for a warp", () => {
    const calls = (type: EffectType) =>
      (body(buildFragment([type]), 1).match(/\bfx0\(/g) ?? []).length;
    expect(calls("edges")).toBe(3);
    for (const type of [
      "pixelate",
      "zoom",
      "displace",
      "posterise",
      "smear",
      "brightness",
    ] as const) {
      expect(calls(type)).toBe(1);
    }
  });
});

describe("the new effects (T6, PD3, PD6)", () => {
  it("appear in the source when listed", () => {
    expect(body(buildFragment(["paletteMap"]), 1)).toContain("uPalette");
    expect(body(buildFragment(["paletteMap"]), 1)).toContain("uPaletteMix");
    expect(body(buildFragment(["mirror"]), 1)).toContain("uSegments");
    expect(body(buildFragment(["mirror"]), 1)).toContain("uMirror");
    expect(body(buildFragment(["rgbSplit"]), 1)).toContain("uRgbSplit");
  });

  it("samples the predecessor three times for rgbSplit, once for mirror and paletteMap", () => {
    const calls = (type: EffectType) =>
      (body(buildFragment([type]), 1).match(/\bfx0\(/g) ?? []).length;
    expect(calls("rgbSplit")).toBe(3);
    expect(calls("mirror")).toBe(1);
    expect(calls("paletteMap")).toBe(1);
  });
});
