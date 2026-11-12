// The synthetic loop (B-02 spec SD5, SD19; plan PD15): a steady 120 BPM kick, off-beat hats and
// a slow bass swell, produced as `AudioFeatures` directly, so every audio binding visibly does
// something in the builder's preview with no music. A pure function of time: no state, no
// randomness, no Web Audio.
import { BEAT_DECAY_MS } from "./constants.ts";
import type { AudioFeatures } from "./features.ts";

/** 120 BPM: a kick every half second. */
export const BEAT_PERIOD_MS = 500;

/** The kick on the low band: a little below full, decaying slower than the beat pulse. */
export const KICK_LOW_PEAK = 0.9;
export const KICK_LOW_DECAY_MS = 180;

/** The hats on the high band, half a beat after each kick, short. */
export const HAT_PEAK = 0.8;
export const HAT_DECAY_MS = 40;

/** The swell on mid and level: one rise and fall every four bars. */
export const SWELL_PERIOD_MS = 8000;
export const MID_FLOOR = 0.15;
export const MID_RANGE = 0.6;
export const LEVEL_FLOOR = 0.3;
export const LEVEL_RANGE = 0.5;

/** Time since the last grid instant at `offsetMs` into the beat, in [0, period). */
function sinceLast(nowMs: number, offsetMs: number): number {
  return (((nowMs - offsetMs) % BEAT_PERIOD_MS) + BEAT_PERIOD_MS) % BEAT_PERIOD_MS;
}

export function syntheticFeatures(nowMs: number): AudioFeatures {
  const t = Number.isFinite(nowMs) ? nowMs : 0;
  const kick = sinceLast(t, 0);
  const hat = sinceLast(t, BEAT_PERIOD_MS / 2);
  const cycle = (((t % SWELL_PERIOD_MS) + SWELL_PERIOD_MS) % SWELL_PERIOD_MS) / SWELL_PERIOD_MS;
  const swell = 0.5 - 0.5 * Math.cos(2 * Math.PI * cycle);
  return {
    level: LEVEL_FLOOR + LEVEL_RANGE * swell,
    low: KICK_LOW_PEAK * Math.exp(-kick / KICK_LOW_DECAY_MS),
    mid: MID_FLOOR + MID_RANGE * swell,
    high: HAT_PEAK * Math.exp(-hat / HAT_DECAY_MS),
    beat: Math.exp(-kick / BEAT_DECAY_MS),
    // Not captured audio: no latency sample is recorded for it (B-01 PD21).
    capturedAt: 0,
  };
}
