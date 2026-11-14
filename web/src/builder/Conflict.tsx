// The choice after a refused save (B-02 spec SD10, AC6; plan T12): the profile was changed
// elsewhere (stale revision), or deleted elsewhere. The draft is never lost before one is chosen.
// "Reload theirs" takes the server's current profile; "Save mine as a copy" creates a new profile
// from the draft and leaves the original as stored.
export interface ConflictProps {
  /** `changed`: another tab saved first. `deleted`: the profile is gone. */
  kind: "changed" | "deleted";
  busy: boolean;
  /** Why the last attempt to save a copy failed; the draft is still here. */
  error: string | null;
  onReload(): void;
  onCopy(): void;
}

export function Conflict({ kind, busy, error, onReload, onCopy }: ConflictProps) {
  return (
    <div
      role="alert"
      data-testid="conflict"
      style={{ display: "grid", gap: 6, padding: 8, border: "1px solid #f88" }}
    >
      <strong>
        {kind === "changed"
          ? "This profile was changed elsewhere."
          : "This profile was deleted elsewhere."}
      </strong>
      <span>Your edits are still here. Nothing was saved.</span>
      <div style={{ display: "flex", gap: 8 }}>
        {kind === "changed" && (
          <button type="button" data-testid="conflict-reload" disabled={busy} onClick={onReload}>
            Reload theirs
          </button>
        )}
        <button type="button" data-testid="conflict-copy" disabled={busy} onClick={onCopy}>
          {kind === "changed" ? "Save mine as a copy" : "Save as a new profile"}
        </button>
      </div>
      {error && (
        <span data-testid="conflict-error" style={{ color: "#f88" }}>
          {error}
        </span>
      )}
    </div>
  );
}
