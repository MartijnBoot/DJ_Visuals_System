// T11 (B-02 spec AC3, AC8, SD11, SD12): the editor's reducer, validation and dirty check, pure.
import { EFFECT_TYPES, profileSchema, type Profile } from "@djv/shared";
import { describe, expect, it } from "vitest";
import {
  availableTypes,
  canAddCustom,
  isDirty,
  primaryUnused,
  reduce,
  validate,
  type Action,
} from "./editor.ts";
import { CUSTOM_TEMPLATE } from "./custom-template.ts";

const base: Profile = {
  name: "Warm",
  palette: ["#000000", "#ff0000", "#ffffff"],
  dials: { recognisability: 0.3, reactivity: 0.7 },
  effects: [
    { type: "zoom", amount: 0.2 },
    { type: "flash", amount: 0, binding: { feature: "beat", amount: 1 }, colourSlot: 2 },
    { type: "pixelate", amount: 1 },
  ],
};

const run = (draft: Profile, ...actions: Action[]) => actions.reduce(reduce, draft);
const types = (p: Profile) => p.effects.map((e) => e.type);

describe("name and dials", () => {
  it("sets the name as typed (validate reports the bad ones) and the dials clamped", () => {
    expect(run(base, { type: "name", name: "Cool" }).name).toBe("Cool");
    expect(run(base, { type: "dial", dial: "reactivity", value: 2 }).dials.reactivity).toBe(1);
    expect(
      run(base, { type: "dial", dial: "recognisability", value: -1 }).dials.recognisability,
    ).toBe(0);
    expect(
      run(base, { type: "dial", dial: "reactivity", value: Number.NaN }).dials.reactivity,
    ).toBe(0);
  });
});

describe("palette (SD11)", () => {
  it("sets a colour, adds up to six and removes down to two", () => {
    expect(run(base, { type: "paletteSet", index: 1, colour: "#00ff00" }).palette[1]).toBe(
      "#00ff00",
    );
    expect(run(base, { type: "paletteSet", index: 1, colour: "not a colour" }).palette[1]).toBe(
      "#ff0000",
    );
    let draft = base;
    for (let i = 0; i < 6; i++) draft = reduce(draft, { type: "paletteAdd" });
    expect(draft.palette).toHaveLength(6);
    for (let i = 0; i < 6; i++) draft = reduce(draft, { type: "paletteRemove", index: 0 });
    expect(draft.palette).toHaveLength(2);
  });

  it("removing a colour lowers any colour slot now out of range to the last slot", () => {
    const draft = run(base, { type: "paletteRemove", index: 0 }); // flash slot 2 -> palette of 2
    const flash = draft.effects.find((e) => e.type === "flash");
    expect(flash && "colourSlot" in flash && flash.colourSlot).toBe(1);
    expect(validate(draft)).toEqual([]);
  });

  it("replaces the palette from a preset, repairing slots", () => {
    const draft = run(base, { type: "paletteReplace", palette: ["#000000", "#ffffff"] });
    expect(draft.palette).toEqual(["#000000", "#ffffff"]);
    expect(validate(draft)).toEqual([]);
    expect(run(base, { type: "paletteReplace", palette: ["#000000"] })).toEqual(base);
  });
});

