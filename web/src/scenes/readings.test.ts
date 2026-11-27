import { describe, expect, it } from "vitest";
import { IGNORE_BUDGET_FLAG, previewReadings } from "./readings.ts";

const OVER = { overBudget: true, transitioning: false, fps: 30 };
const MOVING = { overBudget: true, transitioning: true, fps: 30 };

describe("previewReadings (D-24)", () => {
  it("passes the live engine's readings through as they are", () => {
    expect(previewReadings(OVER, {})).toBe(OVER);
  });

  it("with the test's flag set, over budget never pauses the preview", () => {
    expect(previewReadings(OVER, { [IGNORE_BUDGET_FLAG]: true })).toEqual({
      ...OVER,
      overBudget: false,
    });
  });

  it("with the flag set, a transition still pauses it (SD14)", () => {
    expect(previewReadings(MOVING, { [IGNORE_BUDGET_FLAG]: true }).transitioning).toBe(true);
  });

  it("only the value true counts", () => {
    for (const value of ["true", 1, {}, null]) {
      expect(previewReadings(OVER, { [IGNORE_BUDGET_FLAG]: value })).toBe(OVER);
    }
  });
});
