// B-09 T3, T4 (spec SD13, SD14, AC1 to AC4, AC14, AC15; plan PD7, PD8, PD10): a transition's
// progress by frame timestamps, and the Crossfade, Dip and Wipe weights, as pure functions with
// injected timestamps (the `scale.ts` way).
import { describe, expect, it } from "vitest";
import { FLASH_MAX } from "./look.ts";
import { crossfadeWeight, dipShares, progress, wipeWeight } from "./transition.ts";

describe("progress (SD13, PD7)", () => {
  it("is 0 on the first frame, elapsed / duration after, and 1 from the duration on", () => {
    expect(progress(1000, 1000, 2000)).toBe(0);
    expect(progress(1500, 1000, 2000)).toBe(0.25);
    expect(progress(3000, 1000, 2000)).toBe(1);
    expect(progress(3100, 1000, 2000)).toBe(1);
  });

  it("never goes below 0, whatever the timestamps", () => {
    expect(progress(900, 1000, 2000)).toBe(0);
  });

  it("is 1 at once for a duration of 0 or less", () => {
    expect(progress(1000, 1000, 0)).toBe(1);
  });
});

describe("the Crossfade weight (SD13, AC1)", () => {
  it("is the progress itself: the new look's share", () => {
    for (const p of [0, 0.1, 0.5, 0.9, 1]) expect(crossfadeWeight(p)).toBe(p);
  });
});

describe("the flash bound (AC14)", () => {
  it("moves the weight by at most 0.14 a frame for every duration and frame interval allowed", () => {
    let worst = 0;
    for (let tenths = 5; tenths <= 80; tenths++) {
      const durationMs = tenths * 100;
      for (const intervalMs of [1, 4, 8.33, 16.67, 20, 25, 33.33]) {
        let before = crossfadeWeight(progress(0, 0, durationMs));
        for (let t = intervalMs; t <= durationMs + intervalMs; t += intervalMs) {
          const now = crossfadeWeight(progress(t, 0, durationMs));
          worst = Math.max(worst, Math.abs(now - before));
          before = now;
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(0.14);
  });
});

describe("Dip to colour (SD12, SD13, PD10)", () => {
  it("goes from the old look to the colour over 0 to 0.5, then to the new look", () => {
    expect(dipShares(0)).toEqual({ outgoing: 1, colour: 0, incoming: 0 });
    expect(dipShares(0.25)).toEqual({ outgoing: 0.5, colour: 0.5, incoming: 0 });
    expect(dipShares(0.5)).toEqual({ outgoing: 0, colour: 1, incoming: 0 });
    expect(dipShares(0.75)).toEqual({ outgoing: 0, colour: 0.5, incoming: 0.5 });
    expect(dipShares(1)).toEqual({ outgoing: 0, colour: 0, incoming: 1 });
  });

  it("moves each share by at most 0.14 a frame, and the luma it causes by less than FLASH_MAX (AC14)", () => {
    const luma = ([r, g, b]: number[]) => 0.299 * r! + 0.587 * g! + 0.114 * b!;
    const colours = [
      [0, 0, 0],
      [1, 1, 1],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    let worstShare = 0;
    let worstLuma = 0;
    for (let tenths = 5; tenths <= 80; tenths++) {
      const durationMs = tenths * 100;
      for (const intervalMs of [8.33, 16.67, 33.33]) {
        let before = dipShares(0);
        for (let t = intervalMs; t <= durationMs + intervalMs; t += intervalMs) {
          const now = dipShares(progress(t, 0, durationMs));
          for (const k of ["outgoing", "colour", "incoming"] as const) {
            worstShare = Math.max(worstShare, Math.abs(now[k] - before[k]));
          }
          for (const a of colours) {
            for (const d of colours) {
              for (const b of colours) {
                const at = (s: typeof now) =>
                  luma(a.map((_, i) => s.outgoing * a[i]! + s.colour * d[i]! + s.incoming * b[i]!));
                worstLuma = Math.max(worstLuma, Math.abs(at(now) - at(before)));
              }
            }
          }
          before = now;
        }
      }
    }
    expect(worstShare).toBeLessThanOrEqual(0.14);
    expect(worstLuma).toBeLessThan(FLASH_MAX);
  });
});

describe("Wipe (SD14, PD8, AC3)", () => {
  /** x from 0 to 1 in steps of 0.001: the share of the new look at each. */
  const xs = Array.from({ length: 1001 }, (_, i) => i / 1000);

  for (const p of [0, 0.3, 0.97, 1]) {
    it(`at p = ${p}: new left of p - 0.04, old right of p, all new at 1`, () => {
      for (const x of xs) {
        const w = wipeWeight(x, p);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
        if (x < p - 0.04) expect(w).toBe(1);
        if (x > p) expect(w).toBe(0);
        if (p === 1) expect(w).toBe(1);
      }
    });
  }

  it("never takes a pixel back from the new look as p grows", () => {
    for (const x of xs) {
      let before = 0;
      for (let p = 0; p <= 1; p += 0.01) {
        const w = wipeWeight(x, p);
        expect(w).toBeGreaterThanOrEqual(before);
        before = w;
      }
    }
  });
});
