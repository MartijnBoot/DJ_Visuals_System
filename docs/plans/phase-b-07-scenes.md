# Plan: b-07 — Scenes

Spec: [docs/specs/phase-b-07-scenes.md](../specs/phase-b-07-scenes.md) (`Status: Approved`) ·
Status: Draft

ADRs honoured: [0001](../adr/0001-setup-decision-record.md) — rendering stays on the screen machine (the
preview is a second render there, SD12) and live changes are never saved into profiles (a staged edit and a
scene write nothing to `/api/profiles*`, SD5, AC8); [0002](../adr/0002-remote-input-over-the-lan.md) — media
stays LAN peer to peer with no ICE server and never reaches the server; the new direction, screen machine →
controller, is ADR 0004, written by T1 and approved by approving the spec (SD21);
[0003](../adr/0003-hosting-on-oracle-synced-profiles.md) — scenes are not synced and a hosted server never
offers them (SD7). New dependencies: none.

Line references are to `main` at `00c6728`. The branch tip `af1d254` differs from it in `docs/` only, so
every source reference below holds on both.

## Approach

The data comes first and the picture last. T2 and T3 give scenes a home: a shared schema
(`shared/src/scenes.ts`, reusing `profileSchema`, `issuesFrom` and `nextFreeName`), migration
`0004_scenes.sql`, a store copied from the profile store's read-validity and uniqueness patterns
(`server/src/profiles/store.ts:148-166, :391-420, :460-469`) without any of its sync machinery, and
request/reply messages on the screen socket the hub already owns (`hub.ts:272-310`); the store is built only
in local mode and handed to `startExternalControl` (`boot.ts:156`), so hosted mode never has one. T5–T7 put
the staged look on the screen page as a pure sibling of `createActiveProfile` (`web/src/scenes/staged.ts`):
the applier routes a control by its `target` (`apply.ts:43-112`), Go reuses the pick's own path through a
new public `active.adopt()` that shares `apply()` (`active.ts:193-228`) and its token, supersede and failure
handling, so a Go is a pick with an explicit transition and a given definition, not a second transition
path. Feed matching is a pure function over the cameras and senders the screen already lists. T9 and T10 are
the two surfaces (the controller's Scenes section, the panel's scene row). T4, T11–T13 are the preview: four
small engine seams (a fixed drawing size, a frame cap, `dispose()`, and the over-budget and transition
readings in `stats()`), a holder-and-relay rule in the hub, a second engine on a detached canvas sent by the
existing sender peer (`web/src/send/peer.ts`), and a small receiver on the controller. T14 proves the whole
path in the browser and T15 brings the invariants, architecture and runbook up to what was built.

Three facts the inventory found shape the plan. The hub sends one identical state to every controller
(`hub.ts:105-109, :274-276`), so "Preview is on another controller" cannot come from the screen's state: the
hub tells each controller whether it holds the stream (PD15) and the controller derives the line. The hub
never tells the screen that a controller's socket closed (`hub.ts:417-429`), so the hub itself clears the
holder on close and tells the screen (PD15). A whole import cannot fit one 256 KiB screen message when a
bundle may hold 200 × 128 KiB (`control.ts:11`, SD18), so an import travels in parts and commits in one
transaction at the last (PD9).

Rejected:
- **A second `createActiveProfile` for the staged look.** It auto-restores from `djv.profile` on `open()`
  (`active.ts:280-286`), always saves `djv.profile` (`:218`), holds no dials or transition and has no entry
  point for a definition without a fetch. A pure staged module that holds exactly SD2's fields is smaller
  than stubbing those away.
- **A Go that calls `setProfile` directly.** It would duplicate the pick's token, supersede and failure
  reason (`active.ts:193-263`), and B-09 SD17's "keep the current look on failure" would then live in two
  places.
- **Reusing `offer`/`candidate` for the preview's setup.** The screen page sends every `offer`/`candidate` it
  receives to the remote-input peers (`screen-link.ts:166`), the hub refuses screen → controller setup
  (`hub.ts:300`), and four tests assert those refusals (`control-sender.int.test.ts:287-344`). Distinct
  `preview*` types leave the sender path and its tests untouched (PD1).
- **Rewriting the state per controller in the hub.** It would make the hub parse and re-serialise the
  screen's state for every device; one small `preview { holder }` message per controller does the same job.
- **Sending the import as one message with a raised limit.** It would loosen the 256 KiB screen-socket limit
  the spec fixes (Non-functional, Limits).
- **Driving the preview from a canvas in the DOM.** The output is a full-page canvas
  (`Screen.tsx:438`); a second visible canvas risks AC34 and breaks `control-panel.spec.ts:257` (exactly one
  canvas). A detached canvas with a fixed drawing size needs one engine seam (PD11, PD13).

