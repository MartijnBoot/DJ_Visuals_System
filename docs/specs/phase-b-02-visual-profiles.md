# Spec: b-02 — Visual profiles with an in-app builder

Status: Approved · Depends on: B-01 (`docs/specs/phase-b-01-live-visual-engine.md`, built) ·
Fixes: — · Backlog: B-02

Line references are to `main` at `ebc2df2`.

## Problem

Before a set you want a look prepared, and you want it to survive a redeploy or the move from
self-hosted to a hosted version. Today every night looks the same, and nothing a person makes
can be kept:

- The look is one fixed fragment shader with every strength a constant
  (`engine/src/look.ts:9-19`, `engine/src/look.ts:78-151`). Which audio feature drives which
  term is wired in (`engine/src/look.ts:64-69`).
- Colour cannot be chosen. The only colour input is the drift tint, applied only when there is
  no camera (`engine/src/look.ts:135`, `engine/src/look.ts:59`).
- The engine takes two dials and nothing else (`engine/src/index.ts:25-39`); there is no object
  that describes a look.
- The server stores and serves nothing a person made: one table, `app_meta`
  (`server/migrations/0001_init.sql`), and one route, `GET /api/health` (`server/src/app.ts`).
  The SDR chose SQLite precisely so B-02's profiles survive restarts and redeploys (SDR §2,
  question 1), and chose an export/import format as the move to a hosted database (SDR §7).
- The screen page has no way to choose a look: its panel holds Start, two device pickers, the
  two dials and the quality cap (`web/src/Panel.tsx:84-198`), and its dials start at fixed
  defaults (`web/src/Screen.tsx:45`).
- `docs/invariants.md:27` says a running set makes no request beyond `GET /`, `/assets/*` and
  `/api/health`. Reading profiles needs one more request, so the row must be amended, not
  broken.

Cost today: B-03 (Claude Code-authored profiles) and B-04 (switching profiles live) have nothing
to author, store or switch.

## Decisions

- **SD1 — A profile is configuration only: an ordered stack of built-in effects.** It holds no
  code and no shader. Profiles differ in which effects they stack, their order, their
  parameters and their palette. The profile is plain JSON that one zod schema in `shared/`
  validates in the builder, the server and import. Whether a B-03 profile may carry code stays
  B-03's question; with this model code would arrive as one more effect type.
- **SD2 — The B-01 dials stay global master dials.** *Audio reactivity* scales every audio
  binding of the profile. *Recognisability* scales the effects flagged as abstraction effects
  (pixelate, posterise, smear). The profile stores the dials' **starting values**, authored in
  the builder. Moving a dial live is never saved back (SDR §2, "live changes are never saved
  into profiles"). Picking a profile on the screen page applies its starting dials.
- **SD3 — The first library has twelve effects:** B-01's nine (pixelate, posterise, smear, zoom,
  displace, flash, grain, edges, brightness) plus three new: palette map, mirror/kaleidoscope
  and RGB split. The catalogue and parameters are in "Data → Profile definition". Dropping the
  two structural newcomers (mirror, RGB split) is the safe cut if the plan finds the work too
  large; palette map is not optional.
- **SD4 — Each effect has a base strength plus one optional audio binding.** The binding names
  one of the five B-01 features (level, low, mid, high, beat) and an amount 0 to 1. The same
  effect can follow the kick in one profile and the hats in another. Effective strength is
  `clamp01(base × (abstraction effect ? recognisability : 1) + binding.amount × feature ×
  reactivity)`. *(the formula is a default, not asked — it is the one that reproduces B-01 with
  base and binding values; object at review)*
- **SD5 — The builder has its own preview canvas.** It is a second engine instance on the
  builder page. Video: the camera after the user presses Start, otherwise the generative noise
  field (B-01 SD10). Audio: the chosen real source after Start, otherwise a built-in synthetic
  loop (steady kick, hats, bass swell) that produces `AudioFeatures` directly, so every audio
  binding visibly does something with no music and no camera. A profile can be built alone at a
  desk.
