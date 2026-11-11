// AC3, AC5, AC6, AC7 (lock), AC8 against the real entries and the fixture entries.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.ts";
import { baseEnv, freePort, repoRoot, spawnServer, type SpawnedServer } from "./spawn-server.ts";

const realMigrations = resolve(repoRoot, "server/migrations");
const migrateCli = resolve(repoRoot, "server/src/migrate-cli.ts");
const fixtures = resolve(repoRoot, "server/test/fixtures");

let tmp: string;
let dataDir: string;
const children: SpawnedServer[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "djv-migrate-"));
  dataDir = join(tmp, "data");
});

afterEach(async () => {
  await Promise.all(children.splice(0).map((c) => c.kill()));
  rmSync(tmp, { recursive: true, force: true });
});

function track(s: SpawnedServer): SpawnedServer {
  children.push(s);
  return s;
}

async function env(overrides: Record<string, string> = {}) {
  return baseEnv({ PORT: String(await freePort()), DATA_DIR: dataDir, ...overrides });
}

function appliedNames(s: SpawnedServer): string[] {
  return s
    .lines()
    .filter((l) => l.msg === "migration applied")
    .map((l) => String(l.migration));
}

function fatalLines(s: SpawnedServer) {
  return s.lines().filter((l) => l.level === 60);
}

function readRecorded(): string[] {
  const db = openDatabase(join(dataDir, "djvisuals.sqlite"));
  try {
    return db
      .all<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name")
      .map((r) => r.name);
  } finally {
    db.close();
  }
}

function readAppMeta(): Record<string, string> {
  const db = openDatabase(join(dataDir, "djvisuals.sqlite"));
  try {
    const rows = db.all<{ key: string; value: string }>("SELECT key, value FROM app_meta");
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } finally {
    db.close();
  }
}

/** A migrations folder with the real first file and a broken second one. */
function brokenMigrations(): string {
  const dir = join(tmp, "migrations");
  mkdirSync(dir);
  copyFileSync(join(realMigrations, "0001_init.sql"), join(dir, "0001_init.sql"));
  writeFileSync(join(dir, "0002_broken.sql"), "INSERT INTO no_such_table (x) VALUES (1);\n");
  return dir;
}

describe("migrations at boot (AC3, AC5, AC6)", () => {
  it("first boot applies 0001_init.sql and app_meta holds schema_created_at", async () => {
    const first = track(spawnServer(await env()));
    await first.waitForLine((l) => l.msg === "listening");
    expect(appliedNames(first)).toEqual(["0001_init.sql"]);
    await first.kill();
    expect(readRecorded()).toEqual(["0001_init.sql"]);
    expect(readAppMeta().schema_created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("second boot applies none and listens", async () => {
    const first = track(spawnServer(await env()));
    await first.waitForLine((l) => l.msg === "listening");
    await first.kill();
    const second = track(spawnServer(await env()));
    await second.waitForLine((l) => l.msg === "listening");
    expect(appliedNames(second)).toEqual([]);
  });

  it("a broken second migration fails boot with one line naming it; the first stays recorded; nothing listens", async () => {
    const dir = brokenMigrations();
    const s = track(
      spawnServer(await env(), { entry: join(fixtures, "boot-entry.ts"), args: [dir] }),
    );
    const { code } = await s.exited;
    expect(code).toBe(1);
    const fatal = fatalLines(s);
    expect(fatal).toHaveLength(1);
    expect(String(fatal[0]!.reason)).toContain("0002_broken.sql");
    expect(s.lines().filter((l) => l.msg === "listening")).toHaveLength(0);
    expect(readRecorded()).toEqual(["0001_init.sql"]);
  });
});

describe("a locked database (AC7)", () => {
  it("makes boot exit non-zero with one line, even with nothing pending (PD8)", async () => {
    // Migrate first: with every migration recorded, only the runner's always-taken
    // BEGIN IMMEDIATE can see the lock. On a fresh file the CREATE TABLE would fail first.
    const setup = track(spawnServer(await env(), { entry: migrateCli }));
    expect((await setup.exited).code).toBe(0);
    const holder = track(
      spawnServer(await env(), {
        entry: join(fixtures, "hold-lock.ts"),
        args: [join(dataDir, "djvisuals.sqlite")],
      }),
    );
    await holder.waitForLine((l) => l.msg === "holding write lock");
    const s = track(spawnServer(await env()));
    const { code } = await s.exited;
    expect(code).toBe(1);
    const fatal = fatalLines(s);
    expect(fatal).toHaveLength(1);
    expect(String(fatal[0]!.reason)).toMatch(/locked/i);
    expect(s.lines().filter((l) => l.msg === "listening")).toHaveLength(0);
  });
});

describe("pnpm migrate (AC8)", () => {
  it("applies pending migrations, then none, and never listens", async () => {
    const first = track(spawnServer(await env(), { entry: migrateCli }));
    expect((await first.exited).code).toBe(0);
    expect(appliedNames(first)).toEqual(["0001_init.sql"]);
    expect(first.lines().filter((l) => l.msg === "listening")).toHaveLength(0);
    expect(readAppMeta().schema_created_at).toBeDefined();

    const second = track(spawnServer(await env(), { entry: migrateCli }));
    expect((await second.exited).code).toBe(0);
    expect(appliedNames(second)).toEqual([]);
  });

  it("fails on a broken migration exactly as boot does", async () => {
    const dir = brokenMigrations();
    const s = track(
      spawnServer(await env(), { entry: join(fixtures, "migrate-entry.ts"), args: [dir] }),
    );
    expect((await s.exited).code).toBe(1);
    const fatal = fatalLines(s);
    expect(fatal).toHaveLength(1);
    expect(String(fatal[0]!.reason)).toContain("0002_broken.sql");
    expect(readRecorded()).toEqual(["0001_init.sql"]);
  });
});
