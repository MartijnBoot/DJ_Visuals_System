# Spec: b-09 — Transitions

Status: Approved · Depends on: B-02 (`docs/specs/phase-b-02-visual-profiles.md`, built), B-03
(`docs/specs/phase-b-03-claude-code-authored-profiles.md`, built), B-04
(`docs/specs/phase-b-04-live-set-controls.md`, built), B-08
(`docs/specs/phase-b-08-load-proof-gate.md`, built), B-19
(`docs/specs/phase-b-19-controller-lighting-desk.md`, PR #14 open: the controller layout and the
fader component this item places a section and a fader in) · Fixes: — · Backlog: B-09

Line references are to `main` at `a408a67`, except `web/src/control/`, which is B-19's branch
`fix/phase-b-19-review` at `d668b24` (PR #14); `engine/`, `shared/` and `web/src/profiles/` are
identical on both.

## Problem

A profile switch is always a hard cut. Mid-set a cut is sometimes right and often too abrupt: a
change of mood wants to arrive, not jump, and the VJ has no way to shape it.

- The engine draws exactly one look per frame: one program, one pass into one of two ping-pong
  targets that reads the other as the previous frame (`engine/src/index.ts:487-568`). There is
  one `active` profile and one `pending` switch (`engine/src/index.ts:234-243`).
- A switch links the new program while the old one keeps drawing, then swaps it in at the start
  of a frame (`engine/src/index.ts:286-316`); the first frame after the swap mixes nothing of the
  old look (`swapped`, `engine/src/index.ts:244-245`, `engine/src/index.ts:500-501`). This is
  B-02 SD15's hard cut, kept by B-04 SD6, which named this item.
- The dials are one engine-wide value (`engine/src/index.ts:336`, `:621-623`). A pick applies the
  new profile's starting dials and resets the live palette when the swap resolves
  (`web/src/profiles/active.ts:157-178`), so anything drawn across a switch would see the
  outgoing look jump to the incoming profile's dials.
- A pick from the panel (`web/src/Panel.tsx:133-151`, `web/src/Screen.tsx:451`) and from a
  controller (`web/src/control/apply.ts:68-71`) both go to `active.pick`; nothing carries how to
  switch. The control messages have no such field (`shared/src/control.ts:73-86`).
- A pick always starts from the stored palette (B-04 SD7, `web/src/profiles/active.ts:174`), so a
  live primary colour the VJ has set is lost on every switch.

Cost today: every change of profile is a cut, and every cut throws away the live primary colour.

## Decisions

The owner's answers from the interview (2026-11-23), then defaults marked as such.

- **SD1 — Six types: Cut, Crossfade, Dissolve, Wipe, Beat cut, Dip to colour.** *Cut* is today's
  hard cut. *Crossfade* mixes the old look into the new one. *Dissolve* flips blocks of the frame
  from old to new at random. *Wipe* sweeps a soft-edged line from left to right. *Beat cut* is a
  hard cut on the next beat. *Dip to colour* fades the old look into a colour, then the new look
  out of it. The backlog's "flash to the primary colour" became Dip to colour: a full-frame flash
  breaks B-01's flashing rule (`docs/specs/phase-b-01-live-visual-engine.md:256-257`); a dip
  bounded by a minimum duration does not (SD13).
- **SD2 — A pick during a running transition jumps, then goes.** When the newer pick's look is
  linked and ready, the running transition ends at once (its incoming look fully on), and the
  new transition starts from that look. Never three looks at once. While a pick is linking, a
  newer pick supersedes it as today (`ProfileSupersededError`). A Cut picked during a transition
  ends it and cuts.
- **SD3 — Each look keeps its own dials and palette; the incoming one is live.** The outgoing
  look is frozen at the dials and live palette it had when the transition started. The incoming
  look starts from its profile's starting dials and stored palette (subject to SD4). From the
  first frame of the transition the incoming profile is the active profile everywhere: the
  panel's picker, the controllers' active tile, faders and swatches. A dial move or colour change
  during the transition changes the incoming look only.
- **SD4 — "Keep colour" carries the primary colour across a switch.** With it on, the incoming
  profile's primary slot (stored or derived, B-04 SD10) takes the outgoing look's primary colour
  as it is on screen at the transition's start, the live edit included, and holds it through and
  after the transition until someone changes it or presses Reset, which restores the incoming
  profile's stored colour. It applies to every type, Cut and Beat cut included, and to a re-pick
  of the active profile. It is a live change and is never saved into a profile (ADR 0001). With
  it off, a pick starts from the stored palette as today. This amends B-04 SD7 while the option
  is on. Every other palette slot follows SD3.
- **SD5 — One current choice.** The current transition is a type, a duration and Keep colour.
  Every pick, from the panel or any controller, uses the choice current at the moment of the
  pick; there is no per-pick override. The choice is part of the screen page's state, so every
  controller and the panel mirror it and the last change wins (B-04 SD5). Changing it during a
  running transition affects only the next pick.
- **SD6 — The duration is a fader, 0.5 s to 8 s, outside the fader bank.** A horizontal fader
  made from B-19's fader component (as the wheel's brightness fader is, B-19 SD8), in the
  Transition section, never in the bank, so B-19 SD6's two free places stay for B-18 and B-23.
  It reads in seconds with one decimal ("2.0 s") instead of B-19 SD7's 0–100, and is disabled
  while Cut or Beat cut is chosen. *Range and curve (default, not asked):* fader position
  `x ∈ [0, 1]` maps to `0.5 × 16^x` seconds, so the ends are 0.5 s and 8 s and the middle is
  2.0 s; B-19 SD9's mechanics and keyboard steps apply to `x`.
