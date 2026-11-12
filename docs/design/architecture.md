# Architecture

The system as built at the end of B-02 (visual profiles): specs
[phase-0-walking-skeleton](../specs/phase-0-walking-skeleton.md),
[phase-b-01-live-visual-engine](../specs/phase-b-01-live-visual-engine.md) and
[phase-b-02-visual-profiles](../specs/phase-b-02-visual-profiles.md), decisions in the
[Setup Decision Record](../adr/0001-setup-decision-record.md). Plans read this and do not
redesign it; a change here is an owner stop (CLAUDE.md). Diagrams stay text so they diff.

## Overview

One Node 24 process on the screen machine, bound to `127.0.0.1:PORT`, serves the built web app
and a small JSON API. The browser on the same machine runs the screen page, which captures the
camera and the audio source, analyses the audio, drives the renderer on a full-window canvas
and, while the overlay is shown, asks the server for its health. A second route, `/builder`
(B-02), is where visual profiles are made, edited, exported and imported; it has its own preview
canvas and engine instance. Rendering, analysis and the media stay in the browser: no camera
frame or audio sample reaches the server, the disk or a network (B-01 SD14; the server has no
endpoint for either, and `tests/browser/live.spec.ts` asserts every request a running set makes).
Five workspace packages:

```
  browser, screen machine                                  Node 24 process, 127.0.0.1:PORT
 +-------------------------------------------------+      +------------------------------------+
 | web/   React app, routes / and /builder         | GET /| server/  Fastify                   |
 |   capture session: getUserMedia /               |----->|   static web/dist (@fastify/static)|
 |   getDisplayMedia -> MediaStream; loss, retry,  |      |   GET /builder -> index.html       |
 |   remembered ids                                |      |   GET /api/health                  |
 |     camera stream -> <video> ---------------+   |      |   /api/profiles  list, get, create,|
 |     audio stream  -> audio/  AudioWorklet   |   |      |     update, delete, import         |
 |                      (djv-features) -----+  |   |      |   boot: config -> DATA_DIR -> db ->|
 |                                          v  v   |      |         migrate -> listen          |
 |   engine/  AudioFeatures + Dials + Profile +    |      +-----------------+------------------+
 |            video texture -> one shader pass     |                        | imports
 |            built from the profile -> canvas     |                        |
 |            render scale, latency, frame stats   |                        |
 |   panel (key s): profile picker, overlay (o)    |                        |
 |      -- health, profile reads, on user action --+----------------------> |
 |   /builder: list, editor, preview (own engine), |                        |
 |      export / import -- profile reads and writes+----------------------> |
 +------------------+------------------------------+                        |
                    |  imports                                              |
                    v                                                       |
            shared/  zod schemas  -----------------------------------------+
                                                                            |
                          DATA_DIR/djvisuals.sqlite (profiles), DATA_DIR/assets/ (empty)
```

`pnpm dev` changes only the front: Vite serves `web/` on `localhost:5173` with hot reload and
proxies `/api` to the server, which runs under `node --watch` with `--api-only`
(`scripts/dev.ts`). Nothing may work in dev that does not work under `pnpm start` (SD10); the
browser check runs only against `pnpm start`.

## Modules and boundaries

