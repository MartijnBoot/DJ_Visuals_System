// Deploy and rollback on the VM (B-12 SD7, AC28, AC30, PD23). Run by `infra/receive.sh`, the
// deploy user's forced command, from the release it has just unpacked:
//
//   node releases/<sha>/infra/deploy.ts --root /srv/djvisuals --release <sha> \
//     --env-file /etc/djvisuals/env --health-url http://127.0.0.1:<PORT>/api/health \
//     --restart "sudo systemctl restart djvisuals" --stop "sudo systemctl stop djvisuals" \
//     --start "sudo systemctl start djvisuals"
//
// Steps: (1) backup: the same routine as the nightly one, into backups/pre-<sha>.sqlite and the
// bucket; (2) migrate with the new release's migrate-cli while the old release runs; (3) switch
// `current` to the new release; (4) restart; (5) poll health for 30 s. A failure before (3)
// leaves the old release running and changes nothing; a failure at (4) or (5) switches back,
// restores pre-<sha>.sqlite with the service stopped and starts the old release. Every failure
// exits non-zero with one line naming the step. The last five releases stay on disk.
// Paths and commands are arguments; the environment reaches the child processes only through
// `node --env-file=`, read by server/src/config.ts (docs/invariants.md, the config boundary).
import { spawn } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface DeploySteps {
  /** A checked copy of the live database at `file` (and in the bucket), by `release`'s code. */
  snapshot(release: string, file: string): Promise<void>;
  /** Applies `release`'s pending migrations. */
  migrate(release: string): Promise<void>;
  /** Puts `file` in place of the database, by `release`'s code; the service is stopped. */
  restore(release: string, file: string): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  start(): Promise<void>;
  /** One health probe: true when the service answers ok. */
  healthy(): Promise<boolean>;
}

export interface DeployOptions {
  root: string;
  /** The release id: its folder under `releases/`. */
  release: string;
  steps: DeploySteps;
  healthTimeoutMs?: number;
  healthPollMs?: number;
  /** Releases kept on disk, the current one included. */
  keep?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export type DeployResult = { ok: true } | { ok: false; step: string; rolledBack: boolean };

export class StepFailed extends Error {
  readonly step: string;
  constructor(step: string, reason: string) {
    super(reason);
    this.step = step;
  }
}

const releasesOf = (root: string) => join(root, "releases");
const currentOf = (root: string) => join(root, "current");

/** The release folder `current` points to, or null before the first deploy. */
export function currentRelease(root: string): string | null {
  try {
    return resolve(readlinkSync(currentOf(root)));
  } catch {
    return null;
  }
}

/**
 * Points `current` at `target`: a new link made beside it, then renamed over it, so a reader
 * sees the old link or the new one (Linux). Windows refuses to rename over a junction, so there
 * the old link goes first; the gate on Windows checks the result only, and the VM is Linux.
 */
export function switchCurrent(root: string, target: string): void {
  const tmp = join(root, `.current-${process.pid}`);
  rmSync(tmp, { force: true });
  symlinkSync(resolve(target), tmp, "junction");
  try {
    renameSync(tmp, currentOf(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    unlinkSync(currentOf(root));
    renameSync(tmp, currentOf(root));
  }
}

async function attempt(step: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof StepFailed) throw error;
    throw new StepFailed(step, error instanceof Error ? error.message : String(error));
  }
}

async function waitHealthy(steps: DeploySteps, timeoutMs: number, pollMs: number) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await steps.healthy().catch(() => false)) return;
    if (Date.now() >= end) throw new StepFailed("health", `no healthy answer in ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Keeps the `keep` most recently deployed releases; never the current or the previous one. */
function prune(root: string, keep: number, spare: readonly string[]): void {
  const dir = releasesOf(root);
  const releases = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => ({ path: join(dir, e.name), at: statSync(join(dir, e.name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  for (const old of releases.slice(keep)) {
    if (!spare.includes(old.path)) rmSync(old.path, { recursive: true, force: true });
  }
}

export async function deploy(options: DeployOptions): Promise<DeployResult> {
  const { root, steps } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => Date.now());
  const release = resolve(releasesOf(root), options.release);
  const previous = currentRelease(root);
  const backup = join(root, "backups", `pre-${options.release}.sqlite`);

  try {
    await attempt("release", async () => {
      if (!existsSync(release)) throw new Error("release folder missing");
    });
    // (1) and (2): the old release keeps running; nothing has changed if either fails (AC30).
    // A copy left by an earlier failed attempt of this commit is stale: that attempt's migration
    // rolled itself back or its backup was restored, so the database now is the one to keep.
    await attempt("backup", async () => {
      rmSync(backup, { force: true });
      await steps.snapshot(release, backup);
    });
    await attempt("migrate", () => steps.migrate(release));
  } catch (error) {
    const step = error instanceof StepFailed ? error.step : "unknown";
    log(`deploy failed at ${step}: ${(error as Error).message}; the previous release still runs`);
    return { ok: false, step, rolledBack: false };
  }

  try {
    await attempt("switch", async () => switchCurrent(root, release));
    await attempt("restart", () => steps.restart());
    await waitHealthy(steps, options.healthTimeoutMs ?? 30_000, options.healthPollMs ?? 1000);
  } catch (error) {
    const step = error instanceof StepFailed ? error.step : "unknown";
    log(`deploy failed at ${step}: ${(error as Error).message}`);
    if (previous === null) {
      log("rollback impossible: no previous release");
      return { ok: false, step, rolledBack: false };
    }
    try {
      await attempt("rollback switch", async () => switchCurrent(root, previous));
      await attempt("rollback stop", () => steps.stop());
      if (existsSync(backup)) {
        await attempt("rollback restore", () => steps.restore(release, backup));
      }
      await attempt("rollback start", () => steps.start());
      log(`rolled back to ${basename(previous)}`);
    } catch (rollback) {
      const at = rollback instanceof StepFailed ? rollback.step : "rollback";
      log(`rollback failed at ${at}: ${(rollback as Error).message}`);
    }
    return { ok: false, step, rolledBack: true };
  }

  const at = new Date(now());
  utimesSync(release, at, at);
  prune(root, options.keep ?? 5, [release, ...(previous ? [previous] : [])]);
  log(`deployed ${options.release}`);
  return { ok: true };
}

/**
 * Runs a command without a shell; rejects with its exit code. `env`, when given, is the child's
 * whole environment; without it the child inherits this process's.
 */
export function run(
  command: string,
  args: readonly string[],
  env?: Record<string, string>,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
      ...(env === undefined ? {} : { env }),
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${basename(command)} exited ${code}`)),
    );
  });
}