- **SD7 — The Transition section is VJ mode only.** On `/control` in VJ mode it sits directly
  under the Profiles section: the six type tiles (the current one pressed), the duration fader
  and a Keep colour toggle. DJ mode is unchanged (B-04 SD9) and its picks use the current choice
  silently. This amends B-04 SD9's VJ mode by one section.
- **SD8 — The `s` panel gets the same three controls.** A type select, a duration slider (same
  range and curve) and a Keep colour checkbox, in the panel's existing style, next to the profile
  picker, because B-04 SD24 keeps the panel complete. *(default, not asked; stated at the
  interview, not objected to)*
- **SD9 — The choice is remembered on the screen machine; the first-run default is Cut.** Type,
  duration and Keep colour are saved in the screen page's browser storage under `djv.transition`
  on every change and restored on load, like `djv.profile`. A missing or unreadable value gives
  **Cut, 2.0 s, Keep colour off**, so nothing changes for anyone who never touches it. Never in
  a profile, a file or the database (ADR 0001).
- **SD10 — Beat cut waits at most 2 s for a beat.** Once the new look is ready, it cuts on the
  first frame whose `beat` feature has risen to at least 0.5 from below 0.5. With no such rise
  within 2 s of being ready, it cuts at 2 s. While the screen's audio is not `ok` (before Start,
  `lost`, `none`) it cuts at once. The `beat` feature is read before the reactivity dial, so
  Beat cut works at reactivity 0. A pick during the wait follows SD2. *(the 0.5 threshold and the
  pre-dial reading: default, not asked)*
- **SD11 — Both looks run live; the scaler and the guard treat a transition as load.** Both looks
  keep running on audio and camera at the current render scale. The scale controller measures
  transition frames like any others (B-01 SD8). The custom-effect guard (B-03 SD8) does not act
  during a transition, as it does not while a switch is pending (`engine/src/index.ts:479`). The
  real-time budget is a human check on the owner's screen machine (H1); the gate's check is
  structural, never wall-clock (B-08).
- **SD12 — Dip to colour passes through the outgoing look's primary colour.** Captured at the
  transition's start as it is on screen; a colour change during the dip changes the incoming
  look, not the dip colour. With Keep colour on the two are the same colour.
