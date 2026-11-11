# Spec: b-01 — Live visual engine

Status: Approved · Depends on: Phase 0 (`docs/specs/phase-0-walking-skeleton.md`, built) ·
Fixes: — · Backlog: B-01

Line references are to `main` at `d38a893`.

## Problem

During a set, people dance in front of a screen that shows nothing, or canned loops that have no
relation to the music playing right now. The product exists to fix that, and today it does not
do the first thing it is for:

- The renderer draws one thing: a solid clear colour that drifts with the frame timestamp
  (`engine/src/index.ts:38-40`, `engine/src/colour.ts:12`). It has no shader, no texture, no
  input. `createEngine(canvas)` takes only a canvas (`engine/src/index.ts:22`).
- Nothing captures audio or video. No code calls `getUserMedia`, `getDisplayMedia` or creates
  an `AudioContext` anywhere in `engine/`, `web/` or `server/`.
- The screen page mounts the engine and nothing else (`web/src/Screen.tsx:14-31`). Its only
  control is the `o` overlay key (`web/src/Screen.tsx:33-40`), so there is no way to choose a
  camera or an audio source, or to start capture (browsers require a user click first).
- The overlay shows fps, frame time and server health (`web/src/Overlay.tsx:50-56`). The SDR's
  observability decision promises an audio-to-pixel latency estimate there too (SDR §2, row 8);
  it does not exist, and so the SDR's top risk ("audio-to-pixel latency feels out of sync with
  the beat", SDR §8) cannot be held to a number.
- Phase 0 deferred fullscreen and Screen Wake Lock to this item (`phase-0` spec, Out of scope,
  "B-01 risk mitigations").
- Nothing reacts to a GPU that cannot keep up: the overlay reports fps and does nothing about it.

Cost today: the app cannot be played at a gig. B-02 to B-05 have nothing to shape or control.

## Decisions

- **SD1 — Local cameras only; the phone camera is a separate item, B-05.** A USB or built-in
  webcam needs only `getUserMedia` on `localhost`. A phone needs a LAN bind, HTTPS on a LAN
  address, the pairing token and WebRTC signalling: it breaks the `127.0.0.1`-only invariant
  (`docs/invariants.md:26`, `server/src/boot.ts:83`) and the SDR gives the pairing design to
  B-04. B-05 is ordered after B-04. The renderer takes the camera as a plain video source, so
  B-05 adds a source, not an engine change.
- **SD2 — Two latency numbers.** In-app, audio block to frame submit: p95 ≤ 50 ms, measured and
  shown in the overlay. End to end, speaker to lit pixel: ≤ 100 ms on the owner's screen
  machine, checked once by slow-motion film at verification. Latency must also be stable:
  jitter matters as much as the mean (a steady lag of 100 ms reads as in sync; a wandering one
  does not).
- **SD3 — Two audio sources, the input device guaranteed.** A source picker lists input devices
  (`getUserMedia`; a mixer line-out through an audio interface appears here as a microphone) and,
  where the browser supports it, "System audio" (`getDisplayMedia` with audio). Both feed the
  same analysis as a `MediaStream`. If the share dialog is cancelled or the stream has no audio
  track, the panel says so and the previous source stays.
- **SD4 — Reactive features only.** Analysis extracts four signals: overall level (RMS); three
  band energies, low (below about 150 Hz), mid, high; and a beat pulse from spectral flux on the
  low band with an adaptive threshold. No tempo tracking and no full spectrum (both additive
  later). Computed in an `AudioWorklet` over windows of about 10 ms. Per-feature smoothing is a
  named constant.
- **SD5 — Two separate dials: recognisability and audio reactivity.** Recognisability runs from
  the camera clearly visible (0) to unrecognisable but still camera-shaped (1): pixelation,
  posterising and feedback smear increase with it; at 1 the output is moving fields of colour
  that follow the camera's light and motion and no face can be made out. The camera always
  drives the picture. Audio reactivity (0 to 1) scales how strongly the audio features distort
  the picture; at 0 the output depends on the camera and time only. The audio-to-look mapping:
  low band pulses scale, beat pulse displaces and flashes, high band adds grain and edges,
  level lifts brightness. Both dials are live.
