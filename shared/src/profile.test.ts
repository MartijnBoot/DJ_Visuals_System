import { describe, expect, it } from "vitest";
import {
  derivePrimary,
  CUSTOM_LIMITS,
  customCodeIssues,
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

describe("the primary colour (B-04 AC37, AC38, AC39, SD10)", () => {
  it("accepts a profile with primary inside its palette and one without", () => {
    expect(profileSchema.parse({ ...builtInShaped, primary: 0 })).toEqual({
      ...builtInShaped,
      primary: 0,
    });
    expect(profileSchema.parse({ ...builtInShaped, primary: 1 }).primary).toBe(1);
    expect(profileSchema.parse(builtInShaped)).not.toHaveProperty("primary");
  });

  it("rejects primary outside the palette, negative or fractional, naming the field", () => {
    expect(failingPaths({ ...builtInShaped, primary: 2 })).toEqual(["primary"]);
    expect(failingPaths({ ...builtInShaped, primary: -1 })).toEqual(["primary"]);
    expect(failingPaths({ ...builtInShaped, primary: 0.5 })).toEqual(["primary"]);
    const result = profileSchema.safeParse({ ...builtInShaped, primary: 5 });
    if (!result.success) expect(issuesFrom(result.error)[0]?.message).toMatch(/primary slot 5/);
  });

  it("applies the rule to the stored and update shapes too", () => {
    const stored = {
      ...builtInShaped,
      primary: 3,
      id: "abc",
      revision: 1,
      createdAt: "2026-11-12T10:00:00.000Z",
      updatedAt: "2026-11-12T10:00:00.000Z",
    };
    expect(storedProfileSchema.safeParse(stored).success).toBe(false);
    expect(
      updateProfileSchema.safeParse({ ...builtInShaped, primary: 1, revision: 2 }).success,
    ).toBe(true);
  });

  it("derives the stored primary when set", () => {
    expect(derivePrimary({ ...builtInShaped, primary: 0 })).toBe(0);
  });

  it("derives the first effect's colour slot in stack order when absent", () => {
    const palette = ["#000000", "#111111", "#222222"];
    const effects: Profile["effects"] = [
      { type: "zoom", amount: 0 },
      { type: "grain", amount: 0, colourSlot: 2 },
      { type: "flash", amount: 0, colourSlot: 1 },
    ];
    const profile: Profile = { ...builtInShaped, palette, effects };
    expect(derivePrimary(profile)).toBe(2);
  });

  it("derives 0 when no effect has a colour slot, and 1 for the built-in", () => {
    expect(derivePrimary({ ...builtInShaped, effects: [{ type: "zoom", amount: 0 }] })).toBe(0);
    expect(derivePrimary({ ...builtInShaped, effects: [] })).toBe(0);
    expect(derivePrimary(builtInShaped)).toBe(1);
  });

  it("carries primary through the file when set, and omits the key when absent", () => {
    const file = toProfileFile([{ ...builtInShaped, primary: 0 }, builtInShaped]);
    expect(file.profiles[0]).toEqual({ ...builtInShaped, primary: 0 });
    expect(file.profiles[1]).not.toHaveProperty("primary");
    expect(profileFileSchema.parse(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });
});

// B-03 (spec AC1, AC2, AC3, SD4, SD16; plan PD5, PD6): the custom effect, its limits and the
// checks on its code. Each refusal names the failing field's path.
describe("the custom effect (B-03)", () => {
  const custom = (over: Record<string, unknown> = {}) => ({
    type: "custom",
    label: "Swirl",
    amount: 0.5,
    abstraction: false,
    params: [{ name: "speed", value: 0.3 }],
    code: "vec3 c = source(uv);\nreturn c.bgr * strength;",
    ...over,
  });
  const failingCode = (code: string) => failingPaths(withEffects([custom({ code })]));

  it("accepts a custom effect with a binding and returns it unchanged (AC1)", () => {
    const effect = custom({ binding: { feature: "beat", amount: 0.7 } });
    const profile = withEffects([{ type: "zoom", amount: 0.1 }, effect]);
    expect(profileSchema.parse(profile)).toEqual(profile);
  });

  it("states its limits apart from the B-02 ones (SD16)", () => {
    expect(CUSTOM_LIMITS).toEqual({
      labelLength: 40,
      params: 4,
      paramNameLength: 24,
      codeBytes: 8192,
    });
  });

  it("accepts twelve custom effects and refuses a thirteenth effect (AC3)", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => custom({ label: `fx ${i}` }));
    expect(profileSchema.safeParse(withEffects(twelve)).success).toBe(true);
    expect(failingPaths(withEffects([...twelve, { type: "zoom", amount: 0 }]))).toContain(
      "effects",
    );
  });

  it("still refuses a repeated built-in beside custom effects (AC3)", () => {
    const list = [{ type: "zoom", amount: 0 }, custom(), { type: "zoom", amount: 0 }];
    expect(failingPaths(withEffects(list))).toEqual(["effects.2.type"]);
  });

  it("refuses an empty, a blank and a 41-character label at its path (AC2)", () => {
    for (const label of ["", "   ", "x".repeat(41)]) {
      expect(failingPaths(withEffects([custom({ label })]))).toEqual(["effects.0.label"]);
    }
    expect(profileSchema.safeParse(withEffects([custom({ label: "x".repeat(40) })])).success).toBe(
      true,
    );
  });

  it("refuses a label used twice, compared trimmed, at the repeat's path (AC2)", () => {
    const list = [custom({ label: "Swirl" }), custom({ label: " Swirl " })];
    expect(failingPaths(withEffects(list))).toEqual(["effects.1.label"]);
    const cased = [custom({ label: "Swirl" }), custom({ label: "swirl" })];
    expect(profileSchema.safeParse(withEffects(cased)).success).toBe(true);
  });

  it("refuses a fifth parameter at the list's path (AC2)", () => {
    const params = Array.from({ length: 5 }, (_, i) => ({ name: `p${i}`, value: 0 }));
    expect(failingPaths(withEffects([custom({ params })]))).toEqual(["effects.0.params"]);
  });

  it("refuses a parameter name outside 1 to 24 characters at its path (AC2)", () => {
    for (const name of ["", "x".repeat(25)]) {
      const params = [{ name, value: 0 }];
      expect(failingPaths(withEffects([custom({ params })]))).toEqual(["effects.0.params.0.name"]);
    }
  });

  it("refuses a repeated parameter name at the repeat's path (AC2)", () => {
    const params = [
      { name: "speed", value: 0 },
      { name: "size", value: 0 },
      { name: "speed", value: 1 },
    ];
    expect(failingPaths(withEffects([custom({ params })]))).toEqual(["effects.0.params.2.name"]);
  });

  it("refuses a parameter value outside 0 to 1 at its path (AC2)", () => {
    const params = [{ name: "speed", value: 1.5 }];
    expect(failingPaths(withEffects([custom({ params })]))).toEqual(["effects.0.params.0.value"]);
  });

  it("refuses code over 8192 UTF-8 bytes and accepts code at the limit (AC2, PD6)", () => {
    const prefix = "return source(uv);//"; // 20 bytes
    const accepted = (code: string) =>
      profileSchema.safeParse(withEffects([custom({ code })])).success;
    // 8192 bytes of one-, two-, three- and four-byte characters pass; one byte more does not.
    for (const fill of ["x".repeat(8172), "é".repeat(4086), "€".repeat(2724), "😀".repeat(2043)]) {
      expect(accepted(`${prefix}${fill}`)).toBe(true);
      expect(failingCode(`${prefix}${fill}x`)).toEqual(["effects.0.code"]);
    }
  });

  it("refuses a # anywhere, in a comment too (AC2, PD6)", () => {
    expect(failingCode("#define X 1\nreturn source(uv);")).toEqual(["effects.0.code"]);
    expect(failingCode("// see #2\nreturn source(uv);")).toEqual(["effects.0.code"]);
  });

  it("refuses the word uniform but not a name that contains it (AC2, PD6)", () => {
    expect(failingCode("uniform float x;\nreturn source(uv);")).toEqual(["effects.0.code"]);
    const ok = "float uniformity = 1.0;\nreturn source(uv) * uniformity;";
    expect(profileSchema.safeParse(withEffects([custom({ code: ok })])).success).toBe(true);
  });

  it("refuses in, out and inout declarations at the start of a line (AC2, PD6)", () => {
    for (const line of ["in vec2 v;", "  out vec4 o;", "\tinout float f;"]) {
      expect(failingCode(`${line}\nreturn source(uv);`)).toEqual(["effects.0.code"]);
    }
    const ok = "float inner = 1.0;\nint index = 0;\nreturn source(uv) * inner;";
    expect(profileSchema.safeParse(withEffects([custom({ code: ok })])).success).toBe(true);
  });

  it("refuses braces that close the function or stay open (AC2, PD6)", () => {
    expect(failingCode("return source(uv); }\nvec3 more(vec2 uv) { return vec3(0.0);")).toEqual([
      "effects.0.code",
    ]);
    expect(failingCode("if (true) {\nreturn source(uv);")).toEqual(["effects.0.code"]);
    expect(failingCode("} {\nreturn source(uv);")).toEqual(["effects.0.code"]);
  });

  it("does not count braces inside comments, and joins continued lines first (PD6)", () => {
    const commented = "// }\n/* { } } */\nif (true) { return source(uv); }\nreturn source(uv);";
    expect(profileSchema.safeParse(withEffects([custom({ code: commented })])).success).toBe(true);
    // A comment ended by a continued line is code to the compiler, so it is code here too.
    expect(failingCode("/* *\\\n/ } vec3 more() { /* */\nreturn source(uv);")).toEqual([
      "effects.0.code",
    ]);
    expect(failingCode("/* never closed\nreturn source(uv);")).toEqual(["effects.0.code"]);
  });

  it("gives one issue per broken rule, each naming its rule (PD6)", () => {
    expect(customCodeIssues("return source(uv);")).toEqual([]);
    const issues = customCodeIssues("#x\nuniform float u;\n}");
    expect(issues).toHaveLength(3);
    expect(issues.join("\n")).toMatch(/#/);
    expect(issues.join("\n")).toMatch(/uniform/);
    expect(issues.join("\n")).toMatch(/brace/);
  });

  it("refuses a custom effect without its abstraction flag, params or code", () => {
    for (const key of ["abstraction", "params", "code", "label"]) {
      const without: Record<string, unknown> = custom();
      delete without[key];
      expect(failingPaths(withEffects([without]))).toEqual([`effects.0.${key}`]);
    }
  });
});
