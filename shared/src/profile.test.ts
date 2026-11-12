import { describe, expect, it } from "vitest";
import {
  EFFECT_TYPES,
  FORMAT_VERSION,
  LIMITS,
  profileFileSchema,
  profileSchema,
  toProfileFile,
  type Profile,
} from "./profile.ts";
import { issuesFrom, storedProfileSchema, updateProfileSchema } from "./profile-api.ts";

/** Shaped like the engine's built-in profile (plan PD5). */
const builtInShaped: Profile = {
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
};

const withEffects = (effects: unknown[]): unknown => ({ ...builtInShaped, effects });

/** The dotted paths of every issue a parse reports. */
function failingPaths(input: unknown): string[] {
  const result = profileSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? [] : issuesFrom(result.error).map((i) => i.path);
}

describe("profileSchema", () => {
  it("lists the twelve effect types in the spec's table order", () => {
    expect(EFFECT_TYPES).toEqual([
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
    ]);
    expect(LIMITS).toEqual({
      nameLength: 60,
      effects: 12,
      paletteMin: 2,
      paletteMax: 6,
      segmentsMin: 2,
      segmentsMax: 8,
    });
  });

  it("accepts the built-in-shaped example unchanged", () => {
    expect(profileSchema.parse(builtInShaped)).toEqual(builtInShaped);
  });

  it("accepts all twelve effects, upper-case colours and six palette slots", () => {
    const twelve = EFFECT_TYPES.map((type) => ({
      type,
      amount: 0.5,
      binding: { feature: "mid", amount: 0.5 },
      ...(type === "flash" || type === "grain" || type === "edges" ? { colourSlot: 5 } : {}),
      ...(type === "mirror" ? { segments: 8 } : {}),
    }));
    const palette = ["#ABCDEF", "#000000", "#111111", "#222222", "#333333", "#444444"];
    expect(profileSchema.safeParse({ ...builtInShaped, palette, effects: twelve }).success).toBe(
      true,
    );
  });

  it("trims a name with outer spaces", () => {
    expect(profileSchema.parse({ ...builtInShaped, name: "  Warm  " }).name).toBe("Warm");
  });

  // AC8, one case per clause, each naming the failing field.
  it("rejects an unknown effect type at its path", () => {
    expect(failingPaths(withEffects([{ type: "blur", amount: 0.5 }]))).toContain("effects.0.type");
  });

  it("rejects an amount of 1.5 at its path", () => {
    expect(failingPaths(withEffects([{ type: "zoom", amount: 1.5 }]))).toEqual([
      "effects.0.amount",
    ]);
  });

  it("rejects 9 mirror segments at its path", () => {
    expect(failingPaths(withEffects([{ type: "mirror", amount: 1, segments: 9 }]))).toEqual([
      "effects.0.segments",
    ]);
  });

  it("rejects a repeated effect type at the repeat's path", () => {
    const repeated = [
      { type: "zoom", amount: 0.1 },
      { type: "smear", amount: 0.1 },
      { type: "zoom", amount: 0.2 },
    ];
    expect(failingPaths(withEffects(repeated))).toEqual(["effects.2.type"]);
  });

  it("rejects 13 effects at the list's path", () => {
    const thirteen = Array.from({ length: 13 }, () => ({ type: "zoom", amount: 0 }));
    expect(failingPaths(withEffects(thirteen))).toContain("effects");
  });

  it("rejects a palette of 1 and of 7 colours", () => {
    expect(failingPaths({ ...builtInShaped, palette: ["#000000"] })).toContain("palette");
    const seven = Array.from({ length: 7 }, () => "#000000");
    expect(failingPaths({ ...builtInShaped, palette: seven })).toEqual(["palette"]);
  });

  it("rejects a malformed colour at its slot", () => {
    expect(failingPaths({ ...builtInShaped, palette: ["#000000", "#12345"] })).toEqual([
      "palette.1",
    ]);
  });

  it("rejects a binding naming no feature", () => {
    const tempo = [{ type: "zoom", amount: 0, binding: { feature: "tempo", amount: 1 } }];
    expect(failingPaths(withEffects(tempo))).toEqual(["effects.0.binding.feature"]);
  });

  it("rejects an empty name, a blank name and a 61-character name", () => {
    expect(failingPaths({ ...builtInShaped, name: "" })).toEqual(["name"]);
    expect(failingPaths({ ...builtInShaped, name: "   " })).toEqual(["name"]);
    expect(failingPaths({ ...builtInShaped, name: "x".repeat(61) })).toEqual(["name"]);
    expect(profileSchema.safeParse({ ...builtInShaped, name: "x".repeat(60) }).success).toBe(true);
  });

  it("rejects a colour slot beyond the palette at its path", () => {
    const flash = [{ type: "flash", amount: 1, colourSlot: 2 }];
    expect(failingPaths(withEffects(flash))).toEqual(["effects.0.colourSlot"]);
  });

  it("rejects unknown keys on the profile and on an effect", () => {
    expect(failingPaths({ ...builtInShaped, shader: "void main(){}" }).length).toBeGreaterThan(0);
    expect(failingPaths(withEffects([{ type: "zoom", amount: 0, code: "x" }])).length).toBe(1);
  });

  it("rejects a colour slot or segments on an effect that has none", () => {
    expect(failingPaths(withEffects([{ type: "zoom", amount: 0, colourSlot: 0 }])).length).toBe(1);
    expect(
      failingPaths(withEffects([{ type: "flash", amount: 0, colourSlot: 0, segments: 4 }])).length,
    ).toBe(1);
  });

  it("rejects a missing colour slot, a fractional slot and a missing segment count", () => {
    expect(failingPaths(withEffects([{ type: "edges", amount: 0 }]))).toEqual([
      "effects.0.colourSlot",
    ]);
    expect(failingPaths(withEffects([{ type: "grain", amount: 0, colourSlot: 0.5 }]))).toEqual([
      "effects.0.colourSlot",
    ]);
    expect(failingPaths(withEffects([{ type: "mirror", amount: 0 }]))).toEqual([
      "effects.0.segments",
    ]);
  });

  it("rejects dials outside 0 to 1 and non-finite numbers", () => {
    const dials = { recognisability: -0.1, reactivity: 0.5 };
    expect(failingPaths({ ...builtInShaped, dials })).toEqual(["dials.recognisability"]);
    expect(failingPaths(withEffects([{ type: "zoom", amount: Number.NaN }]))).toEqual([
      "effects.0.amount",
    ]);
  });
});

