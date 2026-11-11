import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openMemoryDatabase, type Db } from "./db.ts";
import { MigrationError, migrate } from "./migrate.ts";

const log = pino({ level: "silent" });

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "djv-migrations-"));
  db = openMemoryDatabase();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, sql: string): void {
  writeFileSync(join(dir, name), sql);
}

function recorded(): string[] {
  return db
    .all<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name")
    .map((r) => r.name);
}

function tables(): string[] {
  return db
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .map((r) => r.name);
}

describe("migrate", () => {
  it("creates schema_migrations and reports version 0 with nothing to apply", () => {
    const result = migrate(db, dir, log);
    expect(result).toEqual({ applied: [], schemaVersion: 0 });
    expect(tables()).toEqual(["schema_migrations"]);
  });

  it("applies pending files in name order whatever the order on disk", () => {
    file(
      "0002_second.sql",
      "CREATE TABLE second (id INTEGER PRIMARY KEY, a INTEGER REFERENCES first(id));",
    );
    file("0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);");
    const result = migrate(db, dir, log);
    expect(result.applied).toEqual(["0001_first.sql", "0002_second.sql"]);
    expect(result.schemaVersion).toBe(2);
    expect(recorded()).toEqual(["0001_first.sql", "0002_second.sql"]);
    const [row] = db.all<{ applied_at: string }>("SELECT applied_at FROM schema_migrations");
    expect(row?.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it("skips files already recorded and applies only the new one", () => {
    file("0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);");
    migrate(db, dir, log);
    file("0002_second.sql", "CREATE TABLE second (id INTEGER PRIMARY KEY);");
    const result = migrate(db, dir, log);
    expect(result).toEqual({ applied: ["0002_second.sql"], schemaVersion: 2 });
    expect(migrate(db, dir, log)).toEqual({ applied: [], schemaVersion: 2 });
  });

  it("rolls a failing file back as one unit, keeps the earlier one, and names the file", () => {
    file("0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);");
    file(
      "0002_broken.sql",
      "CREATE TABLE partial (id INTEGER PRIMARY KEY);\nINSERT INTO nope (x) VALUES (1);",
    );
    let error: unknown;
    try {
      migrate(db, dir, log);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).file).toBe("0002_broken.sql");
    expect((error as MigrationError).message).toContain("0002_broken.sql");
    expect(tables()).toEqual(["first", "schema_migrations"]);
    expect(recorded()).toEqual(["0001_first.sql"]);
  });

  it("ignores files that are not .sql", () => {
    file("README.md", "# notes");
    file("0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);");
    expect(migrate(db, dir, log).applied).toEqual(["0001_first.sql"]);
  });

  it("refuses a .sql file that is not named NNNN_<slug>.sql, applying nothing", () => {
    file("0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);");
    file("notes.sql", "CREATE TABLE notes (id INTEGER PRIMARY KEY);");
    expect(() => migrate(db, dir, log)).toThrow(/notes\.sql/);
    expect(tables()).toEqual(["schema_migrations"]);
  });

  it("refuses two files with the same number, applying nothing", () => {
    file("0001_first.sql", "CREATE TABLE first (id INTEGER PRIMARY KEY);");
    file("0001_other.sql", "CREATE TABLE other (id INTEGER PRIMARY KEY);");
    expect(() => migrate(db, dir, log)).toThrow(/0001_other\.sql/);
    expect(tables()).toEqual(["schema_migrations"]);
  });
});