/**
 * The steps that run the release's own CLIs with the env file (PD23). Each starts with an empty
 * environment: `--env-file` never overrides a variable already set, so an inherited one (the
 * gate exports .env.local; a stray one on the VM) would otherwise win over the env file.
 */
export function cliSteps(envFile: string): Pick<DeploySteps, "snapshot" | "migrate" | "restore"> {
  const node = (release: string, script: string, args: string[]) =>
    run(process.execPath, [`--env-file=${envFile}`, join(release, script), ...args], {});
  return {
    snapshot: (release, file) =>
      node(release, "server/src/backup-cli.ts", ["snapshot", "--to", file]),
    migrate: (release) => node(release, "server/src/migrate-cli.ts", []),
    restore: (release, file) =>
      node(release, "server/src/backup-cli.ts", ["restore", "--from", file]),
  };
}

const words = (command: string) => command.split(" ").filter((w) => w.length > 0);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      release: { type: "string" },
      "env-file": { type: "string" },
      "health-url": { type: "string" },
      restart: { type: "string" },
      stop: { type: "string" },
      start: { type: "string" },
    },
    strict: true,
  });
  const needed = ["root", "release", "env-file", "health-url", "restart", "stop", "start"] as const;
  const absent = needed.filter((name) => !values[name]);
  if (absent.length > 0) {
    console.log(`deploy failed at arguments: missing --${absent.join(", --")}`);
    process.exit(2);
  }
  const command = (line: string) => () => {
    const [head, ...rest] = words(line);
    return run(head!, rest);
  };
  const result = await deploy({
    root: resolve(values.root!),
    release: values.release!,
    steps: {
      ...cliSteps(resolve(values["env-file"]!)),
      restart: command(values.restart!),
      stop: command(values.stop!),
      start: command(values.start!),
      healthy: async () => {
        const response = await fetch(values["health-url"]!, { signal: AbortSignal.timeout(2000) });
        return (
          response.status === 200 &&
          ((await response.json()) as { status?: unknown }).status === "ok"
        );
      },
    },
  });
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  void main();
}
