// A consistent copy of the database (B-12 SD10, AC31, PD25): `VACUUM INTO` takes it inside one
// read transaction, so a writer on another connection neither blocks it nor leaks a half-done
// write into it. Shared by the nightly backup and the deploy's pre-migration copy.
import { existsSync } from "node:fs";
import { integrityCheckOk, type Db } from "../db.ts";

/** Writes a copy of `db` to `file`, which must not exist yet. */
export function snapshot(db: Db, file: string): void {
  if (existsSync(file)) throw new Error("snapshot target already exists");
  db.run("VACUUM INTO ?", file);
}

/** Whether `file` opens and `PRAGMA integrity_check` answers `ok`. */
export const integrityOk = (file: string): boolean => existsSync(file) && integrityCheckOk(file);
