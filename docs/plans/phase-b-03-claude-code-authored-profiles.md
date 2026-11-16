# Plan: b-03 — Claude Code-authored profiles

Spec: [docs/specs/phase-b-03-claude-code-authored-profiles.md](../specs/phase-b-03-claude-code-authored-profiles.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001 Setup Decision Record](../adr/0001-setup-decision-record.md) — rendering
and compiling stay in the screen machine's browser, the server stays schema-only (decision A,
spec SD17); profiles stay rows in SQLite with no migration (question 1); authoring happens in a
Claude Code session, never on the server (question 6); no asset code is built (question 4, spec
SD2); the agent never touches the local database (§3, spec SD6). New dependencies: none
(`scripts/profile-check.ts` uses the Chromium that `@playwright/test` already installs, as
`scripts/under-load.ts:16` does). The spec approves three edits outside code: the "never code"
line of `docs/design/architecture.md:106` (SD1), one new row in `docs/invariants.md`, and the
amendments to B-02 SD1, SD7 and SD18. The invariant row is written in the task that makes it
true (T16); the architecture is updated in T17.

Line references are to `main` at `658aefd`. The spec and `docs/backlog.md` (B-03 specced, B-14
added) are read from the uncommitted working copy of 2026-11-15.

## Approach

The data shape goes first and everywhere at once, because the type check ties `shared/` to
`engine/` (`web/src/profile-compat.ts`): T1 adds the `custom` effect to the shared schema and to
the engine's own `Profile`, with the engine passing it through, so every later task starts from
a system that stores, returns and renders a custom profile (as a no-op). The server then only
needs its body limit (T2) and the file format its version 2 (T3). The engine is built in five
steps that each leave it drawing: the custom body in the chain with its contract and identity at
0 (T4), the flash limiter (T5), compile errors located to effect and line (T6), the slow-GPU
bypass (T7), context-loss recovery (T8). The screen page then says why (T9). The builder is
built beside the engine: the custom row and reducer (T10), Replace on import (T12), then live
compile, the error line, the Save gate and the frame time (T11). The agent's side comes last
because it reuses everything before it: `pnpm profile:check` in two steps (T13 validate and
compile, T14 stills and the limiter report), the `/profile` command with the contract document
(T15), the GLSL-only invariant (T16), the docs (T17).

Custom code is wrapped by the engine, never trusted by it. Each body becomes its own GLSL
function between engine-written `#define`s that map the contract's names (`source`, `strength`,
`param`, `audio`, …) onto per-effect uniforms and the function before it; an engine-written
wrapper returns `source(uv)` when the strength is under 0.001, so the body does not run at 0
(SD13). The limiter is engine code in `main()`, after the chain, so nothing a body does can skip
it: a body cannot contain `#`, cannot leave its function (braces counted outside comments), and
`main` assigns the output last. A profile without a custom effect produces byte-for-byte the
fragment shader it produces today, pinned by a hash recorded from `658aefd` before `shader.ts`
is touched (AC8).

Rejected:

- **A separate pass per custom effect.** The spec keeps one chain (SD3); a pass per effect needs
  more targets and breaks "ordered freely beside the built-ins".
- **`#line` directives to number compiler errors.** Their source-string number is driver
  behaviour; the engine instead knows which generated lines each body occupies and maps
  `ERROR: 0:<line>:` back (PD9). Pure, unit-tested, Chromium/ANGLE only (B-01 SD12).
- **A check page inside `web/dist`.** It would ship a tool route in the product. The check
  script serves the engine's own source, type-stripped by Node, to a blank page (PD12).
- **An engine "render one frame" API for the check script.** The script's page owns
  `requestAnimationFrame` instead, as `engine/src/index.test.ts:109-117` does; `engine/` gains
  no surface for a tool.
- **A flag in the alpha channel to report limiter clipping.** The canvas would composite it.
  Clipping is read from the frames: a pixel that moved by the full allowed step (PD12).
- **A new `guard` field in the control state.** The panel's profile reason already reaches every
  controller word for word (`web/src/control/screen-link.ts:87`, B-04 AC26); the guard's reason
  uses that line, so `shared/src/control.ts` is unchanged (PD8).
- **Changing `EffectType`.** It stays the twelve built-ins in both packages (`EFFECTS`,
  `EFFECT_TYPES`, every existing test); `custom` joins only the `Effect` union (PD5).

## Decisions this plan makes

