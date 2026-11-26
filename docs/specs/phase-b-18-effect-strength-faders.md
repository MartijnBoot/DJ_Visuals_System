# Spec: b-18 — Effect strength faders on the controller

Status: Approved · Depends on: B-04 (`docs/specs/phase-b-04-live-set-controls.md`, built), B-19
(`docs/specs/phase-b-19-controller-lighting-desk.md`, built: the fader bank and component), B-16
(`docs/specs/phase-b-16-colour-wheel-always-on.md`, built: the pinned colour block, the send budget),
B-09 (`docs/specs/phase-b-09-transitions.md`, built: the Duration fader outside the bank, Keep
colour), B-03 (`docs/specs/phase-b-03-claude-code-authored-profiles.md`, built: custom effects,
`formatVersion` 2) · Fixes: — · Backlog: B-18

Line references are to `main` at `dc05fde`.

## Problem

Mid-set the owner wants to push one effect's strength up or down, for example more echo on a
breakdown. An effect's strength is fixed at whatever the profile stored.

- `/control` offers profiles, cameras, main audio, two dials (`DIALS`,
  `web/src/control/Controller.tsx:55-58`), transitions and colour. No control reaches an effect's
  `amount`.
- The control messages are `pick`, `dials`, `colour`, `resetColour`, `camera`, `refresh`,
  `mainAudio` and `transition` (`shared/src/control.ts:89-113`); none names an effect. The state a
  controller mirrors has no effects (`screenStateSchema`, `:144-181`).
- The screen applies controls in `createApplier` (`web/src/control/apply.ts:45-90`). A live colour
  edit hands the engine the same profile with a new palette (`recolour`,
  `web/src/profiles/active.ts:265-272`); an effect's strength is a number the engine reads each
  frame (`effectStrength`, `engine/src/profile.ts:127-137`), so a live strength can follow the same
  path.
- An effect has no way to say it should be played live. `effectSchema`
  (`shared/src/profile.ts:137-155`) is `strictObject`, so any new key is rejected by an instance that
  does not know it; B-03 SD15 met this for custom effects with `formatVersion` 2
  (`shared/src/profile.ts:245-293`).
- The builder's effect row edits strength, colour slot and audio binding and nothing about the
  controller (`web/src/builder/EffectRow.tsx:83-180`).
- The bank holds up to four faders (B-19 SD6, `web/src/control/FaderBank.tsx`). With the pinned
  colour block, four faders leave the scrolling area 74 px tall at 320×568 and 78 px wide at 568×320
  (`docs/design/controller-style.md:315-329`), which B-16 SD1 and SD2 left to this item.
- B-09 SD7 keeps "B-19 SD6's two free places for B-18 and B-23" (`docs/specs/phase-b-09-transitions.md:75`).

Cost today: a profile's look is locked to its stored strengths for the whole set.

## Decisions

The owner's answers from the interview (2026-11-24), then defaults marked as such.