- **SD6 — Operation through a settings panel on the screen page.** The `s` key toggles a panel
  with a camera picker, an audio source picker and the two sliders, over the canvas, like the
  overlay's `o` (`web/src/Screen.tsx:34-40`). A Start button on first load grants permissions
  and starts the audio context. Chosen device ids are remembered across reloads in browser
  storage; the dials reset to their defaults on reload. The panel is scaffolding that B-04's
  control surface replaces for live use.
- **SD7 — The picture never stops and never shows an error.** Lost audio: the features decay
  smoothly to zero, so the look settles to the calm idle (the existing colour drift). Lost
  camera: the look switches to the no-camera input (SD10). The condition shows only in the
  overlay and the panel (`audio: lost`, `camera: lost`), never on the output. The app listens
  for `devicechange` and retries every 2 s, and reattaches without a click when the device
  returns. If the browser needs a click to resume audio, the panel says so and the idle look
  continues until then.
- **SD8 — Automatic render scaling.** The target is the display's refresh rate. If frame time
  stays above budget for about 2 s the engine lowers the internal render resolution in steps
  (100%, 75%, 50%, never lower) and scales the result up to the window; it steps back up after
  about 10 s of headroom. Steps are gradual, not a jump. The overlay shows the current scale. A
  manual cap (100/75/50%) in the panel limits the automatic maximum.
- **SD9 — Input processing off.** Echo cancellation, noise suppression and auto gain control
  are disabled on every audio request: all three damage music analysis. *(default, not asked)*
- **SD10 — No-camera look.** When no camera is available, permission is denied, or the camera is
  lost, the same look renders from a generative input (a slow noise field), driven by audio
  only. The overlay says `camera: none`. *(default, not asked)*
- **SD11 — A new workspace package `audio/`, framework-free like `engine/`.** It owns the
  `AudioWorklet`, the analysis maths and the `AudioFeatures` object. `engine/` receives
  features as a plain object and never imports `audio/`; the shape is defined in each package
  and `web/` wires them, with a type-level check that they stay compatible. `audio/` declares
  no dependency and imports no package, enforced like `engine/`
  (`tests/meta/engine-boundary.test.ts`, extended). This changes
  `docs/design/architecture.md`, which is the owner's: approving this spec approves that edit.
  *(default, not asked)*
- **SD12 — Chromium only.** The supported browser is current Chrome or Edge on the screen
  machine; Playwright already runs Chromium only. `getDisplayMedia` system audio is a Chromium
  feature. *(default, not asked)*
- **SD13 — Fullscreen and Screen Wake Lock are in.** The `f` key toggles fullscreen; while
  capture runs the page holds a screen wake lock and re-acquires it when the page becomes
  visible again. An unavailable lock shows in the overlay, not on the output. *(default, not
  asked)*
- **SD14 — Nothing leaves the machine.** Camera frames and audio never reach the server, are
  never written to disk, and are never recorded. The server is unchanged by this item: no
  endpoint, no table, no migration. *(default, not asked)*
- **SD15 — How the in-app latency is measured.** For each presented frame: frame submit time
  minus the capture time of the newest audio sample included in the features that frame used,
  plus the `AudioContext`'s `baseLatency`. The overlay shows the last value, p95 over 10 s,
  and the worst value over 10 s. It excludes the audio interface's input buffer and the display
  scan-out (the film check covers those). *(default, not asked)*
- **SD16 — Defaults of the dials:** recognisability 0.3, audio reactivity 0.7. *(default, not
  asked)*
- **SD17 — Tests use Chromium's fake media devices** (`--use-fake-device-for-media-stream`,
  `--use-fake-ui-for-media-stream`, `--use-file-for-fake-audio-capture` with a click-track
  file) added to `playwright.config.ts:29`. The browser test viewport is reduced (640×360) to
  keep software WebGL stable. *(default, not asked)*
