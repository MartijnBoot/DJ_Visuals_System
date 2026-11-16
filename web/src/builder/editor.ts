// The editor's state (B-02 spec AC3, AC8, SD11, SD12; plan T11): a pure reducer over a draft
// `Profile`, so every rule is tested without a browser. No action can leave the draft in a state
// the shared schema rejects, except text as it is typed: a name outside 1 to 60 characters, and
// a custom effect's label, parameter names and code (B-03 T10), which `validate` reports (the
// schema is the only gate; the editor never lets the rest drift from it).
import {
  COLOUR_SLOT_TYPES,
  CUSTOM_LIMITS,
  derivePrimary,
  EFFECT_TYPES,
  FEATURE_NAMES,
  LIMITS,
  issuesFrom,
  profileSchema,
  type CustomEffect,
  type Effect,
  type EffectType,
  type FeatureName,
  type Issue,
  type Profile,
} from "@djv/shared";
import { CUSTOM_TEMPLATE } from "./custom-template.ts";

export type Action =
  /** "Revert to last saved": the draft becomes a copy of the saved profile (T12). */
  | { type: "reset"; profile: Profile }
  | { type: "name"; name: string }
  | { type: "dial"; dial: "recognisability" | "reactivity"; value: number }
  | { type: "paletteSet"; index: number; colour: string }
  | { type: "paletteAdd" }
  | { type: "paletteRemove"; index: number }
  | { type: "paletteReplace"; palette: readonly string[] }
  /** Marks one slot as the primary colour (B-04 SD10). */
  | { type: "primarySet"; index: number }
  | { type: "effectAdd"; effectType: EffectType }
  | { type: "effectRemove"; index: number }
  | { type: "effectMove"; index: number; direction: -1 | 1 }
  | { type: "amount"; index: number; value: number }
  | { type: "parameter"; index: number; value: number }
  | { type: "bindingSet"; index: number; feature: FeatureName; amount: number }
  | { type: "bindingClear"; index: number }
  /** B-03: a custom effect from the template (SD9, AC15), and its own fields (SD4, SD12). */
  | { type: "customAdd" }
  | { type: "customLabel"; index: number; label: string }
  | { type: "customAbstraction"; index: number; value: boolean }
  | { type: "customCode"; index: number; code: string }
  | { type: "customParamAdd"; index: number }
  | { type: "customParamRemove"; index: number; param: number }
  | { type: "customParamName"; index: number; param: number; name: string }
  | { type: "customParamValue"; index: number; param: number; value: number };

/** What a colour added to the palette starts as. */
export const NEW_COLOUR = "#808080";

const COLOUR = /^#[0-9a-fA-F]{6}$/;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const hasSlot = (type: string) => (COLOUR_SLOT_TYPES as readonly string[]).includes(type);

/** A colour slot now outside the palette is lowered to the last slot. */
function fit(effects: Effect[], paletteLength: number): Effect[] {
  return effects.map((effect) =>
    "colourSlot" in effect && effect.colourSlot >= paletteLength
      ? { ...effect, colourSlot: paletteLength - 1 }
      : effect,
  );
}

/**
 * The stored primary after slot `removed` goes (B-04 SD10, AC40): it stays on its colour, and on
 * slot 0 when its own slot goes. A draft without one stays without one.
 */
function primaryAfterRemove(draft: Profile, removed: number): { primary?: number } {
  const { primary } = draft;
  if (primary === undefined) return {};
  if (removed < primary) return { primary: primary - 1 };
  if (removed === primary) return { primary: 0 };
  return { primary };
}

/** A primary a shorter palette no longer holds goes to slot 0, so the draft stays valid. */
const primaryWithin = (draft: Profile, length: number): { primary?: number } =>
  draft.primary === undefined ? {} : { primary: draft.primary < length ? draft.primary : 0 };

/**
 * The builder's hint (B-04 SD10, AC41): the effective primary colour reaches the picture through
 * no effect's own slot, and no palette map uses the whole palette.
 */
export function primaryUnused(draft: Profile): boolean {
  const primary = derivePrimary(draft);
  return !draft.effects.some(
    (e) => e.type === "paletteMap" || ("colourSlot" in e && e.colourSlot === primary),
  );
}

