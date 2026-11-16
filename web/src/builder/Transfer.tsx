// Export all and import (B-02 spec SD7, AC9, AC10; plan T13). A valid file goes to the server;
// any failure, local or from the server, is shown as `<profile name>: <field> — <message>`, or
// "unsupported file version", or "not a JSON file", and nothing is stored. B-03 (SD10, PD11): a
// file of one profile whose name is stored asks "Replace <Name>" or "Add as a copy"; Replace
// saves the file's definition over that profile at the revision just read, and a save elsewhere
// in between gets B-02's conflict choice. A bundle only ever adds.
import type { ProfileFile, StoredProfile } from "@djv/shared";
import { useRef, useState } from "react";
import { importProfiles, listProfiles, updateProfile } from "../profiles/api.ts";
import {
  download,
  exportFile,
  fileName,
  importIssueLine,
  readImport,
  toImportIssue,
} from "../profiles/file.ts";
import { Conflict } from "./Conflict.tsx";
import { describeFailure } from "./failure.ts";
import { replaceTarget } from "./replace.ts";

export interface TransferProps {
  /** The API is unreachable: Export all and Import are off. */
  readOnly: boolean;
  /** How many profiles are stored: Export all is off at none. */
  storedCount: number;
  onImported(profiles: StoredProfile[]): void;
  /** A profile replaced in place, or the server's copy after a refused Replace (B-03). */
  onStored(profile: StoredProfile): void;
  /** Before Replace: false when the profile is open with unsaved changes kept (PD11). */
  confirmReplace(id: string): boolean;
}

interface Message {
  kind: "ok" | "error";
  lines: string[];
}

export function Transfer({
  readOnly,
  storedCount,
  onImported,
  onStored,
  confirmReplace,
}: TransferProps) {
  const [message, setMessage] = useState<Message | null>(null);
  /** A one-profile file whose name is stored, waiting for Replace or Add as a copy. */
  const [choice, setChoice] = useState<{ file: ProfileFile; target: StoredProfile } | null>(null);
  /** Replace was refused: the profile changed elsewhere since the choice was offered. */
  const [refused, setRefused] = useState<{ file: ProfileFile; current: StoredProfile } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    const result = await listProfiles(); // a fresh read: every stored profile, as it is now
    if (result.kind !== "ok") {
      setMessage({ kind: "error", lines: [describeFailure(result, "could not export")] });
    } else if (result.profiles.length === 0) {
      setMessage({ kind: "error", lines: ["there is nothing to export"] });
    } else {
      download(exportFile(result.profiles), fileName(result.profiles));
      setMessage({ kind: "ok", lines: [`Exported ${result.profiles.length} profiles.`] });
    }
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    const read = readImport(text);
    if (read.kind === "not_json") {
      setMessage({ kind: "error", lines: ["not a JSON file"] });
    } else if (read.kind === "unsupported_version") {
      setMessage({ kind: "error", lines: ["unsupported file version"] });
    } else if (read.kind === "invalid") {
      setMessage({ kind: "error", lines: read.issues.map(importIssueLine) });
    } else {
      await offer(read.file);
    }
    if (input.current) input.current.value = ""; // the same file can be chosen again
  };

  /** A one-profile file whose name is stored asks first; anything else is added (PD11). */
  const offer = async (file: ProfileFile) => {
    if (file.profiles.length === 1) {
      const list = await listProfiles(); // a fresh read: the revision Replace starts from
      if (list.kind !== "ok") {
        setMessage({ kind: "error", lines: [describeFailure(list, "could not import")] });
        return;
      }
      const target = replaceTarget(file, list.profiles);
      if (target) {
        setChoice({ file, target });
        return;
      }
    }
    await add(file);
  };

  /** Today's import: every profile added, a taken name made free by the server. */
  const add = async (file: ProfileFile) => {
    const result = await importProfiles(file);
    if (result.kind === "ok") {
      onImported(result.profiles);
      setMessage({
        kind: "ok",
        lines: [`Imported: ${result.profiles.map((p) => p.name).join(", ")}`],
      });
    } else if (result.kind === "invalid") {
      setMessage({
        kind: "error",
        lines: result.issues.map((issue) => importIssueLine(toImportIssue(issue))),
      });
    } else {
      setMessage({ kind: "error", lines: [describeFailure(result, "could not import")] });
    }
  };

  const replace = async () => {
    if (!choice || !confirmReplace(choice.target.id)) return;
    const { file, target } = choice;
    setBusy(true);
    const result = await updateProfile(target.id, file.profiles[0]!, target.revision);
    setBusy(false);
    setChoice(null);
    if (result.kind === "ok") {
      onStored(result.profile);
      setMessage({ kind: "ok", lines: [`Replaced: ${result.profile.name}`] });
    } else if (result.kind === "conflict" && result.conflict.reason === "stale_revision") {
      setRefused({ file, current: result.conflict.current });
    } else if (result.kind === "missing") {
      setMessage({
        kind: "error",
        lines: [`"${target.name}" was deleted elsewhere; import the file again to add it`],
      });
    } else {
      setMessage({ kind: "error", lines: [describeFailure(result, "could not replace")] });
    }
  };

  const addInstead = async (file: ProfileFile) => {
    setBusy(true);
    await add(file);
    setBusy(false);
  };

  return (
    <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          data-testid="export-all"
          disabled={readOnly || storedCount === 0}
          onClick={() => void exportAll()}
        >
          Export all
        </button>
        <label>
          Import a file{" "}
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            data-testid="import-file"
            disabled={readOnly}
            onChange={(e) => {
              const file = e.target.files?.[0];
              setMessage(null);
              setChoice(null);
              setRefused(null);
              if (file) void importFile(file);
            }}
          />
        </label>
      </div>
      {choice && (
        <div data-testid="import-choice" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span>A profile named "{choice.target.name}" is stored.</span>
          <button
            type="button"
            data-testid="import-replace"
            disabled={busy}
            onClick={() => void replace()}
          >
            Replace {choice.target.name}
          </button>
          <button
            type="button"
            data-testid="import-copy"
            disabled={busy}
            onClick={() => {
              setChoice(null);
              void addInstead(choice.file);
            }}
          >
            Add as a copy
          </button>
        </div>
      )}
      {refused && (
        <Conflict
          kind="changed"
          busy={busy}
          error={null}
          onReload={() => {
            onStored(refused.current);
            setRefused(null);
            setMessage({ kind: "ok", lines: [`Kept the stored "${refused.current.name}".`] });
          }}
          onCopy={() => {
            setRefused(null);
            void addInstead(refused.file);
          }}
        />
      )}
      {message && (
        <div
          role={message.kind === "error" ? "alert" : "status"}
          data-testid="transfer-message"
          style={{ color: message.kind === "error" ? "#f88" : "#8f8" }}
        >
          {message.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