- **SD18 — The overlay grows:** latency (last, p95, worst), render scale, `audio:` and
  `camera:` state (`ok`, `lost`, `none`), wake lock state. Meters for the four features are
  shown in the panel. *(default, not asked)*

## Users and permissions

| Role | Can | Cannot |
|---|---|---|
| Owner on the screen machine | Start capture, pick camera and audio source, set both dials, set a quality cap, toggle overlay (`o`), panel (`s`), fullscreen (`f`) | Reach the page from another device (bound to `127.0.0.1`, unchanged) |

Camera and microphone access is the browser's permission, granted on first Start for
`localhost` and remembered by the browser. No app-level auth (SDR question 3).

## In scope

- `audio/` (new package): `AudioWorklet` processor, analysis maths as pure functions, the
  `AudioFeatures` type, source helpers that turn a `MediaStream` into a feature stream. Public
  surface `audio/src/index.ts`.
- `engine/`: a shader pass that takes a video texture (or the generative input), the two dials
  and the feature object; the render-scale controller; per-frame latency record; stats extended
  with render scale. Still no dependency. `createEngine` keeps its signature (or extends it
  compatibly).
- `web/`: the Start flow, the settings panel (`s`), device pickers and persistence, the `f` key,
  wake lock, source-loss handling and retry, wiring `audio/` to `engine/`, overlay additions.
- `tests/meta/engine-boundary.test.ts`: extended to `audio/`.
- `playwright.config.ts`: the fake-media flags (SD17).
- Docs: `docs/design/architecture.md` (the `audio/` package, the media flow, the latency
  measurement), `CLAUDE.md` Conventions line for `audio/`, `docs/invariants.md` (the new
  boundary row), backlog entries B-04 and B-05.

## Out of scope

- Phone or any remote camera, WebRTC, pairing token, any bind address other than `127.0.0.1`
  (B-05, B-04).
- Profiles, a profile data model, the builder, saving anything the dials produce, import and
  export (B-02). The two dials and the look are hard-coded here and are what B-02 will make
  configurable.
- Live set controls on a second device (B-04). The `s` panel is scaffolding.
- Tempo or beat-phase tracking, a full spectrum, more than the four features (SD4).
- More than one look; transitions between looks.
- Server-side rendering, any server, database or API change (SD14).
- Recording, streaming out, or saving camera frames or audio.
- Browsers other than Chromium (SD12); mobile browsers.
- Multiple simultaneous cameras or audio sources; mixing sources.
- Audio output or monitoring: the app never plays sound.
- Calibrating latency automatically against the real speaker; the film check is manual.
- A hosted deployment.

## Acceptance criteria

- **AC1.** When the screen page loads before Start is pressed, the system shall render the idle
  look, request no camera or audio permission, and show a Start button in the settings panel.
- **AC2.** When Start is pressed, the system shall request the chosen camera and audio source
  with echo cancellation, noise suppression and auto gain control disabled, start the audio
  context, and begin feeding features and video frames to the renderer.
- **AC3.** When the settings panel is open, the system shall list the available cameras and
  audio input devices, and offer "System audio" only if the browser supports it.
- **AC4.** If the system-audio dialog is cancelled or yields a stream without an audio track,
  then the system shall keep the previous source and show the reason in the panel.
- **AC5.** When a camera or audio device is chosen, the system shall remember its id and
  select it again on the next load while it is present.
- **AC6.** While audio plays, the system shall compute level, low, mid and high band energies
  and a beat pulse from windows of at most 10 ms, each in 0 to 1, and the beat pulse shall
  fire on the low-band onsets of a click track and not between them.
- **AC7.** While audio reactivity is 0, the system shall render output that does not depend on
  the audio; while it is above 0, a beat pulse shall change the output within one frame of the
  pulse reaching the renderer.
- **AC8.** While recognisability is 0 and reactivity is 0, the system shall render the camera
  image unchanged within a fixed colour tolerance; while recognisability is 1, the output shall
  have no detail finer than the abstraction block size, and still change when the camera image
  changes.