- **SD13 — Progress is by wall clock, and the mix adds no flash.** Progress `p` runs from 0 at the
  transition's first frame to 1 at its duration, by frame timestamps, so a transition takes its
  duration at any frame rate. Crossfade and Dip mix linearly in `p` (Dip: `p < 0.5` from the old
  look to the colour, `p ≥ 0.5` from the colour to the new look). With the 0.5 s minimum and any
  frame interval up to 1/30 s, the mix weight alone moves at most 0.14 of full scale per frame,
  below `FLASH_MAX` (0.35, `engine/src/look.ts`). *(default, not asked)*
- **SD14 — Dissolve and Wipe shapes.** *Dissolve*: the frame is cut into blocks a 32nd of its
  width (square); each block has a fixed random threshold in [0, 1) for the transition and shows
  the new look once `p` passes it, never flipping back. *Wipe*: left to right, the edge at `p`
  of the width with a soft edge 4% of the width wide; the whole frame is the new look at `p = 1`.
  No other direction. *(default, not asked)*
- **SD15 — Each look keeps its own frame history.** Each look reads its own previous output for
  smear and for a custom effect's `lastFrame` and flash limiter, never the mixed output. The
  incoming look's history starts from the frame on screen when the transition starts, as
  today's swap does for a profile with code (B-03 PD4); a built-in look's first frame mixes no
  smear, as today. `docs/custom-effects.md` states this for `lastFrame`. *(default, not asked)*
- **SD16 — The pick's acknowledgement and the active profile move at the transition's first
  frame.** The `applied` acknowledgement of a pick (B-04 SD17) is sent in the batch after the
  first frame that draws the incoming look; for Beat cut that is the cut frame. Before that frame
  nothing reports the incoming profile as active. B-04's human latency step is measured with
  Cut. *(default, not asked)*
- **SD17 — Failures keep today's behaviour.** A profile that does not link starts no transition:
  the current look keeps drawing (a running transition carries on) and the reason shows as
  today. A WebGL context loss during a transition ends it; the restore draws the active
  (incoming) profile alone, as today's restore does. A render-scale step or a resize during a
  transition recreates both looks' targets; the transition carries on. *(default, not asked)*
- **SD18 — A re-pick of the active profile transitions too.** From the live look to the same
  profile's starting dials and stored palette (Keep colour applying), with the current type.
  *(default, not asked)*
- **SD19 — One new control and one new state field.** A `transition` control
  (`shared/src/control.ts`): `{ type: "transition", seq, kind?, duration?, keepColour? }`, at
  least one of the three; `kind` one of `cut`, `crossfade`, `dissolve`, `wipe`, `beatCut`, `dip`;
  `duration` a number from 0.5 to 8 (seconds). The screen state gains
  `transition: { kind, duration, keepColour }`. The control is applied in the first frame after
  receipt and acknowledged in that frame's batch, like the dials (B-04 SD17). While the duration
  fader is dragged, B-19 SD9's one-change-per-frame rule applies. Validation, size and rate
  limits are B-04 SD20's, unchanged. *(default, not asked)*
- **SD20 — Docs change, and approving this spec approves the edits.** B-02 SD15 and B-04 SD6
  ("a pick is a hard cut") now read "a pick uses the current transition; Cut is SD15's hard
  cut". B-04 SD7 and SD9 as amended in SD4 and SD7. `docs/design/architecture.md`: the engine
  draws up to two looks and a mix pass during a transition. `docs/custom-effects.md`: SD15's
  `lastFrame` rule. No row in `docs/invariants.md` changes; no guarded area is touched; no
  dependency is added. `docs/design/controller-style.md` is not changed: the section uses the
  brief's existing tiles, fader and toggle. *(default, not asked)*

## Users and permissions

