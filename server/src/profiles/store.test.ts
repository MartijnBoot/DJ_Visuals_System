// T4 (B-02 spec AC5, AC6, AC7, AC10, SD7, SD10, SD14, Data): the profile store on an
// in-memory database with the real migrations applied.
import type { Profile, StoredProfile, SyncChange } from "@djv/shared";
import { resolve } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { openMemoryDatabase, type Db } from "../db.ts";
import { migrate } from "../migrate.ts";
import { createProfileStore, type ProfileStore } from "./store.ts";

const migrations = resolve(import.meta.dirname, "../../migrations");

const warm: Profile = {
  name: "Warm",
  palette: ["#1a0500", "#c2410c", "#fbbf24"],
  dials: { recognisability: 0.2, reactivity: 0.9 },
  effects: [
    { type: "paletteMap", amount: 1 },
    { type: "flash", amount: 0, binding: { feature: "beat", amount: 1 }, colourSlot: 2 },
    { type: "mirror", amount: 0.5, segments: 6 },
  ],
};

let db: Db;
type Warn = (fields: { id: string }, message: string) => void;
let warn: Mock<Warn>;
let clock: number;
let store: ProfileStore;

const definitionOf = ({ name: _n, ...rest }: Profile) => rest;

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db, migrations, pino({ level: "silent" }));
  warn = vi.fn<Warn>();
  clock = Date.parse("2026-11-12T10:00:00.000Z");
  store = createProfileStore(db, { warn }, () => new Date((clock += 1000)));
});

afterEach(() => db.close());

function created(profile: Profile = warm) {
  const result = store.create(profile);
  if (result.kind !== "ok") throw new Error(`create gave ${result.kind}`);
  return result.profile;
}

describe("create and get", () => {
  it("stores a profile at revision 1 with a uuid, and get returns it equal", () => {
    const stored = created();
    expect(stored).toMatchObject({ ...warm, revision: 1 });
    expect(stored.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(stored.createdAt).toBe("2026-11-12T10:00:01.000Z");
    expect(stored.updatedAt).toBe(stored.createdAt);
    expect(store.get(stored.id)).toEqual({ kind: "ok", profile: stored });
  });

  it("keeps the name in its column and only palette, dials and effects in definition", () => {
    const stored = created();
    const [row] = db.all<{ name: string; definition: string }>(
      "SELECT name, definition FROM profiles WHERE id = ?",
      stored.id,
    );
    expect(row?.name).toBe("Warm");
    expect(JSON.parse(row!.definition)).toEqual(definitionOf(warm));
  });

  it("stores primary in definition when set, and no primary key when absent (B-04 AC39)", () => {
    const marked = created({ ...warm, name: "Marked", primary: 1 });
    const plain = created();
    const definitions = db
      .all<{ id: string; definition: string }>("SELECT id, definition FROM profiles")
      .map((row) => [row.id, JSON.parse(row.definition) as Record<string, unknown>] as const);
    const byId = new Map(definitions);
    expect(byId.get(marked.id)).toEqual({ ...definitionOf(warm), primary: 1 });
    expect(byId.get(plain.id)).not.toHaveProperty("primary");
    expect(store.get(marked.id)).toEqual({ kind: "ok", profile: marked });
    expect(marked.primary).toBe(1);
    const updated = store.update(marked.id, { ...warm, name: "Marked", primary: 2 }, 1);
    expect(updated.kind === "ok" && updated.profile.primary).toBe(2);
  });

  it("refuses a second create with the name in another case (AC7)", () => {
    created();
    expect(store.create({ ...warm, name: "WARM" })).toEqual({ kind: "name_taken" });
    expect(store.list()).toHaveLength(1);
  });

  it("answers missing for an unknown id", () => {
    expect(store.get("nope")).toEqual({ kind: "missing" });
  });
});

describe("list", () => {
  it("orders by name, case-insensitively", () => {
    for (const name of ["beta", "Alpha", "gamma", "Delta"]) created({ ...warm, name });
    expect(store.list().map((p) => p.name)).toEqual(["Alpha", "beta", "Delta", "gamma"]);
  });

  it("skips a row broken by hand, warns once naming only its id, and get says unusable", () => {
    const good = created();
    const bad = created({ ...warm, name: "Broken" });
    db.run("UPDATE profiles SET definition = ? WHERE id = ?", '{"palette":["red"]}', bad.id);
    const notJson = created({ ...warm, name: "Not JSON" });
    db.run("UPDATE profiles SET definition = ? WHERE id = ?", "{nope", notJson.id);

    expect(store.list()).toEqual([good]);
    expect(store.list()).toEqual([good]);
    expect(warn).toHaveBeenCalledTimes(2);
    for (const [fields] of warn.mock.calls) {
      expect(Object.keys(fields as object)).toEqual(["id"]);
    }
    expect(warn.mock.calls.map(([f]) => (f as { id: string }).id).sort()).toEqual(
      [bad.id, notJson.id].sort(),
    );
    expect(store.get(bad.id)).toEqual({ kind: "unusable" });
    expect(store.get(notJson.id)).toEqual({ kind: "unusable" });
  });
});

describe("update (AC5, AC6, AC7)", () => {
  it("bumps the revision and updated_at only, and stores the new definition", () => {
    const stored = created();
    const edited: Profile = { ...warm, name: "Warmer", palette: ["#000000", "#ffffff"] };
    const result = store.update(stored.id, { ...edited, effects: [] }, 1);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.profile).toEqual({
      ...edited,
      effects: [],
      id: stored.id,
      revision: 2,
      createdAt: stored.createdAt,
      updatedAt: "2026-11-12T10:00:02.000Z",
    });
    expect(store.get(stored.id)).toEqual({ kind: "ok", profile: result.profile });
  });

  it("refuses an old revision as stale, with the current profile, and stores nothing", () => {
    const stored = created();
    const second = store.update(
      stored.id,
      { ...warm, palette: ["#000000", "#111111", "#222222"] },
      1,
    );
    expect(second.kind).toBe("ok");
    const current = second.kind === "ok" ? second.profile : undefined;
    expect(store.update(stored.id, { ...warm, name: "Mine" }, 1)).toEqual({
      kind: "stale",
      current,
    });
    expect(store.get(stored.id)).toEqual({ kind: "ok", profile: current });
  });

  it("refuses a rename onto a taken name in another case, and stores nothing", () => {
    created({ ...warm, name: "Cool" });
    const stored = created();
    expect(store.update(stored.id, { ...warm, name: "cool" }, 1)).toEqual({ kind: "name_taken" });
    expect(store.get(stored.id)).toEqual({ kind: "ok", profile: stored });
  });

  it("allows a rename to another case of its own name", () => {
    const stored = created();
    const result = store.update(stored.id, { ...warm, name: "WARM" }, 1);
    expect(result.kind === "ok" && result.profile.name).toBe("WARM");
  });

  it("answers missing for an unknown id", () => {
    expect(store.update("nope", warm, 1)).toEqual({ kind: "missing" });
  });
});

