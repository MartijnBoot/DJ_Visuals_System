// One effect in the stack (B-02 spec SD4, SD12, AC3; plan T11): move up and down, remove, the base
// strength, the effect's own parameter, and one audio binding. Native controls, each labelled.
// B-18 (SD13, PD8): two fader ticks, addressed by the effect's place in the stack.
// Test ids carry `id`: the effect type, unique in a profile, or `custom-<n>` for the n-th custom
// effect (B-03 PD14), which shows its label and has no own parameter here.
import { EFFECTS } from "@djv/engine";
import { FEATURE_NAMES, LIMITS, type Effect, type FeatureName } from "@djv/shared";
import type { Dispatch, ReactNode } from "react";
import type { Action } from "./editor.ts";

export interface EffectRowProps {
  effect: Effect;
  /** The test-id suffix and React key (B-03 PD14). */
  id: string;
  index: number;
  count: number;
  paletteLength: number;
  disabled: boolean;
  /** Another effect of the draft has the DJ fader, so this one cannot (B-18 SD2). */
  djElsewhere: boolean;
  dispatch: Dispatch<Action>;
  /** Shown under the title line: a custom effect's label field (B-03 T10). */
  header?: ReactNode;
  /** Shown after the binding: a custom effect's own fields (B-03 T10). */
  children?: ReactNode;
}

export function EffectRow({
  effect,
  id,
  index,
  count,
  paletteLength,
  disabled,
  djElsewhere,
  dispatch,
  header,
  children,
}: EffectRowProps) {
  const name = effect.type === "custom" ? effect.label : effect.type;
  const abstraction = effect.type !== "custom" && EFFECTS[effect.type].abstraction;
  /** Scaled by recognisability, a built-in by its type or a custom effect by its flag (SD5). */
  const scaled = effect.type === "custom" ? effect.abstraction : abstraction;
  const label = (what: string) => `${what} of ${name}`;
  const djRefused = djElsewhere && effect.dj !== true;
  return (
    <li
      data-testid={`effect-row-${id}`}
      style={{ display: "grid", gap: 4, padding: 6, border: "1px solid #444", marginBottom: 6 }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <strong style={{ flex: 1 }}>
          {index + 1}. {name}
          {abstraction && (
            <span data-testid={`effect-abstraction-${id}`} title="scaled by recognisability">
              {" "}
              (abstraction)
            </span>
          )}
        </strong>
        <button
          type="button"
          data-testid={`effect-up-${id}`}
          aria-label={`Move ${name} up`}
          disabled={disabled || index === 0}
          onClick={() => dispatch({ type: "effectMove", index, direction: -1 })}
        >
          Up
        </button>
        <button
          type="button"
          data-testid={`effect-down-${id}`}
          aria-label={`Move ${name} down`}
          disabled={disabled || index === count - 1}
          onClick={() => dispatch({ type: "effectMove", index, direction: 1 })}
        >
          Down
        </button>
        <button
          type="button"
          data-testid={`effect-remove-${id}`}
          aria-label={`Remove ${name}`}
          disabled={disabled}
          onClick={() => dispatch({ type: "effectRemove", index })}
        >
          Remove
        </button>
      </div>
      {header}
      <label style={{ display: "flex", gap: 6 }}>
        <span style={{ width: 120 }}>strength</span>
        <input
          type="range"
          data-testid={`effect-amount-${id}`}
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
            data-testid={`effect-slot-${id}`}
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
            data-testid={`effect-feature-${id}`}
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
          data-testid={`effect-binding-amount-${id}`}
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
      {/* B-18 SD13: a strength fader for this effect on the controller; the preview ignores it. */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="checkbox"
            data-testid={`effect-dj-${index}`}
            aria-label={`Fader in DJ mode for ${name}`}
            aria-describedby={djRefused ? `effect-dj-reason-${index}` : undefined}
            checked={effect.dj === true}
            disabled={disabled || djRefused}
            onChange={(e) =>
              dispatch({ type: "effectFader", index, which: "dj", on: e.target.checked })
            }
          />
          Fader in DJ mode
        </label>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            type="checkbox"
            data-testid={`effect-vj-${index}`}
            aria-label={`Fader in VJ mode for ${name}`}
            checked={effect.vj === true}
            disabled={disabled}
            onChange={(e) =>
              dispatch({ type: "effectFader", index, which: "vj", on: e.target.checked })
            }
          />
          Fader in VJ mode
        </label>
      </div>
      {djRefused && (
        <div id={`effect-dj-reason-${index}`} data-testid={`effect-dj-reason-${index}`}>
          another effect already has the DJ fader
        </div>
      )}
      {scaled && (
        <div data-testid={`effect-fader-note-${index}`}>
          scaled by recognisability still applies
        </div>
      )}
      {children}
    </li>
  );
}
