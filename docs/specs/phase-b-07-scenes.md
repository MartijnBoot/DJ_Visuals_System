# Spec: b-07 — Scenes

Status: Approved · Depends on: B-02 (`docs/specs/phase-b-02-visual-profiles.md`, built), B-04
(`docs/specs/phase-b-04-live-set-controls.md`, built), B-06
(`docs/specs/phase-b-06-remote-input-devices.md`, built), B-09
(`docs/specs/phase-b-09-transitions.md`, built), B-12 (`docs/specs/phase-b-12-hosted-home-oracle.md`,
built: hosted mode), B-18 (`docs/specs/phase-b-18-effect-strength-faders.md`, built), B-19
(`docs/specs/phase-b-19-controller-lighting-desk.md`, built) · Fixes: — · Backlog: B-07

Line references are to `main` at `00c6728`.

## Problem

A set has moments: a crowd shot with warm colours, a booth shot abstracted and fast. Changing the
mood of the room today means changing a profile, the dials, the colours, the strengths and the
camera one control at a time, and every one of those changes reaches the screen the moment it is
made. A VJ cannot build the next look without the room watching it being built.

- A controller's every control acts on the live look at once: `createApplier` applies `pick`,
  `dials`, `colour`, `resetColour`, `camera`, `effect` and `transition` in the next frame
  (`web/src/control/apply.ts:43-112`). Nothing is staged.
- There is nowhere to keep a look. A pick resets the live palette, the live strengths and the
  dials to the profile's stored values (`web/src/profiles/active.ts:217-223`); live edits are
  memory only and die with the page (`active.ts:136-149`; B-04 SD7, ADR 0001: "live changes are
  never saved into profiles").
- Only profiles are stored, in one table (`server/migrations/0002_profiles.sql:3-10`). The latest
  migration is `0003_sync.sql`. Only profiles sync (`server/src/sync/routes.ts`,
  `shared/src/sync.ts`).
- A profile's id is not stable: an import gives every profile a new id (B-02 SD7;
  `server/src/profiles/store.ts:460-469`), a sync full pull gives unsynced local rows a new one
  (`store.ts:638-649`) and a conflict inserts the local version under a new one (`store.ts:296-310`).
  An effect's live strength is addressed by its position in the stack
  (`active.ts:317-322`), so it means something else after the profile is edited.
- A remote camera's id, `remote:<deviceId>`, is random per pairing
  (`server/src/control/pairing.ts:117-122`, `web/src/remote/sources.ts:141-151`), so a stored one
  is dead after any re-pair or restart. A local camera is identified by the browser's `deviceId`
  alone (`web/src/capture/devices.ts:47-50`).
- The engine draws one look per frame, or two while a transition runs (B-09). There is no second
  render of any kind on the screen page; the builder's preview is its own page with synthetic input
  (`web/src/builder/Preview.tsx`).
- The screen page's hosted build has no controllers and no screen socket (`boot.ts:152-155`), and
  the hosted bearer guard covers a fixed list of paths, `/api/profiles*` and `/api/sync/*`
  (`server/src/auth/guard.ts:33-35`).

Cost today: a change of mood is several visible moves, and a look built live cannot be kept or
rehearsed.

## Decisions

The owner's answers from the interview (2026-11-26), then defaults marked as such.

- **SD1 — A scene is a saved look plus a feed plus a transition.** It holds: the profile as it was
  when the scene was saved, **carried as a full copy** with the live palette edits and live effect
  strengths baked in (SD3); the dials; the video feed (SD6); and the transition's type and
  duration. It holds no main-audio choice, no Keep colour (the scene's palette is already what it
  is) and no quality cap.
- **SD2 — A staged look is the look being built off to the side; the venue output never shows
  it.** A new staged look exists on the screen page from the moment someone stages one until it is
  unstaged, saved over, or the page reloads. It has its own profile, live palette, live strengths,
  dials, feed choice and transition choice (type and duration). The output draws the live look only
  (B-01 SD7: the output never shows text or anything but the look).
