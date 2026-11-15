// A custom effect in the stack (B-03 spec SD4, SD9, SD12, AC13; plan PD14): the row every effect
// has (move, remove, strength, binding) with the label, the abstraction flag, up to four named
// parameter sliders and the code in a plain monospace text box: no editor library. Test ids end
// in `custom-<n>`, the effect's place among the custom ones; the label is edited here, so it
// cannot be the key.
import { CUSTOM_LIMITS, type CustomEffect } from "@djv/shared";
import { EffectRow, type EffectRowProps } from "./EffectRow.tsx";

export interface CustomRowProps extends EffectRowProps {
  effect: CustomEffect;
}

const LINE = { display: "flex", gap: 6, alignItems: "center" } as const;

export function CustomRow(props: CustomRowProps) {
  const { effect, id, index, disabled, dispatch } = props;
  const of = (what: string) => `${what} of ${effect.label || "custom effect"}`;
  return (
    <EffectRow
      {...props}
      header={
        <label style={LINE}>
          <span style={{ width: 120 }}>label</span>
          <input
            data-testid={`custom-label-${id}`}
            aria-label={`Label of custom effect ${index + 1}`}
            value={effect.label}
            disabled={disabled}
            onChange={(e) => dispatch({ type: "customLabel", index, label: e.target.value })}
          />
        </label>
      }
    >
      <label style={LINE}>
        <input
          type="checkbox"
          data-testid={`custom-abstraction-${id}`}
          checked={effect.abstraction}
          disabled={disabled}
          onChange={(e) => dispatch({ type: "customAbstraction", index, value: e.target.checked })}
        />
        Abstraction <small>(scaled by recognisability)</small>
      </label>
      {effect.params.map((param, j) => (
        <div key={j} style={LINE}>
          <input
            data-testid={`custom-param-name-${id}-${j}`}
            aria-label={of(`Name of parameter ${j + 1}`)}
            value={param.name}
            disabled={disabled}
            style={{ width: 112 }}
            onChange={(e) =>
              dispatch({ type: "customParamName", index, param: j, name: e.target.value })
            }
          />
          <input
            type="range"
            data-testid={`custom-param-value-${id}-${j}`}
            aria-label={of(`Parameter ${param.name || j + 1}`)}
            min={0}
            max={1}
            step={0.01}
            value={param.value}
            disabled={disabled}
            onChange={(e) =>
              dispatch({ type: "customParamValue", index, param: j, value: Number(e.target.value) })
            }
          />
          <span>{param.value.toFixed(2)}</span>
          <button
            type="button"
            data-testid={`custom-param-remove-${id}-${j}`}
            aria-label={of(`Remove parameter ${param.name || j + 1}`)}
            disabled={disabled}
            onClick={() => dispatch({ type: "customParamRemove", index, param: j })}
          >
            ×
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          data-testid={`custom-param-add-${id}`}
          disabled={disabled || effect.params.length >= CUSTOM_LIMITS.params}
          onClick={() => dispatch({ type: "customParamAdd", index })}
        >
          Add parameter
        </button>
      </div>
      <label style={{ display: "grid", gap: 2 }}>
        code (GLSL, see docs/custom-effects.md)
        <textarea
          data-testid={`custom-code-${id}`}
          aria-label={of("Code")}
          value={effect.code}
          disabled={disabled}
          spellCheck={false}
          rows={8}
          style={{ fontFamily: "monospace", resize: "vertical", width: "100%" }}
          onChange={(e) => dispatch({ type: "customCode", index, code: e.target.value })}
        />
      </label>
    </EffectRow>
  );
}
