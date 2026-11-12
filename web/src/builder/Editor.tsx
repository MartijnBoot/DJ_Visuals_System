// The profile editor (B-02 spec SD2, SD4, SD11, SD12, AC3, AC5, AC8; plan T11): name, the two
// starting dials, the palette, the effect stack, and Save. The draft lives here in a reducer
// (`editor.ts`); Save sends it with the revision it started from and adopts the answer. A save
// that fails keeps the draft. The built-in is shown read-only.
import { LIMITS, type Profile, type StoredProfile } from "@djv/shared";
import { useEffect, useReducer, useState } from "react";
import { updateProfile } from "../profiles/api.ts";
import { Conflict } from "./Conflict.tsx";
import { EffectRow } from "./EffectRow.tsx";
import { availableTypes, isDirty, reduce, validate } from "./editor.ts";
import { describeFailure } from "./failure.ts";
import { PRESETS } from "./presets.ts";

export interface EditorProps {
  saved: StoredProfile;
  /** The built-in: shown, never edited. */
  readOnly: boolean;
  /** The API is unreachable: Save is disabled. */
  offline: boolean;
  onSaved(profile: StoredProfile): void;
  /** Unsaved changes exist (T12): the builder asks before leaving them. */
  onDirtyChange(dirty: boolean): void;
  /**
   * "Save mine as a copy": a new profile from the draft; the original is left as stored
   * (`current`, from the 409) or dropped from the list when it was deleted elsewhere. Resolves
   * to why it failed, or null.
   */
  onSaveCopy(
    draft: Profile,
    original: { id: string; current: StoredProfile | null },
  ): Promise<string | null>;
}

interface Refused {
  kind: "changed" | "deleted";
  /** The server's current profile, from the 409. */
  current: StoredProfile | null;
}

const fieldsOf = ({ name, palette, dials, effects }: StoredProfile): Profile => ({
  name,
  palette,
  dials,
  effects,
});

