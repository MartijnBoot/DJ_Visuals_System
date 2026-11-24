// One look (B-09 plan T2): a profile with its linked program, its own dials and its own pair of
// ping-pong targets, of which `current` is drawn into and the other read as the previous frame.
// The engine draws one look a frame, and during a transition two (B-09 SD11, SD15): each keeps
// its own history, so everything a look reads of the past is here and nothing is engine-wide.
import type { Dials } from "./features.ts";
import { createTarget, deleteTarget, type Target } from "./gl.ts";
import type { Profile } from "./profile.ts";

export interface Look<L extends { custom: unknown }> {
  profile: Profile;
  linked: L;
  dials: Dials;
  /** Null until the first frame sizes them, and after a context loss. */
  targets: [Target, Target] | null;
  /** The target drawn into next; the other holds the latest output. */
  current: number;
  /** The next frame mixes nothing of the previous target in (B-02 PD4): a swap or new targets. */
  fresh: boolean;
}

/**
 * The look's targets at this size: kept while the size holds, else made again. In a profile with
 * code the limiter needs the real previous frame (B-03 PD4): the last output, scaled into the new
 * previous target. Built-in profiles start from black, and the next frame mixes no smear.
 */
export function sizeTargets<L extends { custom: unknown }>(
  gl: WebGL2RenderingContext,
  look: Look<L>,
  width: number,
  height: number,
  copy: (from: Target, to: Target) => void,
): [Target, Target] {
  const old = look.targets;
  if (old && old[0].width === width && old[0].height === height) return old;
  const next: [Target, Target] = [createTarget(gl, width, height), createTarget(gl, width, height)];
  look.targets = next;
  if (old) {
    if (look.linked.custom) copy(old[1 - look.current]!, next[1 - look.current]!);
    for (const t of old) deleteTarget(gl, t);
    look.fresh = true;
  }
  return next;
}

/** Frees the look's targets: a transition's outgoing look when it ends (B-09 Non-functional). */
export function dropTargets<L extends { custom: unknown }>(
  gl: WebGL2RenderingContext,
  look: Look<L>,
): void {
  for (const t of look.targets ?? []) deleteTarget(gl, t);
  look.targets = null;
}
