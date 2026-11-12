// T3 (B-02 spec AC22, SD19; plan PD15): the synthetic loop drives the builder's preview with no
// music, as a pure function of time.
import { describe, expect, it } from "vitest";
import { BEAT_PERIOD_MS, syntheticFeatures } from "./synthetic.ts";

const FRAME_MS = 1000 / 60;
const FIELDS = ["level", "low", "mid", "high", "beat"] as const;

/** One sample per 60 Hz frame for ten seconds; `(i * 1000) / 60` lands exactly on the grid. */
const samples = Array.from({ length: 600 }, (_, i) => {
  const t = (i * 1000) / 60;
  return { t, f: syntheticFeatures(t) };
});

describe("syntheticFeatures (AC22)", () => {
  it("is a 120 BPM grid", () => {
    expect(BEAT_PERIOD_MS).toBe(500);
  });

  it("pulses beat to at least 0.9 within one frame of each of the 20 grid instants", () => {
    for (let k = 0; k < 20; k++) {
      const grid = k * BEAT_PERIOD_MS;
      const near = samples.filter((s) => s.t >= grid && s.t < grid + FRAME_MS);
      expect(near.length).toBeGreaterThan(0);
      expect(Math.max(...near.map((s) => s.f.beat))).toBeGreaterThanOrEqual(0.9);
      if (k > 0) {
        const before = samples.filter((s) => s.t < grid && s.t >= grid - FRAME_MS);
        for (const s of before) expect(s.f.beat).toBeLessThan(0.2);
      }
    }
  });

  it("keeps every field within 0 to 1, for every sample and for extreme times", () => {
    const extreme = [-1, -12_345.6, -1e15, 1e15, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity];
    for (const f of [...samples.map((s) => s.f), ...extreme.map(syntheticFeatures)]) {
      for (const field of FIELDS) {
        expect(f[field]).toBeGreaterThanOrEqual(0);
        expect(f[field]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is deterministic and records no capture time (PD15)", () => {
    expect(syntheticFeatures(1234.5)).toEqual(syntheticFeatures(1234.5));
    expect(samples.every((s) => s.f.capturedAt === 0)).toBe(true);
  });

  it("puts the hats on high between kicks, the kick on low, and swells mid and level", () => {
    const highest = samples.slice(0, 30).reduce((a, b) => (b.f.high > a.f.high ? b : a));
    expect(highest.t).toBeGreaterThan(BEAT_PERIOD_MS / 4);
    expect(highest.t).toBeLessThan((BEAT_PERIOD_MS * 3) / 4);
    expect(syntheticFeatures(0).low).toBeGreaterThan(syntheticFeatures(BEAT_PERIOD_MS / 2).low);
    const mids = samples.map((s) => s.f.mid);
    const levels = samples.map((s) => s.f.level);
    expect(Math.max(...mids) - Math.min(...mids)).toBeGreaterThan(0.3);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.3);
  });
});
