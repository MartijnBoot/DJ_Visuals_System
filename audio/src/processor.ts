// The AudioWorklet processor (spec SD4, AC6; plan PD1, PD3). It runs on the audio rendering
// thread, feeds every render quantum of the input to the analysis, and posts one message per
// window: `{ frame, contextTime }`, `contextTime` the window's end in context seconds. It has
// no outputs and never plays sound. Only the names in `worklet-globals.d.ts` exist here.
import { createAnalyser } from "./analysis.ts";

/** The name `source.ts` creates the node with. */
export const PROCESSOR_NAME = "djv-features";

class FeatureProcessor extends AudioWorkletProcessor {
  private readonly analyser = createAnalyser(sampleRate);
  private mono = new Float32Array(0);

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const first = channels?.[0];
    // No input connected yet, or a track that is gone: nothing to analyse, keep the node alive.
    if (!channels || !first || first.length === 0) return true;

    let block = first;
    if (channels.length > 1) {
      if (this.mono.length !== first.length) this.mono = new Float32Array(first.length);
      for (let i = 0; i < first.length; i++) {
        let sum = 0;
        for (const channel of channels) sum += channel[i] ?? 0;
        this.mono[i] = sum / channels.length;
      }
      block = this.mono;
    }

    const frame = this.analyser.push(block);
    if (frame) {
      this.port.postMessage({ frame, contextTime: currentTime + block.length / sampleRate });
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, FeatureProcessor);
