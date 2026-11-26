// The scenes file (B-07 spec SD8, AC25; plan PD9, PD23, T10): `{ formatVersion: 1, scenes }`,
// exported from the scenes the server returns one by one (`scenes.get`) and assembled here, so a
// definition never reaches the screen's state. An imported file is data: it is read, checked
// against the shared schema and each scene's 128 KiB limit before anything is sent, and the server
// checks it again. It travels in parts that each fit one screen message (256 KiB).
import {
  issuesFrom,
  MAX_SCREEN_MESSAGE,
  SCENE_LIMITS,
  sceneFileSchema,
  sceneNameAt,
  toSceneFile,
  type SceneEntry,
  type SceneFile,
  type SceneIssue,
  type StoredScene,
} from "@djv/shared";

/** Room under the screen message's limit for the import message's own fields. */
const PART_BYTES = MAX_SCREEN_MESSAGE - 4096;

const utf8 = new TextEncoder();
const bytesOf = (value: unknown) => utf8.encode(JSON.stringify(value)).length;

/** `<name>.djv-scenes.json` for one scene (the profile file's slug), the bundle's name for more. */
export function sceneFileName(names: readonly string[]): string {
  if (names.length === 1) {
    const slug = names[0]!
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `${slug || "scene"}.djv-scenes.json`;
  }
  return "djv-scenes.djv-scenes.json";
}

export type ExportResult =
  | { kind: "ok"; text: string; fileName: string; count: number }
  | { kind: "empty" }
  | { kind: "failed" };

/** Every listed scene fetched by id, in list order; one that cannot be fetched fails the export. */
export async function exportScenes(
  list: readonly SceneEntry[],
  get: (id: string) => Promise<StoredScene | null>,
): Promise<ExportResult> {
  if (list.length === 0) return { kind: "empty" };
  const scenes: StoredScene[] = [];
  for (const { id } of list) {
    const scene = await get(id);
    if (!scene) return { kind: "failed" };
    scenes.push(scene);
  }
  return {
    kind: "ok",
    text: JSON.stringify(toSceneFile(scenes), null, 2),
    fileName: sceneFileName(scenes.map((s) => s.name)),
    count: scenes.length,
  };
}

/** One failing field of an import, naming the scene when there is one. */
export interface SceneImportIssue {
  scene?: string;
  field: string;
  message: string;
}

/** An issue path `scenes.<index>.<field>` (the file's or the server's) as a person reads it. */
export function toSceneImportIssue(issue: SceneIssue, parsed?: unknown): SceneImportIssue {
  const match = /^scenes\.(\d+)(?:\.(.*))?$/.exec(issue.path);
  if (!match) return { field: issue.path || "file", message: issue.message };
  return {
    scene: issue.scene ?? sceneNameAt(issue.path, parsed) ?? `scene ${Number(match[1]) + 1}`,
    field: match[2] || "scene",
    message: issue.message,
  };
}

/** `<scene name>: <field> — <message>`, the profile import's line. */
export function sceneIssueLine(issue: SceneImportIssue): string {
  return `${issue.scene ?? "file"}: ${issue.field} — ${issue.message}`;
}

export type SceneReadResult =
  | { kind: "ok"; file: SceneFile }
  | { kind: "not_json" }
  | { kind: "unsupported_version" }
  | { kind: "invalid"; issues: SceneImportIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** JSON, then the version, then the schema, then each scene's size (PD23). */
export function readSceneImport(text: string): SceneReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "not_json" };
  }
  if (isRecord(parsed) && parsed.formatVersion !== 1 && typeof parsed.formatVersion === "number") {
    return { kind: "unsupported_version" };
  }
  const result = sceneFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = issuesFrom(result.error).map((i) => toSceneImportIssue(i, parsed));
    return { kind: "invalid", issues };
  }
  const large = result.data.scenes.filter(
    ({ name: _name, ...definition }) => bytesOf(definition) > SCENE_LIMITS.definitionBytes,
  );
  if (large.length > 0) {
    const issues = large.map(({ name }) => ({
      scene: name,
      field: "scene",
      message: "larger than 128 KiB",
    }));
    return { kind: "invalid", issues };
  }
  return { kind: "ok", file: result.data };
}

/** The scenes in order, cut so each part's message stays under the screen socket's limit. */
export function importParts<T>(scenes: readonly T[]): T[][] {
  const parts: T[][] = [];
  let part: T[] = [];
  let size = 0;
  for (const scene of scenes) {
    const next = bytesOf(scene) + 1;
    if (part.length > 0 && size + next > PART_BYTES) {
      parts.push(part);
      part = [];
      size = 0;
    }
    part.push(scene);
    size += next;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}