describe("the file format", () => {
  const stored = {
    ...builtInShaped,
    id: "9f1c5a1e-0000-4000-8000-000000000000",
    revision: 3,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T11:00:00.000Z",
  };

  it("exports only name, palette, dials and effects, at format version 1", () => {
    const file = toProfileFile([stored]);
    expect(FORMAT_VERSION).toBe(1);
    expect(file.formatVersion).toBe(1);
    const text = JSON.stringify(file);
    for (const key of ["id", "revision", "createdAt", "updatedAt"]) {
      expect(text).not.toContain(`"${key}"`);
    }
    expect(file.profiles[0]).toEqual(builtInShaped);
  });

  it("parses its own output back", () => {
    const file = toProfileFile([stored, { ...stored, name: "Other" }]);
    expect(profileFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  it("rejects format version 2, an empty bundle and a bad profile with its path", () => {
    expect(
      profileFileSchema.safeParse({ formatVersion: 2, profiles: [builtInShaped] }).success,
    ).toBe(false);
    expect(profileFileSchema.safeParse({ formatVersion: 1, profiles: [] }).success).toBe(false);
    const result = profileFileSchema.safeParse({
      formatVersion: 1,
      profiles: [builtInShaped, { ...builtInShaped, name: "B", palette: ["#000000", "#zzzzzz"] }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(issuesFrom(result.error)[0]?.path).toBe("profiles.1.palette.1");
  });
});

describe("the API shapes", () => {
  it("accepts a stored profile and rejects one without a revision", () => {
    const stored = {
      ...builtInShaped,
      id: "abc",
      revision: 1,
      createdAt: "2026-11-12T10:00:00.000Z",
      updatedAt: "2026-11-12T10:00:00.000Z",
    };
    expect(storedProfileSchema.parse(stored)).toEqual(stored);
    const { revision: _r, ...noRevision } = stored;
    expect(storedProfileSchema.safeParse(noRevision).success).toBe(false);
  });

  it("applies the profile rules to the stored and update shapes too", () => {
    const repeated = withEffects([
      { type: "zoom", amount: 0 },
      { type: "zoom", amount: 0 },
    ]) as Profile;
    const result = updateProfileSchema.safeParse({ ...repeated, revision: 2 });
    expect(result.success).toBe(false);
    if (!result.success) expect(issuesFrom(result.error)[0]?.path).toBe("effects.1.type");
  });

  it("prefixes issue paths when asked", () => {
    const result = profileSchema.safeParse({ ...builtInShaped, name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issuesFrom(result.error, ["profiles", 3])).toEqual([
        { path: "profiles.3.name", message: expect.any(String) },
      ]);
    }
  });
});