- **SD1 — Two places on `/control`: the bank for DJ mode's one fader, a scrolling Effects section for
  the rest.** Effect faders ticked DJ sit in the pinned bank. Effect faders ticked VJ sit in an
  **Effects** section in the scrolling area, in VJ mode only, under Transition, using the same fader
  component, horizontal, outside the bank (B-09's Duration fader is the precedent).
- **SD2 — At most one effect per profile is ticked DJ.** The bank then holds three faders (the two
  dials and that one), leaving a fourth place free for B-23. The builder refuses a second DJ tick on
  a profile: the toggle disables itself with a one-line reason. A VJ tick has no cap beyond the
  profile's 12 effects.
- **SD3 — Two optional booleans per effect, `dj` and `vj`; absent means off.** A file in which any
  effect has either set to `true` is `formatVersion` 3; a file without keeps writing 1 or 2 exactly
  as today (B-03 SD15's rule). Import reads 1, 2 and 3; version 1 and 2 files containing the keys
  are refused with the same error a stray key gets today. The profile schema also rejects a second
  `dj: true` in one profile, so a hand-written file cannot break SD2. The built-in profile has none.
  The flags live inside the stored definition JSON, so no migration, and cloud sync carries them
  (`server/src/profiles/store.ts:122`).
- **SD4 — Strength only.** Every effect, built-in or custom, has the same two toggles, and the fader
  moves its `amount`. A custom effect's named parameters are not exposed (the backlog's "no other
  parameters").
- **SD5 — The fader is the stored base `amount`.** It shows and sets that number as 0 to 100. The
  audio binding still adds on top each frame and recognisability still scales an abstraction effect
  (`engine/src/profile.ts:127-137`), so at fader 100 with recognisability 0.3 an abstraction effect
  shows 30% of itself. Recorded as known behaviour; the builder's toggle row says "scaled by
  recognisability still applies" for abstraction effects.
- **SD6 — A live strength is never saved, and returns to the stored value on a pick or a reload.**
  Picking a profile (the active one included) restores every effect's stored strength; a screen page
  reload does the same (B-04 SD13). No per-fader reset key. Each effect fader shows the stored
  value as a tick mark on its track, a mark and not colour alone. While a pick is pending, a
  strength change is dropped, as a colour change is (`web/src/profiles/active.ts:266`)
  *(default, not asked)*.
- **SD7 — A new control message names the profile and the effect's place.**
  `{ type: "effect", seq, profile, index, value }` with `profile` the id from the state and `index`
  the effect's position in the stack. The screen applies it only when `profile` is the active
  profile and `index` is an effect; otherwise it drops it and still acknowledges it, so the
  controller's pending value clears and it shows the screen's truth. The state gains
  `effects`: one entry per effect ticked DJ or VJ, `{ index, name, stored, value, dj, vj }`, in
  stack order. Both go through the schemas in `shared/src/control.ts`, validated on receipt like
  every message (invariants, B-04 SD20). The applier's `switch` gets a case, so the `never` check in
  `apply.ts:86` covers it.
- **SD8 — The bank is the same in DJ and VJ mode.** An effect ticked DJ shows in the bank in both
  modes. An effect ticked VJ shows in the Effects section in VJ mode only. An effect ticked both
  shows once, in the bank. In DJ mode the VJ ticks show nothing. A profile with no ticks shows no
  Effects section and a two-fader bank, as today.
- **SD9 — A smaller scrolling area is accepted when a profile has a DJ tick; B-16 AC5 is amended.**
  With three faders the bank is 216 px tall (30 + 62·3) or 198 px wide (12 + 62·3). The scrolling
  area then keeps 136 px of height at 320×568 and 140 px of width at 568×320; 208 at 320×640, 250
  at 768×1024. The build updates the Budget section and the mockups of
  `docs/design/controller-style.md` for three faders at the five viewports. Approving this spec
  approves changing those files; their content is approved by the owner at `/review`.
- **SD10 — Labels and order.** A built-in effect is labelled with its type's name as the builder
  shows it; a custom effect with its label (trimmed). The Effects section lists in stack order, the
  bank's effect fader after the two dials. *(default, not asked)*
- **SD11 — One send budget, the existing one.** The effect faders go through B-16 SD4's page-wide
  budget with the key `effect:<index>`, spacing 20 ms like the dials. A value waits only as the
  newest of its own control; a lock drops it. The server's 120 per second and the controller's 100
  per second are unchanged. *(default, not asked)*
- **SD12 — The fader mechanics are B-19's.** The same component with its keys, relative drag, lock
  look and focus ring; `role="slider"`, accessible name the label, `aria-valuetext` the 0 to 100
  number. Test ids `effect-<index>` for the faders, `effects` for the section, `effect-dj-<index>`
  and `effect-vj-<index>` for the builder toggles. *(default, not asked)*
- **SD13 — The builder's toggles.** Each effect row (built-in and custom) gets two native checkboxes,
  "Fader in DJ mode" and "Fader in VJ mode". They are part of the profile draft: the unsaved-changes
  guard, save, export and import carry them, the preview ignores them. *(default, not asked)*
- **SD14 — Amendments recorded here, not edited into the earlier specs.** Approving this spec
  approves:
  - B-04 SD9: "DJ mode … two dials as wide sliders" (already B-19's bank) gains up to one effect
    fader; VJ mode gains the Effects section.
  - B-19 SD6: the bank holds three faders in this item's use; the fourth place stays free for B-23.
  - B-16 AC5: its numbers hold for a bank of two faders; with three, the scrolling area keeps at
    least 130 CSS px of height at 320×568 and at least 130 CSS px of width at 568×320.
  - B-03 SD15 and AC20: version 3 as SD3.
  - ADR 0001's "live changes are never saved" is kept, not amended (SD6).

  Kept unchanged: every target at least 48×48 CSS px; no horizontal scrolling at 320 CSS px wide;
  the wheel and faders usable by keyboard; contrast 4.5:1 for text and 3:1 for non-text.
  *(default, not asked)*

## Users and permissions

Unchanged from B-04: an approved controller can do exactly what it could before, plus move an
effect's strength. A sender's socket may send only setup messages (B-06 SD6), and the new message is
a control, so it is refused for a sender like every control. No role, no guarded area
(`docs/invariants.md`).

## In scope

- `shared/src/profile.ts`: the two flags, the one-DJ rule, `formatVersion` 3 in
  `SUPPORTED_FORMAT_VERSIONS` and `toProfileFile`, `holdsFlags`.
- `shared/src/control.ts`: the `effect` control and the state's `effects`.
- `engine/src/profile.ts`: the same two optional flags on its `Profile` effect types, so
  `web/src/profile-compat.ts` stays compatible (`engine/` never imports `shared/`; the engine never
  reads them).
- `web/src/profiles/active.ts` and `web/src/control/apply.ts` (+ `Screen.tsx` wiring): a live
  strength override beside the live palette, applied the next frame with no new shader program,
  restored on a pick, dropped while a pick is pending or for the wrong profile or index.
- `web/src/control/screen-link.ts` (`toScreenState`): the `effects` entry.
- `web/src/control/Controller.tsx`, `FaderBank.tsx`, a new Effects section, `controller.css`: SD1,
  SD8, SD9; the stored-value tick on a fader.
- `web/src/builder/EffectRow.tsx`, `editor.ts`: the toggles and the refusal (SD2, SD13).
- `docs/design/controller-style.md` and `controller-style-mockups.html` (SD9);
  `docs/custom-effects.md` and the B-02 effect table if they list the file's keys.
- `pnpm profile:check` and the `/profile` command's schema reading: the new keys and version 3.
- Tests for every criterion below.

## Out of scope

- A custom effect's parameters, adding, removing or reordering effects live, any other field
  (SD4).
- Saving a live strength into the profile (ADR 0001).
- A per-fader reset key, double-tap reset, a "reset all" key (SD6).
- Sliders on the screen's `s` panel, the builder's preview, `/send`, `/trust`.
- B-23's camera level fader, B-17's echo effect, B-10, B-11; B-18 only keeps a bank place for B-23.
- Choosing a profile's effects by role other than the two flags; scenes (B-07).
- A change to how strength is computed in `engine/` (SD5) or to the flash limiter.
- Changing B-16's colour block or B-19's look.
- Any viewport outside B-19's five.
- Authoring the flags in the `/profile` command's own profiles beyond what the schema allows (the
  owner may tick them in the builder).

## Acceptance criteria

### The profile

- **AC1.** When an effect has `dj: true` or `vj: true`, the profile schema shall accept it; when a
  profile has more than one effect with `dj: true`, the schema shall reject it, naming the second
  effect's index.
- **AC2.** When profiles are exported and any effect has a flag set to `true`, the file shall be
  `formatVersion` 3; otherwise it shall be 1 or 2 exactly as before, with no `dj` or `vj` key
  written for an off flag.
- **AC3.** When a `formatVersion` 3 file is imported, the flags shall be stored and survive an
  export and import; a version 1 or 2 file holding a flag key shall be refused; a version 1 or 2
  file without flags shall import unchanged.
- **AC4.** When an older profile has no flags, `/control` shall show no Effects section and a
  two-fader bank, as today.

### The builder

- **AC5.** Each effect row (built-in and custom) shall have "Fader in DJ mode" and "Fader in VJ
  mode" checkboxes; changing one shall mark the draft unsaved, and saving shall store it.
- **AC6.** While another effect in the profile has the DJ tick, the DJ checkbox of every other
  effect shall be disabled with a one-line reason; unticking the first shall enable them again.
- **AC7.** For an effect scaled by recognisability, the toggle row shall say that the scaling still
  applies.

### The controller

- **AC8.** While the active profile has an effect ticked DJ, the bank shall show a third fader
  labelled with that effect's name after the two dials, in DJ and VJ mode, orientation as the bank's;
  its value shall be the effect's stored-or-live `amount` as 0 to 100.
- **AC9.** While the mode is VJ, the active profile's effects ticked VJ (and not DJ) shall show in an
  Effects section under Transition, in stack order, each a horizontal fader; in DJ mode the section
  shall not exist; an effect ticked both shall show once, in the bank.
- **AC10.** When an effect fader is dragged, the controller shall send `effect` with the active
  profile's id, the effect's index and the value, through the page's send budget (B-16 AC8 still
  true with the third fader), and the last value of a drag shall always be sent.
- **AC11.** When the screen receives `effect`, it shall apply it in the next frame to the active
  profile's effect at that index, without compiling a new shader program, and acknowledge it in that
  frame's `applied` batch (B-04 AC20's rule).
