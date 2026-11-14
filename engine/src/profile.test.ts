// T2 (B-02 spec AC15, AC16, AC24, SD2, SD4, SD8; plan PD5, PD6): the profile model, tested
// against B-01's `lookUniforms` without a GPU.
import { describe, expect, it } from "vitest";
import type { AudioFeatures, Dials } from "./features.ts";
import { lookUniforms } from "./look.ts";
import {
  BUILT_IN_PROFILE,
  EFFECTS,
  effectStrength,
  profileUniforms,
  type Effect,
  type EffectType,
  type Profile,
} from "./profile.ts";

const WIDTH = 640;
const TIMESTAMPS = [0, 12_345, 3_600_000 + 777];
const DIAL_VALUES = [0, 0.3, 0.7, 1];

/** Every corner of the feature cube, and the middle. */
function featureGrid(): AudioFeatures[] {
  const grid: AudioFeatures[] = [];
  for (const level of [0, 1])
    for (const low of [0, 1])
      for (const mid of [0, 1])
        for (const high of [0, 1])
          for (const beat of [0, 1]) grid.push({ level, low, mid, high, beat, capturedAt: 0 });
  grid.push({ level: 0.5, low: 0.5, mid: 0.5, high: 0.5, beat: 0.5, capturedAt: 0 });
  return grid;
}

const COMPARED = [
  "block",
  "levels",
  "feedback",
  "zoom",
  "displace",
  "flash",
  "grain",
  "edges",
  "brightness",
  "time",
  "tintWeight",
] as const;

const ALL_TYPES = Object.keys(EFFECTS) as EffectType[];

function effectOf(type: EffectType, amount: number, binding?: Effect["binding"]): Effect {
  const extra =
    type === "flash" || type === "grain" || type === "edges"
      ? { colourSlot: 1 }
      : type === "mirror"
        ? { segments: 4 }
        : {};
  return { type, amount, ...(binding ? { binding } : {}), ...extra } as Effect;
}

const twelve = (feature: Effect["binding"] = { feature: "mid", amount: 0.8 }): Profile => ({
  name: "Twelve",
  palette: ["#000000", "#ff0000", "#00ff00"],
  dials: { recognisability: 0.5, reactivity: 0.5 },
  effects: ALL_TYPES.map((type) => effectOf(type, 0.5, feature)),
});

describe("the built-in profile (SD8, PD5)", () => {
  it("is B-01's nine effects in PD5's order, with its dials and palette", () => {
    expect(BUILT_IN_PROFILE.name).toBe("Built-in");
    expect(BUILT_IN_PROFILE.palette).toEqual(["#000000", "#ffffff"]);
    expect(BUILT_IN_PROFILE.dials).toEqual({ recognisability: 0.3, reactivity: 0.7 });
    expect(BUILT_IN_PROFILE.effects.map((e) => e.type)).toEqual([
      "edges",
      "displace",
      "zoom",
      "posterise",
      "smear",
      "brightness",
      "grain",
      "flash",
      "pixelate",
    ]);
  });

  it("is deep-frozen", () => {
    expect(Object.isFrozen(BUILT_IN_PROFILE)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_PROFILE.effects)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_PROFILE.effects[0])).toBe(true);
    expect(Object.isFrozen(BUILT_IN_PROFILE.palette)).toBe(true);
  });

  it("gives B-01's lookUniforms within 1e-9 over features, dials and time (AC15)", () => {
    let compared = 0;
    for (const features of featureGrid())
      for (const recognisability of DIAL_VALUES)
        for (const reactivity of DIAL_VALUES)
          for (const timestamp of TIMESTAMPS)
            for (const hasSource of [true, false]) {
              const dials: Dials = { recognisability, reactivity };
              const want = lookUniforms(features, dials, timestamp, hasSource, WIDTH);
              const got = profileUniforms(
                BUILT_IN_PROFILE,
                features,
                dials,
                timestamp,
                hasSource,
                WIDTH,
              );
              for (const key of COMPARED) {
                expect(Math.abs(got[key] - want[key])).toBeLessThan(1e-9);
              }
              for (const c of [0, 1, 2]) {
                expect(Math.abs(got.tint[c]! - want.tint[c]!)).toBeLessThan(1e-9);
              }
              compared++;
            }
    expect(compared).toBe(33 * 4 * 4 * 3 * 2);
  });

  it("is the identity at dials 0/0 with a source (AC15, B-01 AC8)", () => {
    const full: AudioFeatures = { level: 1, low: 1, mid: 1, high: 1, beat: 1, capturedAt: 9 };
    const u = profileUniforms(
      BUILT_IN_PROFILE,
      full,
      { recognisability: 0, reactivity: 0 },
      TIMESTAMPS[1]!,
      true,
      WIDTH,
    );
    expect(u.block).toBe(1);
    expect(u.levels).toBe(256);
    expect(u.zoom).toBe(1);
    expect(u.tintWeight).toBe(0);
    for (const key of ["feedback", "displace", "flash", "grain", "edges", "brightness"] as const) {
      expect(u[key]).toBe(0);
    }
  });

  it("colours flash, grain and edges white from slot 1", () => {
    const u = profileUniforms(
      BUILT_IN_PROFILE,
      featureGrid()[0]!,
      BUILT_IN_PROFILE.dials,
      0,
      true,
      WIDTH,
    );
    expect(u.flashColour).toEqual([1, 1, 1]);
    expect(u.grainColour).toEqual([1, 1, 1]);
    expect(u.edgesColour).toEqual([1, 1, 1]);
  });
});