Readings of the spec the planner had to choose. **Confirm** rows are for the audit to confirm or
overrule; **Owner** rows are user-visible choices the spec left open, and each one is a stop
(CLAUDE.md hard stops).

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 · Owner | The contract gives code `audio.level … audio.beat` (spec Data), and "the code never reads a dial" (SD12). Raw features mean a custom look still pulses with the music at reactivity 0; AC6 only covers "through its binding". Are `audio.*` raw, or scaled by reactivity? | **Owner, 2026-11-15: scaled.** The engine hands code `feature × reactivity` for all five, so reactivity 0 is silence for code too. The code still reads no dial; the contract document says the values are "after the reactivity dial". *Alternative:* raw features — then the reactivity dial (panel and B-04 controller) does nothing to code-driven motion, and only the author's binding obeys it. | The dial's promise since B-01 is that reactivity 0 ignores the beat; a DJ pulling it down on a controller should not find one profile that ignores them. One multiplication, in `customUniforms`. |
| PD2 · Owner | AC5 ("strength 0 renders the same image as the profile without that effect") and AC7/SD5 ("while a profile holds a custom effect, no pixel changes by more than 0.35") disagree in one case: every custom effect at strength 0 while the camera or the built-ins themselves jump (a strobe in the room, flash plus brightness on a beat). Is the limiter on whenever the profile holds a custom effect, or only while custom code runs? | **Owner, 2026-11-15: always on in a profile that holds a custom effect** (SD5's and AC7's text). AC5 then holds for every input whose own frame-to-frame luminance change is at most 0.35, which is what its test uses (a still camera). *Alternative:* limiter only on frames where some custom effect's strength is at least 0.001 — AC5 holds exactly, AC7 only "while code runs", one more uniform. | The simpler promise: a profile with code never flashes harder than 0.35 a frame, whatever its dials. The cost is that such a profile also softens a real strobe seen by the camera. |
| PD3 · Confirm | How the limiter measures and limits (SD5, default). | In `main()`, only when the effect list holds a `custom`: `Y = dot(rgb, vec3(0.299, 0.587, 0.114))` (the weights `paletteMap` uses, `engine/src/shader.ts:122`); the previous output is read with `texelFetch(uPrevious, ivec2(gl_FragCoord.xy), 0)`; when `abs(ΔY) > FLASH_MAX` the colour is moved back along the line to the previous colour so `ΔY` is exactly ±0.35; a NaN or infinite colour becomes the previous colour. The targets are 8-bit, so tests allow 0.35 × 255 + 2. A body that calls `discard` leaves the target's own older pixel, which the same bound already covers (both targets always differ by at most 0.35); T5 tests it. | Per pixel, final output, against the previous frame, as SD5 says. NaN is the one value a comparison lets through. |
| PD4 · Confirm | The limiter needs a real previous frame. Today a scale step or resize recreates the targets black (`engine/src/index.ts:217-226`), and a profile switch is a hard cut (B-02 SD15). | In a profile with a custom effect: recreated targets receive the last output by `blitFramebuffer`, so a scale step causes no dark dip; the limiter stays on at the frame a pick swaps in, so cutting *into* a custom profile takes at most 3 frames (about 50 ms at 60 Hz). Built-in-only profiles keep both behaviours exactly (AC8). The smear's "no feedback on the first frame" rule (`index.ts:272`) is unchanged. | AC7 has no exception for the swap frame; without the copy every scale step would fade from black. |
| PD5 · Confirm | Where `custom` sits in the types. | `shared/`: `effectSchema` gains a 13th member; `EFFECT_TYPES`/`EffectType` stay the twelve; `LIMITS` gains `labelLength 40`, `params 4`, `paramNameLength 24`, `codeBytes 8192`. `engine/`: `Effect = BuiltInEffect \| CustomEffect`, `EffectType` and `EFFECTS` stay the twelve, `effectStrength` reads `effect.abstraction` for a custom effect. `checkProfileRules` exempts `custom` from "once" and adds unique labels (compared trimmed, case-sensitively) and unique parameter names per effect. | Every existing test over `EFFECTS`/`EFFECT_TYPES` stays true (AC8); `CustomEffect` reuses `amount: number;` so the existing compat mutation still anchors (`tests/meta/profile-compat.test.ts:18`). |
| PD6 · Confirm | SD16's code checks, exactly. | Size: at most 8192 UTF-8 bytes (`TextEncoder`). Refused: any `#`; the word `uniform` (`\buniform\b`); a line starting (after spaces) with `in`, `out` or `inout` followed by white space; braces that, counted outside `//` and `/* */` comments, ever go below zero or do not end at zero. Each failure is one issue on `effects.<i>.code` with a message naming the rule. `#` inside a comment is refused too (the spec says "containing"). | "Cannot leave its function" needs the depth rule, not just equal counts, and comments must not hide a brace from the count. The compiler stays the real check. |
| PD7 · Confirm | The contract's final names (spec: "the planner's to finalise") and how they reach a body. | As the spec lists, with: `paletteSize` an `int`; `audio` a struct of five floats; `param` indexable `param[0]`…`param[3]`; `time` in seconds, wrapping as `uTime` does. They are engine `#define`s around each body, undefined after it, so they are **reserved words** in a body (a local named `strength` is a compile error with its line). A body may not define functions (GLSL has no nested functions): loops and inlining only. `docs/custom-effects.md` says all of this. Declared uniforms: `uCustomStrength[12]`, `uCustomParam[12]` (vec4), `uAudio`, present only in a fragment with a custom effect. | SD3: these inputs and no others. Macros are the only way one name (`source`) can mean a different function per effect without recursion. |
| PD8 · Confirm | The guard's API and reasons (SD8; wording is the plan's). | `Engine.setProfile(profile, { retry?: boolean })`; `Engine.onGuard(listener)` with `{ kind: "slow" \| "contextLost", customBypassed: boolean }`. The bypass builds the same profile without its custom entries (and so without the limiter). It lasts until a `setProfile` with `retry: true` (a pick on the screen) or with another program key (a code or stack edit in the builder); a same-key call (a live colour from a controller, a slider) keeps it. `active.ts` keeps the guard's reason apart from the list/pick reason, shows `pick reason ?? guard reason`, and clears it only on a pick. Texts: slow — "custom effects are off: this look is too heavy for this GPU; pick the profile again to retry"; lost, with custom effects — "the graphics context was lost and restored; custom effects are off; pick the profile again to retry"; lost, without — "the graphics context was lost and restored". The browser logs each at `warn` with the profile id. | A colour drag must not re-arm a shader that just proved too heavy. Opening the panel re-lists and clears the list reason (`active.ts:182`); it must not clear a bypass that is still in force. |
| PD9 · Confirm | Compile errors (AC10, AC14, AC21). | `engine/` exports `ProfileCompileError` with `issues: { effectIndex, label, line, message }[]`, built by a pure `locateErrors(log, entries)` that maps ANGLE's `ERROR: 0:<line>: <message>` onto the body that owns the line (an error outside every body is reported with `effectIndex: -1`). `setProfile` rejects with it. A failed key's issues are cached (bounded) so the same broken code is not recompiled on every slider move. Screen: the reason becomes `that profile could not be prepared: custom effect "<label>" does not compile; keeping the current look` (no compiler text: it goes to controllers, 500 characters at most). | The line a person needs is the line in their text box. |
| PD10 · Confirm | Save and compile state in the builder (SD9, AC14). | The preview reports, per draft, `pending`, `ok` or `failed` with the issues; Save needs `ok` when the draft holds a custom effect, and says why otherwise ("custom effect "<label>" does not compile" / "checking the code…"). If the preview has no WebGL2 (`preview-error`), a draft with a custom effect cannot be saved and says so. A draft without one never waits. Code edits reach the engine after a short debounce (at most 200 ms). The preview shows the guard's reason under the canvas and the frame time as "frame 16.7 ms" (`Engine.stats().frameTimeMs`, read about four times a second). | "Save is refused while any custom effect's code does not compile": unknown is not compiled. |
| PD11 · Confirm | Replace on import (SD10). | On a file with exactly one profile, `Transfer` reads the list fresh (as Export all does, `Transfer.tsx:35`), matches the name trimmed and case-insensitively against stored profiles (never the built-in), and shows "Replace *Name*" and "Add as a copy" in the transfer message area. Replace is `updateProfile(id, file's definition, that revision)`; the file's own spelling of the name is stored. 409 `stale_revision` shows B-02's `Conflict` choice: "Reload theirs" takes the server's profile into the list and drops the import; "Save mine as a copy" runs today's import. 404 says the profile was deleted and to import again. If the profile is open in the editor with unsaved changes, Replace asks to discard first (`Builder.tsx:63`). | The revision "the builder just read" is the fresh read; everything else is B-02's existing machinery (`Conflict.tsx`, `nextFreeName` on the server). |
| PD12 · Confirm | `pnpm profile:check` (SD7). | `node scripts/profile-check.ts <file> [--camera <image>] [--out <dir>]`. Schema: `readImport` and `importIssueLine` from `web/src/profiles/file.ts`, plus the effect's label. Browser: headless Chromium with the gate's WebGL flags (`chromiumArgs`, `tests/browser/fixtures/launch.ts`), a blank page whose requests the script answers itself (`page.route`): `engine/src/*.ts` type-stripped with `node:module`'s `stripTypeScriptTypes` and the page script. The page owns `requestAnimationFrame`, so frames are stepped at 1/60 s from a fixed clock. Per profile and per dial setting ((0, 0), starting dials, (1, 1)) one fixed timeline: quiet, a kick (`level 0.8, low 1, mid 0.2, high 0.1, beat 1`), quiet, a hi-hat peak (`level 0.5, low 0.05, mid 0.2, high 1, beat 0`); one still per moment, taken once the limiter has had 3 frames. Nine PNGs per profile, 640×360, in `profiles/.check/<file stem>/<profile slug>/<moment>-<dials>.png` (git-ignored) unless `--out`. "Clipped" means some pixel moved by the full step (≥ 0.35 − 2/255) between two consecutive frames of a timeline; the report gives the frame count. Exit 0 valid (clipped or not), 1 schema or compile failure, 2 usage or no Chromium. | Reuses the import checks and the gate's launch flags; nothing ships in the product; deterministic stills. |
| PD13 · Confirm | SD15's edges. | `SUPPORTED_FORMAT_VERSIONS = [1, 2]`; `toProfileFile` writes 2 when any profile holds a custom effect, else 1; a version-1 file that holds a custom effect is refused (400, `formatVersion`: "a file with a custom effect is formatVersion 2"); a version-2 file without one is accepted. | A version-1 file is one a B-02 instance can read; one with code is not. |
| PD14 · Confirm | Test ids and keys for several custom rows (`EffectRow` keys by type today, `Editor.tsx:224`). | A custom row's React key and test-id suffix are `custom-<n>`, n its 0-based order among the custom effects; built-in rows keep `effect-row-<type>`. | The label is edited in place, so it cannot be the key. |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `shared/src/profile.ts` | Modify | `custom` in `effectSchema`, limits, code checks, rules (T1); format versions, `toProfileFile` (T3) |
| `engine/src/profile.ts` | Modify | `CustomEffect` in `Effect`, `effectStrength` (T1); `customUniforms` (T4) |
| `engine/src/index.ts` | Modify | Custom entries pass through (T1); key by code, custom uniforms (T4); limiter previous frame (T5); `ProfileCompileError` (T6); bypass, `onGuard`, `retry` (T7); context loss (T8) |
| `web/src/builder/EffectRow.tsx`, `web/src/builder/Editor.tsx` | Modify | Compile with the wider union, keys (T1); "Custom" in Add effect (T10); Save gate (T11) |
| `tests/meta/profile-compat.test.ts` | Modify | Mutations for the custom effect (T1) |
| `server/src/app.ts` | Modify | `BODY_LIMIT` 128 KB (T2) |
| `server/src/profiles/routes.ts` | Modify | Version check against the supported list (T3) |
| `web/src/profiles/file.ts` | Modify | Version check against the supported list (T3) |
| `engine/src/shader.ts` | Modify | Custom wrapper and contract (T4); limiter in `main` (T5); line ranges (T6) |
| `tests/meta/fragment-golden.test.ts` | Create | Built-in-only fragments are byte-identical to `658aefd` (T4) |
| `tests/browser/custom-shader.spec.ts` | Create | Chain position, identity, flag, links (T4) |
| `tests/browser/custom-live.spec.ts` | Create | Limiter on the screen page (T5); stored code that does not compile (T6) |
| `engine/src/compile-error.ts` | Create | `ProfileCompileError`, `locateErrors` (T6) |
| `web/src/profiles/active.ts` | Modify | Reason naming the effect (T6); guard reason, retry on pick (T9) |
| `engine/src/scale.ts` | Modify | Time above budget at the floor (T7) |
| `web/src/Screen.tsx` | Modify | Wire `onGuard`, `warn` log (T9) |
| `tests/browser/custom-guard.spec.ts` | Create | Bypass, re-pick, context loss, controller status, request list (T9) |
| `web/src/builder/editor.ts` | Modify | Custom actions (T10) |
| `web/src/builder/CustomRow.tsx`, `web/src/builder/custom-template.ts` | Create | The custom row; the template (T10); compile line (T11) |
| `tests/browser/builder-custom.spec.ts` | Create | Custom row (T10); compile error, Save gate, frame time (T11) |
| `web/src/builder/Preview.tsx`, `web/src/builder/Builder.tsx` | Modify | Compile state, frame time, guard line (T11); Replace wiring (T12, `Builder.tsx`) |
| `web/src/builder/Transfer.tsx` | Modify | Replace / Add as a copy (T12) |
| `web/src/builder/replace.ts` | Create | Pure name match for Replace (T12) |
| `scripts/profile-check.ts`, `scripts/profile-check-page.ts` | Create | The check script and its page (T13, T14) |
| `package.json` | Modify | `profile:check` script (T13) |
| `eslint.config.js` | Modify | Browser globals for the page script (T13); the three rules (T16) |
| `.gitignore` | Modify | `profiles/.check/` (T13); `inspiration/` (T15) |
| `tests/browser/profile-check.spec.ts`, `tests/browser/fixtures/custom-profiles.ts` | Create | The script end to end; shared custom fixtures (T13, T14) |
| `.claude/commands/profile.md`, `docs/custom-effects.md`, `profiles/README.md` | Create | The command, the contract, the folder (T15) |
| `tests/meta/custom-contract.test.ts` | Create | Document, engine and template agree; `inspiration/` ignored (T15) |
| `tests/meta/profile-code-boundary.test.ts` | Create | Lint rules fire; code is read only where allowed (T16) |
| `docs/invariants.md` | Modify | The GLSL-only row (T16) |
| `docs/design/architecture.md`, `CLAUDE.md`, `README.md` | Modify | As built (T17) |