- **AC12.** If `effect` names a profile that is not active, or an index with no effect, or arrives
  while a pick is pending, then the screen shall change nothing and (the first two) still
  acknowledge it; the controller shall then show the screen's value.
- **AC13.** While a fader is not held, its cap, readout and tick shall show the screen's last
  reported value and the stored value, whoever changed it, as B-19 AC9 says; a second controller's
  move shall appear on the first.
- **AC14.** When a profile is picked (the active one included), or the screen page reloads, every
  effect shall show and run its stored strength, and no request shall write a profile (B-04 AC22).
- **AC15.** While the link is locked, the effect faders shall be disabled with the locked look, and
  values waiting in the budget shall be dropped (B-16 AC15).
- **AC16.** The effect faders shall be usable by keyboard alone and expose `role="slider"` with the
  effect's name, `aria-valuenow` and `aria-valuetext` (B-19 AC7, AC8, AC21).
- **AC17.** The stored-value tick shall be at least 3:1 against the track and shall not be colour
  alone.

### Layout

- **AC18.** With a DJ tick, at 320×568 and 568×320 the bank shall be at most 216 px tall or 198 px
  wide (±1), the scrolling area shall keep at least 130 CSS px of height at 320×568 and 130 of width
  at 568×320, the status bar, colour block and whole bank shall be in view when scrolled to the
  start and to the end, there shall be no horizontal scrolling and every target at least 48×48 in
  DJ and VJ mode at the five viewports (B-19 AC15).
