// The profile store (B-02 spec, Data; plan PD13): the only module with SQL for profiles. The
// name is a column (unique, case-insensitive, SD14); `definition` holds palette, dials and
// effects as JSON. Every row is validated on read: an unusable one is left out of the list and
// reported by `get`, never thrown (AC13).
import { nextFreeName, storedProfileSchema, type Profile, type StoredProfile } from "@djv/shared";
import { randomUUID } from "node:crypto";
import { isUniqueViolation, type Db } from "../db.ts";

interface Row {
  id: string;
  name: string;
  revision: number;
  definition: string;
  created_at: string;
  updated_at: string;
}

export type GetResult =
  { kind: "ok"; profile: StoredProfile } | { kind: "missing" } | { kind: "unusable" };

export type CreateResult = { kind: "ok"; profile: StoredProfile } | { kind: "name_taken" };

export type UpdateResult =
  | { kind: "ok"; profile: StoredProfile }
  | { kind: "missing" }
  | { kind: "stale"; current: StoredProfile }
  | { kind: "name_taken" }
  /** The revision moved on and the stored row fails the schema, so there is no "theirs". */
  | { kind: "unusable" };

export interface ProfileStore {
  list(): StoredProfile[];
  get(id: string): GetResult;
  create(profile: Profile): CreateResult;
  update(id: string, profile: Profile, revision: number): UpdateResult;
  remove(id: string): boolean;
  /** One transaction: every profile stored, renamed past taken names, or none (SD7). */
  importAll(profiles: readonly Profile[]): StoredProfile[];
}

const COLUMNS = "id, name, revision, definition, created_at, updated_at";

const definitionOf = ({ palette, dials, effects }: Profile) =>
  JSON.stringify({ palette, dials, effects });

export function createProfileStore(
  db: Db,
  log: { warn(fields: { id: string }, message: string): void },
  now: () => Date = () => new Date(),
): ProfileStore {
  const warned = new Set<string>();

  const fromRow = (row: Row): StoredProfile | null => {
    let definition: unknown;
    try {
      definition = JSON.parse(row.definition);
    } catch {
      return null;
    }
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;
    const parsed = storedProfileSchema.safeParse({
      ...definition,
      name: row.name,
      id: row.id,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    return parsed.success ? parsed.data : null;
  };

  const readRow = (id: string): Row | undefined =>
    db.all<Row>(`SELECT ${COLUMNS} FROM profiles WHERE id = ?`, id)[0];

  const insert = (profile: Profile): StoredProfile => {
    const id = randomUUID();
    const at = now().toISOString();
    db.run(
      `INSERT INTO profiles (${COLUMNS}) VALUES (?, ?, 1, ?, ?, ?)`,
      id,
      profile.name,
      definitionOf(profile),
      at,
      at,
    );
    return { ...profile, id, revision: 1, createdAt: at, updatedAt: at };
  };

  return {
    list() {
      const rows = db.all<Row>(`SELECT ${COLUMNS} FROM profiles ORDER BY name COLLATE NOCASE`);
      const profiles: StoredProfile[] = [];
      for (const row of rows) {
        const profile = fromRow(row);
        if (profile) {
          profiles.push(profile);
        } else if (!warned.has(row.id)) {
          warned.add(row.id);
          log.warn({ id: row.id }, "stored profile is unusable; left out of the list");
        }
      }
      return profiles;
    },

    get(id) {
      const row = readRow(id);
      if (!row) return { kind: "missing" };
      const profile = fromRow(row);
      return profile ? { kind: "ok", profile } : { kind: "unusable" };
    },

    create(profile) {
      try {
        return { kind: "ok", profile: insert(profile) };
      } catch (error) {
        if (isUniqueViolation(error)) return { kind: "name_taken" };
        throw error;
      }
    },

    update(id, profile, revision) {
      const at = now().toISOString();
      let changes: number;
      try {
        // One statement: the revision check and the write cannot be split (spec, edge cases).
        ({ changes } = db.run(
          `UPDATE profiles SET name = ?, definition = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
          profile.name,
          definitionOf(profile),
          at,
          id,
          revision,
        ));
      } catch (error) {
        if (isUniqueViolation(error)) return { kind: "name_taken" };
        throw error;
      }
      const row = readRow(id);
      if (!row) return { kind: "missing" };
      const stored = fromRow(row);
      if (changes === 0) return stored ? { kind: "stale", current: stored } : { kind: "unusable" };
      if (!stored) throw new Error(`profile ${id} unreadable right after its update`);
      return { kind: "ok", profile: stored };
    },

    remove(id) {
      return db.run("DELETE FROM profiles WHERE id = ?", id).changes > 0;
    },

    importAll(profiles) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const taken = db.all<{ name: string }>("SELECT name FROM profiles").map((r) => r.name);
        const stored = profiles.map((profile) => {
          const name = nextFreeName(profile.name, taken);
          taken.push(name);
          return insert({ ...profile, name });
        });
        db.exec("COMMIT");
        return stored;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
