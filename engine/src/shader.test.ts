// T5 (B-02 spec SD12, SD15, AC24; plan PD3): the fragment shader generated from a profile's
// ordered effect list, checked as text. `tests/browser/shader.spec.ts` compiles it.
import { describe, expect, it } from "vitest";
import { BUILT_IN_PROFILE, type EffectType } from "./profile.ts";
import { buildFragment, CUSTOM_CONTRACT } from "./shader.ts";

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

// B-03 T4 (spec SD3, SD13; plan PD7): a custom entry is its own function between the
// contract's defines, behind a wrapper that skips it under strength 0.001.
describe("custom entries (B-03)", () => {
  const swap = { type: "custom", code: "return source(uv).bgr;" } as const;

  it("adds nothing to a fragment without a custom entry", () => {
    const source = buildFragment(["zoom", "flash"]);
    expect(source).not.toContain("uCustom");
    expect(source).not.toContain("#define");
    expect(source).not.toContain("uAudio");
  });

  it("puts the body in its own function, with source naming the effect before it", () => {
    const source = buildFragment(["zoom", swap, "flash"]);
    expect(source).toContain("return source(uv).bgr;");
    const at = source.indexOf("return source(uv).bgr;");
    const before = source.slice(0, at);
    const after = source.slice(at);
    expect(before.lastIndexOf("#define source fx1")).toBeGreaterThan(-1);
    expect(before.lastIndexOf("#define strength uCustomStrength[0]")).toBeGreaterThan(-1);
    expect(before.lastIndexOf("#define param uCustomParam[0]")).toBeGreaterThan(-1);
    for (const name of CUSTOM_CONTRACT.defines) {
      expect(after.indexOf(`#undef ${name}`)).toBeGreaterThan(-1);
      expect(after.indexOf(`#undef ${name}`)).toBeLessThan(after.indexOf("vec3 fx2(vec2 uv)"));
    }
    // fx3, the flash, calls the custom effect's wrapper.
    expect(body(source, 3)).toMatch(/\bfx2\(/);
  });

  it("wraps the body so it does not run under strength 0.001 (SD13)", () => {
    const wrapper = body(buildFragment(["zoom", swap]), 2);
    expect(wrapper).toContain("uCustomStrength[0] < 0.001");
    expect(wrapper).toMatch(/return fx1\(uv\);/);
  });

  it("numbers custom effects in stack order for their uniforms", () => {
    const source = buildFragment([
      swap,
      "zoom",
      { type: "custom", code: "return vec3(param[1]);" },
    ]);
    expect(source).toContain("#define strength uCustomStrength[0]");
    expect(source).toContain("#define strength uCustomStrength[1]");
    expect(source).toContain("#define source fx2");
    expect(body(source, 3)).toContain("uCustomStrength[1] < 0.001");
  });

  it("ends the body on its own line, so a closing // comment cannot swallow the brace", () => {
    const source = buildFragment([{ type: "custom", code: "return source(uv); // done" }]);
    expect(source).toMatch(/\/\/ done\n\}/);
  });

  it("declares the custom uniforms once, before the first function after fx0", () => {
    const source = buildFragment([swap, swap]);
    expect(source.match(/uniform float uCustomStrength\[12\];/g)).toHaveLength(1);
    expect(source.match(/uniform vec4 uCustomParam\[12\];/g)).toHaveLength(1);
    expect(source.match(/uniform Audio uAudio;/g)).toHaveLength(1);
  });

  it("names the whole contract (PD7)", () => {
    expect([...CUSTOM_CONTRACT.defines].sort()).toEqual(
      [
        "audio",
        "lastFrame",
        "palette",
        "paletteSize",
        "param",
        "resolution",
        "source",
        "strength",
        "time",
      ].sort(),
    );
    expect(CUSTOM_CONTRACT.functions).toEqual(["hash", "valueNoise"]);
    expect(CUSTOM_CONTRACT.audio).toEqual(["level", "low", "mid", "high", "beat"]);
  });
});

// B-03 T5 (spec AC7, AC8, SD5; plan PD2, PD3): the flash limiter ends main() of a fragment that
// holds custom code, and only of such a fragment.
describe("the flash limiter (B-03)", () => {
  const coded = buildFragment(["zoom", { type: "custom", code: "return source(uv);" }]);

  it("is absent from a fragment without a custom entry", () => {
    for (const list of [[], ["zoom", "flash"]] as EffectType[][]) {
      expect(mainOf(buildFragment(list))).not.toContain("texelFetch");
      expect(mainOf(buildFragment(list))).not.toContain("0.35");
    }
  });

  it("reads the previous output at this pixel and limits the luma step to 0.35", () => {
    const main = mainOf(coded);
    expect(main).toContain("texelFetch(uPrevious, ivec2(gl_FragCoord.xy), 0)");
    expect(main).toContain("vec3(0.299, 0.587, 0.114)");
    expect(main).toMatch(/abs\(\w+\) > 0\.35/);
  });

  it("replaces a NaN or infinite colour by the previous one before clamping", () => {
    const main = mainOf(coded);
    expect(main).toContain("floatBitsToUint");
    expect(main.indexOf("floatBitsToUint")).toBeLessThan(main.indexOf("clamp("));
  });

  it("assigns the output once, last", () => {
    const main = mainOf(coded);
    expect(main.match(/outColour =/g)).toHaveLength(1);
    expect(main.trimEnd().split("\n").at(-1)).toMatch(/^\s*outColour = /);
  });
});