- **AC9.** When either dial is moved, the system shall apply the new value on the next frame
  without restarting capture.
- **AC10.** While a set runs on the owner's screen machine, the in-app audio-to-frame latency
  shall have p95 ≤ 50 ms over any 10 s window, shown in the overlay as last, p95 and worst
  (SD15).
- **AC11.** When the end-to-end latency is filmed in slow motion on the owner's screen machine
  (speaker click to lit pixel), the system shall show it ≤ 100 ms (verification step).
- **AC12.** If the audio source is lost, then the system shall decay the features to zero
  within 1 s, keep rendering the idle look, show `audio: lost` in the overlay and the panel and
  nothing on the output, and reattach without a click when the device returns within 2 s of its
  return.
- **AC13.** If the camera is lost, denied or absent, then the system shall switch to the
  generative input, keep rendering, show `camera: lost` or `camera: none` in the overlay and
  the panel and nothing on the output, and reattach without a click when the camera returns.
- **AC14.** If the browser suspends the audio context and a click is needed to resume it, then
  the system shall say so in the panel and keep the idle look until the click.
- **AC15.** While frame time stays above budget for 2 s, the system shall lower the render
  scale one step (100, 75, 50%), never below 50%, scale the result to the window, and show the
  scale in the overlay; after 10 s with headroom it shall raise it one step. A manual cap in
  the panel shall bound the maximum.
- **AC16.** When `f` is pressed on the screen page, the system shall toggle fullscreen; while
  capture runs the system shall hold a screen wake lock, re-acquire it when the page becomes
  visible again, and show `wake lock: unavailable` in the overlay if it cannot.
- **AC17.** While the system runs, no camera frame or audio sample shall be sent to the server
  or written to disk, and the server shall expose no new endpoint.
- **AC18.** When `audio/package.json` gains a dependency of any kind or its compiled output
  imports a package, the unit step shall fail (as AC16 of Phase 0 does for `engine/`).
- **AC19.** When `web/` passes an `AudioFeatures` value from `audio/` to the engine, the type
  check shall fail if the two shapes drift apart.
- **AC20.** While the Phase 0 behaviour is unchanged, `o` still toggles the overlay, `GET
  /api/health` still answers, the server still listens on `127.0.0.1` only, and the Phase 0
  tests still pass.

## Data

None. No table, migration or server state (SD14). The remembered device ids live in browser
storage under one named key and hold no profile data.

## API contract

None. No server endpoint is added or changed.

Internal contract (between packages, not HTTP): `audio/` emits `AudioFeatures`
`{ level, low, mid, high, beat, capturedAt }` (numbers in 0 to 1 except `capturedAt`, in
milliseconds on the same clock as `performance.now()`). The engine accepts that shape, the two
dials `{ recognisability, reactivity }`, a video source or none, and reports frame statistics
plus latency samples.

## UI

The screen page `/`:

- **Before Start:** canvas with the idle look; settings panel open with a Start button, the
  pickers disabled.
- **Running:** full-window canvas, no chrome. `o` overlay, `s` panel, `f` fullscreen, each
  hidden by default.
- **Overlay (`o`):** fps, frame ms, server, latency (last / p95 / worst), render scale, `audio:`
  and `camera:` state, wake lock.
- **Panel (`s`):** camera picker, audio source picker (with "System audio" when supported),
  recognisability and reactivity sliders, quality cap, four feature meters, a one-line reason
  for any source problem.
- **Lost / denied / none:** only in the overlay and panel (SD7); the output never shows text.
- **No WebGL2:** unchanged from Phase 0, one line replaces the canvas.

## Non-functional

- Performance: in-app latency per SD2/AC10; frame rate held at the display refresh rate down to
  the 50% render-scale floor on the owner's screen machine; analysis stays within its own
  thread and does not depend on the render scale.
