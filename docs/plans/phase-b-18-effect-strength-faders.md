# Plan: b-18 — Effect strength faders on the controller

Spec: [docs/specs/phase-b-18-effect-strength-faders.md](../specs/phase-b-18-effect-strength-faders.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001](../adr/0001-setup-decision-record.md) — rendering stays on the screen machine and a live
strength is never saved (SD6, AC14: no request writes a profile); [0002](../adr/0002-remote-input-over-the-lan.md)
— the new `effect` control is one more message on the existing device socket, validated on receipt, with no
route, socket or server change. New dependencies: none.

Line references are to `main` at `45a3275`. The spec's own references (`dc05fde`) were re-checked against
it and still match.

## Approach

The profile comes first because everything else reads it. T1 adds the two optional flags to
`effectSchema` (`shared/src/profile.ts:51-53`'s `common`, so built-in and custom effects get them from one
place), the one-DJ rule beside the other cross-field rules (`checkProfileRules`, `:175`), and `formatVersion`
3. `profileFields` and `checkProfileRules` are already reused by the server's stored profile, the update
body and sync (`profile-api.ts`, `sync.ts`), so the rule and the flags reach all of them with no server
edit. T2 is the screen side: the `effect` control and the state's `effects` in `shared/src/control.ts`, a live
strength override in `createActiveProfile` that sits beside the live palette (`recolour`,
`web/src/profiles/active.ts:265-272`) and goes through the same `setProfile` call, and one new `case` in
`createApplier` so the `never` check at `apply.ts:86` covers it. The engine keys its programs on effect
types and custom code only (`keyOf`, `engine/src/index.ts:242`) and treats the same key without a pick as a
values-only swap (`:756-760`), so a live strength cannot build a program; T1 pins that with an engine test.
T3 puts the faders on `/control`: the DJ-ticked effect in the bank beside the two dials, the VJ-ticked ones
in an Effects section under Transition, all through the existing `Fader`, the existing send budget
(`value("effect:<index>", …)`, `Controller.tsx:129`) and one new `mark` prop on `Fader` for the stored-value
tick. T4 is the builder's two checkboxes and the refusal of a second DJ tick. T5 measures the three-fader
bank at the five viewports, T6 proves the whole path end to end, T7 amends the style brief and mockups.

