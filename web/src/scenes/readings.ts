// D-24: the live engine's readings as the preview's pause rule (SD14, `pause.ts`) hears them. In
// the gate's headless Chromium on a CI runner, software WebGL draws the screen page at a tablet's
// size over budget for good (30–50 ms a frame against a 60 Hz budget, even at 50% scale), so the
// preview, correctly, never runs and `tests/browser/scenes-e2e.spec.ts` can prove nothing about
// what it shows. That test sets this flag in an init script before the page loads; nothing in the
// product sets it, and with it a transition still pauses the preview.
export const IGNORE_BUDGET_FLAG = "__djvPreviewIgnoresBudget";

interface LiveReadings {
  overBudget: boolean;
  transitioning: boolean;
}

export function previewReadings<T extends LiveReadings>(live: T, scope: object = globalThis): T {
  const ignore = (scope as Record<string, unknown>)[IGNORE_BUDGET_FLAG] === true;
  return ignore ? { ...live, overBudget: false } : live;
}
