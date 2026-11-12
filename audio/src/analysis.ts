// The analysis maths (spec SD4, AC6; plan PD1, PD7): pure functions of the samples, so they are
// tested on synthetic signals without a browser. The worklet (`processor.ts`) feeds it one
// render quantum at a time.
import {
  BEAT_DECAY_MS,
  FILTER_Q,
  FLUX_FLOOR,
  FLUX_HISTORY_MS,
  FLUX_THRESHOLD_SD,
  GAIN,
  LOW_MID_SPLIT_HZ,
  MAX_WINDOW_MS,
  MID_HIGH_SPLIT_HZ,
  REFRACTORY_MS,
  RENDER_QUANTUM_FRAMES,
  SMOOTHING,
  WINDOW_QUANTA,
} from "./constants.ts";

/** One window's result: the four smoothed features, the beat pulse, and what made the beat. */
export interface FeatureFrame {
  level: number;
  low: number;
  mid: number;
  high: number;
  beat: number;
  /** Half-wave rectified rise of the raw low band since the previous window. */
  flux: number;
  /** True in the window where an onset fired (`beat` is then 1). */
  onset: boolean;
}

export interface Analyser {
  /** Feeds samples; returns a frame when a window completes (the last one, if several do). */
  push(block: Float32Array): FeatureFrame | null;
}

/** Frames per window: `WINDOW_QUANTA` render quanta, fewer if that would exceed 10 ms. */
export function windowFrames(sampleRate: number): number {
  const fit = Math.floor(((MAX_WINDOW_MS / 1000) * sampleRate) / RENDER_QUANTUM_FRAMES);
  return Math.max(1, Math.min(WINDOW_QUANTA, fit)) * RENDER_QUANTUM_FRAMES;
}

type Kind = "lowpass" | "highpass";

/** One biquad section (RBJ cookbook), transposed direct form II. */
function biquad(kind: Kind, hz: number, sampleRate: number): (x: number) => number {
  const w0 = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * FILTER_Q);
  const a0 = 1 + alpha;
  const edge = kind === "lowpass" ? (1 - cos) / 2 : (1 + cos) / 2;
  const b0 = edge / a0;
  const b1 = (kind === "lowpass" ? 1 - cos : -(1 + cos)) / a0;
  const b2 = b0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  let z1 = 0;
  let z2 = 0;
  return (x) => {
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

/** Sections in series; each edge is two sections (Linkwitz-Riley, see `FILTER_Q`). */
function chain(sections: ((x: number) => number)[]): (x: number) => number {
  return (x) => sections.reduce((v, section) => section(v), x);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createAnalyser(sampleRate: number): Analyser {
  const frames = windowFrames(sampleRate);
  const windowMs = (frames / sampleRate) * 1000;
  const edge = (kind: Kind, hz: number) => [
    biquad(kind, hz, sampleRate),
    biquad(kind, hz, sampleRate),
  ];
  const lowFilter = chain(edge("lowpass", LOW_MID_SPLIT_HZ));
  const midFilter = chain([
    ...edge("highpass", LOW_MID_SPLIT_HZ),
    ...edge("lowpass", MID_HIGH_SPLIT_HZ),
  ]);
  const highFilter = chain(edge("highpass", MID_HIGH_SPLIT_HZ));

  // One-pole coefficients per window: the share of the gap closed in one window.
  const step = (ms: number) => 1 - Math.exp(-windowMs / ms);
  const rate = {
    level: { up: step(SMOOTHING.level.attackMs), down: step(SMOOTHING.level.releaseMs) },
    low: { up: step(SMOOTHING.low.attackMs), down: step(SMOOTHING.low.releaseMs) },
    mid: { up: step(SMOOTHING.mid.attackMs), down: step(SMOOTHING.mid.releaseMs) },
    high: { up: step(SMOOTHING.high.attackMs), down: step(SMOOTHING.high.releaseMs) },
  };
  const beatKeep = Math.exp(-windowMs / BEAT_DECAY_MS);
  const historyLength = Math.max(1, Math.round(FLUX_HISTORY_MS / windowMs));
  const refractoryWindows = Math.ceil(REFRACTORY_MS / windowMs);

  // Per-window sums of squares.
  let count = 0;
  let sumAll = 0;
  let sumLow = 0;
  let sumMid = 0;
  let sumHigh = 0;

  const smoothed = { level: 0, low: 0, mid: 0, high: 0 };
  let beat = 0;
  let previousLow = 0;
  const history: number[] = [];
  let windowsSinceOnset = Infinity;

  const smooth = (key: keyof typeof smoothed, raw: number) => {
    const current = smoothed[key];
    const k = raw > current ? rate[key].up : rate[key].down;
    const next = current + (raw - current) * k;
    // Below anything a meter or a shader can show: settle to exact zero, so silence reads 0.
    smoothed[key] = next < 1e-6 ? 0 : next;
  };

  const completeWindow = (): FeatureFrame => {
    const rms = (sum: number) => Math.sqrt(sum / count);
    const rawLow = clamp01(rms(sumLow) * GAIN.low);
    smooth("level", clamp01(rms(sumAll) * GAIN.level));
    smooth("low", rawLow);
    smooth("mid", clamp01(rms(sumMid) * GAIN.mid));
    smooth("high", clamp01(rms(sumHigh) * GAIN.high));
    count = sumAll = sumLow = sumMid = sumHigh = 0;

    // Spectral flux on the low band against an adaptive threshold (PD7).
    const flux = Math.max(0, rawLow - previousLow);
    previousLow = rawLow;
    let mean = 0;
    for (const f of history) mean += f;
    mean = history.length ? mean / history.length : 0;
    let variance = 0;
    for (const f of history) variance += (f - mean) ** 2;
    const sd = history.length ? Math.sqrt(variance / history.length) : 0;
    history.push(flux);
    if (history.length > historyLength) history.shift();

    windowsSinceOnset += 1;
    const onset =
      flux > FLUX_FLOOR &&
      flux > mean + FLUX_THRESHOLD_SD * sd &&
      windowsSinceOnset >= refractoryWindows;
    if (onset) windowsSinceOnset = 0;
    beat = onset ? 1 : beat * beatKeep;
    if (beat < 1e-6) beat = 0;

    return { ...smoothed, beat, flux, onset };
  };

  return {
    push(block) {
      let frame: FeatureFrame | null = null;
      for (let i = 0; i < block.length; i++) {
        const x = block[i]!;
        const low = lowFilter(x);
        const mid = midFilter(x);
        const high = highFilter(x);
        sumAll += x * x;
        sumLow += low * low;
        sumMid += mid * mid;
        sumHigh += high * high;
        count += 1;
        if (count === frames) frame = completeWindow();
      }
      return frame;
    },
  };
}
