// B-07 T2 (SD7, SD18, SD19, AC20, AC23, AC24, PD23): the scene store on an in-memory database
// with the real migrations applied.
import type { Effect, SceneDefinition } from "@djv/shared";
import { resolve } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { openMemoryDatabase, type Db } from "../db.ts";
import { migrate } from "../migrate.ts";
import { createSceneStore, type SceneStore } from "./store.ts";

const migrations = resolve(import.meta.dirname, "../../migrations");

const warm: SceneDefinition = {
  profile: {
    name: "Warm",
    palette: ["#1a0500", "#c2410c", "#fbbf24"],
    dials: { recognisability: 0.2, reactivity: 0.9 },
    effects: [{ type: "paletteMap", amount: 1 }],
  },
  dials: { recognisability: 0.4, reactivity: 0.6 },
  feed: { kind: "remote", hint: "Chrome on Android" },
  transition: { kind: "crossfade", duration: 2 },
};

let db: Db;
type Warn = (fields: { id: string }, message: string) => void;
let warn: Mock<Warn>;
let clock: number;
let store: SceneStore;

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db, migrations, pino({ level: "silent" }));
  warn = vi.fn<Warn>();
  clock = Date.parse("2026-11-26T10:00:00.000Z");
  store = createSceneStore(db, { warn }, () => new Date((clock += 1000)));
});

afterEach(() => db.close());

function saved(name: string, definition: SceneDefinition = warm) {
  const result = store.save(name, definition);
  if (result.kind !== "ok") throw new Error(`save gave ${result.kind}`);
  return result.scene;
}

const names = () => store.list().map((scene) => scene.name);
const count = () => db.all<{ n: number }>("SELECT COUNT(*) AS n FROM scenes")[0]!.n;

/** A definition whose JSON is exactly `bytes` UTF-8 bytes long, through custom effects' code. */
function sized(bytes: number): SceneDefinition {
  const effects = (codes: string[]): Effect[] =>
    codes.map((code, i) => ({
      type: "custom",
      label: `E${i}`,
      amount: 1,
      abstraction: false,
      params: [],
      code,
    }));
  const of = (codes: string[]): SceneDefinition => ({
    ...warm,
    profile: { ...warm.profile, effects: effects(codes) },
  });
  const empty = Array.from({ length: 12 }, () => "");
  let needed = bytes - Buffer.byteLength(JSON.stringify(of(empty)));
  const codes = empty.map(() => {
    // A quote is one byte of code and two of JSON; a space is one of each.
    const quotes = Math.min(8191, Math.floor(needed / 2));
    needed -= quotes * 2;
    const spaces = needed > 0 && quotes < 8192 ? 1 : 0;
    needed -= spaces;
    return '"'.repeat(quotes) + " ".repeat(spaces);
  });
  const definition = of(codes);
  expect(Buffer.byteLength(JSON.stringify(definition))).toBe(bytes);
  return definition;
}

