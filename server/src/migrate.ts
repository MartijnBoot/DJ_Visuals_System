// The migration runner (spec SD3, SD7): plain SQL files named NNNN_<slug>.sql, applied in name
// order, each in its own transaction together with its schema_migrations row. Forward-only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db.ts";
import type { Logger } from "./log.ts";

const NAME = /^(\d{4})_[^/\\]+\.sql$/;

export class MigrationError extends Error {
  readonly file: string;

  constructor(file: string, detail: string) {
    super(`migration ${file}: ${detail}`);
    this.name = "MigrationError";
    this.file = file;
  }
}

export interface MigrateResult {
  applied: string[];
  /** The number of the highest recorded migration, 0 when none (plan PD19). */
  schemaVersion: number;
}

function listMigrations(dir: string): string[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const seen = new Map<string, string>();
  for (const file of files) {
    const match = NAME.exec(file);
    if (!match) throw new MigrationError(file, "file name is not NNNN_<slug>.sql");
    const number = match[1]!;
    const other = seen.get(number);
    if (other) throw new MigrationError(file, `has the same number as ${other}`);
    seen.set(number, file);
  }
  return files;
}

function highestNumber(names: string[]): number {
  return names.reduce((max, name) => Math.max(max, Number(NAME.exec(name)?.[1] ?? 0)), 0);
}

export function migrate(db: Db, dir: string, log: Pick<Logger, "info">): MigrateResult {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const files = listMigrations(dir);

  // Always taken, even with nothing pending: a write lock held by another process fails boot
  // here, at once, with one line (plan PD8).
  db.exec("BEGIN IMMEDIATE");
  let recorded: string[];
  try {
    recorded = db.all<{ name: string }>("SELECT name FROM schema_migrations").map((r) => r.name);
  } finally {
    db.exec("COMMIT");
  }
  const done = new Set(recorded);

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.run(
        "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
        file,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new MigrationError(file, error instanceof Error ? error.message : String(error));
    }
    applied.push(file);
    log.info({ migration: file }, "migration applied");
  }

  return { applied, schemaVersion: highestNumber([...recorded, ...applied]) };
}