Rejected:
- **A separate `effects` message type for the state, or a second socket.** The state already carries every
  mirrored value; one more field keeps B-04 SD5 (the controller shows the screen's truth).
- **Writing the live strength into the profile the engine holds with a new engine method.** `setProfile`
  already swaps values with no link when the key is unchanged; a new engine API would duplicate it (and
  would need `engine/` tests for nothing new).
- **Keying the control by the effect's type instead of its index.** A profile may hold several custom
  effects, and the spec fixes `index` (SD7).
- **Refusing a flagged effect at the server only.** The schema is the one gate (`shared/`), validated
  identically by the builder, the server and import.

## Decisions this plan makes

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 | **Confirm.** Is `effects` in `screenStateSchema` required or optional? | Required, `.max(LIMITS.effects)`, an empty list for a profile with no ticks. | The screen always builds it, so there is no second shape to handle. Cost: the typed `ScreenState` fixtures in `shared/src/control.test.ts:21`, `server/test/control-device.int.test.ts:44`, `control-screen.int.test.ts:51`, `sync-schedule.int.test.ts:41`, `web/src/control/screen-link.test.ts:47` and `device-link.test.ts:16` gain `effects: []`, and the untyped `STATE` in `control-sender.int.test.ts:188-203` and the socket send in `sync-schedule.int.test.ts:131` would otherwise fail the server's strict schema at run time. All are amended in T2. |
| PD2 | **Confirm.** Where the flags and the one-DJ rule live. | `dj` and `vj` are `z.boolean().optional()` in `common`, so every effect type has them. The rule is in `checkProfileRules`: a second `dj: true` adds an issue at `["effects", i, "dj"]` with the text "effect *i* is the second with the DJ fader; one effect has it". | AC1 asks for the second effect's index; the path and the text both carry it. One place reaches builder, server, import and sync. |
| PD3 | **Confirm.** The file rules (SD3). | `SUPPORTED_FORMAT_VERSIONS` becomes `[1, 2, 3]`. `toProfileFile` picks 3 when any effect has a flag `true`, otherwise 2 or 1 as before, and writes neither key for a flag that is `false` or absent. In `profileFileSchema`'s `superRefine`, a version 1 or 2 file with an effect holding a `dj` or `vj` key (either value) gets an `unrecognized_keys` issue at `["profiles", n, "effects", m]` naming the key: the issue a stray key gets today. A version 3 file without flags is accepted. | Meets SD3 and AC2, AC3 while keeping v1 and v2 byte-for-byte for every profile without flags (`shared/src/profile.test.ts:241-249`). |
| PD4 | **Confirm.** How the screen keeps a live strength. | `createActiveProfile` keeps `liveAmounts: Map<number, number>`, emptied by a successful `apply` (every pick, the active profile included) and by nothing else. A new `setStrength(profile, index, value)` drops silently while a pick is pending (`picking !== 0`), when `profile` is not the active id, or when `index` is not an effect; otherwise it sets the entry. `recolour` and `setStrength` both end in one `push()` that hands the engine `{ ...activeProfile, palette: [...live], effects: effects-with-live-amounts }`. | A colour edit after a strength edit must not put the stored strength back (and the reverse): both live copies go in every swap. Same `setProfile` call, so no new program (`keyOf`). |
| PD5 | **Confirm.** What `effects` holds in the state. | One entry per effect with `dj` or `vj` true, in stack order: `{ index, name, stored, value, dj, vj }`. `name` is the built-in type's name as the builder shows it (`EffectRow.tsx:36`: the type identifier) or the custom label, trimmed, cut to 40. `stored` is the stored `amount`, `value` the live one, both 0 to 1. Built by `toActiveState` in `active.ts`, mapped in `toScreenState`. | SD7, SD10. The state needs nothing for an unflagged effect. |
| PD6 | **Confirm.** The screen's reply to a message it drops. | Every `effect` is acknowledged in the frame's `applied` batch, a pending pick's included. The applier's code path already acknowledges after the `switch` (`apply.ts:89`). | AC12 requires the acknowledgement for the first two cases and forbids nothing for the third; acknowledging it too clears the controller's waiting value the same way, as a colour dropped during a pick is today. |
| PD7 | **Confirm.** Which indexes the screen accepts. | Any effect of the active profile, flagged or not (SD7: "`index` is an effect"). | A stale controller whose ticks changed after a refresh moves an unflagged effect at worst; the screen's reported value then shows it (AC13). The spec does not ask for the stricter rule, and it needs a second list on the screen. |
| PD8 | **Confirm.** Builder test ids. | The checkboxes are `effect-dj-<index>` and `effect-vj-<index>` with `index` the position in the stack (SD12), although the other row ids use the effect type or `custom-<n>` (`Editor.tsx:102-105`). The disabled reason is `effect-dj-reason-<index>`. | The spec fixes it. Moving an effect up or down moves its ids; tests address the checkbox by the row's index, not the type. |
| PD9 | **Confirm.** The stored-value tick (AC17). | `Fader` takes an optional `mark?: number` (0 to 1) that sets `--mark` on the root; the stylesheet draws a tick on the track at that position in the same maths as the cap, 2 px wide and longer than the groove on both sides, in `--text`, plus a notch: a mark, never colour alone. Locked, the tick keeps its shape and takes the locked cap colour. A new contrast row (`--text` on `--track`, already T8 at 15.07) covers it; a different token needs a new row. | Uses the existing positioning (`controller.css:216-345`) and no new token. The final look is the brief's (T7). |
| PD10 | **Owner — answered yes, 2026-11-24 (recommended option).** Three lines of `docs/design/architecture.md` become untrue: `:75` (names `SUPPORTED_FORMAT_VERSIONS`) and `:205-206` ("Import accepts 1 and 2"), and `:528` mentions the format. May T1 edit them? | **Recommended: yes**, the smallest edit that makes them say "1, 2 and 3". Approving SD9 covers only `controller-style.md` and its mockups. **Alternative:** leave `architecture.md` stale and register the drift as a defect. | CLAUDE.md hard stop: anything in `docs/design/` is the owner's. T1 does not touch the file until this is answered. |
| PD11 | **Confirm.** Version skew. | Accepted, not mitigated. A `/control` page left open across an upgrade strict-parses the new state (`control.ts:144`) and drops it until it reloads; the same server serves both pages, so it can only happen across a restart. A hosted instance on an older build rejects a synced definition holding the flags; deploying the hosted build first is Human step H3. | A mitigation (a tolerant state schema) would loosen the strict boundary B-04 SD20 chose. |
| PD12 | **Confirm.** Which tests move to `formatVersion` 4 for "unsupported". | The seven that use 3 as the unsupported example: `shared/src/profile.test.ts:196, 210-213, 278-284`, `server/test/profiles.int.test.ts:465-473`, `web/src/profiles/file.test.ts:55-62`, `tests/browser/builder.spec.ts:693-698` (its title at `:677` also says "version 2" and is corrected to "a version 4 file"), `tests/browser/profile-check.spec.ts:83-90`. | 3 is now supported; the rest of each test is unchanged. |
| PD13 | **Confirm.** Mockups. | Three new frames, not five: portrait DJ with three faders (320×568), landscape DJ with three (568×320), tablet VJ with the Effects section and one effect in the bank (768×1024). The Budget rows still cover the five viewports. The existing VJ frames have no Transition section (`controller-style-mockups.html`), so the new tablet frame shows Transition above Effects at real pixels. | The file has only three viewport classes (`.mock-320x568`, `.mock-568x320`, `.mock-768x1024`); B-16 handled the other two as table rows alone. |
| PD14 | **Confirm.** B-19's four-fader tests (`control-layout.spec.ts:342-380`, `control-look.spec.ts:170-182`) clone a fader into the bank. | Unchanged. They test a bank of four, which B-23 may need; the three-fader bank with a real effect fader is measured by a new case in T5. The two B-16 AC5 cases that assert exactly two faders (`:388`, `:522-547`) use the built-in profile, which has no flags, and stay true. | The clones are a layout budget, not the feature. |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `shared/src/profile.ts` | Modify | The flags, the one-DJ rule, version 3, `toProfileFile`, the file refusal — T1 |
| `shared/src/profile.test.ts` | Modify | AC1–AC3 and PD12's three moves — T1 |
| `engine/src/profile.ts` | Modify | `dj?`, `vj?` on `EffectOf` and `CustomEffect`; never read — T1 |
| `engine/src/index.test.ts` | Modify | A strength change on a built-in effect builds no program — T1 |
| `server/test/profiles.int.test.ts` | Modify | A flagged profile round-trips through the API; PD12 — T1 |
| `web/src/profiles/file.test.ts` | Modify | Import and export with flags; PD12 — T1 |
| `tests/browser/profile-check.spec.ts` | Modify | PD12; a version 3 file checks — T1 |
| `tests/browser/builder.spec.ts` | Modify | PD12 (`:677-698`) — T1; the toggles, the round trip — T4 |
| `docs/custom-effects.md` | Modify | `:48` also lists version 3 and the two keys — T1 |
| `.claude/commands/profile.md` | Modify | `:30` the export format names version 3 and the keys — T1 |
| `docs/design/architecture.md` | Modify | `:75, :205-206` — T1, **only if PD10 is answered yes** |
| `shared/src/control.ts` | Modify | The `effect` control and the state's `effects` — T2 |
| `shared/src/control.test.ts` | Modify | An `effect` example; typed fixture (PD1) — T2 |
| `server/test/control-device.int.test.ts`, `control-screen.int.test.ts`, `control-sender.int.test.ts`, `sync-schedule.int.test.ts` | Modify | PD1's fixtures; `effect` relayed; a sender's `effect` refused — T2 |
| `web/src/profiles/active.ts` | Modify | `liveAmounts`, `setStrength`, `push()`, the state's `effects` — T2 |
| `web/src/profiles/active.test.ts` | Modify | The live strength cases — T2 |
| `web/src/control/apply.ts`, `apply.test.ts` | Modify | The `effect` case and dependency — T2 |
| `web/src/control/screen-link.ts`, `screen-link.test.ts` | Modify | `toScreenState` carries `effects`; `:287-305` exact shape — T2 |
| `web/src/control/device-link.test.ts` | Modify | Typed fixture — T2 |
| `web/src/Screen.tsx` | Modify | `setStrength` into the applier's deps (`:170-181`) — T2 |
| `web/src/control/effect-faders.ts`, `effect-faders.test.ts` | Create | Which effects go in the bank, which in the section (SD8, SD10) — T3 |
| `web/src/control/Controller.tsx` | Modify | The Effects section and the bank's third fader — T3 |
| `web/src/control/FaderBank.tsx` | Modify | `FaderDefinition.mark` — T3 |
| `web/src/control/Fader.tsx` | Modify | `mark` — T3 |
| `web/src/control/controller.css` | Modify | The tick, the Effects section; a fix only where a T5 measurement fails — T3, T5 |
| `tests/browser/control-effects.spec.ts` | Create | AC4, AC8, AC9, AC16, AC17 — T3 |
| `web/src/builder/editor.ts`, `editor.test.ts` | Modify | `effectFader` action and the refusal — T4 |
| `web/src/builder/EffectRow.tsx` | Modify | The toggles, the reason, the recognisability note — T4 |
| `tests/browser/control-layout.spec.ts` | Modify | The three-fader bank at five viewports — T5 |
| `tests/browser/control-effects-e2e.spec.ts` | Create | AC10 to AC15, AC20, AC21 — T6 |
| `docs/design/controller-style.md`, `controller-style-mockups.html` | Modify | Budget rows, the tick, the Effects section, three frames — T7 |

## Tasks

### T1 — The profile: flags, the one-DJ rule, version 3

- **Implements:** SD3, AC1, AC2, AC3
- **Expected output:**
  - `effectSchema` accepts `dj` and `vj` on every effect (PD2). `checkProfileRules` rejects a second `dj: true`
    naming its index.
  - `SUPPORTED_FORMAT_VERSIONS` is `[1, 2, 3]`; `toProfileFile` and `profileFileSchema` behave as PD3.
    `server/src/profiles/routes.ts:93-99` and `web/src/profiles/file.ts:88-99` need no edit (they read
    `isSupportedFormatVersion`); `readImport` returns the schema's issue for a v1 or v2 file holding a key.
  - `engine/src/profile.ts` declares the same two optional flags on `EffectOf` and `CustomEffect`, so
    `web/src/profile-compat.ts` keeps both directions assignable (its key check covers top-level keys only).
  - `engine/src/index.test.ts`: `setProfile` on the same effect list with a changed `amount` of a built-in
    effect resolves with no new program (the existing custom-effect case at `:689` is the pattern).
  - A test in `server/test/profiles.int.test.ts` that a flagged profile saved by `POST /api/profiles` comes
    back from `GET` with its flags and that a second `dj: true` answers 400 with the issue.
  - `profile:check` accepts a version 3 file (it reads through `readImport`, `scripts/profile-check.ts:124-135`).
  - Docs: `custom-effects.md:48` and `.claude/commands/profile.md:30` name version 3 and the keys;
    `architecture.md` only per PD10.
  - Existing tests amended here (the gate stays green): PD12's seven.
  - About 70 changed source lines, 2 source files (plus the docs).
- **Verification:** `pnpm run test --project unit shared/src/profile.test.ts web/src/profiles/file.test.ts engine/src/index.test.ts tests/meta/profile-compat.test.ts`;
  `pnpm run test --project integration server/test/profiles.int.test.ts`;
  `pnpm test:browser tests/browser/profile-check.spec.ts tests/browser/builder.spec.ts`; `pnpm typecheck`;
  then `bash scripts/check.sh`.
- **Depends on:** —
- **Autonomy note:** names, the issue texts and the test layout are the builder's. Stop and ask if
  `server/src/profiles/store.ts` or `server/src/sync/` would reject, drop or strip a stored effect holding
  the flags (the read-validity question the inventory left open); that is a server change the spec does not
  list. Do not edit `docs/design/architecture.md` before PD10 is answered.

### T2 — The `effect` control, the state's `effects`, the live strength on the screen

- **Implements:** SD6, SD7, AC11, AC12, AC14
- **Expected output:**
  - `shared/src/control.ts`: `message("effect", { seq, profile: id, index: int 0..<12, value: unit })` in
    `controlSchema` (so `deviceMessageSchema` and `KNOWN_TYPES` get it, and the server relays it with no
    edit: `device.ts:90-100` falls to `default`, `hub.ts:402`), and `effects` in `screenStateSchema` (PD1,
    PD5).
  - `active.ts` per PD4, and `ActiveState.effects` per PD5; `toScreenState` copies it (`screen-link.ts:96`).
  - `apply.ts`: `setStrength(profile, index, value)` in `ApplierDeps` and `case "effect"` (PD6);
    `Screen.tsx:170-181` wires it to `active.setStrength`.
  - Tests:
    - `active.test.ts` (patterns at `:312-404`): a strength reaches `setProfile` with the same effect list and
      palette and no `pick` option; a later colour edit keeps it and a later strength keeps the colour; a
      pick (the active one included) restores stored strengths; dropped while a pick is pending, for another
      profile id, for an index with no effect; `state().effects` lists flagged effects only, with live and
      stored values and a custom label trimmed.
    - `apply.test.ts` (rig at `:33-74`): the control reaches `setStrength` in the next frame's drain and is
      acknowledged in that batch, also when the dependency drops it.
    - `shared/src/control.test.ts`: an `effect` example parses; `index` 12, `value` 1.1, a missing `profile`
      and an extra key are refused.
    - `server/test/control-device.int.test.ts`: an approved controller's `effect` reaches the screen socket;
      `control-sender.int.test.ts:239-246`: a sender's `effect` is refused like the others.
  - Existing tests amended: PD1's fixtures; `screen-link.test.ts:287-305` (exact `toScreenState` shape).
  - About 150 changed source lines, 5 source files.
- **Verification:** `pnpm run test --project unit shared/src/control.test.ts web/src/profiles/active.test.ts web/src/control`;
  `pnpm run test --project integration server/test/control-device.int.test.ts server/test/control-sender.int.test.ts server/test/control-screen.int.test.ts server/test/sync-schedule.int.test.ts`;
  `pnpm typecheck`; then `bash scripts/check.sh`.
- **Depends on:** T1
- **Autonomy note:** helper names and the map's shape are the builder's. Stop if the live strength cannot
  reach the engine without a new `engine/` method, or if a fixture outside PD1's list breaks (that means the
  state schema changed more than PD1 says).

