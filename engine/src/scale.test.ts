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

  it("10 s under 0.8 × budget steps up once, and again after another 10 s", () => {
    const { controller, run, settle } = rig();
    settle();
    run(25, 5000);
    expect(controller.scale()).toBe(0.5);
    run(10, 9000);
    expect(controller.scale()).toBe(0.5);
    run(10, 2000);
    expect(controller.scale()).toBe(0.75);
    run(10, 8000);
    expect(controller.scale()).toBe(0.75);
    run(10, 2500);
    expect(controller.scale()).toBe(1);
  });

  it("holds between the two thresholds", () => {
    const { controller, run, settle } = rig();
    settle();
    run(25, 5000);
    run(1000 / 60, 60_000); // at budget: neither above 1.1× nor under 0.8×
    expect(controller.scale()).toBe(0.5);
  });

  it("a cap of 75% holds: never above it, even with headroom", () => {
    const { controller, run, settle } = rig();
    controller.setCap(0.75);
    expect(controller.scale()).toBe(0.75);
    settle();
    const seen: number[] = [];
    run(10, 30_000, (s) => seen.push(s));
    run(25, 5000, (s) => seen.push(s));
    expect(controller.scale()).toBe(0.5);
    run(10, 30_000, (s) => seen.push(s));
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
    run(10, 25_000);
    expect(controller.scale()).toBe(1);
  });
});
