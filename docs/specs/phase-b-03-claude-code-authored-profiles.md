# Spec: b-03 — Claude Code-authored profiles

Status: Approved · Depends on: B-02 (`docs/specs/phase-b-02-visual-profiles.md`, built), B-04
(`docs/specs/phase-b-04-live-set-controls.md`, built) · Fixes: — · Backlog: B-03

Line references are to `main` at `57cc216`.

## Problem

The richest looks start from something outside the app: a painting, a set of images, an idea.
In a Claude Code session the owner wants to hand that inspiration to the agent and get back a
profile that changes the camera feed in a way the inspiration suggests, then store, edit and
play it like any other profile. Today that has nowhere to go:

- A profile can only say what the builder can say: a palette of up to 6 colours, two starting
  dials and a stack of the twelve fixed effects (`shared/src/profile.ts:8-21`,
  `shared/src/profile.ts:72-79`). Every effect type may appear once
  (`shared/src/profile.ts:87-97`). An agent writing that file adds judgement but no new looks:
  every profile is a mix of the same twelve snippets.
- The shader is assembled only from those fixed snippets (`engine/src/shader.ts:83-144`); a type
  without a snippet passes the picture through (`engine/src/shader.ts:146-148`). "No profile
  carries code" is written into the engine (`engine/src/shader.ts:7`) and the architecture
  (`docs/design/architecture.md:106`). B-02 SD1 left exactly this door open: code would arrive
  as one more effect type.
- Flashing is bounded only because the effect list is fixed: flash mixes at most `FLASH_MAX`
  toward a colour (`engine/src/profile.ts:121`, `engine/src/profile.ts:209`, B-02 AC24). Code
  could strobe at full white.
- A slow look is handled only by the render scale stepping to 50%
  (`engine/src/scale.ts:24-27`); the twelve built-ins are known to fit (B-02 AC17), agent code
  is not. Nothing in the engine or `web/` handles a lost WebGL context (no `webglcontextlost`
  handler anywhere), so a shader that trips the GPU watchdog leaves the screen black mid-set.
- Importing only adds: a re-imported revision becomes "Name (2)" (B-02 SD7,
  `server/src/profiles/routes.ts:82-104`, `web/src/builder/Transfer.tsx:46-73`). Iterating with
  the agent leaves a trail of duplicates, and the screen page's remembered id (`djv.profile`) and
  B-04's controllers stay on the old one.
- The agent cannot see a screen. Nothing lets it check that a profile compiles or what it looks
  like before the owner imports it.
- There is no folder for authored profiles or their inspiration, and no command under
  `.claude/` for authoring one (`.claude/commands/` holds only the generic workflow commands).

## Decisions

- **SD1 — A profile may carry code, as one more effect type, `custom`.** The code is a GLSL
  function body, never JavaScript; it is only ever handed to WebGL as part of the fragment
  shader. WebGL is the sandbox: the code reaches only the inputs of SD3, no file, network or page
  state. Profiles stay plain JSON validated by the shared schema. This amends B-02 SD1 and the
  "never code" line of `docs/design/architecture.md:106`; approving this spec approves that
  edit.
- **SD2 — Image assets are not in B-03.** The inspiration may be an image, but the profile
  carries no image. Assets (a colour-grade lookup, a surface texture, warp or mask maps from
  the inspiration) become backlog item B-14, ordered right after B-03. The custom effect is
  shaped so a later version can add texture inputs without a format break.
- **SD3 — A custom effect is one link in the existing chain.** It sits in the stack beside the
  twelve built-ins, ordered freely, and its function receives `uv` and may sample the picture
  before it (`source(uv)`, i.e. `fx(N-1)`) at any coordinate and any number of times. Its inputs
  are: the output resolution, time, the five audio features, the palette and its size, the
  previous frame, its own strength and its own parameters (SD4). The exact names are the custom
  effect contract (Data → Custom effect contract). A full-screen look is one custom effect that
  ignores everything before it except the camera.
