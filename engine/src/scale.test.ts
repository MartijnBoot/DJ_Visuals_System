// T4 (spec SD8, AC15; plan PD6): the render-scale controller, driven by injected frame
// timestamps through the real frame-statistics recorder.
import { describe, expect, it } from "vitest";
import { createScaleController } from "./scale.ts";
import { createFrameStats } from "./stats.ts";

/** A controller and a clock that feeds both it and its recorder, as the engine does. */
function rig() {
  const frames = createFrameStats();
  const controller = createScaleController(frames);
  let t = 0;
  /** One frame `dt` ms after the previous one. */
  const tick = (dt: number) => {
    t += dt;
    frames.record(t);
    controller.record(t);
  };
  /** Frames every `intervalMs` for `durationMs`; `each` sees the scale after every frame. */
  const run = (intervalMs: number, durationMs: number, each?: (scale: number) => void) => {
    for (let n = Math.round(durationMs / intervalMs); n > 0; n--) {
      tick(intervalMs);
      each?.(controller.scale());
    }
  };
  /** The first 60 frames at the display's period: the refresh estimate. */
  const settle = (hz = 60) => {
    for (let n = 0; n < 60; n++) tick(1000 / hz);
  };
  return { controller, tick, run, settle };
}

describe("refresh estimate (PD6)", () => {
  it("is 60 Hz from the first 60 frames at 60 Hz, and nothing before", () => {
    const { controller, tick } = rig();
    for (let n = 0; n < 59; n++) tick(1000 / 60);
    expect(controller.budgetMs()).toBe(0);
    tick(1000 / 60);
    expect(controller.budgetMs()).toBeCloseTo(16.67, 2);
  });

  it("snaps a 144 Hz display to 6.94 ms", () => {
    const { controller, settle } = rig();
    settle(144);
    expect(controller.budgetMs()).toBeCloseTo(6.94, 2);
  });

  it.each([50, 48])("snaps a %i Hz display to its own period, not to 60 Hz (review C1)", (hz) => {
    const { controller, settle } = rig();
    settle(hz);
    expect(controller.budgetMs()).toBeCloseTo(1000 / hz, 6);
  });

  it("a perfectly paced 50 Hz display never leaves 100% (review C1)", () => {
    const { controller, run, settle } = rig();
    settle(50);
    run(20, 30_000);
    expect(controller.scale()).toBe(1);
  });

  it("snaps a jittery 60 Hz to 60 Hz, and a few long frames do not move it", () => {
    const { controller, tick } = rig();
    for (let n = 0; n < 60; n++) tick(n % 15 === 7 ? 50 : 16 + (n % 3) * 0.7);
    expect(controller.budgetMs()).toBeCloseTo(1000 / 60, 6);
  });
});