describe("remove", () => {
  it("deletes a stored profile once", () => {
    const stored = created();
    expect(store.remove(stored.id)).toBe(true);
    expect(store.remove(stored.id)).toBe(false);
    expect(store.get(stored.id)).toEqual({ kind: "missing" });
  });
});

describe("importAll (AC10, SD7, PD12)", () => {
  it("stores each with a new id and revision 1, renaming taken names", () => {
    const first = created();
    const imported = store.importAll([warm, warm, { ...warm, name: "Cool" }]);
    expect(imported.map((p) => p.name)).toEqual(["Warm (2)", "Warm (3)", "Cool"]);
    expect(imported.every((p) => p.revision === 1 && p.id !== first.id)).toBe(true);
    expect(new Set(imported.map((p) => p.id)).size).toBe(3);
    expect(store.list()).toHaveLength(4);
  });

  it("keeps a 60-character name within 60 when it renames it", () => {
    const long = "x".repeat(60);
    created({ ...warm, name: long });
    const [renamed] = store.importAll([{ ...warm, name: long }]);
    expect(renamed?.name).toBe(`${"x".repeat(56)} (2)`);
  });

  it("leaves the change counter unchanged when the third insert fails (B-12 T3)", () => {
    created();
    const before = counter();
    let calls = 0;
    const failing = createProfileStore(db, { warn }, () => {
      if (++calls === 3) throw new Error("disk full");
      return new Date();
    });
    expect(() =>
      failing.importAll([
        { ...warm, name: "A" },
        { ...warm, name: "B" },
        { ...warm, name: "C" },
      ]),
    ).toThrow("disk full");
    expect(counter()).toBe(before);
  });

  it("stores none when the third insert fails", () => {
    created();
    let calls = 0;
    const failing = createProfileStore(db, { warn }, () => {
      if (++calls === 3) throw new Error("disk full");
      return new Date();
    });
    expect(() =>
      failing.importAll([
        { ...warm, name: "A" },
        { ...warm, name: "B" },
        { ...warm, name: "C" },
      ]),
    ).toThrow("disk full");
    expect(store.list().map((p) => p.name)).toEqual(["Warm"]);
  });
});