- **SD4 — A profile may hold several custom effects, each with up to 4 named parameters.** Each
  custom effect has a label (unique within the profile), a base strength, at most one audio
  binding (B-02 SD4, unchanged), an abstraction flag (SD12) and 0 to 4 parameters, each a name and
  a value 0 to 1. The builder shows every parameter as a slider. Custom effects count toward the
  12-effect limit; the "each type at most once" rule (B-02 SD12) does not apply to `custom`.
  Per-parameter audio bindings are out (an author wires a feature inside the code instead).
- **SD5 — The engine limits flashing in any profile that holds a custom effect.** A final step
  after the chain limits each output pixel's luminance change from the previous frame to the
  built-in flash's worst step (`FLASH_MAX`, 0.35 of full scale), so a strobe in code becomes a
  pulse, whatever the code does. B-02's promise holds: no profile can flash harder than the app
  allows. *(How the limit is measured — per pixel, on the final output, against the previous
  frame, only in profiles with a custom effect so built-in-only profiles render exactly as today
  and B-02 AC15 still holds — is a default, not asked; object at review.)*
- **SD6 — An authored profile reaches the app as a file the owner imports.** The agent writes
  `profiles/<slug>.json` in the export format plus `profiles/<slug>.md` (the notes, SD11), both
  committed. The owner imports through the builder's Import. The agent never writes to the
  database, never calls the running server's write endpoints, and never touches SQLite: the local
  database is where gigs are played (SDR §3).
