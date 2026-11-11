// The browser check (spec SD9, AC10 to AC13): Chromium only, headless, software WebGL, against
// `pnpm start` (the built app served by the one Node process), never the Vite dev server.
// The server always starts fresh on its own port with a temporary DATA_DIR; all four variables
// are passed here, so nothing comes from .env.local (the process environment wins over it).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 8123;
const dataDir = mkdtempSync(join(tmpdir(), "djv-browser-"));

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
        launchOptions: {
          // No GPU on CI runners: ANGLE on SwiftShader gives WebGL2 in software.
          args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
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