// B-12 T3 (PD14, PD28, AC8, AC16): every write bumps the change counter and stamps its row in
// the same transaction; a delete leaves a tombstone where PD14 says; an update clears the
// conflict-copy mark.
function counter(): number {
  const [row] = db.all<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = 'change_counter'",
  );
  return Number(row!.value);
}

interface SyncRow {
  change_seq: number;
  cloud_revision: number | null;
  pushed_seq: number;
  conflict_copy: number;
}

function syncRow(id: string): SyncRow | undefined {
  return db.all<SyncRow>(
    "SELECT change_seq, cloud_revision, pushed_seq, conflict_copy FROM profiles WHERE id = ?",
    id,
  )[0];
}

interface Tombstone {
  id: string;
  name: string;
  revision: number;
  deleted_at: string;
  change_seq: number;
}

const tombstones = () =>
  db.all<Tombstone>("SELECT id, name, revision, deleted_at, change_seq FROM profile_tombstones");

describe("the change counter (B-12 T3, PD14)", () => {
  it("starts at 0 on a fresh database", () => {
    expect(counter()).toBe(0);
  });

  it("create, update, delete and import each raise it by one per row and stamp the row", () => {
    const a = created();
    expect(counter()).toBe(1);
    expect(syncRow(a.id)).toEqual({
      change_seq: 1,
      cloud_revision: null,
      pushed_seq: 0,
      conflict_copy: 0,
    });
    store.update(a.id, { ...warm, name: "Warmer" }, 1);
    expect(counter()).toBe(2);
    expect(syncRow(a.id)?.change_seq).toBe(2);
    const imported = store.importAll([
      { ...warm, name: "I1" },
      { ...warm, name: "I2" },
    ]);
    expect(counter()).toBe(4);
    expect(imported.map((p) => syncRow(p.id)?.change_seq)).toEqual([3, 4]);
    store.remove(a.id);
    expect(counter()).toBe(5);
  });

  it("is not raised by a refused write", () => {
    const a = created();
    created({ ...warm, name: "Cool" });
    const before = counter();
    expect(store.update(a.id, warm, 7).kind).toBe("stale");
    expect(store.update(a.id, { ...warm, name: "cool" }, 1)).toEqual({ kind: "name_taken" });
    expect(store.create({ ...warm, name: "COOL" })).toEqual({ kind: "name_taken" });
    expect(store.update("nope", warm, 1)).toEqual({ kind: "missing" });
    expect(store.remove("nope")).toBe(false);
    expect(counter()).toBe(before);
  });
});

describe("delete tombstones (B-12 T3, PD14)", () => {
  it("hosted: a delete writes a tombstone with the row's revision and the delete's counter", () => {
    const hosted = createProfileStore(db, { warn }, () => new Date((clock += 1000)), {
      mode: "hosted",
    });
    const a = created();
    hosted.update(a.id, warm, 1);
    expect(hosted.remove(a.id)).toBe(true);
    expect(tombstones()).toEqual([
      {
        id: a.id,
        name: "Warm",
        revision: 2,
        deleted_at: "2026-11-12T10:00:03.000Z",
        change_seq: 3,
      },
    ]);
  });

  it("local: a delete of a row that never matched the cloud writes none", () => {
    const a = created();
    expect(store.remove(a.id)).toBe(true);
    expect(tombstones()).toEqual([]);
    expect(counter()).toBe(2);
  });

  it("local: a delete of a row that matched the cloud writes one with its cloud revision", () => {
    const a = created();
    store.update(a.id, warm, 1);
    db.run("UPDATE profiles SET cloud_revision = 5 WHERE id = ?", a.id);
    expect(store.remove(a.id)).toBe(true);
    expect(tombstones()).toMatchObject([{ id: a.id, revision: 5, change_seq: 3 }]);
  });

  it("a delete whose tombstone insert throws leaves the row in place and the counter as it was", () => {
    const hosted = createProfileStore(db, { warn }, () => new Date(), { mode: "hosted" });
    const a = created();
    db.exec(
      "CREATE TRIGGER refuse BEFORE INSERT ON profile_tombstones BEGIN SELECT RAISE(ABORT, 'refused'); END",
    );
    expect(() => hosted.remove(a.id)).toThrow("refused");
    expect(store.get(a.id).kind).toBe("ok");
    expect(counter()).toBe(1);
  });
});

