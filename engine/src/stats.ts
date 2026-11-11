// Per-frame statistics as a rolling average over the last second (spec SD8, AC11). Pure
// functions of timestamps so the maths is tested without a GPU.

/** The rolling window. */
export const WINDOW_MS = 1000;

export interface FrameStats {
  /** Frames recorded in the last second. */
  fps: number;
  /** Mean time between consecutive frames in the last second, in milliseconds. */
  frameTimeMs: number;
  /** Timestamp of the last recorded frame; 0 when none. */
  lastFrameAt: number;
}

export interface FrameStatsRecorder {
  record(timestamp: number): void;
  read(now: number): FrameStats;
}

export function createFrameStats(): FrameStatsRecorder {
  let frames: number[] = [];
  let lastFrameAt = 0;

  return {
    record(timestamp) {
      frames.push(timestamp);
      lastFrameAt = timestamp;
    },
    read(now) {
      frames = frames.filter((t) => t > now - WINDOW_MS && t <= now);
      const fps = frames.length;
      let frameTimeMs = 0;
      if (frames.length >= 2) {
        const first = frames[0]!;
        const last = frames[frames.length - 1]!;
        frameTimeMs = (last - first) / (frames.length - 1);
      }
      return { fps, frameTimeMs, lastFrameAt };
    },
  };
}
