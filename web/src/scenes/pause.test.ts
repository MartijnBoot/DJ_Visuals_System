// B-07 T12 (SD14, AC31; plan PD12): the preview yields to the output. It pauses while the live
// engine is over its frame budget or drawing a transition, and runs again only after 2 s of
// neither, measured on frame timestamps.
import { describe, expect, it } from "vitest";
import { RESUME_AFTER_MS, createPauseRule } from "./pause.ts";

const calm = { overBudget: false, transitioning: false };

describe("createPauseRule (PD12)", () => {
  it("runs while the output is calm", () => {
    const rule = createPauseRule();
    expect(rule.update(0, calm)).toBe(false);
    expect(rule.update(5_000, calm)).toBe(false);
  });

  it("pauses at once when the output is over budget, and when it draws a transition", () => {
    expect(createPauseRule().update(16, { overBudget: true, transitioning: false })).toBe(true);
    expect(createPauseRule().update(16, { overBudget: false, transitioning: true })).toBe(true);
  });

  it("stays paused 1999 ms after the last busy frame and resumes at 2000 ms", () => {
    expect(RESUME_AFTER_MS).toBe(2000);
    const rule = createPauseRule();
    rule.update(100, { overBudget: true, transitioning: false });
    expect(rule.update(1_000, calm)).toBe(true);
    expect(rule.update(2_099, calm)).toBe(true);
    expect(rule.update(2_100, calm)).toBe(false);
  });

  it("a new busy frame while paused starts the 2 s again", () => {
    const rule = createPauseRule();
    rule.update(0, { overBudget: false, transitioning: true });
    rule.update(1_500, { overBudget: true, transitioning: false });
    expect(rule.update(3_000, calm)).toBe(true);
    expect(rule.update(3_499, calm)).toBe(true);
    expect(rule.update(3_500, calm)).toBe(false);
  });
});
