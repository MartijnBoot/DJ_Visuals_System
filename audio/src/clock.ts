// Two pure helpers for the main thread (spec SD15, AC12; plan PD2): mapping the audio context's
// clock to `performance.now()`, and fading features that have stopped arriving.
import type { AudioFeatures } from "./features.ts";

/** Stale features are held unchanged this long, so one late message does not dip the look. */
export const DECAY_HOLD_MS = 100;

/** ...and are zero from this long on: inside the second AC12 allows. */
export const DECAY_END_MS = 600;

export interface ClockMap {
  /** One simultaneous reading of both clocks (`AudioContext.getOutputTimestamp()`). */
  update(contextTime: number, performanceTime: number): void;
  /** A context time in seconds as a `performance.now()` time in milliseconds. */
  toPerformance(contextTime: number): number;
}

/** Both clocks run in real time, so the map is an offset, refreshed to absorb drift. */
export function createClockMap(): ClockMap {
  let offsetMs = 0;
  return {
    update(contextTime, performanceTime) {
      offsetMs = performanceTime - contextTime * 1000;
    },
    toPerformance(contextTime) {
      return contextTime * 1000 + offsetMs;
    },
  };
}

/** Features `msSinceLast` after the last window: held, then faded linearly to zero. */
export function decayFeatures(features: AudioFeatures, msSinceLast: number): AudioFeatures {
  if (msSinceLast <= DECAY_HOLD_MS) return features;
  const k = Math.max(0, 1 - (msSinceLast - DECAY_HOLD_MS) / (DECAY_END_MS - DECAY_HOLD_MS));
  return {
    level: features.level * k,
    low: features.low * k,
    mid: features.mid * k,
    high: features.high * k,
    beat: features.beat * k,
    capturedAt: features.capturedAt,
  };
}
