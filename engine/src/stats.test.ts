import { describe, expect, it } from "vitest";
import { createFrameStats, WINDOW_MS } from "./stats.ts";

const FRAME = 1000 / 60;

function steady(frames: number, from = 0) {
  const stats = createFrameStats();
  for (let i = 0; i < frames; i++) stats.record(from + i * FRAME);
  return stats;
}

describe("frame statistics", () => {
  it("reads zero with no frames", () => {
    expect(createFrameStats().read(5000)).toEqual({ fps: 0, frameTimeMs: 0, lastFrameAt: 0 });
  });

  it("reads 60 fps and 16.7 ms at a steady 60 Hz", () => {
    const stats = steady(120);
    const now = 119 * FRAME;
    const { fps, frameTimeMs, lastFrameAt } = stats.read(now);
    expect(fps).toBe(60);
    expect(frameTimeMs).toBeCloseTo(16.7, 1);
    expect(lastFrameAt).toBe(now);
  });

  it("reads 30 fps and 33.3 ms at a steady 30 Hz", () => {
    const stats = createFrameStats();
    for (let i = 0; i < 90; i++) stats.record(i * (1000 / 30));
    const { fps, frameTimeMs } = stats.read(89 * (1000 / 30));
    expect(fps).toBe(30);
    expect(frameTimeMs).toBeCloseTo(33.3, 1);
  });

  it("lets frames older than one second fall out", () => {
    const stats = steady(30); // half a second of frames
    expect(stats.read(29 * FRAME).fps).toBe(30);
    expect(stats.read(29 * FRAME + WINDOW_MS + 1)).toEqual({
      fps: 0,
      frameTimeMs: 0,
      lastFrameAt: 29 * FRAME,
    });
  });

  it("averages over the last second only", () => {
    const stats = createFrameStats();
    for (let i = 0; i < 30; i++) stats.record(i * 100); // slow: 10 Hz for 3 s
    for (let i = 1; i <= 60; i++) stats.record(2900 + i * FRAME); // then 60 Hz for 1 s
    const { fps, frameTimeMs } = stats.read(2900 + 60 * FRAME);
    expect(fps).toBe(60);
    expect(frameTimeMs).toBeCloseTo(16.7, 1);
  });
});

describe("frame buffer bound", () => {
  it("record keeps no more than one second of frames even when read is never called", () => {
    const stats = createFrameStats();
    for (let i = 0; i < 100_000; i++) stats.record(i * FRAME); // ~28 minutes, never read
    expect(stats.size()).toBeLessThanOrEqual(Math.ceil(WINDOW_MS / FRAME) + 1);
    const { fps, frameTimeMs } = stats.read(99_999 * FRAME);
    expect(fps).toBe(60);
    expect(frameTimeMs).toBeCloseTo(16.7, 1);
  });
});