describe("the conflict-copy mark (B-12 T3, PD28)", () => {
  it("shows as conflictCopy: true only when set, and an update clears it", () => {
    const a = created();
    expect(store.get(a.id)).toEqual({ kind: "ok", profile: a });
    expect(a).not.toHaveProperty("conflictCopy");
    db.run("UPDATE profiles SET conflict_copy = 1 WHERE id = ?", a.id);
    const marked = store.get(a.id);
    expect(marked.kind === "ok" && marked.profile.conflictCopy).toBe(true);
    expect(store.list()[0]?.conflictCopy).toBe(true);
    const saved = store.update(a.id, warm, 1);
    expect(saved.kind === "ok" && saved.profile).not.toHaveProperty("conflictCopy");
    expect(syncRow(a.id)?.conflict_copy).toBe(0);
  });
});

// B-12 T6 (PD17, AC11–AC13, AC15, AC18): the cloud's side of sync, on a hosted store.
describe("the cloud's sync writes (B-12 T6, PD17)", () => {
  let cloud: ProfileStore;
  beforeEach(() => {
    cloud = createProfileStore(db, { warn }, () => new Date((clock += 1000)), { mode: "hosted" });
  });

  const put = (id: string, profile: Profile, base: number, copy = false) =>
    cloud.syncPut(id, profile, base, copy);
  const okProfile = (result: ReturnType<ProfileStore["syncPut"]>) => {
    if (result.kind !== "ok") throw new Error(`syncPut gave ${result.kind}`);
    return result.profile;
  };

  it("creates a new id at revision 1 when the base is 0", () => {
    const stored = okProfile(put("m-1", warm, 0));
    expect(stored).toMatchObject({ ...warm, id: "m-1", revision: 1 });
    expect(counter()).toBe(1);
  });

  it("updates when the base equals the revision, carrying the conflict-copy mark", () => {
    okProfile(put("m-1", warm, 0));
    const edited = okProfile(
      put("m-1", { ...warm, palette: ["#000000", "#ffffff", "#808080"] }, 1, true),
    );
    expect(edited).toMatchObject({
      revision: 2,
      palette: ["#000000", "#ffffff", "#808080"],
      conflictCopy: true,
    });
    expect(okProfile(put("m-1", warm, 2))).not.toHaveProperty("conflictCopy");
  });

  it("refuses a stale base with the current profile and writes nothing", () => {
    okProfile(put("m-1", warm, 0));
    const current = okProfile(
      put("m-1", { ...warm, palette: ["#000000", "#ffffff", "#808080"] }, 1),
    );
    const before = counter();
    expect(put("m-1", { ...warm, palette: ["#111111", "#222222", "#333333"] }, 1)).toEqual({
      kind: "stale",
      current,
    });
    expect(counter()).toBe(before);
  });

  it("answers a repeat of a push it already took with the current profile, not stale (AC16)", () => {
    const first = okProfile(put("m-1", warm, 0));
    expect(put("m-1", warm, 0)).toEqual({ kind: "ok", profile: first });
    const second = okProfile(
      put("m-1", { ...warm, palette: ["#000000", "#ffffff", "#808080"] }, 1),
    );
    expect(put("m-1", { ...warm, palette: ["#000000", "#ffffff", "#808080"] }, 1)).toEqual({
      kind: "ok",
      profile: second,
    });
  });

  it("names an arrival by nextFreeName when another id holds its name (AC15)", () => {
    okProfile(put("a", { ...warm, name: "Set" }, 0));
    expect(okProfile(put("b", { ...warm, name: "set" }, 0)).name).toBe("set (2)");
    // Its own name is never "taken" by itself.
    expect(okProfile(put("a", { ...warm, name: "Set" }, 1)).name).toBe("Set");
  });

  it("deletes at the current revision and leaves a tombstone (AC11)", () => {
    okProfile(put("m-1", warm, 0));
    expect(cloud.syncDelete("m-1", 1)).toEqual({ kind: "deleted" });
    expect(cloud.get("m-1")).toEqual({ kind: "missing" });
    expect(tombstones()).toMatchObject([{ id: "m-1", revision: 1 }]);
  });

  it("refuses a delete after an edit, returning the current profile (AC12)", () => {
    okProfile(put("m-1", warm, 0));
    const current = okProfile(
      put("m-1", { ...warm, palette: ["#000000", "#ffffff", "#808080"] }, 1),
    );
    expect(cloud.syncDelete("m-1", 1)).toEqual({ kind: "kept", current });
    expect(cloud.get("m-1").kind).toBe("ok");
  });

  it("answers a repeat delete as deleted, and an unknown id as missing (AC16)", () => {
    okProfile(put("m-1", warm, 0));
    cloud.syncDelete("m-1", 1);
    const before = counter();
    expect(cloud.syncDelete("m-1", 1)).toEqual({ kind: "deleted" });
    expect(counter()).toBe(before);
    expect(cloud.syncDelete("never", 3)).toEqual({ kind: "missing" });
  });

  it("restores a tombstoned id with the machine's edit, past the tombstone's revision (AC13)", () => {
    okProfile(put("m-1", warm, 0));
    okProfile(put("m-1", warm, 1)); // revision 2
    cloud.syncDelete("m-1", 2);
    const restored = okProfile(
      put("m-1", { ...warm, palette: ["#000000", "#ffffff", "#808080"] }, 1),
    );
    expect(restored).toMatchObject({
      id: "m-1",
      revision: 3,
      palette: ["#000000", "#ffffff", "#808080"],
    });
    expect(tombstones()).toEqual([]);
  });

  it("restores an id whose tombstone was purged, past the machine's base (AC18)", () => {
    const restored = okProfile(put("m-9", warm, 4));
    expect(restored).toMatchObject({ id: "m-9", revision: 5 });
  });

  it("purges tombstones older than the given time and records purged_through", () => {
    okProfile(put("old", warm, 0));
    okProfile(put("new", { ...warm, name: "New" }, 0));
    cloud.syncDelete("old", 1); // deleted_at at the clock's then
    const oldSeq = counter();
    clock += 91 * 24 * 3600 * 1000;
    cloud.syncDelete("new", 1);
    cloud.purgeTombstones(new Date(clock - 90 * 24 * 3600 * 1000));
    expect(tombstones().map((t) => t.id)).toEqual(["new"]);
    expect(cloud.purgedThrough()).toBe(oldSeq);
    cloud.purgeTombstones(new Date(clock - 90 * 24 * 3600 * 1000));
    expect(cloud.purgedThrough()).toBe(oldSeq);
  });
});