describe("effects (SD12)", () => {
  it("adds only types not yet present, with defaults", () => {
    const draft = run(
      base,
      { type: "effectAdd", effectType: "mirror" },
      { type: "effectAdd", effectType: "grain" },
    );
    expect(draft.effects.at(-2)).toEqual({ type: "mirror", amount: 0.5, segments: 4 });
    expect(draft.effects.at(-1)).toEqual({ type: "grain", amount: 0.5, colourSlot: 0 });
    expect(run(base, { type: "effectAdd", effectType: "zoom" })).toEqual(base);
  });

  it("offers nothing at twelve, and refuses a thirteenth", () => {
    let draft = base;
    for (const effectType of EFFECT_TYPES) draft = reduce(draft, { type: "effectAdd", effectType });
    expect(draft.effects).toHaveLength(12);
    expect(availableTypes(draft)).toEqual([]);
    expect(availableTypes(base)).toEqual(EFFECT_TYPES.filter((t) => !types(base).includes(t)));
    expect(reduce(draft, { type: "effectAdd", effectType: "zoom" })).toBe(draft);
  });

  it("removes and moves, and a move at either end is a no-op", () => {
    expect(types(run(base, { type: "effectRemove", index: 0 }))).toEqual(["flash", "pixelate"]);
    expect(types(run(base, { type: "effectMove", index: 0, direction: 1 }))).toEqual([
      "flash",
      "zoom",
      "pixelate",
    ]);
    expect(types(run(base, { type: "effectMove", index: 2, direction: -1 }))).toEqual([
      "zoom",
      "pixelate",
      "flash",
    ]);
    expect(run(base, { type: "effectMove", index: 0, direction: -1 })).toBe(base);
    expect(run(base, { type: "effectMove", index: 2, direction: 1 })).toBe(base);
    expect(run(base, { type: "effectMove", index: 9, direction: 1 })).toBe(base);
  });

  it("sets the strength and the own parameter, clamped and whole", () => {
    expect(run(base, { type: "amount", index: 0, value: 3 }).effects[0]).toMatchObject({
      amount: 1,
    });
    const slot = run(base, { type: "parameter", index: 1, value: 9 }).effects[1];
    expect(slot).toMatchObject({ colourSlot: 2 });
    const mirror = run(base, { type: "effectAdd", effectType: "mirror" });
    const at = mirror.effects.length - 1;
    expect(run(mirror, { type: "parameter", index: at, value: 99 }).effects[at]).toMatchObject({
      segments: 8,
    });
    expect(run(mirror, { type: "parameter", index: at, value: 2.6 }).effects[at]).toMatchObject({
      segments: 3,
    });
    expect(run(base, { type: "parameter", index: 0, value: 1 })).toBe(base); // zoom has none
  });

  it("sets and clears a binding", () => {
    const bound = run(base, { type: "bindingSet", index: 0, feature: "high", amount: 0.4 });
    expect(bound.effects[0]).toMatchObject({ binding: { feature: "high", amount: 0.4 } });
    const cleared = run(bound, { type: "bindingClear", index: 0 });
    expect(cleared.effects[0]).toEqual({ type: "zoom", amount: 0.2 });
  });
});

describe("validate (AC3, AC8)", () => {
  it("reports an empty and an over-long name by path, and nothing for a good draft", () => {
    expect(validate(base)).toEqual([]);
    expect(validate(run(base, { type: "name", name: "  " })).map((i) => i.path)).toEqual(["name"]);
    expect(validate(run(base, { type: "name", name: "x".repeat(61) })).map((i) => i.path)).toEqual([
      "name",
    ]);
  });

  it("no action sequence yields a draft the schema rejects, except a bad name (AC3)", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    const odd = [-5, -1, 0, 0.5, 1, 2.6, 7, 9, 99, Number.NaN, Infinity];
    let draft = base;
    for (let step = 0; step < 4000; step++) {
      const index = Math.floor(next() * 14) - 1;
      const action = pick<Action>([
        { type: "name", name: pick(["", " ", "ok", "x".repeat(70)]) },
        { type: "dial", dial: pick(["recognisability", "reactivity"] as const), value: pick(odd) },
        { type: "paletteSet", index, colour: pick(["#123456", "#ABCDEF", "bad", ""]) },
        { type: "paletteAdd" },
        { type: "paletteRemove", index },
        {
          type: "paletteReplace",
          palette: pick([
            ["#000000"],
            ["#000000", "#ffffff"],
            Array(7).fill("#000000"),
            ["#1", "#2"],
          ]),
        },
        { type: "effectAdd", effectType: pick(EFFECT_TYPES) },
        { type: "effectRemove", index },
        { type: "effectMove", index, direction: pick([-1, 1] as const) },
        { type: "amount", index, value: pick(odd) },
        { type: "parameter", index, value: pick(odd) },
        {
          type: "bindingSet",
          index,
          feature: pick(["level", "low", "mid", "high", "beat"] as const),
          amount: pick(odd),
        },
        { type: "bindingClear", index },
      ]);
      draft = reduce(draft, action);
      const issues = validate(draft).filter((i) => i.path !== "name");
      expect(issues, `after ${JSON.stringify(action)}`).toEqual([]);
      expect(profileSchema.safeParse({ ...draft, name: "ok" }).success).toBe(true);
    }
  });
});

