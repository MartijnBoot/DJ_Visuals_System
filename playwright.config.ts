// The browser check (spec SD9, AC10 to AC13): Chromium only, headless, software WebGL, against
// `pnpm start` (the built app served by the one Node process), never the Vite dev server.
// The server always starts fresh on its own port with a temporary DATA_DIR; all four variables
// are passed here, so nothing comes from .env.local (the process environment wins over it).
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
const dataDir = mkdtempSync(join(tmpdir(), "djv-browser-"));
const media = writeFakeMedia(dataDir);

export default defineConfig({
  testDir: "tests/browser",
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
    env: { APP_ENV: "test", LOG_LEVEL: "warn", PORT: String(PORT), DATA_DIR: dataDir },
  },
});
