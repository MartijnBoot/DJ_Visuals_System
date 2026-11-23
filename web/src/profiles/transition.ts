// The current transition (B-09 spec SD5, SD6, SD9; plan PD14): a type, a duration and Keep
// colour, remembered on the screen machine under `djv.transition` beside `djv.profile`, never in a
// profile. Read back through the same schema the screen state uses; anything missing or invalid
// reads as Cut, 2.0 s, off, and neither function ever throws: storage may be full or disabled.
import { transitionChoiceSchema, type TransitionChoice } from "@djv/shared";

export const TRANSITION_KEY = "djv.transition";

export const DEFAULT_TRANSITION: Readonly<TransitionChoice> = Object.freeze({
  kind: "cut",
  duration: 2,
  keepColour: false,
});

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** `localStorage` is read inside the `try`: merely reading it throws when site data is blocked. */
export function loadTransition(storage?: StorageLike): TransitionChoice {
  try {
    const raw = (storage ?? localStorage).getItem(TRANSITION_KEY);
    if (typeof raw === "string") {
      const parsed = transitionChoiceSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Unreadable storage or broken JSON: the default.
  }
  return { ...DEFAULT_TRANSITION };
}

export function saveTransition(choice: TransitionChoice, storage?: StorageLike): void {
  try {
    (storage ?? localStorage).setItem(TRANSITION_KEY, JSON.stringify(choice));
  } catch {
    // Remembering is a convenience; the set goes on without it.
  }
}

/** SD6: the fader's position `x` in [0, 1] as seconds, `0.5 × 16^x`: 0.5 s, 2 s, 8 s. */
export const durationAt = (x: number): number => 0.5 * 16 ** x;

/** The inverse of `durationAt`, kept inside [0, 1]. */
export const positionOf = (seconds: number): number =>
  Math.min(1, Math.max(0, Math.log(seconds / 0.5) / Math.log(16)));

/** "2.0 s" (SD6). */
export const formatDuration = (seconds: number): string => `${seconds.toFixed(1)} s`;
