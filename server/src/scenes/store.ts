// The scene store (B-07 spec SD7, SD18, SD19; plan PD23): the only module with SQL for scenes.
// The name is a column (unique ignoring case); `definition` holds the scene's JSON. Every
// definition is validated on write and on read: an unusable row is left out of the list with one
// `warn` naming its id, and reported by `get`, never thrown (as profiles are, AC23). No sync.
import {
  SCENE_LIMITS,
  nextFreeName,
  sceneDefinitionSchema,
  sceneNameSchema,
  storedSceneSchema,
  type SceneDefinition,
  type StoredScene,
} from "@djv/shared";
import { randomUUID } from "node:crypto";
import { isUniqueViolation, type Db } from "../db.ts";

interface Row {
  id: string;
  name: string;
  definition: string;
  created_at: string;
  updated_at: string;
}

export type SceneGetResult =
  { kind: "ok"; scene: StoredScene } | { kind: "missing" } | { kind: "unusable" };

/** Why a write stored nothing. */
export type SceneRefusal = "name_taken" | "missing" | "too_large" | "full" | "invalid";

export type SceneWriteResult = { kind: "ok"; scene: StoredScene } | { kind: SceneRefusal };

export interface SceneStore {
  list(): StoredScene[];
  get(id: string): SceneGetResult;
  save(name: string, definition: SceneDefinition): SceneWriteResult;
  /** Replaces the content; keeps id and name (SD9). */
  update(id: string, definition: SceneDefinition): SceneWriteResult;
  rename(id: string, name: string): SceneWriteResult;
  remove(id: string): { kind: "ok" } | { kind: "missing" };
  /** One transaction: every scene stored under a free name and a new id, or none (SD8). */
  importAll(
    entries: readonly { name: string; definition: SceneDefinition }[],
  ): { kind: "ok"; scenes: StoredScene[] } | { kind: "too_large" | "full" | "invalid" };
}

const COLUMNS = "id, name, definition, created_at, updated_at";

/** The definition as stored, or why it cannot be. */
function encode(definition: unknown): { json: string } | { kind: "invalid" | "too_large" } {
  const parsed = sceneDefinitionSchema.safeParse(definition);
  if (!parsed.success) return { kind: "invalid" };
  const json = JSON.stringify(parsed.data);
  return Buffer.byteLength(json) > SCENE_LIMITS.definitionBytes ? { kind: "too_large" } : { json };
}

export function createSceneStore(
  db: Db,
  log: { warn(fields: { id: string }, message: string): void },
  now: () => Date = () => new Date(),
): SceneStore {
  const warned = new Set<string>();

  const fromRow = (row: Row): StoredScene | null => {
    let definition: unknown;
    try {
      definition = JSON.parse(row.definition);
    } catch {
      return null;
    }
    const parsed = storedSceneSchema.safeParse({
      id: row.id,
      name: row.name,
      definition,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return parsed.success ? parsed.data : null;
  };

  const readRow = (id: string): Row | undefined =>
    db.all<Row>(`SELECT ${COLUMNS} FROM scenes WHERE id = ?`, id)[0];

  const count = (): number => db.all<{ n: number }>("SELECT COUNT(*) AS n FROM scenes")[0]!.n;

  /** Reads back a row just written; it was validated on the way in. */
  const reread = (id: string): StoredScene => {
    const scene = fromRow(readRow(id)!);
    if (!scene) throw new Error(`scene ${id} unreadable right after its write`);
    return scene;
  };

  /** Inside the caller's transaction. */
  const insert = (name: string, json: string): string => {
    const id = randomUUID();
    const at = now().toISOString();
    db.run(`INSERT INTO scenes (${COLUMNS}) VALUES (?, ?, ?, ?, ?)`, id, name, json, at, at);
    return id;
  };

  /** Runs a write, turning the name column's UNIQUE failure into `name_taken`. */
  const unique = (write: () => SceneWriteResult): SceneWriteResult => {
    try {
      return write();
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: "name_taken" };
      throw error;
    }
  };

  return {
    list() {
      const rows = db.all<Row>(`SELECT ${COLUMNS} FROM scenes ORDER BY name COLLATE NOCASE`);
      const scenes: StoredScene[] = [];
      for (const row of rows) {
        const scene = fromRow(row);
        if (scene) {
          scenes.push(scene);
        } else if (!warned.has(row.id)) {
          warned.add(row.id);
          log.warn({ id: row.id }, "stored scene is unusable; left out of the list");
        }
      }
      return scenes;
    },

    get(id) {
      const row = readRow(id);
      if (!row) return { kind: "missing" };
      const scene = fromRow(row);
      return scene ? { kind: "ok", scene } : { kind: "unusable" };
    },

    save(rawName, definition) {
      const name = sceneNameSchema.safeParse(rawName);
      if (!name.success) return { kind: "invalid" };
      const encoded = encode(definition);
      if (!("json" in encoded)) return encoded;
      return unique(() =>
        db.transaction(() => {
          if (count() >= SCENE_LIMITS.scenes) return { kind: "full" };
          return { kind: "ok", scene: reread(insert(name.data, encoded.json)) };
        }),
      );
    },

    update(id, definition) {
      const encoded = encode(definition);
      if (!("json" in encoded)) return encoded;
      const { changes } = db.run(
        "UPDATE scenes SET definition = ?, updated_at = ? WHERE id = ?",
        encoded.json,
        now().toISOString(),
        id,
      );
      return changes === 0 ? { kind: "missing" } : { kind: "ok", scene: reread(id) };
    },

    rename(id, rawName) {
      const name = sceneNameSchema.safeParse(rawName);
      if (!name.success) return { kind: "invalid" };
      return unique(() => {
        const { changes } = db.run(
          "UPDATE scenes SET name = ?, updated_at = ? WHERE id = ?",
          name.data,
          now().toISOString(),
          id,
        );
        return changes === 0 ? { kind: "missing" } : { kind: "ok", scene: reread(id) };
      });
    },

    remove(id) {
      return db.run("DELETE FROM scenes WHERE id = ?", id).changes === 0
        ? { kind: "missing" }
        : { kind: "ok" };
    },

    importAll(entries) {
      const encoded: { name: string; json: string }[] = [];
      for (const entry of entries) {
        const name = sceneNameSchema.safeParse(entry.name);
        if (!name.success) return { kind: "invalid" };
        const definition = encode(entry.definition);
        if (!("json" in definition)) return definition;
        encoded.push({ name: name.data, json: definition.json });
      }
      return db.transaction(() => {
        if (count() + encoded.length > SCENE_LIMITS.scenes) return { kind: "full" as const };
        const taken = db.all<{ name: string }>("SELECT name FROM scenes").map((r) => r.name);
        const ids = encoded.map(({ name, json }) => {
          const free = nextFreeName(name, taken);
          taken.push(free);
          return insert(free, json);
        });
        return { kind: "ok" as const, scenes: ids.map(reread) };
      });
    },
  };
}
