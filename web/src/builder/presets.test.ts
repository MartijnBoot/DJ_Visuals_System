// T10 (B-02 spec SD11, SD13, AC2; plan PD2): the preset palettes and the profiles created from
// them and from the built-in.
import { BUILT_IN_PROFILE } from "@djv/engine";
import { profileSchema } from "@djv/shared";
import { describe, expect, it } from "vitest";
import { fromBuiltin, fromPreset, PRESETS } from "./presets.ts";

describe("PRESETS (PD2)", () => {
  it("are Basic, Warm, Cool and Neon with the palettes the plan names", () => {
    expect(PRESETS.map((p) => [p.name, p.palette])).toEqual([
      ["Basic", ["#000000", "#ffffff"]],
      ["Warm", ["#1a0500", "#c2410c", "#fbbf24", "#fff7ed"]],
      ["Cool", ["#020617", "#1d4ed8", "#22d3ee", "#f0f9ff"]],
      ["Neon", ["#0a0014", "#d946ef", "#22d3ee", "#a3e635"]],
    ]);
  });
});

describe("fromBuiltin", () => {
  it("copies the built-in exactly, under the given name, and parses", () => {
    const profile = fromBuiltin("New profile");
    expect(profile).toEqual({ ...BUILT_IN_PROFILE, name: "New profile" });
    expect(profileSchema.safeParse(profile).success).toBe(true);
    expect(Object.isFrozen(profile.effects)).toBe(false);
  });
});

describe("fromPreset", () => {
  for (const preset of PRESETS) {
    it(`${preset.name}: parses, keeps the built-in's stack and dials, and adds a palette map before pixelate`, () => {
      const profile = fromPreset(preset, "New profile");
      expect(profileSchema.safeParse(profile).success).toBe(true);
      expect(profile.name).toBe("New profile");
      expect(profile.palette).toEqual(preset.palette);
      expect(profile.dials).toEqual(BUILT_IN_PROFILE.dials);

      const types = profile.effects.map((e) => e.type);
      const builtIn = BUILT_IN_PROFILE.effects.map((e) => e.type);
      expect(types.filter((t) => t !== "paletteMap")).toEqual(builtIn);
      expect(types.at(-2)).toBe("paletteMap");
      expect(types.at(-1)).toBe("pixelate");
      expect(profile.effects.find((e) => e.type === "paletteMap")).toEqual({
        type: "paletteMap",
        amount: 1,
      });
    });

    it(`${preset.name}: flash, grain and edges take the lightest slot`, () => {
      const profile = fromPreset(preset, "x");
      const last = preset.palette.length - 1;
      for (const effect of profile.effects) {
        if (effect.type === "flash" || effect.type === "grain" || effect.type === "edges") {
          expect(effect.colourSlot).toBe(last);
        }
      }
    });
  }

  it("does not touch the built-in", () => {
    fromPreset(PRESETS[1]!, "x").effects.pop();
    expect(BUILT_IN_PROFILE.effects).toHaveLength(9);
  });
});
