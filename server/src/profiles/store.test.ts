// T4 (B-02 spec AC5, AC6, AC7, AC10, SD7, SD10, SD14, Data): the profile store on an
// in-memory database with the real migrations applied.
import type { Profile } from "@djv/shared";
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