- Privacy: SD14. Permissions are the browser's.
- Accessibility: the panel is operable by keyboard (tab order, labelled sliders); the output has
  no flashing beyond the beat flash, whose strength is bounded by the reactivity dial.
- Logging: capture state changes (started, lost, retried, restored) are logged to the browser
  console at info level; no audio or video data and no device labels in any server log.
- Limits: one camera and one audio source at a time.

## Edge cases and failure modes

- **Mid-set source loss:** SD7, AC12, AC13.
- **Restart or page reload mid-set:** capture stops; the page reloads to the idle look with the
  remembered device ids preselected and Start required (browsers need a click). The server is
  stateless for this item, so a server restart changes nothing on screen.
- **Tab hidden, minimised or screen asleep:** the wake lock prevents sleep; if the tab is
  throttled anyway, the overlay shows the frame-rate drop and capture continues. Resuming the
  audio context may need a click (AC14).
- **No network:** nothing in this item uses a network beyond loopback.
- **Permission denied or revoked:** the source shows as lost or none; the panel explains how
  the browser setting is changed.
- **Device unplugged and replugged with a new id:** treated as a new device; the remembered id
  no longer matches and the picker keeps the current choice.
- **Two pages at once:** a second screen page competes for the same camera; the second request
  may fail, which shows as `camera: lost`. Not designed for.
- **GPU cannot keep up:** SD8, AC15. In CI the software renderer is slow, so the gate's
  latency check measures the CPU-side analysis-to-submit time and runs at the reduced viewport
  (SD17); GPU execution time and scan-out belong to the film check.
- **Quiet or silent input:** the adaptive beat threshold must not fire on noise; silence gives
  zero features and the idle look.
- **Loud, clipped input:** features are clamped to 0 to 1; a clipped signal does not make the
  visuals pin at maximum for longer than the smoothing allows.
- **Guarded areas:** none exist (`docs/invariants.md`, Guarded areas). This item touches none;
  it does extend the engine-boundary invariant to a second package (SD11).

## Verification

1. `bash scripts/setup.sh`, then `bash scripts/check.sh`: every step passes, including the new
   unit tests (analysis maths on synthetic signals, render-scale controller, latency
   percentiles) and the browser tests with the fake devices.
2. `pnpm start`, open `http://localhost:8000/`: idle drift, settings panel with Start. Press
   Start; allow camera and microphone. Pick the audio interface as the audio source and play a
   track through the mixer: the four meters move, the picture reacts on the kick.
3. Move reactivity to 0: the picture ignores the music. Move recognisability from 0 to 1: the
   camera image goes from clear to unrecognisable fields of colour that still follow movement.
4. Choose "System audio" with a track playing on the laptop: same behaviour. Cancel the share
   dialog: the panel says so and the previous source stays.
5. Press `o`: latency p95 ≤ 50 ms over a minute, render scale 100%, `audio: ok`, `camera: ok`,
   wake lock held. Press `f`: fullscreen.
6. Unplug the audio interface mid-track: the picture settles to idle within a second, no text
   on the output, overlay says `audio: lost`. Replug: it resumes without a click. Same with the
   webcam: the generative look takes over and returns.
7. Load the machine (a second heavy browser tab) until frames drop: the render scale steps down
   gradually and the overlay shows it; remove the load and it steps back up.
8. Film speaker and screen in slow motion (a phone at 240 fps) with a click track: the lit
   pixel follows the click by ≤ 100 ms, steadily over several seconds.
9. `curl http://<LAN address>:8000/api/health` is still refused; the server log shows no media
   data.
10. Push a branch: CI runs the same gate and is green.

## Exit condition

On the owner's screen machine, a live audio source and a local camera drive a full-window
picture that reacts to the beat within 100 ms end to end, the two dials change it live, a lost
source never reaches the audience, and `bash scripts/check.sh` proves all of it that a machine
can prove.

## Open questions

None, when Status is Approved. For the owner at approval: the `audio/` package and the edit to
`docs/design/architecture.md` (SD11), and the defaults marked *(default, not asked)*.
