// The builder (B-02 spec SD13, UI "/builder"; plan T10, T11): the profile list, with create,
// duplicate, rename and delete, and the editor for the selected profile. States: loading, empty
// (the built-in only), error (the built-in and one line; writes disabled). The page scrolls
// inside its own container, because `index.html` hides overflow for the screen page (PD14).
import { nextFreeName, type Profile, type StoredProfile } from "@djv/shared";
import { useCallback, useEffect, useState } from "react";
import { createProfile, deleteProfile, listProfiles, updateProfile } from "../profiles/api.ts";
import { BUILTIN_ID, builtinEntry } from "../profiles/builtin.ts";
import { download, exportFile, fileName } from "../profiles/file.ts";
import { Editor } from "./Editor.tsx";
import { describeFailure } from "./failure.ts";
import { Preview } from "./Preview.tsx";
import { ProfileList, type CreateSource } from "./ProfileList.tsx";
import { Transfer } from "./Transfer.tsx";
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

// Narrow windows: the list beside a stacked preview and editor, the page scrolls. From 1000px:
// three columns that each scroll on their own, so the preview stays beside the dials.
const LAYOUT_CSS = `
.bld { overflow: auto; }
.bld-grid { display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: 24px; }
.bld-list { grid-column: 1; grid-row: 1 / span 2; }
.bld-preview { grid-column: 2; grid-row: 1; }
.bld-editor { grid-column: 2; grid-row: 2; }
@media (min-width: 1000px) {
  .bld { overflow: hidden; display: flex; flex-direction: column; }
  .bld-grid { grid-template-columns: minmax(240px, 300px) minmax(0, 1fr) minmax(320px, 40%);
    grid-template-rows: minmax(0, 1fr); flex: 1; min-height: 0; }
  .bld-list { grid-row: 1; }
  .bld-editor { grid-column: 2; grid-row: 1; }
  .bld-preview { grid-column: 3; grid-row: 1; }
  .bld-col { overflow-y: auto; min-height: 0; }
}
`;

export function Builder() {
  const [load, setLoad] = useState<Load>("loading");
  const [stored, setStored] = useState<StoredProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(BUILTIN_ID);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // The draft the editor reports, with the profile it belongs to: while the editor of another
  // profile is mounting, the preview keeps showing the saved one and never a stale draft.
  const [reported, setReported] = useState<{ key: string; draft: Profile } | null>(null);

  // Leaving unsaved changes asks first (T12): another profile, a link, closing the tab.
  const confirmDiscard = () => !dirty || window.confirm("Discard your unsaved changes?");
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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
  const selectedKey = selected ? `${selected.id}:${selected.revision}` : "";
  const onDraftChange = useCallback(
    (draft: Profile) => setReported({ key: selectedKey, draft }),
    [selectedKey],
  );

  const add = useCallback((profile: StoredProfile) => {
    setStored((list) => [...list.filter((p) => p.id !== profile.id), profile].sort(byName));
  }, []);

  const select = (id: string) => {
    if (id === selectedId || !confirmDiscard()) return;
    setSelectedId(id);
  };

  /** "Save mine as a copy" / "Save as a new profile" (T12): the draft becomes a new profile. */
  const saveCopy = async (
    draft: Profile,
    original: { id: string; current: StoredProfile | null },
  ): Promise<string | null> => {
    const others = stored.filter((p) => p.id !== original.id);
    const taken = [
      "Built-in",
      ...others.map((p) => p.name),
      ...(original.current ? [original.current.name] : []),
    ];
    const result = await createProfile({ ...draft, name: nextFreeName(draft.name, taken) });
    if (result.kind !== "ok") return describe(result, "could not save a copy");
    setStored((list) => {
      const rest = list.filter((p) => p.id !== original.id && p.id !== result.profile.id);
      return [...rest, ...(original.current ? [original.current] : []), result.profile].sort(
        byName,
      );
    });
    setSelectedId(result.profile.id);
    setDirty(false);
    setNotice(null);
    return null;
  };

  const create = async (source: CreateSource) => {
    if (!confirmDiscard()) return;
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
    if (!confirmDiscard()) return;
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
    // The editor restarts from the renamed profile, so an open draft of it would be lost.
    if (entry.id === selectedId && !confirmDiscard()) return "rename cancelled";
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
      className="bld"
      style={{
        height: "100vh",
        boxSizing: "border-box",
        padding: 16,
        background: "#111",
        color: "#eee",
        font: "14px/1.5 system-ui, sans-serif",
      }}
    >
      <style>{LAYOUT_CSS}</style>
      <h1 style={{ margin: "0 0 8px", fontSize: 20 }}>Profile builder</h1>
      <p style={{ margin: "0 0 12px" }}>
        <a
          href="/"
          style={{ color: "#9cf" }}
          onClick={(e) => {
            if (!confirmDiscard()) e.preventDefault();
          }}
        >
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
      <div className="bld-grid">
        <div className="bld-list bld-col">
          <ProfileList
            entries={entries}
            selectedId={selectedId}
            readOnly={readOnly}
            onSelect={select}
            onCreate={(source) => void create(source)}
            onDuplicate={(entry) => void duplicate(entry)}
            onExport={(entry) => {
              const definition = definitionOf(entry);
              download(exportFile([definition]), fileName([definition]));
            }}
            onRename={rename}
            onDelete={(entry) => void remove(entry)}
          />
          <Transfer
            readOnly={readOnly}
            storedCount={stored.length}
            onImported={(profiles) => setStored((list) => [...list, ...profiles].sort(byName))}
          />
        </div>
        {selected && (
          <>
            <div className="bld-editor bld-col">
              <Editor
                // A new revision is a new draft: the saved profile is what the editor starts from.
                key={selectedKey}
                saved={selected}
                readOnly={selected.id === BUILTIN_ID}
                offline={readOnly}
                onSaved={add}
                onDirtyChange={setDirty}
                onDraftChange={onDraftChange}
                onSaveCopy={saveCopy}
              />
            </div>
            <div className="bld-preview bld-col">
              <Preview
                draft={reported?.key === selectedKey ? reported.draft : definitionOf(selected)}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
