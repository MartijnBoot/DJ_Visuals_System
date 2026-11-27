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

/** What `Engine.stats()` reports: the frame statistics and the render scale (B-01 SD8, SD18). */
export interface EngineStats extends FrameStats {
  /** The internal render resolution as a share of the canvas: 1, 0.75 or 0.5. */
  renderScale: number;
  /** B-07 PD11: the scale controller's own over-budget reading of the last frame. */
  overBudget: boolean;
  /** B-07 PD11: a transition draws two looks, or a Beat cut waits for its beat. */
  transitioning: boolean;
}

export interface FrameStatsRecorder {
  record(timestamp: number): void;
  read(now: number): FrameStats;
  /** Frames currently held; bounded to the window, so a hidden overlay cannot grow it. */
  size(): number;
}

export function createFrameStats(): FrameStatsRecorder {
  let frames: number[] = [];
  let lastFrameAt = 0;
  /** The interval that ended the last frame; 0 before the second frame (D-11). */
  let lastIntervalMs = 0;
  /** A frame has been recorded (a first frame at timestamp 0 counts). */
  let recorded = false;

  // Drops frames older than the window measured from `now`. Called on every record as well as
  // on every read, so the buffer never holds more than about one second of frames however long
  // the overlay stays hidden.
  const prune = (now: number) => {
    frames = frames.filter((t) => t > now - WINDOW_MS && t <= now);
  };

  return {
    record(timestamp) {
      if (recorded) lastIntervalMs = timestamp - lastFrameAt;
      recorded = true;
      frames.push(timestamp);
      lastFrameAt = timestamp;
      prune(timestamp);
    },
    read(now) {
      prune(now);
      const fps = frames.length;
      let frameTimeMs = 0;
      if (frames.length >= 2) {
        const first = frames[0]!;
        const last = frames[frames.length - 1]!;
        frameTimeMs = (last - first) / (frames.length - 1);
      } else if (frames.length === 1) {
        // Frames more than half a second apart (D-11): the one frame's own interval, so the
        // heaviest look never reads as free. No frame in the window still reads 0: stopped.
        frameTimeMs = lastIntervalMs;
      }
      return { fps, frameTimeMs, lastFrameAt };
    },
    size() {
      return frames.length;
    },
  };
}
