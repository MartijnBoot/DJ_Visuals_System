# Architecture

The system as built at the end of B-01 (the live visual engine): specs
[phase-0-walking-skeleton](../specs/phase-0-walking-skeleton.md) and
[phase-b-01-live-visual-engine](../specs/phase-b-01-live-visual-engine.md), decisions in the
[Setup Decision Record](../adr/0001-setup-decision-record.md). Plans read this and do not
redesign it; a change here is an owner stop (CLAUDE.md). Diagrams stay text so they diff.

## Overview

One Node 24 process on the screen machine, bound to `127.0.0.1:PORT`, serves the built web app
and a small JSON API. The browser on the same machine runs the screen page, which captures the
camera and the audio source, analyses the audio, drives the renderer on a full-window canvas
and, while the overlay is shown, asks the server for its health. Rendering, analysis and the
media stay in the browser: no camera frame or audio sample reaches the server, the disk or a
network (B-01 SD14; the server has no endpoint for either, and `tests/browser/live.spec.ts`
asserts every request a running set makes). Five workspace packages:

```
  browser, screen machine                                  Node 24 process, 127.0.0.1:PORT
 +-------------------------------------------------+      +------------------------------------+
 | web/   React screen page, route /               | GET /| server/  Fastify                   |
 |   capture session: getUserMedia /               |----->|   static web/dist (@fastify/static)|
 |   getDisplayMedia -> MediaStream; loss, retry,  |      |                                    |
 |   remembered ids                                |      |   GET /api/health                  |
 |     camera stream -> <video> ---------------+   |      |   boot: config -> DATA_DIR -> db ->|
 |     audio stream  -> audio/  AudioWorklet   |   |      |         migrate -> listen          |
 |                      (djv-features) -----+  |   |      +-----------------+------------------+
 |                                          v  v   |                        | imports
 |   engine/  AudioFeatures + Dials + video texture|                        |
 |            -> one shader pass -> canvas         |                        |
 |            render scale, latency, frame stats   |                        |
 |   panel (key s), overlay (key o) -- health -----+----------------------> |
 +------------------+------------------------------+                        |
                    |  imports                                              |
                    v                                                       |
            shared/  zod schemas  -----------------------------------------+
                                                                            |
                                             DATA_DIR/djvisuals.sqlite, DATA_DIR/assets/ (empty)
```

`pnpm dev` changes only the front: Vite serves `web/` on `localhost:5173` with hot reload and
proxies `/api` to the server, which runs under `node --watch` with `--api-only`
(`scripts/dev.ts`). Nothing may work in dev that does not work under `pnpm start` (SD10); the
browser check runs only against `pnpm start`.

## Modules and boundaries

| Module | Owns | Public surface | Must not |
|---|---|---|---|
| `engine/` | The WebGL2 context, the animation loop, the look (one shader pass, `engine/src/look.ts`), render scaling (`scale.ts`), the latency record (`latency.ts`), frame statistics; its own `AudioFeatures` and `Dials` (`features.ts`) | `createEngine(canvas)` returning `{ start, stop, stats, latency, setFeatures, setDials, setSource, setScaleCap }`, `DEFAULT_DIALS`, `ZERO_FEATURES`, `WebGL2UnavailableError` (`engine/src/index.ts`) | Declare or import any package, including `audio/`; use Node types (`tests/meta/engine-boundary.test.ts`) |
| `audio/` | The `AudioWorklet` processor (`djv-features`, `audio/src/processor.ts`), the analysis maths as pure functions (`analysis.ts`; every number in `constants.ts`), the `AudioFeatures` contract (`features.ts`), the main-thread source that maps the worklet's clock and decays stale features (`source.ts`, `clock.ts`) | `createFeatureSource(context, stream, moduleUrl)` resolving to `{ read(now), stop, lastBlockAt }`, `createAnalyser`, `windowFrames`, `createClockMap`, `decayFeatures`, `AudioFeatures`, `ZERO_FEATURES` (`audio/src/index.ts`); the worklet file as `@djv/audio/processor` | Declare or import any package, including `engine/`; use Node types (`tests/meta/engine-boundary.test.ts`) |
| `web/` | The screen page at `/`, the capture session (`web/src/capture/`), the panel, the overlay, the wake lock, the health client; wiring `audio/` to `engine/` (`features-compat.ts`, checked both ways by `tests/meta/features-compat.test.ts`) | The built app in `web/dist` | Import from `server/`; read the environment |
| `server/` | Configuration, logging, the database and migrations, HTTP | `GET /api/health`, static `web/dist`, `pnpm migrate` | Listen on anything but `127.0.0.1`; read the environment outside `config.ts` |
| `shared/` | The schemas both sides validate against | `healthResponseSchema`, `HealthResponse` (`shared/src/index.ts`) | — |

