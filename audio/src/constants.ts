// Every number the analysis uses, named in one place (spec SD4; plan PD1, PD7). B-02 lifts
// these as the starting values of a configurable look.

/** Frames in one Web Audio render quantum. */
export const RENDER_QUANTUM_FRAMES = 128;

/** Render quanta per analysis window: 384 frames, 8.0 ms at 48 kHz, 8.7 ms at 44.1 kHz (PD1). */
export const WINDOW_QUANTA = 3;

/** The longest window the spec allows (AC6); lower sample rates get fewer quanta. */
export const MAX_WINDOW_MS = 10;

/** Low band: below this frequency (SD4, "below about 150 Hz"). */
export const LOW_MID_SPLIT_HZ = 150;

/** High band: above this frequency; mid is between the two splits. */
export const MID_HIGH_SPLIT_HZ = 2000;

/**
 * Q of every biquad section. Two Butterworth sections in cascade per edge give a
 * Linkwitz-Riley 4th-order slope (24 dB per octave), so a band's neighbours stay out of it.
 */
export const FILTER_Q = Math.SQRT1_2;

/**
 * RMS to feature value. A −6 dBFS sine reads about 0.7; anything louder clamps at 1 (the spec's
 * "loud, clipped input" edge case).
 */
export const GAIN = { level: 2, low: 2, mid: 2, high: 2 } as const;

/**
 * Per-feature smoothing as one-pole time constants in ms: rising values follow the attack,
 * falling ones the release. Every release is well under 300 ms, so 1 s of silence empties the
 * features (AC12).
 */
export const SMOOTHING = {
  level: { attackMs: 10, releaseMs: 150 },
  low: { attackMs: 10, releaseMs: 150 },
  mid: { attackMs: 10, releaseMs: 120 },
  high: { attackMs: 5, releaseMs: 100 },
} as const;

/** How much low-band flux history the adaptive beat threshold looks at (PD7, "~1 s"). */
export const FLUX_HISTORY_MS = 1000;

/** An onset is flux above mean + this many standard deviations of the history (PD7). */
export const FLUX_THRESHOLD_SD = 2.5;

/**
 * And above this absolute rise of the low band (feature units), so that noise and quiet hiss,
 * whose flux has a small mean and deviation, never fire a beat (spec edge case "quiet input").
 */
export const FLUX_FLOOR = 0.1;

/** No second onset within this long of the last one (PD7). */
export const REFRACTORY_MS = 120;

/** The beat pulse jumps to 1 at an onset and decays with this time constant (PD7). */
export const BEAT_DECAY_MS = 120;
