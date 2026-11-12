// The builder's profile list (B-02 spec SD13, AC1, AC2; plan T10): the built-in first, then the
// stored names; per stored profile duplicate, rename (inline) and delete; the built-in offers
// duplicate only. Presentational: `Builder` owns the data and the calls. Every control is a
// native, labelled control in tab order.
import type { StoredProfile } from "@djv/shared";
import { useState } from "react";
import { BUILTIN_ID } from "../profiles/builtin.ts";
import { PRESETS } from "./presets.ts";

export type CreateSource = "builtin" | `preset:${string}`;

export interface ProfileListProps {
  /** The built-in first, then the stored profiles in name order. */
  entries: StoredProfile[];
  selectedId: string | null;
  /** The API is unreachable: every write is disabled. */
  readOnly: boolean;
  onSelect(id: string): void;
  onCreate(source: CreateSource): void;
  onDuplicate(entry: StoredProfile): void;
  /** Downloads this one profile as a file; the built-in too. */
  onExport(entry: StoredProfile): void;
  /** Resolves to the message to show beside the field, or null when the rename went through. */
  onRename(entry: StoredProfile, name: string): Promise<string | null>;
  onDelete(entry: StoredProfile): void;
}

export function ProfileList(props: ProfileListProps) {
  const [source, setSource] = useState<CreateSource>("builtin");
  const [renaming, setRenaming] = useState<{
    id: string;
    text: string;
    error: string | null;
  } | null>(null);

  const commitRename = async (entry: StoredProfile) => {
    if (!renaming) return;
    const text = renaming.text.trim();
    if (text.length < 1 || text.length > 60) {
      setRenaming({ ...renaming, error: "a name is 1 to 60 characters" });
      return;
    }
    const error = await props.onRename(entry, text);
    setRenaming(error ? { ...renaming, error } : null);
  };

  return (
    <nav aria-label="Profiles" style={{ display: "grid", gap: 8, alignContent: "start" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          New profile from{" "}
          <select
            data-testid="create-source"
            value={source}
            disabled={props.readOnly}
            onChange={(e) => setSource(e.target.value as CreateSource)}
          >
            <option value="builtin">built-in</option>
            {PRESETS.map((preset) => (
              <option key={preset.name} value={`preset:${preset.name}`}>
                preset: {preset.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="create-button"
          disabled={props.readOnly}
          onClick={() => props.onCreate(source)}
        >
          Create profile
        </button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {props.entries.map((entry) => {
          const builtin = entry.id === BUILTIN_ID;
          const editing = renaming?.id === entry.id ? renaming : null;
          return (
            <li
              key={entry.id}
              data-testid={`profile-row-${entry.id}`}
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                flexWrap: "wrap",
                padding: "2px 4px",
                background: entry.id === props.selectedId ? "#334" : "transparent",
              }}
            >
              {editing ? (
                <>
                  <label>
                    <span style={{ position: "absolute", left: -9999 }}>
                      New name for {entry.name}
                    </span>
                    <input
                      data-testid="rename-input"
                      value={editing.text}
                      maxLength={80}
                      autoFocus
                      onChange={(e) =>
                        setRenaming({ ...editing, text: e.target.value, error: null })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename(entry);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    data-testid="rename-save"
                    onClick={() => void commitRename(entry)}
                  >
                    Save name
                  </button>
                  <button type="button" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                  {editing.error && (
                    <span role="alert" data-testid="name-error" style={{ color: "#f88" }}>
                      {editing.error}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    data-testid={`profile-name-${entry.id}`}
                    aria-pressed={entry.id === props.selectedId}
                    onClick={() => props.onSelect(entry.id)}
                    style={{ flex: 1, textAlign: "left" }}
                  >
                    {entry.name}
                  </button>
                  <button
                    type="button"
                    data-testid={`profile-duplicate-${entry.id}`}
                    aria-label={`Duplicate ${entry.name}`}
                    disabled={props.readOnly}
                    onClick={() => props.onDuplicate(entry)}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    data-testid={`profile-export-${entry.id}`}
                    aria-label={`Export ${entry.name}`}
                    onClick={() => props.onExport(entry)}
                  >
                    Export
                  </button>
                  {!builtin && (
                    <>
                      <button
                        type="button"
                        data-testid={`profile-rename-${entry.id}`}
                        aria-label={`Rename ${entry.name}`}
                        disabled={props.readOnly}
                        onClick={() => setRenaming({ id: entry.id, text: entry.name, error: null })}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        data-testid={`profile-delete-${entry.id}`}
                        aria-label={`Delete ${entry.name}`}
                        disabled={props.readOnly}
                        onClick={() => props.onDelete(entry)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
