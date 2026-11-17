// The profile store (B-02 spec, Data; plan PD13): the only module with SQL for profiles. The
// name is a column (unique, case-insensitive, SD14); `definition` holds palette, dials and
// effects as JSON. Every row is validated on read: an unusable one is left out of the list and
// reported by `get`, never thrown (AC13).
// B-12 (PD14, PD28): every write bumps `app_meta.change_counter` and stamps the row's
// `change_seq` in the same transaction; a delete writes its tombstone in that transaction too
// (hosted: always; local: only for a row that ever matched the cloud); an update clears the
// conflict-copy mark.
import {
  nextFreeName,
  storedProfileSchema,
  type Profile,
  type StoredProfile,
  type SyncChange,
} from "@djv/shared";
import { randomUUID } from "node:crypto";
import { isUniqueViolation, type Db } from "../db.ts";

interface Row {
  id: string;
  name: string;
  revision: number;
  definition: string;
  created_at: string;
  updated_at: string;
  conflict_copy: number;
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

/** B-12 PD17: the cloud's answer to a machine's push. */
export type SyncPutResult =
  | { kind: "ok"; profile: StoredProfile }
  | { kind: "stale"; current: StoredProfile }
  /** The stored row fails the schema, so there is no "current" to send. */
  | { kind: "unusable" };

/** B-12 PD17: the cloud's answer to a machine's delete (AC12). */
export type SyncDeleteResult =
  | { kind: "deleted" }
  | { kind: "kept"; current: StoredProfile }
  | { kind: "missing" }
  | { kind: "unusable" };

export interface StoreOptions {
  /** Which side this store is (B-12 SD1): decides when a delete leaves a tombstone (PD14). */
  mode?: "local" | "hosted";
}

export interface ProfileStore {
  list(): StoredProfile[];
  get(id: string): GetResult;
  create(profile: Profile): CreateResult;
  update(id: string, profile: Profile, revision: number): UpdateResult;
  remove(id: string): boolean;
  /** One transaction: every profile stored, renamed past taken names, or none (SD7). */
  importAll(profiles: readonly Profile[]): StoredProfile[];

