// The backup routine (B-12 SD10, SD11, AC31, PD25), one entry with three commands:
//   backup                 a consistent copy, checked, uploaded; all but the newest 14 deleted
//   snapshot --to <file>   the deploy's copy (PD23): kept at <file>, uploaded when configured
//   restore --latest       the newest copy downloaded, checked, and put in place of the database;
//                          the service must be stopped first (docs/runbooks/restore.md)
// It reads the environment through config.ts only. Success is one info line; a failure is one
// error line naming the step and exit 1. No line carries a key, the secret or a profile.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createBucket, type Bucket } from "./backup/bucket.ts";
import { integrityOk, snapshot } from "./backup/snapshot.ts";
import { DB_FILE } from "./boot.ts";
import { loadConfigFromProcess, type Config } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createLogger, fatal, type Logger } from "./log.ts";

const PREFIX = "djvisuals-";
const KEEP = 14;

class StepError extends Error {
  readonly step: string;
  constructor(step: string, reason: string) {
    super(reason);
    this.step = step;
  }
}

/** Runs `fn` as `step`: any throw becomes that step's failure, its message kept to the kind. */
async function step<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StepError) throw error;
    const reason = error instanceof Error && error.name === "BucketError" ? error.message : name;
    throw new StepError(name, reason);
  }
}

const objectName = (at: Date) => `${PREFIX}${at.toISOString().replace(/[:.]/g, "-")}.sqlite`;

function bucketOf(config: Config): Bucket | null {
  if (!config.backup) return null;
  return createBucket({
    ...config.backup,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
  });
}

function paths(config: Config) {
  const dataDir = resolve(config.DATA_DIR);
  return { database: join(dataDir, DB_FILE), backups: join(dataDir, "backups") };
}

/** A checked copy of the live database at `file`. */
async function takeCopy(database: string, file: string): Promise<void> {
  await step("open", () => {
    if (!existsSync(database)) throw new Error("no database");
  });
  await step("snapshot", () => {
    const db = openDatabase(database);
    try {
      snapshot(db, file);
    } finally {
      db.close();
    }
  });
  await step("check", () => {
    if (!integrityOk(file)) throw new Error("integrity_check failed");
  });
}

/** Uploads `file` as `name`, then deletes all but the newest `KEEP` copies. */
async function upload(bucket: Bucket, file: string, name: string): Promise<number> {
  const bytes = readFileSync(file);
  await step("upload", () => bucket.put(name, bytes));
  const keys = await step("prune", () => bucket.list(PREFIX));
  const old = keys.sort().slice(0, Math.max(0, keys.length - KEEP));
  await step("prune", async () => {
    for (const key of old) await bucket.delete(key);
  });
  return bytes.length;
}

async function backup(config: Config, log: Logger): Promise<void> {
  const bucket = await step("configuration", () => {
    const b = bucketOf(config);
    if (!b) throw new Error("backup not configured");
    return b;
  });
  const { database, backups } = paths(config);
  mkdirSync(backups, { recursive: true });
  const name = objectName(new Date());
  const file = join(backups, name);
  try {
    await takeCopy(database, file);
    const bytes = await upload(bucket, file, name);
    log.info({ object: name, bytes }, "backup written");
  } finally {
    rmSync(file, { force: true });
  }
}

async function snapshotTo(config: Config, log: Logger, target: string): Promise<void> {
  const { database } = paths(config);
  const file = resolve(target);
  await takeCopy(database, file);
  const bucket = bucketOf(config);
  if (!bucket) {
    log.warn("upload skipped: backup not configured");
    log.info({ file, bytes: readFileSync(file).length }, "snapshot written");
    return;
  }
  const name = objectName(new Date());
  const bytes = await upload(bucket, file, name);
  log.info({ file, object: name, bytes }, "snapshot written");
}

async function restoreLatest(config: Config, log: Logger): Promise<void> {
  const bucket = await step("configuration", () => {
    const b = bucketOf(config);
    if (!b) throw new Error("backup not configured");
    return b;
  });
  const { database, backups } = paths(config);
  mkdirSync(backups, { recursive: true });
  const keys = await step("list", () => bucket.list(PREFIX));
  const newest = keys.sort().at(-1);
  if (newest === undefined) throw new StepError("list", "no backup in the bucket");
  const file = join(backups, `restore-${newest}`);
  try {
    const bytes = await step("download", async () => {
      const got = await bucket.get(newest);
      if (!got) throw new Error("missing");
      return got;
    });
    writeFileSync(file, bytes);
    await step("check", () => {
      if (!integrityOk(file)) throw new Error("integrity_check failed");
    });
    await step("replace", () => {
      rmSync(`${database}-wal`, { force: true });
      rmSync(`${database}-shm`, { force: true });
      renameSync(file, database);
    });
    log.info({ object: newest }, "restore done");
  } finally {
    rmSync(file, { force: true });
  }
}

async function main(): Promise<void> {
  const config = loadConfigFromProcess();
  const log = createLogger(config.LOG_LEVEL);
  const [command, flag, value] = process.argv.slice(2);
  try {
    if (command === "backup" && flag === undefined) await backup(config, log);
    else if (command === "snapshot" && flag === "--to" && value) {
      await snapshotTo(config, log, value);
    } else if (command === "restore" && flag === "--latest") await restoreLatest(config, log);
    else throw new StepError("usage", "backup | snapshot --to <file> | restore --latest");
  } catch (error) {
    const failed =
      error instanceof StepError ? error : new StepError("unknown", "unexpected failure");
    log.error({ step: failed.step, reason: failed.message }, "backup failed");
    process.exit(1);
  }
}

main().catch(fatal);