- **SD6 — The screen page reads profiles through two read-only endpoints; the invariant at
  `docs/invariants.md:27` is amended to an allow-list.** `GET /api/profiles` and `GET
  /api/profiles/:id` are added to `GET /`, `/assets/*` and `/api/health`; the "no media reaches
  the server" half is unchanged. The screen page fetches profiles only on a user action
  (opening the panel, picking a profile, Start), never polling. The write endpoints are used by
  the builder route only. Approving this spec approves the edit to that row.
- **SD7 — Export is a versioned JSON file; import only adds.** A profile exports as a file, and
  all profiles export as one bundle file; import accepts either. Every imported profile gets a
  new id; a taken name becomes "Name (2)", "Name (3)", …; nothing is overwritten. A bundle
  imports all or nothing. The file is validated against the shared schema before anything is
  stored; an invalid file stores nothing and the builder names the profile and field that
  failed. The file carries `formatVersion` (1), so later changes, including assets, migrate old
  files. No effect in this library uses an asset, so none are carried yet.
- **SD8 — The look B-01 shipped is a built-in profile defined in code.** It is read-only,
  listed first, and reproduces B-01's look exactly at its dials (0.3 and 0.7). It can be
  duplicated into an editable profile. It is used when the database holds no profile, when the
  profile API cannot be reached, and when a stored profile fails validation. The screen page
  therefore always has a look and never shows an error on the output (B-01 SD7).
- **SD9 — The running screen page never changes by itself.** It keeps the copy it loaded. An edit
  appears only when someone re-picks the profile in the `s` panel, which re-fetches. A deleted
  profile keeps rendering until another is picked. Live push needs a channel and is B-04's.
- **SD10 — Each profile carries a revision number; a stale save is refused.** A save sends the
  revision it started from. If the stored revision moved on, the server answers 409 and the
  builder offers "reload theirs" or "save mine as a copy". An import is a create, so it does not
  touch revisions.
- **SD11 — A palette is an ordered list of 2 to 6 colours.** Each is `#rrggbb`. The builder
  offers a few preset palettes to start from and a colour input per slot. Palette map spreads
  brightness across the list from dark to light; flash, edges and grain pick a palette slot as
  their colour. "Basic colours" is a two-slot palette.
- **SD12 — Each effect appears at most once; the order is free; the stack holds up to 12.**
  Order still changes the look. The worst case is therefore a known, finite profile, and the
  latency check runs against a full twelve-effect one (AC17). Allowing repeats later does not
  invalidate stored profiles.
- **SD13 — The builder is a second route, `/builder`, in the same web app.** It lists profiles
  (built-in first, then by name, case-insensitive), and offers create (from the built-in or
  from a preset), duplicate, rename, edit, delete (with a confirmation), export and import.
  Reordering effects uses move-up and move-down buttons, so it is keyboard operable. A link
  from the screen page's `s` panel opens it in the same tab. *(default, not asked)*
- **SD14 — Profile names are unique, case-insensitively, 1 to 60 characters, trimmed.**
  Creating or renaming to a taken name is refused with 409; import renames instead (SD7).
  *(default, not asked)*
- **SD15 — Switching profiles is a hard cut, prepared before it happens.** The new profile is
  fully built (any shader compiled) while the old one keeps drawing; the swap happens on a frame
  boundary, so no blank or half-built frame is ever shown. A crossfade is B-04's (its open
  question). *(default, not asked)*