Test files beside a source file (`*.test.ts`) are modified with it and not listed.

## Existing tests this plan makes untrue

| Test | Why | Changed in |
|---|---|---|
| `shared/src/profile.test.ts:193` (`FORMAT_VERSION` is 1), `:209` (a version-2 file fails the schema) | Version 2 exists | T3 |
| `server/test/profiles.int.test.ts:333` (version 2 → 422) | 2 is supported; the test uses 3 | T3 |
| `web/src/profiles/file.test.ts:56` (version 2 → unsupported) | Same | T3 |
| `tests/browser/builder.spec.ts:690` (a version-2 file → "unsupported file version") | Same | T3 |
| `server/test/profiles.int.test.ts:225` (413 for a 65 KB write) | The limit is 128 KB | T2 |
| `tests/browser/builder.spec.ts:646-668` (importing a one-profile bundle again gives "Alpha (2)" at once) | One profile with a taken name now asks; the test chooses "Add as a copy" | T12 |

Nothing else: `tests/browser/builder.spec.ts:350` ("no effects left" at twelve) and
`web/src/builder/editor.test.ts:77-80` (`availableTypes`) stay true because `availableTypes`
keeps meaning the built-in types.

## Tasks

Each task is one vertical slice that leaves the system working, reviewable in one sitting:
about ≤400 changed source lines (tests do not count) across ≤10 files. Every task ends with
`bash scripts/check.sh`, output pasted (CLAUDE.md); the command named below is the task's own
proof.

