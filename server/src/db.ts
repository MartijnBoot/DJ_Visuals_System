// The one file that imports `node:sqlite` (spec SD3): a driver change touches this file only.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export class Db {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    // Busy timeout 0: a write lock held elsewhere fails at once instead of waiting (plan PD8).
    this.#db = new DatabaseSync(path, { timeout: 0 });
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA foreign_keys = ON");
  }

  /** Runs one or more statements with no result. */
  exec(sql: string): void {
    this.#db.exec(sql);
  }

  /** Runs one statement; `changes` is how many rows it wrote (B-02 plan PD13). */
  run(sql: string, ...params: SQLInputValue[]): { changes: number } {
    return { changes: Number(this.#db.prepare(sql).run(...params).changes) };
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.#db.prepare(sql).all(...params) as T[];
  }

  /**
   * Runs `fn` inside `BEGIN IMMEDIATE` … `COMMIT`, or `ROLLBACK` when it throws (B-12 T3). Inside
   * a transaction already open it runs `fn` in that one, so writes compose into one commit.
   */
  transaction<T>(fn: () => T): T {
    if (this.#db.isTransaction) return fn();
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.#db.close();
  }
}

/** SQLite's extended result code for a UNIQUE constraint, stable across releases. */
const SQLITE_CONSTRAINT_UNIQUE = 2067;

/** Whether `error` is the driver reporting a UNIQUE constraint failure (not a primary key's). */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { errcode?: unknown }).errcode === SQLITE_CONSTRAINT_UNIQUE
  );
}

/** Opens (creating if absent) the file with WAL and foreign keys on. */
export function openDatabase(file: string): Db {
  return new Db(file);
}

export function openMemoryDatabase(): Db {
  return new Db(":memory:");
}