describe("isDirty", () => {
  it("is false for an equal draft whatever the key order, true for any change", () => {
    expect(isDirty(base, base)).toBe(false);
    const reordered = JSON.parse(
      JSON.stringify({
        effects: base.effects,
        dials: base.dials,
        palette: base.palette,
        name: base.name,
      }),
    );
    expect(isDirty(reordered, base)).toBe(false);
    expect(isDirty(run(base, { type: "name", name: "Other" }), base)).toBe(true);
    expect(isDirty(run(base, { type: "effectMove", index: 0, direction: 1 }), base)).toBe(true);
    expect(isDirty(run(base, { type: "bindingClear", index: 1 }), base)).toBe(true);
  });

  it("returns to clean when an edit is undone by hand", () => {
    const there = run(base, { type: "amount", index: 0, value: 0.9 });
    expect(isDirty(run(there, { type: "amount", index: 0, value: 0.2 }), base)).toBe(false);
  });
});

describe("revert and save (T12, AC5, SD10)", () => {
  it("reset replaces the draft with the saved profile, and the draft is clean again", () => {
    const edited = run(
      base,
      { type: "name", name: "Changed" },
      { type: "effectAdd", effectType: "mirror" },
      { type: "paletteAdd" },
    );
    expect(isDirty(edited, base)).toBe(true);
    const reverted = reduce(edited, { type: "reset", profile: base });
    expect(reverted).toEqual(base);
    expect(isDirty(reverted, base)).toBe(false);
  });

  it("reset does not alias the saved profile, so later edits cannot change it", () => {
    const reverted = reduce(base, { type: "reset", profile: base });
    const edited = reduce(reverted, { type: "amount", index: 0, value: 0.9 });
    expect(base.effects[0]).toEqual({ type: "zoom", amount: 0.2 });
    expect(edited.effects[0]).toMatchObject({ amount: 0.9 });
  });

  it("is clean once the saved profile is what the server returned", () => {
    const edited = run(base, { type: "name", name: "Saved" });
    expect(isDirty(edited, { ...edited })).toBe(false);
  });
});

describe("the primary colour (B-04 SD10, AC40, AC41)", () => {
  const marked = (primary: number): Profile => ({ ...base, primary });

  it("primarySet marks a slot inside the palette and ignores one outside", () => {
    expect(run(base, { type: "primarySet", index: 1 }).primary).toBe(1);
    expect(run(base, { type: "primarySet", index: 3 })).toBe(base);
    expect(run(base, { type: "primarySet", index: -1 })).toBe(base);
    expect(run(base, { type: "primarySet", index: 0.5 })).toBe(base);
  });

  it("removing a slot before the mark keeps the mark on its colour", () => {
    const after = run(marked(2), { type: "paletteRemove", index: 0 });
    expect(after.primary).toBe(1);
    expect(after.palette[after.primary!]).toBe("#ffffff");
  });

  it("removing a slot after the mark leaves it where it is", () => {
    const four = { ...marked(1), palette: [...base.palette, "#00ff00"] };
    expect(run(four, { type: "paletteRemove", index: 3 }).primary).toBe(1);
  });

  it("removing the marked slot moves the mark to slot 0", () => {
    expect(run(marked(1), { type: "paletteRemove", index: 1 }).primary).toBe(0);
  });

  it("a palette without a mark stays without one when a slot is removed", () => {
    expect(run(base, { type: "paletteRemove", index: 0 })).not.toHaveProperty("primary");
  });

  it("a preset too short for the mark moves it to slot 0, so the draft stays valid", () => {
    const after = run(marked(2), { type: "paletteReplace", palette: ["#111111", "#222222"] });
    expect(after.primary).toBe(0);
    expect(validate(after)).toEqual([]);
    expect(
      run(marked(1), { type: "paletteReplace", palette: ["#111111", "#222222"] }).primary,
    ).toBe(1);
  });

  it("is dirty after primarySet, and revert clears it", () => {
    const edited = run(base, { type: "primarySet", index: 0 });
    expect(isDirty(edited, base)).toBe(true);
    const reverted = reduce(edited, { type: "reset", profile: base });
    expect(reverted).not.toHaveProperty("primary");
    expect(isDirty(reverted, base)).toBe(false);
    expect(isDirty(marked(2), marked(2))).toBe(false);
    expect(reduce(base, { type: "reset", profile: marked(2) }).primary).toBe(2);
  });

  it("says when the primary colour is used by no effect and there is no palette map", () => {
    // base: flash uses slot 2; derived primary 2 is used.
    expect(primaryUnused(base)).toBe(false);
    expect(primaryUnused(marked(1))).toBe(true);
    const mapped: Profile = { ...marked(1), effects: [{ type: "paletteMap", amount: 1 }] };
    expect(primaryUnused(mapped)).toBe(false);
    const none: Profile = { ...base, effects: [] }; // derived 0, nothing uses it
    expect(primaryUnused(none)).toBe(true);
  });
});