### T1 — `shared/` and `engine/`: the `custom` effect as data

- **Implements:** AC1, AC2, AC3, AC6 (the flag in `effectStrength`), AC22, SD4, SD16
- **Expected output:** `effectSchema` accepts `{ type: "custom", label, amount, binding?,
  abstraction, params, code }` per PD5 and PD6; `checkProfileRules` allows `custom` any number
  of times within 12 effects, refuses a repeated built-in, a repeated label and a repeated
  parameter name, each issue on the field's path (`effects.<i>.label`, `effects.<i>.params.<j>.name`,
  `effects.<i>.code`). `engine/src/profile.ts` declares the same shape; `effectStrength` uses the
  effect's own `abstraction` flag; the engine maps a custom entry to the existing pass-through
  (`engine/src/shader.ts:147`), so a stored custom profile renders as if the effect were absent.
  `web/` compiles: `EffectRow` shows a custom effect's label, strength, binding and move/remove
  only, keyed per PD14. About 190 source lines, 6 files.
- **Verification:** `pnpm run test --project unit shared/src/profile.test.ts engine/src/profile.test.ts tests/meta/profile-compat.test.ts web/src/builder/editor.test.ts`
  — one test per refusal in AC2 naming its path; 12 custom effects pass, a 13th effect fails,
  two `zoom` fail; `effectStrength` with the flag on and off (recognisability 0.5 halves only the
  flagged one); two new compat mutations fail the type check (the engine renames `code`, the
  engine drops `abstraction`); `pnpm typecheck`.
- **Depends on:** —
- **Autonomy note:** Names of helpers and limits are the builder's. Stop if keeping `EffectType`
  as the twelve forces a cast anywhere outside `EffectRow`/`editor.ts`, or if any existing test
  needs changing.

### T2 — `server/`: a custom profile is stored and returned; 128 KB writes

- **Implements:** AC1, AC2, AC3, AC23
- **Expected output:** `BODY_LIMIT` is `128 * 1024` (`server/src/app.ts:6`); the import route's
  1 MB is untouched. No route changes: the schemas of T1 do the work.
- **Verification:** `pnpm run test --project integration server/test/profiles.int.test.ts` — a
  profile with three custom effects is created, read, updated and imported and comes back equal
  field for field; each AC2 case answers 400 with the field's path and a following list shows
  nothing stored; a 13th effect is 400; a 120 KB valid write (twelve custom effects near 8 KB)
  is accepted, a 129 KB write is 413, a 900 KB import still passes.
- **Depends on:** T1
- **Autonomy note:** Test layout is the builder's. Stop if a valid twelve-effect profile at the
  code limit does not fit 128 KB once JSON-escaped (see Risks): that is the spec's number.

### T3 — File format version 2

- **Implements:** AC19, AC20, SD15
- **Expected output:** Per PD13: `SUPPORTED_FORMAT_VERSIONS`, `profileFileSchema` accepting 1 and
  2 with the version-1-with-code refusal, `toProfileFile` choosing the version. The server's and
  the web's "unsupported version" tests compare against the supported list
  (`server/src/profiles/routes.ts:86-92`, `web/src/profiles/file.ts:88-94`). A bundle import
  still only adds, all or nothing.
- **Verification:** `pnpm run test --project unit shared/src/profile.test.ts web/src/profiles/file.test.ts`
  and `pnpm run test --project integration server/test/profiles.int.test.ts` — export of
  built-in-only profiles is version 1 and byte-identical to before; with one custom effect it is
  2; import accepts both, answers 422 for 3 and 0, 400 on `formatVersion` for version 1 with
  code; a two-profile version-2 bundle with one bad profile stores nothing. The four tests under
  "untrue" use version 3. `pnpm test:browser tests/browser/builder.spec.ts`.
- **Depends on:** T2 (both write `server/test/profiles.int.test.ts`)
- **Autonomy note:** Whether `FORMAT_VERSION` survives as a name is the builder's. Stop if any
  caller outside the two version checks and `toProfileFile` depends on the literal 1.

### T4 — `engine/`: custom code in the chain

