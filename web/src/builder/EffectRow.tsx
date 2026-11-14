// One effect in the stack (B-02 spec SD4, SD12, AC3; plan T11): move up and down, remove, the base
// strength, the effect's own parameter, and one audio binding. Native controls, each labelled.
// Test ids carry the effect type, which is unique in a profile.
import { EFFECTS } from "@djv/engine";
import { FEATURE_NAMES, LIMITS, type Effect, type FeatureName } from "@djv/shared";
import type { Dispatch } from "react";
import type { Action } from "./editor.ts";

export interface EffectRowProps {
  effect: Effect;
  index: number;
  count: number;
  paletteLength: number;
  disabled: boolean;
  dispatch: Dispatch<Action>;
}

export function EffectRow({
  effect,
  index,
  count,
  paletteLength,
  disabled,
  dispatch,
}: EffectRowProps) {
  const { type } = effect;
  const label = (what: string) => `${what} of ${type}`;
  return (
    <li
      data-testid={`effect-row-${type}`}
      style={{ display: "grid", gap: 4, padding: 6, border: "1px solid #444", marginBottom: 6 }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <strong style={{ flex: 1 }}>
          {index + 1}. {type}
          {EFFECTS[type].abstraction && (
            <span data-testid={`effect-abstraction-${type}`} title="scaled by recognisability">
              {" "}
              (abstraction)
            </span>
          )}
        </strong>
        <button
          type="button"
          data-testid={`effect-up-${type}`}
          aria-label={`Move ${type} up`}
          disabled={disabled || index === 0}
          onClick={() => dispatch({ type: "effectMove", index, direction: -1 })}
        >
          Up
        </button>
        <button
          type="button"
          data-testid={`effect-down-${type}`}
          aria-label={`Move ${type} down`}
          disabled={disabled || index === count - 1}
          onClick={() => dispatch({ type: "effectMove", index, direction: 1 })}
        >
          Down
        </button>
        <button
          type="button"
          data-testid={`effect-remove-${type}`}
          aria-label={`Remove ${type}`}
          disabled={disabled}
          onClick={() => dispatch({ type: "effectRemove", index })}
        >
          Remove
        </button>
      </div>
      <label style={{ display: "flex", gap: 6 }}>
        <span style={{ width: 120 }}>strength</span>
        <input
          type="range"
          data-testid={`effect-amount-${type}`}
          aria-label={label("Strength")}
          min={0}
          max={1}
          step={0.01}
          value={effect.amount}
          disabled={disabled}
          onChange={(e) => dispatch({ type: "amount", index, value: Number(e.target.value) })}
        />
        <span>{effect.amount.toFixed(2)}</span>
      </label>
      {"colourSlot" in effect && (
        <label style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 120 }}>colour slot</span>
          <select
            data-testid={`effect-slot-${type}`}
            aria-label={label("Colour slot")}
            value={effect.colourSlot}
            disabled={disabled}
            onChange={(e) => dispatch({ type: "parameter", index, value: Number(e.target.value) })}
          >
            {Array.from({ length: paletteLength }, (_, slot) => (
              <option key={slot} value={slot}>
                {slot + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      {effect.type === "mirror" && (
        <label style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 120 }}>segments</span>
          <input
            type="number"
            data-testid="effect-segments-mirror"
            aria-label="Segments of mirror"
            min={LIMITS.segmentsMin}
            max={LIMITS.segmentsMax}
            step={1}
            value={effect.segments}
            disabled={disabled}
            onChange={(e) => dispatch({ type: "parameter", index, value: Number(e.target.value) })}
          />
        </label>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 120 }}>follows audio</span>
          <select
            data-testid={`effect-feature-${type}`}
            aria-label={label("Audio feature")}
            value={effect.binding?.feature ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const feature = e.target.value;
              if (feature === "") dispatch({ type: "bindingClear", index });
              else {
                dispatch({
                  type: "bindingSet",
                  index,
                  feature: feature as FeatureName,
                  amount: effect.binding?.amount ?? 1,
                });
              }
            }}
          >
            <option value="">none</option>
            {FEATURE_NAMES.map((feature) => (
              <option key={feature} value={feature}>
                {feature}
              </option>
            ))}
          </select>
        </label>
        <input
          type="range"
          data-testid={`effect-binding-amount-${type}`}
          aria-label={label("Audio amount")}
          min={0}
          max={1}
          step={0.01}
          value={effect.binding?.amount ?? 0}
          disabled={disabled || !effect.binding}
          onChange={(e) =>
            effect.binding &&
            dispatch({
              type: "bindingSet",
              index,
              feature: effect.binding.feature,
              amount: Number(e.target.value),
            })
          }
        />
      </div>
    </li>
  );
}
