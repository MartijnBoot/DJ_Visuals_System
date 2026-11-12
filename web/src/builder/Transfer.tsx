// Export all and import (B-02 spec SD7, AC9, AC10; plan T13). A valid file goes to the server;
// any failure, local or from the server, is shown as `<profile name>: <field> — <message>`, or
// "unsupported file version", or "not a JSON file", and nothing is stored.
import type { StoredProfile } from "@djv/shared";
import { useRef, useState } from "react";
import { importProfiles, listProfiles } from "../profiles/api.ts";
import {
  download,
  exportFile,
  fileName,
  importIssueLine,
  readImport,
  toImportIssue,
} from "../profiles/file.ts";
import { describeFailure } from "./failure.ts";

export interface TransferProps {
  /** The API is unreachable: Export all and Import are off. */
  readOnly: boolean;
  /** How many profiles are stored: Export all is off at none. */
  storedCount: number;
  onImported(profiles: StoredProfile[]): void;
}

interface Message {
  kind: "ok" | "error";
  lines: string[];
}

export function Transfer({ readOnly, storedCount, onImported }: TransferProps) {
  const [message, setMessage] = useState<Message | null>(null);
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
      const result = await importProfiles(read.file);
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
    }
    if (input.current) input.current.value = ""; // the same file can be chosen again
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
              if (file) void importFile(file);
            }}
          />
        </label>
      </div>
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
