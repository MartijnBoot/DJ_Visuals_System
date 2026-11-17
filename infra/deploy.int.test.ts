// B-12 T16 (AC28, AC30, SD7, PD23): deploy and rollback against a stand-in service. A temp root
// holds releases built from this repository's server (its own `server/src` and migrations, so a
// release can carry a migration of its own), a real SQLite file migrated by the real
// migrate-cli.ts, and an in-test HTTP server whose `/api/health` answers per the marker file in
// the release `current` points to. Restart, stop and start are injected and recorded.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../server/src/db.ts";
import { cliSteps, currentRelease, deploy, switchCurrent, type DeploySteps } from "./deploy.ts";

const repoRoot = resolve(import.meta.dirname, "..");

let tmp: string;
let root: string;
let envFile: string;
let database: string;
let service: Server | undefined;
let healthUrl: string;
let events: string[];
let logs: string[];

/** A release folder: the repository's server code, its health marker, any extra migration. */
function release(name: string, health: "ok" | "fail", migration?: [string, string]): string {
  const dir = join(root, "releases", name);
  mkdirSync(join(dir, "server"), { recursive: true });
  cpSync(join(repoRoot, "server", "src"), join(dir, "server", "src"), { recursive: true });
  cpSync(join(repoRoot, "server", "migrations"), join(dir, "server", "migrations"), {
    recursive: true,
  });
  cpSync(join(repoRoot, "server", "package.json"), join(dir, "server", "package.json"));
  symlinkSync(
    join(repoRoot, "server", "node_modules"),
    join(dir, "server", "node_modules"),
    "junction",
  );
  if (migration) writeFileSync(join(dir, "server", "migrations", migration[0]), migration[1]);
  writeFileSync(join(dir, "health.txt"), health);
  return dir;
}

function steps(): DeploySteps {
  return {
    ...cliSteps(envFile),
    restart: async () => void events.push(`restart ${basename(currentRelease(root)!)}`),
    stop: async () => void events.push("stop"),
    start: async () => void events.push(`start ${basename(currentRelease(root)!)}`),
    healthy: async () => {
      const response = await fetch(healthUrl);
      return response.status === 200;
    },
  };
}

const run = (name: string, now?: number) =>
  deploy({
    root,
    release: name,
    steps: steps(),
    healthTimeoutMs: 1500,
    healthPollMs: 100,
    log: (line) => void logs.push(line),
    ...(now === undefined ? {} : { now: () => now }),
  });

function tables(file: string): string[] {
  const db = openDatabase(file);
  try {
    return db
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .map((r) => r.name);
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "djv-deploy-"));
  root = join(tmp, "srv");
  mkdirSync(join(root, "releases"), { recursive: true });
  mkdirSync(join(root, "backups"));
  const dataDir = join(tmp, "data");
  database = join(dataDir, "djvisuals.sqlite");
  envFile = join(tmp, "env");
  writeFileSync(
    envFile,
    [
      "APP_ENV=test",
      "LOG_LEVEL=info",
      "APP_MODE=local",
      "PORT=8000",
      "CONTROL_PORT=8001",
      `DATA_DIR=${dataDir}`,
      "",
    ].join("\n"),
  );
  events = [];
  logs = [];
  // The running service: the old release, migrated, with one profile.
  const old = release("old", "ok");
  await cliSteps(envFile).migrate(old);
  switchCurrent(root, old);
  const db = openDatabase(database);
  db.run(
    "INSERT INTO profiles (id, name, revision, definition, created_at, updated_at) VALUES ('p', 'Kept', 1, '{}', 'x', 'x')",
  );
  db.close();
  service = createServer((_req, res) => {
    const current = currentRelease(root);
    const marker = current ? readFileSync(join(current, "health.txt"), "utf8") : "fail";
    res.statusCode = marker === "ok" ? 200 : 503;
    res.end(JSON.stringify({ status: marker }));
  });
  const listening = service;
  await new Promise<void>((r) => listening.listen(0, "127.0.0.1", r));
  const address = listening.address();
  healthUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
  // No time limit (B-08 PD18, as the project's testTimeout): this hook copies the server's code
  // and spawns a migration, and under the gate's parallel load ran past Vitest's default 10 s.
}, 0);

afterEach(async () => {
  // `service` is unset when beforeEach failed before it: the failure is that one, not this.
  const running = service;
  service = undefined;
  if (running) await new Promise<void>((r) => running.close(() => r()));
  rmSync(tmp, { recursive: true, force: true });
});