- **AC19.** The style brief and its mockups shall show the three-fader bank and the Effects section,
  with the Budget rows for the five viewports, and the owner shall have approved them at review.

### Boundaries

- **AC20.** The screen page, builder preview, `/send` and `/trust` shall look and request as
  before; the controller shall request nothing new (B-19 AC22, AC23).
- **AC21.** Every B-04, B-06, B-09, B-16 and B-19 acceptance criterion shall still pass, through the
  same test ids, with no change to the server's limits.

## Data

No table or migration. The profile definition JSON gains optional `dj` and `vj` on each effect.
`formatVersion` 3 as SD3. No new browser storage key.

## API contract

No HTTP route changes. Control messages (`shared/src/control.ts`):

| Message | Direction | Fields | Errors |
|---|---|---|---|
| `effect` | controller → screen (through the server) | `seq`, `profile` (id), `index` (int ≥ 0, < 12), `value` (0 to 1) | invalid: dropped with one `warn` naming the type (B-04 SD20); stale profile or index: acknowledged, no change |
| state `effects` | screen → controllers | `[{ index, name (≤ 40), stored, value, dj, vj }]`, at most 12, in stack order | — |

The profile endpoints accept and return the two keys (`POST/PUT /api/profiles`, import, sync), as
validated by the shared schema.