- **Implements:** AC4, AC5, AC6, AC8, AC24, SD3, SD13
- **Expected output:** First, `tests/meta/fragment-golden.test.ts` pins the SHA-256 of
  `buildFragment` for the empty list, the built-in list and all twelve, recorded on the
  untouched `shader.ts`. Then `buildFragment` accepts entries that are a built-in type or
  `{ type: "custom", code }`; a custom entry becomes the body function between the contract's
  `#define`s (PD7) and a wrapper that returns `source(uv)` under strength 0.001.
  `customUniforms(profile, features, dials)` gives each custom effect's strength and four
  parameters and the audio features (per PD1's answer); `profileUniforms` is untouched. The
  program key includes each body's code; custom uniforms are set only for a program that has
  them. About 260 source lines, 4 files.
- **Verification:** `pnpm run test --project unit engine/src/shader.test.ts engine/src/profile.test.ts engine/src/index.test.ts tests/meta/fragment-golden.test.ts`
  — the golden hashes hold; `customUniforms` (AC6, PD1): at reactivity 0 a custom effect's
  strength equals its strength with the binding removed and all five `audio` values are 0, at
  reactivity 1 they equal the features; moving recognisability changes the strength of a
  flagged custom effect by B-02 SD4's formula and leaves an unflagged one's equal; two profiles differing only in code get two programs, differing only
  in a parameter value share one; in the fake context the code string appears in the arguments
  of `shaderSource` and of no other call. `pnpm test:browser tests/browser/custom-shader.spec.ts`
  — a body `return source(uv).bgr;` between two built-ins: the effect before it is visible
  swapped and the effect after it acts on the swapped picture (AC4); the same list with strength
  0 equals the list without the entry pixel for pixel, for a body that would paint red (AC5);
  every contract name used in one body links; twelve custom entries link; `shader.spec.ts` still
  passes unchanged in its assertions.
- **Depends on:** T1
- **Autonomy note:** The render helper of `tests/browser/shader.spec.ts:101` may be moved to a
  shared file without changing that spec's assertions. Uniform names are the builder's. Stop if
  a golden hash cannot be kept, or if ANGLE refuses `#define`/`#undef` around a function.

### T5 — `engine/`: the flash limiter

- **Implements:** AC7, AC8, SD5
- **Expected output:** `main()` of a fragment with a custom entry ends with the limiter of PD3
  (per PD2's answer); a fragment without one is unchanged (golden test). Recreated targets get
  the last output in a custom profile (PD4). About 90 source lines, 2 files.
- **Verification:** `pnpm test:browser tests/browser/custom-live.spec.ts` — on `/`, a stored
  profile whose body returns the inverse of `lastFrame(uv)` thresholded (black, white, black…):
  over 40 consecutive frames read in the page, no sampled pixel's luminance moves by more than
  0.35 × 255 + 2 and it does move (a pulse); the same for a body that returns NaN on alternate
  frames and one that `discard`s on alternate frames; a render-scale cap change mid-run produces
  no frame darker than its neighbours by more than the bound. `pnpm run test --project unit engine/src/shader.test.ts engine/src/index.test.ts tests/meta/fragment-golden.test.ts`
  — the limiter text is present only with a custom entry; the copy on recreate happens only in
  a custom profile.
- **Depends on:** T4
- **Autonomy note:** How frames are sampled in the page is the builder's (the pattern is
  `tests/browser/helpers.ts:106`). Stop if SwiftShader's `isnan` is optimised away so the NaN
  case cannot be held, and say what was seen.

### T6 — Compile errors: located in the engine, reported on the screen

- **Implements:** AC21, SD17
- **Expected output:** `ProfileCompileError` and `locateErrors` per PD9, exported from
  `engine/src/index.ts`; `setProfile` rejects with it when a custom body does not compile, and
  the old profile keeps drawing (`engine/src/index.ts:185-195`, unchanged path). `active.ts`
  names the effect in its reason. About 120 source lines, 4 files.
- **Verification:** `pnpm run test --project unit engine/src/compile-error.test.ts engine/src/index.test.ts web/src/profiles/active.test.ts`
  — a log with two errors in two bodies gives two issues with body-relative lines; an error
  outside every body gives `effectIndex: -1`; a cached failed key rejects without a new
  `createShader`. `pnpm test:browser tests/browser/custom-live.spec.ts` — a profile stored
  through the API whose body uses an undeclared name: picking it leaves the picture as it was,
  `profile-reason` names the effect's label, the canvas shows no text, and picking a good
  profile afterwards works.
- **Depends on:** T5 (both write `engine/src/index.ts`, `shader.ts` and `custom-live.spec.ts`)
- **Autonomy note:** The exact log pattern is the builder's to fit to what Chromium prints; keep
  it in one place. Stop if the log carries no line number for some error class.

### T7 — `engine/`: bypass custom effects on a GPU that cannot keep up

- **Implements:** AC11, SD8
- **Expected output:** `scale.ts` reports how long the one-second mean has been above budget at
  the 50% step (its existing `aboveSince`, `engine/src/scale.ts:94-99`); at 3000 ms with a custom
  profile active the engine switches to the same profile without its custom entries, emits
  `onGuard({ kind: "slow", customBypassed: true })` once, and keeps that until `retry` or
  another key (PD8). About 110 source lines, 2 files.
- **Verification:** `pnpm run test --project unit engine/src/scale.test.ts engine/src/index.test.ts`
  — with the fake context and clock: 60 fast frames, then slow frames; the scale reaches 50%,
  3 s later the program in use is the one without custom entries and one event fired; a
  same-key `setProfile` keeps it; `setProfile(profile, { retry: true })` uses the custom program
  again; a built-in-only profile under the same load never emits. Existing scale tests
  unchanged.
- **Depends on:** T6 (both write `engine/src/index.ts`)
- **Autonomy note:** Internal names are the builder's. Stop if the bypass needs the scale
  controller's stepping rules changed.

### T8 — `engine/`: recover from a lost WebGL context

- **Implements:** AC12, SD8
- **Expected output:** The engine prevents the default of `webglcontextlost`, skips drawing while
  lost, and on `webglcontextrestored` recreates its texture, targets and programs, clears the
  program cache, draws the active profile without custom entries on the next frame (linked
  synchronously: built-ins only) and emits `onGuard({ kind: "contextLost", customBypassed })`.
  About 140 source lines, 1 file.
- **Verification:** `pnpm run test --project unit engine/src/index.test.ts` — a fake canvas with
  listeners: after lost, frames make no draw call; after restored, the first frame creates new
  programs and targets and draws; a custom profile comes back without its custom entries and
  `customBypassed: true`, a built-in-only one with `false`; a `setProfile` that was linking when
  the context was lost rejects and does not leak.
- **Depends on:** T7 (both write `engine/src/index.ts`)
- **Autonomy note:** How the resources are re-created (one `init` function or not) is the
  builder's. Stop if the fake context cannot express the event order Chromium uses.

### T9 — Screen page: the guard's reason in the panel and on controllers

- **Implements:** AC11, AC12, AC25, SD8
- **Expected output:** `active.ts` gains the guard reason per PD8 and passes `retry` on a pick;
  `Screen.tsx` subscribes `onGuard`, forwards it, and logs `warn` with the profile id. The
  reason reaches controllers through the existing `reason` field. About 80 source lines, 2
  files.
- **Verification:** `pnpm run test --project unit web/src/profiles/active.test.ts` — the guard
  reason survives `open()`, is replaced by a pick's own reason, clears on a successful pick, and
  a live colour does not pass `retry`. `pnpm test:browser tests/browser/custom-guard.spec.ts` —
  a profile whose body is deliberately heavy and paints a marker colour: the marker shows, then
  (polled, no time bound asserted) `profile-reason` shows the slow text and the marker is gone
  while the picture keeps changing; picking the profile again shows the marker again; with a
  paired controller (`tests/browser/control-server.ts`) `controller-reason` shows the same
  text; `WEBGL_lose_context.loseContext()` then `restoreContext()` on the screen canvas: within
  1 s of the restore the centre is not black, the reason shows, no text is on the canvas, for a
  custom and for the built-in profile; over the whole run the page made no request outside the
  allow-list of `tests/browser/live.spec.ts`.
- **Depends on:** T8
- **Autonomy note:** The heavy body's loop count is the builder's to tune so one frame takes
  roughly 100 to 300 ms on SwiftShader (slow enough to trip the guard, far from the GPU
  watchdog). Stop if the bypass test cannot be made stable in three consecutive local runs: say
  what varied, do not add a retry.

### T10 — Builder: the custom effect row

- **Implements:** AC13, AC15, SD9
- **Expected output:** `editor.ts` gains actions for adding a custom effect from
  `CUSTOM_TEMPLATE`, its label, abstraction flag, code, and adding, removing, naming and setting
  parameters (at most 4); "Add an effect" offers "Custom" while fewer than 12 effects exist.
  `CustomRow.tsx` shows label, strength, binding, the "Abstraction" checkbox, one slider per
  parameter with its name and add/remove, and the code in a monospace resizable `<textarea>`.
  The template passes the picture through and uses one parameter. The reducer's promise widens
  by the text fields only: label, parameter name and code may be invalid while typed, and
  `validate` reports them. About 300 source lines, 5 files.
- **Verification:** `pnpm run test --project unit web/src/builder/editor.test.ts` — each new
  action; the property test over random actions still ends in a state whose only issues are on
  `name`, a custom `label`, a parameter `name` or `code`; a 5th parameter and a 13th effect are
  ignored. `pnpm test:browser tests/browser/builder-custom.spec.ts` — add "Custom": the row
  appears with the template, the preview keeps drawing and (strength 0) equals the preview
  without it; edit label, flag, a parameter and the code, save, reload: all come back; two
  custom rows can be reordered; the keys `o`, `s`, `f` typed in the text box stay text.
- **Depends on:** T4
- **Autonomy note:** Layout and control ids are the builder's within PD14. Stop if the task
  passes 400 changed source lines (it is estimated closest to the limit). Stop if the template
  cannot follow the contract document's wording once T15 writes it (T15 checks they agree).

### T11 — Builder: live compile, the error line, the Save gate, frame time

- **Implements:** AC13, AC14, AC16, SD9
- **Expected output:** `Preview.tsx` reports the draft's compile state (PD10) from `setProfile`'s
  result, the frame time, and the guard's reason under the canvas; `Builder.tsx` hands the state
  to the editor; `CustomRow.tsx` shows "ok" or `line <n>: <message>` under each text box;
  `Editor.tsx` disables Save with the reason. About 180 source lines, 5 files.
- **Verification:** `pnpm test:browser tests/browser/builder-custom.spec.ts` — change a number in
  the code: the preview's pixels change; break the code: the row shows the compiler's message
  with the right line, the preview still shows the last good version and still moves, Save is
  disabled with the reason; fix it: "ok", Save enabled, saved code is the fixed text; with two
  custom effects and one broken, only that row shows the error; from a draft whose code
  compiles, type one character: Save is disabled with "checking the code…" in the same frame
  and stays disabled until the compile result arrives (with the engine's compile held back by
  the test, so the window is observable); `preview-frame-time` shows a number above 0 that
  changes.
- **Depends on:** T6, T8, T10, T12 (T12 also writes `Builder.tsx`)
- **Autonomy note:** The debounce length (at most 200 ms) and the state's shape are the
  builder's. Stop if Save could become enabled between a keystroke and its compile result.

### T12 — Builder: Replace on import

- **Implements:** AC17, AC18, AC19, SD10
- **Expected output:** Per PD11: `replace.ts` (pure match), the choice in `Transfer.tsx`, the
  list update and the discard question in `Builder.tsx`. A bundle of two or more profiles, and a
  single profile with a free name, import as today. About 150 source lines, 3 files.
- **Verification:** `pnpm run test --project unit web/src/builder/replace.test.ts` — trimmed,
  case-insensitive match; never the built-in; no match for two profiles.
  `pnpm test:browser tests/browser/builder.spec.ts` — import a one-profile file named like a
  stored profile: both choices show; Replace keeps the id, the revision is + 1, the definition is
  the file's, and a screen page that had picked it selects it after a reload and Start; "Add as
  a copy" gives "Name (2)" (the amended AC10 test); a second tab saves between the choice
  appearing and Replace: 409, "Reload theirs" keeps the server's, "Save mine as a copy" adds
  "Name (2)"; a two-profile bundle with a taken name only adds.
- **Depends on:** T3 (both write `tests/browser/builder.spec.ts`)
- **Autonomy note:** Wording beyond the two button labels is the builder's. Stop if Replace
  needs anything from the server that `PUT /api/profiles/:id` does not already give.

### T13 — `pnpm profile:check`: schema and compile

- **Implements:** AC10, SD7
- **Expected output:** `scripts/profile-check.ts` per PD12 as far as: arguments, the schema check
  with messages `profile "<name>": effect <n> ("<label>"): <field> — <message>`, launching
  Chromium, serving the type-stripped engine to its page, compiling each profile through
  `createEngine` and `setProfile`, and printing `profile "<name>": custom effect "<label>",
  line <n>: <message>` for each compile issue. Exit codes per PD12. `package.json` gains
  `"profile:check": "node scripts/profile-check.ts"`. About 230 source lines, 5 files.
- **Verification:** `pnpm test:browser tests/browser/profile-check.spec.ts` — the script run as
  a child process on fixtures: a valid file exits 0; a file with a 41-character label exits 1
  naming profile, effect and `label`; a file whose second custom effect has an undeclared name
  on its line 3 exits 1 naming that effect and "line 3"; a version-3 file and a text file exit 1
  with one line each; no arguments exits 2 with usage. `pnpm lint` and `pnpm typecheck` cover
  both new scripts.
- **Depends on:** T3, T6
- **Autonomy note:** The page's origin, file layout under `scripts/` (flat, so
  `tests/tsconfig.json` covers them) and message punctuation are the builder's. Stop if
  `stripTypeScriptTypes` cannot serve the engine as is (the fallback is Vite's own transform,
  already a dev dependency — say so before using it).

