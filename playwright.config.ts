// The browser check (spec SD9, AC10 to AC13): Chromium only, headless, software WebGL, against
// `pnpm start` (the built app served by the one Node process), never the Vite dev server.
// The server always starts fresh on its own port with a temporary DATA_DIR; all four variables
// are passed here, so nothing comes from .env.local (the process environment wins over it).
// B-01 (SD17): Chromium's fake camera and microphones, fed by fixtures generated into the same
// temporary directory, and a smaller viewport to keep software WebGL stable.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { writeFakeMedia } from "./tests/browser/fixtures/media.ts";

const PORT = 8123;
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
        viewport: { width: 640, height: 360 },
        launchOptions: {
          args: [
            // No GPU on CI runners: ANGLE on SwiftShader gives WebGL2 in software.
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            // Fake devices, permission prompts auto-accepted, the fixtures as their input.
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-audio-capture=${media.wav}`,
            `--use-file-for-fake-video-capture=${media.y4m}`,
          ],
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
