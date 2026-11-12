// T2 (spec SD15, AC12; plan PD2): the context-to-performance clock map and the decay of stale
// features.
import { describe, expect, it } from "vitest";
import { createClockMap, decayFeatures, DECAY_END_MS, DECAY_HOLD_MS } from "./clock.ts";
import type { AudioFeatures } from "./features.ts";

const FULL: AudioFeatures = { level: 1, low: 0.8, mid: 0.6, high: 0.4, beat: 1, capturedAt: 1234 };

describe("clock map (PD2)", () => {
  it("maps context seconds to performance milliseconds through the last pair", () => {
    const clock = createClockMap();
    clock.update(2, 5000); // context 2 s was performance 5000 ms
    expect(clock.toPerformance(2)).toBe(5000);
    expect(clock.toPerformance(2.5)).toBe(5500);
    expect(clock.toPerformance(1.9)).toBeCloseTo(4900, 9);
  });

  it("is affine: equal context steps give equal performance steps", () => {
    const clock = createClockMap();
    clock.update(10, 20_000);
    const a = clock.toPerformance(11) - clock.toPerformance(10);
    const b = clock.toPerformance(12) - clock.toPerformance(11);
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeCloseTo(1000, 9);
  });

  it("follows a new pair after update", () => {
    const clock = createClockMap();
    clock.update(1, 1000);
    expect(clock.toPerformance(3)).toBe(3000);
    clock.update(2, 2100); // the clocks drifted 100 ms apart
    expect(clock.toPerformance(3)).toBe(3100);
  });
});

describe("feature decay (AC12)", () => {
  it(`holds the features for the first ${DECAY_HOLD_MS} ms of silence`, () => {
    expect(decayFeatures(FULL, 0)).toEqual(FULL);
    expect(decayFeatures(FULL, DECAY_HOLD_MS)).toEqual(FULL);
  });

  it(`is zero at ${DECAY_END_MS} ms and after, and keeps capturedAt`, () => {
    for (const ms of [DECAY_END_MS, DECAY_END_MS + 1, 10_000]) {
      expect(decayFeatures(FULL, ms)).toEqual({
        level: 0,
        low: 0,
        mid: 0,
        high: 0,
        beat: 0,
        capturedAt: FULL.capturedAt,
      });
    }
  });

  it("falls monotonically between the hold and the end, inside AC12's second", () => {
    expect(DECAY_END_MS).toBeLessThanOrEqual(1000);
    let previous = decayFeatures(FULL, DECAY_HOLD_MS);
    for (let ms = DECAY_HOLD_MS + 10; ms <= DECAY_END_MS; ms += 10) {
      const next = decayFeatures(FULL, ms);
      for (const key of ["level", "low", "mid", "high", "beat"] as const) {
        expect(next[key]).toBeLessThanOrEqual(previous[key]);
      }
      previous = next;
    }
    expect(decayFeatures(FULL, (DECAY_HOLD_MS + DECAY_END_MS) / 2).level).toBeCloseTo(0.5, 9);
  });
});