### T14 — `pnpm profile:check`: stills and the limiter report

- **Implements:** AC9, SD7
- **Expected output:** The page steps the fixed timeline of PD12 per profile and dial setting on
  the generated scene or the `--camera` image, the script writes nine PNGs per profile and prints
  their folder and one line per profile: `flash limiter: clipped in <k> of <n> frames` or `not
  clipped`. `.gitignore` gains `profiles/.check/`. About 220 source lines, 3 files.
- **Verification:** `pnpm test:browser tests/browser/profile-check.spec.ts` — a two-profile file
  gives 18 files named per PD12, each a PNG of 640×360 that is not one flat colour; two runs
  give byte-identical PNGs; the kick still differs from the quiet still for a profile bound to
  `beat`; the strobe fixture reports clipped and the built-in-shaped fixture does not; with
  `--camera` a fixture image's dominant colour appears in the (0, 0) still; `git status
  --porcelain` after a default run shows nothing under `profiles/.check/`.
- **Depends on:** T13
- **Autonomy note:** The generated scene's content, the still's frame index and the camera's
  hand-over to `setSource` are the builder's. Stop if stills are not reproducible between two
  runs on the same machine.

### T15 — The `/profile` command, the contract document, the folders

- **Implements:** AC26, SD6, SD11, SD14
- **Expected output:** `docs/custom-effects.md`: the contract (PD7, PD1's answer), the limits
  (PD6), what the engine adds around a body (identity at 0, the limiter, the guard), three short
  worked bodies. `.claude/commands/profile.md`: gather into `inspiration/<slug>/`, write
  `profiles/<slug>.md` (title, artist or source, link, what was taken: palette, motion, texture,
  idea), write `profiles/<slug>.json` (version 2), run `pnpm profile:check`, read the stills,
  iterate, format the JSON with `pnpm exec prettier --write`, tell the owner to import; never
  the database or a write endpoint; one profile per run. `.gitignore` gains `inspiration/`;
  `profiles/README.md` says what the folder holds.
- **Verification:** `pnpm run test --project unit tests/meta/custom-contract.test.ts` — every
  contract name the engine defines appears in the document and the document names no other;
  the builder's template and the document's worked bodies pass the shared code checks;
  `.claude/commands/profile.md` names `pnpm profile:check` and `profiles/<slug>.json` and
  contains no `/api/` path;
  `git check-ignore inspiration/x/a.png` and `profiles/.check/x.png` succeed and
  `profiles/x.json` does not. `pnpm format:check` passes with a formatted sample profile in
  place (removed again). AC26 itself is H1.
- **Depends on:** T14
- **Autonomy note:** Prose is the builder's. Stop if the command would need a tool permission or
  hook beyond what `.claude/` already grants.

### T16 — Profile code is GLSL only: the rules and the invariant row

- **Implements:** AC24, SD1
- **Expected output:** `eslint.config.js` turns on `no-eval`, `no-implied-eval` and
  `no-new-func` for every file. `tests/meta/profile-code-boundary.test.ts` proves, in the style
  of `tests/meta/config-boundary.test.ts`, that each rule fires on a snippet in `web/`,
  `engine/` and `scripts/`, and that a custom effect's `code` property is read only in an
  allow-list of files (the schema, the engine's shader builder and key, the builder's reducer
  and row, the check script). `docs/invariants.md` gains the row, enforced by those two tests
  and T4's `shaderSource` test.
- **Verification:** `pnpm run test --project unit tests/meta/profile-code-boundary.test.ts` and
  `pnpm lint` (the repository is clean under the new rules).
- **Depends on:** T11, T14
- **Autonomy note:** The scan's pattern is the builder's. Stop if an existing file trips a rule
  for a reason other than evaluating a string (then the rule or the file is the owner's call).

### T17 — Docs as built

- **Implements:** SD1, SD14
- **Expected output:** `docs/design/architecture.md`: profiles may carry GLSL code (the line at
  `:106`), the custom effect and its contract, the limiter, the guard and context recovery, the
  engine's new surface in the module table, Replace, format version 2, the 128 KB limit (`:326`),
  the check script and `/profile`. `CLAUDE.md`: `pnpm profile:check` and `/profile` under
  Commands and Workflow, `profiles/` and `inspiration/` under Conventions. `README.md` where it
  lists commands. `engine/src/shader.ts`'s header comment no longer says "no profile carries
  code". The backlog already reads "specced" in the working copy.
- **Verification:** `bash scripts/check.sh` (format and the plan check cover the docs); a read
  of each changed paragraph against the code it describes, listed in the task's evidence.
- **Depends on:** T9, T12, T15, T16
- **Autonomy note:** Wording is the builder's. The architecture edit is approved by the spec only
  for what B-03 builds; stop before describing anything it does not.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1 | `shared/src/profile.ts`, `engine/src/profile.ts`, `engine/src/index.ts`, `web/src/builder/EffectRow.tsx`, `web/src/builder/Editor.tsx`, `tests/meta/profile-compat.test.ts` |
| 2 | T2, T4 | T2: `server/src/app.ts`, `server/test/profiles.int.test.ts` · T4: `engine/src/shader.ts`, `engine/src/profile.ts`, `engine/src/index.ts`, `tests/meta/fragment-golden.test.ts`, `tests/browser/custom-shader.spec.ts` |
| 3 | T3, T5, T10 | T3: `shared/src/profile.ts`, `server/src/profiles/routes.ts`, `server/test/profiles.int.test.ts`, `web/src/profiles/file.ts`, `tests/browser/builder.spec.ts` · T5: `engine/src/shader.ts`, `engine/src/index.ts`, `tests/browser/custom-live.spec.ts` · T10: `web/src/builder/editor.ts`, `Editor.tsx`, `EffectRow.tsx`, `CustomRow.tsx`, `custom-template.ts`, `tests/browser/builder-custom.spec.ts` |
| 4 | T6, T12 | T6: `engine/src/compile-error.ts`, `engine/src/index.ts`, `engine/src/shader.ts`, `web/src/profiles/active.ts`, `tests/browser/custom-live.spec.ts` · T12: `web/src/builder/Transfer.tsx`, `Builder.tsx`, `replace.ts`, `tests/browser/builder.spec.ts` |
| 5 | T7, T13 | T7: `engine/src/scale.ts`, `engine/src/index.ts` · T13: `scripts/profile-check.ts`, `scripts/profile-check-page.ts`, `package.json`, `eslint.config.js`, `tests/browser/profile-check.spec.ts`, `tests/browser/fixtures/custom-profiles.ts` |
| 6 | T8, T14 | T8: `engine/src/index.ts` · T14: `scripts/profile-check.ts`, `scripts/profile-check-page.ts`, `.gitignore`, `tests/browser/profile-check.spec.ts` |
| 7 | T9, T11, T15 | T9: `web/src/profiles/active.ts`, `web/src/Screen.tsx`, `tests/browser/custom-guard.spec.ts` · T11: `web/src/builder/Preview.tsx`, `Builder.tsx`, `Editor.tsx`, `CustomRow.tsx`, `tests/browser/builder-custom.spec.ts` · T15: `.claude/commands/profile.md`, `docs/custom-effects.md`, `profiles/README.md`, `.gitignore`, `tests/meta/custom-contract.test.ts` |
| 8 | T16 | `eslint.config.js`, `tests/meta/profile-code-boundary.test.ts`, `docs/invariants.md` |
| 9 | T17 | `docs/design/architecture.md`, `CLAUDE.md`, `README.md`, `engine/src/shader.ts` (comment) |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph <this
file>` prints the groups the `Depends on` fields actually give.