/** The effect types that can still be added: none at twelve, never one already present. */
export function availableTypes(draft: Profile): EffectType[] {
  if (draft.effects.length >= LIMITS.effects) return [];
  const present = new Set<string>(draft.effects.map((e) => e.type));
  return EFFECT_TYPES.filter((t) => !present.has(t));
}

/** "Custom" is offered while the stack has room (B-03 SD4: custom effects count toward 12). */
export function canAddCustom(draft: Profile): boolean {
  return draft.effects.length < LIMITS.effects;
}

/** `base`, else `base 2`, `base 3`, … : the first not taken, trimmed (B-03 PD5). */
function freeName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.trim()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

const labels = (draft: Profile) =>
  draft.effects.flatMap((e) => (e.type === "custom" ? [e.label] : []));

/** Changes the custom effect at `index`; anything else, or no change, leaves the draft. */
function withCustom(
  draft: Profile,
  index: number,
  change: (e: CustomEffect) => CustomEffect,
): Profile {
  return withEffect(draft, index, (e) => (e.type === "custom" ? change(e) : e));
}

/** Changes parameter `param` of the custom effect at `index`, when it has one. */
function withParam(
  draft: Profile,
  index: number,
  param: number,
  change: (p: CustomEffect["params"][number]) => CustomEffect["params"][number],
): Profile {
  return withCustom(draft, index, (e) => {
    if (!Number.isInteger(param) || param < 0 || param >= e.params.length) return e;
    return { ...e, params: e.params.map((p, i) => (i === param ? change(p) : p)) };
  });
}

function newEffect(type: EffectType): Effect {
  if (hasSlot(type)) return { type, amount: 0.5, colourSlot: 0 } as Effect;
  if (type === "mirror") return { type, amount: 0.5, segments: 4 };
  return { type, amount: 0.5 } as Effect;
}

const inRange = (draft: Profile, index: number) =>
  Number.isInteger(index) && index >= 0 && index < draft.effects.length;

/** Replaces the effect at `index`; a result equal in identity means nothing changed. */
function withEffect(draft: Profile, index: number, change: (e: Effect) => Effect): Profile {
  if (!inRange(draft, index)) return draft;
  const before = draft.effects[index]!;
  const after = change(before);
  if (after === before) return draft;
  return { ...draft, effects: draft.effects.map((e, i) => (i === index ? after : e)) };
}