// B-03 T1 (spec AC3, SD4; plan PD5): a stored custom effect is one more row the existing
// actions handle; it does not use up a built-in type.
describe("a custom effect in the draft (B-03)", () => {
  const custom = (label: string): Profile["effects"][number] => ({
    type: "custom",
    label,
    amount: 0.4,
    abstraction: true,
    params: [{ name: "speed", value: 0.5 }],
    code: "return source(uv);",
  });
  const withCustom: Profile = { ...base, effects: [...base.effects, custom("Swirl")] };

  it("takes strength, binding, move and remove, and has no own parameter", () => {
    expect(validate(withCustom)).toEqual([]);
    const at = withCustom.effects.length - 1;
    expect(run(withCustom, { type: "amount", index: at, value: 0.9 }).effects[at]).toMatchObject({
      type: "custom",
      amount: 0.9,
    });
    const bound = run(withCustom, { type: "bindingSet", index: at, feature: "low", amount: 0.3 });
    expect(bound.effects[at]).toMatchObject({ binding: { feature: "low", amount: 0.3 } });
    expect(run(bound, { type: "bindingClear", index: at }).effects[at]).toEqual(custom("Swirl"));
    expect(run(withCustom, { type: "parameter", index: at, value: 1 })).toBe(withCustom);
    expect(types(run(withCustom, { type: "effectMove", index: at, direction: -1 }))).toEqual([
      "zoom",
      "flash",
      "custom",
      "pixelate",
    ]);
    expect(types(run(withCustom, { type: "effectRemove", index: at }))).toEqual(types(base));
  });

  it("counts toward twelve but takes no built-in type away", () => {
    expect(availableTypes(withCustom)).toEqual(availableTypes(base));
    const full: Profile = {
      ...base,
      effects: [...base.effects, ...Array.from({ length: 9 }, (_, i) => custom(`fx ${i}`))],
    };
    expect(validate(full)).toEqual([]);
    expect(availableTypes(full)).toEqual([]);
  });
});

