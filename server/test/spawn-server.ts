// Spawns the real server entry as a child process with an explicit environment (never the
// test's own), collects its stdout as parsed JSON lines, and exposes waits on them.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "../..");
export const mainEntry = resolve(repoRoot, "server/src/main.ts");

export type LogLine = Record<string, unknown> & { level?: number; msg?: string };

export interface SpawnedServer {
  child: ChildProcess;
  /** Every stdout line so far, parsed. A line that is not JSON throws here. */
  lines(): LogLine[];
  stderr(): string;
  /** Resolves with the first line matching `pred`, or rejects after `timeoutMs`. */
  waitForLine(pred: (line: LogLine) => boolean, timeoutMs?: number): Promise<LogLine>;
  /** Resolves when the child has exited. */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill(): Promise<void>;
}

export interface SpawnOptions {
  entry?: string;
  args?: string[];
}

export function spawnServer(
  env: Record<string, string>,
  // The real entry runs API-only unless a test says otherwise: the gate builds web/dist only
  // in its build step, and these tests are about the server (plan PD10).
  { entry = mainEntry, args = entry === mainEntry ? ["--api-only"] : [] }: SpawnOptions = {},
): SpawnedServer {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  const listeners = new Set<() => void>();
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    stdout += chunk;
    for (const notify of listeners) notify();
  });
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    stderr += chunk;
  });
  let done = false;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res) => {
    child.on("exit", (code, signal) => {
      done = true;
      for (const notify of listeners) notify();
      res({ code, signal });
    });
  });

  const lines = (): LogLine[] =>
    stdout
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as LogLine;
        } catch {
          throw new Error(`stdout line is not JSON: ${l}`);
        }
      });

  return {
    child,
    lines,
    stderr: () => stderr,
    exited,
    waitForLine(pred, timeoutMs = 15_000) {
      return new Promise((res, rej) => {
        const check = () => {
          const hit = lines().find(pred);
          if (hit) {
            cleanup();
            res(hit);
          } else if (done) {
            cleanup();
            rej(new Error(`server exited before the line appeared; stdout:\n${stdout}\n${stderr}`));
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          rej(new Error(`timed out waiting for a line; stdout:\n${stdout}\n${stderr}`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          listeners.delete(check);
        };
        listeners.add(check);
        check();
      });
    },
    async kill() {
      if (!done) child.kill();
      await exited;
    },
  };
}

/** A port nothing listens on right now. */
export function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => res(port));
    });
  });
}

/** The four variables with test values; `undefined` removes one. Never reads the test's env. */
export function baseEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string | undefined> = {
    APP_ENV: "test",
    LOG_LEVEL: "info",
    PORT: "0",
    DATA_DIR: "",
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined),
  );
}
