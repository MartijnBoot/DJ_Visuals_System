// How the gate's Chromium is launched, in one place (B-08 PD3): `playwright.config.ts` and the
// load harness (`scripts/under-load.ts`) both import it, so the load cannot drift from the gate.
// No side effects: the caller makes the temporary directory and writes the fake media.

/** The port the gate's browser step serves the built app on. */
export const GATE_PORT = 8123;
/** The port `pnpm check:load`'s own server uses, beside the gate (B-08 SD4). */
export const LOAD_PORT = 8124;
/** Small, to keep software WebGL stable (B-01 SD17). */
export const VIEWPORT = { width: 640, height: 360 } as const;

/**
 * No GPU on CI runners: ANGLE on SwiftShader gives WebGL2 in software. Also the WebGL of
 * `pnpm profile:check` (B-03 PD12), which needs no media.
 */
export const SOFTWARE_GL_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
] as const;

/** Software WebGL and the fake devices, fed by the fixtures from `writeFakeMedia`. */
export function chromiumArgs(media: { wav: string; y4m: string }): string[] {
  return [
    ...SOFTWARE_GL_ARGS,
    // Fake devices, permission prompts auto-accepted, the fixtures as their input.
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${media.wav}`,
    `--use-file-for-fake-video-capture=${media.y4m}`,
  ];
}