// B-03 T10 (spec AC13, AC15, SD4, SD9; plan PD14): adding and editing custom effects.
describe("custom effect actions (B-03)", () => {
  const added = run(base, { type: "customAdd" });
  const at = added.effects.length - 1;
  const customAt = (draft: Profile, index = at) => {
    const effect = draft.effects[index]!;
    if (effect.type !== "custom") throw new Error("not a custom effect");
    return effect;
  };

  it("adds one from the template, with a free label, valid at once", () => {
    expect(customAt(added)).toEqual({
      type: "custom",
      label: CUSTOM_TEMPLATE.label,
      amount: 0.5,
      abstraction: false,
      params: CUSTOM_TEMPLATE.params.map((p) => ({ ...p })),
      code: CUSTOM_TEMPLATE.code,
    });
    expect(validate(added)).toEqual([]);
    const twice = run(added, { type: "customAdd" });
    expect(customAt(twice, at + 1).label).toBe(`${CUSTOM_TEMPLATE.label} 2`);
    expect(validate(twice)).toEqual([]);
  });

  it("adds none at twelve effects", () => {
    let draft = base;
    for (let i = 0; i < 12; i++) draft = reduce(draft, { type: "customAdd" });
    expect(draft.effects).toHaveLength(12);
    expect(canAddCustom(draft)).toBe(false);
    expect(canAddCustom(base)).toBe(true);
  });

  it("sets the label and the code as typed; validate reports a bad one", () => {
    const labelled = run(added, { type: "customLabel", index: at, label: "" });
    expect(customAt(labelled).label).toBe("");
    expect(validate(labelled).map((i) => i.path)).toEqual([`effects.${at}.label`]);
    const coded = run(added, {
      type: "customCode",
      index: at,
      code: "#define X\nreturn source(uv);",
    });
    expect(customAt(coded).code).toBe("#define X\nreturn source(uv);");
    expect(validate(coded).map((i) => i.path)).toEqual([`effects.${at}.code`]);
  });

  it("sets the abstraction flag", () => {
    expect(
      customAt(run(added, { type: "customAbstraction", index: at, value: true })).abstraction,
    ).toBe(true);
  });

  it("adds parameters with free names up to four, names, sets clamped and removes them", () => {
    let draft = added;
    for (let i = 0; i < 5; i++) draft = reduce(draft, { type: "customParamAdd", index: at });
    expect(customAt(draft).params).toHaveLength(4);
    expect(new Set(customAt(draft).params.map((p) => p.name)).size).toBe(4);
    expect(validate(draft)).toEqual([]);
    draft = run(draft, { type: "customParamValue", index: at, param: 1, value: 7 });
    expect(customAt(draft).params[1]!.value).toBe(1);
    draft = run(draft, { type: "customParamName", index: at, param: 1, name: "speed" });
    expect(customAt(draft).params[1]!.name).toBe("speed");
    draft = run(draft, { type: "customParamRemove", index: at, param: 0 });
    expect(customAt(draft).params.map((p) => p.name)[0]).toBe("speed");
    expect(customAt(draft).params).toHaveLength(3);
    expect(run(draft, { type: "customParamRemove", index: at, param: 9 })).toBe(draft);
  });

  it("ignores a custom action on a built-in effect", () => {
    expect(run(added, { type: "customCode", index: 0, code: "x" })).toBe(added);
    expect(run(added, { type: "customParamAdd", index: 0 })).toBe(added);
  });

  it("no action sequence leaves an issue anywhere but a name, label, parameter name or code", () => {
    let seed = 11;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
    const odd = [-5, 0, 0.5, 1, 2.6, Number.NaN, Infinity];
    const texts = ["", " ", "ok", "Swirl", "x".repeat(50), "#", "return source(uv);"];
    let draft = base;
    for (let step = 0; step < 4000; step++) {
      const index = Math.floor(next() * 14) - 1;
      const param = Math.floor(next() * 6) - 1;
      const action = pick<Action>([
        { type: "customAdd" },
        { type: "effectAdd", effectType: pick(EFFECT_TYPES) },
        { type: "effectRemove", index },
        { type: "effectMove", index, direction: pick([-1, 1] as const) },
        { type: "amount", index, value: pick(odd) },
        { type: "bindingSet", index, feature: "beat", amount: pick(odd) },
        { type: "customLabel", index, label: pick(texts) },
        { type: "customCode", index, code: pick(texts) },
        { type: "customAbstraction", index, value: next() > 0.5 },
        { type: "customParamAdd", index },
        { type: "customParamRemove", index, param },
        { type: "customParamName", index, param, name: pick(texts) },
        { type: "customParamValue", index, param, value: pick(odd) },
      ]);
      draft = reduce(draft, action);
      const allowed = /^(name|effects\.\d+\.(label|code|params\.\d+\.name))$/;
      const issues = validate(draft).filter((i) => !allowed.test(i.path));
      expect(issues, `after ${JSON.stringify(action)}`).toEqual([]);
      expect(draft.effects.length).toBeLessThanOrEqual(12);
    }
  });
});
