// The profiles the builder can start from (B-02 spec SD11, SD13, AC2; plan PD2): a copy of the
// built-in, or the built-in's stack with a preset palette and a palette map on it so the colours
// show at once.
import { BUILT_IN_PROFILE } from "@djv/engine";
import type { Effect, Profile } from "@djv/shared";
import { engineToShared } from "../profile-compat.ts";

export interface Preset {
  name: string;
  palette: string[];
}

export const PRESETS: readonly Preset[] = [
  { name: "Basic", palette: ["#000000", "#ffffff"] },
  { name: "Warm", palette: ["#1a0500", "#c2410c", "#fbbf24", "#fff7ed"] },
  { name: "Cool", palette: ["#020617", "#1d4ed8", "#22d3ee", "#f0f9ff"] },
  { name: "Neon", palette: ["#0a0014", "#d946ef", "#22d3ee", "#a3e635"] },
];

/** An editable copy of the frozen built-in. */
const copyOfBuiltIn = (): Profile => engineToShared(structuredClone(BUILT_IN_PROFILE));

/** The built-in exactly, under `name`. */
export function fromBuiltin(name: string): Profile {
  return { ...copyOfBuiltIn(), name };
}

/**
 * The built-in's stack and dials with the preset's palette; a palette map (amount 1, no
 * binding) is added as the last effect before `pixelate`. Flash, grain and edges take the
 * lightest slot, the last.
 */
export function fromPreset(preset: Preset, name: string): Profile {
  const base = copyOfBuiltIn();
  const last = preset.palette.length - 1;
  const effects: Effect[] = base.effects.map((effect) =>
    "colourSlot" in effect ? { ...effect, colourSlot: last } : effect,
  );
  const at = effects.findIndex((e) => e.type === "pixelate");
  effects.splice(at === -1 ? effects.length : at, 0, { type: "paletteMap", amount: 1 });
  return { ...base, name, palette: [...preset.palette], effects };
}