### T3 — The effect faders on `/control`

- **Implements:** SD1, SD8, SD10, SD11, SD12, AC4, AC8, AC9, AC10 (the send path; T6 proves it end to end), AC16, AC17
- **Expected output:**
  - `effect-faders.ts`: a pure `placeEffects(effects, mode)` returning `{ bank: Entry | null, section: Entry[] }`:
    the DJ-ticked effect in the bank in both modes (an effect ticked both shows once, there); the VJ-ticked
    others in the section in VJ mode only; stack order.
  - `Controller.tsx`: the bank's faders are the two dials plus the DJ effect's fader (`testId: effect-<index>`,
    label SD10, `value` the state's `value`, `mark` the stored value, `onSend` →
    `value("effect:<index>", () => link.send({ type: "effect", profile: state.activeId, index, value: x }))`).
    A `<section aria-label="Effects" data-testid="effects">` after Transition, VJ mode only, absent when
    empty, with a legend and one horizontal `Fader` per entry, the same keys and send.
  - `Fader.tsx` and `FaderBank.tsx`: `mark` (PD9); `controller.css`: the tick, its locked look, the section.
    `FaderBank` already takes any list (`FaderBank.tsx:17`), and the Fader's default 20 ms gap gives SD11's spacing.
    A profile change changes the fader's `testId`, so the instance remounts and lets go (`Fader.tsx:71`).
  - Tests:
    - A unit test that a fader's `onSend` goes through the budget under the key `effect:<index>` (the
      `send-budget.test.ts` pattern), so AC10's send path fails here and not only in T6.
    - `effect-faders.test.ts`: none, DJ only, VJ only, both (once, in the bank), DJ mode (no section), order.
    - `control-effects.spec.ts` (profiles through `createProfile`, `tests/browser/fixtures/profiles.ts`): AC4 a
      profile with no ticks shows two faders and no `effects`; AC8 the third fader after the dials with the
      effect's name, in both modes; AC9 the section under Transition lists the VJ-ticked effects in stack
      order, absent in DJ mode, an effect ticked both shows once in the bank; AC16 keyboard alone moves each
      fader, `role="slider"`, accessible name, `aria-valuenow`, `aria-valuetext`; AC17 the tick's computed
      contrast against the track is at least 3:1 (`tests/contrast.ts`) and it is a shape.
  - About 190 changed source lines, 5 source files.
