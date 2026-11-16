# Architecture

The system as built at the end of B-06 (remote input devices): specs
[phase-0-walking-skeleton](../specs/phase-0-walking-skeleton.md),
[phase-b-01-live-visual-engine](../specs/phase-b-01-live-visual-engine.md),
[phase-b-02-visual-profiles](../specs/phase-b-02-visual-profiles.md),
[phase-b-04-live-set-controls](../specs/phase-b-04-live-set-controls.md) and
[phase-b-06-remote-input-devices](../specs/phase-b-06-remote-input-devices.md), decisions in the
[Setup Decision Record](../adr/0001-setup-decision-record.md) and
[ADR 0002](../adr/0002-remote-input-over-the-lan.md). Plans read this and do not
redesign it; a change here is an owner stop (CLAUDE.md). Diagrams stay text so they diff.

## Overview

One Node 24 process on the screen machine, bound to `127.0.0.1:PORT`, serves the built web app
and a small JSON API. The browser on the same machine runs the screen page, which captures the
camera and the audio source, analyses the audio, drives the renderer on a full-window canvas
and, while the overlay is shown, asks the server for its health. A second route, `/builder`
(B-02), is where visual profiles are made, edited, exported and imported; it has its own preview
canvas and engine instance. Rendering and analysis stay in the screen machine's browser: no
camera frame or audio sample reaches the server or the disk (B-01 SD14; the server has no
endpoint for either, and `tests/browser/live.spec.ts` asserts every request a running set makes).
External control (B-04) lets a phone, tablet or laptop on the LAN drive the set: while the
operator switches it on, a second listener on the machine's private addresses serves `/control`
and a device socket over HTTPS; every change goes over the server to the screen page, which
applies it and mirrors its state back (External control, below). Remote input (B-06, ADR 0002)
lets a paired device send its camera or its audio from `/send`: the media goes peer to peer to
the screen page over the LAN, never through the server, which relays only the WebRTC setup
(Remote input, below). Five workspace packages:

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
| `engine/` | The WebGL2 context, the animation loop, the look (one shader pass composed from a profile, `shader.ts`; its constants and B-01's reference mapping in `look.ts`), the profile model, strength formula and built-in profile (`profile.ts`), render scaling (`scale.ts`), the latency record (`latency.ts`), frame statistics; custom effects wrapped into the pass, the flash limiter, the runtime guard and context-loss recovery (B-03), compile errors located to effect and line (`compile-error.ts`); its own `AudioFeatures`, `Dials` (`features.ts`) and `Profile` | `createEngine(canvas)` returning `{ start, stop, stats, latency, setFeatures, setDials, setSource, setScaleCap, setProfile(profile, { pick }), onGuard }`, `BUILT_IN_PROFILE`, `EFFECTS`, `effectStrength`, `DEFAULT_DIALS`, `ZERO_FEATURES`, `WebGL2UnavailableError`, `ProfileSupersededError`, `ProfileCompileError`, `locateErrors` (`engine/src/index.ts`) | Declare or import any package, including `audio/` and `shared/`; use Node types (`tests/meta/engine-boundary.test.ts`) |
| `audio/` | The `AudioWorklet` processor (`djv-features`, `audio/src/processor.ts`), the analysis maths as pure functions (`analysis.ts`; every number in `constants.ts`), the `AudioFeatures` contract (`features.ts`), the main-thread source that maps the worklet's clock and decays stale features (`source.ts`, `clock.ts`), the synthetic feature loop for the builder's preview (`synthetic.ts`) | `createFeatureSource(context, stream, moduleUrl)` resolving to `{ read(now), stop, lastBlockAt }`, `createAnalyser`, `windowFrames`, `createClockMap`, `decayFeatures`, `syntheticFeatures`, `AudioFeatures`, `ZERO_FEATURES` (`audio/src/index.ts`); the worklet file as `@djv/audio/processor` | Declare or import any package, including `engine/`; use Node types (`tests/meta/engine-boundary.test.ts`) |
| `web/` | The screen page at `/`, the builder at `/builder`, the External control page at `/control` and the sending page at `/send` (`web/src/main.tsx` reads `location.pathname`; no router), the screen's control client and the controller (`web/src/control/`), the screen's remote sources (`web/src/remote/`) and the sender (`web/src/send/`), the capture session (`web/src/capture/`), the panel and its profile picker (`profiles/active.ts`), the overlay, the wake lock, the health and profile clients (`profiles/api.ts`), the builder (`web/src/builder/`: list, editor reducer, custom effect row, preview with live compile and frame time, conflict, export, import and Replace); wiring `audio/` and `shared/` to `engine/` (`features-compat.ts`, `profile-compat.ts`, checked both ways by `tests/meta/features-compat.test.ts` and `tests/meta/profile-compat.test.ts`) | The built app in `web/dist` | Import from `server/`; read the environment |
| `server/` | Configuration, logging, the database and migrations, the profile store (`server/src/profiles/store.ts`, the only SQL for profiles) and routes (`routes.ts`), HTTP, External control (`server/src/control/`: pairing, the LAN listener, the sockets, relaying, the trust page), the local certificate authority (`server/src/tls/`: DER, the two certificate shapes, the store under `DATA_DIR/tls/`) | `GET /api/health`, the profile endpoints below, `GET /builder`, static `web/dist`, the screen socket `/api/control/screen`; on the LAN listener while switched on, over HTTPS only, `GET /control`, `GET /send`, `GET /trust`, `GET /assets/*`, the device socket `/api/control/device`; `pnpm migrate` | Listen on anything but `127.0.0.1`, except the External control listener on private IPv4 addresses while switched on; read the environment outside `config.ts` |
| `shared/` | The schemas both sides validate against: health, the profile and its file format (`profile.ts`, with the optional `primary` and `derivePrimary`, the custom effect and its code checks), the endpoint bodies and error shapes (`profile-api.ts`), the "Name (n)" rule (`names.ts`), every External control message both ways and its limits (`control.ts`) | `healthResponseSchema`, `profileSchema`, `profileFileSchema`, `toProfileFile`, `SUPPORTED_FORMAT_VERSIONS`, `isSupportedFormatVersion`, `derivePrimary`, `customCodeIssues`, `storedProfileSchema`, `updateProfileSchema`, `issuesFrom`, `nextFreeName`, `LIMITS`, `CUSTOM_LIMITS`, the control schemas and constants (`shared/src/index.ts`) | — |

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

- **What a profile is.** Data, whose only code is GLSL (B-02 SD1, amended by B-03 SD1): a name
  (1 to 60 characters, unique case-insensitively), a palette of 2 to 6 `#rrggbb` colours, the
  two dials' starting values, and an ordered list of up to 12 effects, each built-in type at most
  once. The twelve built-in types are pixelate, posterise, smear, zoom, displace, flash, grain,
  edges, brightness, paletteMap, mirror and rgbSplit; each has a strength, at most one audio
  binding (feature and amount) and, where it has one, an own parameter (a palette slot for flash,
  grain and edges; segments 2 to 8 for mirror). A `custom` effect (B-03 SD4) may appear any
  number of times within the 12: a label unique in the profile, a strength, a binding, an
  abstraction flag (recognisability scales it when set), 0 to 4 named parameters and its `code`,
  the body of a GLSL function of at most 8 KB written against the contract in
  [`docs/custom-effects.md`](../custom-effects.md). The schema refuses code with `#`, the word
  `uniform`, an `in`/`out` declaration or unbalanced braces (`customCodeIssues`); the compiler is
  the real check, and the server never compiles. The code is never evaluated as JavaScript: it
  reaches the browser only through `shaderSource` (`docs/invariants.md`). `shared/src/profile.ts`
  defines the profile once; `engine/src/profile.ts` declares the same shape without importing
  `shared/`, and `web/src/profile-compat.ts` makes the type check fail if they drift.
- **One shader pass.** `buildFragment(entries)` (`engine/src/shader.ts`) emits `fx0`, the source
  (camera or noise, tint included), and one `fxN` per effect in stack order, each calling the
  one before: a warp calls it at a moved coordinate, a colour effect changes its result, edges
  and rgbSplit sample it three times. The first effect in the list is therefore applied first,
  as separate passes would, at one pass's cost. Strengths, colours and segments are uniforms,
  so a value edit costs nothing; only a change to the list, or to a custom effect's code, needs a
  new program. A custom effect's body becomes its own function between engine-written `#define`s
  that map the contract's names (`source`, `strength`, `param`, `audio`, …) onto its uniforms,
  undefined after it; a wrapper `fxN` passes the picture through without running the body under
  strength 0.001. A fragment without a custom effect is byte for byte what B-02 built
  (`tests/meta/fragment-golden.test.ts`).
- **The flash limiter** (B-03 SD5). `main()` of a fragment with a custom effect ends with engine
  code no body can skip: a colour that is not finite becomes the previous output, and a luma step
  above 0.35 from the previous output at that pixel is moved back along the line to it. In such a
  profile both render targets start from the last output, at a swap and when a scale step or a
  resize recreates them, so the limiter always compares with a real frame.
- **Switching** (B-02 SD15). `Engine.setProfile` with the same program key (the effect list and
  every custom body's code) applies the values on the next frame. Another key is compiled and
  linked while the old profile keeps drawing, read without blocking where
  `KHR_parallel_shader_compile` exists, and swapped in at the start of a frame; the promise
  resolves at the swap, rejects if the link fails (the old profile keeps drawing) or a later call
  supersedes it. Programs are cached by their key. Custom code that does not compile rejects with
  `ProfileCompileError`, its issues mapped from the compiler's lines onto the effect and the line
  in its own body (`locateErrors`); the failed key is remembered (16 at most) and not compiled
  again on the next slider move. The first frame after a swap, and after the render targets are
  recreated by a scale step or a resize, draws no smear, because the previous frame is black or
  from the old look.
- **The guard** (B-03 SD8, PD8). When the render scale is at 50% and the one-second mean frame
  time has stayed above budget for 3 s (and the custom program has drawn for 3 s), the engine
  switches to the same profile without its custom effects (built-ins and camera keep drawing) and
  emits `onGuard({ kind: "slow", customBypassed: true })`. When the WebGL context is lost the
  engine prevents the default, draws nothing until it is restored, then remakes its texture,
  targets and programs and draws the active profile again at once, without its custom effects,
  emitting `onGuard({ kind: "contextLost", customBypassed })`. Either bypass lasts until
  `setProfile(profile, { pick: true })` (a pick) or a call with another program key (an edit in
  the builder); a same-key call (a slider, a live colour) keeps it.
- **The screen page** (`web/src/profiles/active.ts`). Nothing is fetched on load. Start and each
  opening of the panel list the profiles; the first successful list also picks the remembered
  id (`localStorage` key `djv.profile`), else the built-in. Picking re-fetches the profile,
  validates it, awaits the swap, applies its starting dials and logs `profile { id }`. The page
  keeps the copy it loaded: an edit or delete elsewhere changes nothing until a profile is picked
  (SD9). Any failure (API down, 404, 422, invalid body, a program that does not link) keeps the
  current look and shows one reason in the panel; custom code that does not compile is named by
  its effect's label, never by the compiler's text. The guard's reason is kept apart: opening the
  panel does not clear it, a successful pick does, and a pick asks the engine to retry. Every
  reason reaches paired controllers through the existing state; the output never carries text.
  The browser logs each guard event at `warn` with the profile id. The overlay names the active
  profile.
- **The builder** (`/builder`). The list (built-in first, then names case-insensitively) with
  create (from the built-in or a preset palette), duplicate, rename (a save: same id, revision
  + 1), delete behind a confirm and export; an editor over a draft reducer
  (`web/src/builder/editor.ts`, property-tested to never leave a state the schema rejects except
  a bad name); a preview canvas on its own engine instance driven by the synthetic loop and the
  noise field until Start, then by the real camera and audio through the same capture session as
  the screen page; Save with the revision the edit started from. A refused save (409 stale
  revision, or the profile deleted elsewhere) keeps the draft and offers "Reload theirs" or "Save
  mine as a copy"; unsaved changes are marked and leaving them asks first. "Add an effect"
  offers "Custom" (from `custom-template.ts`); a custom row shows the label, strength, binding,
  an "Abstraction" checkbox, parameter sliders and the code in a plain monospace text box. The
  preview compiles each edit to the code after 150 ms and reports the result with the program key
  it belongs to; the row shows "ok" or `line <n>: <message>`, the preview keeps the last version
  that compiled, and Save stays off with its reason until a draft with code compiles. The
  preview shows its frame time and the guard's reason.
- **Files.** Export is built in the browser: `{ formatVersion, profiles: [ { name, palette,
  dials, effects } ] }`, never an id, revision or timestamp (`toProfileFile`); `formatVersion` is
  1 when no profile holds a custom effect, so a B-02 build can read it, and 2 otherwise (B-03
  SD15). Import accepts 1 and 2 (a version 1 holding a custom effect is refused) and checks the
  JSON, then the version, then the shared schema before anything is sent, and the server checks
  again; a bundle is stored all or nothing, every profile with a new id and revision 1, a taken
  name becoming "Name (2)" (`nextFreeName`). A file of exactly one profile whose name is stored
  (trimmed, any case, never the built-in) asks "Replace *Name*" or "Add as a copy" (B-03 SD10):
  Replace is `PUT /api/profiles/:id` with the revision just read, so the id stays and the screen
  and controllers keep it; a save elsewhere in between gets the conflict choice above.
- **Authoring** (B-03 SD6, SD7, SD14). The `/profile` command (`.claude/commands/profile.md`)
  guides a Claude Code session from an inspiration (kept in `inspiration/<slug>/`, ignored by
  git) to `profiles/<slug>.json` and `profiles/<slug>.md`, committed; the owner imports the file.
  The agent never writes to the database or calls the server. `pnpm profile:check <file>
  [--camera <image>] [--out <dir>]` (`scripts/profile-check.ts`) checks the file with the
  builder's import check, compiles each profile in the real engine in headless Chromium with the
  gate's software WebGL on a page it serves itself (`scripts/profile-check-page.ts`), and writes
  nine stills per profile (quiet, kick, hi-hat at dials (0, 0), the starting dials and (1, 1))
  under `profiles/.check/` (ignored by git), reporting whether the flash limiter clipped. Exit 0
  valid, 1 a schema or compile failure naming the profile, effect and field or line, 2 usage.

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

## External control

B-04 (spec [phase-b-04-live-set-controls](../specs/phase-b-04-live-set-controls.md)): any browser
on the LAN, once paired and approved, picks profiles, moves the two dials, edits palette colours
live and switches the camera. The screen page stays the single source of truth; the server holds
the pairing and relays.

```
  controller (any LAN browser)        Node 24 process                     screen page (127.0.0.1)
 +----------------------------+      +--------------------------------+   +--------------------+
 | /control (web/)            |      | LAN listener, CONTROL_PORT:    |   | / (web/)           |
 |   device-link.ts           |----->|   private IPv4 only, only      |   |   screen-link.ts   |
 |   DJ / VJ, colour wheel    |  WS  |   while switched on            |   |   apply.ts         |
 |                            |      |   GET /control, /assets/*      |   |   (beforeFrame ->  |
 |                            |      |   WS /api/control/device       |   |    engine)         |
 |                            |      | server/src/control/            |   |                    |
 |                            |      |   pairing.ts: code, approvals, |   |                    |
 |                            |      |     keys bound to the IP       |   |                    |
 |                            |<-----|   hub.ts: relay, last state    |<--|                    |
 |   state, applied, pending  |      | main listener, 127.0.0.1:PORT  |   |   state, applied,  |
 |                            |      |   WS /api/control/screen  -----+-->|   panel actions    |
 +----------------------------+      +--------------------------------+   +--------------------+
                                        control { deviceId } -> screen
```

- **Listeners.** The main listener is unchanged and gains the screen socket. The External control
  listener is one small Fastify instance per private IPv4 address of the machine (10/8,
  172.16/12, 192.168/16; never `0.0.0.0`, a public address or IPv6; `control/addresses.ts`) on
  `CONTROL_PORT`, created when the operator switches on in the panel and closed when they switch
  off; binding is all or nothing ("Port <n> is in use", "No local network address found",
  "Certificate store unreadable — see the runbook"). It serves HTTPS only, with a server
  certificate for exactly the addresses bound (B-06; no plain-HTTP listener exists on the LAN),
  and answers `GET /control` and `GET /send` (`index.html`), `GET /trust` (the trust page, and
  the root certificate at `?download`), `GET /assets/*` (rooted at the assets folder, nothing
  else of `web/dist`) and the device socket; everything else is 404, with no CORS header. Boot
  never switches it on.
- **Sockets.** `ws` in `noServer` mode behind each listener's `upgrade` event
  (`control/upgrade.ts`): a path no route names is 404, an `Origin` other than the listener's own
  is 403 before the handshake. The screen socket accepts `http://127.0.0.1:PORT`,
  `http://localhost:PORT` and Vite's `http://localhost:5173`; a device socket only
  `https://<that address>:CONTROL_PORT`. Every received message goes through `control/channel.ts`:
  the rate limit (120 a second per device socket, none for the screen), the size limit (4 KB per
  device message, 256 KB on the screen socket, 16 KB for a WebRTC setup message on either), JSON,
  the shared schema (`shared/src/control.ts`); a failure is dropped with one `warn` naming its
  type and the socket stays open.
- **Pairing** (`control/pairing.ts`, in memory, dies with the process). Switching on issues a
  six-character code from a 31-character alphabet (no `0 O 1 I L`), carried in the QR URL's
  fragment so it never reaches a request line. A device's first message is `hello` with the code
  (a request, shown with a hint like "Safari on iPhone" and a sequence label) or a session key (a
  reconnect). The panel or any approved controller accepts or rejects; a request expires after
  60 s. Accepting gives a 128-bit key bound to the device's source IP. Limits: 8 approved, 4
  pending; five wrong codes from one IP within 60 s refuse it for 60 s. New code, Disconnect,
  switching off or a restart end pairings; a key from another IP ends that approval.
- **Message flow** (`control/hub.ts`). An approved device's controls (`pick`, `dials`, `colour`,
  `resetColour`, `camera`, `refresh`, each with a `seq`) go to the target screen as
  `control { deviceId }`; the last screen page to connect is the target and an older one gets
  `superseded`. The screen page queues them and applies them at the start of the next frame, in
  the frame feed's `beforeFrame`, registered before the engine's own frame callback
  (`web/src/control/apply.ts`, `web/src/frame-feed.ts`): dials straight to the engine, colours to
  the live palette (`profiles/active.ts`: the same effect list, so no new program; never saved;
  any pick restores the stored palette), cameras through the capture session (the latest request
  wins), picks through the panel's own pick. Each frame then sends one `applied` batch and at most
  one `state` (`web/src/control/screen-link.ts`); the server keeps the last state, hands it first
  to a device that (re)connects, and relays `applied { seq }` to its own device, which times the
  round trip. A device the screen has not seen, and Refresh, list the profiles (B-02's
  user-action rule); nothing polls.
- **Controller** (`web/src/control/`). `device-link.ts` holds the link: "Waiting for approval",
  locked until the first state, "Reconnecting…" at 0.5 s doubling to 5 s and at once on `online`
  or the page becoming visible, nothing queued while down, "Pairing ended — scan the code again"
  when the server refuses the key. `Controller.tsx` has DJ mode (tiles, wide sliders, the Primary
  colour) and VJ mode (every swatch, the status strip with the round trip, pending requests
  inline); `Wheel.tsx` is the hand-drawn colour wheel, sending at most one change per frame and
  the last position on release.
- **The test seam.** `boot(config, { controlAddresses })` takes the address list; absent, it is
  the machine's private addresses. Every integration and browser check passes `127.0.0.1`, so the
  gate never binds a LAN address; the browser checks boot their own server in the test process
  (`tests/browser/control-server.ts`) and can restart it on the same ports. Real addresses and
  Wi-Fi latency are the owner's checks ([runbook](../runbooks/README.md)). The LAN side is HTTPS
  under a root made per run in the test server's temporary `DATA_DIR`: Node proves the chain
  (`server/test/control-tls.int.test.ts`, `ca` set to that root and nothing else), and the
  browser checks' LAN contexts set `ignoreHTTPSErrors` (B-06 PD9), since Chromium has no
  per-context trust store.

## Remote input

B-06 (spec [phase-b-06-remote-input-devices](../specs/phase-b-06-remote-input-devices.md),
[ADR 0002](../adr/0002-remote-input-over-the-lan.md)): a paired device sends its camera, its
audio, or both, from `/send`. The screen page receives them over WebRTC, peer to peer on the LAN,
and draws and analyses them as it does its local sources. The server pairs and relays setup; no
media passes it.

```
  sender (/send, any LAN browser)       Node 24 process                    screen page (127.0.0.1)
 +-----------------------------+      +-------------------------------+   +----------------------+
 | web/src/send/               | WSS  | hub.ts: offer, candidate  --->|-->| remote/peers.ts      |
 |   send-link.ts (pair-link)  |----->|   relayed with the deviceId;  |   |   answer (recvonly)  |
 |   peer.ts: sendonly, Opus   |<-----|   answer, candidate, stream <-|<--|   feeds, loss, stats |
 |   capture.ts                |      |   { active } relayed back     |   | remote/sources.ts    |
 +--------------+--------------+      +-------------------------------+   |   main-audio.ts      |
                |                                                         |   picture.ts         |
                +------- media: RTP over UDP, host candidates only ------>|   -> engine, audio/  |
                                                                          +----------------------+
```

- **Roles and pairing.** A sender's `hello` carries the code and `sends` (`video`, `audio` or
  both), which is its role for the life of the pairing (`control/pairing.ts`). Same code, approval
  surfaces, 60 s expiry, throttle and IP-bound key as a controller; its own limits: 4 video
  senders, 1 audio sender ("Another device is sending audio"), the 4 pending requests shared. The
  panel and every controller name the role in the request ("… wants to send video and audio");
  the panel lists approved senders apart from controllers, with Disconnect. The sender keeps its
  key in `djv.sendKey` and its choice in `djv.sendChoice` and reconnects as a controller does: the
  hello, key, backoff and refusal rules are `web/src/control/pair-link.ts`, which `device-link.ts`
  and `send-link.ts` share.