  // The cloud's side of sync (B-12 T6, PD17); each write is one transaction.
  /** Changes after `cursor` in counter order, at most `limit` (PD16, PD21). */
  changesSince(
    cursor: number,
    limit: number,
  ): { changes: SyncChange[]; cursor: number; more: boolean };
  /** The whole set after id `after`, at most `limit`, with the counter now (AC18). */
  fullPage(
    after: string,
    limit: number,
  ): { profiles: StoredProfile[]; counter: number; more: boolean };
  syncPut(id: string, profile: Profile, baseRevision: number, conflictCopy: boolean): SyncPutResult;
  syncDelete(id: string, baseRevision: number): SyncDeleteResult;
  /** Removes tombstones deleted before `olderThan`; `purgedThrough` keeps the highest counter. */
  purgeTombstones(olderThan: Date): void;
  purgedThrough(): number;
}

const COLUMNS = "id, name, revision, definition, created_at, updated_at";
const READ_COLUMNS = `${COLUMNS}, conflict_copy`;

/** `primary` only when set, so a row without it stays what B-02 wrote (B-04 AC39). */
const definitionOf = ({ palette, dials, effects, primary }: Profile) =>
  JSON.stringify({ palette, dials, effects, ...(primary === undefined ? {} : { primary }) });

export function createProfileStore(
  db: Db,
  log: { warn(fields: { id: string }, message: string): void },
  now: () => Date = () => new Date(),
  { mode = "local" }: StoreOptions = {},
): ProfileStore {
  const warned = new Set<string>();

  /** The counter the next write takes; it moves only through `setCounter`, inside a write's
   *  transaction, so a refused or rolled-back write leaves it as it was. */
  const nextSeq = (): number =>
    Number(
      db.all<{ value: string }>("SELECT value FROM app_meta WHERE key = 'change_counter'")[0]!
        .value,
    ) + 1;
  const setCounter = (seq: number) =>
    db.run("UPDATE app_meta SET value = ? WHERE key = 'change_counter'", String(seq));
  const takeSeq = (): number => {
    const seq = nextSeq();
    setCounter(seq);
    return seq;
  };

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
      ...(row.conflict_copy ? { conflictCopy: true } : {}),
    });
    return parsed.success ? parsed.data : null;
  };

  const meta = (key: string): number =>
    Number(db.all<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", key)[0]!.value);

  /** A row read for the feed that fails the schema: warned once by id, then skipped. */
  const usable = (row: Row): StoredProfile | null => {
    const profile = fromRow(row);
    if (!profile && !warned.has(row.id)) {
      warned.add(row.id);
      log.warn({ id: row.id }, "stored profile is unusable; left out of the list");
    }
    return profile;
  };

  const tombstoneOf = (id: string) =>
    db.all<{ revision: number }>("SELECT revision FROM profile_tombstones WHERE id = ?", id)[0];

  const namesBesides = (id: string): string[] =>
    db.all<{ name: string }>("SELECT name FROM profiles WHERE id <> ?", id).map((r) => r.name);

  const readRow = (id: string): Row | undefined =>
    db.all<Row>(`SELECT ${READ_COLUMNS} FROM profiles WHERE id = ?`, id)[0];

  /** Inside the caller's transaction. */
  const insert = (profile: Profile): StoredProfile => {
    const id = randomUUID();
    const at = now().toISOString();
    db.run(
      `INSERT INTO profiles (${COLUMNS}, change_seq) VALUES (?, ?, 1, ?, ?, ?, ?)`,
      id,
      profile.name,
      definitionOf(profile),
      at,
      at,
      takeSeq(),
    );
    return { ...profile, id, revision: 1, createdAt: at, updatedAt: at };
  };

  return {
    list() {
      const rows = db.all<Row>(`SELECT ${READ_COLUMNS} FROM profiles ORDER BY name COLLATE NOCASE`);
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
        return { kind: "ok", profile: db.transaction(() => insert(profile)) };
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
        // The counter moves only when it wrote; a save clears the conflict-copy mark (PD28).
        changes = db.transaction(() => {
          const seq = nextSeq();
          const written = db.run(
            `UPDATE profiles SET name = ?, definition = ?, revision = revision + 1, updated_at = ?,
               change_seq = ?, conflict_copy = 0
             WHERE id = ? AND revision = ?`,
            profile.name,
            definitionOf(profile),
            at,
            seq,
            id,
            revision,
          ).changes;
          if (written > 0) setCounter(seq);
          return written;
        });
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
      return removeRow(id);
    },

    importAll(profiles) {
      return db.transaction(() => {
        const taken = db.all<{ name: string }>("SELECT name FROM profiles").map((r) => r.name);
        return profiles.map((profile) => {
          const name = nextFreeName(profile.name, taken);
          taken.push(name);
          return insert({ ...profile, name });
        });
      });
    },
    changesSince(cursor, limit) {
      const rows = db.all<Row & { change_seq: number }>(
        `SELECT ${READ_COLUMNS}, change_seq FROM profiles WHERE change_seq > ?
         ORDER BY change_seq LIMIT ?`,
        cursor,
        limit + 1,
      );
      const tombstones = db.all<{ id: string; revision: number; change_seq: number }>(
        `SELECT id, revision, change_seq FROM profile_tombstones WHERE change_seq > ?
         ORDER BY change_seq LIMIT ?`,
        cursor,
        limit + 1,
      );
      const merged = [
        ...rows.map((row) => ({ seq: row.change_seq, row })),
        ...tombstones.map((tombstone) => ({ seq: tombstone.change_seq, tombstone })),
      ].sort((a, b) => a.seq - b.seq);
      const page = merged.slice(0, limit);
      const changes: SyncChange[] = [];
      for (const entry of page) {
        if ("tombstone" in entry) {
          const { id, revision } = entry.tombstone;
          changes.push({ kind: "tombstone", seq: entry.seq, id, revision });
        } else {
          const profile = usable(entry.row);
          if (profile) changes.push({ kind: "profile", seq: entry.seq, profile });
        }
      }
      return { changes, cursor: page.at(-1)?.seq ?? cursor, more: merged.length > limit };
    },

    fullPage(after, limit) {
      const rows = db.all<Row>(
        `SELECT ${READ_COLUMNS} FROM profiles WHERE id > ? ORDER BY id LIMIT ?`,
        after,
        limit + 1,
      );
      const profiles = rows.slice(0, limit).flatMap((row) => usable(row) ?? []);
      return { profiles, counter: meta("change_counter"), more: rows.length > limit };
    },

    syncPut(id, profile, baseRevision, conflictCopy) {
      return db.transaction((): SyncPutResult => {
        const row = readRow(id);
        const at = now().toISOString();
        const name = nextFreeName(profile.name, namesBesides(id));
        if (row && row.revision !== baseRevision) {
          const current = fromRow(row);
          if (!current) return { kind: "unusable" };
          // A repeat of a push the cloud already took, whose answer was lost: harmless (AC16).
          const repeat = row.name === profile.name && row.definition === definitionOf(profile);
          return repeat ? { kind: "ok", profile: current } : { kind: "stale", current };
        }
        if (row) {
          db.run(
            `UPDATE profiles SET name = ?, definition = ?, revision = revision + 1, updated_at = ?,
               change_seq = ?, conflict_copy = ?
             WHERE id = ?`,
            name,
            definitionOf(profile),
            at,
            takeSeq(),
            conflictCopy ? 1 : 0,
            id,
          );
        } else {
          // No row: a create (base 0), a restore past the tombstone, or past a base whose
          // tombstone was purged (AC13, AC18). An edit beats a delete.
          const tombstone = tombstoneOf(id);
          const revision =
            tombstone || baseRevision > 0
              ? Math.max(tombstone?.revision ?? 0, baseRevision) + 1
              : 1;
          db.run(
            `INSERT INTO profiles (${COLUMNS}, change_seq, conflict_copy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            name,
            revision,
            definitionOf(profile),
            at,
            at,
            takeSeq(),
            conflictCopy ? 1 : 0,
          );
          db.run("DELETE FROM profile_tombstones WHERE id = ?", id);
        }
        const stored = fromRow(readRow(id)!);
        if (!stored) throw new Error(`profile ${id} unreadable right after its sync write`);
        return { kind: "ok", profile: stored };
      });
    },

    syncDelete(id, baseRevision) {
      return db.transaction((): SyncDeleteResult => {
        const row = readRow(id);
        if (!row) return tombstoneOf(id) ? { kind: "deleted" } : { kind: "missing" };
        if (row.revision !== baseRevision) {
          const current = fromRow(row);
          return current ? { kind: "kept", current } : { kind: "unusable" };
        }
        removeRow(id);
        return { kind: "deleted" };
      });
    },

    purgeTombstones(olderThan) {
      db.transaction(() => {
        const cut = olderThan.toISOString();
        const [highest] = db.all<{ seq: number | null }>(
          "SELECT MAX(change_seq) AS seq FROM profile_tombstones WHERE deleted_at < ?",
          cut,
        );
        if (highest?.seq == null) return;
        db.run("DELETE FROM profile_tombstones WHERE deleted_at < ?", cut);
        if (highest.seq > meta("purged_through")) {
          db.run("UPDATE app_meta SET value = ? WHERE key = 'purged_through'", String(highest.seq));
        }
      });
    },

    purgedThrough: () => meta("purged_through"),
  };

  /** One transaction: the delete and, where PD14 says, its tombstone. */
  function removeRow(id: string): boolean {
    return db.transaction(() => {
      const [row] = db.all<{ name: string; revision: number; cloud_revision: number | null }>(
        "SELECT name, revision, cloud_revision FROM profiles WHERE id = ?",
        id,
      );
      if (!row) return false;
      const seq = takeSeq();
      // PD14: the cloud always records a delete; a local install only when the cloud ever
      // held the row, at the revision they last matched.
      const revision = mode === "hosted" ? row.revision : row.cloud_revision;
      if (revision !== null) {
        db.run(
          `INSERT OR REPLACE INTO profile_tombstones (id, name, revision, deleted_at, change_seq)
             VALUES (?, ?, ?, ?, ?)`,
          id,
          row.name,
          revision,
          now().toISOString(),
          seq,
        );
      }
      db.run("DELETE FROM profiles WHERE id = ?", id);
      return true;
    });
  }
}
