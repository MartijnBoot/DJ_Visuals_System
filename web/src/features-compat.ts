// AC19 (spec SD11): `audio/` and `engine/` each declare `AudioFeatures` and never import each
// other; `web/` passes one to the other. These two assignments make `pnpm typecheck` fail the
// moment the shapes drift apart in either direction. `tests/meta/features-compat.test.ts`
// proves they do.
import type { AudioFeatures as FromAudio } from "@djv/audio";
import type { AudioFeatures as ForEngine } from "@djv/engine";

export const audioToEngine = (features: FromAudio): ForEngine => features;
export const engineToAudio = (features: ForEngine): FromAudio => features;
