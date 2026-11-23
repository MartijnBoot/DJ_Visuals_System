// B-09 T3 to T5 (spec SD10, SD13, SD14, AC1 to AC5, AC14, AC15; plan PD7, PD8, PD10): a transition's
// progress by frame timestamps, and the Crossfade, Dip and Wipe weights, as pure functions with
// injected timestamps (the `scale.ts` way).
import { describe, expect, it } from "vitest";
import { FLASH_MAX } from "./look.ts";
import {
  BEAT_WAIT_MS,
  createBeatWait,
  crossfadeWeight,
  dipShares,
  progress,
  wipeWeight,
} from "./transition.ts";

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
    // The luma the weight alone moves is the shares' change times the three lumas, each in
    // [0, 1]: at most the sum of the shares' changes, whatever the colours. That bound is checked,
    // so every colour is covered without trying colours (B-09 T4; a sweep over colour triples
    // took 8 s under the gate's parallel load and timed out).
    let worstShare = 0;
    let worstLuma = 0;
    for (let tenths = 5; tenths <= 80; tenths++) {
      const durationMs = tenths * 100;
      for (const intervalMs of [1, 4, 8.33, 16.67, 20, 25, 33.33]) {
        let before = dipShares(0);
        for (let t = intervalMs; t <= durationMs + intervalMs; t += intervalMs) {
          const now = dipShares(progress(t, 0, durationMs));
          let sum = 0;
          for (const k of ["outgoing", "colour", "incoming"] as const) {
            const change = Math.abs(now[k] - before[k]);
            worstShare = Math.max(worstShare, change);
            sum += change;
          }
          worstLuma = Math.max(worstLuma, sum);
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

describe("Beat cut's wait (SD10, AC5)", () => {
  /** Calls `cut` every 16 ms from `readyAt` with `beatAt(t)`; the time it first says cut. */
  const cutAt = (beatAt: (t: number) => number, audioOk = true, readyAt = 1000) => {
    const wait = createBeatWait(readyAt);
    for (let t = readyAt; t < readyAt + 5000; t += 4) {
      if (wait.cut(t, beatAt(t), audioOk)) return t - readyAt;
    }
    return null;
  };

  it("cuts on the frame whose beat rises to 0.5 from below", () => {
    expect(cutAt((t) => (t >= 1300 ? 0.8 : 0.1))).toBe(300);
  });

  it("cuts at 2 s with no rise", () => {
    expect(BEAT_WAIT_MS).toBe(2000);
    expect(cutAt(() => 0.2)).toBe(2000);
  });

  it("cuts at once while the audio is not ok", () => {
    expect(cutAt(() => 0, false)).toBe(0);
    expect(cutAt(() => 1, false)).toBe(0);
  });

  it("waits for a fall and a rise when the beat is already high at ready", () => {
    expect(cutAt((t) => (t < 1500 ? 1 : t < 1600 ? 0 : 1))).toBe(600);
  });

  it("counts 0.49 to 0.5 as a rise", () => {
    expect(cutAt((t) => (t >= 1100 ? 0.5 : 0.49))).toBe(100);
  });
});