| Role | Can | Cannot |
|---|---|---|
| Operator at the screen machine (`s` panel) | Everything before; set the transition type, duration and Keep colour | — |
| Approved controller | Everything before; set the transition type, duration and Keep colour (the screen never knows a device's mode, B-04 SD9, so the control is accepted from either mode) | Save a transition into a profile; pick a transition for one pick only |
| Waiting device, any other LAN host | Unchanged from B-04 | Send or see a transition |

## In scope

- `engine/`: up to two looks per frame, each with its own program, uniforms, dials, palette and
  pair of targets; a mix pass for the six types (SD1, SD13, SD14); progress by frame timestamp;
  SD2's jump-and-go; SD10's beat wait (the engine receives whether audio is `ok`); SD11's guard
  rule; SD15's histories; SD17's failure paths. `setProfile` (or a successor) takes the
  transition; `setDials` goes to the incoming look. Still no dependency; `Profile` unchanged.
- `shared/`: the `transition` control and the `transition` state field (SD19).
- `web/`: the current choice, its storage (`djv.transition`, SD9) and its place in the screen
  state; `profiles/active.ts` passes the choice with each pick, applies SD4's Keep colour and
  SD16's timing; `control/apply.ts` handles the new control; the Transition section on
  `/control` in VJ mode (SD6, SD7); the panel's three controls (SD8).
- Tests: unit (engine mix maths, progress, beat wait, Dissolve and Wipe masks, the flash bound;
  `active.ts` Keep colour and timing; the control schema), browser (pixel reads of each type
  between two flat-colour profiles, the controller section, the panel, the structural check);
  meta tests unchanged.
- Docs: SD20's edits; a runbook entry for H1 and H2.

## Out of scope

- A per-pick override, an "arm next transition" mode, or a transition chosen per profile tile.
- Transitions stored in a profile, the profile file, an export or the database.
- Transitions in DJ mode's UI, or a read-only "current transition" mark in DJ mode.
- Transitions between camera feeds or main-audio sources: they stay as B-06 left them.
- Transitions in the builder's preview, and in `pnpm profile:check`.
- Scenes and whether scene recalls reuse these transitions (B-07 decides).
- More types: flash, zoom, slide, push, luma key, directional wipes, transitions written as
  custom GLSL by profile authors.
- Easing curves, or a choice of curve; durations in beats or bars; tempo detection.
- A progress indicator for a running transition on the controller or the panel.
- Three looks at once; a frozen still as the outgoing look.
- A global colour layer or tint (B-10); Keep colour carries one palette slot only.
- Any change to the render scaler's thresholds, the guard's timing, or the flash limiter.
- The fader bank (B-19 SD6) and its places; the style brief.
- Hosted use (B-12) gets transitions through the panel like any screen page; nothing hosted-only.

## Acceptance criteria

Engine and mix:

- **AC1.** When a pick is made with Crossfade of duration D, the system shall draw both looks in
  every frame from the transition's first frame until progress reaches 1, and the output shall
  be `mix(old, new, p)` with `p` = elapsed frame time / D, clamped to [0, 1]; from the frame after
  `p` reaches 1, only the new look shall be drawn.
- **AC2.** When a pick is made with Dissolve, each block a 32nd of the width wide shall show
  either the old or the new look whole, the share of blocks showing the new look shall rise with
  `p` and be 1 at `p = 1`, and no block shall return from new to old during the transition.
- **AC3.** When a pick is made with Wipe, every pixel left of the edge at `p` of the width minus
  the 4% soft edge shall show the new look, every pixel right of the edge shall show the old
  look, and the whole frame shall show the new look at `p = 1`.
- **AC4.** When a pick is made with Dip to colour, the frame at `p = 0.5` shall be the outgoing
  look's primary colour as it was on screen at the transition's start (within the gate's colour
  tolerance), and a colour change made during the dip shall not change that colour.
- **AC5.** When a pick is made with Beat cut, the system shall cut on the first frame after the
  new look is ready whose `beat` feature rose to at least 0.5 from below 0.5; if none does within
  2 s of being ready, it shall cut at 2 s; while the screen's audio is not `ok`, it shall cut on
  the first frame after the new look is ready.
- **AC6.** When a pick is made with Cut, the system shall behave as B-02 SD15 does today; the
  existing switch tests shall pass unchanged.
- **AC7.** While a transition runs, the outgoing look shall be drawn with the dials and palette it
  had at the transition's start, and a dial or colour change shall change the incoming look only.
- **AC8.** While a transition runs, each look's smear and each custom effect's `lastFrame` shall
  read that look's own previous output, never the mixed frame; the incoming look's first frame
  shall read the frame on screen at the transition's start.
- **AC9.** When a pick's look becomes ready while a transition runs, the system shall end the
  running transition (its incoming look fully on) and start the new transition from that look in
  the same frame, and no frame shall draw more than two looks.
- **AC10.** If the picked profile does not link, then the system shall start no transition, keep
  drawing what it drew (a running transition carries on), and show today's reason.
- **AC11.** If the WebGL context is lost during a transition, then after the restore the system
  shall draw the incoming profile alone.
- **AC12.** While a transition runs, the custom-effect guard shall not bypass any custom effect,
  and the scale controller shall record every transition frame.
- **AC13.** While a transition runs, each frame shall draw each look's program exactly once and
  the mix once; outside a transition each frame shall draw one look as today (the gate's
  structural check, B-08; no wall-clock bound).
- **AC14.** For every duration from 0.5 s to 8 s and every frame interval up to 1/30 s, the
  change in mix weight between two frames shall be at most 0.14, and for Dip the luma change
  that the mix weight alone causes shall stay below `FLASH_MAX`.
- **AC15.** When frames are drawn at a lower rate, the transition shall still end within one frame
  interval of its duration.

Choice, colour and state:

- **AC16.** When the transition choice changes, the next pick shall use the new choice and a
  running transition shall keep the choice it started with.
- **AC17.** While Keep colour is on, when a pick's transition starts, the incoming profile's
  primary slot shall hold the outgoing look's primary colour as it was on screen, the state's
  `palette` shall carry it and `storedPalette` shall not; Reset on that slot shall restore the
  stored colour; no request shall write a profile. While Keep colour is off, a pick shall start
  from the stored palette as today.
- **AC18.** When a transition's first frame is drawn, the screen state shall name the incoming
  profile as active with its dials and palette, and the pick's `applied` acknowledgement shall go
  out in the next batch; for Beat cut, at the cut frame.
- **AC19.** When the page loads, the system shall restore type, duration and Keep colour from
  `djv.transition`; if the key is missing or does not validate, it shall use Cut, 2.0 s, Keep
  colour off.
- **AC20.** When the active profile is picked again, the system shall transition with the current
  type to that profile's starting dials and stored palette, Keep colour applying.

Controller, panel and messages:

- **AC21.** While `/control` is in VJ mode, the system shall show a Transition section directly
  under Profiles with six type tiles (the current one `aria-pressed="true"`), a horizontal
  duration fader reading in seconds with one decimal, and a Keep colour toggle; the fader shall
  map position `x` to `0.5 × 16^x` s and be disabled while Cut or Beat cut is current; every
  target shall be at least 48×48 CSS px and the page shall not scroll sideways at 320 CSS px wide.
- **AC22.** While `/control` is in DJ mode, the system shall show no transition control, and a
  profile tile tapped there shall switch with the current choice.
- **AC23.** While the controls are locked (B-04 SD12), the Transition section shall be locked with
  them and send nothing.
- **AC24.** When the operator changes the type, duration or Keep colour in the `s` panel, every
  controller shall show the new choice, and a change on a controller shall show in the panel.
- **AC25.** When a `transition` control arrives, the screen page shall apply it in the first frame
  after receipt and acknowledge it in that frame's batch; if it fails `controlSchema` (an unknown
  kind, a duration outside 0.5–8, no field), then it shall be dropped with one `warn` naming its
  type, and the socket shall stay open.
