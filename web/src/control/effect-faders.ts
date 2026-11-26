// The effect strength faders on `/control` (B-18 spec SD1, SD8, SD10, SD11, SD12): where each
// effect the screen lists gets its fader, and the fader itself. The DJ-ticked effect sits in the
// bank in both modes; the VJ-ticked others in the Effects section, in VJ mode only, in stack
// order; an effect ticked both shows once, in the bank. Every move goes through the page's one
// send budget under `effect:<index>`, so it keeps only its newest waiting value (B-16 SD4).
import type { EffectEntry } from "@djv/shared";
import type { FaderDefinition } from "./FaderBank.tsx";
import type { Mode } from "./remembered.ts";

export interface PlacedEffects {
  /** The third fader of the bank, after the two dials. */
  bank: EffectEntry | null;
  /** The Effects section's faders; always empty in DJ mode. */
  section: EffectEntry[];
}

export function placeEffects(effects: readonly EffectEntry[], mode: Mode): PlacedEffects {
  const bank = effects.find((e) => e.dj) ?? null;
  const section = mode === "vj" ? effects.filter((e) => e.vj && !e.dj) : [];
  return { bank, section };
}

export interface EffectControl {
  type: "effect";
  profile: string;
  index: number;
  value: number;
}

/**
 * One effect's fader: its name, the screen's value, the stored value as the tick, and a send
 * naming the profile it was shown for. `layout` is that profile, so a pick lets go of a drag.
 */
export function effectFader(
  effect: EffectEntry,
  profile: string,
  value: (key: string, send: () => unknown) => void,
  send: (control: EffectControl) => unknown,
): FaderDefinition & { mark: number; layout: string } {
  const { index } = effect;
  return {
    testId: `effect-${index}`,
    label: effect.name,
    value: effect.value,
    mark: effect.stored,
    layout: profile,
    onSend: (x) =>
      value(`effect:${index}`, () => send({ type: "effect", profile, index, value: x })),
  };
}