`shared/`, `engine/` and `audio/` export their `src/index.ts`; there is no build step for the
server or those packages. Only `web/` is built, by Vite, into `web/dist`; the worklet reaches
the browser as a second chunk, imported by `web/` as `@djv/audio/processor?worker&url` and
handed to `audioWorklet.addModule`.

## Media flow

- **Start.** Nothing is asked for before the Start click (browsers need a user gesture). The
  session (`web/src/capture/session.ts`) then requests the remembered or default camera
  (`getUserMedia`) and audio source (an input through `getUserMedia`, or "System audio" through
  `getDisplayMedia`, whose video track is stopped at once), every audio request with echo
  cancellation, noise suppression and auto gain control off. Chosen device ids are kept in
  `localStorage` under `djv.sources` and preselected on the next load; the dials are not
  remembered and start at their defaults (SD16).
- **Audio.** The stream feeds a `MediaStreamAudioSourceNode` into the worklet, which analyses
  every three render quanta (384 frames, 8 ms at 48 kHz; fewer quanta where three would pass
  10 ms) and posts one feature frame per window: level, three band
  energies through fourth-order band edges at 150 Hz and 2 kHz, and a beat pulse from
  low-band spectral flux against an adaptive threshold with a floor and a 120 ms refractory
  period. The screen page reads the newest frame once per animation frame and hands it to the
  engine. Stale features (a lost source, a suspended context) are held 100 ms and then faded to
  zero by 600 ms, so the look settles to idle within AC12's second.
- **Camera.** The stream plays in a muted, never-shown `<video>`; the engine uploads its
  current frame as a texture each render frame. Without a camera (none, denied, lost) the same
  pass draws a slow value-noise field tinted by the Phase 0 drift colour, which is also the idle
  look before Start.
- **The look.** One fragment shader. Recognisability sets the block size (1 px to a 32nd of the
  width), the posterise levels (256 to 4) and the feedback from the previous frame; audio
  reactivity scales zoom from the low band, displacement and flash from the beat, grain and
  edges from the high band, brightness from the level, every term evaluated per block. At both
  dials 0 the pass is the identity on the camera image.
- **Loss and retry.** A track that ends, stays muted over 1 s, or disappears from
  `enumerateDevices` on `devicechange` makes its source `lost`; permission denied or no device
  at Start makes it `none`. Both retry every 2 s and at once on `devicechange`, and return to
  `ok` without a click (system audio is the exception: a new share needs a click). The
  condition shows only in the overlay and the panel; the output never carries text. A
  suspended `AudioContext` reads `audio: lost` with a click-to-resume reason, and one
  `pointerdown` resumes it. State changes are logged to the console as
  `capture { kind, state, reason }`, never with a device label.

## Latency and render scale

- **The in-app number** (B-01 SD15). The worklet posts each window's end in context seconds.
  The main thread maps that to the `performance.now()` clock through
  `AudioContext.getOutputTimestamp()`, refreshed once a second, subtracts
  `baseLatency + outputLatency` (the map gives when a context time is *heard*; the graph
  processed it that much earlier) and then `baseLatency` once more as the input side's share.
  That is `capturedAt`. After each frame's draw calls the engine records
  `performance.now() - capturedAt`, once per new window of audio, into a 10 s window read as
  last, nearest-rank p95 and worst in the overlay (`–` until the first sample). It excludes
  the audio interface's input buffer and the display scan-out; the film check (spec AC11)
  covers those.
