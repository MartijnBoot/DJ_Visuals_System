// The audio package's public surface (spec In scope: audio/; SD11). Framework-free: Web Audio
// only, no dependency of any kind (AC18).
export { ZERO_FEATURES, type AudioFeatures } from "./features.ts";
export { createAnalyser, windowFrames, type Analyser, type FeatureFrame } from "./analysis.ts";
