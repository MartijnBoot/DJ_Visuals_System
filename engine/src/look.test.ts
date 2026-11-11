// T3 (spec SD5, SD10, SD16, AC7, AC8; plan PD5, PD8, PD22): the mapping from features, dials
// and time to the look's uniforms, tested without a GPU.
import { describe, expect, it } from "vitest";
import { driftColour } from "./colour.ts";
import { DEFAULT_DIALS, ZERO_FEATURES, type AudioFeatures, type Dials } from "./features.ts";
import { lookUniforms } from "./look.ts";

const WIDTH = 640;
const FULL: AudioFeatures = { level: 1, low: 1, mid: 1, high: 1, beat: 1, capturedAt: 5 };
const T = 12_345;

describe("default dials (SD16)", () => {
  it("are recognisability 0.3 and reactivity 0.7", () => {
    expect(DEFAULT_DIALS).toEqual({ recognisability: 0.3, reactivity: 0.7 });
  });
});

describe("audio reactivity (AC7)", () => {
  it("at 0 the uniforms are identical for zero and full features", () => {
    for (const recognisability of [0, 0.3, 1]) {
      const dials: Dials = { recognisability, reactivity: 0 };
      for (const hasSource of [true, false]) {
        expect(lookUniforms(FULL, dials, T, hasSource, WIDTH)).toEqual(
          lookUniforms(ZERO_FEATURES, dials, T, hasSource, WIDTH),
        );
      }
    }
  });

  it("at 1 the flash and displacement follow the beat", () => {
    const dials: Dials = { recognisability: 0.3, reactivity: 1 };
    const still = lookUniforms(ZERO_FEATURES, dials, T, true, WIDTH);
    const half = lookUniforms({ ...ZERO_FEATURES, beat: 0.5 }, dials, T, true, WIDTH);
    const hit = lookUniforms({ ...ZERO_FEATURES, beat: 1 }, dials, T, true, WIDTH);
    expect(still.flash).toBe(0);
    expect(still.displace).toBe(0);
    expect(half.flash).toBeGreaterThan(0);
    expect(hit.flash).toBeGreaterThan(half.flash);
    expect(hit.displace).toBeGreaterThan(half.displace);
    expect(half.displace).toBeGreaterThan(0);
  });

  it("maps low to zoom, high to grain and edges, level to brightness", () => {
    const dials: Dials = { recognisability: 0.3, reactivity: 1 };
    const zero = lookUniforms(ZERO_FEATURES, dials, T, true, WIDTH);
    expect(lookUniforms({ ...ZERO_FEATURES, low: 1 }, dials, T, true, WIDTH).zoom).toBeGreaterThan(
      zero.zoom,
    );
    const high = lookUniforms({ ...ZERO_FEATURES, high: 1 }, dials, T, true, WIDTH);
    expect(high.grain).toBeGreaterThan(zero.grain);
    expect(high.edges).toBeGreaterThan(zero.edges);
    expect(
      lookUniforms({ ...ZERO_FEATURES, level: 1 }, dials, T, true, WIDTH).brightness,
    ).toBeGreaterThan(zero.brightness);
  });

  it("scales every audio term with the dial", () => {
    const low = lookUniforms(FULL, { recognisability: 0.3, reactivity: 0.25 }, T, true, WIDTH);
    const high = lookUniforms(FULL, { recognisability: 0.3, reactivity: 1 }, T, true, WIDTH);
    for (const key of ["flash", "displace", "grain", "edges", "brightness"] as const) {
      expect(high[key]).toBeCloseTo(low[key] * 4, 9);
    }
    expect(high.zoom - 1).toBeCloseTo((low.zoom - 1) * 4, 9);
  });
});

describe("recognisability (AC8, PD8, PD22)", () => {
  it("at 0 with reactivity 0 and a camera, the pass is the identity", () => {
    const u = lookUniforms(FULL, { recognisability: 0, reactivity: 0 }, T, true, WIDTH);
    expect(u.block).toBe(1);
    expect(u.levels).toBe(256);
    expect(u.feedback).toBe(0);
    expect(u.tintWeight).toBe(0);
    expect(u.zoom).toBe(1);
    for (const key of ["flash", "displace", "grain", "edges", "brightness"] as const) {
      expect(u[key]).toBe(0);
    }
  });

  it("at 1 the block is a 32nd of the render width", () => {
    for (const width of [640, 1920, 1000]) {
      const u = lookUniforms(
        ZERO_FEATURES,
        { recognisability: 1, reactivity: 0.7 },
        T,
        true,
        width,
      );
      expect(u.block).toBeCloseTo(width / 32, 9);
      expect(u.levels).toBeLessThan(256);
      expect(u.feedback).toBeGreaterThan(0);
    }
  });

  it("grows the block, cuts the levels and raises the feedback as the dial rises", () => {
    let previous = lookUniforms(
      ZERO_FEATURES,
      { recognisability: 0, reactivity: 0 },
      T,
      true,
      WIDTH,
    );
    for (let r = 0.1; r <= 1.0001; r += 0.1) {
      const u = lookUniforms(ZERO_FEATURES, { recognisability: r, reactivity: 0 }, T, true, WIDTH);
      expect(u.block).toBeGreaterThan(previous.block);
      expect(u.levels).toBeLessThan(previous.levels);
      expect(u.feedback).toBeGreaterThan(previous.feedback);
      previous = u;
    }
  });
});

describe("the generative input (SD10, PD5)", () => {
  it("is tinted by the drift colour without a camera, and not with one", () => {
    const without = lookUniforms(ZERO_FEATURES, DEFAULT_DIALS, T, false, WIDTH);
    expect(without.tintWeight).toBe(1);
    expect(without.tint).toEqual(driftColour(T));
    expect(lookUniforms(ZERO_FEATURES, DEFAULT_DIALS, T, true, WIDTH).tintWeight).toBe(0);
  });

  it("moves with time, so the idle look changes between two reads 500 ms apart", () => {
    const a = lookUniforms(ZERO_FEATURES, DEFAULT_DIALS, T, false, WIDTH);
    const b = lookUniforms(ZERO_FEATURES, DEFAULT_DIALS, T + 500, false, WIDTH);
    expect(b.time).not.toBe(a.time);
    expect(b.tint).not.toEqual(a.tint);
  });
});

describe("robustness", () => {
  it("every uniform is finite at every corner of the input cube", () => {
    const corners = [0, 1];
    for (const level of corners)
      for (const low of corners)
        for (const high of corners)
          for (const beat of corners)
            for (const recognisability of corners)
              for (const reactivity of corners)
                for (const hasSource of [true, false]) {
                  const u = lookUniforms(
                    { level, low, mid: 0.5, high, beat, capturedAt: 0 },
                    { recognisability, reactivity },
                    T,
                    hasSource,
                    WIDTH,
                  );
                  for (const value of Object.values(u).flat()) {
                    expect(Number.isFinite(value)).toBe(true);
                  }
                }
  });

  it("clamps dials and features outside 0 to 1", () => {
    const wild = lookUniforms(
      { level: 9, low: -3, mid: Number.NaN, high: 2, beat: 7, capturedAt: 0 },
      { recognisability: 4, reactivity: -1 },
      T,
      true,
      WIDTH,
    );
    expect(wild).toEqual(
      lookUniforms(ZERO_FEATURES, { recognisability: 1, reactivity: 0 }, T, true, WIDTH),
    );
  });
});
