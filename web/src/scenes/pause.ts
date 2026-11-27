// The preview's pause rule (B-07 spec SD14, AC31; plan PD12): the output comes first. The preview
// pauses while the live engine reads over its frame budget or draws a transition, and runs again
// after 2 s of neither, on frame timestamps. Pure, so the timing is tested without a GPU.

/** PD12: how long the output must stay calm before the preview runs again. */
export const RESUME_AFTER_MS = 2000;

export interface PauseRule {
  /** This frame's reading of the live engine; true while the preview should be paused. */
  update(now: number, live: { overBudget: boolean; transitioning: boolean }): boolean;
}

export function createPauseRule(): PauseRule {
  let busyAt: number | null = null;
  return {
    update(now, { overBudget, transitioning }) {
      if (overBudget || transitioning) busyAt = now;
      if (busyAt === null) return false;
      if (now - busyAt < RESUME_AFTER_MS) return true;
      busyAt = null;
      return false;
    },
  };
}
