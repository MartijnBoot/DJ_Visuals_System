// The engine's own copy of the shapes it accepts (spec, API contract; SD11). `engine/` never
// imports `audio/`; `web/` checks at type level that this `AudioFeatures` and audio's stay
// compatible (AC19).

export interface AudioFeatures {
  /** Overall level, 0 to 1. */
  level: number;
  /** Low band energy, 0 to 1. */
  low: number;
  /** Mid band energy, 0 to 1. */
  mid: number;
  /** High band energy, 0 to 1. */
  high: number;
  /** Beat pulse, 0 to 1. */
  beat: number;
  /** Capture time of the newest sample, on the `performance.now()` clock, ms. */
  capturedAt: number;
}

/** The two dials (SD5), each 0 to 1. */
export interface Dials {
  /** 0: the camera clearly visible; 1: moving fields of colour, still camera-shaped. */
  recognisability: number;
  /** 0: the output ignores the audio; 1: the audio distorts it fully. */
  reactivity: number;
}

export const ZERO_FEATURES: AudioFeatures = Object.freeze({
  level: 0,
  low: 0,
  mid: 0,
  high: 0,
  beat: 0,
  capturedAt: 0,
});

/** SD16. */
export const DEFAULT_DIALS: Dials = Object.freeze({ recognisability: 0.3, reactivity: 0.7 });
