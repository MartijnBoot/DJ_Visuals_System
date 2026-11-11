// The AudioWorkletGlobalScope names `processor.ts` uses (plan PD18). `lib.dom.d.ts` in
// TypeScript 6.0.3 has none of them and `@types/audioworklet` would be a dependency, which
// `audio/` may not have (SD11). Only `processor.ts` runs in that scope: the rest of the
// package must not use these names, even though the compiler would let it.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** Context time, in seconds, of the first frame of the quantum being processed. */
declare const currentTime: number;
/** Frame index of the first frame of the quantum being processed. */
declare const currentFrame: number;
/** The context's sample rate, in Hz. */
declare const sampleRate: number;
