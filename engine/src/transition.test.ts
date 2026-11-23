// B-09 T3 (spec SD13, AC1, AC14, AC15; plan PD7): a transition's progress by frame timestamps,
// and the Crossfade weight, as pure functions with injected timestamps (the `scale.ts` way).
import { describe, expect, it } from "vitest";
import { crossfadeWeight, progress } from "./transition.ts";

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
