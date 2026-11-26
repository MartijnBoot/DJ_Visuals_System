// The Scenes section of /control (B-07 spec SD3, SD4, SD9, SD10, SD11, UI "/control, VJ mode";
// plan PD16, PD18, PD20, T9): VJ mode only, the first section. The preview frame's place (T13),
// the Editing switch with its words, Stage from live, Go and Unstage, a tile per saved scene (the
// staged one lit; a tap stages it), the name field with Save — or Update and Save as new for a look
// from a listed scene — Rename and Delete for that scene, Delete asking first in the dialog frame,
// and the feed line. Every key sends nothing while locked; the switch is the page's own and stays
// live. The look is the brief's (`docs/design/controller-style.md`, The Scenes section).
import type { ScreenState } from "@djv/shared";
import { useEffect, useRef, useState } from "react";
import type { ControlInput } from "./device-link.ts";
import { feedLine, nameProblem, saveChoices, type Editing } from "./scenes-view.ts";

export interface ScenesProps {
  state: ScreenState;
  locked: boolean;
  /** The switch's reading; only meaningful while a staged look exists. */
  editing: Editing;
  onEditing(editing: Editing): void;
  /** A tap through the page's send budget. */
  send(message: ControlInput): void;
}

const TESTID: Record<string, string> = {
  Save: "scene-save",
  "Save as new": "scene-save-new",
};

export function Scenes({ state, locked, editing, onEditing, send }: ScenesProps) {
  const staged = state.staged ?? null;
  const scenes = state.scenes;
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  /** Rename and Delete act on the scene the staged look came from, while it is listed. */
  const tied = staged?.fromScene ?? null;
  const listed = tied && scenes?.some((s) => s.id === tied.id) ? tied : null;
  const problem = name.trim() === "" ? null : nameProblem(name);
  const nameOk = name.trim() !== "" && problem === null;
  const feed = feedLine(state);

  // The confirm exists only while it asks: a closed dialog stays out of the page, as the other
  // VJ-mode sections keep theirs (B-16's swatch test counts every <dialog>).
  useEffect(() => {
    const d = dialog.current;
    if (confirming && d && !d.open) d.showModal();
  }, [confirming]);

  return (
    <section aria-label="Scenes" data-testid="scenes" className="djv-section">
      <h2 className="djv-legend">Scenes</h2>
      <div data-testid="preview-place" className="djv-preview-place" />

      {staged && (
        <>
          <div className="djv-row djv-editing" role="group" aria-label="Editing">
            <span className="djv-legend">Editing</span>
            {(["staged", "live"] as const).map((e) => (
              <button
                key={e}
                type="button"
                data-testid={`editing-${e}`}
                aria-pressed={editing === e}
                className="djv-key djv-mode"
                onClick={() => onEditing(e)}
              >
                {e === "staged" ? "Staged" : "Live"}
              </button>
            ))}
          </div>
          <div data-testid="editing-note" className="djv-note">
            {editing === "staged"
              ? "The controls below edit the staged look"
              : "The controls below edit the live look"}
          </div>
        </>
      )}

      <div className="djv-row">
        <button
          type="button"
          data-testid="stage-live"
          disabled={locked}
          className="djv-key"
          onClick={() => send({ type: "stage", from: "live" })}
        >
          Stage from live
        </button>
        <button
          type="button"
          data-testid="scene-go"
          disabled={locked || !staged}
          className="djv-key"
          onClick={() => send({ type: "go" })}
        >
          Go
        </button>
        <button
          type="button"
          data-testid="scene-unstage"
          disabled={locked || !staged}
          className="djv-key"
          onClick={() => send({ type: "unstage" })}
        >
          Unstage
        </button>
      </div>

      {staged?.reason && (
        <div data-testid="scenes-reason" className="djv-note">
          {staged.reason}
        </div>
      )}
      {feed && (
        <div data-testid="feed-line" className="djv-note">
          {feed}
        </div>
      )}

      {scenes === null || scenes === undefined ? (
        <div data-testid="scenes-unavailable" className="djv-note">
          Scenes unavailable
        </div>
      ) : scenes.length === 0 ? (
        <div data-testid="scenes-empty" className="djv-note">
          No scenes yet
        </div>
      ) : (
        <div className="djv-grid">
          {scenes.map((s) => (
            <button
              key={s.id}
              type="button"
              data-testid="scene-tile"
              data-scene-id={s.id}
              aria-pressed={staged?.fromScene?.id === s.id}
              disabled={locked}
              className="djv-key djv-tile"
              onClick={() => send({ type: "stage", from: { scene: s.id } })}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="djv-row">
        <input
          data-testid="scene-name"
          aria-label="Scene name"
          placeholder="Name"
          value={name}
          maxLength={80}
          autoComplete="off"
          className="djv-name"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {problem && (
        <div data-testid="scene-name-problem" className="djv-note">
          {problem}
        </div>
      )}
      <div className="djv-row">
        {saveChoices(staged, scenes ?? []).map((choice) => (
          <button
            key={choice.label}
            type="button"
            data-testid={choice.updateId ? "scene-update" : TESTID[choice.label]}
            disabled={locked || !staged || !staged.settled || (choice.name === null && !nameOk)}
            className="djv-key"
            onClick={() =>
              send({
                type: "saveScene",
                name: choice.name ?? name.trim(),
                ...(choice.updateId ? { updateId: choice.updateId } : {}),
              })
            }
          >
            {choice.label}
          </button>
        ))}
        <button
          type="button"
          data-testid="scene-rename"
          disabled={locked || !listed || !nameOk}
          className="djv-key"
          onClick={() => listed && send({ type: "renameScene", id: listed.id, name: name.trim() })}
        >
          Rename
        </button>
        <button
          type="button"
          data-testid="scene-delete"
          disabled={locked || !listed}
          className="djv-key"
          onClick={() => setConfirming(true)}
        >
          Delete
        </button>
      </div>

      {confirming && (
        <dialog
          ref={dialog}
          aria-label="Delete scene"
          className="djv-dialog"
          onClose={() => setConfirming(false)}
        >
          <span>Delete {listed?.name}?</span>
          <div className="djv-row">
            <button
              type="button"
              className="djv-key"
              disabled={locked || !listed}
              onClick={() => {
                if (listed) send({ type: "deleteScene", id: listed.id });
                setConfirming(false);
              }}
            >
              Delete
            </button>
            <button type="button" className="djv-key" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
