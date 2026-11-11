// The contract `audio/` emits (spec, API contract; SD11). `engine/` declares the same shape on
// its own side and `web/` checks at type level that the two stay compatible (AC19).

export interface AudioFeatures {
  /** Overall level (RMS), 0 to 1. */
  level: number;
  /** Band energy below about 150 Hz, 0 to 1. */
  low: number;
  /** Band energy between the low and high bands, 0 to 1. */
  mid: number;
  /** Band energy above about 2 kHz, 0 to 1. */
  high: number;
  /** The beat pulse: 1 at a low-band onset, decaying to 0, 0 to 1. */
  beat: number;
  /** Estimated capture time of the newest sample these features include, on the `performance.now()` clock, ms. */
  capturedAt: number;
}

export const ZERO_FEATURES: AudioFeatures = Object.freeze({
  level: 0,
  low: 0,
  mid: 0,
  high: 0,
  beat: 0,
  capturedAt: 0,
});
