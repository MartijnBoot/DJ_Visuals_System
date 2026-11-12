// The builder (B-02 spec SD13, UI "/builder"; plan T10, T11): the profile list, with create,
// duplicate, rename and delete, and the editor for the selected profile. States: loading, empty
// (the built-in only), error (the built-in and one line; writes disabled). The page scrolls
// inside its own container, because `index.html` hides overflow for the screen page (PD14).
import { nextFreeName, type Profile, type StoredProfile } from "@djv/shared";
import { useCallback, useEffect, useState } from "react";
import { createProfile, deleteProfile, listProfiles, updateProfile } from "../profiles/api.ts";
import { BUILTIN_ID, builtinEntry } from "../profiles/builtin.ts";
import { Editor } from "./Editor.tsx";
import { describeFailure } from "./failure.ts";
import { ProfileList, type CreateSource } from "./ProfileList.tsx";
import { fromBuiltin, fromPreset, PRESETS } from "./presets.ts";

type Load = "loading" | "ready" | "error";

const byName = (a: StoredProfile, b: StoredProfile) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The profile's own fields, as the API takes them. */
const definitionOf = ({ name, palette, dials, effects }: StoredProfile): Profile => ({
  name,
  palette,
  dials,
  effects,
});

const describe = describeFailure;

export function Builder() {
  const [load, setLoad] = useState<Load>("loading");
  const [stored, setStored] = useState<StoredProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(BUILTIN_ID);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void listProfiles().then((result) => {
      if (!mounted) return;
      if (result.kind === "ok") {
        setStored([...result.profiles].sort(byName));
        setLoad("ready");
      } else {
        setLoad("error");
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const entries = [builtinEntry(), ...stored];
  // The built-in is not stored, but its name is not for a stored profile to take either.
  const takenNames = () => ["Built-in", ...stored.map((p) => p.name)];
  const readOnly = load !== "ready";
  const selected = entries.find((e) => e.id === selectedId);

  const add = useCallback((profile: StoredProfile) => {
    setStored((list) => [...list.filter((p) => p.id !== profile.id), profile].sort(byName));
  }, []);

  const create = async (source: CreateSource) => {
    const name = nextFreeName("New profile", takenNames());
    const preset =
      source === "builtin" ? undefined : PRESETS.find((p) => `preset:${p.name}` === source);
    const profile = preset ? fromPreset(preset, name) : fromBuiltin(name);
    const result = await createProfile(profile);
    if (result.kind === "ok") {
      add(result.profile);
      setSelectedId(result.profile.id);
      setNotice(null);
    } else {
      setNotice(describe(result, "could not create"));
    }
  };

  const duplicate = async (entry: StoredProfile) => {
    const profile = { ...definitionOf(entry), name: nextFreeName(entry.name, takenNames()) };
    const result = await createProfile(profile);
    if (result.kind === "ok") {
      add(result.profile);
      setSelectedId(result.profile.id);
      setNotice(null);
    } else {
      setNotice(describe(result, "could not duplicate"));
    }
  };

  /** A rename is a save: same id, revision + 1 (AD1). */
  const rename = async (entry: StoredProfile, name: string): Promise<string | null> => {
    const result = await updateProfile(entry.id, { ...definitionOf(entry), name }, entry.revision);
    if (result.kind === "ok") {
      add(result.profile);
      return null;
    }
    if (result.kind === "conflict" && result.conflict.reason === "stale_revision") {
      add(result.conflict.current);
      return "this profile was changed elsewhere; try again";
    }
    return describe(result, "could not rename");
  };

  const remove = async (entry: StoredProfile) => {
    if (!window.confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
    const result = await deleteProfile(entry.id);
    if (result.kind === "ok" || result.kind === "missing") {
      setStored((list) => list.filter((p) => p.id !== entry.id));
      setSelectedId((id) => (id === entry.id ? BUILTIN_ID : id));
      setNotice(null);
    } else {
      setNotice(describe(result, "could not delete"));
    }
  };

  return (
    <main
      data-testid="builder"
      style={{
        height: "100vh",
        overflow: "auto",
        boxSizing: "border-box",
        padding: 16,
        background: "#111",
        color: "#eee",
        font: "14px/1.5 system-ui, sans-serif",
      }}
    >
      <h1 style={{ margin: "0 0 8px", fontSize: 20 }}>Profile builder</h1>
      <p style={{ margin: "0 0 12px" }}>
        <a href="/" style={{ color: "#9cf" }}>
          Back to the screen
        </a>
      </p>
      <p data-testid="list-state" aria-live="polite" style={{ margin: "0 0 8px" }}>
        {load === "loading" && "Loading profiles…"}
        {load === "error" &&
          "Profiles unavailable: the server cannot be reached. Only the built-in is shown."}
        {load === "ready" && stored.length === 0 && "No profiles yet. Create one to start."}
      </p>
      {notice && (
        <p role="alert" data-testid="notice" style={{ color: "#f88" }}>
          {notice}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: 24 }}>
        <ProfileList
          entries={entries}
          selectedId={selectedId}
          readOnly={readOnly}
          onSelect={setSelectedId}
          onCreate={(source) => void create(source)}
          onDuplicate={(entry) => void duplicate(entry)}
          onRename={rename}
          onDelete={(entry) => void remove(entry)}
        />
        {selected && (
          <Editor
            // A new revision is a new draft: the saved profile is what the editor starts from.
            key={`${selected.id}:${selected.revision}`}
            saved={selected}
            readOnly={selected.id === BUILTIN_ID}
            offline={readOnly}
            onSaved={add}
          />
        )}
      </div>
    </main>
  );
}
