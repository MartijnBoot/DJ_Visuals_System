// Export and import files (B-02 spec SD7, AC9, AC10; plan T13). The text is `toProfileFile` of
// the shared package: format version 1 and each profile's name, palette, dials and effects, never
// an id, revision or timestamp. An imported file is data, never code: it is checked with the
// shared schema here, before anything is sent, and the server checks it again.
import {
  FORMAT_VERSION,
  issuesFrom,
  profileFileSchema,
  toProfileFile,
  type Issue,
  type Profile,
  type ProfileFile,
} from "@djv/shared";

/** The file text for one profile or a bundle. */
export function exportFile(profiles: readonly Profile[]): string {
  return JSON.stringify(toProfileFile(profiles), null, 2);
}

/** A file name for the download: the profile's own for one, generic for a bundle. */
export function fileName(profiles: readonly Profile[]): string {
  if (profiles.length === 1) {
    const slug = profiles[0]!.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `${slug || "profile"}.djv.json`;
  }
  return "djv-profiles.djv.json";
}

/** Hands `text` to the browser as a file download, through a Blob and a temporary link. */
export function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** One failing field of an import file, naming the profile when there is one. */
export interface ImportIssue {
  profile?: string;
  field: string;
  message: string;
}

export type ReadResult =
  | { kind: "ok"; file: ProfileFile }
  | { kind: "not_json" }
  | { kind: "unsupported_version" }
  | { kind: "invalid"; issues: ImportIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An API issue (`profiles.<index>.<field>`) as the profile and field a person can read. */
export function toImportIssue(issue: Issue, parsed?: unknown): ImportIssue {
  const match = /^profiles\.(\d+)(?:\.(.*))?$/.exec(issue.path);
  if (!match) return { field: issue.path || "file", message: issue.message };
  const index = Number(match[1]);
  const entry =
    isRecord(parsed) && Array.isArray(parsed.profiles) ? parsed.profiles[index] : undefined;
  const name = isRecord(entry) && typeof entry.name === "string" ? entry.name : undefined;
  return {
    profile: issue.profile ?? name ?? `profile ${index + 1}`,
    field: match[2] || "profile",
    message: issue.message,
  };
}

/** `<profile name>: <field> — <message>` (T13). */
export function importIssueLine(issue: ImportIssue): string {
  return `${issue.profile ?? "file"}: ${issue.field} — ${issue.message}`;
}

/** Checks a file's text before anything is sent: JSON, then the version, then the schema. */
export function readImport(text: string): ReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "not_json" };
  }
  if (
    isRecord(parsed) &&
    typeof parsed.formatVersion === "number" &&
    parsed.formatVersion !== FORMAT_VERSION
  ) {
    return { kind: "unsupported_version" };
  }
  const result = profileFileSchema.safeParse(parsed);
  if (result.success) return { kind: "ok", file: result.data };
  return { kind: "invalid", issues: issuesFrom(result.error).map((i) => toImportIssue(i, parsed)) };
}