- **AC26.** Before Start, transitions shall run over the idle look, and Beat cut shall cut at once.
- **AC27.** While a set with transitions runs, the screen page shall make no request beyond the
  allow-list in `docs/invariants.md` (the existing request checks, extended to a run that
  transitions).

Human checks on the owner's screen machine:

- **AC28 (H1).** During an 8 s Crossfade between the owner's two heaviest profiles, the overlay's
  audio-to-frame p95 shall stay at or below 50 ms (B-01 SD2) and the frame rate shall not drop
  below the display's refresh rate.
- **AC29 (H2).** Each of the six types, picked from a phone in VJ mode, shall look as SD1, SD12
  and SD14 describe, with no blank or black frame, and Keep colour shall carry the primary across
  a Cut and a Crossfade.

## Data

No table, no migration, no profile field, no `formatVersion` change. One browser-storage key on
the screen page: `djv.transition` = `{ kind, duration, keepColour }`, validated on read.

## API contract

No HTTP endpoint changes. Messages (`shared/src/control.ts`):

| Message | Direction | Shape | Errors |
|---|---|---|---|
| `transition` control | controller → server → screen | `{ type, seq, kind?, duration?, keepColour? }`, at least one | Dropped with one `warn` (B-04 SD20) |
| `state.transition` | screen → server → controllers | `{ kind, duration, keepColour }` | A state that fails validation is dropped as today |