describe("save, get and list", () => {
  it("stores a scene with an id and its times, and get returns it", () => {
    const scene = saved("  Warm crowd ");
    expect(scene).toMatchObject({ name: "Warm crowd", definition: warm });
    expect(scene.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(scene.createdAt).toBe("2026-11-26T10:00:01.000Z");
    expect(scene.updatedAt).toBe(scene.createdAt);
    expect(store.get(scene.id)).toEqual({ kind: "ok", scene });
    expect(store.get("nope")).toEqual({ kind: "missing" });
  });

  it("lists by name ignoring case (SD9)", () => {
    saved("booth");
    saved("Warm crowd");
    saved("Alley");
    expect(names()).toEqual(["Alley", "booth", "Warm crowd"]);
  });

  it("refuses a taken name in any case, an empty one and one of 61 characters (AC20)", () => {
    saved("Warm crowd");
    expect(store.save("WARM CROWD", warm)).toEqual({ kind: "name_taken" });
    expect(store.save("   ", warm)).toEqual({ kind: "invalid" });
    expect(store.save("x".repeat(61), warm)).toEqual({ kind: "invalid" });
    expect(count()).toBe(1);
  });

  it("refuses a definition the shared schema refuses (SD19)", () => {
    const bad = { ...warm, dials: { recognisability: 2, reactivity: 0 } } as SceneDefinition;
    expect(store.save("Bad", bad)).toEqual({ kind: "invalid" });
    expect(count()).toBe(0);
  });
});

describe("update, rename and remove", () => {
  it("update replaces the content and keeps id and name (AC21)", () => {
    const scene = saved("Warm crowd");
    const next = { ...warm, dials: { recognisability: 1, reactivity: 1 } };
    const result = store.update(scene.id, next);
    expect(result).toEqual({
      kind: "ok",
      scene: { ...scene, definition: next, updatedAt: "2026-11-26T10:00:02.000Z" },
    });
    expect(store.update("nope", next)).toEqual({ kind: "missing" });
  });

  it("rename takes a free name, refuses a taken one in any case, keeps the content", () => {
    const scene = saved("Warm crowd");
    saved("Booth");
    expect(store.rename(scene.id, "booth")).toEqual({ kind: "name_taken" });
    expect(store.rename(scene.id, "")).toEqual({ kind: "invalid" });
    const result = store.rename(scene.id, " Hot crowd ");
    expect(result).toMatchObject({ kind: "ok", scene: { id: scene.id, name: "Hot crowd" } });
    expect(store.rename("nope", "Other")).toEqual({ kind: "missing" });
    expect(names()).toEqual(["Booth", "Hot crowd"]);
  });

  it("rename to its own name in another case is allowed", () => {
    const scene = saved("Warm crowd");
    expect(store.rename(scene.id, "warm Crowd")).toMatchObject({ kind: "ok" });
  });

  it("remove deletes one row", () => {
    const scene = saved("Warm crowd");
    expect(store.remove(scene.id)).toEqual({ kind: "ok" });
    expect(store.remove(scene.id)).toEqual({ kind: "missing" });
    expect(names()).toEqual([]);
  });
});

describe("unusable rows (SD19, AC23)", () => {
  it("leaves out broken JSON and a failing definition with one warn per id, naming only it", () => {
    saved("Good");
    const insert = (id: string, name: string, definition: string) =>
      db.run(
        "INSERT INTO scenes (id, name, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        id,
        name,
        definition,
        "2026-11-26T10:00:00.000Z",
        "2026-11-26T10:00:00.000Z",
      );
    insert("broken", "Broken", "{not json");
    insert("failing", "Failing", JSON.stringify({ ...warm, dials: {} }));
    expect(names()).toEqual(["Good"]);
    expect(names()).toEqual(["Good"]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map(([fields]) => fields)).toEqual([
      { id: "broken" },
      { id: "failing" },
    ]);
    for (const [, message] of warn.mock.calls) expect(message).not.toMatch(/Broken|Failing/);
    expect(store.get("broken")).toEqual({ kind: "unusable" });
  });
});

describe("limits (SD18, PD23, AC24)", () => {
  it("takes a definition of 131 072 bytes and refuses 131 073", () => {
    expect(store.save("Fits", sized(131072))).toMatchObject({ kind: "ok" });
    expect(store.save("Too big", sized(131073))).toEqual({ kind: "too_large" });
    const fits = store.list()[0]!;
    expect(store.update(fits.id, sized(131073))).toEqual({ kind: "too_large" });
    expect(count()).toBe(1);
  });

  it("holds 200 scenes and refuses the 201st", () => {
    const two00 = Array.from({ length: 200 }, (_, i) => ({ name: `S${i}`, definition: warm }));
    expect(store.importAll(two00)).toMatchObject({ kind: "ok" });
    expect(store.save("One more", warm)).toEqual({ kind: "full" });
    expect(count()).toBe(200);
  });
});

describe("importAll (SD8, AC25)", () => {
  it("gives every scene a new id and a taken name the next free one", () => {
    const first = saved("Warm crowd");
    const result = store.importAll([
      { name: "Warm crowd", definition: warm },
      { name: "warm crowd", definition: warm },
      { name: "Booth", definition: warm },
    ]);
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.scenes.map((s) => s.name)).toEqual(["Warm crowd (2)", "warm crowd (3)", "Booth"]);
    expect(new Set([first.id, ...result.scenes.map((s) => s.id)]).size).toBe(4);
    expect(names()).toEqual(["Booth", "Warm crowd", "Warm crowd (2)", "warm crowd (3)"]);
  });

  it("stores nothing when one entry is bad, too large or the total passes 200", () => {
    const bad = {
      ...warm,
      transition: { kind: "spin", duration: 1 },
    } as unknown as SceneDefinition;
    expect(
      store.importAll([
        { name: "Good", definition: warm },
        { name: "Bad", definition: bad },
      ]),
    ).toEqual({ kind: "invalid" });
    expect(
      store.importAll([
        { name: "Good", definition: warm },
        { name: "Big", definition: sized(131073) },
      ]),
    ).toEqual({ kind: "too_large" });
    saved("Here");
    const two00 = Array.from({ length: 200 }, (_, i) => ({ name: `S${i}`, definition: warm }));
    expect(store.importAll(two00)).toEqual({ kind: "full" });
    expect(count()).toBe(1);
  });
});
