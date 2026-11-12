// T1 (spec AC6, SD4; plan PD1, PD7): the analysis maths on synthetic signals at both common
// sample rates. Blocks are fed one render quantum (128 frames) at a time, as the worklet does.
import { describe, expect, it } from "vitest";
import { createAnalyser, windowFrames, type FeatureFrame } from "./analysis.ts";
import { RENDER_QUANTUM_FRAMES } from "./constants.ts";

const RATES = [48_000, 44_100];
const FEATURES = ["level", "low", "mid", "high", "beat"] as const;

/** Runs a signal through a fresh analyser and returns every frame with its window end in ms. */
function analyse(
  sampleRate: number,
  signal: (t: number, i: number) => number,
  seconds: number,
  analyser = createAnalyser(sampleRate),
  startFrame = 0,
): { frames: (FeatureFrame & { at: number })[]; analyser: ReturnType<typeof createAnalyser> } {
  const total = Math.round(seconds * sampleRate);
  const frames: (FeatureFrame & { at: number })[] = [];
  const block = new Float32Array(RENDER_QUANTUM_FRAMES);
  for (let start = 0; start < total; start += RENDER_QUANTUM_FRAMES) {
    for (let j = 0; j < RENDER_QUANTUM_FRAMES; j++) {
      const i = startFrame + start + j;
      block[j] = signal(i / sampleRate, i);
    }
    const frame = analyser.push(block);
    if (frame) {
      const end = startFrame + start + RENDER_QUANTUM_FRAMES;
      frames.push({ ...frame, at: (end / sampleRate) * 1000 });
    }
  }
  return { frames, analyser };
}

const sine = (hz: number, amplitude: number) => (t: number) =>
  amplitude * Math.sin(2 * Math.PI * hz * t);

/** The mean of one feature over the frames after the first 200 ms (filters settled). */
function settled(frames: (FeatureFrame & { at: number })[], key: (typeof FEATURES)[number]) {
  const after = frames.filter((f) => f.at > 200);
  return after.reduce((sum, f) => sum + f[key], 0) / after.length;
}

/** A deterministic white-noise source (mulberry32) so the test never flakes. */
function noise(amplitude: number) {
  let state = 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    const u = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    return amplitude * (2 * u - 1) * Math.sqrt(3); // uniform with RMS = amplitude
  };
}

describe.each(RATES)("analysis at %i Hz (AC6)", (sampleRate) => {
  const HALF = 0.5; // −6 dBFS

  it("every window is at most 10 ms", () => {
    expect((windowFrames(sampleRate) / sampleRate) * 1000).toBeLessThanOrEqual(10);
    const { frames } = analyse(sampleRate, () => 0, 1);
    const spacing = frames[1]!.at - frames[0]!.at;
    expect(spacing).toBeLessThanOrEqual(10);
    expect(spacing).toBeCloseTo((windowFrames(sampleRate) / sampleRate) * 1000, 6);
  });

  it("silence gives all zeros", () => {
    const { frames } = analyse(sampleRate, () => 0, 1);
    for (const f of frames) for (const key of FEATURES) expect(f[key]).toBe(0);
    expect(frames.some((f) => f.onset)).toBe(false);
  });

  it("a 60 Hz sine reads in low, not in mid or high", () => {
    const { frames } = analyse(sampleRate, sine(60, HALF), 1);
    expect(settled(frames, "low")).toBeGreaterThan(0.5);
    expect(settled(frames, "mid")).toBeLessThan(0.05);
    expect(settled(frames, "high")).toBeLessThan(0.05);
    expect(settled(frames, "level")).toBeGreaterThan(0.5);
  });

  it("a 1 kHz sine reads in mid, not in low or high", () => {
    const { frames } = analyse(sampleRate, sine(1000, HALF), 1);
    expect(settled(frames, "mid")).toBeGreaterThan(0.5);
    expect(settled(frames, "low")).toBeLessThan(0.05);
    expect(settled(frames, "high")).toBeLessThan(0.05);
  });

  it("a 6 kHz sine reads in high, not in low or mid", () => {
    const { frames } = analyse(sampleRate, sine(6000, HALF), 1);
    expect(settled(frames, "high")).toBeGreaterThan(0.5);
    expect(settled(frames, "low")).toBeLessThan(0.05);
    expect(settled(frames, "mid")).toBeLessThan(0.05);
  });

  it("a full-scale square wave clamps every feature to at most 1", () => {
    const { frames } = analyse(
      sampleRate,
      (t) => (Math.sin(2 * Math.PI * 60 * t) >= 0 ? 1 : -1),
      1,
    );
    for (const f of frames) {
      for (const key of FEATURES) {
        expect(f[key]).toBeGreaterThanOrEqual(0);
        expect(f[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a 120 BPM click train fires the beat within one window of each onset, never between", () => {
    const periodS = 0.5;
    const burstS = 0.03;
    const click = (t: number) =>
      t % periodS < burstS ? 0.891 * Math.sin(2 * Math.PI * 60 * (t % periodS)) : 0; // −1 dBFS
    const { frames } = analyse(sampleRate, click, 4);
    const windowMs = (windowFrames(sampleRate) / sampleRate) * 1000;
    const onsets = frames.filter((f) => f.onset).map((f) => f.at);
    const clickStarts = Array.from({ length: 8 }, (_, k) => k * periodS * 1000);
    expect(onsets).toHaveLength(clickStarts.length);
    onsets.forEach((at, k) => {
      // The window that contains the burst start, or the one after it (the filter's delay).
      expect(at).toBeGreaterThan(clickStarts[k]!);
      expect(at).toBeLessThanOrEqual(clickStarts[k]! + 2 * windowMs);
    });
    for (const f of frames.filter((f) => f.onset)) expect(f.beat).toBe(1);
  });

  it("white noise at −20 dBFS fires no beat after the first second", () => {
    const { frames } = analyse(sampleRate, noise(0.1), 5);
    expect(frames.filter((f) => f.at > 1000 && f.onset)).toEqual([]);
  });

  it("1 s of silence after a full-scale signal leaves every feature below 0.01", () => {
    const loud = (t: number) =>
      Math.sin(2 * Math.PI * 60 * t) + Math.sin(2 * Math.PI * 1000 * t) > 0 ? 1 : -1;
    const first = analyse(sampleRate, loud, 1);
    const rest = analyse(sampleRate, () => 0, 1, first.analyser, Math.round(sampleRate));
    const last = rest.frames[rest.frames.length - 1]!;
    for (const key of FEATURES) expect(last[key]).toBeLessThan(0.01);
  });
});

describe("windowFrames", () => {
  it("is a whole number of render quanta", () => {
    for (const rate of [22_050, 44_100, 48_000, 96_000]) {
      expect(windowFrames(rate) % RENDER_QUANTUM_FRAMES).toBe(0);
      expect(windowFrames(rate)).toBeGreaterThan(0);
    }
  });

  it("stays at or under 10 ms even at a low sample rate", () => {
    expect((windowFrames(22_050) / 22_050) * 1000).toBeLessThanOrEqual(10);
  });
});
