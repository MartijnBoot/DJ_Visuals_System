# Plan: b-02 — Visual profiles with an in-app builder

Spec: [docs/specs/phase-b-02-visual-profiles.md](../specs/phase-b-02-visual-profiles.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001 Setup Decision Record](../adr/0001-setup-decision-record.md) — profiles in
SQLite (question 1), the profile schema defined once in `shared/` and validated identically in
builder, server and import (decision B), the renderer still a framework-free module that takes
"canvas + audio features + profile" (constraints), export/import as the migration path (§7),
live changes never saved into a profile (constraints), no auth and `127.0.0.1` only (question
3), no asset code (question 4: no effect uses one). New dependencies: none. The spec's edits to
`docs/invariants.md:27` (SD6) and `docs/design/architecture.md` are approved by the spec and
made in T16.

Line references are to `main` at `ebc2df2`. The spec and `docs/backlog.md` are cited from the
uncommitted working copy of 2026-11-12 (Human steps, H1).

## Approach

The profile is data in three places that must agree, so the plan starts with the three pure
definitions and no I/O: the zod schema and file format in `shared/` (T1), the engine's own
`Profile` type with the strength formula, the effect catalogue and the built-in profile, proven
equal to B-01's `lookUniforms` (T2), and the synthetic feature loop in `audio/` (T3). Then two
columns grow side by side. Server: migration `0002` and the store that owns every profile SQL
statement (T4), then the six endpoints with their limits (T7). Engine: `setProfile` and the
prepared swap, drawing B-01's nine effects from a profile (T5), then the three new effects (T6,
which is exactly SD3's "safe cut" if the owner takes it). `web/` gets a profile client and the
`Profile` compat check (T8), the screen page's picker (T9), and the builder in five slices:
list and create/duplicate/rename/delete (T10), the editor and Save (T11), conflict, dirty and
revert (T12), export and import (T13), the preview canvas (T14). T15 runs the latency and
render-scale checks against a twelve-effect profile; T16 writes the docs as built.

The engine keeps **one shader pass**. A profile's ordered effect list is turned into one
fragment shader by composing built-in GLSL snippets, one function per effect, each calling the
one before it (PD3); strengths, colours and segments are uniforms. So an edit to a value costs
nothing and shows on the next frame, and only adding, removing or moving an effect compiles a
new program, which is linked while the old one keeps drawing and swapped between frames (SD15,
PD4). There are at most twelve built-in snippets and no profile carries code (SD1): the profile
selects and orders them, nothing else.

Rejected:

- **One framebuffer pass per effect.** Twelve full-screen passes per frame on SwiftShader is the
  likeliest way to miss AC17 in CI and to make B-01's pixel tests depend on the render scale;
  and B-01's look is not separable that way (every audio term is evaluated per block, the smear
  undoes brightness and flash), so AC15 would be approximate.
- **One fixed pipeline with on/off switches.** It ignores the stack order, which SD12 says
  changes the look.
- **A router package for `/builder`.** Two routes; `main.tsx` reads `location.pathname`.
- **A form or state library for the editor.** One reducer over a `Profile`, validated by the
  shared schema.
- **Server-side export.** The spec's API contract has no export endpoint; the file is built in
  the browser.
- **The built-in profile as a database row.** SD8: it is code, so it exists when the database
  and the API do not.
- **A test hook on `window` to hand the engine a profile.** Browser tests create profiles
  through the real API and pick them in the real panel; shader compilation is proven by
  compiling the generated source in a page-side WebGL2 context from the test (T5).

## Decisions this plan makes