export function reduce(draft: Profile, action: Action): Profile {
  switch (action.type) {
    case "reset":
      return structuredClone(fieldsOf(action.profile));

    case "name":
      return { ...draft, name: action.name };

    case "dial":
      return { ...draft, dials: { ...draft.dials, [action.dial]: clamp01(action.value) } };

    case "paletteSet":
      if (!COLOUR.test(action.colour) || !Number.isInteger(action.index)) return draft;
      if (action.index < 0 || action.index >= draft.palette.length) return draft;
      return {
        ...draft,
        palette: draft.palette.map((c, i) => (i === action.index ? action.colour : c)),
      };

    case "paletteAdd":
      if (draft.palette.length >= LIMITS.paletteMax) return draft;
      return { ...draft, palette: [...draft.palette, NEW_COLOUR] };

    case "paletteRemove": {
      const { index } = action;
      if (draft.palette.length <= LIMITS.paletteMin) return draft;
      if (!Number.isInteger(index) || index < 0 || index >= draft.palette.length) return draft;
      const palette = draft.palette.filter((_, i) => i !== index);
      const { primary: _old, ...rest } = draft;
      return {
        ...rest,
        palette,
        effects: fit(draft.effects, palette.length),
        ...primaryAfterRemove(draft, index),
      };
    }

    case "paletteReplace": {
      const { palette } = action;
      const valid =
        palette.length >= LIMITS.paletteMin &&
        palette.length <= LIMITS.paletteMax &&
        palette.every((c) => COLOUR.test(c));
      if (!valid) return draft;
      return {
        ...draft,
        palette: [...palette],
        effects: fit(draft.effects, palette.length),
        ...primaryWithin(draft, palette.length),
      };
    }

    case "primarySet": {
      const { index } = action;
      if (!Number.isInteger(index) || index < 0 || index >= draft.palette.length) return draft;
      return { ...draft, primary: index };
    }

    case "effectAdd":
      if (!availableTypes(draft).includes(action.effectType)) return draft;
      return { ...draft, effects: [...draft.effects, newEffect(action.effectType)] };

    case "effectRemove":
      if (!inRange(draft, action.index)) return draft;
      return { ...draft, effects: draft.effects.filter((_, i) => i !== action.index) };

    case "effectMove": {
      const from = action.index;
      const to = from + action.direction;
      if (!inRange(draft, from) || to < 0 || to >= draft.effects.length) return draft;
      const effects = [...draft.effects];
      [effects[from], effects[to]] = [effects[to]!, effects[from]!];
      return { ...draft, effects };
    }

    case "amount":
      return withEffect(draft, action.index, (e) => ({ ...e, amount: clamp01(action.value) }));

    case "parameter": {
      if (!Number.isFinite(action.value)) return draft;
      return withEffect(draft, action.index, (e) => {
        if ("colourSlot" in e) {
          const slot = Math.round(action.value);
          return { ...e, colourSlot: Math.min(draft.palette.length - 1, Math.max(0, slot)) };
        }
        if (e.type === "mirror") {
          const segments = Math.round(action.value);
          return {
            ...e,
            segments: Math.min(LIMITS.segmentsMax, Math.max(LIMITS.segmentsMin, segments)),
          };
        }
        return e;
      });
    }

    case "bindingSet":
      if (!(FEATURE_NAMES as readonly string[]).includes(action.feature)) return draft;
      return withEffect(draft, action.index, (e) => ({
        ...e,
        binding: { feature: action.feature, amount: clamp01(action.amount) },
      }));

    case "bindingClear":
      return withEffect(draft, action.index, (e) => {
        const { binding: _binding, ...rest } = e;
        return rest as Effect;
      });

    case "customAdd": {
      if (!canAddCustom(draft)) return draft;
      const effect: CustomEffect = {
        type: "custom",
        label: freeName(CUSTOM_TEMPLATE.label, labels(draft)),
        amount: 0.5,
        abstraction: false,
        params: CUSTOM_TEMPLATE.params.map((p) => ({ ...p })),
        code: CUSTOM_TEMPLATE.code,
      };
      return { ...draft, effects: [...draft.effects, effect] };
    }

    // Text is kept as typed, valid or not: `validate` reports it (SD9).
    case "customLabel":
      return withCustom(draft, action.index, (e) => ({ ...e, label: action.label }));

    case "customCode":
      return withCustom(draft, action.index, (e) => ({ ...e, code: action.code }));

    case "customAbstraction":
      return withCustom(draft, action.index, (e) => ({ ...e, abstraction: action.value === true }));

    case "customParamAdd":
      return withCustom(draft, action.index, (e) => {
        if (e.params.length >= CUSTOM_LIMITS.params) return e;
        const names = e.params.map((p) => p.name);
        const name = freeName(`param ${e.params.length + 1}`, names);
        return { ...e, params: [...e.params, { name, value: 0 }] };
      });

    case "customParamRemove":
      return withCustom(draft, action.index, (e) => {
        const { param } = action;
        if (!Number.isInteger(param) || param < 0 || param >= e.params.length) return e;
        return { ...e, params: e.params.filter((_, i) => i !== param) };
      });

    case "customParamName":
      return withParam(draft, action.index, action.param, (p) => ({ ...p, name: action.name }));

    case "customParamValue":
      return withParam(draft, action.index, action.param, (p) => ({
        ...p,
        value: clamp01(action.value),
      }));
  }
}

/** The issues the shared schema finds in the draft, by dotted path; empty when it is valid. */
export function validate(draft: Profile): Issue[] {
  const result = profileSchema.safeParse(draft);
  return result.success ? [] : issuesFrom(result.error);
}

/** A stable text of a profile's own fields, whatever order their keys were written in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const fieldsOf = ({ name, palette, dials, effects, primary }: Profile) => ({
  name,
  palette,
  dials,
  effects,
  ...(primary === undefined ? {} : { primary }),
});

/** Whether the draft differs from the saved profile in any of its own fields. */
export function isDirty(draft: Profile, saved: Profile): boolean {
  return canonical(fieldsOf(draft)) !== canonical(fieldsOf(saved));
}
