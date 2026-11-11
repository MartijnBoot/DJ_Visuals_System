import { describe, expect, it } from "vitest";
import { driftColour, HUE_PERIOD_MS } from "./colour.ts";

const to8bit = (c: readonly [number, number, number]) => c.map((v) => Math.round(v * 255));

describe("driftColour", () => {
  it("returns three channels in 0..1", () => {
    for (const t of [0, 1234, 59_999, 123_456]) {
      const c = driftColour(t);
      expect(c).toHaveLength(3);
      for (const v of c) expect(v).toBeGreaterThanOrEqual(0);
      for (const v of c) expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("differs by at least one 8-bit step in some channel across 500 ms (AC11)", () => {
    for (let t = 0; t < HUE_PERIOD_MS; t += 2500) {
      const a = to8bit(driftColour(t));
      const b = to8bit(driftColour(t + 500));
      const maxStep = Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
      expect(maxStep, `at t=${t}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("cycles once per 60 s (PD15)", () => {
    expect(HUE_PERIOD_MS).toBe(60_000);
    for (const t of [0, 7_000, 31_500]) {
      const a = driftColour(t);
      const b = driftColour(t + HUE_PERIOD_MS);
      for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i]!, 9);
    }
  });
});
