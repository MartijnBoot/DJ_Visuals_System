// The in-app latency record (spec SD15, AC10; plan PD2, PD21): per presented frame, frame
// submit time minus the capture time of the newest audio the frame used, kept for 10 s and read
// as last, p95 and worst. Pure functions of timestamps, bounded like `stats.ts`.

export const LATENCY_WINDOW_MS = 10_000;

export interface LatencyReading {
  /** The newest sample in the window, ms; 0 when none. */
  last: number;
  /** Nearest-rank 95th percentile over the window, ms; 0 when none. */
  p95: number;
  /** The largest sample in the window, ms; 0 when none. */
  worst: number;
  /** Samples in the window: 0 means the overlay shows "–". */
  samples: number;
}

export interface LatencyWindow {
  record(sampleMs: number, at: number): void;
  /**
   * One frame submitted at `submitAt` with features captured at `capturedAt`. Records a sample
   * only for a new window of audio: stale features (lost, decayed, before Start) record nothing,
   * so the window empties instead of growing ever older (PD21).
   */
  recordFrame(capturedAt: number, submitAt: number): void;
  read(now: number): LatencyReading;
  /** Samples currently held; bounded to the window. */
  size(): number;
}

export function createLatencyWindow(windowMs = LATENCY_WINDOW_MS): LatencyWindow {
  let samples: { value: number; at: number }[] = [];
  let lastCapturedAt = 0;

  const prune = (now: number) => {
    if (samples.length && samples[0]!.at <= now - windowMs) {
      samples = samples.filter((s) => s.at > now - windowMs);
    }
  };

  const window: LatencyWindow = {
    record(sampleMs, at) {
      samples.push({ value: sampleMs, at });
      prune(at);
    },
    recordFrame(capturedAt, submitAt) {
      if (capturedAt <= 0 || capturedAt === lastCapturedAt) return;
      lastCapturedAt = capturedAt;
      window.record(submitAt - capturedAt, submitAt);
    },
    read(now) {
      prune(now);
      if (samples.length === 0) return { last: 0, p95: 0, worst: 0, samples: 0 };
      const sorted = samples.map((s) => s.value).sort((a, b) => a - b);
      return {
        last: samples[samples.length - 1]!.value,
        p95: sorted[Math.ceil(0.95 * sorted.length) - 1]!,
        worst: sorted[sorted.length - 1]!,
        samples: sorted.length,
      };
    },
    size() {
      return samples.length;
    },
  };
  return window;
}