- **Verification:** `pnpm run test --project unit web/src/control/effect-faders.test.ts tests/meta/control-look.test.ts`;
  `pnpm test:browser tests/browser/control-effects.spec.ts tests/browser/control-layout.spec.ts tests/browser/control-fader.spec.ts tests/browser/control-modes.spec.ts tests/browser/control-transition.spec.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** T2
- **Autonomy note:** markup, class names and the exact form of the tick are the builder's within PD9 and
  AC17. Stop if the tick needs a token the brief lacks, or an existing bank or Duration-fader test needs a
  change (the Duration fader is a plain `Fader`, `Controller.tsx:295`; a `mark` of `undefined` must change
  nothing for it).

### T4 — The builder's toggles

- **Implements:** SD2, SD13, AC5, AC6, AC7
- **Expected output:**
  - `editor.ts`: `{ type: "effectFader"; index; which: "dj" | "vj"; on: boolean }`. Off deletes the key
    (never writes `false`); a DJ tick on a profile where another effect has it returns the draft unchanged
    (SD2). `isDirty` sees the change (`:343`); `reset`, save (`Editor.tsx:150-160`), export and import carry
    it with no further code.
  - `EffectRow.tsx`: two native checkboxes "Fader in DJ mode" and "Fader in VJ mode" (PD8), the DJ box
    disabled with the one-line reason "another effect already has the DJ fader" when another effect has it;
    for an effect scaled by recognisability the line "scaled by recognisability still applies". The note
    covers a custom effect with `abstraction: true` too: today the "(abstraction)" marker shows for built-ins
    only (`EffectRow.tsx:37`).
  - Tests: `editor.test.ts`: the action, the refusal, off deletes the key, the draft stays valid under the
    property tests at `:144-185` and `:414-445` (add the action to both lists); `builder.spec.ts`: tick DJ on
    one effect and see the other DJ boxes disabled with the reason, untick and see them enabled (AC6); tick VJ
    on two; the draft is unsaved, save, reload, flags still ticked (AC5); export is a version 3 file, delete,
    import it back, flags survive (spec Verification 2); a custom effect's row has both boxes; the note
    shows for a built-in abstraction effect and a custom effect with `abstraction` (AC7).
  - Existing tests the change may make untrue: the keyboard Tab walk (`builder.spec.ts:391-422`, capped at 120
    presses) gains two stops per row; raise the cap only if the run shows it exceeded, and say so.
  - About 110 changed source lines, 3 source files.
- **Verification:** `pnpm run test --project unit web/src/builder/editor.test.ts`;
  `pnpm test:browser tests/browser/builder.spec.ts tests/browser/builder-custom.spec.ts`; then
  `bash scripts/check.sh`.
- **Depends on:** T1
- **Autonomy note:** the label wording beyond the spec's two phrases and the layout of the toggle row are
  the builder's. Stop if the toggles need a change to `CustomRow` (they should come with `EffectRow`).

### T5 — The three-fader bank, measured

- **Implements:** SD9, AC18
- **Expected output:** new cases in `control-layout.spec.ts` with a real profile ticked DJ (one effect), in
  DJ and VJ mode, at the five viewports: no horizontal scrolling; every visible target at least 48×48 (the
  file's `fitProblems`, `:91-112`); the status bar, colour block and whole bank in view at the start and the
  end of the scroll; at 320×568 the bank at most 216 px tall and the scrolling area at least 130 px high; at
  568×320 the bank at most 198 px wide and the scrolling area at least 130 px wide (all ±1). No source change,
  except a `controller.css` fix where a measurement fails and the fix stays inside the bank's existing
  tokens (say which rule and why in the commit). 1 test file.
- **Verification:** `pnpm test:browser tests/browser/control-layout.spec.ts tests/browser/control-look.spec.ts tests/browser/control-effects.spec.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** T3
- **Autonomy note:** helper structure is the builder's. Stop if AC18's numbers cannot be met inside the
  bank's tokens (a spec question, SD9), or a fix changes a two-fader look (an existing layout case changes).