## Data changes

None. The custom effect lives in the existing `definition` JSON column; no migration, no
backfill. Rows written before B-03 stay valid. A row holding a custom effect is unreadable to a
B-02-era build of the app (it would answer 422 `unusable` and fall back to the built-in), which
matters only if the owner runs an older checkout against the same `DATA_DIR`.

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| The limiter softens real strobes seen by the camera in any profile with code (PD2 as recommended), and a cut into such a profile takes up to 3 frames (PD4). | Both are named decisions; the owner sees them in H3 and H4 and can overrule PD2. |
| A body can name the engine's own uniforms (`uBlock`, `uPrevious`) because they share one shader. Not a security matter (WebGL is the sandbox, SD1) but such a profile breaks if the engine renames one. | The contract document says only its names are supported; `profile:check` catches a break at the next check. |
| No helper functions in a body (GLSL has no nested functions), so rich looks mean long inlined bodies; 8 KB may be tight. | Named in the document; not reopened here (SD1, SD16). If it bites in H1, it is a backlog item. |
| `source(uv)` sampled k times multiplies the cost of everything before it (as `edges` and `rgbSplit` already do). | The document says so; the guard bounds it (T7); the builder shows the frame time (T11). |
| Twelve custom effects at 8 KB each can exceed 128 KB once JSON-escaped (each newline is two bytes). | T2 measures a realistic worst case and stops if it does not fit; the answer is a 413 the builder already reports. |
| The bypass browser test depends on SwiftShader being slow by a wide, machine-dependent margin; too heavy and Chromium's GPU watchdog fires instead. | T9 tunes one loop count, polls without a time bound, and stops rather than retries if three runs disagree. `pnpm check:load` is the place to look at a flake. |
| On a real GPU-watchdog loss Chromium decides when, and whether, to restore the context; after repeated losses it may refuse. AC12 is proven only through `WEBGL_lose_context`. | T8 handles the events it is given; a context that never returns leaves the page as today. Not provable in the gate; named for H4. Re-mounting the canvas after a timeout is a possible follow-up, not built. |
| ANGLE's log format (`ERROR: 0:<line>:`) is parsed. | One function, unit-tested, Chromium only (B-01 SD12); an unparsed log still rejects with the raw message. |
| `stripTypeScriptTypes` is a young Node API. | Present in the pinned Node 24 (`engines.node`); T13 stops and names Vite's transform as the fallback. |
| D-09 (an open timing flake in `tests/browser/live.spec.ts`, AC7) can redden the gate on an unrelated run. | Not this plan's; a red gate from it is reported with its output, not re-run silently. |
| Agent-written `profiles/*.json` is checked by `prettier --check .`; an unformatted file reddens the gate. | The command formats it (T15). |
| The spec, the backlog edit and this plan are uncommitted (in the working copy on `fix/d-10-screen-reload-lock`, not `main`). | The owner commits them on a docs branch before T1 branches (H0). |

