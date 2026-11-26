// B-09 SD1, SD6, SD19: a transition's kind and duration, shared by the control messages
// (`control.ts`, which re-exports them) and the scenes (`scenes.ts`, B-07 SD1). Their own module,
// so neither of those imports the other in a cycle.
import { z } from "zod";

/** B-09 SD1, SD19: how a pick switches. */
export const TRANSITION_KINDS = ["cut", "crossfade", "dissolve", "wipe", "beatCut", "dip"] as const;
export const transitionKind = z.enum(TRANSITION_KINDS);
export type TransitionKind = z.infer<typeof transitionKind>;
/** B-09 SD6: the duration in seconds. */
export const transitionDuration = z.number().min(0.5).max(8);