describe("the cloud's feed (B-12 T6, PD16, PD21)", () => {
  let cloud: ProfileStore;
  beforeEach(() => {
    cloud = createProfileStore(db, { warn }, () => new Date((clock += 1000)), { mode: "hosted" });
  });

  it("returns changes after the cursor in counter order, profiles and tombstones, paged", () => {
    for (let i = 0; i < 60; i += 1) cloud.syncPut(`p-${i}`, { ...warm, name: `P${i}` }, 0, false);
    cloud.syncDelete("p-0", 1);
    const first = cloud.changesSince(0, 50);
    expect(first.changes).toHaveLength(50);
    expect(first.more).toBe(true);
    expect(first.cursor).toBe(51);
    expect(first.changes.map((c) => c.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 2)); // p-0's row is gone: its tombstone comes last
    const second = cloud.changesSince(first.cursor, 50);
    expect(second.more).toBe(false);
    expect(second.changes.at(-1)).toEqual({ kind: "tombstone", seq: 61, id: "p-0", revision: 1 });
    expect(second.cursor).toBe(61);
    expect(cloud.changesSince(61, 50)).toEqual({ changes: [], cursor: 61, more: false });
  });

  it("leaves a profile the schema rejects out of the feed with one warn, and moves past it", () => {
    cloud.syncPut("good", warm, 0, false);
    cloud.syncPut("bad", { ...warm, name: "Bad" }, 0, false);
    db.run("UPDATE profiles SET definition = '{}' WHERE id = 'bad'");
    const page = cloud.changesSince(0, 50);
    expect(page.changes.map((c) => (c.kind === "profile" ? c.profile.id : c.id))).toEqual(["good"]);
    expect(page.cursor).toBe(2);
    cloud.changesSince(0, 50);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toEqual({ id: "bad" });
  });

  it("pages the whole set by id with the counter", () => {
    for (const id of ["c", "a", "b"]) cloud.syncPut(id, { ...warm, name: id }, 0, false);
    const first = cloud.fullPage("", 2);
    expect(first.profiles.map((p) => p.id)).toEqual(["a", "b"]);
    expect(first).toMatchObject({ counter: 3, more: true });
    const second = cloud.fullPage("b", 2);
    expect(second.profiles.map((p) => p.id)).toEqual(["c"]);
    expect(second.more).toBe(false);
  });
});