- **SD16 — The screen page remembers the picked profile id** in browser storage beside the
  device ids (`djv.sources`' sibling key), and selects it on the next load while it exists,
  otherwise the built-in. The starting dials of the picked profile apply on pick and on load.
  *(default, not asked)*
- **SD17 — The engine takes a profile through `setProfile`.** `engine/` defines its own
  `Profile` type and never imports `shared/` or any package (Phase 0 AC16); `web/` validates a
  fetched profile with the shared schema and passes it, with a type-level check that the two
  shapes stay compatible, as for `AudioFeatures` (B-01 SD11, AC19). *(default, not asked)*
- **SD18 — The write endpoints are not a new attack surface beyond B-01's.** The server stays on
  `127.0.0.1`, sets no CORS headers, and requires `Content-Type: application/json` on writes,
  so a page on another origin cannot write a profile with a simple request. Body limit 64 KB
  (a bundle import: 1 MB). *(default, not asked)*
- **SD19 — The synthetic loop lives in `audio/`.** It is a pure function of time returning
  `AudioFeatures` (120 BPM kick on `beat` and `low`, hats on `high`, a bass swell on `mid` and
  `level`), so it is unit-testable with no browser. *(default, not asked)*
- **SD20 — Profile data is not personal data.** Names and colours only; nothing from the camera
  or the audio is stored in a profile. *(default, not asked)*

## Users and permissions

| Role | Can | Cannot |
|---|---|---|
| Owner on the screen machine | Create, edit, duplicate, delete, export and import profiles in `/builder`; pick a profile on the screen page; keep a profile by its starting dials | Reach the server from another device (bound to `127.0.0.1`, unchanged); edit or delete the built-in profile; save live dial moves into a profile |

No app-level auth (SDR question 3). A stored profile is not a secret.

## In scope

- `shared/`: the profile schema (`profileSchema`, effect catalogue, palette, dials, binding),
  the file format (`profileFileSchema`, `formatVersion`), and the request/response schemas of the
  endpoints below.
- `server/`: migration `server/migrations/0002_profiles.sql`, the profile store (the only SQL
  for profiles), the endpoints in "API contract", the 64 KB / 1 MB limits, JSON-only writes.
- `engine/`: `Profile` type, `setProfile`, the effect passes for the twelve effects, the
  built-in profile definition and its equivalence with B-01's `lookUniforms`, the prepare-then-swap
  switch (SD15). Still no dependency.
- `audio/`: the synthetic feature loop (SD19). Still no dependency.
- `web/`: the `/builder` route (list, editor, preview, import and export), the profile picker in
  the `s` panel, fetch-on-action, remembered profile id, the `/` to `/builder` link, the
  compat check for `Profile`.
- `tests/browser/live.spec.ts`: the request allow-list (AC18); new browser tests for the builder.
- Docs: `docs/invariants.md` (the amended row, SD6), `docs/design/architecture.md` (profiles,
  the builder route, the endpoints, the `profiles` table, the file format; approving this spec
  approves that edit), `CLAUDE.md` Conventions line for the builder route and profile data,
  backlog (B-02 specced; B-03 and B-07 notes).

## Out of scope

- Claude Code authoring, a skill or template under `.claude/`, inspiration images (B-03).
- Profiles containing code, GLSL, or a plug-in effect interface.
- Images, textures or any asset in a profile or in the export file; `DATA_DIR/assets/` stays
  empty. The `formatVersion` leaves room.
- Live push of edits to the screen page, transitions or crossfades between profiles, switching
  profiles by anything other than the `s` panel picker (B-04).
- Saving live dial moves or live colour changes back into a profile (SDR §7; its own backlog
  item if ever wanted).
- Scenes, feed or source selection stored in a profile (B-07, B-06).
- Folders, tags, search, manual ordering, thumbnails, favourites; the list is alphabetical.
- Undo/redo in the builder beyond "revert to the last saved state".
- Effects beyond the twelve; repeated effects (SD12).
- Multi-user, per-user profiles, sharing, bought auth, a hosted database or hosted deployment.
- Server-side preview or rendering.
- Browsers other than Chromium (B-01 SD12); touch-first layout of the builder.

## Acceptance criteria

- **AC1.** When `/builder` is opened, the system shall list the built-in profile first and then
  every stored profile alphabetically, case-insensitively, and shall show an empty state (the
  built-in only, with a "Create profile" action) when none is stored.
- **AC2.** When the user creates a profile (from the built-in or from a preset palette),
  duplicates one, or renames one, the system shall store it with a new id, revision 1 and a
  valid, unique name (SD14); and when the user deletes a stored profile, the system shall ask
  for confirmation first and then remove it. The built-in shall offer duplicate and export only.
- **AC3.** When the user edits a profile, the system shall let them: set 2 to 6 palette colours;
  add, remove and move effects (each effect type at most once, at most 12); set each effect's
  base strength and its own parameters (colour slot, segments); set or clear one audio binding
  per effect (feature and amount); and set the starting dials; and shall refuse in the editor
  any state the schema would reject.
- **AC4.** While the builder is open, the system shall render the profile being edited on the
  preview canvas, applying every edit on the next frame, with the generative input and the
  synthetic loop when Start has not been pressed, and the real camera and audio source after
  Start (SD5); and the preview shall not be reachable from the output screen.
- **AC5.** When the user saves, the system shall store the profile with revision + 1, and the
  profile shall be identical after a server restart.
- **AC6.** If a save carries a revision older than the stored one, then the system shall refuse
  it with 409, store nothing, and the builder shall offer "reload theirs" and "save mine as a
  copy" (SD10).
- **AC7.** If a create or rename uses a name already taken, compared case-insensitively after
  trimming, then the system shall refuse it with 409 and store nothing.
- **AC8.** If a request body fails the shared schema (unknown effect type, a strength or
  parameter outside its range, a repeated effect type, more than 12 effects, a palette of fewer
  than 2 or more than 6 colours, a malformed colour, a binding naming no feature, a name outside
  1 to 60 characters), then the system shall answer 400 naming the failing field and store
  nothing.
- **AC9.** When the user exports, the system shall produce a JSON file with `formatVersion` 1:
  for one profile, a file holding that profile; for all, one bundle file holding every stored
  profile; neither contains ids, revisions or timestamps that import would have to trust.
- **AC10.** When the user imports a file, the system shall validate it against the shared schema,
  then store every profile in it with a new id and revision 1, renaming any whose name is taken
  (SD7), all or nothing; and if the file is not valid JSON, fails the schema, or has a
  `formatVersion` it does not know, then the system shall store nothing and say which profile
  and field failed, or that the version is unsupported.
- **AC11.** When the screen page's `s` panel is opened, the system shall request `GET
  /api/profiles` and list the built-in and every stored profile in a picker; and when a profile
  is picked, the system shall re-fetch it, apply its starting dials and switch to it by a hard
  cut with no blank or half-built frame (SD15).
- **AC12.** When the screen page loads, the system shall select the remembered profile id if that
  profile still exists, otherwise the built-in, and shall make no profile request before the
  panel is opened or Start is pressed (SD6, SD16).
- **AC13.** If there is no stored profile, the profile API cannot be reached, or the fetched
  profile fails the shared schema, then the system shall use the built-in profile, keep
  rendering, show the reason in the panel and nothing on the output.
- **AC14.** While the screen page shows a profile, the system shall leave the displayed look
  unchanged when that profile is edited or deleted elsewhere, until a profile is picked (SD9).
- **AC15.** When the built-in profile is active at its starting dials, the system shall produce
  the same look as B-01's `lookUniforms` for the same features, dials and time, within a fixed
  tolerance, and at recognisability 0 and reactivity 0 shall render the camera image unchanged
  as B-01 AC8 requires.
- **AC16.** While audio reactivity is 0, the system shall render output that does not depend on
  the audio for any valid profile; and while recognisability is moved, the system shall change
  only the effects flagged as abstraction effects.
- **AC17.** While a twelve-effect profile runs on the owner's screen machine, the in-app
  audio-to-frame latency shall have p95 ≤ 50 ms over any 10 s window (B-01 AC10), the render
  scale controller shall still engage (B-01 AC15), and the CI latency check shall run against
  that profile.
- **AC18.** While a set runs on the screen page, the system shall make no request other than
  `GET /`, `/assets/*`, `GET /api/health`, `GET /api/profiles` and `GET /api/profiles/:id`, only
  on the user actions of SD6, and shall send no camera frame or audio sample to the server
  (B-01 AC17 as amended); the server shall expose no media endpoint.
- **AC19.** When `engine/package.json` or `audio/package.json` gains a dependency, or their
  compiled output imports a package, the unit step shall fail (unchanged); and when the `Profile`
  shape in `engine/` and in `shared/` drift apart, the type check shall fail.
- **AC20.** When the server boots on a database at schema version 1, the system shall apply
  `0002_profiles.sql` without touching `0001_init.sql`, and `GET /api/health` shall report schema
  version 2.
- **AC21.** If a write request does not carry `Content-Type: application/json`, then the system
  shall answer 415; if its body exceeds the limit (SD18), 413; and no response shall carry CORS
  headers.
- **AC22.** When the synthetic loop runs for ten seconds, the system shall produce the kick
  `beat` pulses on a 120 BPM grid within one frame of each, with all values in 0 to 1.
- **AC23.** While the Phase 0 and B-01 behaviour is unchanged, `o`, `s` and `f` still work,
  `GET /api/health` still answers, the server still listens on `127.0.0.1` only, and the Phase 0
  and B-01 tests still pass.
- **AC24.** When a profile's effects are used, the system shall keep the flash strength bounded
  by the effect's maximum (35% toward the palette slot, no more), so no profile can flash harder
  than B-01 allows (B-01 Non-functional, Accessibility).

## Data

New migration `server/migrations/0002_profiles.sql` (additive; no change to `0001`):

```
CREATE TABLE profiles (
  id          TEXT PRIMARY KEY,                 -- uuid, generated by the server
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
  revision    INTEGER NOT NULL,                 -- starts at 1, +1 per save
  definition  TEXT NOT NULL,                    -- JSON: palette, dials, effects
  created_at  TEXT NOT NULL,                    -- ISO-8601 UTC
  updated_at  TEXT NOT NULL
);
```

Row validity is checked on read: a stored `definition` that fails the shared schema is skipped by
the list (logged once at `warn`, naming the id) and reported by `GET /api/profiles/:id` as
unusable, so the screen falls back (AC13). There is no `is_builtin` row: the built-in profile is
code (SD8). The remembered profile id lives in browser storage and holds no profile data.

### Profile definition

```
Profile {
  name:    string                        // 1-60 chars (SD14)
  palette: string[]                      // 2-6 x "#rrggbb"
  dials:   { recognisability: 0-1, reactivity: 0-1 }   // starting values (SD2)
  effects: Effect[]                      // 0-12, each `type` at most once, order = draw order
}
Effect {
  type:     one of the 12 below
  amount:   number 0-1                   // base strength
  binding?: { feature: level|low|mid|high|beat, amount: number 0-1 }   // SD4
  + the effect's own parameters
}
```

| Type | At strength 1 | Own parameter | Abstraction effect |
|---|---|---|---|
| `pixelate` | block of a 32nd of the width | — | yes |
| `posterise` | 4 levels per channel | — | yes |
| `smear` | 85% of the previous frame mixed in | — | yes |
| `zoom` | picture scaled up 12% | — | no |
| `displace` | blocks jump up to 3% of the frame | — | no |
| `flash` | 35% mix toward the colour (the bound, AC24) | `colourSlot` (0 to palette size - 1) | no |
| `grain` | per-block noise of 0.2 | `colourSlot` | no |
| `edges` | block-edge brightening of 1.2 | `colourSlot` | no |
| `brightness` | 40% brighter | — | no |
| `paletteMap` | picture brightness fully mapped onto the palette gradient | — | no |
| `mirror` | mirror/kaleidoscope with that many segments | `segments` (integer 2 to 8) | no |
| `rgbSplit` | colour channels offset by 3% of the width | — | no |

The values at strength 1 for the first nine are B-01's constants (`engine/src/look.ts:9-19`);
the three new ones are this spec's defaults *(default, not asked)*. Effective strength is
SD4's formula. The built-in profile is the nine B-01 effects with `amount` 1 and no binding on the
three abstraction effects, and `amount` 0 with a binding of amount 1 on the others (zoom←low,
displace←beat, flash←beat, grain←high, edges←high, brightness←level), dials `{0.3, 0.7}`.

### File format

```
{ "formatVersion": 1, "profiles": [ { name, palette, dials, effects } , ... ] }
```

A single-profile export is a file with one entry in `profiles`. Import is one code path.

## API contract

Profile read/write bodies are the `Profile` above plus `id`, `revision`, `createdAt`,
`updatedAt` on responses. JSON only; no CORS (SD18).

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/api/profiles` | — | 200 `{ profiles: [...] }` alphabetical; unusable rows omitted | — |
| GET | `/api/profiles/:id` | — | 200 profile | 404 unknown id; 422 stored row unusable |
| POST | `/api/profiles` | `Profile` | 201 profile (revision 1) | 400 schema; 409 name taken; 413; 415 |
| PUT | `/api/profiles/:id` | `Profile` + `revision` | 200 profile (revision + 1) | 400; 404; 409 stale revision or name taken (body says which); 413; 415 |
| DELETE | `/api/profiles/:id` | — | 204 | 404 |
| POST | `/api/profiles/import` | the file format (≤ 1 MB) | 201 `{ profiles: [...] }` the stored ones | 400 naming profile and field; 422 unsupported `formatVersion`; 413; 415 |

Export is built in the browser from `GET /api/profiles` and the shared file schema: no endpoint.
`GET /api/health` is unchanged except `schemaVersion` 2 (AC20).

## UI

- **`/builder`** — left: the profile list (built-in first), with create, duplicate, delete,
  import, export one, export all. Right: the editor for the selected profile — name, starting
  dials, palette (preset menu, a colour input per slot, add and remove down to 2 and up to 6),
  the effect stack (add from the remaining effect types, move up, move down, remove; per effect:
  base strength, its own parameter, a binding row of feature dropdown and amount). Above it the
  preview canvas with a Start button for camera and audio and a source picker row identical to the
  `s` panel's. Save and "revert to last saved". States: *loading* (list fetch), *empty*
  (built-in only), *error* (API unreachable: the list shows the built-in and a line, and Save is
  disabled), *conflict* (AC6: reload theirs / save mine as a copy), *dirty* (unsaved changes
  marked; leaving the page asks for confirmation).
- **Screen page `/`** — the `s` panel gains a profile picker above the dials, a one-line
  reason when the built-in was used because of AC13, and a link to `/builder`. Nothing is added
  to the output, overlay shows the active profile name.
- All builder controls are native controls in tab order, each labelled (B-01 accessibility).

## Non-functional

- Performance: AC17. The effect passes of a twelve-effect profile must hold the display's refresh
  rate down to the 50% render-scale floor on the owner's screen machine. Preparing a profile
  (SD15) happens off the frame path as far as the platform allows; the picture never stalls
  because of it.
- Limits: name 60 characters; 12 effects; 6 palette colours; 64 KB per write, 1 MB per import;
  no pagination (a handful of profiles).
- Security: SD18; the server stays on `127.0.0.1`. Imported files are data, never code (SD1);
  the schema is the only gate.
- Logging: the server logs profile create, update, delete and import at `info` with the profile
  id and revision, never the definition; a skipped invalid row at `warn` with its id. The browser
  logs profile switches at `info` with the id.
- Accessibility: keyboard-operable builder, no flashing beyond AC24.

## Edge cases and failure modes

- **Mid-set save in the builder:** the screen page is unaffected (SD9, AC14).
- **Server restarts or is down while the screen page runs:** the displayed look keeps running
  (it is in memory); picking a profile then fails to fetch and the built-in is kept with the
  reason in the panel (AC13). A server restart changes nothing on screen.
- **Server restarts during a save:** the request fails; the builder keeps the unsaved edits in
  memory, says the save failed and keeps Save available. Nothing is half-written: the write is a
  single statement (import: one transaction).
- **Two saves at once:** SD10, AC6. Two creates with the same name: the unique constraint makes
  the second a 409 (AC7).
- **Delete the profile the screen page remembers:** the next load falls back to the built-in
  (AC12). Delete the one being shown: it keeps rendering (SD9).
- **Import of a bundle where one profile is invalid:** nothing is stored (AC10).
- **Import into a database that is nearly full or locked:** the request fails with 500 and
  nothing is stored (transaction); the existing busy-timeout behaviour of `server/src/db.ts` is
  unchanged.
- **Hand-edited database row:** skipped or reported unusable, never crashes the list (Data).
- **GPU cannot keep up with a heavy profile:** B-01 SD8 (render scale) applies unchanged.
- **Quiet or silent audio, lost camera or audio:** B-01 SD7 and SD10 apply to every profile; a
  profile with all-zero audio bindings is a calm look, not an error.
- **Permission denied for camera in the builder:** the preview uses the generative input, like
  the screen page.
- **Two builder tabs:** the second is not special; conflicts surface on save (AC6).
- **Guarded areas:** none exist (`docs/invariants.md`, Guarded areas). The invariant row of
  `docs/invariants.md:27` is amended (SD6) rather than broken; the other rows are untouched.
- **Restart mid-operation with users waiting:** one user on one machine; see the three entries
  above.
- **Who may do this:** the owner only, by `127.0.0.1` binding and SD18.

## Verification

1. `bash scripts/setup.sh`, then `bash scripts/check.sh`: every step passes, including unit tests
   (schema, store, the effect-strength formula, built-in equivalence with `lookUniforms`, the
   synthetic loop), integration tests (the endpoints, conflict, limits, import atomicity,
   migration 0002) and browser tests (builder, picker, request allow-list, fallback).
2. `pnpm start`, open `http://localhost:8000/builder`: the list shows the built-in only. Duplicate
   it as "Warm", change the palette to three colours, add palette map, add mirror with 6 segments,
   bind flash to `beat`. The preview, with no camera and no music, shows the synthetic loop
   driving it. Save.
3. Open `http://localhost:8000/`, press Start, play a track, open `s`: the picker lists the
   built-in and "Warm"; pick "Warm". The picture cuts to the new look with no blank frame, the
   dials take the profile's starting values; moving a dial does not change the saved profile.
4. In `/builder`, change "Warm" and save. The screen page is unchanged; re-pick "Warm" in `s` and
   it updates. Delete "Warm" in the builder: the screen page keeps rendering it until another is
   picked; reload and Start: the built-in is selected.
5. Open `/builder` in two tabs, edit "Warm" in both, save in the first, then the second: the
   second gets the conflict choice and loses nothing.
6. Export "Warm" and export all; delete "Warm"; import the bundle: "Warm" returns with a new id.
   Import it again: "Warm (2)". Edit the file to break a field and import: nothing is stored and
   the error names the profile and field.
7. Stop the server while the screen page runs: the picture continues. Open `s` and pick "Warm":
   the built-in stays and the panel says why. Start the server again.
8. Build a twelve-effect profile, run it with the owner's load: press `o`: latency p95 ≤ 50 ms
   over a minute; add load until the render scale steps down and back up.
9. `curl http://<LAN address>:8000/api/profiles` is refused; a `curl -X POST` without a JSON
   content type to `/api/profiles` answers 415.
10. Push a branch: CI runs the same gate and is green.

## Exit condition

On the owner's screen machine, a profile built in `/builder` from a palette and the twelve effects
is stored in SQLite, survives a restart, moves between instances as an export file, and is picked on
the screen page without a dropped or blank frame, while the built-in profile keeps the B-01 look
and `bash scripts/check.sh` proves all of it that a machine can prove.

## Open questions

None, when Status is Approved. For the owner at approval: the amended invariant row (SD6), the
edit to `docs/design/architecture.md`, the exact parameters of the three new effects and the
effective-strength formula (SD3, SD4, Data), and the defaults marked *(default, not asked)*:
SD13 to SD20.