- **The relay** (`control/hub.ts`, `control/device.ts`). A sender's socket may send `hello`,
  `offer` and `candidate`, nothing else (a control from it is dropped with one `warn`). They go
  to the target screen with the sender's `deviceId`; the screen's `answer`, `candidate` and
  `stream { kind, active }` go back to that sender. When the target screen (re)connects, each sender is
  told `screen { connected }` and offers again; a screen reload leaves the senders' capture
  running ("Screen reconnecting…"). New code, Disconnect, switching off or a restart end the
  pairing: the sender stops its capture ("Pairing ended — scan the code again").
- **Peer connections.** `RTCPeerConnection({ iceServers: [] })` on both sides: host candidates
  only, so a network that isolates clients cannot connect them (after 10 s without `connected`,
  "Could not reach the screen machine — the network may block devices from talking to each
  other" on `/send` and on the panel's sender row). The sender offers `sendonly`, with
  `contentHint = "motion"` on video and 128 kb/s on audio; both sides pass their description
  through `opusMusic` (`web/src/remote/sdp.ts`: stereo, 128 kb/s, no DTX). The screen answers
  `recvonly` (`web/src/remote/peers.ts`). Senders start paused; the screen asks a sender to stream
  with `stream { kind, active }`, each kind apart: the audio sender's audio from Start on, a
  sender's video only while it is the picked camera or a lost picked camera waiting to return, so
  at most one remote video decodes (a sender of both keeps its video paused until picked).
- **Loss.** A feed is lost when its track ends, it is muted for 1 s, the peer is `disconnected`
  or `failed`, or (PD8 as amended) its inbound `packetsReceived` has not moved for 1 s while it
  was asked to stream — read from `getStats()` every 250 ms, since Chromium gives a receiver no
  other sign when a sender stops.
- **Sources** (`web/src/remote/sources.ts`). Above the capture session, which still owns exactly
  one local camera and one local input, `sources.frame(now)` decides at the start of each frame
  which features and which video element the engine gets. Main audio (`main-audio.ts`) is a
  choice, remote or local, and a playing source: an arriving audio sender sets the choice to
  remote; a loss plays the local input in the same frame (its feature source keeps running beside
  the remote one), and the remote plays again after 3 s back and steady; the local choice pins
  local. A remote audio track goes through a muted `<audio>` element into `createFeatureSource`
  on the session's own context. With System audio as the local choice, the default input is
  opened as the standby without being remembered. The picture (`picture.ts`): a remote camera is
  listed as "<hint> — Device n" with the id `remote:<deviceId>` and drawn only once picked and
  once it has a frame (every camera switch keeps the previous picture until then); lost for 1 s it
  falls back to the local camera and returns after 3 s back, unless another camera was picked in
  between. A remote choice never reaches `djv.sources`.
- **The panel and controllers.** The panel shows the trust block, the `/control` and `/send` QR
  codes (the same code), the senders with their state from the page's own peer (connecting,
  connected, on screen, lost, could not reach), the remote cameras in the camera picker marked
  "(remote)", and a "main audio" row while an audio sender is approved. Controllers show remote
  camera tiles with a mark and "Main audio: laptop / screen machine". The overlay gains
  `network ms` and `video ms` (the selected pair's round trip / 2 plus the jitter buffer, sampled
  every 250 ms while shown) and names the remote source on its `audio:` and `camera:` lines.
