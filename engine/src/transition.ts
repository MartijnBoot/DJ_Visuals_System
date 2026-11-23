// A transition's maths (B-09 spec SD13, SD14; plan PD7 to PD10), pure and tested with injected
// timestamps like `scale.ts`. The mix program in `gl.ts` draws the same formulas per pixel.

/** B-09 SD1: how a pick switches. The names are `shared/`'s; web maps one onto the other. */
export type TransitionKind = "cut" | "crossfade" | "dissolve" | "wipe" | "beatCut" | "dip";

/**
 * SD13, PD7: progress by frame timestamps, so a transition takes its duration at any frame rate:
 * 0 on the first frame (`t0`), 1 from `t0 + durationMs` on.
 */
export function progress(t: number, t0: number, durationMs: number): number {
  if (!(durationMs > 0)) return 1;
  return Math.min(1, Math.max(0, (t - t0) / durationMs));
}

/** SD13: Crossfade mixes linearly in `p`; the incoming look's share. */
export const crossfadeWeight = (p: number): number => p;
