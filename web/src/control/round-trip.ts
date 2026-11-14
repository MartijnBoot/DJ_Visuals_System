// The round-trip readout (B-04 spec SD17, AC43): from sending a change to the screen page's
// acknowledgement of the frame that applied it, kept for 10 s as last and p95 in the engine's own
// latency window. Sends never acknowledged are forgotten after the same 10 s, so it stays bounded.
// The window is imported from its file: the engine's package does not export it, and B-04 leaves
// `engine/` unchanged but for `Profile` (spec, In scope).
import { createLatencyWindow, LATENCY_WINDOW_MS } from "../../../engine/src/latency.ts";

export interface RoundTripReading {
  last: number;
  p95: number;
  samples: number;
}

export interface RoundTrip {
  sent(seq: number, at: number): void;
  applied(seq: number, at: number): void;
  read(now: number): RoundTripReading;
  /** Sends still waiting for their acknowledgement. */
  outstanding(): number;
}

export function createRoundTrip(): RoundTrip {
  const window = createLatencyWindow();
  const sent = new Map<number, number>();

  const forget = (now: number) => {
    for (const [seq, at] of sent) {
      if (at > now - LATENCY_WINDOW_MS) break; // insertion order is send order
      sent.delete(seq);
    }
  };

  return {
    sent(seq, at) {
      forget(at);
      sent.set(seq, at);
    },
    applied(seq, at) {
      const from = sent.get(seq);
      if (from === undefined) return;
      sent.delete(seq);
      window.record(at - from, at);
    },
    read(now) {
      const { last, p95, samples } = window.read(now);
      return { last, p95, samples };
    },
    outstanding: () => sent.size,
  };
}