## Decisions this plan makes

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 | **Confirm.** Message names and shapes (the spec leaves exact shapes to the plan). | Controls (in `controlSchema`, so `seq`, the applier and the ack apply): `target?: "live" \| "staged"` on `pick`, `dials`, `colour`, `resetColour`, `camera`, `transition`, `effect`; new `stage { from: "live" \| { profile: id } \| { scene: id } }`, `unstage {}`, `go {}`, `saveScene { name, updateId? }`, `renameScene { id, name }`, `deleteScene { id }`. Preview, not controls (the hub consumes or relays them): device → server `previewStream { watching }`, `previewAnswer { sdp }`, `previewCandidate { …candidateShape }`; server → device `preview { holder: boolean }`, `previewOffer { sdp }`, `previewCandidate`; screen → server `previewOffer { deviceId, sdp }`, `previewCandidate { deviceId, … }`; server → screen `preview { deviceId \| null }`, `previewAnswer { deviceId, sdp }`, `previewCandidate { deviceId, … }`. Screen socket: PD9. A controller in Live omits `target` (AC9), so every B-04 message is byte-for-byte what it was. | Strict objects (`control.ts:71-72`) keep a bad `target` a schema failure, which the channel already drops with one warn naming the type (`channel.ts:50-65`, AC4). Distinct preview names: see Rejected. `KNOWN_TYPES` (`control.ts:296-299`) is built from the unions, so every new type is named in drop warns. |
| PD2 | **Confirm.** The state's new fields. | `staged?: Staged \| null`, `scenes?: { id, name }[] \| null` (max 200; `null` = "Scenes unavailable"), `preview?: "off" \| "on" \| "paused"`, all optional in `screenStateSchema`; a local screen always sends all three. "elsewhere" and "unavailable" are derived on the controller from `preview { holder }` and its own 10 s timer (PD14, PD15). | Optional keeps the nine typed and untyped state fixtures the server-side inventory lists parsing; one broadcast state cannot carry a per-controller value (Approach). Cost: `screen-link.test.ts:290` (exact `toScreenState` shape) is amended in T5, T7 and T12 as each field arrives. |
| PD3 | **Confirm.** What `Staged` holds. | `{ id, name, palette, storedPalette, primary, dials, effects, feed: { kind, label } \| null, transition: { kind, duration }, fromScene: { id, name } \| null, settled: boolean, reason: string \| null }`. `id` is the source profile's id, or `scene:<id>` for a look whose base is a scene's copy; `effects` uses `effectEntrySchema` (`control.ts:149-157`); `settled` is false while a staged pick loads; `reason` carries a staged pick's failure and a save, rename or delete refusal. | Everything a controller needs to show the staged look as it shows the live one (PD20), and nothing of the definition: the definition stays on the screen page (SD18). |
| PD4 | **Confirm.** Does a staged `pick` keep `fromScene`? | Yes. A `pick` with `target: "staged"` edits the staged look and keeps `fromScene`; any `stage` replaces it (`live`: the live look's scene, PD22; `profile`: none; `scene`: that scene). | SD11 ties `fromScene` to staging, and the spec keeps `stage { profile }` and a staged `pick` as two messages (API contract). Save still offers both "Update" and "Save as new" (AC21), so nothing is overwritten silently. `stage { profile }` has no key of its own on `/control`: a profile is staged by Stage from live, then a pick (SD3). |
| PD5 | **Confirm.** How Go applies. | A new public `active.adopt(look, choice)` runs `apply()` (`active.ts:193-228`) under the same `token` and `picking` as a pick, with `look = { id, name, stored, palette, amounts, dials }` and `choice = { kind, duration, keepColour: false }`. The engine gets `{ ...stored, palette, effects with amounts, dials }` so the incoming look's first frame already uses the staged dials (`engine/src/index.ts:383`), then `setDials(dials)`. `storage.save` runs only for an id that is not `scene:` (SD17). `entries()` never appends a `scene:` id (`active.ts:160`), so no tile carries a scene's name. After a scene's Go, `stored` is the scene's baked profile, so a reset goes to the scene's values (AC13); after a profile's Go it is the profile as fetched when it was staged. | One transition path (B-09 SD2, SD17) and the reload rule (AC14). Fixes the inventory's D1 (a pressed "profile" tile for a scene) and D2 (`djv.profile` overwritten; the staged dials one frame late) inside this item, because AC13 and AC14 need it. |
| PD6 | **Confirm.** Feed matching and storing (SD6). | Stored: the camera **on screen** (for a remote camera what `sources` draws, `sources.ts:313-317`; for a local one the session's `cameraId`), not `state.cameraId`, which is the wanted camera (`sources.ts:156`). A local label is stored only when the browser gave one, never the "Camera n" fallback (`devices.ts:50`); else `""`. Matching (`web/src/scenes/feed.ts`, pure): local — a listed camera with that `deviceId`; else exactly one listed camera with that non-empty label; remote — exactly one connected sender with video and that hint. A match is switched by `sources.setCamera(id)`, as a camera tap is, at Go before `adopt`. No match: the note "Feed unavailable — kept the current camera" is held by the screen page and shown through `state.reason` (when the active look has no reason of its own) until the next Go or pick. | SD6, AC15–AC17. Two webcams of one model share a label, so a label match needs to be unique, as the spec asks of a hint. Switching through `setCamera` means a Go updates the remembered camera as a tap does (`session.ts:254`); the spec says a match "switches the camera as a pick does". |
| PD7 | **Confirm.** Staged edits of `camera`, `transition` and `effect`. | A staged `camera` only sets the staged feed (a local id → `{ local, deviceId, label }`, `remote:<id>` → `{ remote, hint }` of that sender) and opens or resumes nothing (AC18). A staged `transition` sets kind and duration; a `keepColour` in it is ignored (a scene holds no Keep colour, SD1) and acknowledged. A staged `effect` is dropped unless `profile` equals `staged.id`, as `setStrength` drops a stale id (`active.ts:317-322`). Every staged control is acknowledged in its frame, a dropped one too; a staged `pick` at its settle (`apply.ts:87-91`). | SD1, SD4, AC2, AC4, AC18; the ack rules are B-18 PD6's. |
| PD8 | **Confirm.** What Save builds and what it ties. | `buildScene(staged)` on the screen page: `profile = { ...stored, palette: staged palette, effects with staged amounts baked }`, keeping the source profile's `name` and starting `dials` (unused at recall: Go applies the scene's own `dials`); `dials`, `feed`, `transition` from the staged look. After a successful Save or Update, `fromScene` is the saved scene. Names are checked on the controller for feedback (trimmed, 1–60) and decided by the server (`trim`, 1–60, unique through the column's `COLLATE NOCASE UNIQUE`, as profiles are, `store.ts:413-420`). Save is disabled while `settled` is false. | SD1, SD9, SD18, AC19–AC21. Tying the look to what it was saved as makes the next Save offer Update, the expected follow-up. |
| PD9 | **Confirm.** The screen-socket protocol for scenes. | Request/reply with an integer `requestId`: `scenes.list`, `scenes.get { id }`, `scenes.save { name, definition, updateId? }`, `scenes.rename { id, name }`, `scenes.delete { id }`, `scenes.import { importId, part, parts, scenes }`; reply `scenes.result { requestId, ok, list?, scene?, error? { reason, issues? } }`. Every reply that follows a change carries the new list. The screen page holds the list (ids and names) and only the staged look's definition. An import's parts are validated on arrival and stored in **one** transaction at the last part; a new `importId`, the socket closing, or 30 s without a part discards them. Export fetches each scene with `scenes.get` and assembles the file in the browser. | 200 × 128 KiB cannot fit the 256 KiB limit (`control.ts:11`); parts keep every spec limit and AC25's all-or-nothing. Hidden from the user. |
| PD10 | **Confirm.** Hosted mode and the table. | The scenes store is created only in local mode and passed into `startExternalControl` (`boot.ts:156`, which hosted never calls, `:155`). `0004_scenes.sql` runs in both modes, as `0003_sync.sql` does (`0003_sync.sql:1-3`), so a hosted database holds an empty `scenes` table that nothing reads or writes; its backup copies it empty. AC27's "not read or written" is read as no row read or written, tested by a hosted run that leaves the table empty and opens no screen socket. | A mode-dependent migration runner would make `schemaVersion` differ by mode and is a bigger change than the spec asks. **The audit should overrule this if the Data line "the cloud's backup routine never sees the table" is meant literally.** |
| PD11 | **Confirm.** Engine seams (the spec allows them, In scope: `engine/`). | `createEngine(canvas, options?: { size?: { width, height }, maxFps?: number })`: `size` fixes the drawing buffer instead of reading `clientWidth` (`index.ts:491-497`); `maxFps` skips frames closer than `1000 / maxFps` ms. `dispose()`: cancels the frame, deletes every program, texture and target, removes the canvas listeners; idempotent. `stats()` gains `overBudget` (the scale controller's own `> ABOVE_BUDGET × budget` reading, `scale.ts:99`) and `transitioning` (a pending pick in a Beat-cut wait, or an outgoing look). The live engine is created with no options, so it behaves exactly as before. No dependency; `Profile` unchanged. | AC31 needs readings web/ cannot see today (`index.ts:41-60` exports none of them); AC32 needs freed targets (`stop()` frees nothing, `:791-794`); a detached canvas never draws today. |
| PD12 | **Confirm.** The pause rule (SD14). | A pure `createPauseRule()`: paused while the live engine's `overBudget` or `transitioning` holds; running again after 2000 ms of neither, measured on frame timestamps. Paused stops the preview engine (no draw, nothing new to capture), so the controller's `<video>` keeps its last picture; the state's `preview` reads `"paused"`. | SD14, AC31. Stopping is how "keeping the last picture" is free: the receiver holds the last frame. |
| PD13 | **Confirm.** The preview's canvas and capture. | A detached `<canvas>`, never in the DOM, drawn at 320×180 (`size`) and 10 fps (`maxFps`), captured with `captureStream(10)`; the sender caps `maxFramerate: 10`. The engine is created when the preview turns on (holder set and a staged look exists) and disposed when it turns off. It is fed the same `AudioFeatures` and the same video element the live engine gets each frame (`Screen.tsx:318-328`). **T12 starts with a spike** that headless Chromium yields frames from a detached WebGL canvas; fallback: `captureStream(0)` and `requestFrame()` after each preview draw. | AC28, AC30, AC34; the inventory could not confirm detached capture from the code. Stop rule in T12. |
| PD14 | **Confirm.** The preview's peers. | The screen offers and the controller answers. The screen side reuses `createSenderPeer` (`web/src/send/peer.ts`: `sendonly` transceiver, `contentHint`, the 10 s timer) with one video track and a `send` adapter that maps `offer`/`candidate` to `previewOffer`/`previewCandidate` with the controller's `deviceId`. The controller side is a new receiver, `web/src/control/preview-peer.ts`, about 70 lines: `previewOffer` in, `previewAnswer` and candidates out, `ontrack` to the `<video>`. Both are created with `iceServers: []`. Not connected 10 s after watching starts → the controller shows "Preview unavailable" and goes on working (AC33). | Reuse where a module fits; `peers.ts` is receive-only (`:163`) and keyed for many senders with stall polling, too much for one stream. |
| PD15 | **Confirm.** The one-stream rule on the server. | The hub keeps `previewHolder: deviceId \| null` beside `target` (`hub.ts:63-66`). `previewStream { watching: true }` from an approved controller makes it the holder (taking over), tells the old holder `preview { holder: false }`, the new one `preview { holder: true }` and the screen `preview { deviceId }`. `watching: false` from the holder, the holder's socket closing (`closed()`, `:417-429`), `end`, `endAll`, `disable`, `newCode`, and the screen closing or being superseded clear it and tell the screen `preview { deviceId: null }` when one is connected. `welcome` (`:157-167`) sends a controller its `preview { holder }`. Screen → controller preview setup goes only to the holder; controller → screen only from the holder, with its `deviceId` added. Preview setup from a non-holder controller is dropped at `debug` (a candidate in flight across a takeover is normal); a sender's preview or scene message, and a controller's `offer`/`candidate`, are dropped with one `warn` naming the type (AC37, `device.ts:85-89`). `info` "preview stream opened" and "ended" with `{ device: label }` (SD20). | SD13, SD15, AC29, AC32, AC37; fixes the inventory's "a closed controller tells the screen nothing" for the one case that matters here. |
| PD16 | **Owner — answered 2026-11-26: the recommended option.** What "opens the Scenes section" means (SD13, AC28, AC29). Sections on `/control` do not open or close (`controller-style.md:110-117`); the Scenes section is always shown in VJ mode (AC35). | **Recommended:** a VJ-mode controller starts watching when it stages (Stage from live, or a scene tile) and when its user presses a "Show preview here" key in the frame where "Preview is on another controller" shows; it stops watching on Unstage, on leaving VJ mode, and when its page is hidden (`visibilitychange`). AC28 and AC29 are tested with those actions. **Alternative A:** a disclosure that collapses and opens the section (a new element in the brief, PD18). **Alternative B:** watching while the section is scrolled into view (an `IntersectionObserver`); two controllers both at the top of the page would then take the stream back and forth on every staged change. | Two readings give different behaviour on the phone, so it is the owner's (CLAUDE.md hard stops). T13 does not start before this is answered. |
| PD17 | **Owner — answered 2026-11-26: the recommended option.** AC3 says the B-09 browser tests pass unchanged, but `tests/browser/control-transition.spec.ts:85-88` asserts that the first two labelled sections in VJ mode are `["Profiles", "Transition"]`, and SD10 and AC35 put Scenes above Profiles. | **Recommended:** T9 changes that one assertion to read the order after Scenes (`["Scenes", "Profiles", "Transition"]` for the first three), keeping its point (Transition sits under Profiles); no other B-04, B-09 or B-18 test changes. **Alternative:** Scenes below Profiles, against SD10 and AC35. | The two criteria cannot both hold as written. |
| PD18 | **Owner — answered 2026-11-26: the recommended option, (a) to (g).** `docs/design/controller-style.md` lacks what the Scenes section needs (SD21 makes this a stop): no heading may be added (`:115`); no name field (the code field is upper case with 4 px spacing, `:127`); dialogs are for approvals only (`:136`); no image or video (`:35`); and at 320×568 the scrolling area is 198 px tall with two faders, 136 px with three (`:352-353`), while a full-width 16:9 preview with its frame and legend is about 205 px. | **Recommended**, written into the brief by T8 and approved at `/review`: (a) a SCENES legend, VJ only, first section; (b) the Editing switch as a two-key row like the mode toggle, lit key on the choice, labelled "Editing", with "Staged" and "Live"; (c) the staged scene tile as a lit key, the one already marked three ways (`:121-126`); (d) a **name field**: the code field's frame without upper case or letter spacing, at least `--target` tall, with Save as a key beside it; (e) **Delete's confirm** in the approvals dialog's frame (`:136`, `.djv-dialog`) with "Delete *name*?", Delete and Cancel keys; (f) a **preview frame**: the `<video>` at the section's width with a 1 px `--line` edge, its height capped at 112 px (about 199×112) on a viewport under 600 px tall or wide, the lines in its place in `--fs-note`, and the page scrolls to it, accepting that the whole preview and Go are not in view together at 320×568; (g) Budget rows for the Scenes section at the five viewports, measured by T9. **Alternative:** the owner names other elements. | CLAUDE.md hard stop: anything in `docs/design/` is the owner's. T8 and T9 do not start before this is answered. |
| PD19 | **Owner — answered 2026-11-26: the recommended option.** Rename on the panel: SD9 and AC22 say the panel renames; SD10, the Users table and UI (`:423-424`) list Stage, Go, Delete, Export and Import, no Rename. | **Recommended:** the panel has Rename too, through `window.prompt` (the panel already uses `window.confirm`-style dialogs in the builder and cloud row, `Builder.tsx:185`, `CloudRow.tsx:139`), so the panel gets no text field and `Screen.tsx:383`'s key filter (it ignores only selects and textareas, so `s`, `o`, `f` typed in an `<input>` would toggle the page) need not change. **Alternative:** no Rename on the panel; AC22's "or the panel" then means Delete only. | Two readings give different panel behaviour. |
| PD20 | **Confirm.** The Editing switch and what the controls show. | A controller-local `editing: "staged" \| "live"` (not stored, SD4 Data), Staged on a staged look's appearance (AC9), hidden with no staged look, Live forced in DJ mode. One helper in `Controller.tsx` adds `target: "staged"` to the seven controls while it reads Staged; `refresh`, `mainAudio`, `accept` and `reject` never carry it. While it reads Staged, Profiles, Transition, Effects, Camera, the Wheel and the FaderBank show `state.staged`'s values (the pressed profile tile is `staged.id`, the pressed camera the staged feed's match). The switch stays usable while locked, like the mode toggle (it sends nothing, `controller-style.md:222-223`); every Scenes key is disabled when locked (AC36). The variable is `editing`, not `target` (B-16's wheel `target`, `Controller.tsx:107`). | SD4, AC9, AC36; the page's own rule is "shows the screen's state, never its own guess" (`Controller.tsx:8`), so it must show what it edits. |
| PD21 | **Confirm.** Go while a staged pick loads. | Go applies the staged look as it last settled; the pending pick then lands in the new staged copy. Go is enabled whenever a staged look exists. | The spec disables only Save while loading (Edge cases); B-09 SD2's newest-wins holds for the live look. |
| PD22 | **Confirm.** Stage from live when the live look came from a scene. | `fromScene` is that scene (from `activeId` `scene:<id>`) while it is still in the list; the feed is the camera on screen (PD6). | SD3's "a fresh copy of it, still tied to the scene it came from" after Go; the same after Stage from live keeps Update one tap away. |
| PD23 | **Confirm.** Limits. | 128 KiB is the UTF-8 byte length of the definition's JSON, checked by the server on save, update and import; 200 counts rows after the write, so an import that would pass 200 stores nothing (AC24, AC25). | SD18; all-or-nothing applies to the limit too. |
| PD24 | **Confirm.** Browser logging. | A Go logs `scene <id>` or `profile <id>` through `active`'s `log` (`Screen.tsx`), never a name; the preview logs nothing but state words. | AC40. |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `docs/adr/0004-scene-preview-to-controllers.md` | Create | The new media direction — T1 |
| `docs/adr/README.md`, `docs/adr/0002-remote-input-over-the-lan.md` | Modify | Index row; 0002's Status line notes 0004 — T1 |
| `shared/src/scenes.ts`, `scenes.test.ts` | Create | Scene, feed, transition, name, bundle schemas; `toSceneFile`; issues — T2 |
| `shared/src/index.ts` | Modify | Export `scenes.ts` — T2 |
| `shared/src/control.ts`, `control.test.ts` | Modify | Export `transitionDuration` — T2; screen-socket scene messages — T3; `target`, `stage`, `unstage`, `staged` — T5; `go` — T6; `saveScene`, `renameScene`, `deleteScene`, `scenes` — T7; preview messages and `preview` — T11 |
| `server/migrations/0004_scenes.sql` | Create | The `scenes` table — T2 |
| `server/src/scenes/store.ts`, `store.test.ts` | Create | The only SQL for scenes — T2 |
| `server/test/health.int.test.ts`, `migrate.int.test.ts` | Modify | Schema version 3 → 4, the migration list — T2 |
| `server/src/control/hub.ts`, `hub.test.ts` | Modify | Scene requests — T3; the holder and the preview relay — T11 |
| `server/src/control/scenes.ts` | Create | Screen-socket scene handling and the import parts (keeps `hub.ts` small) — T3 |
| `server/src/boot.ts` | Modify | The store in local mode, into `startExternalControl` — T3 (not `guardProfiles`) |
| `server/src/control/device.ts`, `channel.ts`, `channel.test.ts` | Modify | Role rule and setup sizes for the preview — T11 |
| `server/test/scenes-socket.int.test.ts` | Create | AC23–AC25, AC27, AC38, AC40 over the screen socket — T3 |
| `server/test/hosted.int.test.ts` | Modify | No scene surface; the table stays empty — T3 |
| `server/test/control-preview.int.test.ts` | Create | AC28, AC29, AC37, AC38 relay — T11 |
| `engine/src/index.ts`, `scale.ts`, `stats.ts`, `index.test.ts`, `scale.test.ts` | Modify | PD11's seams — T4 |
| `web/src/scenes/staged.ts`, `staged.test.ts` | Create | The staged look — T5; `fromScene`, save state — T7 |
| `web/src/scenes/feed.ts`, `feed.test.ts` | Create | Feed matching and storing — T6 |
| `web/src/scenes/build.ts`, `build.test.ts` | Create | `buildScene` — T7 |
| `web/src/scenes/file.ts`, `file.test.ts` | Create | Export, import and its parts — T10 |
| `web/src/scenes/pause.ts`, `pause.test.ts`, `preview.ts`, `preview.test.ts` | Create | The pause rule, the second engine and its sender — T12 |
| `web/src/profiles/active.ts`, `active.test.ts` | Modify | `snapshot()` — T5; `adopt()`, `entries()` — T6 |
| `web/src/control/apply.ts`, `apply.test.ts` | Modify | Routing by `target`, stage, unstage — T5; go — T6; scene controls — T7 |
| `web/src/control/screen-link.ts`, `screen-link.test.ts` | Modify | State fields — T5, T7, T12; scene requests — T7; preview routing — T12 |
| `web/src/Screen.tsx` | Modify | Wiring — T5, T6, T7, T10, T12 |
| `web/src/Panel.tsx` | Modify | The scene row — T10; the scene active in the picker — T6 |
| `docs/design/controller-style.md`, `controller-style-mockups.html` | Modify | PD18's elements — T8 |
| `web/src/control/Scenes.tsx`, `scenes-view.ts`, `scenes-view.test.ts` | Create | The Scenes section; what the controls show and send — T9; the preview frame — T13 |
| `web/src/control/Controller.tsx`, `controller.css` | Modify | The section, `editing`, staged view — T9 |
| `web/src/control/effect-faders.ts` | Modify | The effect's `profile` is the shown look's id — T9 |
| `web/src/control/device-link.ts`, `device-link.test.ts` | Modify | `preview`, `previewOffer`, `previewCandidate` in; `previewStream`, answer, candidates out — T13 |
| `web/src/control/preview-peer.ts`, `preview-peer.test.ts` | Create | The controller's receiver — T13 |
| `tests/browser/control-transition.spec.ts` | Modify | `:85-88`, Scenes first (PD17) — T9 |
| `tests/browser/control-scenes.spec.ts` | Create | AC9, AC12, AC35, AC36, layout — T9 |
| `tests/browser/control-layout.spec.ts` | Modify | The Scenes section at the five viewports — T9 |
| `tests/browser/scenes-panel.spec.ts` | Create | AC6, AC22, AC25 on the panel — T10 |
| `tests/browser/scenes-e2e.spec.ts` | Create | The whole path — T14 |
| `tests/browser/hosted.spec.ts` | Modify | No scene UI in hosted use — T14 |
| `docs/invariants.md`, `docs/design/architecture.md`, `docs/runbooks/README.md` | Modify | SD21's rows and sections; the human checks — T15 |

## Tasks

### T1 — ADR 0004: the preview may flow from the screen machine to a controller

- **Implements:** SD21 (the ADR)
- **Expected output:** `docs/adr/0004-scene-preview-to-controllers.md` from `0000-template.md`, Status
  "Accepted (by the approval of the B-07 spec, 2026-11-26)", Rests on 0001 and 0002. Context: SD2, SD12.
  Decision: one preview stream, screen machine → one approved controller, LAN only, peer to peer, no ICE
  server, opt-in (a controller asks for it), at most 320×180 and 10 fps, video only, yielding first to the
  output (SD14), no media through the server. Alternatives: no preview (staging blind); a preview through
  the server; a preview rendered on the controller (would put the renderer and the camera on the phone).
  Consequences with "To keep true, and what enforces it" naming the tests T11–T14 create. `README.md`
  index row; `0002`'s Status line gains "; amended by 0004 (screen → controller preview)" and nothing else
  (`README.md:12-13`: an ADR is never edited to say something else). 0 source lines, 3 doc files.
- **Verification:** `bash scripts/check.sh` (format covers the docs); `python scripts/check_plans.py
  docs/plans/phase-b-07-scenes.md`.
- **Depends on:** —
- **Autonomy note:** wording is the builder's. Stop if the ADR would need to say anything the spec's SD12–SD15
  does not (for example audio, a second stream, a resolution above 320×180).

### T2 — The scene schema, the table and the store

- **Implements:** SD7, SD8 (the schema), SD19, AC20 (the server's name rules), AC23, AC24
- **Expected output:**
  - `shared/src/scenes.ts`: `sceneNameSchema` (`z.string().trim().min(1).max(60)`); `feedSchema` (local
    `{ deviceId ≤500, label ≤500 }`, remote `{ hint ≤100 }`, matching `deviceEntrySchema`'s hint,
    `control.ts:203-209`); `sceneTransitionSchema` `{ kind: transitionKind, duration: transitionDuration }`
    (`transitionDuration` exported from `control.ts:79`); `sceneDefinitionSchema = strictObject({ profile:
    profileSchema, dials, feed: feedSchema.optional(), transition })`; `storedSceneSchema` (definition, id,
    name, times); `sceneFileSchema = { formatVersion: literal(1), scenes: [{ name, …definition }] min 1 max
    200 }`; `toSceneFile(scenes)`; `SCENE_LIMITS = { scenes: 200, definitionBytes: 131072 }`;
    `sceneNameAt(path, file)` for import issues (`issuesFrom`, `shared/src/profile-api.ts:63-68`, and the
    `profileNameAt` pattern, `server/src/profiles/routes.ts:119-124`). Exported through `index.ts`.
  - `server/migrations/0004_scenes.sql`: `scenes(id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE
    UNIQUE, definition TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`.
  - `server/src/scenes/store.ts`: `createSceneStore(db, log, now)` with `list()` (`ORDER BY name COLLATE
    NOCASE`; an unusable row left out with one `warn { id }` per id per process, `store.ts:131, :391-404`),
    `get(id)` (`missing | unusable | ok`), `save(name, definition)`, `update(id, definition)`, `rename(id,
    name)`, `remove(id)`, `importAll(entries)` (one `db.transaction`, `nextFreeName`, new ids,
    `store.ts:460-469`). Results `ok | name_taken | missing | too_large | full | invalid`; `name_taken`
    through `isUniqueViolation` (`db.ts:51-59`); PD23's limits. Every definition validated on write and on
    read.
  - Tests: `scenes.test.ts` (a full scene parses; a missing `dials`, an extra key, a feed of an unknown kind,
    a name of 61 characters and a custom effect with invalid code are refused with their path; the file round
    trips through `toSceneFile`); `store.test.ts` (the `openMemoryDatabase` + `migrate` pattern of
    `server/src/profiles/store.test.ts:7-37`): order ignoring case, a taken name in any case refused, update
    keeps id and name, rename taken refused, a row with broken JSON or a failing definition left out with one
    warn naming only its id (twice listed, one warn), 131 073 bytes refused, the 201st refused, an import of
    two with one bad stores nothing, "Name (2)".
  - Existing tests amended: `server/test/health.int.test.ts:36, :43` (schema version 4); the version and list
    assertions in `migrate.int.test.ts` (`:81, :83, :127, :131, :133, :168, :233`, those that name the
    latest version or the full list).
  - About 230 changed source lines, 5 source files.
- **Verification:** `pnpm run test --project unit shared/src/scenes.test.ts server/src/scenes/store.test.ts
  shared/src/control.test.ts`; `pnpm run test --project integration server/test/health.int.test.ts
  server/test/migrate.int.test.ts`; `pnpm migrate` against a scratch `DATA_DIR`; then `bash scripts/check.sh`.
- **Depends on:** —
- **Autonomy note:** helper names, the result type's shape and the test layout are the builder's. Stop if
  `profileSchema` refuses a profile that `storedProfileSchema` accepts (the copy must hold every stored
  profile), or if a migration test other than the version and list assertions breaks.

### T3 — Scenes over the screen socket; hosted never

- **Implements:** SD7, SD18, SD20 (the scene lines), AC23, AC24, AC25 (the server's import), AC27, AC38 (the
  screen socket), AC40 (the server)
- **Expected output:**
  - `shared/src/control.ts`: PD9's `scenes.*` in `screenMessageSchema` and `scenes.result` in
    `toScreenSchema`.
  - `server/src/control/scenes.ts`: `createSceneRequests(store, log)` answering each request, holding one
    import's parts per screen socket (PD9: validated on arrival, stored at the last part, discarded on a new
    `importId`, a close or 30 s). `info` "scene saved", "updated", "renamed", "deleted" with `{ id }`,
    "scenes imported" with `{ count, ids }`; never a name or a definition.
  - `hub.ts`: `onScreen` (`:272-310`) passes `scenes.*` from the target to it and sends the reply to that
    screen; a close of the target discards its import. `boot.ts`: `createSceneStore` beside the profile store
    (`:145`) in local mode only, passed into `startExternalControl` (`:156`); `guardProfiles` (`:143`,
    `:258-276`) untouched.
  - Tests: `scenes-socket.int.test.ts` (the in-process `boot()` and `openScreen` pattern of
    `control-device.int.test.ts:62-102`): save, list in order, get, update, rename, a taken rename refused,
    delete; restart on the same `DATA_DIR` and list again (AC23); a row written broken straight into the
    database is left out with one warn naming its id (AC23); 128 KiB + 1 and the 201st refused with a reason
    (AC24); an import in three parts stored at the last, one with a bad part stores nothing and names the
    scene and the field, a taken name becomes "Name (2)", a close mid-import stores nothing (AC25); a
    `scenes.save` over 256 KiB dropped with one warn naming its type and the socket stays open (AC38); no log
    line holds a scene's name or a marker colour from its definition at `debug` (AC40, the
    `control-device.int.test.ts:524-558` pattern). `hosted.int.test.ts`: the screen socket still answers 404
    (`:233-262`) and after the run `scenes` holds no row (PD10).
  - About 220 changed source lines, 4 source files.
- **Verification:** `pnpm run test --project integration server/test/scenes-socket.int.test.ts
  server/test/hosted.int.test.ts server/test/control-screen.int.test.ts server/test/control-device.int.test.ts`;
  `pnpm run test --project unit server/src/control shared/src/control.test.ts`; the guarded-area check
  (`pnpm run test --project unit server/src/auth server/src/rate-window.test.ts` and `pnpm run test --project
  integration server/test/hosted.int.test.ts server/test/sync-api.int.test.ts`) because `boot.ts` is edited;
  then `bash scripts/check.sh`.
- **Depends on:** T2
- **Autonomy note:** where the import's parts live and the reply's field names are the builder's within PD9.
  Stop if any edit reaches `guardProfiles`, `server/src/auth/` or `rate-window.ts` (a guarded area,
  `docs/invariants.md:48`), or if hosted mode would need a check of its own to keep the store unbuilt.

### T4 — Engine seams for a second instance

- **Implements:** SD12, SD14, AC31 (the readings), AC32 (freed targets)
- **Expected output:** PD11 in `engine/src/index.ts`, `scale.ts` (an `overBudget()` reading of the existing
  test at `:99`), `stats.ts` (the `Stats` type). Tests in `index.test.ts`: with `size`, a canvas whose
  `clientWidth` is 0 still draws at the given size; with `maxFps: 10`, frames 16 ms apart draw once per
  100 ms; `dispose()` deletes every program, texture and framebuffer it created (counted on the fake
  context), removes both canvas listeners, stops the frame, and a second call does nothing; `stats().
  transitioning` is true from the first frame of a Crossfade to its end and through a Beat-cut wait, false
  after a Cut; `stats().overBudget` follows the scale controller (`scale.test.ts`: true above 1.1 × budget,
  false at or under). The B-09 draw-count test (`index.test.ts:960-971`) and D-14's (`:268-294`) run
  unchanged. About 110 changed source lines, 3 source files.
- **Verification:** `pnpm run test --project unit engine/src tests/meta/engine-boundary.test.ts
  tests/meta/profile-compat.test.ts tests/meta/features-compat.test.ts`; `pnpm typecheck`; then `bash
  scripts/check.sh`.
- **Depends on:** —
- **Autonomy note:** option and field names are the builder's. Stop if an existing engine test needs a
  change (the live engine must behave exactly as before), or if `Profile` or `AudioFeatures` would change.

### T5 — `target`, the staged look on the screen, Stage and Unstage

- **Implements:** SD2, SD3 (staging), SD4 (the message), SD5, SD11, AC1, AC2, AC3, AC4, AC5, AC7 (the look),
  AC8
- **Expected output:**
  - `shared/src/control.ts`: `target` on the seven controls, `stage` and `unstage` (PD1), `staged` in the
    state (PD2, PD3).
  - `web/src/scenes/staged.ts`: `createStagedLook(deps)` (deps: `api.get`, `onChange`) holding PD3's fields
    plus the base definition and the live amounts: `fromLive(snapshot, feed, transition)`, `pick(id)` (own
    token; a newer pick supersedes; a failure sets `reason` with the same words as `active.ts`'s `REASONS`
    and leaves the look; AC5), `setDials`, `setColour`, `resetColour`, `setStrength(profile, index, value)`,
    `setFeed`, `setTransition` (PD7), `clear()`, `state()`.
  - `active.ts`: `snapshot()` returns `{ id, name, stored, palette, amounts }` of the live look (no fetch).
  - `apply.ts`: a control with `target: "staged"` goes to the staged look's method (dropped and acknowledged
    when none exists, AC4); `stage { from: "live" }` builds it from `active.snapshot()`, the camera on screen
    (PD6) and the current transition choice's kind and duration (AC1); `stage { profile }` loads that
    profile; `unstage` clears it. `stage { scene }` is acknowledged and dropped until T7.
  - `screen-link.ts`: `toScreenState` carries `staged` (and `scenes: null`, `preview: "off"` until T7 and
    T12). `Screen.tsx`: the staged look created beside `active` (`:155-165`), its deps into the applier
    (`:170-182`), `markDirty` on change.
  - Tests: `staged.test.ts` (every edit changes only the staged state; a pick supersedes a pending one; a
    failed pick keeps the look and sets the reason; a stale `effect` id dropped); `apply.test.ts`, rig
    `:33-74`: each of the seven with `target: "staged"` reaches the staged look and never `setProfile`,
    `setDials`, `setColour`, `setCamera` or `setTransition` of the live side (AC2); without `target` and with
    `"live"` each reaches the live side exactly as its existing case asserts (AC3); with no staged look
    dropped and acknowledged (AC4); `stage { live }` copies palette, amounts, dials, feed and transition and
    calls nothing live (AC1); `unstage` clears (AC7); no staged path calls `api` with anything but `get`
    (AC8). `control.test.ts`: a bad `target` refused, `stage` variants parse.
    `server/test/control-device.int.test.ts`: `target: "sideways"` from a controller dropped with one warn
    naming `pick`, socket open (AC4).
  - Existing tests amended: `screen-link.test.ts:290` (exact shape, PD2); `apply.test.ts`'s typed rig gains
    the staged deps.
  - About 330 changed source lines, 6 source files.
- **Verification:** `pnpm run test --project unit web/src/scenes web/src/control web/src/profiles
  shared/src/control.test.ts`; `pnpm run test --project integration server/test/control-device.int.test.ts
  server/test/control-sender.int.test.ts`; `pnpm test:browser tests/browser/control.spec.ts
  tests/browser/control-transition.spec.ts tests/browser/control-effects-e2e.spec.ts
  tests/browser/transitions.spec.ts` (AC3, unchanged); then `bash scripts/check.sh`.
- **Depends on:** T3
- **Autonomy note:** module layout and method names are the builder's. Stop if any existing B-04, B-09 or
  B-18 unit or browser test needs an edit beyond the two amendments named (AC3), or if the staged look needs
  something from the engine.

### T6 — Go, the feed, and the scene as the live look

- **Implements:** SD3 (Go), SD6, SD16, SD17, AC10, AC11, AC12 (the screen), AC13, AC14 (the screen's half),
  AC15, AC16, AC17
- **Expected output:**
  - `shared/src/control.ts`: `go`.
  - `active.ts`: `adopt()` and `entries()` per PD5. `web/src/scenes/feed.ts`: `feedOf(onScreen, cameras,
    senders)` and `matchFeed(feed, cameras, senders)` per PD6.
  - `apply.ts`: `go` with no staged look does nothing (acknowledged, AC12); otherwise match the feed, switch
    it if matched or set the note, `active.adopt(look, choice)`, and on success replace the staged look with
    a copy of the new live one keeping `fromScene` (AC11). A failed link keeps the live look and the staged
    one, with today's reason (B-09 SD17). `Screen.tsx`: the note held and composed into the state's
    `reason`; cleared by the next Go or pick. `Panel.tsx`: with a `scene:` active id the profile picker
    selects nothing.
  - Tests: `active.test.ts` (`setup` `:53-60`): `adopt` passes the given palette, amounts and dials and
    `pick: true` with the given transition and `keepColour` false, never reads `deps.transition` and never
    writes it (AC10); a `scene:` id is not saved to `djv.profile`, a profile id is (AC14); `entries()` does
    not list a `scene:` id and `activeId` is it (AC13); after a scene's adopt a reset goes to the scene's
    palette and amounts (AC13); an adopt during a pick supersedes it, and a pick supersedes an adopt (AC12,
    SD16); a failed engine call keeps the look and the reason. `feed.test.ts`: by id; by unique label; two
    equal labels no match; the "Camera n" fallback never stored; remote one, none, two (AC15, AC16); no feed
    no note (AC17). `apply.test.ts`: Go switches the camera before the adopt when matched, never when not,
    and the note is set; Go twice runs two transitions (SD16).
  - About 240 changed source lines, 6 source files.
- **Verification:** `pnpm run test --project unit web/src/profiles web/src/scenes web/src/control`; `pnpm
  test:browser tests/browser/transitions.spec.ts tests/browser/transition-e2e.spec.ts
  tests/browser/panel.spec.ts tests/browser/control.spec.ts`; then `bash scripts/check.sh`.
- **Depends on:** T5
- **Autonomy note:** helper names are the builder's. Stop if `adopt` cannot share `apply()`'s token and
  failure path without changing what a pick does (an existing `active.test.ts` case would have to change),
  or if switching the camera at Go needs anything but `sources.setCamera`.

### T7 — Scenes on the screen page: stage a scene, save, update, rename, delete

- **Implements:** SD9, SD11, SD18, SD19, AC6 (the screen), AC19, AC20, AC21 (the screen), AC22 (the screen),
  AC24 (the reason), AC26
- **Expected output:**
  - `shared/src/control.ts`: `saveScene`, `renameScene`, `deleteScene`, and `scenes` in the state.
  - `screen-link.ts`: the PD9 requests with `requestId`, a promise per request, and `scenes.list` on every
    screen-socket open; `toScreenState` carries `scenes` (`null` when the list failed: "Scenes unavailable").
  - `web/src/scenes/build.ts`: `buildScene(staged)` per PD8. The staged look gains `fromScene`, `settled`,
    and `fromScene(definition, id, name)` for a staged scene (`stage { scene }`: `scenes.get`, then the copy
    as base, palette and amounts as stored, AC6).
  - `apply.ts`: `saveScene` (refused with "Wait for the look to load" while not settled; else build and
    send; `updateId` must equal `fromScene`), `renameScene`, `deleteScene`; each result's refusal ("That name
    is taken", a too-long or empty name, "Too many scenes" for 200, "The scene is too large" for 128 KiB) into
    `staged.reason`. After a delete of `fromScene`, `fromScene` stays named but the list lacks it, so the
    controller offers Save as new only (AC21).
  - Tests: `build.test.ts` (live palette and strengths baked into the copy; dials, feed, transition carried;
    the copy of a profile with a custom effect passes `profileSchema` and the result is read only through a
    spread, never `.code`, AC26 and `tests/meta/profile-code-boundary.test.ts`); `staged.test.ts` (staging a
    scene sets every field and `fromScene`; a later `stage` replaces it; a staged pick keeps it, PD4);
    `apply.test.ts` (save while loading refused; update only with `fromScene`; each refusal reaches
    `staged.reason`; no request but `scenes.*` is made, AC8); `screen-link.test.ts` (a request's reply
    resolves its promise; a reply for an unknown `requestId` ignored; the list after a change replaces the
    state's).
  - About 300 changed source lines, 6 source files.
- **Verification:** `pnpm run test --project unit web/src/scenes web/src/control shared/src
  tests/meta/profile-code-boundary.test.ts`; `pnpm run test --project integration
  server/test/scenes-socket.int.test.ts`; then `bash scripts/check.sh`.
- **Depends on:** T6
- **Autonomy note:** the refusal words beyond the spec's "That name is taken" are the builder's, short and in
  the controller's voice. Stop if staging a scene needs its definition before the screen asks for it (the
  list must stay ids and names, SD18), or if a definition must reach the state.

### T8 — The style brief: the Scenes section

- **Implements:** SD21 (the brief), AC35 (the look)
- **Expected output:** `controller-style.md` gains PD18's elements (a) to (g):
  SCENES in the legend list (`:110-117`), the Editing switch, the staged tile's mark, the name field, Delete's
  confirm, the preview frame and its lines, the Budget rows for the Scenes section at the five viewports
  (the numbers T9 measures, filled in by T9 if T8 lands first), any contrast pair a new element needs (read by
  `tests/meta/control-look.test.ts:142-163`); the status line "Amended by B-07 (SD21), approval at
  `/review`". `controller-style-mockups.html`: a VJ portrait frame (320×568) and a tablet frame (768×1024)
  with the Scenes section, a staged look, the preview frame and the switch. 0 source lines, 2 doc files.
- **Verification:** `pnpm run test --project unit tests/meta/control-look.test.ts`; open the mockups from
  disk beside the built page at 320×568 and 768×1024 after T9; then `bash scripts/check.sh`.
- **Depends on:** T1
- **Autonomy note:** wording and mockup markup are the builder's within the owner's answer. Stop if any
  element needs a token or a contrast pair the stylesheet lacks; the brief and the code must say the same
  thing.

### T9 — The Scenes section on `/control`

- **Implements:** SD4, SD9, SD10, AC9, AC12 (the UI), AC18 (the line), AC21 (the choice), AC22 (the
  controller), AC35, AC36
- **Expected output:**
  - `web/src/control/scenes-view.ts` (pure): `shownLook(state, editing)` (the values every control shows,
    PD20), `withTarget(message, editing)` for the seven, `saveChoices(staged, scenes)` (Save; Update and
    Save as new while `fromScene` is listed; Save as new only once deleted), `nameProblem(name)`.
  - `Scenes.tsx`: a `<section aria-label="Scenes">`, VJ only, the first section (`Controller.tsx:239-243`):
    the preview frame's place (filled by T13), the Editing switch, Stage from live, a tile per scene
    (`data-testid="scene-tile"`, the staged one lit), Go, the name field with Save / Update / Save as new,
    Rename, Delete with its confirm in the approvals dialog's frame, Unstage, the line "Feed: *label*
    (applies at Go)" when the staged feed differs from the live camera, "No scenes yet" for an empty list,
    "Scenes unavailable" for `null`. Go and Save disabled with no staged look and the switch hidden (UI
    States). Every key disabled while locked (AC36).
  - `Controller.tsx`: `editing` per PD20; the seven call sites (`:274, :295, :312, :325, :362, :426, :428,
    :442`, and the effect fader's `profile` in `effect-faders.ts:46-48`) through `withTarget` and the shown
    look. `controller.css`: the section's rules under `.djv-control` (`tests/meta/control-look.test.ts`).
  - Tests: `scenes-view.test.ts` (each function's cases); `control-scenes.spec.ts` with a raw
    `deviceClient` screen state (`tests/browser/control-server.ts:155-197`) or a real screen: VJ shows the
    section first with each element, DJ none (AC35); with a staged look appearing the switch reads Staged
    and a tap on a profile tile sends `target: "staged"`, Live sends none (AC9, `recordSends`,
    `tests/browser/sockets.ts:53-73`); Go disabled with no staged look (AC12); Update and Save as new offered
    for a scene's look, only Save as new after its delete (AC21); Delete asks first and Cancel sends nothing;
    a taken rename shows the reason (AC22); locked, nothing in the section sends (AC36, `dropNetwork`);
    keyboard reaches every key, the staged tile is marked by more than colour. `control-layout.spec.ts`: at
    the five viewports in VJ with a staged look and three scenes, no sideways scroll, every target at least
    48×48 (`fitProblems`, `:91-112`), the bank and Wheel still pinned (AC35).
  - Existing tests amended: `control-transition.spec.ts:85-88` reads `["Scenes", "Profiles", "Transition"]`
    for the first three sections (PD17).
  - About 390 changed source lines, 5 source files.
- **Verification:** `pnpm run test --project unit web/src/control tests/meta/control-look.test.ts`; `pnpm
  test:browser tests/browser/control-scenes.spec.ts tests/browser/control-layout.spec.ts
  tests/browser/control-look.spec.ts tests/browser/control-transition.spec.ts tests/browser/control.spec.ts
  tests/browser/control-effects.spec.ts tests/browser/control-modes.spec.ts`; then `bash scripts/check.sh`.
- **Depends on:** T7, T8
- **Autonomy note:** markup and class names are the builder's within the brief. Stop if the section needs an
  element the brief (after T8) lacks; if `control-look.spec.ts:301`'s 80-stop Tab walk runs out (do not raise
  the cap without saying so); or if any existing `/control` test other than PD17's line needs a change.

### T10 — The panel's scene row, export and import

- **Implements:** SD8, SD10, AC6 (the panel), AC16 (the panel's line), AC22 (the panel), AC25
- **Expected output:**
  - `Panel.tsx`: a "scene" `Row` (`SourcePickers.tsx:50-65`) after the transition rows: a picker, Stage, Go,
    Rename (`window.prompt`, PD19), Delete (`window.confirm`, the `Builder.tsx:185`
    pattern), Export, Import (`type="file"`, the `Transfer.tsx:160-173` pattern) and a status line; hidden
    when `hosted`; no `.djv-control` class (`control-scope.spec.ts:141-166`). The feed note already shows in
    the panel's reason line (T6).
  - `web/src/scenes/file.ts`: `exportScenes(list, get)` (each definition by `scenes.get`, then
    `toSceneFile`, `download` from `web/src/profiles/file.ts:34-43`, file `<name>.djv-scenes.json` with the
    `fileName` slug, `djv-scenes.djv-scenes.json` for all); `readSceneImport(text)` (JSON, `formatVersion`,
    `sceneFileSchema`, issues as "*scene*: *field* — *message*", the `importIssueLine` pattern, `:62-79`);
    `importParts(scenes)` cut under 256 KiB per part.
  - `Screen.tsx`: the row's actions into the staged look, Go and the scene requests.
  - Tests: `file.test.ts` (round trip; a bad field named with its scene; parts under the limit and in
    order); `scenes-panel.spec.ts`: Stage from the panel stages without moving the output's pixels (AC6);
    Delete asks and Cancel keeps it; Rename per PD19 (AC22); export then delete all then import gives the
    same names, and staging and Go of an imported scene gives the same pixels as the original (AC25); a
    second import of the same file gives "Name (2)"; a file with one bad scene stores nothing and names it;
    the row is absent in hosted use (`hosted.spec.ts` in T14).
  - About 260 changed source lines, 3 source files.
- **Verification:** `pnpm run test --project unit web/src/scenes`; `pnpm test:browser
  tests/browser/scenes-panel.spec.ts tests/browser/panel.spec.ts tests/browser/control-panel.spec.ts
  tests/browser/control-scope.spec.ts`; then `bash scripts/check.sh`.
- **Depends on:** T7
- **Autonomy note:** the row's layout and the status words are the builder's. Stop if the panel needs a text
  field (PD19's answer avoids one; a field means `Screen.tsx:383`'s filter changes, which PD19 did not
  approve), or if the panel's 400 px width cannot hold the row without a sideways scroll
  (`control-panel.spec.ts:227-246`).

### T11 — The preview relay and the one-stream rule on the server

- **Implements:** SD13, SD15 (the server), SD20 (the preview lines), AC28 (the relay), AC29 (the holder),
  AC32 (a closed link), AC37, AC38 (the setup limit)
- **Expected output:**
  - `shared/src/control.ts`: PD1's preview messages in the four unions, `preview` in the state (PD2).
  - `hub.ts`: PD15. `device.ts`: the role rule becomes: a controller may send controls, `accept`, `reject`,
    `previewStream`, `previewAnswer`, `previewCandidate`; a sender only `offer` and `candidate`; anything else
    one `warn { socket, type }`. `channel.ts`: `previewOffer`, `previewAnswer`, `previewCandidate` in the
    16 KB setup sets (`:71-80`).
  - Tests: `control-preview.int.test.ts` (the `control-sender.int.test.ts` helpers, `:105-237`): a
    controller's `previewStream` makes it the holder and the screen hears `preview { deviceId }`; a second
    controller takes over, the first hears `holder: false` (AC29); the screen's `previewOffer` reaches only the
    holder without a `deviceId`; the holder's answer and candidates reach the screen with it; a non-holder's
    are dropped at `debug`; the holder's socket closing tells the screen `deviceId: null` (AC32); a sender's
    `previewStream`, `previewAnswer` and `saveScene` dropped with one warn each, a controller's `offer` still
    dropped with one warn (AC37); a 17 KB `previewAnswer` dropped with one warn and the socket open (AC38); no
    log line holds `v=0`, `candidate:` or a label beyond the sequence label (AC40). `hub.test.ts`: every clear
    event of PD15. `channel.test.ts:173-183`: the new types' sizes.
  - Existing tests that must stay true unchanged: `control-sender.int.test.ts:287-299, :303-344`.
  - About 170 changed source lines, 4 source files.
- **Verification:** `pnpm run test --project integration server/test/control-preview.int.test.ts
  server/test/control-sender.int.test.ts server/test/control-device.int.test.ts
  server/test/control-screen.int.test.ts`; `pnpm run test --project unit server/src/control
  shared/src/control.test.ts`; then `bash scripts/check.sh`.
- **Depends on:** T7
- **Autonomy note:** field names inside PD1 are the builder's. Stop if any existing relay test in
  `control-sender.int.test.ts` needs a change, or if the hub would need to read the screen's state.

### T12 — The second engine, the pause rule and the preview sender on the screen

- **Implements:** SD12, SD14, SD15 (the screen), AC18 (the picture), AC28, AC30, AC31, AC32, AC34
- **Expected output:**
  - First, the spike of PD13 in a throwaway browser test: a detached canvas engine at 320×180 and 10 fps,
    `captureStream(10)`, a loopback `RTCPeerConnection` pair in one page, and the receiving `<video>` reaches
    `videoWidth` 320 with changing frames. Its result goes in the commit message; the spike is deleted.
  - `web/src/scenes/pause.ts`: PD12. `web/src/scenes/preview.ts`: `createPreview(deps)` with `start(deviceId)`
    (a detached canvas, `createEngine(canvas, { size: 320×180, maxFps: 10 })`, the staged look's definition,
    palette, amounts and dials pushed on each staged change, `createSenderPeer` per PD14), `frame(now,
    features, video, liveStats)` from `beforeFrame` (`Screen.tsx:318-328`: the same features and the same
    video element; pause and resume per PD12), `stop()` (peer closed, `engine.dispose()`, canvas dropped),
    `state()` → `"off" | "on" | "paused"`.
  - `screen-link.ts`: `preview`, `previewAnswer`, `previewCandidate` from the server to the preview, not to
    `deps.onSetup` (`:166`); `toScreenState` carries `preview`. `Screen.tsx`: start on `preview { deviceId }`
    with a staged look; stop on `deviceId: null`, Unstage, a screen-socket close, a lock (screen superseded)
    and the peer's `failed` or `closed`.
  - Tests: `pause.test.ts` (over budget pauses; a transition pauses; 1999 ms under stays paused, 2000 ms
    resumes; a new over-budget resets the 2 s); `preview.test.ts` with a fake `createEngine` and a fake peer
    (the engine is a second instance with its own canvas and the options above; the live engine's methods are
    never called by the preview; while paused the preview engine is stopped; `stop()` disposes and closes;
    nothing is created while no holder is set, AC32; the peer gets `iceServers: []`, AC28; staged changes
    reach the preview engine and never the live one, AC30; no camera is opened and `setCamera` is never
    called, AC18). `screen-link.test.ts`: preview setup never reaches `onSetup`.
  - About 300 changed source lines, 5 source files.
- **Verification:** `pnpm run test --project unit web/src/scenes web/src/control web/src/send
  engine/src/index.test.ts`; `pnpm test:browser tests/browser/control-panel.spec.ts tests/browser/live.spec.ts
  tests/browser/remote-screen.spec.ts`; then `bash scripts/check.sh`.
- **Depends on:** T4, T11
- **Autonomy note:** the preview module's inner shape is the builder's. Stop if the spike shows no frames
  from a detached canvas and the `requestFrame` fallback also fails (a placement in the DOM is then a
  question for the owner, AC34); if `createSenderPeer` cannot be reused without changing what `/send` does;
  or if the live engine's stats cannot be read without a change beyond T4.

### T13 — The preview on the controller

- **Implements:** SD13, SD15 (the controller), AC29, AC33
- **Expected output:**
  - `device-link.ts`: `preview { holder }`, `previewOffer`, `previewCandidate` in (no longer dropped with
    `answer`/`candidate`/`stream`, `:135-136`); `previewStream`, `previewAnswer`, `previewCandidate` out
    through the existing socket (not through `send`, so no `seq` and no ack; nothing while locked).
  - `preview-peer.ts`: PD14's receiver. `Scenes.tsx`: the frame (a muted, `playsInline`, decorative
    `<video>` labelled "Preview of the staged look"), its lines ("Preview paused — busy" from
    `state.preview`, "Preview is on another controller" with a "Show preview here" key when `holder` is
    false and a staged look exists, "Preview unavailable" 10 s after watching began without a connection);
    watching starts on a stage and on "Show preview here", and stops on Unstage, on leaving VJ mode and
    while the page is hidden (`visibilitychange`) (PD16).
  - Tests: `preview-peer.test.ts` (fake `RTCPeerConnection`: answers an offer, `iceServers: []`, sends its
    candidates, closes on `holder: false`); `device-link.test.ts` (the three in, the three out, none while
    locked); `control-scenes.spec.ts` gains: the line for each `preview` value from a raw screen state, and
    "Preview unavailable" after 10 s with no offer while Go still sends (AC33, with the clock).
  - About 200 changed source lines, 3 source files.
- **Verification:** `pnpm run test --project unit web/src/control`; `pnpm test:browser
  tests/browser/control-scenes.spec.ts tests/browser/control-e2e.spec.ts`; then `bash scripts/check.sh`.
- **Depends on:** T9, T12
- **Autonomy note:** the frame's markup within the brief is the builder's. Stop if the `<video>` breaks a layout budget the brief (T8) fixed.

### T14 — End to end in the browser

- **Implements:** AC3 (the whole gate), AC14, AC26, AC27 (the UI), AC28, AC29, AC34, AC39, AC40
- **Expected output:** `tests/browser/scenes-e2e.spec.ts` on `startControlServer()` with a screen context and
  one or two controllers (`remote-fixtures.ts`, `pairedController`), no source change:
  - Stage from live, then a profile, a colour and a strength with `target: "staged"`: the output's pixels do
    not move (`pixels`/`near`, `helpers.ts`) and the state's `staged` follows; open the preview: the
    controller's `<video>` reaches 320×180 or less and changes; Go with a Crossfade: the output reaches the
    staged look (AC28, AC34, the spec's Verification 1).
  - Save "Warm crowd", rename, delete another; restart the server (`server.restart()`): the list remains;
    reload the screen page: no staged look on the controller, the scenes listed, the page draws the
    remembered profile (AC14).
  - A second controller presses "Show preview here" (PD16): the stream moves, the
    first shows "Preview is on another controller" (AC29).
  - A scene whose copy holds a custom effect stages and goes; the B-03 boundary holds (AC26: the page's
    shader comes only through `shaderSource`, the `remote-e2e.spec.ts:59-109` hook pattern for the console).
  - Every request of the screen page matches `control-e2e.spec.ts:341-381`'s allow-list, with no `POST`,
    `PUT`, `DELETE` and exactly one screen socket; the controller requests only what `control-scope.spec.ts:
    168-209` allows; every `RTCPeerConnection` config has no ICE server (`remote-e2e.spec.ts:386-393`)
    (AC39). No server or browser log line holds the scene's name, a marker colour of its definition, `v=0`,
    `candidate:`, a key, a code, the User-Agent or a device label (`remote-e2e.spec.ts:395-414`, AC40). The
    output carries no text throughout (`expectNoTextOnOutput`, `live.spec.ts:390-397`, AC34).
  - `hosted.spec.ts`: no scene row, no Scenes section, no socket (`:147-164`) (AC27).
- **Verification:** `pnpm test:browser tests/browser/scenes-e2e.spec.ts tests/browser/hosted.spec.ts`; then
  `bash scripts/check.sh`; then `pnpm check:load` once (a two-engine page and a WebRTC loop on a loaded
  machine, D-02, B-08).
- **Depends on:** T10, T13
- **Autonomy note:** step order and local helpers are the builder's. Stop if a bound fails only under load
  (register a defect, do not loosen it), or if a fix needs a source change (that is a defect of an earlier
  task, fixed there with a failing test first).

### T15 — Invariants, architecture and the runbook

- **Implements:** SD21 (the invariants and architecture)
- **Expected output:** `docs/invariants.md`: the media row (`:27`) adds that a controller may receive one
  low-resolution preview stream, peer to peer, no ICE server, and the screen page's set requests are
  unchanged (scenes ride the screen socket), enforced by `control-preview.int.test.ts`, `preview.test.ts`,
  `preview-peer.test.ts`, `scenes-e2e.spec.ts`; the control row (`:30`) adds an approved controller's preview
  setup messages and a sender's still only its own, enforced by `control-preview.int.test.ts`; the hosted row
  (`:33`) adds that a hosted server never offers scenes, enforced by `hosted.int.test.ts` and
  `hosted.spec.ts`. `docs/design/architecture.md`: Scenes and the preview in the overview (`:15-65`), the
  modules table (`:73-75`), External control's message flow (`:302-314`, which also corrects the missing
  `mainAudio`, `transition` and `effect`), Remote input's relay (`:362-381`), Data's tables and migrations
  (`:501-509, :532-536`), the requests a running set makes (`:584-593`) and logging (`:594-610`).
  `docs/runbooks/README.md`: "Human checks for scenes (B-07 H1 to H3)" after `:179` and an index row. 0
  source lines, 3 doc files.
- **Verification:** `bash scripts/check.sh`; every test file the rows name exists (`git ls-files`).
- **Depends on:** T14
- **Autonomy note:** wording is the builder's. Stop if a row would need to say something the code does not
  do; the code wins and the difference is a defect.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1, T2, T4 | T1: the ADRs. T2: `shared/src/scenes.ts`, `index.ts`, `control.ts` (one export), migration, `server/src/scenes/`, `health`/`migrate` tests. T4: `engine/src/` |
| 2 | T3, T8 | T3: `control.ts`, `server/src/control/scenes.ts`, `hub.ts`, `boot.ts`, `scenes-socket.int.test.ts`, `hosted.int.test.ts`. T8: `controller-style.md`, mockups |
| 3 | T5 | `control.ts`, `web/src/scenes/staged.ts`, `active.ts`, `apply.ts`, `screen-link.ts`, `Screen.tsx` and their tests |
| 4 | T6 | `control.ts`, `active.ts`, `web/src/scenes/feed.ts`, `apply.ts`, `Screen.tsx`, `Panel.tsx` |
| 5 | T7 | `control.ts`, `screen-link.ts`, `web/src/scenes/build.ts`, `staged.ts`, `apply.ts`, `Screen.tsx` |
| 6 | T9, T10, T11 | T9: `Scenes.tsx`, `scenes-view.ts`, `Controller.tsx`, `effect-faders.ts`, `controller.css`, `control-scenes.spec.ts`, `control-layout.spec.ts`, `control-transition.spec.ts`. T10: `Panel.tsx`, `web/src/scenes/file.ts`, `Screen.tsx`, `scenes-panel.spec.ts`. T11: `control.ts`, `hub.ts`, `device.ts`, `channel.ts`, `control-preview.int.test.ts` |
| 7 | T12 | `web/src/scenes/pause.ts`, `preview.ts`, `screen-link.ts`, `Screen.tsx` |
| 8 | T13 | `device-link.ts`, `preview-peer.ts`, `Scenes.tsx`, `control-scenes.spec.ts` |
| 9 | T14 | `scenes-e2e.spec.ts`, `hosted.spec.ts` |
| 10 | T15 | `docs/invariants.md`, `architecture.md`, `docs/runbooks/README.md` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph
docs/plans/phase-b-07-scenes.md` prints the groups the `Depends on` fields actually give. `control.ts` is written by T2, T3, T5, T6,
T7 and T11, each in a different group.

## Data changes

- **Migration `server/migrations/0004_scenes.sql`** (T2): one new table `scenes(id TEXT PRIMARY KEY, name
  TEXT NOT NULL COLLATE NOCASE UNIQUE, definition TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT
  NOT NULL)`. No sync columns, no tombstones, no link to `profiles`, no backfill. Additive: nothing existing
  changes; an older build ignores the table. Reversal is a later migration dropping it (none planned). Runs
  in both modes (PD10).
- **Browser storage:** nothing new. `djv.profile` is no longer written by a scene's Go (PD5); `djv.sources`
  is written by a Go that switches the camera, as a camera tap writes it (PD6).
- **Files:** `<name>.djv-scenes.json`, `{ formatVersion: 1, scenes }` (T10).

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| Chromium may not yield frames from a detached WebGL canvas through `captureStream` (unconfirmed from the code). | T12's spike first; the `requestFrame` fallback; a stop rule before any placement in the DOM (AC34). |
| The preview's own cost lifts the live engine's frame time (one main thread, one GPU), so the pause rule may oscillate: preview on → over budget → pause → 2 s → on again. | PD12's 2 s hysteresis bounds it to one preview burst per 2 s; the 50 ms p95 is H1 (AC41), on the owner's machine. If H1 shows the oscillation, a longer resume is a spec question, not a builder's change. |
| A second WebGL context counts toward the browser's live-context limit and can be lost. | One preview engine at most, created on demand and disposed (PD11, AC32); a lost preview context is a paused preview, never an output change. |
| Hints are not unique ("Chrome on Android" twice; every unknown agent is "Unknown device", `hint.ts:25`), so a remote feed often has more than one match. | The spec's own rule (AC16): keep the camera and say so. H3 checks it on the owner's phones. |
| `COLLATE NOCASE` folds ASCII only while `nextFreeName` folds Unicode (`names.ts:7-9`), so "Äbc" and "äbc" can both be saved but an import treats them as taken. | Inherited from profiles; the database decides on save and rename. Not fixed here; `/analyse` may register it. |
| A profile accepted by the 128 KiB request limit can exceed 128 KiB as a scene (JSON escaping of GLSL). | AC24's refusal with a reason at Save; the look stays staged. |
| The `scenes` table exists, empty, in a hosted database (PD10). | Confirm at the audit; if overruled, PD10 changes before T2. |
| A `/control` page left open across the upgrade strict-parses the new state and drops it (as B-18 PD11). | Optional fields (PD2) make an older controller fail only on a state that carries them; a reload fixes it; same server for both pages. |
| `control-look.spec.ts:301`'s 80-stop Tab walk may run out with scene tiles. | T9's stop rule. |
| D-13 (the fake camera refusing to start) and D-15 flake the browser specs T9, T10 and T14 sit beside; feed tests depend on cameras. | Feed matching is proven in unit tests (T6); browser tests use the remote fake sender for a feed where they can; a flake is registered, not patched. |
| The inventory found defects this item does not need: a superseded pick at the swap (spec Edge cases), a camera missing at Start, peers polling in hosted mode (`peers.ts:211`), the engine's leak under StrictMode, a listen failure's incomplete cleanup (`boot.ts:161-167`). | Out of scope; `/analyse` or the owner registers them. T4's `dispose()` makes the StrictMode leak fixable later. |

## Human steps

- **H0 — before `/audit`.** Commit this plan on `docs/phase-b-07-spec` with the spec. `/build` needs a clean
  tree.
- **Owner answers:** PD16, PD17, PD18 and PD19 answered 2026-11-26 (the recommended option each).
- **At `/review` after T8 and T9:** the owner approves the brief's new content against the built page at
  320×568 and 768×1024.
- **H1 (AC41).** On the owner's screen machine, `pnpm start`, Start, External control on, a phone paired in
  VJ mode with the preview showing; an 8 s Crossfade between the two heaviest profiles: the overlay's
  audio-to-frame p95 at or below 50 ms, the output's frame rate at the display's refresh rate, the preview
  "paused — busy" during the transition and back after it.
- **H2 (AC42).** On the phone: Stage from live, change the profile, a colour and a strength, see them in the
  preview, Go with a Crossfade; nothing of the staging on the output. Save as "Warm crowd", reload the
  screen page, stage it and Go.
- **H3 (AC43).** Pair a second phone as a camera, save a scene on its feed, re-pair it or restart the
  server, stage and Go: the note shows and the camera stays; with one phone whose hint matches, it switches.
- Recording: `docs/runbooks/rehearsals/<date>-b07-human-checks.md` (the `rehearsals/README.md` template).
- Pushing, the PR and the merge are the owner's.

## Out of scope for this plan

- Everything under the spec's Out of scope.
- The defects listed in the last Risks row and the spec's "Found while specifying"; none is claimed here.
- `docs/specs/` of earlier items: amended by this spec's SDs, not edited.
- A tolerant state schema for a stale `/control` page.
- `stage { profile }` as a key on `/control` (PD4): the message exists and is tested, the UI stages a
  profile by Stage from live and a pick.

## Audit (PASS required before implementation starts)

- [ ] Every AC maps to at least one task
- [ ] Every task maps to at least one AC (no orphans)
- [ ] Each task's expected output is concrete enough to check, and is what we actually need
- [ ] Existing patterns reused; nothing reinvented
- [ ] No new dependency without an approval note
- [ ] Data changes additive and reversible
- [ ] Errors, empty states and permissions are tasks, not afterthoughts
- [ ] Each task reviewable in one sitting
- [ ] Verification named per task
- [ ] Nothing touches prod, secrets or infra it should not
- [ ] Every task has a Depends on and an Autonomy note
- [ ] No two tasks in one parallel group write the same file

Audited by: ______  Date: ______
