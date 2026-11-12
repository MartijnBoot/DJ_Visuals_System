// T11 (B-02 spec AC3, AC8, SD11, SD12): the editor's reducer, validation and dirty check, pure.
import { EFFECT_TYPES, profileSchema, type Profile } from "@djv/shared";
import { describe, expect, it } from "vitest";
import { availableTypes, isDirty, reduce, validate, type Action } from "./editor.ts";

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