describe("stepping (SD8, AC15)", () => {
  it("starts at 100%", () => {
    expect(createScaleController(createFrameStats()).scale()).toBe(1);
  });

  it("2 s above budget steps down once, another 2 s again, and never below 50%", () => {
    const { controller, run, settle } = rig();
    settle();
    const seen: number[] = [];
    const watch = (s: number) => seen.push(s);
    // The one-second mean needs about 270 ms of 25 ms frames to pass 1.1 × budget.
    run(25, 2000, watch);
    expect(controller.scale()).toBe(1);
    run(25, 500, watch);
    expect(controller.scale()).toBe(0.75);
    run(25, 1500, watch);
    expect(controller.scale()).toBe(0.75);
    run(25, 500, watch);
    expect(controller.scale()).toBe(0.5);
    run(25, 20_000, watch);
    expect(controller.scale()).toBe(0.5);
    expect(Math.min(...seen)).toBe(0.5);
  });

  it("goes one step at a time, never a jump", () => {
    const { controller, run, settle } = rig();
    settle();
    const changes: number[] = [controller.scale()];
    run(60, 30_000, (s) => {
      if (s !== changes.at(-1)) changes.push(s);
    });
    expect(changes).toEqual([1, 0.75, 0.5]);
  });

  it("10 s not above budget steps up once, and again after another 10 s (PD6, owner 2026-11-11)", () => {
    const { controller, run, settle } = rig();
    settle();
    run(25, 5000);
    expect(controller.scale()).toBe(0.5);
    run(1000 / 60, 9000); // at the display's rate, as a vsync-locked loop delivers
    expect(controller.scale()).toBe(0.5);
    run(1000 / 60, 2000);
    expect(controller.scale()).toBe(0.75);
    run(1000 / 60, 8000);
    expect(controller.scale()).toBe(0.75);
    run(1000 / 60, 2500);
    expect(controller.scale()).toBe(1);
  });

  it("frames just inside 1.1 × budget still count as not above it", () => {
    const { controller, run, settle } = rig();
    settle();
    run(25, 5000);
    run(18, 11_000); // 18 ms < 1.1 × 16.67 ms
    expect(controller.scale()).toBe(0.75);
  });

  // After 25 ms frames the one-second mean needs about 0.4 s of fast frames to drop under
  // budget, so every wait below carries a second of margin.
  it("a step up that fails within 10 s doubles the next wait; one that holds resets it", () => {
    const { controller, run, settle } = rig();
    settle();
    run(25, 5000);
    expect(controller.scale()).toBe(0.5);
    run(1000 / 60, 11_000);
    expect(controller.scale()).toBe(0.75); // the attempt
    run(25, 2500);
    expect(controller.scale()).toBe(0.5); // failed within 10 s: the next wait is 20 s
    run(1000 / 60, 15_000);
    expect(controller.scale()).toBe(0.5);
    run(1000 / 60, 6000);
    expect(controller.scale()).toBe(0.75);
    run(25, 2500);
    expect(controller.scale()).toBe(0.5); // failed again: 40 s
    run(1000 / 60, 35_000);
    expect(controller.scale()).toBe(0.5);
    run(1000 / 60, 6000);
    expect(controller.scale()).toBe(0.75);
    run(1000 / 60, 12_000); // held past 10 s: this one stuck, and the wait is 10 s again
    expect(controller.scale()).toBe(1);
    run(1000 / 60, 10_000); // and so does the step to 100%
    run(25, 2500); // new load, long after the last step up: the wait is still 10 s
    expect(controller.scale()).toBe(0.75);
    run(1000 / 60, 11_000);
    expect(controller.scale()).toBe(1);
  });

  it("never waits longer than 80 s", () => {
    const { controller, run, settle } = rig();
    settle();
    run(25, 5000);
    expect(controller.scale()).toBe(0.5);
    for (const waitS of [10, 20, 40, 80, 80]) {
      run(1000 / 60, waitS * 1000 - 1000);
      expect(controller.scale(), `still waiting at ${waitS} s`).toBe(0.5);
      run(1000 / 60, 2000);
      expect(controller.scale(), `stepped up after ${waitS} s`).toBe(0.75);
      run(25, 2500); // fails at once
      expect(controller.scale()).toBe(0.5);
    }
  });

  it("a cap of 75% holds: never above it, even with headroom", () => {
    const { controller, run, settle } = rig();
    controller.setCap(0.75);
    expect(controller.scale()).toBe(0.75);
    settle();
    const seen: number[] = [];
    run(1000 / 60, 30_000, (s) => seen.push(s));
    run(25, 5000, (s) => seen.push(s));
    expect(controller.scale()).toBe(0.5);
    run(1000 / 60, 30_000, (s) => seen.push(s));
    expect(controller.scale()).toBe(0.75);
    expect(Math.max(...seen)).toBe(0.75);
  });

  it("lowering the cap below the current scale applies at once; raising it lets it climb", () => {
    const { controller, run, settle } = rig();
    settle();
    controller.setCap(0.5);
    expect(controller.scale()).toBe(0.5);
    controller.setCap(1);
    expect(controller.scale()).toBe(0.5);
    run(1000 / 60, 25_000);
    expect(controller.scale()).toBe(1);
  });
});