// B-12 T8 (PD2, PD15, PD16, AC11, AC13–AC16, AC18): the local side of sync in the store. No
// request is made here; the tests feed it what the cloud would answer.
describe("the local sync queue and its rules (B-12 T8)", () => {
  const cloud = (
    id: string,
    name: string,
    revision: number,
    extra: Partial<StoredProfile> = {},
  ): StoredProfile => ({
    ...warm,
    name,
    id,
    revision,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  });
  const change = (p: StoredProfile, seq: number): SyncChange => ({
    kind: "profile",
    seq,
    profile: p,
  });
  const gone = (id: string, revision: number, seq: number): SyncChange => ({
    kind: "tombstone",
    seq,
    id,
    revision,
  });
  const names = () => store.list().map((p) => p.name);
  const unsynced = () => store.pending().map((c) => `${c.kind} ${c.id}`);
  const okUpdate = (id: string, profile: Profile, revision: number) => {
    const result = store.update(id, profile, revision);
    if (result.kind !== "ok") throw new Error(`update gave ${result.kind}`);
    return result.profile;
  };
  const localRevision = (id: string) => {
    const got = store.get(id);
    if (got.kind !== "ok") throw new Error(`get gave ${got.kind}`);
    return got.profile.revision;
  };

  it("lists unsynced rows and local deletes in change order, with their cloud base", () => {
    const a = created({ ...warm, name: "A" });
    store.applyPull([change(cloud("s", "S", 4), 1), change(cloud("t", "T", 2), 2)], 2);
    const b = created({ ...warm, name: "B" });
    okUpdate("s", { ...warm, name: "S" }, localRevision("s"));
    store.remove("t");
    expect(store.pending()).toEqual([
      {
        kind: "put",
        id: a.id,
        seq: 1,
        baseRevision: 0,
        profile: { ...warm, name: "A" },
        conflictCopy: false,
      },
      {
        kind: "put",
        id: b.id,
        seq: 4,
        baseRevision: 0,
        profile: { ...warm, name: "B" },
        conflictCopy: false,
      },
      {
        kind: "put",
        id: "s",
        seq: 5,
        baseRevision: 4,
        profile: { ...warm, name: "S" },
        conflictCopy: false,
      },
      { kind: "delete", id: "t", seq: 6, baseRevision: 2 },
    ]);
  });

  it("a pulled profile with no local row is inserted, synced, and the cursor moves", () => {
    store.applyPull([change(cloud("c1", "Cloud one", 3), 7)], 7);
    expect(store.get("c1")).toMatchObject({ kind: "ok", profile: { name: "Cloud one" } });
    expect(store.pending()).toEqual([]);
    expect(store.cursor()).toBe(7);
  });

  it("a synced row is overwritten by the cloud copy; the local revision moves only on a change (PD15)", () => {
    store.applyPull([change(cloud("c1", "One", 1), 1)], 1);
    const before = store.get("c1");
    store.applyPull([change(cloud("c1", "One", 1), 1)], 1);
    expect(store.get("c1")).toEqual(before);
    const revision = localRevision("c1");
    store.applyPull([change(cloud("c1", "Renamed", 2), 2)], 2);
    expect(names()).toEqual(["Renamed"]);
    expect(localRevision("c1")).toBe(revision + 1);
    expect(store.pending()).toEqual([]);
  });

  it("an unsynced edit on the same cloud revision is kept, to be pushed", () => {
    store.applyPull([change(cloud("c1", "One", 1), 1)], 1);
    okUpdate("c1", { ...warm, name: "Mine" }, localRevision("c1"));
    store.applyPull([change(cloud("c1", "One", 1), 1)], 1);
    expect(names()).toEqual(["Mine"]);
    expect(unsynced()).toEqual(["put c1"]);
  });

  it("an unsynced edit against a newer cloud revision becomes a marked, unsynced copy X (2); the row takes the cloud version (AC14)", () => {
    store.applyPull([change(cloud("c1", "X", 1), 1)], 1);
    okUpdate("c1", { ...warm, name: "X", palette: ["#010101", "#020202", "#030303"] }, 1);
    const result = store.applyPull(
      [change(cloud("c1", "X", 2, { palette: ["#0a0a0a", "#0b0b0b", "#0c0c0c"] }), 2)],
      2,
    );
    expect(result.conflicts).toBe(1);
    const row = store.get("c1");
    expect(row.kind === "ok" && row.profile.palette).toEqual(["#0a0a0a", "#0b0b0b", "#0c0c0c"]);
    const copy = store.list().find((p) => p.id !== "c1")!;
    expect(copy).toMatchObject({ name: "X (2)", conflictCopy: true });
    expect(copy.palette).toEqual(["#010101", "#020202", "#030303"]);
    expect(unsynced()).toEqual([`put ${copy.id}`]);
    expect(store.pending()[0]).toMatchObject({ baseRevision: 0, conflictCopy: true });
    expect(store.conflictCount()).toBe(1);
  });

  it("an unsynced row that already equals the cloud copy is adopted, with no copy (a lost answer, AC16)", () => {
    const a = created({ ...warm, name: "A" });
    store.applyPull([change(cloud(a.id, "A", 1), 1)], 1);
    expect(store.list()).toHaveLength(1);
    expect(store.pending()).toEqual([]);
  });

  it("an unsynced local X against a cloud X of another id: the local one becomes X (2) (AC15)", () => {
    const local = created({ ...warm, name: "X" });
    store.applyPull([change(cloud("c1", "X", 1), 1)], 1);
    expect(store.get("c1")).toMatchObject({ kind: "ok", profile: { name: "X" } });
    expect(store.get(local.id)).toMatchObject({ kind: "ok", profile: { name: "X (2)" } });
    expect(unsynced()).toEqual([`put ${local.id}`]);
  });

  it("a cloud name swap of two synced rows applies with no copy and no unsynced row", () => {
    store.applyPull([change(cloud("a", "Left", 1), 1), change(cloud("b", "Right", 1), 2)], 2);
    store.applyPull([change(cloud("a", "Right", 2), 3), change(cloud("b", "Left", 2), 4)], 4);
    expect(store.list().map((p) => `${p.id}:${p.name}`)).toEqual(["b:Left", "a:Right"]);
    expect(store.pending()).toEqual([]);
    expect(store.conflictCount()).toBe(0);
  });

  it("a cloud tombstone deletes a synced row, writing no local tombstone (AC11)", () => {
    store.applyPull([change(cloud("c1", "One", 1), 1)], 1);
    store.applyPull([gone("c1", 1, 2)], 2);
    expect(store.get("c1")).toEqual({ kind: "missing" });
    expect(store.pending()).toEqual([]);
    expect(tombstones()).toEqual([]);
  });

  it("a cloud tombstone leaves an unsynced edit in place, to restore on push (AC13)", () => {
    store.applyPull([change(cloud("c1", "One", 1), 1)], 1);
    okUpdate("c1", { ...warm, name: "Edited" }, localRevision("c1"));
    store.applyPull([gone("c1", 1, 2)], 2);
    expect(names()).toEqual(["Edited"]);
    expect(store.pending()[0]).toMatchObject({ kind: "put", id: "c1", baseRevision: 1 });
  });

  it("a pending local delete keeps the row away while the cloud still has that revision", () => {
    store.applyPull([change(cloud("c1", "One", 1), 1)], 1);
    store.remove("c1");
    store.applyPull([change(cloud("c1", "One", 1), 1)], 1);
    expect(store.get("c1")).toEqual({ kind: "missing" });
    expect(unsynced()).toEqual(["delete c1"]);
  });

  it("a newer cloud revision beats a pending local delete: the row returns (SD8)", () => {
    store.applyPull([change(cloud("c1", "One", 1), 1)], 1);
    store.remove("c1");
    store.applyPull([change(cloud("c1", "One edited", 2), 2)], 2);
    expect(names()).toEqual(["One edited"]);
    expect(store.pending()).toEqual([]);
  });

  it("a pull that throws half-way leaves rows and cursor as before (AC16)", () => {
    store.applyPull([change(cloud("c1", "One", 1), 1)], 1);
    const before = store.list();
    db.exec(
      "CREATE TRIGGER refuse BEFORE INSERT ON profiles WHEN NEW.id = 'boom' BEGIN SELECT RAISE(ABORT, 'refused'); END",
    );
    expect(() =>
      store.applyPull(
        [change(cloud("c1", "Changed", 2), 2), change(cloud("boom", "Boom", 1), 3)],
        3,
      ),
    ).toThrow("refused");
    expect(store.list()).toEqual(before);
    expect(store.cursor()).toBe(1);
  });

  it("an acknowledged push marks the row synced and adopts the name the cloud gave it", () => {
    const a = created({ ...warm, name: "Set" });
    store.acknowledgePut(a.id, 1, cloud(a.id, "Set (2)", 1));
    expect(names()).toEqual(["Set (2)"]);
    expect(store.pending()).toEqual([]);
  });

  it("an acknowledgement after a newer local write leaves the row unsynced, on the new base", () => {
    const a = created({ ...warm, name: "A" });
    okUpdate(a.id, { ...warm, name: "A newer" }, 1);
    store.acknowledgePut(a.id, 1, cloud(a.id, "A", 1));
    expect(names()).toEqual(["A newer"]);
    expect(store.pending()).toMatchObject([{ kind: "put", id: a.id, baseRevision: 1 }]);
  });

  it("an acknowledgement for a row deleted meanwhile queues the delete at the cloud revision", () => {
    const a = created({ ...warm, name: "A" });
    store.remove(a.id);
    expect(store.pending()).toEqual([]);
    store.acknowledgePut(a.id, 1, cloud(a.id, "A", 1));
    expect(store.pending()).toMatchObject([{ kind: "delete", id: a.id, baseRevision: 1 }]);
  });

  it("a refused delete brings the cloud version back; a done one drops the tombstone (AC12)", () => {
    store.applyPull([change(cloud("c1", "One", 1), 1), change(cloud("c2", "Two", 1), 2)], 2);
    store.remove("c1");
    store.remove("c2");
    store.acknowledgeDelete("c1", cloud("c1", "One edited", 2));
    store.acknowledgeDelete("c2", null);
    expect(names()).toEqual(["One edited"]);
    expect(store.pending()).toEqual([]);
    expect(tombstones()).toEqual([]);
  });

  it("a stale push answer makes the copy and takes the cloud version (AC14)", () => {
    store.applyPull([change(cloud("c1", "X", 1), 1)], 1);
    okUpdate("c1", { ...warm, name: "X", dials: { recognisability: 0.1, reactivity: 0.1 } }, 1);
    store.conflict("c1", cloud("c1", "X", 2, { dials: { recognisability: 0.9, reactivity: 0.9 } }));
    expect(store.list().map((p) => [p.name, p.dials.reactivity, p.conflictCopy ?? false])).toEqual([
      ["X", 0.9, false],
      ["X (2)", 0.1, true],
    ]);
    expect(store.conflictCount()).toBe(1);
  });

  it("the mark leaves a copy saved once (PD28)", () => {
    store.applyPull([change(cloud("c1", "X", 1), 1)], 1);
    okUpdate("c1", { ...warm, name: "X", dials: { recognisability: 0.1, reactivity: 0.1 } }, 1);
    store.conflict("c1", cloud("c1", "X", 2));
    const copy = store.list().find((p) => p.conflictCopy)!;
    okUpdate(copy.id, { ...warm, name: "Kept" }, copy.revision);
    expect(store.conflictCount()).toBe(0);
  });

  it("applyFull turns every unsynced row into a marked copy, drops pending deletes and synced rows the cloud lacks (PD2, AC18)", () => {
    store.applyPull(
      [
        change(cloud("s1", "Synced kept", 1), 1),
        change(cloud("s2", "Synced gone", 1), 2),
        change(cloud("s3", "Deleted here", 1), 3),
      ],
      3,
    );
    okUpdate(
      "s1",
      { ...warm, name: "Synced kept", dials: { recognisability: 0.3, reactivity: 0.3 } },
      localRevision("s1"),
    );
    store.remove("s3");
    const local = created({ ...warm, name: "Local only" });
    store.applyFull(
      [cloud("s1", "Synced kept", 4), cloud("s3", "Deleted here", 1), cloud("n1", "New", 1)],
      40,
    );
    const byName = Object.fromEntries(store.list().map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(
      ["Deleted here", "Local only", "New", "Synced kept", "Synced kept (2)"].sort(),
    );
    expect(byName["Synced kept"]!.id).toBe("s1");
    expect(byName["Synced kept (2)"]).toMatchObject({ conflictCopy: true });
    expect(byName["Synced kept (2)"]!.dials.reactivity).toBe(0.3);
    expect(byName["Local only"]).toMatchObject({ conflictCopy: true });
    expect(byName["Local only"]!.id).not.toBe(local.id);
    expect(byName["Deleted here"]!.id).toBe("s3");
    expect(store.get("s2")).toEqual({ kind: "missing" });
    expect(store.pending().map((c) => c.kind)).toEqual(["put", "put"]);
    expect(tombstones()).toEqual([]);
    expect(store.cursor()).toBe(40);
  });
});