describe("the dials (SD2, AC16)", () => {
  it("at reactivity 0, a twelve-effect profile ignores the audio", () => {
    const zero: AudioFeatures = { level: 0, low: 0, mid: 0, high: 0, beat: 0, capturedAt: 0 };
    const full: AudioFeatures = { level: 1, low: 1, mid: 1, high: 1, beat: 1, capturedAt: 0 };
    for (const recognisability of DIAL_VALUES) {
      const dials = { recognisability, reactivity: 0 };
      expect(profileUniforms(twelve(), full, dials, 500, true, WIDTH)).toEqual(
        profileUniforms(twelve(), zero, dials, 500, true, WIDTH),
      );
    }
  });

  it("recognisability changes only pixelate's, posterise's and smear's values", () => {
    const features: AudioFeatures = {
      level: 0.4,
      low: 0.4,
      mid: 0.4,
      high: 0.4,
      beat: 0.4,
      capturedAt: 0,
    };
    const at = (recognisability: number) =>
      profileUniforms(twelve(), features, { recognisability, reactivity: 0.6 }, 500, true, WIDTH);
    const a = at(0);
    const b = at(1);
    const changed = (Object.keys(a) as (keyof typeof a)[]).filter(
      (key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
    );
    expect(changed.sort()).toEqual(["block", "feedback", "levels"]);
    expect(ALL_TYPES.filter((t) => EFFECTS[t].abstraction).sort()).toEqual([
      "pixelate",
      "posterise",
      "smear",
    ]);
  });
});

describe("effectStrength (SD4)", () => {
  const features: AudioFeatures = { level: 0, low: 0, mid: 0, high: 0.6, beat: 0.2, capturedAt: 0 };

  it("is base × recognisability for an abstraction effect, plus the binding", () => {
    const dials = { recognisability: 0.5, reactivity: 0.5 };
    expect(effectStrength(effectOf("smear", 0.8), features, dials)).toBeCloseTo(0.4, 12);
    const bound = effectOf("smear", 0.8, { feature: "high", amount: 0.5 });
    expect(effectStrength(bound, features, dials)).toBeCloseTo(0.4 + 0.5 * 0.6 * 0.5, 12);
    expect(effectStrength(effectOf("zoom", 0.8), features, dials)).toBeCloseTo(0.8, 12);
  });

  it("follows the feature its binding names (flash bound to high follows high, not beat)", () => {
    const dials = { recognisability: 0, reactivity: 1 };
    const flash = effectOf("flash", 0, { feature: "high", amount: 1 });
    expect(effectStrength(flash, features, dials)).toBeCloseTo(0.6, 12);
    expect(effectStrength(flash, { ...features, beat: 1 }, dials)).toBeCloseTo(0.6, 12);
    expect(effectStrength(flash, { ...features, high: 0.1 }, dials)).toBeCloseTo(0.1, 12);
  });

  it("clamps to 0..1 and reads anything non-finite as 0", () => {
    const wild = { level: Infinity, low: -4, mid: NaN, high: 9, beat: 7, capturedAt: NaN };
    const effect = { ...effectOf("zoom", 3, { feature: "high", amount: 5 }) } as Effect;
    expect(effectStrength(effect, wild, { recognisability: 2, reactivity: 2 })).toBe(1);
    const nan = { ...effectOf("smear", NaN, { feature: "mid", amount: 1 }) } as Effect;
    expect(effectStrength(nan, wild, { recognisability: NaN, reactivity: 1 })).toBe(0);
  });
});

describe("the flash bound (AC24)", () => {
  it("never exceeds 0.35 at every maximum, nor for inputs above 1", () => {
    const flash = effectOf("flash", 1, { feature: "beat", amount: 1 });
    const profile: Profile = { ...twelve(), effects: [flash] };
    const full: AudioFeatures = { level: 1, low: 1, mid: 1, high: 1, beat: 1, capturedAt: 0 };
    const max = profileUniforms(
      profile,
      full,
      { recognisability: 1, reactivity: 1 },
      0,
      true,
      WIDTH,
    );
    expect(max.flash).toBeCloseTo(0.35, 12);
    const wildFlash = { ...flash, amount: 7, binding: { feature: "beat", amount: 9 } } as Effect;
    const wild = profileUniforms(
      { ...profile, effects: [wildFlash] },
      { ...full, beat: 50 },
      { recognisability: 5, reactivity: 5 },
      0,
      true,
      WIDTH,
    );
    expect(wild.flash).toBeLessThanOrEqual(0.35);
  });
});

describe("profileUniforms", () => {
  it("gives identity values for effects the profile does not hold", () => {
    const empty: Profile = { ...twelve(), effects: [] };
    const full: AudioFeatures = { level: 1, low: 1, mid: 1, high: 1, beat: 1, capturedAt: 0 };
    const u = profileUniforms(empty, full, { recognisability: 1, reactivity: 1 }, 0, true, WIDTH);
    expect(u).toMatchObject({
      block: 1,
      levels: 256,
      feedback: 0,
      zoom: 1,
      displace: 0,
      flash: 0,
      grain: 0,
      edges: 0,
      brightness: 0,
      paletteMix: 0,
      mirror: 0,
      rgbSplit: 0,
    });
  });

  it("gives the new effects' parameters at strength 1 (spec Data table)", () => {
    const at1 = (type: EffectType) =>
      profileUniforms(
        { ...twelve(), effects: [effectOf(type, 1)] },
        featureGrid()[0]!,
        { recognisability: 1, reactivity: 1 },
        0,
        true,
        WIDTH,
      );
    expect(at1("paletteMap").paletteMix).toBe(1);
    expect(at1("mirror").mirror).toBe(1);
    expect(at1("mirror").segments).toBe(4);
    expect(at1("rgbSplit").rgbSplit).toBeCloseTo(0.03, 12);
  });

  it("carries the palette as up to six RGB triples with its length", () => {
    const u = profileUniforms(
      twelve(),
      featureGrid()[0]!,
      { recognisability: 0, reactivity: 0 },
      0,
      true,
      WIDTH,
    );
    expect(u.paletteSize).toBe(3);
    expect(u.palette).toHaveLength(6);
    expect(u.palette.slice(0, 3)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(u.flashColour).toEqual([1, 0, 0]);
  });

  it("is finite for wild inputs, with every effect present", () => {
    const wild = { level: Infinity, low: -4, mid: NaN, high: 9, beat: 7, capturedAt: NaN };
    for (const width of [0, 1, 640, 1e6]) {
      const u = profileUniforms(
        twelve(),
        wild,
        { recognisability: NaN, reactivity: 9 },
        NaN,
        false,
        width,
      );
      for (const value of Object.values(u).flat(2)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