## UI

- **Bank:** the two dials, then the DJ-ticked effect's fader, if the active profile has one. Locked as
  today.
- **Effects section (VJ only):** under Transition, a legend "Effects" and one horizontal fader per
  VJ-ticked effect with its name, 0 to 100 readout and a stored-value tick. Absent when there is none.
- **Builder:** two checkboxes per effect row and, under a DJ tick already taken, a disabled DJ box
  with "another effect already has the DJ fader".
- **States:** before the first state, none of it. Locked: disabled, locked look. A profile without
  ticks: as today.

## Non-functional

- **Message rate:** under the controller's 100 per second and the server's 120 (SD11).
- **Render budget:** a live strength is a number change; no new program, no recompile. B-01's p95 ≤
  50 ms audio-to-frame holds.
- **Accessibility:** B-19 SD11, SD12; no font, image or package.
- **Requests:** none new (AC20). Logging: none added; no profile definition in a log line (B-12
  invariant).

## Edge cases and failure modes

- **Mid-set, users waiting (probe):** a strength drag together with a dial or colour drag loses no
  last value (SD11). A lock mid-drag sends nothing late (AC15).
- **A pick races a strength drag:** the message carries the profile id, so it cannot land on the
  new profile's effect (SD7, AC12); a pending pick drops it.
- **Restart or reload (probe):** a reload restores stored strengths (AC14) and locks controllers
  until the state arrives (B-04 SD13).
- **Two controllers on one fader:** the last one the screen applied wins; the other shows it
  (AC13).
- **The effect list changes under the controller** (a refresh after the builder saved fewer
  effects, then a pick): the next state replaces the list; a message with an index beyond it is
  dropped (AC12).
- **Audio-bound effect, abstraction effect:** the fader moves the base only (SD5); an effect at
  strength 0 with a binding still reacts to the beat.
- **Imported file with a second DJ tick:** the whole import is refused with the schema's message
  (all or nothing, B-02).
- **Keep colour, transitions:** a pick restores strengths (SD6) and Keep colour carries only the
  primary colour; the two do not interact.
- **No network:** as B-04 SD12; nothing is queued.
- **Money, roles, guarded areas (probes):** nothing touches money; no role changes; no guarded area
  is touched.

## Verification

1. `bash scripts/check.sh` green with the new unit tests (schema, one-DJ rule, versions, applier,
   state, builder toggles) and browser tests.
2. Browser test, builder: tick DJ on one effect, see the other DJ boxes disabled; tick VJ on two;
   save, export (a version 3 file), delete and import it back.
3. Browser test at 320×568 in DJ mode with a profile ticked DJ: pair a controller; check the
   three-fader bank, the scrolling area at least 130 px, drag the effect fader and see the screen's
   effect strength change in the next frame with no new program; pick the profile again and see the
   stored value return; with two pointers drag it together with the disc and the dials and count at
   most 100 messages in any second. Turn to 568×320 and repeat.
4. The same in VJ mode at 768×1024: the Effects section lists the VJ-ticked effects, an effect
   ticked both shows once in the bank; a second controller moves a fader and the first follows; a
   stale `effect` for another profile changes nothing.
5. The owner, on a phone and the screen machine: tick the echo effect of a profile, push it up on a
   breakdown, pick another profile and back, and look at the brief's mockups at `/review`.

## Exit condition

Mid-set, on `/control`, the owner pushes up the one effect the profile's author ticked for DJ mode
(or any VJ-ticked effect in VJ mode) with a thumb, the screen follows live, the next profile starts
from its stored strengths, and the gate proves it.

## Open questions

None.
