// The induced load for `pnpm check:load` (B-08 SD4, AC2): run a gate while two loads run beside
// it for the whole run, then stop both and hand back the gate's exit code.
//
// - CPU: busy-loops on ⌈availableParallelism / 2⌉ worker threads at normal priority.
// - A second headless Chromium with the gate's flags (`tests/browser/fixtures/launch.ts`),
//   rendering a started set on the built app (PD4), served by the server's own `boot()` in this
//   process on `port` with a temporary DATA_DIR (PD2): no child process to orphan, and the
//   environment is passed as an object, never read.
//
// A load that died during the run makes a green gate 1 (PD5). Everything started here is
// stopped in a `finally` and on SIGINT/SIGTERM (PD6); the gate is told through `signal`.
import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { chromium, type Browser, type Page } from "@playwright/test";
import { boot, type Booted } from "../server/src/boot.ts";
import { loadConfig } from "../server/src/config.ts";
import { chromiumArgs, VIEWPORT } from "../tests/browser/fixtures/launch.ts";
import { writeFakeMedia } from "../tests/browser/fixtures/media.ts";
import { canBind } from "./port-check.ts";

const root = resolve(import.meta.dirname, "..");

/** What the gate runs beside. The real gate ignores it; the harness's own test inspects it. */
export interface Load {
  workers: readonly Worker[];
  browser: Browser;
  page: Page;
  /** Aborted on SIGINT/SIGTERM: the gate should stop what it started. */
  signal: AbortSignal;
}

export interface UnderLoadOptions {
  port: number;
  /** Runs the gate and resolves with its exit code. */
  gate: (load: Load) => Promise<number>;
  log?: (line: string) => void;
}

export const LOAD_DIED = "load died: this run proves nothing";

const BUSY_LOOP = "for (;;) {}";

export async function runUnderLoad({
  port,
  gate,
  log = (line) => console.log(line),
}: UnderLoadOptions): Promise<number> {
  if (!(await canBind(port))) {
    throw new Error(
      `port ${port} is in use: the load needs 127.0.0.1:${port} for its own server. ` +
        `Find the process holding it and stop it, then run again.`,
    );
  }

  const controller = new AbortController();
  const dir = mkdtempSync(join(tmpdir(), "djv-load-"));
  const workers: Worker[] = [];
  const alive: boolean[] = [];
  let server: Booted | undefined;
  let browser: Browser | undefined;

  // A signal only aborts: start-up stops at its next step, the gate stops its child, and the
  // `finally` below tears down whatever exists by then. A second Ctrl-C gets Node's default.
  const onSignal = () => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const unlessInterrupted = () => {
    if (controller.signal.aborted) throw new Error("under-load: interrupted before the gate ran");
  };

  try {
    const config = loadConfig({
      APP_ENV: "test",
      LOG_LEVEL: "warn",
      APP_MODE: "local",
      PORT: String(port),
      // Never bound: nothing listens on it until External control is switched on (B-04 AC1).
      CONTROL_PORT: String(port + 2),
      DATA_DIR: join(dir, "data"),
    });
    server = await boot(config, {
      migrationsDir: resolve(root, "server/migrations"),
      staticDir: resolve(root, "web/dist"),
    });
    unlessInterrupted();

    const count = Math.ceil(availableParallelism() / 2);
    for (let i = 0; i < count; i++) {
      const worker = new Worker(BUSY_LOOP, { eval: true });
      alive.push(true);
      worker.once("exit", () => (alive[i] = false));
      worker.on("error", () => (alive[i] = false));
      workers.push(worker);
    }

    const media = writeFakeMedia(dir);
    // Playwright's own signal handlers close the browser and then exit the process, before the
    // `finally` below removes the temporary folder; the harness owns the teardown (PD6).
    browser = await chromium.launch({
      headless: true,
      args: chromiumArgs(media),
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
    unlessInterrupted();
    const page = await browser.newPage({ viewport: { ...VIEWPORT } });
    let crashed = false;
    page.on("crash", () => (crashed = true));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByTestId("panel").waitFor({ state: "detached" });
    unlessInterrupted();

    log(
      `under load: ${count} busy-loop worker thread(s) and a second Chromium rendering a ` +
        `started set from 127.0.0.1:${port}`,
    );

    let code = await gate({ workers, browser, page, signal: controller.signal });

    const intact = !crashed && !page.isClosed() && browser.isConnected() && alive.every((a) => a);
    if (!intact) {
      log(LOAD_DIED);
      if (code === 0) code = 1;
    }
    return code;
  } finally {
    const steps: (() => Promise<unknown>)[] = [
      () => Promise.all(workers.map((w) => w.terminate())),
      async () => browser?.close(),
      async () => server?.close(),
      async () => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        log(`under-load: teardown step failed: ${String(error)}`);
      }
    }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