- **Trust and certificates** (`server/src/tls/`). At the first switch-on the store makes a local
  root (EC P-256, 10 years) and a server certificate for the bound addresses (397 days, issued
  again when the addresses change or fewer than 30 days remain), all under `DATA_DIR/tls/`;
  certificates are hand-written DER on `node:crypto` (`der.ts`, `certificate.ts`). `store.ts` is
  the only module that reads a key file, and no key is served or logged. A device trusts the root
  once from `/trust` (the panel's first QR code): the fingerprint, the steps per OS, and the
  certificate as `application/x-x509-ca-cert`. An unreadable root is "Certificate store
  unreadable"; deleting the folder starts over (runbook).
- **The test seam.** Two headless Chromium contexts on `127.0.0.1` connect with loopback host
  candidates (`--allow-loopback-in-peer-connection`, test only, `tests/browser/fixtures/launch.ts`).
  `tests/browser/sender-client.ts` is a scripted sender that makes its own media;
  `tests/browser/remote-e2e.spec.ts` runs the whole scenario with real `/control` and `/send`
  pages. The gate proves structure and order; the millisecond bounds are the owner's checks.

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
  overlay shows the current scale. At 50% the controller also reports how long the mean has been
  above budget, for the guard (Profiles, above).

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
  External control: `djv.controlAddress` on the screen machine (the address for the QR code);
  `djv.controlKey` (the session key) and `djv.controlMode` (`dj` or `vj`) on a controller's LAN
  origin; `djv.sendKey` and `djv.sendChoice` (what it sends and from which device) on a sender's.
- **Certificates.** `DATA_DIR/tls/root.key`, `root.crt`, `server.key`, `server.crt` (PEM), made at
  the first switch-on (B-06). Git ignores `data/`, the default location
  (`tests/meta/tls-boundary.test.ts`). The restore plan is to delete the folder; every device then
  trusts the new root again.
- **Profile definition.** `definition` may carry `primary` (B-04 SD10), written only when set;
  rows and version-1 files without it stay valid and `formatVersion` stays 1. It may carry
  custom effects with their code (B-03), with no migration; a B-02-era build would read such a
  row as unusable.
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
zod parse of five variables, all required, no defaults in code: `APP_ENV` (`development`,
`test`, `production`), `LOG_LEVEL` (`debug`, `info`, `warn`, `error`), `PORT` (1 to 65535),
`CONTROL_PORT` (1 to 65535 and different from `PORT`, checked only when both parse; the External
control listener's port, nothing listens on it until switched on) and `DATA_DIR` (a non-empty
path). `loadConfigFromProcess()` is the single `process.env` reader.
`.env.example` is the contract; `scripts/setup.sh` copies it to `.env.local`.

The run scripts start `node --env-file-if-exists=.env.local` from the repository root, so a
relative `DATA_DIR` resolves against the root and the process environment wins over the file.
Any missing or malformed variable is one `fatal` log line naming every bad variable, never a
value, and exit 1 before the database is opened. A `DATA_DIR` that cannot be created or written
is reported the same way. `scripts/dev.ts` learns `PORT` for the Vite proxy by importing
`config.ts`.

## Cross-cutting

- **Auth.** None (SDR question 3). The main listener binds `127.0.0.1` only, so no other device
  can reach it, `/api/profiles` included (`server/test/boot.int.test.ts`). The External control
  listener is the only door to the LAN: open only while switched on, HTTPS only, it serves no
  API, and a device needs the code and an approval (External control, above).
- **Writes** (B-02 SD18). No response carries a CORS header. A `POST` or `PUT` without
  `Content-Type: application/json` is 415, answered before the body is read, and `text/plain` is
  not a parser, so a page on another origin cannot write with a simple request. The body limit
  is 128 KB (B-03 SD16: twelve custom effects fit one save), 1 MB for an import (413).
  `server/src/app.ts` sets all three.
- **Requests a running set makes.** `GET /`, `/assets/*`, `/api/health`, the screen socket
  (`/api/control/screen`, one WebSocket from load), and `/api/profiles` and `/api/profiles/:id`
  only on a user action in the panel or on a paired controller (Start, opening the panel,
  picking a profile, a controller connecting or pressing Refresh); no media endpoint exists
  (`docs/invariants.md`, `tests/browser/live.spec.ts`). A sender's peer connection is not an
  HTTP request, and the screen page opens no further socket for it.
- **Logging.** pino JSON lines on stdout at `LOG_LEVEL`. Fastify's request id (`reqId`) is on
  every line that belongs to a request. The environment and the config object are never
  logged whole. The server logs profile create, update, delete and import at `info` with the id
  and revision, never the definition. External control logs on and off (addresses, port), a new
  code (never the code), screens connecting and superseded, and each device step by its sequence
  label ("Device 3"); control messages at `debug`, type only. Never a code, a session key, a
  User-Agent, a device hint, a camera label or a colour. Senders (B-06) are logged as "sender
  <step>" with the sequence label and the role; a certificate issued with its addresses and
  expiry date, never a key; setup messages at `debug`, type only, never an SDP or a candidate.
  The browser logs capture state changes (for remote audio `remote audio lost`, `fallback
  local`, `restored remote`, by sequence label) and profile switches at info level, and guard
  events at warn with the profile id, without device labels, media data or profile code
  (`tests/browser/remote-e2e.spec.ts` checks every line of a whole run).
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