Uncertain, plainly: whether `#define`-wrapped bodies and twelve 8 KB bodies link fast enough on
SwiftShader to keep the browser step's duration reasonable (T4 finds out first); and whether the
heavy-shader test (T9) can be made stable on CI's runners, which are slower and noisier than the
dev machine.

## Human steps

- **H0 — before T1.** Commit the spec, `docs/backlog.md` and this plan on a docs branch;
  answer PD1 and PD2 (answered at the audit, 2026-11-15: scaled; always on).
- **H1 — after T15** (spec Verification 2; AC26; the exit condition's first half). In a Claude
  Code session put a painting in `inspiration/starry/`, run `/profile starry`. Expect
  `profiles/starry.json`, `profiles/starry.md`, stills under `profiles/.check/`, and `git
  status` showing only the two files.
  **Done 2026-11-16, passed:** `/profile` run on Van Gogh's _The Starry Night_ under the slug
  `starry-night` (painting in `inspiration/starry-night/`, not committed). `profile:check`
  compiled it and wrote the nine stills; `git status` showed only `profiles/starry-night.json`
  and `profiles/starry-night.md`, committed as the first authored profile.
- **H2 — after T12** (Verification 3, 4). `pnpm start`, `/builder`, import `profiles/starry.json`;
  move a parameter, edit a number, break and fix the code, save. Ask the agent for a change,
  import again, choose Replace: same id, and the screen page selects it after a reload.
  **Done 2026-11-16, passed** (reported by the owner).
- **H3 — after T9** (Verification 5, 6). On `/` with the real camera and a track: the look runs;
  recognisability with and without the abstraction flag; a strobing profile pulses and
  `profile:check` reported clipping. Judge PD2 and PD4 here: a strobe in the room, a cut into a
  custom profile.
  **Done 2026-11-16, passed** (reported by the owner); PD2 and PD4 stand as built.
- **H4 — after T9** (Verification 7; AC11 and AC12 on the real GPU). A far too heavy profile: the
  scale steps to 50%, the custom effects go off, panel and a paired controller say why, a
  re-pick retries. If the GPU watchdog fires instead, note whether the picture returns.
  **Done 2026-11-16, passed** (reported by the owner).
- **H5 — after T17** (Verification 8). Push; CI runs the gate. Pushing, the PR and the merge are
  the owner's.

## Out of scope for this plan

- A committed example profile under `profiles/`: the first one is the owner's, from H1.
- Re-mounting the canvas when a lost context never returns (Risks).
- A Retry button in the builder preview: an edit to the code or the stack retries (PD8).
- Everything the spec lists under Out of scope, B-14's texture inputs included; the contract
  only leaves room for them.

## Audit (PASS required before implementation starts)

- [x] Every AC maps to at least one task
- [x] Every task maps to at least one AC (no orphans)
- [x] Each task's expected output is concrete enough to check, and is what we actually need
- [x] Existing patterns reused; nothing reinvented
- [x] No new dependency without an approval note
- [x] Data changes additive and reversible
- [x] Errors, empty states and permissions are tasks, not afterthoughts
- [x] Each task reviewable in one sitting
- [x] Verification named per task
- [x] Nothing touches prod, secrets or infra it should not
- [x] Every task has a Depends on and an Autonomy note
- [x] No two tasks in one parallel group write the same file

Audited by: Martijn Boot  Date: 2026-11-15