export function Editor({
  saved,
  readOnly,
  offline,
  onSaved,
  onDirtyChange,
  onSaveCopy,
}: EditorProps) {
  const [draft, dispatch] = useReducer(reduce, saved, fieldsOf);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refused, setRefused] = useState<Refused | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const issues = validate(draft);
  const dirty = isDirty(draft, saved);
  const nameIssue = issues.find((i) => i.path === "name");
  const canSave = !readOnly && !offline && !saving && !refused && dirty && issues.length === 0;
  const addable = availableTypes(draft);

  // The builder asks before leaving unsaved changes; this editor going away leaves none.
  useEffect(() => {
    onDirtyChange(dirty && !readOnly);
    return () => onDirtyChange(false);
  }, [dirty, readOnly, onDirtyChange]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const result = await updateProfile(saved.id, draft, saved.revision);
    setSaving(false);
    if (result.kind === "ok") onSaved(result.profile);
    else if (result.kind === "conflict" && result.conflict.reason === "stale_revision") {
      setRefused({ kind: "changed", current: result.conflict.current });
    } else if (result.kind === "missing") setRefused({ kind: "deleted", current: null });
    else setSaveError(describeFailure(result, "could not save"));
  };

  const saveCopy = async () => {
    if (!refused) return;
    setSaving(true);
    setCopyError(null);
    const error = await onSaveCopy(draft, { id: saved.id, current: refused.current });
    setSaving(false);
    if (error) setCopyError(error); // the draft and the choice are still here
  };

  return (
    <section
      data-testid="editor"
      aria-label={`Editing ${saved.name}`}
      style={{ display: "grid", gap: 10, alignContent: "start" }}
    >
      {readOnly && (
        <p data-testid="editor-readonly">
          The built-in profile is read-only. Duplicate it to edit.
        </p>
      )}

      <label style={{ display: "grid", gap: 2 }}>
        Name
        <input
          data-testid="editor-name"
          value={draft.name}
          disabled={readOnly}
          aria-invalid={nameIssue ? true : undefined}
          onChange={(e) => dispatch({ type: "name", name: e.target.value })}
        />
      </label>
      {nameIssue && (
        <span data-testid="editor-name-error" style={{ color: "#f88" }}>
          a name is 1 to {LIMITS.nameLength} characters
        </span>
      )}

      <fieldset style={{ display: "grid", gap: 4 }}>
        <legend>Starting dials</legend>
        {(["recognisability", "reactivity"] as const).map((dial) => (
          <label key={dial} style={{ display: "flex", gap: 6 }}>
            <span style={{ width: 120 }}>{dial === "reactivity" ? "audio reactivity" : dial}</span>
            <input
              type="range"
              data-testid={`editor-dial-${dial}`}
              min={0}
              max={1}
              step={0.01}
              value={draft.dials[dial]}
              disabled={readOnly}
              onChange={(e) => dispatch({ type: "dial", dial, value: Number(e.target.value) })}
            />
            <span>{draft.dials[dial].toFixed(2)}</span>
          </label>
        ))}
      </fieldset>

      <fieldset style={{ display: "grid", gap: 4 }}>
        <legend>Palette</legend>
        <label>
          Start from a preset{" "}
          <select
            data-testid="palette-preset"
            value=""
            disabled={readOnly}
            onChange={(e) => {
              const preset = PRESETS.find((p) => p.name === e.target.value);
              if (preset) dispatch({ type: "paletteReplace", palette: preset.palette });
            }}
          >
            <option value="">choose…</option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {draft.palette.map((colour, index) => (
            <span key={index} style={{ display: "inline-flex", gap: 2 }}>
              <input
                type="color"
                data-testid={`palette-colour-${index}`}
                aria-label={`Colour ${index + 1}`}
                value={colour.toLowerCase()}
                disabled={readOnly}
                onChange={(e) => dispatch({ type: "paletteSet", index, colour: e.target.value })}
              />
              <button
                type="button"
                data-testid={`palette-remove-${index}`}
                aria-label={`Remove colour ${index + 1}`}
                disabled={readOnly || draft.palette.length <= LIMITS.paletteMin}
                onClick={() => dispatch({ type: "paletteRemove", index })}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            data-testid="palette-add"
            disabled={readOnly || draft.palette.length >= LIMITS.paletteMax}
            onClick={() => dispatch({ type: "paletteAdd" })}
          >
            Add colour
          </button>
        </div>
      </fieldset>

      <fieldset style={{ display: "grid", gap: 4 }}>
        <legend>Effects, applied first to last</legend>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {draft.effects.map((effect, index) => (
            <EffectRow
              key={effect.type}
              effect={effect}
              index={index}
              count={draft.effects.length}
              paletteLength={draft.palette.length}
              disabled={readOnly}
              dispatch={dispatch}
            />
          ))}
        </ol>
        <label>
          Add an effect{" "}
          <select
            data-testid="effect-add"
            value=""
            disabled={readOnly || addable.length === 0}
            onChange={(e) => {
              const effectType = addable.find((t) => t === e.target.value);
              if (effectType) dispatch({ type: "effectAdd", effectType });
            }}
          >
            <option value="">{addable.length === 0 ? "no effects left" : "choose…"}</option>
            {addable.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {!readOnly && (
        <div style={{ display: "grid", gap: 4 }}>
          {refused && (
            <Conflict
              kind={refused.kind}
              busy={saving}
              error={copyError}
              onReload={() => refused.current && onSaved(refused.current)}
              onCopy={() => void saveCopy()}
            />
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              data-testid="editor-save"
              disabled={!canSave}
              onClick={() => void save()}
            >
              Save
            </button>
            <button
              type="button"
              data-testid="editor-revert"
              disabled={!dirty || saving}
              onClick={() => {
                dispatch({ type: "reset", profile: saved });
                setRefused(null);
                setSaveError(null);
              }}
            >
              Revert to last saved
            </button>
            {dirty && <span data-testid="editor-dirty">unsaved changes</span>}
          </div>
          {issues.length > 0 && (
            <ul role="alert" data-testid="editor-issues" style={{ margin: 0, color: "#f88" }}>
              {issues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>
                  {issue.path || "profile"}: {issue.message}
                </li>
              ))}
            </ul>
          )}
          {offline && (
            <span data-testid="editor-offline">The server cannot be reached: Save is off.</span>
          )}
          {saveError && (
            <span role="alert" data-testid="editor-save-error" style={{ color: "#f88" }}>
              {saveError}. Your edits are kept; Save to try again.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
