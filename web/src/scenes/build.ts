// What Save stores (B-07 spec SD1, SD18; plan PD8, T7): built on the screen page, which holds the
// staged look, never on a controller. The base profile is copied whole with the staged palette and
// each effect's staged strength baked in; its name and starting dials stay the source profile's
// (Go applies the scene's own dials). An effect is copied by spread, so a custom effect's code is
// carried, never read (B-03 SD1).
import type { SceneDefinition } from "@djv/shared";
import type { StagedDefinition } from "./staged.ts";

export function buildScene(staged: StagedDefinition): SceneDefinition {
  const { stored, palette, amounts, dials, feed, transition } = staged;
  return {
    profile: {
      ...stored,
      palette: [...palette],
      effects: stored.effects.map((effect, i) => ({
        ...effect,
        amount: amounts[i] ?? effect.amount,
      })),
    },
    dials: { ...dials },
    ...(feed === null ? {} : { feed }),
    transition: { kind: transition.kind, duration: transition.duration },
  };
}
