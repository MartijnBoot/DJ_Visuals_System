// The browser check (spec SD9, AC10 to AC13): Chromium only, headless, software WebGL, against
// `pnpm start` (the built app served by the one Node process), never the Vite dev server.
// The server always starts fresh on its own port with a temporary DATA_DIR; all five variables
// are passed here, so nothing comes from .env.local (the process environment wins over it).
// Nothing listens on CONTROL_PORT until External control is switched on (B-04 AC1); the
// External control specs boot their own server (B-04 PD13).
// B-01 (SD17): Chromium's fake camera and microphones, fed by fixtures generated into the same
// temporary directory, and a smaller viewport to keep software WebGL stable. The port, the
// viewport and the flags live in `tests/browser/fixtures/launch.ts`, shared with the load
// harness (B-08 PD3).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { chromiumArgs, GATE_PORT, VIEWPORT } from "./tests/browser/fixtures/launch.ts";
import { writeFakeMedia } from "./tests/browser/fixtures/media.ts";

const PORT = GATE_PORT;
const CONTROL_PORT = 8125;
const dataDir = mkdtempSync(join(tmpdir(), "djv-browser-"));
const media = writeFakeMedia(dataDir);

export default defineConfig({
  testDir: "tests/browser",
  // No per-test time limit (B-08 PD18): no test asserts its own duration, and under load the
  // longest ones ran past 30 s with no assertion failed. The waits that are assertions keep
  // their own `timeout`. The cost: a hang, such as a locator waiting for an element that never
  // appears, runs to the CI job's limit instead of failing at 30 s.
  timeout: 0,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { ...VIEWPORT },
        launchOptions: { args: chromiumArgs(media) },
      },
    },
  ],
  webServer: {
    command: "pnpm start",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      APP_ENV: "test",
      LOG_LEVEL: "warn",
      PORT: String(PORT),
      CONTROL_PORT: String(CONTROL_PORT),
      DATA_DIR: dataDir,
    },
  },
});