describe("a good release (AC28)", () => {
  it("switches current, restarts once, migrates, and keeps the old release on disk", async () => {
    release("new", "ok", ["0004_extra.sql", "CREATE TABLE extra (id INTEGER PRIMARY KEY);\n"]);
    expect(await run("new")).toEqual({ ok: true });
    expect(basename(currentRelease(root)!)).toBe("new");
    expect(existsSync(join(root, "releases", "old"))).toBe(true);
    expect(events).toEqual(["restart new"]);
    expect(tables(database)).toContain("extra");
    expect(existsSync(join(root, "backups", "pre-new.sqlite"))).toBe(true);
    expect(tables(join(root, "backups", "pre-new.sqlite"))).not.toContain("extra");
    expect(logs.at(-1)).toBe("deployed new");
  });
});

describe("a release whose health check fails (AC28)", () => {
  it("switches back, restores the pre-deploy copy with the service stopped, and names health", async () => {
    release("new", "fail", ["0004_extra.sql", "CREATE TABLE extra (id INTEGER PRIMARY KEY);\n"]);
    expect(await run("new")).toEqual({ ok: false, step: "health", rolledBack: true });
    expect(basename(currentRelease(root)!)).toBe("old");
    expect(events).toEqual(["restart new", "stop", "start old"]);
    expect(
      readFileSync(database).equals(readFileSync(join(root, "backups", "pre-new.sqlite"))),
    ).toBe(true);
    expect(tables(database)).not.toContain("extra");
    expect(logs[0]).toMatch(/^deploy failed at health: /);
    expect(logs.at(-1)).toBe("rolled back to old");
    expect((await fetch(healthUrl)).status).toBe(200);
  });
});

describe("a release whose migration fails (AC30)", () => {
  it("never moves current or restarts, and wrote the backup before the migration ran", async () => {
    release("new", "ok", ["0004_broken.sql", "INSERT INTO no_such_table (x) VALUES (1);\n"]);
    expect(await run("new")).toEqual({ ok: false, step: "migrate", rolledBack: false });
    expect(basename(currentRelease(root)!)).toBe("old");
    expect(events).toEqual([]);
    const backup = join(root, "backups", "pre-new.sqlite");
    expect(existsSync(backup)).toBe(true);
    const db = openDatabase(backup);
    try {
      expect(db.all("SELECT name FROM profiles")).toEqual([{ name: "Kept" }]);
    } finally {
      db.close();
    }
    expect(logs).toEqual([
      expect.stringMatching(/^deploy failed at migrate: .*; the previous release still runs$/),
    ]);
  });
});

describe("old releases (PD23)", () => {
  it("a sixth deploy prunes the oldest; five stay", async () => {
    const start = Date.now() + 60_000;
    for (let i = 1; i <= 6; i += 1) {
      release(`r${i}`, "ok");
      expect(await run(`r${i}`, start + i * 1000)).toEqual({ ok: true });
    }
    const left = ["old", "r1", "r2", "r3", "r4", "r5", "r6"].filter((name) =>
      existsSync(join(root, "releases", name)),
    );
    expect(left).toEqual(["r2", "r3", "r4", "r5", "r6"]);
    expect(basename(currentRelease(root)!)).toBe("r6");
  });
});

describe("a missing release folder", () => {
  it("fails at release and changes nothing", async () => {
    expect(await run("absent")).toEqual({ ok: false, step: "release", rolledBack: false });
    expect(basename(currentRelease(root)!)).toBe("old");
    expect(existsSync(join(root, "backups", "pre-absent.sqlite"))).toBe(false);
  });
});

describe("the env file is the only source of settings (PD23)", () => {
  it("a DATA_DIR in the deploying process's own environment never reaches the release's CLIs", async () => {
    // The gate exports .env.local into its own environment (scripts/check.sh); the VM's deploy
    // user could carry a stray variable too. Either must lose to the env file.
    const elsewhere = join(tmp, "elsewhere");
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { cliSteps } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "deploy.ts")).href)};
         await cliSteps(${JSON.stringify(envFile)}).migrate(${JSON.stringify(join(root, "releases", "old"))});`,
      ],
      { env: { DATA_DIR: elsewhere, APP_MODE: "hosted" }, encoding: "utf8" },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(existsSync(elsewhere)).toBe(false);
    expect(child.stdout).toContain('"msg":"migrations up to date"');
  });
});