### T6 — End to end: the drag, the pick, the lock, two controllers

- **Implements:** SD11, AC10, AC12, AC13, AC14, AC15, AC20, AC21
- **Expected output:** `control-effects-e2e.spec.ts`; no source change. It uses `recordSends`
  (`tests/browser/sockets.ts:53-73`) and `budgetProblems` (`control-together.spec.ts:208-243`) and a
  `DeviceClient` (`tests/browser/control-server.ts:144-200`) to read the state's `effects`. The screen's
  strength is read through the state (`value`) and one pixel measure of an effect that shows (`brightness`,
  as `redness` is used in `control-modes.spec.ts:86`).
  - AC10: drag an effect fader together with a dial and the colour disc at 320×568 with two pointers; the
    frame carries the active profile id, the effect's index and the value; the last value of the drag is
    sent; at most 100 frames in any second, every gap at least 10 ms.
  - AC13: a second controller moves the fader; the first one's cap, readout and tick follow; the tick stays at
    the stored value.
  - AC12: a raw `effect` for another profile id, for index 11 on a two-effect profile, and one sent during a
    pick, change nothing and the first two are acknowledged (the `applied` frame names the `seq`).
  - AC14: after the drag, a re-pick of the active profile returns every fader to its stored value, as does a
    reload of the screen page; no `POST`, `PUT` or `DELETE` is made (`control-e2e.spec.ts:341`'s pattern); no
    `profile` console line appears for the drag itself (the proxy the existing tests use,
    `control-target.spec.ts:287-314`; the real guarantee is T1's engine test).
  - AC15: `dropNetwork` mid-drag shows "Locked", the faders disabled, nothing sent after it or after the
    link returns.
  - AC20 and AC21: the screen page, the builder preview, `/send` and `/trust` request what they did, and the
    controller requests nothing new (the request lists B-19 AC22, AC23 already assert); the whole gate passes.
- **Verification:** `pnpm test:browser tests/browser/control-effects-e2e.spec.ts`; then `bash scripts/check.sh`;
  then `pnpm check:load` once (a multi-pointer drag is the kind of test a loaded machine exposes, D-02, B-08).
- **Depends on:** T3
- **Autonomy note:** step order and helper shape are the builder's. Stop if the budget bound fails in the
  browser while `send-budget.test.ts` passes (a send bypasses the budget: a source defect in T3, not
  something to loosen here).

### T7 — The style brief and its mockups

- **Implements:** SD9, SD14, AC19
- **Expected output:**
  - `controller-style.md`: the Budget section (`:258-331`) gains three-fader rows for the five viewports (bank
    216 or 198, what the scrolling area keeps: 136 and 140 at 320×568 and 568×320, 208 at 320×640, 250 at
    768×1024) and the "B-18's" rows at `:315, :317, :319` are resolved; a part for the stored-value tick and
    one for the Effects section; the contrast table gains the tick's pair if it is not T8's; the Mockups
    section (`:333-343`) names the new frames.
  - `controller-style-mockups.html`: the three frames of PD13, at real CSS pixels, with their own copy of the
    tokens kept equal to `controller.css` by eye (nothing tests that copy).
  - The status line stays as B-16 left it and gains "Amended by B-18 (SD9), approval at `/review`".
    0 source lines, 2 doc files.
- **Verification:** `pnpm run test --project unit tests/meta/control-look.test.ts` (every contrast row
  against the stylesheet's tokens); open the mockups from disk and compare with the built page at 320×568,
  568×320 and 768×1024; then `bash scripts/check.sh` (format covers the docs).
- **Depends on:** T5
- **Autonomy note:** wording and mockup markup are the builder's. Stop if the brief would need a token or
  pair the code does not have; the code and the brief must say the same thing. The content is the owner's to
  approve at `/review` (H1).

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1 | `shared/src/profile.ts`, `engine/src/profile.ts`, their tests, `profiles.int.test.ts`, `file.test.ts`, `profile-check.spec.ts`, `builder.spec.ts` (`:677-698`), the three docs |
| 2 | T2, T4 | T2: `shared/src/control.ts`, `active.ts`, `apply.ts`, `screen-link.ts`, `Screen.tsx`, their tests and fixtures. T4: `editor.ts`, `editor.test.ts`, `EffectRow.tsx`, `builder.spec.ts` |
| 3 | T3 | `Controller.tsx`, `FaderBank.tsx`, `Fader.tsx`, `effect-faders.ts`, `controller.css`, `control-effects.spec.ts` |
| 4 | T5, T6 | T5: `control-layout.spec.ts`, `controller.css` only if a measurement fails. T6: `control-effects-e2e.spec.ts` |
| 5 | T7 | `docs/design/controller-style.md`, `controller-style-mockups.html` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph
docs/plans/phase-b-18-effect-strength-faders.md` prints the groups the `Depends on` fields actually give.

## Data changes

None: no table, no migration. The definition JSON gains optional `dj` and `vj` on each effect, additive and
reversible (an older build refuses a definition that holds them, PD11; nothing stored needs rewriting). No
browser storage key.

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| A hosted or older instance rejects a synced definition holding the flags (strict `profileFields`), and a rollback might mark flagged rows unusable on read (`server/src/profiles/store.ts`, not yet read). | T1 reads `store.ts` and `sync/` and tests a flagged round trip; H3 orders the deploy. Stop rule in T1. |
| A `/control` page left open across an upgrade drops every new state (PD11). | Accepted; a reload fixes it. |
| `control-layout.spec.ts`'s four-fader cases clone the DOM and so prove nothing about a real effect fader's width. | T5's case uses a real flagged profile. |
| 130 px of scrolling area at 320×568 and 568×320 may be too tight once the Effects section and the Transition grid sit in it. | The section is VJ only and scrolls; T5 measures; the spec accepts 130 (SD9). |
| The browser cannot read an effect's live strength on the screen; "no new program" is proxied by the absence of a `profile` console line (logged after a successful pick only, `active.ts:195`). | T1's engine test proves the guarantee at the source (`keyOf`); T6 reads the state's `value` and one pixel measure. |
| The mockups hold their own copy of the tokens (`controller-style-mockups.html`), so the owner could approve a look the app does not ship. | T7 compares the frames with the built page at three viewports; H1 repeats it. |
| D-13, D-15 flake the `control*.spec.ts` files new tests sit beside. | Not B-18's; a flake is registered, not patched. |
| `builder.spec.ts` is edited by T1 and T4 (the Tab-walk cap). | Different groups; T4 depends on T1. |

## Human steps

- **H0 — before `/audit`.** Commit the spec, the backlog change and this plan on the docs branch
  (`docs/phase-b-18-spec-plan`). `/build` needs a clean tree.
- **PD10** — answered by the owner before T1 touches `docs/design/architecture.md`.
- **H1 — at `/review`, after T7** (AC19, spec Verification 5). The owner opens the mockups and the built
  page side by side at 320×568, 568×320 and 768×1024 and approves the brief's new content. Then, on a phone
  against a running screen: tick the echo effect of a profile (or any effect), push it up on a breakdown,
  pick another profile and back, and see the stored strength return. AC19's approval exists only here.
- **H2 — hosted build.** If the hosted instance syncs profiles, deploy a build that knows the flags before
  ticking one on a synced profile (PD11).
- Pushing, the PR and the merge are the owner's.

## Out of scope for this plan

- Everything under the spec's Out of scope (a custom effect's parameters, saving a live strength, a reset
  key, the screen's `s` panel, B-23's fader, B-17's echo effect, changing how strength is computed).
- `docs/specs/phase-b-02-visual-profiles.md` (its effect table and file format at `:286-319`): earlier specs
  are amended by SD14, not edited.
- `profiles/README.md:6` and the five committed `profiles/*.json` (all `formatVersion` 2): unchanged; the
  owner ticks flags in the builder.
- A tolerant state schema for a stale `/control` page (PD11).
- `server/` source: no edit is planned; T1's stop rule covers a surprise in `store.ts` or `sync/`.

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

Audited by: Martijn Boot  Date: 2026-11-24