## UI

- **`/control`, VJ mode:** a Transition section under Profiles. Six tiles in the brief's tile
  style: Cut, Crossfade, Dissolve, Wipe, Beat cut, Dip to colour. A horizontal fader labelled
  "Duration", readout "2.0 s", disabled (the brief's locked look) for Cut and Beat cut. A toggle
  "Keep colour". Locked with every other control while the link is down.
- **`/control`, DJ mode:** unchanged.
- **`s` panel:** a "transition" row (select), a "duration" row (slider with the seconds readout,
  disabled for Cut and Beat cut) and a "keep colour" checkbox, next to the profile picker, in the
  panel's existing style.
- **Screen output:** during a transition, the mix; no overlay text, no progress mark.

## Non-functional

- Performance: AC28 on the owner's machine; AC13 in the gate. No transition may drop the screen
  below the refresh rate on the owner's machine (backlog "Not this").
- Accessibility: AC14's flash bound; B-19 SD11's contrast and focus rules for the new section;
  the fader keyboard-operable (B-19 SD9).
- Logging: the `transition` control at `debug`, type only, as every control (B-04 SD27). The
  link-failure warning stays as today.
- Memory: during a transition the engine holds a second pair of targets at the render size; it
  frees them when the transition ends.

## Edge cases and failure modes

- **A pick during a transition:** SD2, AC9. **During a Beat cut's wait:** the same.
- **A pick while the next profile is still linking:** the newest wins (today's supersede).
- **A profile that does not link:** SD17, AC10. **Context loss:** AC11.
- **The screen page reloads mid-transition:** the reloaded page draws the remembered profile
  alone, as today; the choice is restored (AC19).
- **Duration changed during a transition:** the running one keeps its duration (AC16).
- **Keep colour when the outgoing primary is not drawn by any effect:** the colour still carries;
  the builder's hint (B-04 SD10) is the author's concern.
- **Silence, a breakdown, no audio:** Beat cut's 2 s limit and the not-`ok` rule (SD10).
- **A weak GPU:** the scaler steps down after about 2 s above budget (SD11); a transition of 2 s
  or less rarely triggers it.
- **Two controllers set the choice at once:** last change wins (SD5).
- **Hosted use, no controllers:** the panel's controls only.

## Verification

1. `bash scripts/check.sh` green, with the new unit and browser tests (AC1–AC27).
2. On the owner's screen machine, `pnpm start`, Start, open the overlay (`o`).
3. Pair a phone; switch it to VJ mode; set Crossfade, 8 s; pick the heaviest profile, then the
   second heaviest; read p95 and fps on the overlay during the fade (AC28, H1).
4. Pick through all six types in turn, at 0.5 s and at 4 s; for Dip, set a vivid live primary
   first; turn Keep colour on and pick with Cut and with Crossfade; check the primary carries,
   then press Reset (AC29, H2).
5. Reload the screen page: the panel shows the same transition choice; the controller mirrors it.

## Exit condition

A VJ picks a profile on `/control` and it arrives by the chosen one of six transitions, both
looks live, the primary colour carried when asked, the gate green and the owner's machine within
50 ms p95 during an 8 s crossfade.

## Open questions

None.
