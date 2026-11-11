// Automatic render scaling (spec SD8, AC15; plan PD6 as the owner decided at build,
// 2026-11-11). A pure controller of frame timestamps: it estimates the display's refresh rate
// once, then compares the one-second mean frame time from the engine's `FrameStatsRecorder`
// (`stats.ts`) with that budget, one step at a time. Headroom is "not above budget": a loop
// locked to the display never reads under the refresh period, so a stricter test would never
// step up. A step up that fails within the hold doubles the next wait, so a GPU on the edge
// does not bounce between two steps.
import type { FrameStatsRecorder } from "./stats.ts";

export type RenderScale = 1 | 0.75 | 0.5;

/** The steps, largest first; never below the last (SD8). */
export const SCALES: readonly RenderScale[] = [1, 0.75, 0.5];

/** Refresh rates the estimate snaps to (PD6). */
export const REFRESH_RATES_HZ = [30, 60, 75, 90, 120, 144, 165, 240];

/** Frames whose median interval gives the refresh estimate (PD6). */
export const ESTIMATE_FRAMES = 60;

/** Above budget: the one-second mean exceeds this × budget (PD6). */
export const ABOVE_BUDGET = 1.1;

/** Time above budget before a step down, and not above it before a step up (SD8). */
export const STEP_DOWN_AFTER_MS = 2000;
export const STEP_UP_AFTER_MS = 10_000;

/** The wait before a step up doubles per failed attempt, up to this. */
export const STEP_UP_MAX_WAIT_MS = 80_000;

export interface ScaleController {
  /** Call once per frame, after the frame-stats recorder has recorded the same timestamp. */
  record(timestamp: number): void;
  /** The manual cap from the panel: the automatic scale never exceeds it. */
  setCap(cap: RenderScale): void;
  scale(): RenderScale;
  /** The refresh period in ms; 0 until the first `ESTIMATE_FRAMES` frames are in. */
  budgetMs(): number;
}

export function createScaleController(frameStats: FrameStatsRecorder): ScaleController {
  const firstFrames: number[] = [];
  let budget = 0;
  let index = 0; // into SCALES
  let capIndex = 0;
  let aboveSince: number | null = null;
  let headroomSince: number | null = null;
  let stepUpWait = STEP_UP_AFTER_MS;
  let lastStepUpAt: number | null = null;

  const estimate = () => {
    const intervals = firstFrames
      .slice(1)
      .map((t, i) => t - firstFrames[i]!)
      .sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)]!;
    const hz = 1000 / median;
    const snapped = REFRESH_RATES_HZ.reduce((best, r) =>
      Math.abs(r - hz) < Math.abs(best - hz) ? r : best,
    );
    budget = 1000 / snapped;
  };

  const step = (to: number, at: number) => {
    if (to < index) {
      lastStepUpAt = at;
    } else {
      // A step down soon after a step up is that attempt failing; one long after is new load.
      if (lastStepUpAt !== null) stepUpWait = Math.min(stepUpWait * 2, STEP_UP_MAX_WAIT_MS);
      lastStepUpAt = null;
    }
    index = to;
    aboveSince = null;
    headroomSince = null;
  };

  return {
    record(timestamp) {
      if (budget === 0) {
        firstFrames.push(timestamp);
        if (firstFrames.length === ESTIMATE_FRAMES) estimate();
        return;
      }
      const { frameTimeMs } = frameStats.read(timestamp);
      if (frameTimeMs === 0) return;
      // A step up that has held for the full hold succeeded: the next wait is the plain one.
      if (lastStepUpAt !== null && timestamp - lastStepUpAt >= STEP_UP_AFTER_MS) {
        lastStepUpAt = null;
        stepUpWait = STEP_UP_AFTER_MS;
      }
      if (frameTimeMs > ABOVE_BUDGET * budget) {
        headroomSince = null;
        aboveSince ??= timestamp;
        if (timestamp - aboveSince >= STEP_DOWN_AFTER_MS && index < SCALES.length - 1) {
          step(index + 1, timestamp);
        }
      } else {
        aboveSince = null;
        headroomSince ??= timestamp;
        if (timestamp - headroomSince >= stepUpWait && index > capIndex) step(index - 1, timestamp);
      }
    },
    setCap(cap) {
      capIndex = SCALES.indexOf(cap);
      if (index < capIndex) index = capIndex;
      aboveSince = null;
      headroomSince = null;
    },
    scale() {
      return SCALES[index]!;
    },
    budgetMs() {
      return budget;
    },
  };
}