- **SD7 — A check script lets the agent see its work.** `pnpm profile:check <file> [--camera
  <image>]` validates the file against the shared schema, compiles every profile in it in the
  real engine in headless Chromium (the browser tests' software WebGL), and renders still PNGs per
  profile: quiet, a kick, a hi-hat peak, each at dials (0, 0), the profile's starting dials and
  (1, 1). The camera is a generated test scene unless `--camera` names an image. It reports per
  profile whether the flash limiter (SD5) clipped any frame. It exits non-zero on a schema or
  compile failure, naming the profile, effect and the compiler's message with its line. Speed is
  not checked: software WebGL timings say nothing about the owner's GPU (SD8).
- **SD8 — A runtime guard keeps the screen drawing.** On the screen page and in the builder
  preview: if the render scale is at 50% and the one-second mean frame time stays above budget
  (`scale.ts`'s test) for 3 s, the engine bypasses every custom effect of the active profile; the
  built-ins and the camera keep running, and the panel and the controller's status say why.
  Picking the profile again retries. If the WebGL context is lost, for any profile, the engine
  restores it and rebuilds the active profile, without its custom effects when it had any, so the
  output returns within one second instead of staying black. The builder's preview shows its frame
  time so the owner sees before a gig whether a look fits their GPU. *(3 s and "within one second"
  are defaults, not asked.)*
- **SD9 — The builder edits the code in a plain text box.** Each custom effect shows its code in a
  native monospace `<textarea>`; edits compile into the preview as they are typed. A compile
  error shows the compiler's message and line and keeps the last version that compiled drawing in
  the preview. Save is refused while any custom effect's code does not compile. "Add effect"
  offers "Custom", starting from a small template. No editor library (no new dependency).
- **SD10 — Importing one profile whose name is taken offers "Replace".** When an imported file
  holds exactly one profile and its name matches a stored one (case-insensitively, trimmed), the
  builder asks: "Replace *Name*" or "Add as a copy". Replace stores the file's definition into
  the existing profile through the existing save (`PUT /api/profiles/:id` with the revision the
  builder just read): same id, revision + 1, so the remembered id and B-04's controllers keep
  working, and a concurrent change gets B-02's conflict choice (SD10 there). "Add as a copy" is
  today's import. A bundle of several profiles still only adds, all or nothing. This amends B-02
  SD7 ("import only adds") for the single-profile case; no ADR is touched.
- **SD11 — Inspiration stays on the owner's machine.** Images and other material go in
  `inspiration/<slug>/`, ignored by git. The committed notes file records what the look was drawn
  from (title, artist or source, a link where there is one) and what the agent took from it
  (palette, motion, texture, the idea), so the look can be re-authored from a fresh clone and the
  source. No third-party image or personal photo is committed (`docs/invariants.md:23`).
- **SD12 — Each custom effect carries an abstraction flag.** Flagged, recognisability scales its
  strength exactly as for pixelate, posterise and smear; unflagged, it does not. Reactivity
  scales its binding like every other. The effective strength is B-02 SD4's formula, unchanged.
  The agent sets the flag; the builder shows it as a checkbox. The code never reads a dial.
- **SD13 — Strength 0 is the identity.** At effective strength 0 (below 0.001) the engine passes
  the picture through without running the custom code, so a custom effect at 0 can never change
  the picture, and a profile at dials (0, 0) whose custom effects are all flagged and unbound
  shows the camera unchanged. *(default, not asked)*
- **SD14 — The authoring command is `/profile`.** `.claude/commands/profile.md` guides a session:
  gather the inspiration into `inspiration/<slug>/`, write the notes, write the profile file
  against the custom effect contract, run `pnpm profile:check`, look at the stills, iterate, and
  finish by telling the owner to import the file. The contract itself is one document,
  `docs/custom-effects.md`, which the command and the builder's template both follow. One
  profile per run unless the owner asks for variations. *(default, not asked)*
- **SD15 — A file holding a custom effect is `formatVersion` 2.** Export writes version 1 when no
  profile in the file has a custom effect, so a built-in-only export stays readable by a B-02
  instance; otherwise 2. Import accepts 1 and 2. A B-02 instance answers a version-2 file with its
  existing "unsupported file version". *(default, not asked)*
- **SD16 — Limits.** Code at most 8 KB per custom effect; label 1 to 40 characters; parameter
  name 1 to 24 characters, unique within its effect. The write body limit rises from 64 KB to
  128 KB (B-02 SD18) so twelve custom effects fit one save; the import limit stays 1 MB. The
  schema refuses code containing `#` (preprocessor), the words `uniform`, `in`/`out` as
  declarations at the start of a line, or unbalanced braces, so a body cannot leave its function;
  the compiler is the real check. *(default, not asked)*
- **SD17 — The server never compiles code.** It validates the schema only (it has no GPU). A
  stored custom effect whose code does not compile (hand-edited, or from a file that skipped the
  check) is handled where it is used: the screen keeps the current look and shows the reason, as
  B-02 does for a program that does not link. *(default, not asked)*

## Users and permissions

| Role | Can | Cannot |
|---|---|---|
| Owner on the screen machine | Author profiles with Claude Code; import, replace, edit (code included), export them in `/builder`; play them on the screen page | Store a profile the schema refuses; save code that does not compile in the builder |
| Claude Code session (agent) | Read `inspiration/`; write `profiles/<slug>.json` and `.md`; run `pnpm profile:check` | Write to the database, call the server's write endpoints, commit anything under `inspiration/` |
| Paired controller (B-04) | Pick, dials, colours, camera, as today; see the bypass reason in its status | Edit custom effects or their parameters (B-04 out of scope, unchanged) |

## In scope

- `shared/`: the `custom` effect in `effectSchema` (label, amount, binding, abstraction, params,
  code), the SD16 limits and code checks, the per-type-once rule exempting `custom`, the unique
  label rule, `formatVersion` 2 and the version choice in `toProfileFile` (SD15).
- `engine/`: `Profile` declares the same shape (compat check, `docs/invariants.md:29`);
  `buildFragment` wraps each custom body in its own `fxN` with the contract's inputs; the
  identity at strength 0 (SD13); the flash limiter (SD5); custom parameter uniforms; programs
  still cached by their effect list *and* code; the bypass (SD8) and context-loss recovery;
  compile errors reported with effect index and line. Still no dependency.
- `server/`: the write body limit (SD16). Nothing else: no new endpoint, no migration (the
  `definition` column already holds JSON).
- `web/`: the builder's custom effect row (label, strength, binding, abstraction checkbox,
  parameter sliders, code text box, compile error), "Custom" in Add effect, the frame-time
  readout in the preview, the Replace choice on import (SD10), the bypass and recovery reasons in
  the panel and in the state sent to controllers.
- `scripts/`: `profile:check` (SD7), using the Chromium Playwright already installs.
- Repo: `profiles/` (committed), `inspiration/` in `.gitignore`, `.claude/commands/profile.md`,
  `docs/custom-effects.md`.
- Docs: `docs/design/architecture.md` (profiles may carry code, the custom effect, the limiter,
  the guard, Replace, the check script; approving this spec approves that edit),
  `docs/invariants.md` (one new row, below), `CLAUDE.md` (commands: `pnpm profile:check`,
  `/profile`), backlog (B-03 specced, B-14 added).
- New cross-phase invariant: **"Profile code is GLSL only: it is never evaluated as JavaScript
  and reaches the browser only through `shaderSource`"**, enforced by ESLint `no-eval`,
  `no-implied-eval`, `no-new-func` and a unit test that the code string reaches only the shader
  builder. *(default, not asked)*

## Out of scope

- Image or any other asset in a profile, a texture input to custom code, an asset store, assets in
  the file format (B-14).
- Neural style transfer or any machine learning model at run time.
- An AI chat or any Claude call inside the web app (B-03 "Not this").
- The agent writing to the database or the running server (SD6); a `profile:push` script.
- Performance measured by the check script; a performance budget enforced statically.
- Per-parameter audio bindings; the dials as inputs to code (SD12).
- A code editor library, syntax highlighting, autocompletion (SD9).
- Editing custom effects, their parameters or code from a B-04 controller, or live on the screen.
- Replace for a bundle of several profiles; merging two profiles; a version history of a profile
  in the app (git holds the files' history).
- Repeated built-in effects (B-02 SD12 still holds for them).
- Sharing profiles between users, a profile gallery, publishing.
- Committing inspiration images, or fetching them from the web inside the app.
- Browsers other than Chromium (B-01 SD12).

## Acceptance criteria

- **AC1.** When a profile holds one or more `custom` effects that satisfy the schema (SD4, SD16),
  the system shall accept it on create, update and import, store it, and return it unchanged.
- **AC2.** If a custom effect has a label outside 1 to 40 characters, a label used twice in the
  profile, more than 4 parameters, a parameter name outside 1 to 24 characters or repeated, a
  parameter value outside 0 to 1, code over 8 KB, or code containing `#`, `uniform`, an
  `in`/`out` declaration or unbalanced braces, then the system shall answer 400 naming the field
  and store nothing.
- **AC3.** When a profile holds several custom effects, the system shall accept it while the
  stack holds at most 12 effects in total and every built-in type at most once, and shall refuse a
  13th effect.
- **AC4.** While a custom effect is in the stack, the system shall run its code at its stack
  position: it shall receive the picture of the effect before it through `source(uv)`, and the
  effects after it shall receive its result.
- **AC5.** When a custom effect's effective strength is 0, the system shall render the same image
  as the same profile without that effect (SD13).
- **AC6.** While a custom effect is flagged as an abstraction effect, moving recognisability shall
  scale its strength by B-02 SD4's formula; while it is not flagged, moving recognisability shall
  not change its output; and while reactivity is 0, its output shall not depend on the audio
  through its binding.
- **AC7.** While a profile holds a custom effect, no output pixel's luminance shall change by more
  than 0.35 between two consecutive frames, including for code that alternates full black and
  full white every frame (SD5).
- **AC8.** While a profile holds no custom effect, the system shall render exactly as before this
  spec: B-02 AC15's equivalence and every B-02 and B-04 test still pass.
- **AC9.** When `pnpm profile:check` runs on a valid file, the system shall exit 0 and write, per
  profile, still PNGs for quiet, kick and hi-hat peak at dials (0, 0), the starting dials and
  (1, 1), from the generated scene or the `--camera` image, and shall report whether the flash
  limiter clipped any frame.
- **AC10.** If `pnpm profile:check` runs on a file that fails the schema or holds code that does
  not compile, then the system shall exit non-zero naming the profile, the effect and the field,
  or the compiler's message and line.
- **AC11.** If the render scale is at 50% and the one-second mean frame time stays above budget
  for 3 s while a profile with custom effects is active, then the system shall bypass its custom
  effects, keep drawing the built-ins and the camera, and show the reason in the panel and in a
  paired controller's status; and when the profile is picked again, the system shall run its custom
  effects again.
- **AC12.** If the WebGL context is lost, then the system shall restore it and draw the active
  profile again within one second, without its custom effects when it holds any, show the reason
  in the panel, and never leave the output black or show text on it.
- **AC13.** While the builder edits a custom effect, the system shall show its label, strength,
  binding, abstraction checkbox, one slider per parameter and its code in a text box, and shall
  apply each edit to the preview on the next successful compile.
- **AC14.** If the code in the builder does not compile, then the system shall show the compiler's
  message and line, keep the last compiled version in the preview, and refuse Save until it
  compiles.
- **AC15.** When the user adds "Custom" in the builder, the system shall add a custom effect from
  the template, which compiles and passes the picture through at strength 0.
- **AC16.** While the builder preview runs, the system shall show its current frame time.
- **AC17.** When the user imports a file holding one profile whose name is taken, the system shall
  ask "Replace *Name*" or "Add as a copy"; on Replace it shall store the file's definition under
  the existing id with revision + 1, and a screen page that remembers that id shall select it on
  its next load; on "Add as a copy" it shall store it as "Name (2)" as today.
- **AC18.** If the stored profile changes between the builder's read and its Replace, then the
  system shall refuse the Replace with 409 and offer B-02's "Reload theirs" or "Save mine as a
  copy".
- **AC19.** When a file of several profiles is imported, the system shall only add, all or
  nothing, as B-02 AC10 requires.
- **AC20.** When profiles are exported, the system shall write `formatVersion` 1 if none holds a
  custom effect and 2 otherwise, and import shall accept both and refuse any other version as
  unsupported.
- **AC21.** If a stored custom effect's code does not compile on the screen page, then the system
  shall keep the current look, show the reason in the panel and nothing on the output.
- **AC22.** When the shapes of `Profile` in `engine/` and `shared/` drift, including the custom
  effect, the type check shall fail (`docs/invariants.md:29`, unchanged).
- **AC23.** When a write carries a body up to 128 KB, the system shall accept it; above, 413;
  import stays at 1 MB.
- **AC24.** When any `web/`, `engine/` or `scripts/` code evaluates a string as JavaScript
  (`eval`, `new Function`, a string to `setTimeout`), the lint step shall fail; and profile code
  shall reach the browser only as shader source.
- **AC25.** While a set runs, the screen page shall make no request beyond B-04 AC36's allow-list
  (no new endpoint).
- **AC26.** When git status is read after a `/profile` session, `inspiration/` shall be ignored
  and `profiles/<slug>.json` and `profiles/<slug>.md` shall be the only new tracked files.

## Data

No migration: the custom effect lives in the existing `definition` JSON.

### Custom effect

```
CustomEffect {
  type:        "custom"
  label:       string 1-40, unique in the profile
  amount:      0-1                                  // base strength
  binding?:    { feature, amount }                  // B-02 SD4
  abstraction: boolean                              // SD12
  params:      { name: string 1-24, value: 0-1 }[]  // 0-4, names unique
  code:        string, <= 8 KB, a GLSL function body
}
```

### Custom effect contract

The body of `vec3 fxN(vec2 uv)`, written to `docs/custom-effects.md`. Available: `source(uv)`
(the picture before this effect), `lastFrame(uv)` (the previous output), `resolution` (`vec2`,
pixels), `time` (seconds), `audio.level`, `audio.low`, `audio.mid`, `audio.high`, `audio.beat`
(0 to 1), `palette[6]` and `paletteSize`, `strength` (effective, 0 to 1), `param[4]` (0 to 1, in
declaration order, unset ones 0), and the shared helpers `hash` and `valueNoise`. The engine maps
these names onto per-effect uniforms; the body must return a `vec3`. Names are the planner's to
finalise in that document, but the inputs are these and no others (SD3).

### File format

`{ formatVersion: 1 | 2, profiles: [...] }`, version per SD15.

## API contract

No new endpoint. Changes: the profile body accepts the custom effect (all profile writes and
import); the write body limit is 128 KB (SD16). Replace (SD10) is the existing
`PUT /api/profiles/:id`.

## UI

- **Builder, custom effect row:** label field, strength, binding row, "Abstraction" checkbox,
  up to 4 parameter rows (name, slider, add/remove), the code text box (monospace, resizable),
  the compile line under it (*ok* or the error with its line). Save disabled with a reason while
  any custom effect fails to compile.
- **Builder, preview:** frame time beside the existing preview controls.
- **Builder, import:** the Replace / Add as a copy choice, in the transfer message area.
- **Screen panel:** one reason line when custom effects are bypassed (SD8) or the context was
  recovered; nothing on the output. Controller status shows the same reason.

## Non-functional

- Performance: built-in-only profiles unchanged (B-02 AC17). Profiles with custom effects: the
  limiter is one extra step per frame; the guard (SD8) bounds the rest.
- Safety: SD5's limit. Security: SD1 (GLSL only), SD16 (body checks), the new invariant row.
- Logging: unchanged; the server never logs a definition, so never code. The browser logs a
  bypass and a context recovery at `warn` with the profile id.
- Limits: SD16.

## Edge cases and failure modes

- **Code that loops forever or nearly so:** the GPU watchdog may fire; context loss recovery
  (AC12) draws the profile without custom effects.
- **Code fine on SwiftShader, too slow on the owner's GPU:** the builder's frame time shows it;
  on the screen the guard bypasses it (AC11).
- **Code that compiles on one GPU driver and not another:** the screen keeps the current look
  (AC21); the builder shows the error.
- **A file edited by hand to skip the check:** the server stores it if it passes the schema
  (SD17); the screen and the builder report the failure.
- **Replace while the screen shows that profile:** the screen keeps the copy it loaded until it is
  picked again (B-02 SD9).
- **Replace racing a builder save in another tab:** AC18.
- **Restart mid-operation:** nothing new is in flight; import and Replace are single requests.
- **A B-02-era instance gets a version-2 file:** "unsupported file version", nothing stored.
- **Guarded areas:** none exist. Cross-phase invariants: the `Profile` compat row covers the new
  shape; the request allow-list is unchanged; one row is added (In scope).

## Verification

1. `bash scripts/check.sh`: every step passes, including the schema tests for the custom effect
   and limits, the engine tests (chain position, identity at 0, limiter, abstraction flag),
   integration tests (store and return, 128 KB, import versions), browser tests (builder custom
   row, compile error, Replace, bypass, context loss via `WEBGL_lose_context`), and the lint rule.
2. In a Claude Code session, put a painting in `inspiration/starry/` and run `/profile starry`.
   The agent writes `profiles/starry.json` and `profiles/starry.md`, runs
   `pnpm profile:check profiles/starry.json`, looks at the stills and iterates. `git status`
   shows only the two files.
3. `pnpm start`, open `/builder`, import `profiles/starry.json`: it appears with its custom
   effects. Move a parameter slider, edit a number in the code: the preview follows. Break the
   code: the error shows, the preview keeps drawing, Save is disabled. Fix it, save.
4. Ask the agent for a change; import the revised file: choose Replace. The id is the same; the
   screen page that had it picked selects it after reload.
5. On `/`, pick it, press Start, play a track: the look runs; move recognisability with and
   without the abstraction flag set.
6. Import a profile whose code strobes black/white: the output pulses, it does not strobe, and
   `profile:check` reported clipping.
7. Import a profile whose code is far too heavy: the scale steps to 50%, then the custom effects
   are bypassed and the panel and controller say why; re-pick it to retry.
8. Push a branch: CI runs the same gate and is green.

## Exit condition

On the owner's machine, a profile authored in a Claude Code session from an outside inspiration,
carrying its own shader code, is checked by the agent, imported (and later replaced) in the
builder, edited there, and played on the screen page without ever flashing harder than the app
allows or leaving the screen black, while `bash scripts/check.sh` proves all of it a machine can.

## Open questions

None, when Status is Approved. For the owner at approval: the amendments to B-02 SD1 (code in a
profile), SD7 (Replace) and SD18 (128 KB); the edit to `docs/design/architecture.md`; the new
invariant row; and the defaults marked *(default, not asked)*, in particular how SD5 measures the
flash limit.