| Module | Owns | Public surface | Must not |
|---|---|---|---|
| `engine/` | The WebGL2 context, the animation loop, the look (one shader pass composed from a profile, `shader.ts`; its constants and B-01's reference mapping in `look.ts`), the profile model, strength formula and built-in profile (`profile.ts`), render scaling (`scale.ts`), the latency record (`latency.ts`), frame statistics; its own `AudioFeatures`, `Dials` (`features.ts`) and `Profile` | `createEngine(canvas)` returning `{ start, stop, stats, latency, setFeatures, setDials, setSource, setScaleCap, setProfile }`, `BUILT_IN_PROFILE`, `EFFECTS`, `effectStrength`, `DEFAULT_DIALS`, `ZERO_FEATURES`, `WebGL2UnavailableError`, `ProfileSupersededError` (`engine/src/index.ts`) | Declare or import any package, including `audio/` and `shared/`; use Node types (`tests/meta/engine-boundary.test.ts`) |
| `audio/` | The `AudioWorklet` processor (`djv-features`, `audio/src/processor.ts`), the analysis maths as pure functions (`analysis.ts`; every number in `constants.ts`), the `AudioFeatures` contract (`features.ts`), the main-thread source that maps the worklet's clock and decays stale features (`source.ts`, `clock.ts`), the synthetic feature loop for the builder's preview (`synthetic.ts`) | `createFeatureSource(context, stream, moduleUrl)` resolving to `{ read(now), stop, lastBlockAt }`, `createAnalyser`, `windowFrames`, `createClockMap`, `decayFeatures`, `syntheticFeatures`, `AudioFeatures`, `ZERO_FEATURES` (`audio/src/index.ts`); the worklet file as `@djv/audio/processor` | Declare or import any package, including `engine/`; use Node types (`tests/meta/engine-boundary.test.ts`) |
| `web/` | The screen page at `/` and the builder at `/builder` (`web/src/main.tsx` reads `location.pathname`; no router), the capture session (`web/src/capture/`), the panel and its profile picker (`profiles/active.ts`), the overlay, the wake lock, the health and profile clients (`profiles/api.ts`), the builder (`web/src/builder/`: list, editor reducer, preview, conflict, export and import); wiring `audio/` and `shared/` to `engine/` (`features-compat.ts`, `profile-compat.ts`, checked both ways by `tests/meta/features-compat.test.ts` and `tests/meta/profile-compat.test.ts`) | The built app in `web/dist` | Import from `server/`; read the environment |
| `server/` | Configuration, logging, the database and migrations, the profile store (`server/src/profiles/store.ts`, the only SQL for profiles) and routes (`routes.ts`), HTTP | `GET /api/health`, the profile endpoints below, `GET /builder`, static `web/dist`, `pnpm migrate` | Listen on anything but `127.0.0.1`; read the environment outside `config.ts` |
| `shared/` | The schemas both sides validate against: health, the profile and its file format (`profile.ts`), the endpoint bodies and error shapes (`profile-api.ts`), the "Name (n)" rule (`names.ts`) | `healthResponseSchema`, `profileSchema`, `profileFileSchema`, `toProfileFile`, `storedProfileSchema`, `updateProfileSchema`, `issuesFrom`, `nextFreeName`, `LIMITS` (`shared/src/index.ts`) | — |

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
  `localStorage` under `djv.sources` and preselected on the next load. The dials start at the
  starting values of the picked profile, or the built-in's `0.3` and `0.7`; moving them is never
  saved (B-02 SD2).
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
- **The look.** One fragment shader, built from the active profile (below). Each effect's
  strength is `clamp01(base x (abstraction effect ? recognisability : 1) + binding x feature x
  reactivity)` (`effectStrength`, `engine/src/profile.ts`); recognisability therefore scales
  only pixelate, posterise and smear (block size 1 px to a 32nd of the width, levels 256 to 4,
  feedback from the previous frame), and reactivity only the audio bindings. The built-in
  profile is B-01's look: `profileUniforms` equals `lookUniforms` within 1e-9
  (`engine/src/profile.test.ts`). Per-block noise (grain, displace) is keyed on the output
  pixel's block. At both dials 0 with a camera the built-in is the identity on the image.

## Profiles

- **What a profile is.** Plain data, never code (B-02 SD1): a name (1 to 60 characters, unique
  case-insensitively), a palette of 2 to 6 `#rrggbb` colours, the two dials' starting values,
  and an ordered list of up to 12 effects, each type at most once. The twelve types are
  pixelate, posterise, smear, zoom, displace, flash, grain, edges, brightness, paletteMap,
  mirror and rgbSplit; each has a strength, at most one audio binding (feature and amount) and,
  where it has one, an own parameter (a palette slot for flash, grain and edges; segments 2 to 8
  for mirror). `shared/src/profile.ts` defines it once; `engine/src/profile.ts` declares the same
  shape without importing `shared/`, and `web/src/profile-compat.ts` makes the type check fail if
  they drift.
- **One shader pass.** `buildFragment(types)` (`engine/src/shader.ts`) emits `fx0`, the source
  (camera or noise, tint included), and one `fxN` per effect in stack order, each calling the
  one before: a warp calls it at a moved coordinate, a colour effect changes its result, edges
  and rgbSplit sample it three times. The first effect in the list is therefore applied first,
  as separate passes would, at one pass's cost. Strengths, colours and segments are uniforms,
  so a value edit costs nothing; only a change to the list needs a new program.
- **Switching** (B-02 SD15). `Engine.setProfile` with the same effect list applies the values on
  the next frame. Another list is compiled and linked while the old profile keeps drawing, read
  without blocking where `KHR_parallel_shader_compile` exists, and swapped in at the start of a
  frame; the promise resolves at the swap, rejects if the link fails (the old profile keeps
  drawing) or a later call supersedes it. Programs are cached by their list. The first frame
  after a swap, and after the render targets are recreated by a scale step or a resize, draws no
  smear, because the previous frame is black or from the old look.
- **The screen page** (`web/src/profiles/active.ts`). Nothing is fetched on load. Start and each
  opening of the panel list the profiles; the first successful list also picks the remembered
  id (`localStorage` key `djv.profile`), else the built-in. Picking re-fetches the profile,
  validates it, awaits the swap, applies its starting dials and logs `profile { id }`. The page
  keeps the copy it loaded: an edit or delete elsewhere changes nothing until a profile is picked
  (SD9). Any failure (API down, 404, 422, invalid body, a program that does not link) keeps the
  current look and shows one reason in the panel; the output never carries text. The overlay
  names the active profile.
- **The builder** (`/builder`). The list (built-in first, then names case-insensitively) with
  create (from the built-in or a preset palette), duplicate, rename (a save: same id, revision
  + 1), delete behind a confirm and export; an editor over a draft reducer
  (`web/src/builder/editor.ts`, property-tested to never leave a state the schema rejects except
  a bad name); a preview canvas on its own engine instance driven by the synthetic loop and the
  noise field until Start, then by the real camera and audio through the same capture session as
  the screen page; Save with the revision the edit started from. A refused save (409 stale
  revision, or the profile deleted elsewhere) keeps the draft and offers "Reload theirs" or "Save
  mine as a copy"; unsaved changes are marked and leaving them asks first.
- **Files.** Export is built in the browser: `{ formatVersion: 1, profiles: [ { name, palette,
  dials, effects } ] }`, never an id, revision or timestamp (`toProfileFile`). Import checks the
  JSON, then the version, then the shared schema before anything is sent, and the server checks
  again; a bundle is stored all or nothing, every profile with a new id and revision 1, a taken
  name becoming "Name (2)" (`nextFreeName`).

### Endpoints

| Method | Path | Answers |
|---|---|---|
| GET | `/api/profiles` | 200 `{ profiles }`, by name; unusable rows left out |
| GET | `/api/profiles/:id` | 200; 404; 422 `unusable` |
| POST | `/api/profiles` | 201; 400 `invalid` with `issues` (dotted path); 409 `name_taken` |
| PUT | `/api/profiles/:id` | 200 (revision + 1); 400; 404; 409 `stale_revision` (with `current`) or `name_taken`; 422 |
| DELETE | `/api/profiles/:id` | 204; 404 |
| POST | `/api/profiles/import` | 201 `{ profiles }`; 400 naming profile and field; 422 `unsupported_version` |

413 above the body limit and 415 without `application/json` apply to every write. `GET /builder`
sends `index.html`; every other unknown path stays 404.
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
  created by `server/migrations/0001_init.sql` with one row, `schema_created_at`; and
  `profiles(id, name COLLATE NOCASE UNIQUE, revision, definition, created_at, updated_at)`
  from `0002_profiles.sql`, where `definition` is the JSON of palette, dials and effects. The
  built-in profile is code, not a row. Row validity is checked on every read: a `definition`
  that fails the shared schema is left out of the list (one `warn` per id per process, the id
  only) and answered 422 by `GET /api/profiles/:id`, so the screen falls back to the built-in.
  `update` is one `UPDATE ... WHERE id = ? AND revision = ?`; an import is one `BEGIN IMMEDIATE`
  transaction. `DATA_DIR/assets/` exists and is empty: no effect uses an asset.
- **Browser storage.** `djv.sources` (device ids) and `djv.profile` (the picked profile's id, a
  plain string; removing it selects the built-in). No profile data is stored in the browser.
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
  reach it, `/api/profiles` included (`server/test/boot.int.test.ts`).
- **Writes** (B-02 SD18). No response carries a CORS header. A `POST` or `PUT` without
  `Content-Type: application/json` is 415, answered before the body is read, and `text/plain` is
  not a parser, so a page on another origin cannot write with a simple request. The body limit
  is 64 KB, 1 MB for an import (413). `server/src/app.ts` sets all three.
- **Requests a running set makes.** `GET /`, `/assets/*`, `/api/health`, and `/api/profiles` and
  `/api/profiles/:id` only on a user action (Start, opening the panel, picking a profile); no
  media endpoint exists (`docs/invariants.md`, `tests/browser/live.spec.ts`).
- **Logging.** pino JSON lines on stdout at `LOG_LEVEL`. Fastify's request id (`reqId`) is on
  every line that belongs to a request. The environment and the config object are never
  logged whole. The server logs profile create, update, delete and import at `info` with the id
  and revision, never the definition. The browser logs capture state changes and profile
  switches at info level, without device labels or media data.
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