Readings of the spec the planner had to choose. **Confirm** rows are for the audit to confirm or
overrule; **Owner** rows are user-visible choices the spec left open, and each one is a stop
(CLAUDE.md hard stops).

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 · Owner — accepted as recommended, 2026-11-12 | AC11 says the list is fetched "when the `s` panel is opened"; AC12 and SD6 say no profile request before a user action; but the panel is already open on page load (B-01 PD12). What happens between load and Start? | **Recommended:** page load is not a user action. On load nothing is fetched; the built-in renders (the idle look, as today) and the profile picker is disabled, showing the remembered profile as "remembered profile" or "Built-in". The first fetch is on Start or on the first `s` press, whichever comes first: the list, then the remembered profile, which is then switched to and its starting dials applied (overwriting any dial moved before Start). After that the picker is enabled and every panel open re-fetches the list. The other reading (the open-on-load panel counts, so the page fetches at load) breaks AC12's sentence and SD6. | The two readings differ in what the screen shows and requests before Start. The recommended one matches B-01's disabled device pickers before Start. |
| PD2 · Owner — accepted as recommended, 2026-11-12 | "Create from a preset" (SD13, AC2, SD11 "a few preset palettes"): which presets, and what does a profile created from one contain? | **Recommended:** four presets — *Basic* `#000000 #ffffff`, *Warm* `#1a0500 #c2410c #fbbf24 #fff7ed`, *Cool* `#020617 #1d4ed8 #22d3ee #f0f9ff`, *Neon* `#0a0014 #d946ef #22d3ee #a3e635`. "Create from built-in" copies the built-in exactly. "Create from preset" is the built-in's stack and dials with the preset's palette and `paletteMap` (amount 1, no binding) added as the last effect before `pixelate`, so the palette is visible at once. Flash, grain and edges take the lightest slot (the last). New profiles are named "New profile", then "New profile (2)", … | The spec names neither the presets nor a preset profile's content, and both are what the owner sees first in the builder. |
| PD3 · Confirm | How the stack order becomes a picture in one pass (SD12 "order = draw order", SD15 "any shader compiled"). | `engine/src/shader.ts` exports `buildFragment(types: EffectType[])`. It emits `vec3 fx0(vec2 uv)` (the source: camera or noise, tint included) and one `vec3 fxN(vec2 uv)` per effect in stack order, each calling `fx(N-1)`: a warp calls it at a moved coordinate (pixelate, zoom, displace, mirror), a colour effect calls it at `uv` and changes the result (posterise, brightness, flash, grain, paletteMap), edges and rgbSplit call it three times, smear mixes in the previous frame. `main` outputs the last one. This is function composition, so the first effect in the list is applied to the picture first, exactly as separate passes would. The per-block noise of grain and displace is keyed on the output pixel's block (`gl_FragCoord / uBlock`, `uBlock` set by pixelate's strength, 1 without pixelate), as B-01 PD22 requires. | Honours the order completely, costs one pass, and reproduces B-01's shader term for term (PD5). Worst case is 9 source evaluations per pixel (edges × rgbSplit). |
| PD4 · Confirm | `setProfile` and the prepared swap (SD15, SD17). | `Engine.setProfile(profile): Promise<void>`. If the ordered list of effect types equals the active one, only the values change: applied on the next frame, resolved at once. Otherwise the new program is compiled and linked while the old one draws, polled once per frame through `KHR_parallel_shader_compile` when the context has it (a synchronous `LINK_STATUS` read on the next frame when it does not), and swapped at the start of a frame; the promise resolves at the swap. Programs are cached by their type list (the built-in's never evicted). A link failure rejects, logs once and keeps the old profile drawing. A later `setProfile` supersedes a pending one. On the first frame after a swap the smear strength is 0, so nothing of the old look is mixed into the new one. | "Fully built while the old one keeps drawing"; the picture never blanks. The one-frame smear rule makes the cut hard, which is what SD15 says. |
| PD5 · Confirm | The built-in profile's exact content (SD8, Data), which the spec gives without an order or a palette. | Palette `["#000000", "#ffffff"]`; dials `{0.3, 0.7}`; effects in this order: `edges` (amount 0, high×1, slot 1), `displace` (0, beat×1), `zoom` (0, low×1), `posterise` (1), `smear` (1), `brightness` (0, level×1), `grain` (0, high×1, slot 1), `flash` (0, beat×1, slot 1), `pixelate` (1). Name "Built-in"; id `builtin` (PD9). | Composed per PD3 this is B-01's `LOOK_FRAGMENT` (`engine/src/look.ts:122-150`) term for term: block centre, then zoom, then displace, then the source with edges; posterise, smear, brightness, grain, flash. White in slot 1 is B-01's flash, grain and edge colour. |
| PD6 · Confirm | How a strength (SD4's formula, 0 to 1) becomes each effect's parameter, and AC15's tolerance. | With `s` the effective strength: block `max(1, width/32) ** s`; levels `256 ** (1 - s) * 4 ** s`; smear `0.85 s`; zoom `1 + 0.12 s`; displace `0.03 s`; flash `0.35 s` (AC24: `s` is clamped, so never above 0.35); grain `0.2 s`; edges `1.2 s`; brightness `0.4 s`; paletteMap mix `s`; mirror: the sampling coordinate moves from the plain one to the `segments`-fold mirrored one by `s`; rgbSplit `0.03 s` of the width. The nine constants are imported from `engine/src/look.ts:9-19`, not copied. AC15's tolerance: every value within `1e-9` of `lookUniforms` (`look.ts:46-71`) over a grid of features, dials and timestamps. | The first nine are B-01's own formulas with `r` or `feature × k` replaced by `s`, so the built-in is equal by construction. Mirror moving the coordinate costs one evaluation; a cross-fade would cost two. |
| PD7 · Confirm | What stays of `engine/src/look.ts`. | The constants and `lookUniforms` stay, as AC15's reference; `LOOK_FRAGMENT` is removed in T5 (its text becomes the snippets). `look.test.ts` is unchanged and stays green. | AC15 names `lookUniforms`. A frozen copy in a test file would be a second definition. |
| PD8 · Confirm | Two declarations of the profile shape (SD17, AC19) and of the effect list. | `shared/src/profile.ts` (zod) and `engine/src/profile.ts` (plain types). `web/src/profile-compat.ts` assigns each to the other; `tests/meta/profile-compat.test.ts` proves the type check fails when `engine/src/profile.ts` renames or adds a field, with the helper extracted from `tests/meta/features-compat.test.ts:17-46` into `tests/meta/compat-check.ts` and used by both. A `web/` unit test parses the engine's built-in with the shared schema. | Same mechanism as `AudioFeatures`; the helper is reused, not written twice. |
| PD9 · Confirm | The built-in in lists and in storage (SD8, AC1, AC11, SD16). | `GET /api/profiles` returns stored profiles only. `web/` puts the built-in first, under the reserved id `builtin` (server ids are UUIDs from `crypto.randomUUID()`). The remembered id is `localStorage` key `djv.profile` (a plain string, read with a type check), beside `djv.sources` (`web/src/capture/remembered.ts:4`). | The built-in must exist when the API does not answer. |
| PD10 · Confirm | Error bodies (API contract: "naming the failing field", "body says which"). | 400: `{ error: "invalid", issues: [{ path, message }] }`, `path` dotted (`effects.2.amount`); for import the path starts `profiles.<index>` and each issue carries `profile` (its name when readable). 409: `{ error: "conflict", reason: "stale_revision" \| "name_taken" }`, with the stored profile in `current` for `stale_revision`. 404, 413, 415, 422: `{ error }`. All declared in `shared/` and parsed by `web/`. | One shape the builder can show without string matching. |
| PD11 · Confirm | Which requests AC21's 415 covers. | `POST` and `PUT`: a preValidation check answers 415 unless `Content-Type` is `application/json`, and Fastify's default `text/plain` parser is removed. `DELETE` carries no body and is exempt. | A cross-origin `DELETE` is never a simple request, so SD18's reason does not apply; Fastify rejects an empty body declared as JSON. |
| PD12 · Confirm | Import renaming at the length limit (SD7, SD14). | "Name (2)" is formed by trimming the base name so the result is at most 60 characters. Names within one bundle are also made unique against each other. The conflict choice "save mine as a copy" (AC6) creates a new profile through the same rule on the client: the first free "Name (n)". | Otherwise a 60-character name cannot be imported twice. |
| PD13 · Confirm | `Db.run` returns nothing (`server/src/db.ts:19-21`), but a stale save must know whether a row changed. | `run` returns `{ changes }` from `node:sqlite`. The update is one statement, `UPDATE … WHERE id = ? AND revision = ?`; zero changes is then told apart (404 or stale) by one read. Import is one `BEGIN IMMEDIATE … COMMIT`, as `server/src/migrate.ts` does. | The spec's "a single statement"; `db.ts` stays the only file importing the driver. |
| PD14 · Confirm | `/builder` under `pnpm start`: `registerStatic` answers 404 for anything that is not a file (`server/src/app.ts:14-16`, `server/test/static.int.test.ts:67-70`). | One explicit route, `GET /builder`, sends `index.html`. Every other unknown path stays 404. `web/src/main.tsx` renders `Builder` when `location.pathname` is `/builder`, else `Screen`. The builder scrolls inside its own container, because `web/index.html` hides overflow for the screen page. | Smallest change; the existing 404 test stays true. Vite's dev server already falls back to `index.html`. |
| PD15 · Confirm | The synthetic loop's `capturedAt` (SD19) and the preview's dials (SD5). | `syntheticFeatures(nowMs)` returns `capturedAt: 0`, so the preview engine records no latency sample (B-01 PD21). The preview is driven by the starting dials being edited. | The loop is not captured audio; a latency number for it would be invented. |
| PD16 · Confirm | Where the screen page's profile logic lives (AC11 to AC14). | A UI-free controller, `web/src/profiles/active.ts`, with injected `fetch`, storage and `engine.setProfile`: `open()` (list), `pick(id)` (re-fetch, validate, `setProfile`, starting dials, remember, log), fallback to the built-in with a reason. Unit-tested with fakes like `web/src/capture/session.ts`. | The rules are testable without a browser; `Screen.tsx` only wires it. |
| PD17 · Confirm | AC17 in the gate. | `tests/browser/live.spec.ts` gains a twin of the B-01 latency test and of the render-scale test, run with a twelve-effect profile (every effect at amount 0.5 with a binding, `tests/browser/fixtures/profiles.ts`) created through the API and picked in the panel: p95 ≤ 50 ms after start-up has left the window; slow frames still step the scale down. If SwiftShader cannot hold 50 ms, the builder stops and reports the numbers. | The spec's "the CI latency check shall run against that profile". The fallback is the owner's, as in B-01 PD13. |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `shared/src/profile.ts`, `shared/src/profile-api.ts`, `shared/src/index.ts` | Create, Create, Modify | Profile schema, file format, limits; request, response and error schemas (T1) |
| `engine/src/profile.ts`, `engine/src/index.ts` | Create, Modify | `Profile`, catalogue, strength formula, `profileUniforms`, built-in (T2) |
| `audio/src/synthetic.ts`, `audio/src/index.ts` | Create, Modify | The synthetic loop (T3) |
| `server/migrations/0002_profiles.sql` | Create | The `profiles` table (T4) |
| `server/src/db.ts`, `server/src/profiles/store.ts` | Modify, Create | `run` returns `changes`; the only SQL for profiles (T4) |
| `server/test/health.int.test.ts`, `server/test/migrate.int.test.ts` | Modify | Schema version 2, two applied files (T4) |
| `engine/src/shader.ts`, `engine/src/gl.ts`, `engine/src/look.ts`, `engine/src/index.ts`, `engine/src/index.test.ts` | Create, Modify ×4 | Shader builder, non-blocking link, `setProfile`, the swap (T5); new snippets (T6) |
| `tests/browser/shader.spec.ts` | Create | Generated shaders compile in Chromium (T5, T6) |
| `server/src/profiles/routes.ts`, `server/src/app.ts`, `server/src/boot.ts`, `server/test/profiles.int.test.ts` | Create, Modify, Modify, Create | The endpoints, limits, 415 (T7) |
| `web/src/profiles/api.ts`, `builtin.ts`, `remembered.ts`, `web/src/profile-compat.ts` | Create | Client, built-in entry, remembered id, compat (T8) |
| `tests/meta/compat-check.ts`, `tests/meta/profile-compat.test.ts`, `tests/meta/features-compat.test.ts` | Create, Create, Modify | AC19 (T8) |
| `web/src/profiles/active.ts`, `web/src/Panel.tsx`, `web/src/Screen.tsx`, `web/src/Overlay.tsx` | Create, Modify ×3 | Picker, fetch-on-action, fallback, name in overlay (T9) |
| `tests/browser/profiles.spec.ts`, `tests/browser/fixtures/profiles.ts`, `tests/browser/live.spec.ts` | Create, Create, Modify | Screen-page profile behaviour, allow-list (T9); AC17 (T15) |
| `web/src/main.tsx`, `web/src/builder/Builder.tsx`, `ProfileList.tsx`, `presets.ts`, `names.ts` | Modify, Create ×4 | The route, the list, CRUD (T10) |
| `server/src/app.ts`, `server/test/static.int.test.ts` | Modify | `GET /builder` (T10) |
| `tests/browser/builder.spec.ts` | Create, then Modify | Builder proofs (T10 to T13) |
| `web/src/builder/editor.ts`, `Editor.tsx` | Create | Editor state and controls (T11) |
| `web/src/builder/Conflict.tsx` | Create | AC6 choice (T12) |
| `web/src/profiles/file.ts`, `web/src/builder/Transfer.tsx` | Create | Export, import (T13) |
| `web/src/builder/Preview.tsx`, `web/src/SourcePickers.tsx`, `tests/browser/preview.spec.ts` | Create | Preview engine; pickers shared with the panel (T14) |
| `docs/design/architecture.md`, `docs/invariants.md`, `CLAUDE.md`, `README.md`, `docs/backlog.md` | Modify | As built (T16) |
| Test files beside the code (`*.test.ts`) | Create | Named per task |

Existing tests and texts this change makes untrue:

- `server/test/health.int.test.ts:36-46` ("version 1", `toBe(1)`): the real folder now gives 2.
  Changed in T4.
- `server/test/migrate.int.test.ts:81`, `:83` and `:138` (`["0001_init.sql"]` on the real
  folder, at boot and through `pnpm migrate`): two names. `:107` and `:156` run on a copied
  folder and stay true. Changed in T4.
- `tests/browser/live.spec.ts:403-415` (AC17's allow-list and its title): two more paths, and
  only after a user action. Changed in T9.
- `engine/src/index.test.ts:1-3` header ("the look") and its fake context: the engine now links
  through `setProfile`; the four existing cases keep their assertions. Changed in T5.
- `engine/src/look.ts:1-4` header ("one shader pass … B-02 lifts them"): rewritten in T5.
- `web/src/Screen.tsx:45` and its header comment (dials start at fixed defaults): T9.
- `web/src/Panel.tsx:1-4` header (what the panel holds): T9.
- `docs/invariants.md:27`, `docs/design/architecture.md` (overview diagram, modules table, "The
  look", Data → Tables "Nothing a person made is stored yet", `shared/` row), `CLAUDE.md`
  (Commands and Conventions: one route, no profile data): T16.
- Not untrue: `server/test/static.int.test.ts:67-70` (`/nope` stays 404, PD14);
  `tests/browser/panel.spec.ts:10` ("nothing asked" on load holds under PD1);
  `engine/src/look.test.ts` (PD7); `tests/meta/engine-boundary.test.ts`.

## Tasks

Each task is one vertical slice that leaves the system working, reviewable in one sitting:
about ≤400 changed source lines (tests do not count) across ≤10 files.

### T1 — `shared/`: the profile schema, the file format and the API shapes
- **Implements:** AC8, AC3, AC9, AC10, SD1, SD7, SD11, SD12, SD14
- **Expected output:** `shared/src/profile.ts` exports `EFFECT_TYPES` (the twelve, in the
  spec's table order), `FEATURE_NAMES`, `LIMITS` (name 60, effects 12, palette 2 to 6, segments
  2 to 8), `profileSchema` and `Profile`: `name` trimmed, 1 to 60; `palette` of 2 to 6
  `#rrggbb` (lower or upper case); `dials` two numbers 0 to 1; `effects` 0 to 12, a
  discriminated union on `type` with `amount` 0 to 1, optional `binding { feature, amount }`,
  `colourSlot` (integer ≥ 0) on flash, grain and edges, `segments` (integer 2 to 8) on mirror,
  unknown keys rejected; a refinement that each `type` appears once and every `colourSlot` is
  below the palette length, each issue carrying the path of the offending field. It exports
  `FORMAT_VERSION = 1`, `profileFileSchema` (`{ formatVersion: 1, profiles: Profile[] }`, at
  least one) and `toProfileFile(profiles)`, which keeps only `name`, `palette`, `dials`,
  `effects`. `shared/src/profile-api.ts` exports `storedProfileSchema` (`Profile` plus `id`,
  `revision`, `createdAt`, `updatedAt`), `profileListSchema`, `updateProfileSchema` (`Profile`
  plus `revision`), and the error schemas of PD10 with an `issuesFrom(zodError, prefix?)`
  helper that gives the dotted paths. `shared/src/index.ts` re-exports both beside
  `healthResponseSchema`. Tests `shared/src/profile.test.ts`: the built-in-shaped example
  parses; one failing case per clause of AC8 (unknown effect type, amount 1.5, segments 9, a
  repeated type, 13 effects, 1 and 7 colours, `#12345`, a binding with feature `"tempo"`, an
  empty and a 61-character name), each asserting the issue's path; `colourSlot` 2 with a
  two-colour palette fails at `effects.<i>.colourSlot`; a name with outer spaces parses
  trimmed; `toProfileFile` output has no `id`, `revision` or timestamp and parses back; a file
  with `formatVersion` 2 fails. About 230 source lines, 3 files.
- **Verification:** `pnpm run test --project unit shared && pnpm typecheck && pnpm lint`
- **Depends on:** —
- **Autonomy note:** Builder settles schema composition and messages. The field names, ranges
  and the twelve type names are the spec's and are not to be changed. Stop if zod 4.6.7 cannot
  express the discriminated union with the cross-field refinement without a helper package.

### T2 — `engine/`: the profile model, the strength formula and the built-in
- **Implements:** AC15, AC16, AC24, SD2, SD4, SD8, SD17
- **Expected output:** `engine/src/profile.ts`, importing only `./look.ts`, `./colour.ts` and
  `./features.ts`: the engine's own `Profile`, `Effect`, `EffectType`, `Binding` types (same
  shape as T1, no import of `shared/`); `EFFECTS`, a catalogue keyed by type with `abstraction`
  (true for pixelate, posterise, smear) and which own parameter it has;
  `effectStrength(effect, features, dials)` = SD4's formula with every input clamped to 0..1 and
  non-finite read as 0; `profileUniforms(profile, features, dials, timestamp, hasSource, width)`
  returning `time`, `tint`, `tintWeight`, `block`, and per effect type present its parameter
  per PD6, the palette as up to six RGB triples with its length, and the slot colours of flash,
  grain and edges; `BUILT_IN_PROFILE` (PD5), deep-frozen. `engine/src/index.ts` exports the
  types, `EFFECTS`, `BUILT_IN_PROFILE` and `effectStrength`. Tests `engine/src/profile.test.ts`:
  for the built-in, over a grid of features (corners and 0.5), dials (0, 0.3, 0.7, 1 each) and
  three timestamps, with and without a source, `block`, `levels`, `feedback`, `zoom`,
  `displace`, `flash`, `grain`, `edges`, `brightness`, `time`, `tint` and `tintWeight` are
  within `1e-9` of `lookUniforms` (AC15); at dials 0/0 with a source they are the identity
  values (block 1, levels 256, the rest 0, zoom 1) (AC15, B-01 AC8); for a twelve-effect
  profile with every binding set, reactivity 0 gives equal uniforms for zero and full features,
  and moving recognisability changes only pixelate's, posterise's and smear's values (AC16);
  flash never exceeds 0.35 for amount 1, binding 1, feature 1, reactivity 1, nor for inputs
  above 1 (AC24); a binding's feature selects that feature (flash bound to `high` follows
  `high`, not `beat`); every value finite for wild inputs. About 220 source lines, 2 files.
- **Verification:** `pnpm run test --project unit engine tests/meta/engine-boundary.test.ts && pnpm typecheck && pnpm lint`
- **Depends on:** —
- **Autonomy note:** Builder settles the uniform record's layout and the hex parsing. The
  formula, the constants (imported from `look.ts`, never retyped) and PD5's order are fixed.
  Stop if any built-in value cannot be made equal to `lookUniforms` within the tolerance.

### T3 — `audio/`: the synthetic feature loop
- **Implements:** AC22, SD19
- **Expected output:** `audio/src/synthetic.ts` exports a pure `syntheticFeatures(nowMs)`
  returning `AudioFeatures`: a kick every 500 ms on `beat` (1 at the grid instant, exponential
  decay with the existing beat decay constant from `audio/src/constants.ts`) and on `low`;
  hats on `high` on the off-beats; a slow swell on `mid` and `level`; `capturedAt` 0 (PD15);
  every number a named constant in the same file. `audio/src/index.ts` exports it. Tests
  `audio/src/synthetic.test.ts`: sampled every 1000/60 ms for 10 s, `beat` rises to ≥ 0.9
  within one frame (16.7 ms) of each of the 20 grid instants and is below 0.2 just before
  each; every field is within 0 to 1 at every sample and for negative and huge `nowMs`; the
  function is deterministic; `high` peaks between kicks. About 60 source lines, 2 files.
- **Verification:** `pnpm run test --project unit audio tests/meta/engine-boundary.test.ts && pnpm typecheck && pnpm lint`
- **Depends on:** —
- **Autonomy note:** Builder settles the envelopes. 120 BPM and the feature assignment are
  SD19's. No randomness, no state.

### T4 — `server/`: migration 0002 and the profile store
- **Implements:** AC20, AC5, AC6, AC7, AC10, SD10, SD14, SD7
- **Expected output:** `server/migrations/0002_profiles.sql` with the spec's `CREATE TABLE
  profiles` exactly; `0001_init.sql` untouched. `server/src/db.ts`: `run` returns
  `{ changes }` (PD13). `server/src/profiles/store.ts` exports `createProfileStore(db, log,
  now = () => new Date())`, the only module with profile SQL: `list()` (ordered by name,
  `NOCASE`; rows whose `definition` fails `profileSchema` are left out and logged at `warn`
  once per id per process, with the id only); `get(id)` → `{ kind: "ok", profile } |
  { kind: "missing" } | { kind: "unusable" }`; `create(profile)` → stored profile with a
  `randomUUID()` id and revision 1, or `{ kind: "name_taken" }`; `update(id, profile,
  revision)` → the stored profile at revision + 1, or `missing`, `stale` (with the current
  one) or `name_taken`, in one `UPDATE … WHERE id = ? AND revision = ?`; `remove(id)` →
  boolean; `importAll(profiles)` → the stored ones, all inside one `BEGIN IMMEDIATE`, each with
  a new id, revision 1 and a name made unique per PD12, rolled back on any failure.
  `definition` holds `palette`, `dials`, `effects` as JSON; `name` is the column. Tests
  `server/src/profiles/store.test.ts` on `openMemoryDatabase()` with the real migrations
  applied: create then get is equal; a second create with the name in another case is
  `name_taken`; update bumps the revision and `updated_at` only; update with an old revision is
  `stale` and stores nothing; rename onto a taken name is `name_taken`; a hand-broken
  `definition` row is skipped by `list` (one warn) and `unusable` from `get`; `importAll` of a
  taken name gives "Name (2)" then "Name (3)", of a 60-character name stays ≤ 60, and with a
  failing third insert stores none. `server/test/migrate.int.test.ts`: the real folder applies
  two files; a new case boots on a folder holding only `0001`, then on the real folder, and
  sees `0002_profiles.sql` applied alone and health at 2 (AC20).
  `server/test/health.int.test.ts:36-46` reads 2. About 190 source lines, 3 source files.
- **Verification:** `pnpm run test --project unit server && pnpm run test --project integration server/test/migrate.int.test.ts server/test/health.int.test.ts && pnpm typecheck && pnpm lint`
- **Depends on:** T1
- **Autonomy note:** Builder settles the result types and how a unique-constraint failure from
  `node:sqlite` is recognised. The table is the spec's, character for character. Never edit
  `0001_init.sql` (invariant). Stop if `node:sqlite` cannot report `changes`, or if the
  constraint failure cannot be told from other errors without parsing a message that may
  change.

### T5 — `engine/`: `setProfile`, the shader builder and the prepared swap
- **Implements:** AC11, AC15, AC24, SD15, SD17, SD3
- **Expected output:** `engine/src/shader.ts` exports `buildFragment(types)` per PD3 with
  snippets for B-01's nine effects, each the corresponding lines of `LOOK_FRAGMENT`
  (`engine/src/look.ts:78-151`) including the smear's undo of brightness and flash and the
  flash mixing toward its slot colour; a type with no snippet yet is a pass-through function,
  so any valid profile renders. `engine/src/gl.ts` gains a link that does not block
  (`beginProgram` / `programReady`, using `KHR_parallel_shader_compile` when present, PD4);
  `createProgram` stays for the first program. `engine/src/index.ts`: `Engine.setProfile`
  (PD4); the frame loop draws with `profileUniforms` (T2) and the active program's uniform
  locations; the engine starts on `BUILT_IN_PROFILE`; `setDials`, `setFeatures`, `setSource`,
  `setScaleCap`, `stats`, `latency` keep their behaviour. `LOOK_FRAGMENT` is removed from
  `look.ts` (PD7). Tests `engine/src/shader.test.ts`: the functions appear in stack order and
  each calls the one before; the same types in another order give another source; an empty
  list gives the source only; the flash snippet multiplies by a uniform and holds no constant
  above 0.35. `engine/src/index.test.ts` (the existing fake context, extended to report link
  completion on demand): the four existing cases pass; with a second profile of another type
  list, frames keep using the old program until the link is ready, the swap happens between
  two frames, and no frame has no `drawArrays`; a value-only change links nothing; a failed
  link rejects and keeps drawing; the frame after a swap sets the smear uniform to 0.
  `tests/browser/shader.spec.ts`: the test builds the source for the built-in list, the empty
  list, each single effect and three shuffles, and compiles and links each in a WebGL2 context
  it creates in the page, asserting an empty info log. The whole B-01 browser suite stays
  green unchanged (identity at dials 0/0, the block property at recognisability 1, the AC7
  thresholds). About 380 source lines, 4 source files.
- **Verification:** `pnpm run test --project unit engine tests/meta/engine-boundary.test.ts && pnpm typecheck && pnpm lint && pnpm test:browser`
- **Depends on:** T2
- **Autonomy note:** Builder settles the GLSL text, the uniform naming, the cache and the
  polling. PD5's order, the per-block rule and the identity at dials 0/0 are fixed, because
  B-01's pixel tests check them. If the task passes 400 source lines the split is the snippets
  into `engine/src/snippets.ts`. Stop if any B-01 browser assertion would have to change, if
  SwiftShader's frame time for the built-in rises enough to step the render scale in a B-01
  test, or if nested functions do not compile on ANGLE.

### T6 — `engine/`: palette map, mirror and RGB split
- **Implements:** SD3, SD11, AC3, AC17
- **Expected output:** `engine/src/shader.ts` gains the three snippets: `paletteMap` (the
  picture's luma mapped onto the palette gradient from slot 0 to the last, mixed in by the
  strength; uniforms for six colours and the count), `mirror` (the coordinate folded into
  `segments` mirrored wedges about the centre, moved toward that by the strength, PD6),
  `rgbSplit` (the previous function sampled at `uv ± offset` for red and blue, `uv` for
  green). At strength 0 each is the identity. Tests `engine/src/shader.test.ts`: the three
  appear when listed; rgbSplit calls its predecessor three times, mirror once.
  `tests/browser/shader.spec.ts`: the full twelve-effect list, each new effect alone, and two
  shuffles of twelve compile and link; drawn into a 64×64 target from a two-colour test
  texture, with the test setting the uniforms: all three at strength 0 give the input back
  within ±2 of 255; `paletteMap` at 1 with a black-to-white palette gives a grey of the input's
  luma within ±6; `mirror` at 1 with 2 segments makes the left half equal the mirrored right
  half; `rgbSplit` at 1 moves the red edge and not the green one. About 120 source lines, 1
  source file.
- **Verification:** `pnpm run test --project unit engine && pnpm typecheck && pnpm lint && pnpm test:browser tests/browser/shader.spec.ts tests/browser/live.spec.ts`
- **Depends on:** T5
- **Autonomy note:** Builder settles the kaleidoscope maths and the luma weights. The values at
  strength 1 are the spec's table. If the owner takes SD3's cut, this task is `paletteMap`
  only and `mirror` and `rgbSplit` leave T1's and T2's lists in the same change; that is the
  owner's call, not the builder's. Stop if the twelve-effect shader does not link on
  SwiftShader.

### T7 — `server/`: the profile endpoints
- **Implements:** AC2, AC5, AC6, AC7, AC8, AC10, AC13, AC21, AC18, SD6, SD18
- **Expected output:** `server/src/profiles/routes.ts` exports `registerProfiles(app, store)`
  with the six routes of the spec's API contract, every body parsed with T1's schemas and
  every answer built through them, as `server/src/health.ts:13-20` does: list 200; get 200,
  404, 422 for an unusable row; create 201, 400 (PD10), 409 `name_taken`; update 200, 400,
  404, 409 with `reason`; delete 204, 404; import 201 with the stored profiles, 400 naming the
  profile and field, 422 when `formatVersion` is a number other than 1 (checked before the
  rest of the file). `server/src/app.ts`: `createApp` sets `bodyLimit` 64 KB, removes the
  `text/plain` parser, and the import route sets its own 1 MB limit; a preValidation check on
  `POST` and `PUT` answers 415 without `application/json` (PD11); an over-limit body answers
  413. No route sets a CORS header. Create, update, delete and import log at `info` with id
  and revision and never the definition. `server/src/boot.ts:74-80` builds the store from the
  open database and registers the routes beside health. Tests
  `server/test/profiles.int.test.ts` against the spawned server (`server/test/spawn-server.ts`):
  the full create, get, list (alphabetical, case-insensitive), update, delete round trip;
  restart on the same `DATA_DIR` and the profile is equal (AC5); a stale `PUT` is 409
  `stale_revision` with the current profile and the stored row unchanged (AC6); create and
  rename onto a taken name in another case are 409 `name_taken` (AC7); each AC8 clause is 400
  with the field's path and nothing stored; a 65 KB `POST` is 413 and a 900 KB import is
  accepted while a 1.1 MB one is 413; `text/plain` and a missing content type are 415 (AC21);
  no response, including to `OPTIONS` with an `Origin`, carries an `access-control-*` header;
  import of a two-profile bundle with one invalid stores nothing and names it (AC10); import
  twice gives "(2)"; a row broken by hand is absent from the list and 422 on get (AC13); the
  log holds the id and no palette colour; `/api/profiles` on the LAN address is refused like
  health (`server/test/boot.int.test.ts`). About 230 source lines, 3 source files.
- **Verification:** `pnpm run test --project integration server/test && pnpm typecheck && pnpm lint`
- **Depends on:** T4
- **Autonomy note:** Builder settles handler layout and messages. Status codes, paths and
  limits are the spec's; error shapes are PD10. Stop if Fastify 5.12.8 cannot give per-route
  body limits or the 415 without a plugin (a plugin is a dependency).

### T8 — `web/`: the profile client, the built-in entry and the compat check
- **Implements:** AC19, AC12, AC13, SD8, SD16, SD17
- **Expected output:** `web/src/profiles/api.ts`: `listProfiles`, `getProfile`,
  `createProfile`, `updateProfile`, `deleteProfile`, `importProfiles`, each taking an optional
  `fetch` like `web/src/health.ts:11-13`, sending JSON with the content type, parsing every
  answer with T1's schemas and returning a result union (`ok` | `invalid` with issues |
  `conflict` with reason | `missing` | `unusable` | `unreachable`); none throws.
  `web/src/profiles/builtin.ts`: `BUILTIN_ID`, and `builtinEntry()` giving the engine's
  `BUILT_IN_PROFILE` in the listed shape. `web/src/profiles/remembered.ts`:
  `loadProfileId()` / `saveProfileId(id)` on `djv.profile` (PD9), never throwing.
  `web/src/profile-compat.ts`: `sharedToEngine` and `engineToShared` assignments.
  `tests/meta/compat-check.ts` holds the compiler-API helper moved out of
  `features-compat.test.ts`, parametrised by the compat file and the file to mutate;
  `features-compat.test.ts` uses it with its three cases unchanged;
  `tests/meta/profile-compat.test.ts`: clean against the real files, and a diagnostic when
  `engine/src/profile.ts` renames `amount` or adds a required field (AC19). Tests
  `web/src/profiles/api.test.ts` with a fake `fetch`: each status maps to its result; a 200
  whose body fails the schema is `unusable`; a rejected fetch is `unreachable`; writes send
  `Content-Type: application/json`. `web/src/profiles/builtin.test.ts`: the engine's built-in
  parses with `profileSchema`. `remembered.test.ts`: round trip, garbage and a throwing
  storage read as none. About 210 source lines, 4 source files.
- **Verification:** `pnpm run test --project unit web tests/meta && pnpm typecheck && pnpm lint`
- **Depends on:** T1, T2
- **Autonomy note:** Builder settles the result union's names. Stop if the two profile types
  cannot be made mutually assignable without changing T1's or T2's shape (then say which
  field), or if the helper extraction would change what the existing AC19 cases prove.

### T9 — `web/`: the profile picker on the screen page
- **Implements:** AC11, AC12, AC13, AC14, AC18, SD6, SD9, SD15, SD16
- **Expected output:** `web/src/profiles/active.ts` (PD16): `createActiveProfile({ api, storage,
  setProfile, setDials, log })` with `open()`, `pick(id)`, `state()` (`entries`, `activeId`,
  `activeName`, `reason`, `loaded`) and `subscribe`. `pick` re-fetches the profile, validates
  it, awaits `engine.setProfile`, applies its starting dials, remembers the id and logs
  `console.info("profile", { id })`; an unreachable API, a 404, a 422 or an invalid body keeps
  the picture, switches to the built-in only when nothing else is active, and sets a one-line
  reason; the first `open()` or Start also selects the remembered id when the list has it,
  else the built-in (PD1). `web/src/Panel.tsx`: a labelled profile `<select>` above the dials
  (`:149`), disabled until a list has loaded, the reason line, and a link "Open builder"
  (`href="/builder"`, same tab). `web/src/Screen.tsx`: creates the controller beside the
  session; calls `open()` when `s` opens the panel and on Start; `pick` on change; the dials
  state follows the controller's starting dials on pick; nothing is fetched on load.
  `web/src/Overlay.tsx`: a line `profile: <name>`. Tests `web/src/profiles/active.test.ts`
  with fakes: no call before `open()`; the remembered id is picked when listed and the
  built-in when not; `pick` re-fetches every time; each failure keeps the previous look and
  gives its reason; the dials are applied on pick and never written back.
  `tests/browser/profiles.spec.ts`, profiles created through the API with Playwright's
  `request`: on load no `/api/profiles` request (AC12); after Start, `s` lists Built-in then
  the stored names; picking one cuts the picture (a patch differs) while a per-frame sampler
  sees no black or unchanged-blank frame across the pick, and the sliders show its starting
  dials (AC11); moving a slider sends no request and a re-fetch shows the stored dials
  unchanged; after an API `PUT` and after a `DELETE` the canvas statistics stay those of the
  old look until it is picked again (AC14); reload with it remembered selects it after Start,
  and after its deletion selects Built-in (AC12); with `/api/profiles*` routed to fail, and
  again routed to return a body that fails the schema, the panel shows a reason, the canvas
  keeps changing and no text is on it (AC13). `tests/browser/live.spec.ts:403-415`: the
  allow-list becomes `GET` of `/`, `/assets/*`, `/api/health`, `/api/profiles`,
  `/api/profiles/<id>`, the session opens the panel and picks a profile, and no profile request
  precedes the first user action (AC18). About 290 source lines, 4 source files.
- **Verification:** `pnpm run test --project unit web && pnpm typecheck && pnpm lint && pnpm test:browser`
- **Depends on:** T5, T7, T8
- **Autonomy note:** Builder settles the reason texts, test ids and how the no-blank-frame
  sampler reads the canvas (`tests/browser/helpers.ts` has `pixels` and `patch`). PD1 is an
  Owner row: build what the audit records there. Stop if any other B-01 browser test needs an
  assertion changed, or if Start's extra fetch moves the AC10 latency number.

### T10 — `web/` and `server/`: the `/builder` route, the list, create, duplicate, rename, delete
- **Implements:** AC1, AC2, AC7, SD13, SD14
- **Expected output:** `server/src/app.ts`: `registerStatic` adds `GET /builder` sending
  `index.html` (PD14); `server/test/static.int.test.ts` gains "serves the app at /builder" and
  keeps `/nope` at 404. `web/src/main.tsx` renders `Builder` on `/builder`, `Screen` otherwise.
  `web/src/builder/Builder.tsx`: loads the list through T8's client; states *loading*, *empty*
  (Built-in only, with "Create profile"), *error* (Built-in and one line; writes disabled);
  holds the selected id. `web/src/builder/ProfileList.tsx`: Built-in first, then stored names
  sorted case-insensitively; per stored profile duplicate, rename (inline text field, 1 to 60
  characters after trimming, refused in place otherwise), delete behind a native `confirm`;
  for Built-in duplicate only; "Create profile" with "from built-in" and the presets.
  `web/src/builder/presets.ts`: PD2's palettes and `fromPreset`. `web/src/builder/names.ts`:
  `nextFreeName(base, taken)` (PD12; used again in T12 and T13). A 409 `name_taken` shows
  "that name is taken" beside the field and changes nothing. All controls are native, labelled
  and in tab order; the page scrolls in its own container. Tests `names.test.ts` (the "(n)"
  rule, the 60-character trim, case-insensitive), `presets.test.ts` (each preset profile
  parses with `profileSchema`). `tests/browser/builder.spec.ts`: a fresh server shows Built-in
  and the empty state (AC1); create from built-in and from a preset each appear with a unique
  name and revision 1, read back through the API (AC2); three names in mixed case list
  alphabetically after Built-in (AC1); duplicate, rename; rename to a taken name in another
  case shows the message and the API still holds the old name (AC7); delete asks first,
  dismissing keeps it, accepting removes it (AC2); Built-in offers no rename or delete (AC2);
  with `/api/profiles` routed to fail the list shows Built-in and the error line; every
  control is reachable by Tab. About 330 source lines, 7 source files.
- **Verification:** `pnpm run test --project unit web && pnpm run test --project integration server/test/static.int.test.ts && pnpm typecheck && pnpm lint && pnpm test:browser tests/browser/builder.spec.ts tests/browser/screen.spec.ts`
- **Depends on:** T7, T8
- **Autonomy note:** Builder settles layout and styling (inline, as `web/src/Panel.tsx`), and
  wording. PD2 is an Owner row: build what the audit records. No router, form or UI package.
  Stop if `reply.sendFile` is not available from `@fastify/static` as registered.

### T11 — `web/`: the profile editor and Save
- **Implements:** AC3, AC5, AC8, SD2, SD4, SD11, SD12
- **Expected output:** `web/src/builder/editor.ts`: a pure reducer over a draft `Profile` with
  actions for the name, each dial, palette set/add/remove (2 to 6; removing a colour lowers
  any `colourSlot` now out of range to the last slot), effect add (only types not yet present,
  with defaults: amount 0.5, slot 0, 4 segments), remove, move up, move down, amount, own
  parameter, binding set and clear; `validate(draft)` through `profileSchema`, returning the
  issues by path; `isDirty(draft, saved)`. `web/src/builder/Editor.tsx`: name, the two
  starting dials, the palette (preset menu from T10's `presets.ts`, a colour input per slot,
  add, remove), the effect stack in order (add menu of the remaining types, move up, move
  down, remove; per effect a strength slider, its own parameter where it has one, a binding
  row of feature dropdown with "none" and an amount), abstraction effects marked; Save
  (disabled while invalid, unchanged or offline), which sends the draft with its revision
  through T8's `updateProfile` and adopts the answer; a save that fails keeps the draft and
  says so. The Built-in is shown read-only. `Builder.tsx` mounts it for the selected profile.
  Tests `web/src/builder/editor.test.ts`: every action; no action sequence yields a draft the
  schema rejects except an empty or over-long name, which `validate` reports (AC3); move at
  either end is a no-op; add offers nothing at twelve; removing a palette colour repairs
  slots. `tests/browser/builder.spec.ts`: set three colours, add `paletteMap` and `mirror`
  with 6 segments, bind flash to `high`, move an effect, set the dials, Save: the API returns
  exactly that at revision 2 (AC3, AC5); the add menu never lists a present type and is empty
  at twelve; palette remove is disabled at 2 and add at 6; an empty name disables Save and
  shows why (AC3, AC8); everything is operable by keyboard alone. About 370 source lines, 3
  source files.
- **Verification:** `pnpm run test --project unit web && pnpm typecheck && pnpm lint && pnpm test:browser tests/browser/builder.spec.ts`
- **Depends on:** T10
- **Autonomy note:** Builder settles the control layout and defaults for a newly added effect.
  If the task passes 400 source lines the split is `web/src/builder/EffectRow.tsx`. Stop if a
  drag-and-drop or colour-picker package seems needed (SD13 asks for buttons; the native
  colour input is enough).

### T12 — `web/`: conflict, unsaved changes and revert
- **Implements:** AC6, AC5, SD10
- **Expected output:** `web/src/builder/Conflict.tsx`: on a 409 `stale_revision` the editor
  shows "this profile was changed elsewhere" with two buttons: "Reload theirs" (the draft
  becomes the server's current profile from the 409 body) and "Save mine as a copy" (creates
  a new profile named by `nextFreeName`, selects it, leaves the original as stored); the draft
  is never lost before one is chosen. `Editor.tsx` / `Builder.tsx`: an "unsaved changes" mark
  while `isDirty`; "Revert to last saved"; selecting another profile or following a link while
  dirty asks through `confirm`, and `beforeunload` is set only while dirty; a 404 on save
  (deleted elsewhere) offers "save as a new profile". Tests extend `editor.test.ts` (revert
  restores the saved state; dirty clears on save). `tests/browser/builder.spec.ts`: two pages
  on one profile, both edit, the first saves, the second's Save shows the choice and the API
  still holds the first's version (AC6); "Reload theirs" shows the first's values; in a fresh
  pair, "Save mine as a copy" creates "Name (2)" with the second's values and leaves the
  original (AC6); revert; the dirty mark; switching profiles while dirty asks; with the save
  request routed to fail the draft survives and Save works once the route is restored (AC5).
  About 160 source lines, 3 source files.
- **Verification:** `pnpm run test --project unit web && pnpm typecheck && pnpm lint && pnpm test:browser tests/browser/builder.spec.ts`
- **Depends on:** T11
- **Autonomy note:** Builder settles wording beyond the two button labels, which are the
  spec's. Stop if "save mine as a copy" can lose the draft on a failed create.

### T13 — `web/`: export and import
- **Implements:** AC9, AC10, SD7
- **Expected output:** `web/src/profiles/file.ts`: `exportFile(profiles)` → the JSON text from
  T1's `toProfileFile`; `fileName(profiles)`; `download(text, name)` through a `Blob` and a
  temporary `<a download>`; `readImport(text)` → `{ kind: "ok", file }`, `not_json`,
  `unsupported_version` (a `formatVersion` other than 1) or `invalid` with issues naming the
  profile and field, checked with `profileFileSchema` before anything is sent.
  `web/src/builder/Transfer.tsx`, mounted in the list: "Export" per profile (Built-in
  included), "Export all" (a fresh `GET /api/profiles`; every stored profile; disabled when
  none), "Import" (a labelled file input accepting `.json`): a valid file goes to
  `importProfiles`, the list reloads and the stored names are shown; any failure, local or
  from the server, is shown as "<profile name>: <field> — <message>" or "unsupported file
  version" or "not a JSON file", and nothing is stored. Tests `web/src/profiles/file.test.ts`:
  the exported text has `formatVersion` 1 and no `id`, `revision`, `createdAt` or `updatedAt`
  anywhere (AC9); it parses back; each failure kind. `tests/browser/builder.spec.ts`: export
  one and export all are downloaded and read by the test (one entry; every stored profile)
  (AC9); delete the profile and import the bundle: it returns with a new id and revision 1;
  import again: "Name (2)" (AC10); a file with one broken field, a `formatVersion` 2 file and
  a text file each store nothing (the API list is unchanged) and show the named error (AC10).
  About 180 source lines, 3 source files.
- **Verification:** `pnpm run test --project unit web && pnpm typecheck && pnpm lint && pnpm test:browser tests/browser/builder.spec.ts`
- **Depends on:** T12
- **Autonomy note:** Builder settles the file names and error wording. The file shape is the
  spec's. Stop if the download cannot be observed by Playwright without a page-side hook.

### T14 — `web/`: the builder's preview canvas
- **Implements:** AC4, SD5, SD19
- **Expected output:** `web/src/SourcePickers.tsx`: the camera and audio-source rows moved out
  of `web/src/Panel.tsx:105-148` unchanged, with the same test ids, and used by `Panel.tsx`.
  `web/src/builder/Preview.tsx`: a canvas above the editor with its own `createEngine`; every
  draft change goes to `engine.setProfile` (through `profile-compat.ts`) and the draft's
  starting dials to `setDials` (PD15), so a value edit shows on the next frame and a stack
  edit after the prepared swap; before Start the features are `syntheticFeatures(now)` (T3)
  and the source is the noise field; a Start button creates a capture session exactly as
  `web/src/Screen.tsx:66-74` does (`createSession`, the same module URL) and shows
  `SourcePickers`; after Start the features are the session's and the video is the camera,
  falling back to noise and to zero features on `none` or `lost`; the engine and session stop
  on unmount. The preview exists only in the builder tree. Tests
  `tests/browser/preview.spec.ts`: with no media request made, the preview canvas changes
  between reads and a centre patch brightens on the synthetic beat when flash is bound to
  `beat` at amount 1 (AC4); changing a palette colour with `paletteMap` at 1 changes the
  patch's mean colour by the next sample, and adding `mirror` changes the picture without a
  blank frame (AC4); after Start the recorder (`tests/browser/helpers.ts`) saw the three
  `false` constraints and the picture follows the fake camera's halves at dials 0/0 (AC4);
  with the camera denied the preview stays generative; `/` has no preview canvas and the
  builder has no `data-testid="screen"` canvas (AC4). `tests/browser/panel.spec.ts` passes
  unchanged. About 200 source lines, 4 source files.
- **Verification:** `pnpm typecheck && pnpm lint && pnpm test:browser tests/browser/preview.spec.ts tests/browser/panel.spec.ts tests/browser/builder.spec.ts`
- **Depends on:** T13, T3, T6, T9
- **Autonomy note:** Builder settles the preview's size and where Start sits. The pickers are
  moved, not rewritten. Stop if two engines in one page (after navigating from `/`, only one
  exists; within `/builder` only the preview) or the second `AudioContext` misbehave in
  Chromium, or if `panel.spec.ts` needs a changed assertion.

### T15 — Browser proof with a twelve-effect profile, and the whole gate
- **Implements:** AC17, AC18, AC23
- **Expected output:** `tests/browser/fixtures/profiles.ts` gains `twelveEffects()` (PD17).
  `tests/browser/live.spec.ts`: with that profile created through the API and picked in the
  panel, the overlay's p95 is ≤ 50 ms once start-up has left the window (the B-01 test at
  `:238`, parametrised over Built-in and the twelve-effect profile); with slow frames the
  scale steps to 75% and 50% and back up as at `:342`, under the twelve-effect profile; the
  measured values are attached to the report beside the thresholds; the AC18 test runs its
  session on the twelve-effect profile too and asserts no request body or WebSocket leaves the
  page. The full gate is green three times in a row. About 30 source lines (fixtures and
  helpers); the rest are tests.
- **Verification:** `pnpm test:browser && bash scripts/check.sh` (paste the full gate output of
  each of the three runs)
- **Depends on:** T14
- **Autonomy note:** Builder settles the parametrisation. PD17's fallback is not the builder's
  to take: on a p95 over 50 ms, or a scale that will not hold 100% at rest under the
  twelve-effect profile on SwiftShader, stop and report the numbers.

### T16 — Docs as built
- **Implements:** SD6, SD13, SD8
- **Expected output:** `docs/invariants.md:27` becomes: no media reaches the server; `server/`
  has no endpoint for audio or video, and a running set requests only `GET /`, `/assets/*`,
  `/api/health`, `/api/profiles` and `/api/profiles/:id`, the last two only on a user action;
  enforced by review and `tests/browser/live.spec.ts`; a new row for the `Profile` compat
  check beside the `AudioFeatures` one. `docs/design/architecture.md`: the diagram with the
  builder route and the profile endpoints; the modules table (`engine/` surface with
  `setProfile`, `BUILT_IN_PROFILE`; `audio/` with `syntheticFeatures`; `shared/` with the
  profile schemas; `server/` with the store and routes; `web/` with `/builder`); "The look"
  rewritten as profiles, the effect chain and the prepared swap; Data → Tables with
  `profiles`, row validity on read, and the file format; cross-cutting: body limits, JSON-only
  writes, no CORS, the profile log lines. `CLAUDE.md` Conventions: the builder route and where
  profile data lives. `README.md`: one line on `/builder` if it lists routes. `docs/backlog.md`:
  B-02 built; the B-03 note (code would arrive as one more effect type, SD1) and the B-07 note
  the spec asks for. No source file changes.
- **Verification:** `bash scripts/check.sh`, and `grep -n "Nothing a person made is stored yet" docs/design/architecture.md` prints nothing
- **Depends on:** T15
- **Autonomy note:** Builder writes only what the code now does, with file references.
  `docs/design/` and the invariant row are owner areas: the spec approved these edits and
  nothing beyond them. Stop if any sentence would state a decision not in the spec, the SDR or
  this plan.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1 | `shared/src/` |
| 1 | T2 | `engine/src/profile.ts`, `engine/src/index.ts` |
| 1 | T3 | `audio/src/synthetic.ts`, `audio/src/index.ts` |
| 2 | T4 | `server/migrations/0002_profiles.sql`, `server/src/db.ts`, `server/src/profiles/store.ts`, `server/test/health.int.test.ts`, `server/test/migrate.int.test.ts` |
| 2 | T5 | `engine/src/shader.ts`, `gl.ts`, `look.ts`, `index.ts`, `index.test.ts`, `tests/browser/shader.spec.ts` |
| 2 | T8 | `web/src/profiles/api.ts`, `builtin.ts`, `remembered.ts`, `web/src/profile-compat.ts`, `tests/meta/compat-check.ts`, `profile-compat.test.ts`, `features-compat.test.ts` |
| 3 | T6 | `engine/src/shader.ts`, `tests/browser/shader.spec.ts` |
| 3 | T7 | `server/src/profiles/routes.ts`, `server/src/app.ts`, `server/src/boot.ts`, `server/test/profiles.int.test.ts` |
| 4 | T9 | `web/src/profiles/active.ts`, `web/src/Panel.tsx`, `Screen.tsx`, `Overlay.tsx`, `tests/browser/profiles.spec.ts`, `tests/browser/fixtures/profiles.ts`, `tests/browser/live.spec.ts` |
| 4 | T10 | `web/src/main.tsx`, `web/src/builder/Builder.tsx`, `ProfileList.tsx`, `presets.ts`, `names.ts`, `server/src/app.ts`, `server/test/static.int.test.ts`, `tests/browser/builder.spec.ts` |
| 5 | T11 | `web/src/builder/editor.ts`, `Editor.tsx`, `Builder.tsx`, `tests/browser/builder.spec.ts` |
| 6 | T12 | `web/src/builder/Conflict.tsx`, `Editor.tsx`, `Builder.tsx`, `tests/browser/builder.spec.ts` |
| 7 | T13 | `web/src/profiles/file.ts`, `web/src/builder/Transfer.tsx`, `ProfileList.tsx`, `tests/browser/builder.spec.ts` |
| 8 | T14 | `web/src/SourcePickers.tsx`, `web/src/Panel.tsx`, `web/src/builder/Preview.tsx`, `Builder.tsx`, `tests/browser/preview.spec.ts` |
| 9 | T15 | `tests/browser/fixtures/profiles.ts`, `tests/browser/live.spec.ts` |
| 10 | T16 | `docs/design/architecture.md`, `docs/invariants.md`, `CLAUDE.md`, `README.md`, `docs/backlog.md` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph <this
file>` prints the groups the `Depends on` fields actually give. Group 4: T9 stays in the screen
page's files and the screen-page specs; T10 in `main.tsx`, `web/src/builder/`, the server's
static route and `builder.spec.ts`; if T10 needs a profile fixture it creates it inline, not in
`tests/browser/fixtures/profiles.ts`. T11 to T14 are a chain because each writes `Builder.tsx`
or `builder.spec.ts`.

## Data changes

One additive migration, `server/migrations/0002_profiles.sql`: the `profiles` table exactly as
the spec's Data section gives it (`id`, `name COLLATE NOCASE UNIQUE`, `revision`, `definition`,
`created_at`, `updated_at`). No backfill: the table starts empty and the built-in is code.
`0001_init.sql` is not touched. Forward-only, as every migration here (architecture, Data →
Direction); undoing it locally is deleting the database file, which loses the stored profiles,
so export first. Browser storage: one new `localStorage` key, `djv.profile`, holding a profile
id; removing it selects the built-in.

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| The generated shader (PD3) has not been compiled anywhere yet: nested functions, a nine-fold source evaluation in the worst case, and compile time on ANGLE/SwiftShader are untested. | T5 proves it first, on the nine B-01 effects, against B-01's unchanged pixel tests; its autonomy note stops the build if any of them moves. T6 and T15 measure the twelve-effect case. The fallback (two programs, or capping edges × rgbSplit) is an owner decision. |
| AC17 on SwiftShader: a twelve-effect shader may be slow enough in CI to raise p95 or to step the render scale at rest. | PD17: stop and report; the owner chooses between a lower CI resolution for that test, a looser CI assertion with the 50 ms kept in H3, or simplifying an effect. |
| `KHR_parallel_shader_compile` may be missing in headless Chromium; then the link is read synchronously on one frame. | PD4 keeps the old program drawing either way, so no blank frame; the cost is one long frame at a structural switch. T5's unit test covers both paths; T9's browser test covers whichever Chromium gives. |
| The built-in must reproduce B-01 in pixels, not only in uniforms, or B-01's AC7 and AC8 browser tests fail. | PD5's order is derived term by term from `LOOK_FRAGMENT`; T5 runs the whole B-01 browser suite unchanged. |
| The SD4 formula and the three new effects' parameters are spec defaults the owner may still object to at review. | Every number is a named constant in `engine/src/profile.ts` or `look.ts`; changing one is a one-line change plus its test, and stored profiles hold only strengths, so they stay valid. |
| A stored profile from before a later schema change. | Row validity on read (T4) turns it into "unusable" and the built-in, never a crash; `formatVersion` is in the file, not the row, so a later migration of rows is that phase's task. |
| PD1 changes the feel of Start: dials moved before Start are overwritten when the remembered profile loads. | Named in PD1 for the owner; only when a stored profile is remembered. |
| T5 (about 380 lines) and T11 (about 370) are near the limit. | Each names its split in the autonomy note. |
| Planner's disagreement, not reopened: AC11 has the picker fetch on every panel open; with the panel as B-04's future control surface that request pattern will be replaced by a channel. | None needed now; SD9 already says so. |
| The spec and the backlog edit are uncommitted; `/build` needs a clean tree. | H1. |
| Windows leaves orphan `node` processes on 8123 after a crashed browser run, which fails the next run's server start. | Known locally; the builder clears the port before re-running rather than changing `playwright.config.ts`. |

## Human steps

- **H1 — before `/audit`.** Commit the working copy (the spec, `docs/backlog.md`) and this plan
  on a branch. Answer PD1 and PD2.
- **H2 — after T14, on the screen machine: the spec's Verification 2 to 7 by hand.** Build
  "Warm" in `/builder` with no camera and no music (the synthetic loop drives the preview);
  pick it on the screen page with a track playing, see the cut and the starting dials; edit,
  re-pick, delete; two tabs and the conflict choice; export, delete, import, import again,
  import a broken file; stop the server mid-set and pick. This is also where the look of the
  three new effects and of PD2's presets is judged by eye, which no test does.
  - [x] Notes: 2026-11-14 — passed on the owner's attestation ("functionality as expected").
    No per-item observations recorded. Build under test not stated: the working tree then held
    an uncommitted layout change to `web/src/builder/Builder.tsx` on top of 116c827.
- **H3 — after T15, on the screen machine: Verification 8 and 9.** A twelve-effect profile
  with the owner's load: overlay p95 ≤ 50 ms over a minute, and the render scale steps down
  and back under added load (AC17 on the real GPU; the CI check in T15 is SwiftShader only).
  `curl http://<LAN address>:8000/api/profiles` is refused; a `curl -X POST` without a JSON
  content type answers 415.
  - [x] Notes: 2026-11-14 — twelve-effect profile under the owner's load: overlay latency p95
    23 ms over a minute (≤ 50). Render scale 100% unloaded; stepping down and back up under added
    load passed on the owner's attestation, figures not recorded. GET to `192.168.0.117:8000`
    refused ("Unable to connect to the remote server"); `POST /api/profiles` with
    `Content-Type: text/plain` answered 415.
- **H4 — push and CI.** Push the branches and open the pull requests in order; confirm the
  `check` job is green (Verification 10). Pushing is the owner's (CLAUDE.md hard stops).

## Out of scope for this plan

- Everything under the spec's "Out of scope", unchanged: authoring by Claude Code, code in a
  profile, assets, live push, crossfades, saving live changes, scenes, folders or search, undo
  beyond revert, repeated effects, other browsers, touch layout.
- A general SPA fallback on the server: only `/builder` is routed (PD14).
- Evicting old compiled programs beyond a small cache, and pre-compiling every stored profile
  at Start: one program is compiled per switch.
- A profile thumbnail or a preview on the screen page's panel.
- Caching the Playwright browser in CI and CI gate time (open since Phase 0).

## Audit decisions (2026-11-12)

Binding on `/build`; where one contradicts a task above, this section wins.

- **AD1 — rename keeps identity (AC2).** A rename is a save: same id, revision + 1, name
  uniqueness enforced (409 `name_taken`). Only create, duplicate and import make a new id at
  revision 1. T10's rename test also asserts the id is unchanged and the revision rose.
- **AD2 — empty database shows no reason (AC13).** No stored profile means the built-in with no
  reason line; the reason line is for unreachable, 404, 422 and invalid. T9 tests that.
- **AD3 — AC4 versus SD15.** Value edits show on the next frame; add, remove and move show after
  the prepared swap (PD4), which may take more than one frame. The preview keeps drawing the old
  program meanwhile. T14's test asserts no blank frame, not a frame count.
- **AD4 — the invariant row moves to T9.** T9 edits `docs/invariants.md:27` in the same change
  that adds the allow-list test; T16 only adds the `Profile` compat row.
- **AD5 — one "Name (n)" rule.** `nextFreeName` lives in `shared/` (T1, with its test, including
  the 60-character trim); T4's `importAll` and T10, T12, T13 import it. `web/src/builder/names.ts`
  is not created.
- **AD6 — measurable checks.** T9's no-blank-frame sampler fails on any sampled frame whose mean
  luma is under 2/255 or identical to the previous sample across a pick; T11's keyboard check
  reuses T10's "every control reachable by Tab". The LAN-refusal case for the profile route is
  added to `server/test/boot.int.test.ts`, which T7 therefore lists as a file.
- **AD7 — left as is, owner's call.** No `Host` header check against DNS rebinding (SD18
  unchanged).

## Audit

- [x] Every AC maps to at least one task
- [x] Every task maps to at least one AC (no orphans; T16 is docs, traced to SD6/SD8/SD13)
- [x] Each task's expected output is concrete enough to check, and is what we actually need
- [x] Existing patterns reused; nothing reinvented (AD5)
- [x] No new dependency without an approval note
- [x] Data changes additive and reversible
- [x] Errors, empty states and permissions are tasks, not afterthoughts
- [x] Each task reviewable in one sitting
- [x] Verification named per task
- [x] Nothing touches prod, secrets or infra it should not
- [x] Every task has a Depends on and an Autonomy note
- [x] No two tasks in one parallel group write the same file

Audited by: Martijn Boot  Date: 2026-11-12