- **SD3 — Staging comes from the live look, a profile or a scene; Go makes it live.** *Stage from
  live* copies the live look into the staged look. Picking a profile while editing the staged
  look loads that profile into it, with its starting dials and stored palette. Tapping a saved scene
  stages it. A scene is **always staged first, never recalled straight to the output**, from a
  controller or the panel. **Go** starts the transition to the staged look, using the staged
  look's own transition type and duration, which the VJ can change while staging. After Go the
  live look is the staged one, and the staged look is a fresh copy of it, still tied to the scene it
  came from (SD11). The current transition choice (`djv.transition`, B-09 SD5, SD9) is not touched
  by staging or Go: this is the one place a pick does not use it, and a pick from the profile
  tiles in live editing still does.
- **SD4 — Each control carries which look it edits.** The `pick`, `dials`, `colour`,
  `resetColour`, `camera`, `effect` and `transition` controls gain an optional `target`, `"live"`
  (the default, so every B-04 message means what it meant) or `"staged"`. On `/control` in VJ mode
  a switch in the Scenes section, "Editing: Staged / Live", sets the target of the controls that
  controller sends; it is that controller's own setting and defaults to Staged when a staged look
  exists. DJ mode has no switch and always edits the live look. *(default, not asked)*
- **SD5 — The staged look edits never become a profile.** ADR 0001's "live changes are never saved
  into profiles" is kept: a staged edit changes no profile; it can become a scene (SD11), which is
  a separate thing and carries its own copy of the profile (SD1). No request writes
  `/api/profiles*` while staging, saving or going.
