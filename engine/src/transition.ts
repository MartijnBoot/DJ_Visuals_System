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

/** SD12, SD13, PD10: Dip's shares of the old look, the colour and the new look; they sum to 1. */
export function dipShares(p: number): { outgoing: number; colour: number; incoming: number } {
  if (p < 0.5) return { outgoing: 1 - 2 * p, colour: 2 * p, incoming: 0 };
  return { outgoing: 0, colour: 2 - 2 * p, incoming: 2 * p - 1 };
}

/** SD14: Wipe's soft edge, a share of the width. */
export const WIPE_EDGE = 0.04;

/**
 * SD14, PD8: Wipe's share of the new look at `x`, a fraction of the width from the left. New left
 * of `p − 0.04`, old right of `p`; the edge narrows in the last 4% so the whole frame is new at 1.
 */
export function wipeWeight(x: number, p: number): number {
  const s = Math.min(WIPE_EDGE, 1 - p);
  if (s <= 0) return 1;
  return Math.min(1, Math.max(0, (p - x) / s));
}

/** The mix program's `uKind` for each kind it mixes (PD6); Beat cut and Cut never mix. */
export const MIX_KIND: Readonly<Record<TransitionKind, number>> = {
  cut: 0,
  crossfade: 0,
  beatCut: 0,
  dissolve: 1,
  wipe: 2,
  dip: 3,
};
