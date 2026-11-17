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

/** B-12 PD14, PD16: one unsynced change of a local install, in `seq` (change) order. */
export type PendingChange =
  | {
      kind: "put";
      id: string;
      seq: number;
      /** The cloud revision the row last matched; 0 when the cloud never held it. */
      baseRevision: number;
      profile: Profile;
      conflictCopy: boolean;
    }
  | { kind: "delete"; id: string; seq: number; baseRevision: number };

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

  // The local side of sync (B-12 T8, PD2, PD16); each write is one transaction, none a request.
  /** Unsynced rows and pending deletes, in change order (AC7). */
  pending(): PendingChange[];
  /** The cloud's changes, all applied with the new cursor, or none (AC16). */
  applyPull(changes: readonly SyncChange[], cursor: number): { conflicts: number };
  /** A full pull (AC18, PD2): every unsynced row becomes a marked copy; the cloud's set is all. */
  applyFull(profiles: readonly StoredProfile[], cursor: number): { conflicts: number };
  /** The cloud took the push of change `sentSeq`; a newer local write stays unsynced. */
  acknowledgePut(id: string, sentSeq: number, cloud: StoredProfile): void;
  /** The cloud deleted (`null`), or refused with its version (AC12). */
  acknowledgeDelete(id: string, current: StoredProfile | null): void;
  /** A push answered stale: the machine's version becomes a copy, the row the cloud's (AC14). */
  conflict(id: string, cloud: StoredProfile): void;
  cursor(): number;
  /** Profiles marked "Conflict copy" now (PD3). */
  conflictCount(): number;
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

  // ---- B-12 T8: the local side of sync ----
  interface SyncRow extends Row {
    change_seq: number;
    cloud_revision: number | null;
    pushed_seq: number;
  }
  const SYNC_COLUMNS = `${READ_COLUMNS}, change_seq, cloud_revision, pushed_seq`;
  /** A synced row waiting, inside one transaction, for the cloud change that names it. */
  const PLACEHOLDER = "\u0001";
  const placeholders = new Map<string, string>();

  const syncRow = (id: string): SyncRow | undefined =>
    db.all<SyncRow>(`SELECT ${SYNC_COLUMNS} FROM profiles WHERE id = ?`, id)[0];
  const isSynced = (row: SyncRow) =>
    row.cloud_revision !== null && row.change_seq <= row.pushed_seq;
  const allNames = (except?: string): string[] =>
    db
      .all<{ id: string; name: string }>("SELECT id, name FROM profiles")
      .filter((r) => r.id !== except)
      .map((r) => r.name);
  const sameContent = (row: Row, profile: Profile) =>
    row.name === profile.name && row.definition === definitionOf(profile);
  const profileOf = ({ name, palette, dials, effects, primary }: Profile): Profile => ({
    name,
    palette,
    dials,
    effects,
    ...(primary === undefined ? {} : { primary }),
  });
  const setCursor = (cursor: number) =>
    db.run("UPDATE app_meta SET value = ? WHERE key = 'sync_cursor'", String(cursor));

  /**
   * Moves any other row off `name` (SD9, AC15): an unsynced holder is the later arrival and gets
   * `nextFreeName`; a synced one waits under a placeholder for its own change in this batch.
   */
  const clearName = (name: string, forId: string) => {
    const holder = db.all<SyncRow>(
      `SELECT ${SYNC_COLUMNS} FROM profiles WHERE name = ? AND id <> ?`,
      name,
      forId,
    )[0];
    if (!holder) return;
    if (isSynced(holder)) {
      placeholders.set(holder.id, holder.name);
      db.run("UPDATE profiles SET name = ? WHERE id = ?", `${PLACEHOLDER}${holder.id}`, holder.id);
    } else {
      const free = nextFreeName(holder.name, [...allNames(holder.id), name]);
      db.run(
        "UPDATE profiles SET name = ?, change_seq = ? WHERE id = ?",
        free,
        takeSeq(),
        holder.id,
      );
    }
  };

  /** The cloud's `cloud` becomes the local row of its id, synced (PD15: the local revision
   *  moves only when the content does). */
  const takeCloud = (cloud: StoredProfile) => {
    const copy = cloud.conflictCopy ? 1 : 0;
    const row = syncRow(cloud.id);
    if (
      row &&
      isSynced(row) &&
      row.cloud_revision === cloud.revision &&
      row.conflict_copy === copy &&
      sameContent(row, cloud)
    ) {
      return;
    }
    clearName(cloud.name, cloud.id);
    placeholders.delete(cloud.id);
    const seq = takeSeq();
    if (!row) {
      db.run(
        `INSERT INTO profiles (${COLUMNS}, change_seq, cloud_revision, pushed_seq, conflict_copy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        cloud.id,
        cloud.name,
        cloud.revision,
        definitionOf(cloud),
        cloud.createdAt,
        cloud.updatedAt,
        seq,
        cloud.revision,
        seq,
        copy,
      );
      return;
    }
    const changed = !sameContent(row, cloud) || row.conflict_copy !== copy;
    db.run(
      `UPDATE profiles SET name = ?, definition = ?, revision = revision + ?, updated_at = ?,
         change_seq = ?, cloud_revision = ?, pushed_seq = ?, conflict_copy = ?
       WHERE id = ?`,
      cloud.name,
      definitionOf(cloud),
      changed ? 1 : 0,
      changed ? cloud.updatedAt : row.updated_at,
      seq,
      cloud.revision,
      seq,
      copy,
      cloud.id,
    );
  };

  /** AC14: the machine's version becomes a marked, unsynced copy; the row takes the cloud's. */
  const conflictWith = (row: SyncRow, cloud: StoredProfile) => {
    const mine = fromRow(row);
    takeCloud(cloud);
    if (!mine) return;
    const at = now().toISOString();
    db.run(
      `INSERT INTO profiles (${COLUMNS}, change_seq, conflict_copy) VALUES (?, ?, 1, ?, ?, ?, ?, 1)`,
      randomUUID(),
      nextFreeName(mine.name, allNames()),
      definitionOf(mine),
      at,
      at,
      takeSeq(),
    );
  };

  /** One change of the cloud's feed against the local rows (PD16); returns conflicts made. */
  const applyChange = (change: SyncChange): number => {
    if (change.kind === "tombstone") {
      const row = syncRow(change.id);
      if (row) {
        // A synced row goes; an unsynced edit stays and restores the profile on push (AC13).
        if (isSynced(row)) {
          db.run("DELETE FROM profiles WHERE id = ?", change.id);
          takeSeq();
        }
      } else {
        db.run("DELETE FROM profile_tombstones WHERE id = ?", change.id); // deleted on both
      }
      return 0;
    }
    const cloud = change.profile;
    const row = syncRow(cloud.id);
    if (!row) {
      const pendingDelete = tombstoneOf(cloud.id);
      if (pendingDelete && pendingDelete.revision >= cloud.revision) return 0; // the delete waits
      // An edit beats a delete (SD8).
      if (pendingDelete) db.run("DELETE FROM profile_tombstones WHERE id = ?", cloud.id);
      takeCloud(cloud);
      return 0;
    }
    // Synced, or already equal (a push whose answer was lost): the cloud's, as it is.
    if (isSynced(row) || sameContent(row, cloud)) {
      takeCloud(cloud);
      return 0;
    }
    if (row.cloud_revision !== null && row.cloud_revision >= cloud.revision) return 0; // to push
    conflictWith(row, cloud);
    return 1;
  };

  /** Ends a sync transaction: a synced row its batch never renamed takes a free name. */
  const settle = () => {
    for (const [id, wanted] of placeholders) {
      const row = syncRow(id);
      if (row?.name.startsWith(PLACEHOLDER)) {
        const name = nextFreeName(
          wanted,
          allNames(id).filter((n) => !n.startsWith(PLACEHOLDER)),
        );
        db.run("UPDATE profiles SET name = ?, change_seq = ? WHERE id = ?", name, takeSeq(), id);
      }
    }
    placeholders.clear();
  };

  /** One sync write: its own transaction, names settled before it commits. */
  const syncWrite = <T>(fn: () => T): T =>
    db.transaction(() => {
      placeholders.clear();
      const result = fn();
      settle();
      return result;
    });

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

    pending() {
      const rows = db.all<SyncRow>(
        `SELECT ${SYNC_COLUMNS} FROM profiles WHERE cloud_revision IS NULL OR change_seq > pushed_seq`,
      );
      const deletes = db.all<{ id: string; revision: number; change_seq: number }>(
        "SELECT id, revision, change_seq FROM profile_tombstones",
      );
      const changes: PendingChange[] = [];
      for (const row of rows) {
        const profile = fromRow(row);
        if (!profile) continue; // an unusable row cannot be sent; it stays as it is
        changes.push({
          kind: "put",
          id: row.id,
          seq: row.change_seq,
          baseRevision: row.cloud_revision ?? 0,
          profile: profileOf(profile),
          conflictCopy: row.conflict_copy === 1,
        });
      }
      for (const d of deletes) {
        changes.push({ kind: "delete", id: d.id, seq: d.change_seq, baseRevision: d.revision });
      }
      return changes.sort((a, b) => a.seq - b.seq);
    },

    applyPull(changes, cursor) {
      return syncWrite(() => {
        let conflicts = 0;
        for (const change of changes) conflicts += applyChange(change);
        setCursor(cursor);
        return { conflicts };
      });
    },

    applyFull(profiles, cursor) {
      return syncWrite(() => {
        const ids = new Set(profiles.map((p) => p.id));
        const moved: { id: string; wanted: string }[] = [];
        for (const row of db.all<SyncRow>(`SELECT ${SYNC_COLUMNS} FROM profiles`)) {
          if (isSynced(row)) {
            if (!ids.has(row.id)) db.run("DELETE FROM profiles WHERE id = ?", row.id);
            continue;
          }
          // PD2: every unsynced row steps aside as a copy under an id of its own.
          const id = randomUUID();
          db.run(
            `UPDATE profiles SET id = ?, name = ?, conflict_copy = 1, cloud_revision = NULL,
               pushed_seq = 0, change_seq = ?
             WHERE id = ?`,
            id,
            `${PLACEHOLDER}${id}`,
            takeSeq(),
            row.id,
          );
          moved.push({ id, wanted: row.name });
        }
        db.run("DELETE FROM profile_tombstones"); // unsynced deletes are dropped (PD2)
        for (const profile of profiles) takeCloud(profile);
        for (const { id, wanted } of moved) {
          db.run(
            "UPDATE profiles SET name = ? WHERE id = ?",
            nextFreeName(wanted, allNames(id)),
            id,
          );
        }
        setCursor(cursor);
        return { conflicts: moved.length };
      });
    },

    acknowledgePut(id, sentSeq, cloud) {
      syncWrite(() => {
        const row = syncRow(id);
        if (!row) {
          // Deleted here while the push was in flight: the delete follows, at the cloud's revision.
          const pendingDelete = tombstoneOf(id);
          if (!pendingDelete) {
            db.run(
              `INSERT INTO profile_tombstones (id, name, revision, deleted_at, change_seq)
               VALUES (?, ?, ?, ?, ?)`,
              id,
              cloud.name,
              cloud.revision,
              now().toISOString(),
              takeSeq(),
            );
          } else if (pendingDelete.revision < cloud.revision) {
            db.run("UPDATE profile_tombstones SET revision = ? WHERE id = ?", cloud.revision, id);
          }
          return;
        }
        if (row.change_seq === sentSeq) {
          takeCloud(cloud); // nothing newer here: the row is the cloud's, its name included
        } else {
          db.run(
            "UPDATE profiles SET cloud_revision = ?, pushed_seq = ? WHERE id = ?",
            cloud.revision,
            sentSeq,
            id,
          );
        }
      });
    },

    acknowledgeDelete(id, current) {
      syncWrite(() => {
        db.run("DELETE FROM profile_tombstones WHERE id = ?", id);
        if (current) takeCloud(current);
      });
    },

    conflict(id, cloud) {
      syncWrite(() => {
        const row = syncRow(id);
        if (!row) {
          db.run("DELETE FROM profile_tombstones WHERE id = ?", id); // an edit beats a delete
          takeCloud(cloud);
        } else if (sameContent(row, cloud)) {
          takeCloud(cloud);
        } else {
          conflictWith(row, cloud);
        }
      });
    },

    cursor: () => meta("sync_cursor"),

    conflictCount: () =>
      db.all<{ n: number }>("SELECT COUNT(*) AS n FROM profiles WHERE conflict_copy = 1")[0]!.n,
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
