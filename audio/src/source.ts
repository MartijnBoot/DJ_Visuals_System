// The main-thread side of the analysis (spec AC2, AC6, AC12; plan PD2, PD3): turns a
// MediaStream into features the screen page reads once per frame. The stream's tracks belong
// to the caller (the capture session) and are never stopped here.
import { createClockMap, decayFeatures } from "./clock.ts";
import { ZERO_FEATURES, type AudioFeatures } from "./features.ts";

/** Must match `PROCESSOR_NAME` in `processor.ts`, which cannot be imported on this thread. */
const PROCESSOR_NAME = "djv-features";

/** How often the clock map is refreshed from `getOutputTimestamp()` (PD2). */
export const CLOCK_REFRESH_MS = 1000;

export interface FeatureSource {
  /** The newest features at `now` (`performance.now()` clock), decayed when blocks stopped. */
  read(now: number): AudioFeatures;
  /** Disconnects the graph and closes the port. */
  stop(): void;
  /** When the last window arrived, on the `performance.now()` clock; 0 before the first. */
  lastBlockAt(): number;
}

interface Window {
  frame: Omit<AudioFeatures, "capturedAt">;
  contextTime: number;
}

const FEATURE_KEYS = ["level", "low", "mid", "high", "beat"] as const;

/** A message from the worklet is checked before use (types at the boundary). */
function isWindow(data: unknown): data is Window {
  if (typeof data !== "object" || data === null) return false;
  const { frame, contextTime } = data as Record<string, unknown>;
  if (typeof contextTime !== "number" || !Number.isFinite(contextTime)) return false;
  if (typeof frame !== "object" || frame === null) return false;
  return FEATURE_KEYS.every((k) => Number.isFinite((frame as Record<string, unknown>)[k]));
}

const modules = new WeakMap<BaseAudioContext, Promise<void>>();

export async function createFeatureSource(
  context: AudioContext,
  stream: MediaStream,
  moduleUrl: string,
): Promise<FeatureSource> {
  let loading = modules.get(context);
  if (!loading) {
    loading = context.audioWorklet.addModule(moduleUrl);
    modules.set(context, loading);
  }
  await loading;

  const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
  });
  const input = context.createMediaStreamSource(stream);
  input.connect(node);

  const clock = createClockMap();
  let refreshedAt = -Infinity;
  const refresh = (now: number) => {
    const { contextTime, performanceTime } = context.getOutputTimestamp();
    // Both are 0 or missing until the context renders; keep the old pair until then.
    if (contextTime === undefined || !performanceTime) return;
    clock.update(contextTime, performanceTime);
    refreshedAt = now;
  };
  refresh(performance.now());

  let latest: Window | null = null;
  let lastBlockAt = 0;
  node.port.onmessage = (event: MessageEvent<unknown>) => {
    if (!isWindow(event.data)) return;
    latest = event.data;
    lastBlockAt = performance.now();
  };

  return {
    read(now) {
      if (now - refreshedAt >= CLOCK_REFRESH_MS) refresh(now);
      if (!latest) return ZERO_FEATURES;
      const { frame, contextTime } = latest;
      const features: AudioFeatures = {
        level: frame.level,
        low: frame.low,
        mid: frame.mid,
        high: frame.high,
        beat: frame.beat,
        capturedAt: clock.toPerformance(contextTime) - context.baseLatency * 1000,
      };
      return decayFeatures(features, now - lastBlockAt);
    },
    stop() {
      input.disconnect();
      node.disconnect();
      node.port.onmessage = null;
      node.port.close();
    },
    lastBlockAt() {
      return lastBlockAt;
    },
  };
}