- **SD6 — The feed is stored as a kind plus a label, and recall keeps the current camera if it
  cannot match.** A scene's feed is `local` (the `deviceId` and the label), `remote` (the sender's
  hint, "Browser on OS", B-04 SD26) or absent (no camera was on screen). On Go: a local feed matches
  by `deviceId`, then by label; a remote feed matches when exactly one connected sender with video
  has that hint. A match switches the camera as a pick does (the previous picture stays until the
  new one's first frame, B-06 SD12). When nothing matches, the current camera stays, the rest of
  the scene applies, and every controller and the panel show "Feed unavailable — kept the current
  camera" in the reason line (the output shows nothing). An absent feed leaves the camera alone.
  There is no "no camera" feed until B-11. The camera switch happens at Go with the transition;
  transitions between feeds stay out of scope (B-09).
- **SD7 — Scenes live in the local install's database and travel over the screen socket.** A new
  table `scenes` (migration `0004_scenes.sql`): id, name (unique ignoring case, 1 to 60 characters,
  trimmed), definition (JSON), created and updated times. Only `server/src/scenes/store.ts` writes
  SQL for it. The screen page lists, saves, renames and deletes scenes through the screen socket
  (B-04 SD25), so there is no new HTTP endpoint and the request allow-list in `docs/invariants.md`
  does not change. Scenes are **not synced** to the cloud, and the table has no sync columns. A
  hosted server (`APP_MODE=hosted`) never offers scenes: no socket, no controller, no UI.
- **SD8 — Scenes export and import as a file.** One bundle file, `<name>.djv-scenes.json`:
  `{ formatVersion: 1, scenes: [ { name, profile, dials, feed, transition } ] }`, each `profile`
  in the shape of a profile file's entry (`shared/src/profile.ts`, `toProfileFile`) and validated
  against the shared schema before anything is stored. Import only adds: every scene gets a new id,
  a taken name becomes "Name (2)", "Name (3)", …, a file that fails stores nothing and names the
  scene and the field. The panel exports and imports. Because a scene carries its profile (SD1),
  the file is self-contained and needs no matching profile on the other machine.
  *(file name and shape: default, not asked)*
- **SD9 — Saving asks, never overwrites silently.** Save with a name creates a scene. When the
  staged look came from a saved scene, Save offers "Update *name*" (replace its content, keep its
  id and name) or "Save as new"; the update is always an explicit choice. A name that is taken is
  refused with "That name is taken". Rename and Delete exist on the controller (VJ mode) and in the
  panel; Delete asks to confirm. Scenes list by name, case-insensitive, with no manual order.
  *(list order and the Delete confirmation: default, not asked)*
- **SD10 — Scenes are VJ mode and panel only.** The Scenes section is on `/control` in VJ mode,
  at the top of the scrolling content, above Profiles *(position: default, not asked)*. DJ mode is
  unchanged and always edits the live look. The panel gets a scene picker with Stage, Go, Delete,
  Export and Import, and no staged editing and no picture *(default, not asked)*. Staged editing
  is from controllers only. DJ-mode controllers still mirror live changes made by a Go.
- **SD11 — One shared staged look; last change wins.** Every approved controller sees and edits
  the same staged look (B-04 SD5), and any of them can press Go. The staged look remembers the scene
  it came from (`fromScene`) until it is staged from something else; if that scene is deleted, Save
  offers "Save as new" only.
- **SD12 — The preview is a second render on the screen machine, streamed to one controller.** The
  screen page runs a second engine instance for the staged look, over the live camera picture and
  the live audio features, at most 320×180 and 10 frames a second, and streams that canvas to the
  controller peer to peer over the LAN (WebRTC, no ICE server, the screen page the sender; the
  server relays only setup messages, B-06 SD10, SD16). The staged feed is not opened: the preview
  shows the staged look over the live camera, and a line "Feed: *label* (applies at Go)" says what
  Go will switch to. *(the 320×180 and 10 fps: default, not asked)*
- **SD13 — One stream at a time.** The preview goes to the controller that most recently opened
  the Scenes section with a staged look. Another controller shows "Preview is on another controller"
  where the picture would be, and sees the staged state in controls. Opening the Scenes section on
  that controller takes the stream over.
- **SD14 — The preview yields first.** The second engine pauses, keeping the last picture with
  "Preview paused — busy", whenever the live engine's frame time is over budget (the scale
  controller's own over-budget reading, B-01 SD8) and while a transition runs (B-09). It resumes
  after 2 s back under budget. With no controller watching the staged look, no second engine
  renders and nothing is encoded. The output's per-frame draw count never changes (B-09 AC13). The
  50 ms p95 with the preview running is a human check; the gate's check is structural (B-08).
  *(the 2 s: default, not asked)*
- **SD15 — A preview that cannot connect never blocks staging.** After 10 s without a connection
  the controller shows "Preview unavailable"; staging, saving and Go work blind. The output shows
  nothing. A lost screen page, a screen reload or a lock ends the stream and frees the second
  engine's targets.
- **SD16 — Go and a running transition.** Go during a running transition ends it and starts the
  new one, as any pick does (B-09 SD2). Go with a look that did not change since the last Go still
  runs the transition. Two controllers pressing Go at once: the screen applies them in arrival
  order, as any two picks. *(default, not asked)*
- **SD17 — A live look built from a scene reports `scene:<id>` as its active id.** The state's
  `activeId` is `scene:<sceneId>` after Go of a scene or of a look staged from one, so the profile
  tiles show none pressed; after Go of a look built from a profile it is that profile's id, as a
  live edit is today. Live palette and strength edits on a scene's look reset to the scene's
  palette and amounts, as they reset to a profile's stored ones. A scene's look is not remembered
  across a reload: the reload returns to the last real profile picked (`djv.profile`, B-04 SD13).
  *(default, not asked)*
- **SD18 — Saving builds the scene on the screen page, not the controller.** A controller sends
  small messages (`saveScene { name, updateId? }`, `renameScene`, `deleteScene`, `stage`, `go`,
  4 KB limit, B-04 SD20); the screen page, which holds the staged look, builds the scene and sends
  it to the server over the screen socket (limit 256 KiB). A scene's definition is at most 128 KiB
  and the table holds at most 200 scenes; beyond either, saving is refused with a reason.
  *(limits: default, not asked)*
- **SD19 — Validation and trust.** Every scene is validated against a schema in `shared/` on
  write, on read and on import; a row that fails is left out of the list with one `warn` naming its
  id, as unreadable profiles are (`docs/design/architecture.md`, Data). A scene's profile copy goes
  through the same shared schema, so a custom effect's code is still GLSL only and reaches the
  browser only through `shaderSource` (B-03 SD1). *(default, not asked)*
- **SD20 — Logging.** The server logs at `info` a scene saved, updated, renamed, deleted,
  imported (ids and counts) and a preview stream opened or ended (the controller's sequence label).
  Control messages at `debug`, type only. Never a scene's name, definition, an SDP or an ICE
  candidate. *(default, not asked)*
- **SD21 — ADR 0004, invariants and design docs change; approving this spec approves the edits.**
  - `docs/adr/0004-scene-preview-to-controllers.md`: media now also flows screen machine →
    controller, LAN only, peer to peer, opt-in, with a bounded cost (SD14); ADR 0002 gets a note.
  - `docs/invariants.md`: the media row keeps "no media reaches the server" and adds that a
    controller may receive one low-resolution preview stream with no ICE server; the control row
    (B-04, B-06) adds that an approved *controller's* socket may also send the WebRTC setup
    messages of the preview, and a sender's still only its own; the hosted row (B-12) adds that a
    hosted server never offers scenes.
  - `docs/design/architecture.md` gains Scenes and the preview.
  - `docs/design/controller-style.md` is **not** changed by this spec. The Scenes section uses the
    brief's existing tiles, fader, toggle and panel frames; if the plan finds the preview frame or
    the Staged/Live switch needs an element the brief lacks, that is a stop for the owner (CLAUDE.md,
    hard stops: a change to `docs/design/`), not a decision for the plan. *(default, not asked)*
- **SD22 — No guarded area is touched.** `server/src/auth/` and `guardProfiles` in `boot.ts` are
  unchanged: scenes have no HTTP route, so the hosted bearer guard has nothing to guard (SD7). No
  dependency is added. *(default, not asked)*

## Users and permissions

| Role | Can | Cannot |
|---|---|---|
| Operator at the screen machine (`s` panel) | Everything before; stage a scene, press Go, delete scenes, export and import scenes | Edit the staged look; see the preview |
| Approved controller, VJ mode | Everything before; stage from live, a profile or a scene; edit the staged look; Go; save, update, rename and delete scenes; receive the preview | Disconnect anyone; export or import scenes |
| Approved controller, DJ mode | Everything before | See or use any scene control; edit the staged look |
| Sender (`/send`), waiting device, any other LAN host | Unchanged from B-04 and B-06 | Send or see a scene, the staged look or the preview |

## In scope

- `shared/`: `scenes` schema (the scene, its feed, the bundle file, SD8, SD19); `target` on the
  seven controls; the new controls `stage`, `unstage`, `go`, `saveScene`, `renameScene`,
  `deleteScene`; the preview's setup messages for a controller (offer, answer, candidate, with the
  controller's `deviceId`) and `previewStream` control; the screen state's `staged`, `scenes` and
  `preview` fields; the screen socket's scene messages (list, save, rename, delete, import).
- `engine/`: nothing new, unless the plan finds the second instance needs a seam; still no
  dependency and `Profile` unchanged. The staged look runs in a second `createEngine`-style
  instance with its own canvas.
- `server/`: migration `0004_scenes.sql`; `server/src/scenes/store.ts`; the screen socket's scene
  messages in `server/src/control/`; the preview setup relay (controller ↔ screen page) and the
  one-stream rule; hosted mode never wires any of it.
- `web/`: the staged look beside the live one in `profiles/active.ts` (or a sibling), the applier's
  `target`, Go, saving, feed matching (SD6), the second engine and its pause rule (SD14), the
  preview sender; the Scenes section on `/control` (VJ), the Staged/Live switch, the preview
  `<video>`; the panel's scene row; scene export and import.
- Docs: SD21's edits; a runbook entry for the human checks.
- Tests for every criterion below: unit (feed matching, staged-versus-live routing, the scene
  schema, pause rule), integration (the store, the screen socket, the relay, hosted never offering
  scenes), browser (a controller context staging and going, a second controller taking the stream).

## Out of scope

- Syncing scenes to the cloud, and anything for hosted use (SD7).
- A timeline, an auto-playing show, a set list, scene chaining, a scene that runs for a time.
- Manual order, folders or tags for scenes.
- Scenes in DJ mode; staged editing on the panel; a picture on the panel (SD10).
- A preview with the staged feed open, a second local camera open, or a second remote decode
  (SD12).
- Preview audio; a preview larger than 320×180 or faster than 10 fps; a preview on more than one
  controller at a time (SD13); recording the preview.
- Transitions between feeds (B-09); a "no camera" feed (B-11); naming feeds by role ("crowd").
- Storing the main-audio choice, the quality cap, Keep colour or the overlay in a scene.
- "Update this scene from its profile's current version" and any link from a scene back to the
  profile it came from.
- Scene recall straight to the output from a tile; a per-scene hotkey or MIDI.
- A scene that changes a profile; saving a staged look as a profile; a global colour layer (B-10).
- Changing the transition engine, the scale controller, the flash limiter or the guard.
- Fixing D-nn defects found while reading (see Edge cases, "found while specifying").

## Acceptance criteria

Staging and routing:

- **AC1.** When a controller in VJ mode presses "Stage from live", the screen shall copy the live
  look (profile with its live palette and live strengths, dials, the camera on screen if any, the
  transition's type and duration) into the staged look, leave the live look and the output
  unchanged, and every controller shall receive the staged look in the state.
- **AC2.** While a staged look exists, a `pick`, `dials`, `colour`, `resetColour`, `camera`,
  `effect` or `transition` control with `target: "staged"` shall change only the staged look; the
  live look, the output's pixels and the engine's profile and dials shall not change.
- **AC3.** When a control has no `target` or `target: "live"`, the system shall behave exactly as
  before this item; B-04, B-09 and B-18 browser and unit tests shall pass unchanged.
- **AC4.** If a control's `target` is anything but `"live"` or `"staged"`, then the system shall
  drop it with one `warn` naming its type and keep the socket open; while no staged look exists, a
  `target: "staged"` control shall be dropped and acknowledged.
- **AC5.** When a profile is picked with `target: "staged"`, the staged look shall hold that
  profile with its starting dials and stored palette; a failure shall show today's reason and leave
  the staged look as it was; a newer pick shall supersede a pending one.
- **AC6.** When a saved scene is staged from a controller or the panel, the staged look shall hold
  the scene's profile copy, palette, strengths, dials, feed and transition, `fromScene` shall name
  it, and the output shall not change.
- **AC7.** When Unstage is pressed, the staged look shall be discarded, the preview stream shall
  end, and the live look shall not change.
- **AC8.** While staging, saving and going, no request shall write `/api/profiles*`, and a staged
  edit shall change no stored profile.
- **AC9.** While a controller's switch reads "Live", or the controller is in DJ mode, its controls
  shall send no `target` or `"live"`; while it reads "Staged", the controls shall send
  `"staged"`; a staged look appearing shall set a VJ-mode controller's switch to Staged.

Go:

- **AC10.** When Go is pressed with a staged look, the screen shall switch live to it by the
  B-09 transition path using the staged look's transition type and duration, apply the staged
  dials, palette and strengths exactly as staged, and leave `djv.transition` and the current
  transition choice unchanged.
- **AC11.** When Go has been applied, the staged look shall be a copy of the new live look, still
  tied to the same `fromScene`.
- **AC12.** When Go is pressed while a transition runs, the system shall end it and start the new
  one (B-09 AC9); Go with no staged look shall do nothing and be disabled in the UI.
- **AC13.** When Go makes live a look staged from a saved scene, the state's `activeId` shall be
  `scene:<id>`, no profile tile shall be pressed, and a live palette or strength edit shall reset to
  the scene's values; when it makes live a look staged from a profile, `activeId` shall be that
  profile's id.
- **AC14.** When the screen page reloads, the staged look shall be gone, every controller shall show
  none, the scenes shall remain, and the page shall draw the remembered real profile (`djv.profile`).

Feed:

- **AC15.** When Go applies a scene with a local feed, the system shall switch to the local camera
  whose `deviceId` matches, else whose label matches, keeping the previous picture until the new
  camera's first frame; when Go applies a scene with a remote feed, it shall switch to the sender
  whose hint matches when exactly one connected video sender has it.
- **AC16.** If no camera matches, or the remote hint matches none or more than one connected
  sender, then Go shall keep the current camera, apply the rest of the scene, and every controller
  and the panel shall show "Feed unavailable — kept the current camera".
- **AC17.** When a scene has no feed, Go shall leave the camera as it is, with no note.
- **AC18.** While the staged look has a feed that differs from the live camera, the preview shall
  keep drawing over the live camera, no second camera shall be opened and no paused sender shall be
  resumed, and the Scenes section shall show "Feed: *label* (applies at Go)".

Scenes:

- **AC19.** When Save is pressed with a name, the system shall store a scene whose profile copy has
  the staged look's live palette and strengths baked in, with its dials, feed and transition, and
  every controller and the panel shall list it, ordered by name ignoring case.
- **AC20.** If the name is taken (ignoring case), empty or longer than 60 characters, then Save
  shall store nothing and say why.
- **AC21.** While the staged look came from a saved scene, Save shall offer "Update" and "Save as
  new"; Update shall replace that scene's content and keep its id and name; if that scene has been
  deleted, only "Save as new" shall be offered.
- **AC22.** When a scene is renamed or deleted from a controller or the panel, every surface shall
  show the new list; Delete shall ask to confirm first; a taken rename shall be refused.
- **AC23.** When the server restarts, every saved scene shall still be listed and stageable; a scene
  row whose definition fails the shared schema shall be left out of the list with one `warn` naming
  its id.
- **AC24.** If a scene would exceed 128 KiB or the table holds 200 scenes, then saving shall be
  refused with a reason and store nothing.
- **AC25.** When the panel exports the scenes, the file shall be `{ formatVersion: 1, scenes }`
  and importing it on an empty database shall give scenes that stage and Go identically; a taken name
  shall become "Name (2)"; an import shall store all or nothing; a file that fails validation shall
  store nothing and name the scene and the field.
- **AC26.** When a scene whose profile copy has a custom effect is staged and made live, the code
  shall reach the browser only through `shaderSource` (the B-03 boundary test shall hold).
- **AC27.** When the server runs hosted (`APP_MODE=hosted`), no scene message, route or UI shall
  exist, and `scenes` shall not be read or written.

Preview:

- **AC28.** When a controller in VJ mode opens the Scenes section while a staged look exists, the
  screen page shall render the staged look in a second engine at no more than 320×180 and 10
  frames a second and stream it to that controller; the peer connection shall have no ICE
  servers; the server shall relay only offer, answer and candidate messages; the output's canvas
  shall not change.
- **AC29.** While a controller receives the preview, a second controller shall show "Preview is on
  another controller"; when that controller opens the Scenes section, the stream shall move to it
  and the first shall show the same line.
- **AC30.** While the preview is on, it shall draw the staged look over the live camera picture
  and the live audio features.
- **AC31.** While the live engine's frame time is over budget, or a transition runs, the preview
  shall pause on its last picture with "Preview paused — busy" and resume after 2 s under budget;
  each frame of the output shall still draw one look, or two during a transition, and no more.
- **AC32.** While no controller watches the staged look, or after Unstage, a screen reload, a lock
  or a closed link, no second engine shall render, nothing shall be encoded and its targets shall
  be freed.
- **AC33.** If the preview has not connected within 10 s, then the controller shall show "Preview
  unavailable", staging, saving and Go shall still work, and the output shall show no text.
- **AC34.** While the preview, staging or a scene runs, the output canvas shall never carry text or
  the preview.

Controller, panel, messages, privacy:

- **AC35.** While `/control` is in VJ mode, the system shall show the Scenes section at the top of
  the scrolling content with Stage from live, the scene tiles, the Staged/Live switch, the
  preview, Go, Save/Update, Rename, Delete and Unstage; in DJ mode it shall show none of it; every
  target shall be at least 48×48 CSS px and the page shall not scroll sideways at 320 CSS px wide.
- **AC36.** While the controls are locked (B-04 SD12), the Scenes section shall be locked with them
  and send nothing.
- **AC37.** If an approved *controller's* socket sends a setup message other than the preview's, or
  a sender's socket sends any scene or preview message, then the server shall drop it with one
  `warn` naming its type (the B-06 AC9 rule).
- **AC38.** If a scene or preview message fails its schema or exceeds its limit (4 KB from a
  device socket, 16 KB for setup messages), then it shall be dropped with one `warn` naming its type
  and the socket shall stay open.
- **AC39.** While a set runs with scenes, the screen page shall make no request beyond the allow-list
  in `docs/invariants.md`; scenes shall travel only over the screen socket.
- **AC40.** No log line on the server or in the browser shall contain a scene's name or definition,
  an SDP, an ICE candidate, a key, a code, a User-Agent or a device label.

Human checks on the owner's screen machine and network:

- **AC41 (H1).** With the preview streaming to a phone and an 8 s Crossfade between the owner's two
  heaviest profiles, the overlay's audio-to-frame p95 shall stay at or below 50 ms and the output's
  frame rate shall not drop below the display's refresh rate; the preview shall pause during the
  transition and come back.
- **AC42 (H2).** On the phone in VJ mode, building a new look from the live one, editing its
  colours, strength and profile, seeing it in the preview, and pressing Go shall move the room to it
  by the chosen transition with nothing of the staging visible on the output.
- **AC43 (H3).** After a re-pair or a restart, a scene whose feed was a remote phone shall show the
  feed note and keep the current camera; with the phone re-paired and the hint matching, it shall
  switch.

## Data

- **Migration `server/migrations/0004_scenes.sql`:** table `scenes(id TEXT PRIMARY KEY, name TEXT
  NOT NULL COLLATE NOCASE UNIQUE, definition TEXT NOT NULL, created_at, updated_at)`. No sync
  columns, no tombstones, no link to `profiles`.
- **Scene definition (JSON):** `{ profile, dials, feed, transition }`.
  - `profile`: a profile definition (name, palette with the live edits baked in, dials, effects with
    their strengths baked in, `primary` when set, custom effects with their code).
  - `dials`: `{ recognisability, reactivity }`.
  - `feed`: `{ kind: "local", deviceId, label }` or `{ kind: "remote", hint }`, or absent.
  - `transition`: `{ kind, duration }`.
- **File:** `.djv-scenes.json`, `{ formatVersion: 1, scenes: [ { name, profile, dials, feed?,
  transition } ] }`.
- **Browser storage:** nothing new. `djv.transition` is unchanged; the Staged/Live switch is not
  stored.
- **Backups:** the local install's profile export does not carry scenes; the scenes file does
  (SD8). The cloud's backup routine (B-12) never sees the table.

## API contract

No HTTP endpoint is added or changed. Scenes travel over the screen socket and controls over the
device socket (`shared/src/control.ts`; exact shapes are the plan's):

| Message | Direction | Notes |
|---|---|---|
| `target` on seven controls | controller → server → screen | Optional, `live` default (SD4) |
| `stage { from: "live" \| { profile } \| { scene } }`, `unstage`, `go` | controller → server → screen | Controls with `seq`, acknowledged like any control |
| `saveScene { name, updateId? }`, `renameScene { id, name }`, `deleteScene { id }` | controller → server → screen | Small (SD18) |
| `scenes.list`, `scenes.save`, `scenes.rename`, `scenes.delete`, `scenes.import` | screen ↔ server (screen socket) | Up to 256 KiB; results come back as `scenes.result` |
| `previewStream { watching: boolean }` | controller → server → screen | Sets or releases the one stream (SD13) |
| preview `offer`, `answer`, `candidate` with the controller's `deviceId` | screen ↔ server ↔ controller | 16 KB, validated, no media (SD12) |
| `state.staged`, `state.scenes`, `state.preview` | screen → server → controllers | `staged`: the staged look's palette, dials, effect entries, feed label, transition, `fromScene`; `scenes`: `[ { id, name } ]`; `preview`: `"off" \| "on" \| "paused" \| "elsewhere" \| "unavailable"` |

## UI

- **`/control`, VJ mode:** a Scenes section at the top of the scrolling content: the preview frame
  (or its line: "Preview paused — busy", "Preview is on another controller", "Preview
  unavailable"), the Editing switch (Staged / Live), "Stage from live", a tile per scene (the staged
  one marked), Go, Save with a name field (Update or Save as new when the look came from a scene),
  Rename, Delete (with confirm), Unstage, and the line "Feed: *label* (applies at Go)". Every line
  and the feed note use the link and reason lines the controller already has. The controls below
  (Profiles, Transition, Effects, Camera, the pinned Wheel and FaderBank) edit what the switch says;
  the section says so in words beside the switch.
- **`/control`, DJ mode:** unchanged.
- **`s` panel:** a "scene" row: a picker, Stage, Go, Delete (with confirm), Export, Import, in the
  panel's existing style, hidden in hosted use.
- **Screen output:** unchanged; never carries text or the preview.
- **States:** no scenes saved (the list says so, Stage from live still works); no staged look
  (Go and Save disabled, the switch hidden); scenes failing to load (the section says "Scenes
  unavailable" and the rest of the controller works).

## Non-functional

- **Performance:** AC41 on the owner's machine; AC31, AC32 and the output's draw count in the gate
  (structural, never wall-clock, B-08). The preview never takes budget from the output (SD14).
- **Security:** no new HTTP route and no guarded area (SD22); every message validated on receipt;
  the preview stream is LAN peer to peer on HTTPS with no ICE server; no media reaches the server.
- **Limits:** 200 scenes, 128 KiB per scene, 60 characters per name, 320×180 at 10 fps, one preview
  stream, 4 KB per device message, 16 KB per setup message, 256 KiB per screen-socket message.
- **Accessibility:** B-19 SD11 for the new section: contrast, focus ring, a mark other than colour
  for the staged tile and the Editing switch; the preview `<video>` is decorative and labelled.
- **Logging:** SD20.
- **Memory:** the second engine's targets exist only while the preview is on (AC32).

## Edge cases and failure modes

- **Mid-set, users waiting (probe):** staging never changes the output (AC2); Go uses the
  transition path that already keeps the current look on failure (B-09 SD17); a dropped controller
  changes nothing (B-04 SD12); the preview gives way first (SD14).
- **Process restart (probe):** scenes remain; the staged look and every pairing are gone; controllers
  show "Pairing ended" (B-04 AC28); the preview stream ends (AC32).
- **Screen reload:** AC14; the preview stream ends and is offered again when a controller reopens
  the Scenes section.
- **A scene's profile was deleted, renamed or edited after the scene was saved:** nothing happens;
  the scene carries its own copy (SD1).
- **A scene's feed is a remote phone and the pairing ended:** SD6, AC16, H3.
- **A local camera was renamed or re-plugged under a new id:** the label match (AC15) or the note.
- **Two controllers edit the staged look at once:** last change wins (SD11).
- **Go during a Beat cut wait, or a pick pending:** B-09 SD2, SD10; the newest wins.
- **The staged look's profile fails to link on Go:** the live look stays, the reason shows as for a
  failed pick (B-09 SD17); the staged look is kept.
- **Saving while the staged look has a profile still loading:** Save is disabled until the staged
  look has settled.
- **Custom effects in a scene:** the guard and the flash limiter apply as for any look (B-03); the
  preview's second engine has its own guard state and may bypass an effect that the live engine
  does not; the preview never reaches the output.
- **Hosted use:** no scenes, no staging (AC27).
- **Money, roles (probes):** nothing touches money; roles are the table above.
- **Guarded areas (probe):** none touched (SD22); the invariants rows change as SD21 says.
- **Found while specifying, not fixed here:**
  - A picked `remote:` id that never existed leaves the camera on the previous one and reports a
    ghost id with no tile pressed (`web/src/remote/picture.ts:59-64`, `sources.ts:199-214`). Scenes
    never pick an unmatched remote id (SD6), so this item does not hit it.
  - A pick that supersedes one already at the swap can leave the engine on the superseded profile
    while the state reports the old one (`web/src/profiles/active.ts:207-216`, `:250`). Staged picks
    use their own token (AC5) and do not change this.
  - A camera missing at Start overwrites the remembered camera with whatever opens
    (`web/src/capture/session.ts:231-233`, `:253-254`).
  Neither is claimed here; `/analyse` or the owner can register them in `defect-register.md`.

## Verification

1. `bash scripts/check.sh` green with the new unit, integration and browser tests: a screen
   context and a controller context on the test-bound LAN listener (B-04 SD29) stage from live,
   edit with `target: "staged"` and assert the output's pixels do not move, open the Scenes
   section and see the preview connect, go, and assert the output reaches the staged look; save,
   rename, delete; restart the server and see the scenes; a second controller takes the stream; an
   import and export round trip; a hosted server with no scene surface.
2. On the owner's screen machine and network (human steps, the plan's H-list): `pnpm start`,
   Start, switch External control on, pair a phone, VJ mode.
3. Stage from live, change the profile, a colour and an effect's strength on the staged look, see
   it in the preview, then Go with a Crossfade (H2). Read p95 with the overlay during an 8 s
   Crossfade with the preview running (H1).
4. Save the look as "Warm crowd". Reload the screen page: the scene is still there. Stage it, press
   Go (H2).
5. Pair a second phone as a camera, save a scene on it, re-pair it, stage and Go the scene: the note
   shows and the camera stays; with the hint matching it switches (H3).

## Exit condition

A VJ builds the next look on a phone while the room sees only the current one, watches it in a
preview, saves it as a scene, and later stages any saved scene and presses Go to move the room to
it by the chosen transition, with the gate green, the output within 50 ms p95 and nothing about
scenes reaching the cloud.

## Open questions

None from the interview. ADR 0004 (SD21) is written by the plan's first task and is approved by
approving this spec. If the Scenes section needs an element `docs/design/controller-style.md` lacks,
the plan stops and asks the owner (SD21).