- **Render scale** (SD8). The engine estimates the display's refresh rate once from the median
  interval of its first 60 frames, snapped to the nearest standard rate. It renders into two
  ping-pong 8-bit RGBA targets at canvas size x scale and blits up with linear filtering. The
  scale steps 100 -> 75 -> 50% after 2 s with the one-second mean frame time above 1.1 x the
  refresh period, and back up one step after 10 s not above it; a step up undone within 10 s
  doubles the next wait (to 80 s at most). The panel's quality cap bounds the maximum; the
  overlay shows the current scale.

## Data

- **Store.** One SQLite file, `DATA_DIR/djvisuals.sqlite`, opened through `node:sqlite` in
  `server/src/db.ts`, the only file that imports the driver. Every open sets
  `journal_mode = WAL` and `foreign_keys = ON`, with a busy timeout of 0.
- **Tables.** `schema_migrations(name, applied_at)`, owned by the runner; `app_meta(key, value)`,
  created by `server/migrations/0001_init.sql` with one row, `schema_created_at`. Nothing a
  person made is stored yet. `DATA_DIR/assets/` exists and is empty.
- **Migrations.** Files `server/migrations/NNNN_<slug>.sql`, applied in name order by
  `server/src/migrate.ts`, each in its own transaction together with its `schema_migrations`
  row. The runner takes `BEGIN IMMEDIATE` on every run, so a file locked by another process
  fails boot at once. A misnamed `.sql` file or a duplicate number fails boot naming the file.
  The schema version reported by health is the highest applied number.
- **When they run.** At boot, before listening, and through `pnpm migrate`. This departs from
  way-of-working 5.6 on purpose (SD7): one process on one machine has no replica race. The
  hosting trigger in SDR §7 reopens it.
- **Direction.** Forward-only. The restore plan is to delete the file. The guard hook keeps
  `server/migrations` append-only for agents (`.claude/guard-paths.json`).

## Configuration

`server/src/config.ts` is the one module that reads the environment. `loadConfig(env)` is a pure
zod parse of four variables, all required, no defaults in code: `APP_ENV` (`development`,
`test`, `production`), `LOG_LEVEL` (`debug`, `info`, `warn`, `error`), `PORT` (1 to 65535) and
`DATA_DIR` (a non-empty path). `loadConfigFromProcess()` is the single `process.env` reader.
`.env.example` is the contract; `scripts/setup.sh` copies it to `.env.local`.

The run scripts start `node --env-file-if-exists=.env.local` from the repository root, so a
relative `DATA_DIR` resolves against the root and the process environment wins over the file.
Any missing or malformed variable is one `fatal` log line naming every bad variable, never a
value, and exit 1 before the database is opened. A `DATA_DIR` that cannot be created or written
is reported the same way. `scripts/dev.ts` learns `PORT` for the Vite proxy by importing
`config.ts`.

## Cross-cutting

- **Auth.** None (SDR question 3). The server binds `127.0.0.1` only, so no other device can
  reach it (`server/test/boot.int.test.ts`).
- **Logging.** pino JSON lines on stdout at `LOG_LEVEL`. Fastify's request id (`reqId`) is on
  every line that belongs to a request. The environment and the config object are never
  logged whole. The browser logs capture state changes at info level, without device labels or
  media data.
- **Errors.** Every boot failure goes through `fatal` in `server/src/log.ts`: one `fatal` line,
  exit 1, nothing listening. In the browser, a failed or invalid health answer reads
  `server: unreachable` and never stops the engine; no WebGL2 context shows one line of text
  in place of the canvas. A lost or denied source never reaches the output (Media flow).
- **Keys and screen.** `o` overlay, `s` panel, `f` fullscreen on the document element. From
  Start the page holds a screen wake lock and re-acquires it when it becomes visible again;
  `wake lock: unavailable` in the overlay when the API is missing or refuses.
- **Browser.** Chromium only (B-01 SD12). The browser check runs headless Chromium on
  SwiftShader with fake media devices fed by generated fixtures (`tests/browser/fixtures/`),
  at 640x360.
- **Time.** The drift colour is a function of the frame timestamp, one hue cycle per 60 s;
  `capturedAt` and the latency samples are on the `performance.now()` clock.
  `applied_at` and `schema_created_at` are ISO-8601 UTC. Health reports whole seconds since
  listen.
