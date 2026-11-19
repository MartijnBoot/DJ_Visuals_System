// B-12 T15 (AC31, SD10): a consistent copy with VACUUM INTO, checked by PRAGMA integrity_check.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../db.ts";
import { integrityOk, snapshot } from "./snapshot.ts";

let dir: string;
let writer: Db;
let reader: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "djv-snapshot-"));
  const file = join(dir, "live.sqlite");
  writer = openDatabase(file);
  writer.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
  for (let i = 0; i < 200; i += 1) writer.run("INSERT INTO t (v) VALUES (?)", "x".repeat(200));
  reader = openDatabase(file);
});

afterEach(() => {
  writer.close();
  reader.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("snapshot", () => {
  it("takes a copy while another connection holds a write open; the copy opens and checks ok", () => {
    writer.exec("BEGIN IMMEDIATE");
    writer.run("INSERT INTO t (v) VALUES (?)", "uncommitted");
    const copy = join(dir, "copy.sqlite");
    snapshot(reader, copy);
    writer.exec("COMMIT");
    expect(integrityOk(copy)).toBe(true);
    const opened = openDatabase(copy);
    try {
      expect(opened.all("SELECT COUNT(*) AS n FROM t")).toEqual([{ n: 200 }]);
    } finally {
      opened.close();
    }
  });

  it("refuses to overwrite an existing file", () => {
    const copy = join(dir, "copy.sqlite");
    writeFileSync(copy, "something");
    expect(() => snapshot(reader, copy)).toThrow();
    expect(readFileSync(copy, "utf8")).toBe("something");
  });
});

describe("integrityOk", () => {
  it("fails a truncated copy", () => {
    const copy = join(dir, "copy.sqlite");
    snapshot(reader, copy);
    const bytes = readFileSync(copy);
    expect(statSync(copy).size).toBeGreaterThan(8192);
    writeFileSync(copy, bytes.subarray(0, Math.floor(bytes.length / 2)));
    expect(integrityOk(copy)).toBe(false);
  });

  it("fails a file that is not a database, and a missing one", () => {
    const copy = join(dir, "not.sqlite");
    writeFileSync(copy, "plain text, not sqlite at all".repeat(200));
    expect(integrityOk(copy)).toBe(false);
    expect(integrityOk(join(dir, "missing.sqlite"))).toBe(false);
  });
});
