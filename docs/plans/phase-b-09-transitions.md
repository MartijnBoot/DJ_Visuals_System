# Plan: b-09 — Transitions

Spec: [docs/specs/phase-b-09-transitions.md](../specs/phase-b-09-transitions.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001 Setup Decision Record](../adr/0001-setup-decision-record.md) — the mix is
drawn in the browser on the screen machine; the choice lives in the screen page's browser storage,
never in a profile, a file or the database (SD9); [0002](../adr/0002-remote-input-over-the-lan.md)
— the LAN listener's routes are unchanged, the new control rides the existing device socket and
`deviceMessageSchema` (`shared/src/control.ts:108`); [0003](../adr/0003-hosting-on-oracle-synced-profiles.md)
— nothing hosted-only, the panel works the same there. New dependencies: none (SD20).

Line references are to `69a34ef` (origin/main, PR #14 merged). The spec is read from the
uncommitted working copy of 2026-11-23 (Human steps, H0).

## Approach

The engine work comes first and in three steps, because it is where the risk is. T2 turns today's
one implicit look (`active` plus the engine-wide `dials`, `targets`, `current`, `swapped`,
`engine/src/index.ts:234-339`) into a `Look` value with no change in behaviour — every existing
engine test passes unchanged, which is AC6's proof. T3 then lets the engine hold a second look and
draws a **mix pass in place of the present pass** during a transition: each look draws into its
own target pair as today, and a mix program reads the two looks' latest targets onto the canvas,
so a transition frame is two look draws and one mix draw, and a frame outside one is exactly
today's (AC13). T3 carries Crossfade and every rule that is not a shape — progress by frame
timestamp, the frozen outgoing look, histories, jump-and-go, the guard, failure and context loss.
T4 adds the three shapes (Dissolve, Wipe, Dip) to the mix program, T5 adds Beat cut's wait. The
maths that can be pure is pure (`engine/src/transition.ts`: progress, weights, the beat wait) and
unit-tested with injected timestamps the way `scale.ts` is; the structural rules are proven in
the existing WebGL fake of `engine/src/index.test.ts`, which already counts look draws per frame
(`lookDraws`, `:131-140`) — B-08 forbade a test-only counter in the engine, and this needs none.

The web side starts in parallel with the engine (T1): the `transition` control and state field
in `shared/`, the choice with its `djv.transition` storage, and the applier — so a controller can
set the choice and see it mirrored before any pick uses it. Then the controller's section (T7)
and the panel's three controls (T8) are built on T1 alone. T6 joins the two halves: `active.ts`
passes the choice with every pick, applies Keep colour and the dip colour, and the screen tells
the engine whether its audio is live; T6 also holds the browser pixel proofs of the six types,
seeding the choice through `djv.transition` so they need neither UI. T9 closes with the
end-to-end proofs, the request allow-list and SD20's doc edits.

Rejected:

- **A third render pass into a mix target, then present.** One more full-screen pass and a third
  target for nothing: the present pass already samples a look target in canvas pixels
  (`index.ts:558-566`), which is the right space for SD14's blocks and edge (a 32nd of *the
  frame's* width).
- **Folding the mix into `PRESENT_FRAGMENT` behind a mode uniform.** It changes the program every
  frame outside a transition draws (D-14 settled that one), for no saving.
- **Snapshotting the outgoing look as a still.** Out of scope (spec: "a frozen still as the
  outgoing look"); SD11 keeps both looks live.
- **The choice in `active.ts`.** It is screen-page state that controllers mirror, like the dials;
  `active.ts` only reads it at a pick (SD5).
- **A test-only draw counter or `window` hook in the engine** (B-08, Out of scope): the fake GL
  already counts draws.

## Decisions this plan makes

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 | **Owner.** Does the Transition section carry a legend? SD20 says `docs/design/controller-style.md` is not changed, but the brief says, of section legends, "PROFILE, CAMERA, MAIN AUDIO, PALETTE, WAITING FOR APPROVAL. **No heading is added or removed**" (`controller-style.md:100-102`), and it allows sections without a legend ("the Primary colour key and VJ's status strip sit in sections without a legend"). | **Owner, 2026-11-23: (a).** A `TRANSITION` legend in the brief's legend style, and one line in the brief adding TRANSITION to that list (T9) — a change to `docs/design/`, so the owner's. **(b)** no visible legend, `aria-label="Transition"` only, brief untouched: the six named tiles, the "Duration" label and "Keep colour" read on their own. | Two readings with different screens; a `docs/design/` change is a hard stop. (a) matches every other section of tiles; (b) is what SD20's letter allows. The builder of T7 stops until this is answered. |
| PD2 | **Owner.** What is "the brief's toggle" for Keep colour? The brief's only toggle is the mode row, "a row of two keys" (DJ, VJ). | **Owner, 2026-11-23: (a).** One key labelled "Keep colour" that lights when on (`aria-pressed`, the brief's lit key: light surface, 3px edge, weight 800). **(b)** a row of two keys, "Keep colour: Off · On", the current one lit, like the mode row. | Both are the brief's parts; they look different. (a) is one target and reads as a switch on a desk; (b) copies the mode row exactly. Either meets 48×48. |
| PD3 | **Owner.** SD10's "the screen's audio is `ok`": the state the panel and `ScreenState.audio` show is the local session's (`capture.audio`, `web/src/capture/session.ts:15`), but while a remote main audio plays, the features the engine reads are the remote's (`web/src/remote/sources.ts:281-285`). | **Owner, 2026-11-23: the recommended reading.** The audio that feeds the looks: while `main.playing(now) === "remote"` and the remote source exists, the remote's (it is playing, so live); otherwise the local session's `audio === "ok"`. Before Start the local state is `idle`, so Beat cut cuts at once (AC26). The alternative: the local session's state alone, so a set on a remote main audio with no local input would always cut at once. | Two readings differ only when the main audio is remote and the local input is not `ok` — exactly the B-06 laptop-as-main-audio setup, where Beat cut matters. |
| PD4 | **Confirm.** The engine API. | `SetProfileOptions` gains `transition?: { kind: TransitionKind; durationMs: number; dipColour: string; seed: number }` (`TransitionKind` declared in `engine/`, the six names of SD19); no `transition` is Cut. `Engine` gains `setAudioOk(ok: boolean)` (default `false`). `setDials` and a same-key `setProfile` without `pick` go to the incoming (active) look. The promise of a pick resolves **in the frame that first draws the incoming look** — for Beat cut, the cut frame (SD16). | The engine never imports `shared/`; web's kind type is assignable to the engine's only while the names match, so `pnpm typecheck` catches drift where web maps one to the other. |
| PD5 | **Confirm.** The incoming look's dials at its first frame. | On a pick, the engine starts the incoming look at `profile.dials` (the engine's `Profile` has them), not at the engine-wide dials; web's `setDials(profile.dials)` after the swap (`web/src/profiles/active.ts:169`) stays and is then a no-op. | Exploration found today's swap frame draws the new program with the **old** dials for one frame (the promise resolves inside the rAF callback, `index.ts:315`, and `setDials` runs in the microtask after `draw`). SD3, AC7 and AC18 need per-look dials from the first frame; a Cut gets the fix too (one frame earlier, not a visible change). |
| PD6 | **Confirm.** Where the mix is drawn. | A separate `MIX_FRAGMENT` program in `engine/src/gl.ts`, linked at `createEngine` and on restore beside `present`, drawn **instead of** present during a transition: it samples the outgoing and incoming looks' latest targets by `gl_FragCoord.xy / uCanvas` as present does, with `uKind`, `uProgress`, `uDip`, `uSeed`. | See Approach, Rejected. The WebGL fake recognises present by `"uFrame"` in its source (`index.test.ts:54-61`); T3 extends that recognition to the mix program's own marker so no existing program-id expectation shifts (a fake change, not an assertion change). |
| PD7 | **Confirm.** Progress and the end. | At the frame that starts a transition, `t0` = that frame's rAF timestamp, `p = clamp((t − t0) / D, 0, 1)`; the first frame draws at `p = 0`. The frame whose `p` reaches 1 draws the mix at 1; the next frame draws the incoming look alone and the outgoing look's targets are deleted. | AC1's wording ("from the frame after `p` reaches 1"); AC15 follows, since the end is one frame interval after `t0 + D` at most. |
| PD8 | **Confirm.** Wipe's soft edge at the end. | New-look weight at `x` (fraction of the canvas width) = `clamp((p − x) / s, 0, 1)` with `s = min(0.04, 1 − p)`: left of `p − 0.04` new, right of `p` old, and at `p = 1` (`s = 0`) every `x ≤ 1` new. | AC3's three clauses cannot all hold at `p = 1` with a fixed 4% edge ending at `p`; the edge narrows only in the last 4% of the sweep. |
| PD9 | **Confirm.** Dissolve. | Blocks are `canvas width / 32` CSS-pixel-independent canvas pixels, square, counted from the bottom-left; each block's threshold is a hash of its block coordinates and `uSeed` in [0, 1); a block shows the new look while `p > threshold` (so none at `p = 0`, all at `p = 1`, and never back). `seed` is drawn with `Math.random()` per transition by web (T6), passed in PD4's options. | SD14; the threshold is fixed per transition because `seed` is. |
| PD10 | **Confirm.** Dip's mix and colour. | `p < 0.5`: `mix(old, dip, 2p)`; `p ≥ 0.5`: `mix(dip, new, 2p − 1)`. `dipColour` is the outgoing look's primary as it is on screen at the pick (`live[derivePrimary(activeProfile)]`, `web/src/profiles/active.ts`), captured by web when the pick is made. Between the pick and the start no colour can change: `recolour` is dropped while a pick is pending (`active.ts:236`), and so through Beat cut's wait. | SD12. The engine never reads `primary` (`engine/src/profile.ts:80-90`), so web must hand it the colour. |
| PD11 | **Confirm.** SD15 at a jump (SD2). | When a newer pick's look is ready during a transition, the running incoming look becomes the outgoing one (frozen at its dials and palette of that moment) and its own history goes on; the old outgoing look and its targets are deleted; the new incoming look's history is seeded (`copy`, `index.ts:357-374`, for a look with code, as today's swap) from the new outgoing look's latest output — what would be on screen with it fully on, which is what SD2 says the screen jumps to. A Cut picked during a transition ends it and cuts. | SD2 says the running transition ends "its incoming look fully on" in that frame; the mixed frame before the jump is in no target. |
| PD12 | **Confirm.** The re-pick of the active profile (SD18). | A pick whose program key equals the active one, with a type other than Cut, starts a transition whose outgoing look is a copy of the active look (same linked program, frozen dials and palette, its own target pair kept) and whose incoming look takes the new values and a fresh pair seeded as PD11. With Cut, today's value-only path (`index.ts:583-585`). | Today the same key is a value change applied at once; SD18 wants it to transition. |
| PD13 | **Confirm.** Program cache with two looks. | `remember` (`index.ts:267-276`) protects the outgoing look's key as well as the built-in, active and new. | Without it a ninth program could delete the outgoing look's program while it still draws. |
| PD14 | **Confirm.** The choice's types and storage. | `shared/src/control.ts`: `transitionKind = z.enum(["cut","crossfade","dissolve","wipe","beatCut","dip"])`, `transitionChoiceSchema = z.strictObject({ kind, duration: z.number().min(0.5).max(8), keepColour: z.boolean() })`, the `transition` control with `.refine` "names at least one" (the `dials` pattern, `:76-82`), and `transition: transitionChoiceSchema` **required** in `screenStateSchema`. `web/src/profiles/transition.ts`: `DEFAULT_TRANSITION` (Cut, 2.0, off), `loadTransition`/`saveTransition` under `djv.transition` validating with `transitionChoiceSchema` inside try/catch (the `web/src/control/remembered.ts:24-30, 74-99` pattern), `durationAt(x) = 0.5 × 16^x`, `positionOf(d)`, `formatDuration(d)` → `"2.0 s"`. | One schema for the message, the state and storage; a required field because every screen sends it from now on. |
| PD15 | **Confirm.** The applier's missing exhaustiveness. | `web/src/control/apply.ts:44-73` gains its `transition` case and a `default` that fails the type check when a control type is unhandled (`control satisfies never`). | Today an unhandled type is acknowledged and applied nowhere, silently, and `tsc` does not flag it; this item adds a type. |
| PD16 | **Confirm.** The duration fader's send rate. | The duration fader sends at most every 100 ms (B-19's `createSendThrottle` `minGapMs`), release at once; the two bank faders keep 20 ms. | B-19 PD6 sized 20 ms for two faders (≤ 100/s); a third at 20 ms held with both reaches 150/s, over the server's 120/s, which drops the excess quietly — possibly a release. 100 ms keeps all three ≤ 110/s; the duration only matters at the next pick. |
| PD17 | **Confirm.** The fader's readout. | `Fader` gains an optional `format?: (value: number) => string` used for its readout and `aria-valuetext`; absent, B-19's `Math.round(v × 100)`. The duration fader's value is the position `x`, so B-19 SD9's keys step `x` (SD6). | SD6 wants "2.0 s"; every existing fader is unchanged. |
| PD18 | **Confirm.** AC13's "structural check". | Proven in the gate's unit step by the WebGL fake (`engine/src/index.test.ts`): per frame, look-program draws and mix draws counted, during and outside a transition. | The browser gate has no draw counter and B-08 ruled one out; the fake already counts look draws (`:131-140`). |
| PD19 | **Confirm.** The panel's controls. | Three rows under the profile picker (`web/src/Panel.tsx:133-151`) with `Row` (`web/src/SourcePickers.tsx:48-64`): "transition" — a `<select data-testid="transition-kind">` of the six names; "duration" — `<input type="range" min 0 max 1 step 0.01 data-testid="transition-duration">` over `x` with a readout `transition-duration-readout`, disabled for Cut and Beat cut; "keep colour" — `<input type="checkbox" data-testid="transition-keep-colour">`. | SD8: the panel's existing style; the only checkbox today is External control's (`ExternalControl.tsx:169-178`). |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `shared/src/control.ts` | Modify | `transitionKind`, `transitionChoiceSchema`, the `transition` control, `ScreenState.transition` (PD14) — T1 |
| `shared/src/control.test.ts` | Modify | The control's examples and refusals; the state literal gains `transition` — T1 |
| `web/src/profiles/transition.ts` | Create, then Modify | The choice: default, storage, `durationAt`/`positionOf`/`formatDuration` (T1); its mapping to the engine's options (T6) |
| `web/src/profiles/transition.test.ts` | Create | Storage round trip, bad values, the curve — T1 |
| `web/src/control/apply.ts` | Modify | The `transition` case and the exhaustiveness `default` (PD15) — T1 |
| `web/src/control/apply.test.ts` | Modify | A `transition` control is applied in the next frame and acknowledged in its batch — T1 |
| `web/src/control/screen-link.ts` | Modify | `toScreenState` carries `transition` — T1 |
| `web/src/control/screen-link.test.ts`, `web/src/control/device-link.test.ts` | Modify | State literals gain `transition` — T1 |
| `server/src/control/channel.test.ts` | Modify | Invalid `transition` controls dropped with one `warn` naming the type — T1 |
| `server/test/control-device.int.test.ts`, `control-screen.int.test.ts`, `control-sender.int.test.ts`, `sync-schedule.int.test.ts` | Modify | State literals gain `transition` — T1 |
| `web/src/Screen.tsx` | Modify | The choice in `facts`, applied and saved (T1); passed to the panel (T8); to `active.ts`, audio-ok to the engine (T6) |
| `engine/src/index.ts` | Modify | `Look` value (T2); second look, mix, Crossfade and its rules (T3); shapes (T4); Beat cut and `setAudioOk` (T5) |
| `engine/src/look-state.ts` | Create | The `Look` type and its target-pair helpers, moved out of `index.ts` (T2) |
| `engine/src/transition.ts` | Create, then Modify | Pure maths: progress, Crossfade weight (T3); Dip and Wipe weights (T4); the beat wait (T5) |
| `engine/src/transition.test.ts` | Create, then Modify | Its unit tests, AC14's sweep — T3, T4, T5 |
| `engine/src/gl.ts` | Modify | `MIX_FRAGMENT` with Crossfade (T3), the three shapes (T4) |
| `engine/src/index.test.ts` | Modify | The fake recognises the mix program (T3); structural tests (T3, T4, T5) |
| `engine/src/shader.test.ts` | Modify | `MIX_FRAGMENT` text checks — T4 |
| `web/src/profiles/active.ts` | Modify | The choice with each pick, Keep colour, dip colour, seed — T6 |
| `web/src/profiles/active.test.ts` | Modify | AC16, AC17, AC18, AC20 at the unit level — T6 |
| `web/src/remote/sources.ts` | Modify | `audioOk(now)` (PD3) — T6 |
| `web/src/remote/sources.test.ts` | Modify | `audioOk` with local and remote main audio — T6 |
| `tests/browser/fixtures/profiles.ts` | Modify | A flat profile whose primary slot is not the colour it draws (AC4) — T6 |
| `tests/browser/transitions.spec.ts` | Create | Pixel proofs of the six types, Keep colour, re-pick, before Start — T6 |
| `web/src/control/Controller.tsx` | Modify | The Transition section in VJ mode under Profiles — T7 |
| `web/src/control/Fader.tsx` | Modify | `format` and `gapMs` props (PD16, PD17) — T7 |
| `web/src/control/controller.css` | Modify | The section's layout within the brief — T7 |
| `tests/browser/control-transition.spec.ts` | Create | AC21, AC23 on a paired `/control` — T7 |
| `tests/browser/control-look.spec.ts` | Modify | The type tiles join the lit-mark groups; the tab budget if exceeded — T7 |
| `web/src/Panel.tsx` | Modify | The three rows (PD19) — T8 |
| `tests/browser/transition-panel.spec.ts` | Create | The panel's controls, storage across a reload — T8 |
| `tests/browser/transition-e2e.spec.ts` | Create | AC22, AC24 across the panel and two controllers — T9 |
| `tests/browser/live.spec.ts` | Modify | The request allow-list run gains transitions (AC27) — T9 |
| `tests/browser/control-e2e.spec.ts` | Modify | The paired run's request check gains a transition control and a crossfade pick (AC27) — T9 |
| `docs/specs/phase-b-02-visual-profiles.md`, `docs/specs/phase-b-04-live-set-controls.md` | Modify | SD20's amendments to B-02 SD15, B-04 SD6, SD7, SD9 — T9 |
| `docs/design/architecture.md` | Modify | Two looks and a mix during a transition (`:71`, `:130-157`, `:421-423`) — T9 |
| `docs/design/controller-style.md` | Modify | TRANSITION in the legend list (PD1 (a), owner-approved) — T9 |
| `docs/custom-effects.md` | Modify | `lastFrame` during a transition (`:57`, `:89-101`) — T9 |
| `docs/runbooks/README.md` | Modify | "Human checks for transitions (B-09 H1, H2)" — T9 |

## Tasks

Each task is one vertical slice that leaves the system working, reviewable in one sitting:
about ≤400 changed source lines (tests do not count) across ≤10 files.

### T1 — The transition choice: message, state, storage, applier

- **Implements:** SD5, SD9, SD19, AC19, AC25
- **Expected output:** PD14's schemas in `shared/src/control.ts`; `web/src/profiles/transition.ts`
  (PD14); `Screen.tsx` holds the choice (loaded from `djv.transition` at mount, in `facts` so
  `toScreenState` reads it at frame start, React state for the panel later), and an applier dep
  `setTransition(partial)` that merges, saves and marks the state dirty; `apply.ts` handles
  `transition` (PD15); `toScreenState` emits `transition`. No pick uses the choice yet — every
  pick is still a Cut. About 140 source lines, 5 files.
  Tests: `shared/src/control.test.ts` — `transition` with each kind, with only `duration`, only
  `keepColour`; refused: an unknown kind, duration 0.49 and 8.01, no field, an extra key;
  `typeOf` names `transition`. `transition.test.ts` — missing key, `"{"`, a valid JSON of the
  wrong shape, a duration of 9, and a throwing `localStorage` all give Cut, 2.0, off; a saved
  choice round-trips; `durationAt(0) = 0.5`, `durationAt(0.5) = 2`, `durationAt(1) = 8`,
  `positionOf(durationAt(x)) ≈ x`; `formatDuration(2) = "2.0 s"` (AC19). `apply.test.ts` — a
  `transition` control reaches `setTransition` in the next frame, before the engine draws, and
  is acknowledged in that frame's batch (AC25). `channel.test.ts` — each refused shape above is
  dropped with exactly one `warn` whose `type` is `"transition"`, and the socket stays open
  (AC25).
- **Existing tests this makes untrue, amended here:** every full `ScreenState` literal gains
  `transition` — `shared/src/control.test.ts:21-38`; `web/src/control/screen-link.test.ts:51`
  and the exact `toEqual` at `:287-301`; `web/src/control/device-link.test.ts:20`;
  `server/test/control-device.int.test.ts:48`, `control-screen.int.test.ts:58`,
  `control-sender.int.test.ts:192`, `sync-schedule.int.test.ts:41-52`. The builder greps
  `storedPalette:` for any literal missed here.
- **Verification:** `pnpm run test --project unit shared/src/control.test.ts web/src/profiles/transition.test.ts web/src/control/apply.test.ts web/src/control/screen-link.test.ts web/src/control/device-link.test.ts server/src/control/channel.test.ts`;
  `pnpm run test --project integration server/test/control-device.int.test.ts server/test/control-screen.int.test.ts server/test/control-sender.int.test.ts server/test/sync-schedule.int.test.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** —
- **Autonomy note:** names, where the choice sits in `Screen.tsx`, and the test structure are the
  builder's. Stop if the schema cannot express "at least one field" with `.refine` and still
  keep `KNOWN_TYPES`' `.shape` read (`control.ts:252-255`), or if a server source file (not a
  test) needs a change — the spec says it needs none.

### T2 — The engine's one look becomes a value

- **Implements:** AC6, AC13
- **Expected output:** `engine/src/look-state.ts` with `Look = { profile, linked, dials,
  targets, current, fresh }` and its target-pair helpers (create, recreate on a size change
  with today's seeding for a look with code, delete); `index.ts`'s `draw` (`:487-568`) draws one
  `Look` through a `drawLook(look, features, timestamp)` step and then presents it; `setDials`
  writes the active look's `dials`; `swapped` becomes the look's `fresh`. `features`,
  `sourceTexture` (uploaded once per frame), the scaler and `present` stay engine-wide. No
  behaviour change. About 200 changed source lines, 2 files.
- **Verification:** `pnpm run test --project unit engine/src` — all 137 existing engine tests
  pass **unchanged** (`git diff --stat -- engine/src/*.test.ts` empty); then `bash
  scripts/check.sh` (the browser switch tests, `tests/browser/profiles.spec.ts:53` among them).
- **Depends on:** —
- **Autonomy note:** the split between `index.ts` and `look-state.ts` is the builder's. Stop if any
  existing engine test needs to change: that is a behaviour change, and AC6 forbids it.

### T3 — Two looks and the Crossfade

- **Implements:** SD2, SD3, SD11, SD13, SD15, SD16, SD17, SD18, AC1, AC7, AC8, AC9, AC10, AC11,
  AC12, AC13, AC14, AC15, AC16, AC18, AC20
- **Expected output:** `index.ts` holds `active` (the incoming look) and `outgoing: Look | null`
  plus `transition: { kind, durationMs, t0, dipColour, seed } | null`. `setProfile(profile, {
  pick, transition })` (PD4): when the new program is ready and the kind is not Cut, the frame
  starts a transition — the active look becomes `outgoing` (its dials and palette frozen), the new
  look gets PD5's dials, a fresh pair seeded per PD11, and `t0` — and the pick's promise resolves
  in that frame; a Cut keeps today's swap. Per frame in a transition: `drawLook(outgoing)`,
  `drawLook(active)`, then the mix (PD6) with `transition.ts`'s `progress` and Crossfade weight;
  at the end PD7. PD11's jump, PD12's re-pick, PD13's cache. The guard (`:479`) also returns
  while `outgoing` is set (SD11). Context loss sets `outgoing = transition = null` and the restore
  draws `active` alone (AC11). A resize or scale step recreates both pairs (SD17). `MIX_FRAGMENT`
  in `gl.ts` with Crossfade only; the other kinds reach the engine as Crossfade until T4 and T5 —
  web does not send them until T6. About 330 source lines, 4 files (`index.ts`, `look-state.ts`,
  `transition.ts`, `gl.ts`).
  Tests, in `engine/src/index.test.ts`'s fake: per frame of a transition, two look draws (one
  per program, outgoing first) and one mix draw; outside, one look draw and one present (AC13,
  PD18); `uProgress` = (t − t0) / D clamped, `0` on the first frame, the frame after `p = 1`
  draws one look and deletes the outgoing pair (AC1, PD7, Non-functional memory); at 10 frames a
  second a 0.5 s crossfade ends within 100 ms of its duration (AC15); `setDials` and a same-key
  colour change during a transition change only the incoming look's uniforms, the outgoing look's
  `uPalette` and dial-driven uniforms stay at their start values (AC7); each look's `uPrevious`
  is its own pair, and the incoming look's first frame reads a target seeded from the outgoing
  look's latest output (blit counted) with `uFeedback = 0` (AC8); a third pick ready mid-transition
  jumps — never three look draws in a frame — and a Cut mid-transition ends it (AC9, SD2); a
  failed link mid-transition leaves the transition running and draws on (AC10); context loss
  mid-transition, restore draws one look, the incoming profile's (AC11); a custom profile with
  slow frames through an 8 s transition is never bypassed, and `stats().fps` counts every
  transition frame (AC12); a transition already running keeps its kind and duration when another
  option is passed later (AC16, engine side); the pick's promise resolves on the transition's
  first frame (AC18, engine side); a same-key pick with Crossfade transitions, with Cut does not
  (AC20, PD12); a ninth program does not delete the outgoing look's (PD13).
  `transition.test.ts`: `progress` and the Crossfade weight; AC14's sweep — for every duration
  from 0.5 s to 8 s in 0.1 s steps and frame intervals up to 1/30 s, the weight changes by ≤ 0.14
  a frame.
- **Existing tests this makes untrue, amended here:** none of the assertions; the fake's
  present recognition (`engine/src/index.test.ts:54-61`) is extended to the mix program (PD6).
  `:385` ("draws no smear on the first frame after a swap") stays true — watch it.
- **Verification:** `pnpm run test --project unit engine/src`; then `bash scripts/check.sh`.
- **Depends on:** T2
- **Autonomy note:** internal structure and names are the builder's. Stop if the task passes ~400
  source lines (split the jump and re-pick into a T3b), if an existing assertion in
  `index.test.ts` must change, or if a Cut's behaviour moves in any way a test can see beyond
  PD5's one frame.

### T4 — Dissolve, Wipe and Dip

- **Implements:** SD1, SD12, SD13, SD14, AC2, AC3, AC4, AC14
- **Expected output:** `MIX_FRAGMENT` branches on `uKind` for Dissolve (PD9), Wipe (PD8) and Dip
  (PD10, `uDip` from `dipColour`, parsed once at the start with the existing hex parsing of
  `profile.ts`); `transition.ts` gains the Dip and Wipe weights as pure functions with the same
  formulas. About 90 source lines, 3 files (`gl.ts`, `transition.ts`, `index.ts`).
  Tests: `transition.test.ts` — Dip: weight to colour 0→1 over `p` 0→0.5, to the new look over
  0.5→1, exactly the colour at 0.5; AC14's sweep for Dip: ≤ 0.14 a frame, and the luma change the
  weight alone causes between any two colours stays below `FLASH_MAX`; Wipe: PD8's three
  clauses at `p` = 0, 0.3, 0.97, 1 (AC3). `shader.test.ts` — `MIX_FRAGMENT` names every kind,
  uses `uCanvas` for the block and edge, and holds no `discard`. `index.test.ts` — `uKind`,
  `uSeed` and `uDip` set per transition; `uDip` is the colour passed at the start, unchanged by a
  colour change during the dip (AC4, engine side). The pixel proofs of AC2–AC4 are T6's.
- **Verification:** `pnpm run test --project unit engine/src`; then `bash scripts/check.sh`.
- **Depends on:** T3
- **Autonomy note:** the GLSL hash is the builder's, as long as the threshold is in [0, 1) and
  fixed per `seed`. Stop if a shape cannot be drawn in the mix pass alone.

### T5 — Beat cut

- **Implements:** SD10, AC5, AC26
- **Expected output:** `transition.ts`: `createBeatWait(readyAt)` with `cut(t, beat,
  audioOk): boolean` — true on the first call whose `beat ≥ 0.5` after one below 0.5, at
  `t − readyAt ≥ 2000`, or at once while `!audioOk`; it tracks the previous frame's `beat` (a
  `beat` already ≥ 0.5 when ready needs a fall first). `index.ts`: `setAudioOk(ok)` (PD4,
  default `false`); a Beat cut's look, once ready, waits in `pending` (the old look keeps
  drawing, the promise unresolved) and cuts on the frame `cut` says so, with no transition after
  (a cut); a newer pick during the wait supersedes it (`ProfileSupersededError`, SD2). `beat` is
  `features.beat`, before the reactivity dial. About 70 source lines, 2 files.
  Tests: `transition.test.ts` — a rise at 300 ms cuts at 300 ms; no rise cuts at 2000 ms;
  `audioOk` false cuts at once; `beat` held at 1 from ready does not cut until it falls and
  rises; 0.49 → 0.5 is a rise (AC5). `index.test.ts` — the old program draws through the wait,
  the new program draws first on the cut frame, the promise resolves on that frame; reactivity
  0 does not change it; `setAudioOk(false)` (the default, before Start) cuts on the ready frame
  (AC26, engine side); a pick during the wait rejects the waiting one.
- **Verification:** `pnpm run test --project unit engine/src`; then `bash scripts/check.sh`.
- **Depends on:** T4
- **Autonomy note:** naming is the builder's. Stop if waiting in `pending` conflicts with the
  guard's rule (`:479`) in a way that changes the guard outside a Beat cut.

### T6 — Picks use the choice; Keep colour; the pixel proofs

- **Implements:** SD3, SD4, SD12, SD16, SD18, AC1, AC2, AC3, AC4, AC5, AC16, AC17, AC18, AC20, AC26
- **Expected output:** `active.ts` reads the current choice through a new dep
  (`transition(): TransitionChoice`) at the moment of each pick (SD5), and passes PD4's options:
  `kind`, `duration × 1000`, `dipColour` (PD10), `seed` (`Math.random()`). With Keep colour on,
  the profile handed to the engine has `palette[derivePrimary(profile)]` set to the outgoing
  primary as on screen (`live[derivePrimary(activeProfile)]`); after the swap `live` is that
  palette and `storedPalette` the profile's own, so `resetColour` restores the stored colour
  (SD4). `sources.ts` gains `audioOk(now)` (PD3); `Screen.tsx` calls `engine.setAudioOk` with it
  each frame beside `setFeatures`, and passes the choice to `active.ts`. About 110 source lines,
  4 files.
  Tests: `active.test.ts` — the options passed carry the choice current at the pick, not one set
  after it (AC16); Keep colour on: the state's `palette` has the carried colour in the incoming
  primary slot, `storedPalette` does not, a live edit of the outgoing primary is what carries,
  Reset restores the stored colour, `api` sees no write (AC17); off: today's stored palette; the
  state names the new profile only after the engine's promise resolves (AC18); a re-pick of the
  active profile passes the current kind and the profile's starting dials and stored palette,
  Keep colour applying (AC20); the dip colour is the live primary at the pick. `sources.test.ts`
  — `audioOk` is the local state's `ok` without a remote, `true` while a remote plays, `false`
  before Start.
  `tests/browser/transitions.spec.ts` (the choice seeded with `addInitScript` setting
  `djv.transition`; two flat profiles, `red()` and `blue()`; `pixels()` read every frame with
  the frame's timestamp): Crossfade 2 s — the centre colour moves monotonically from red to blue,
  an intermediate frame is near `mix(red, blue, p)` for its `p`, and it is blue from `t0 + 2 s`
  plus one frame (AC1); Dissolve 2 s — at each sample every block centre is red or blue
  within tolerance, the blue count never falls and ends at all 32 × rows (AC2); Wipe 2 s — at each
  sample, pixels left of `p − 0.04` blue, right of `p` red (AC3); Dip 8 s from a profile whose
  primary slot is a vivid green it does not draw — the frame nearest `p = 0.5` is green within
  the gate's tolerance, and a colour sent mid-dip does not change it (AC4); Beat cut before
  Start cuts at once, with no intermediate frame (AC5, AC26); Crossfade before Start runs over
  the idle look (AC26); Keep colour on with a Cut carries a live primary (AC17); re-pick with
  Crossfade fades back to the stored palette (AC20); no frame of any type is black (min luma ≥ 2,
  the `profiles.spec.ts:53` rule).
- **Existing tests this makes untrue, amended here:** none expected —
  `active.test.ts:353-359` (a re-pick discards edits) stays true with Keep colour off, and
  `active.test.ts`'s fake `setProfile` accepts the extra options. Watch
  `tests/browser/profiles.spec.ts:53` and `control.spec.ts:76` (Cut is the default).
- **Verification:** `pnpm run test --project unit web/src/profiles/active.test.ts web/src/remote/sources.test.ts`;
  `pnpm test:browser tests/browser/transitions.spec.ts tests/browser/profiles.spec.ts`; then
  `bash scripts/check.sh`.
- **Depends on:** T5, T8
- **Autonomy note:** sampling and tolerances in the browser test are the builder's, using
  `near` (`tests/browser/helpers.ts:198`) and the existing colour tolerance. Stop if a pixel
  proof can only pass with a wall-clock bound (B-08), or if AC5's beat rise cannot be produced
  in the browser — then AC5's rise rests on T5's unit tests and H2, said in the evidence, not
  worked around.

### T7 — The Transition section on `/control`

- **Implements:** SD6, SD7, AC21, AC23
- **Expected output:** in `Controller.tsx`, between the Profiles section and the Camera section
  (`:206`/`:208`), a section rendered only when `mode === "vj"`, `aria-label="Transition"`,
  legend per PD1: six `djv-key djv-tile` keys (`transition-<kind>`, `aria-pressed` on the
  current kind, `disabled={locked}`, sending `{ type: "transition", kind }`), a horizontal
  `Fader` (`transition-duration`, label "Duration", value `positionOf(state.transition.duration)`,
  `format` → `formatDuration(durationAt(x))`, `gapMs` 100, disabled while locked or the kind is
  `cut` or `beatCut`, sending `{ type: "transition", duration: durationAt(x) }`), and Keep colour
  per PD2 (`transition-keep-colour`, sending `{ type: "transition", keepColour }`). `Fader.tsx`
  gains `format` and `gapMs` (PD16, PD17). The section's CSS uses the brief's existing classes;
  `controller.css` gains only layout. About 120 source lines, 3 files.
  Tests: `tests/browser/control-transition.spec.ts` on a paired `/control`: VJ mode shows the
  section directly after `Profiles` in document order, Cut pressed, the fader reading "2.0 s" and
  `aria-disabled`; tapping Crossfade presses it, enables the fader and the screen's state reads
  `crossfade`; the fader by keys: Home reads "0.5 s", End "8.0 s", from the middle "2.0 s", and
  the screen's duration follows (AC21); Beat cut disables it again; Keep colour toggles and the
  screen's state follows; at 320×568 and 568×320 every target in the section ≥ 48×48 and
  `scrollWidth ≤ clientWidth` (AC21); offline (`dropNetwork`, `tests/browser/sockets.ts`) the
  tiles, fader and toggle are disabled and a tap sends no `transition` frame (AC23); DJ mode
  shows none of them.
- **Existing tests this makes untrue, amended here:** `tests/browser/control-look.spec.ts:298`
  (`tabThrough(phone, 80)` must reach `dial-reactivity`) — VJ mode gains eight tab stops; raise
  the budget only if the run shows it is exceeded, and say so. `control-look.spec.ts:217`
  (AC20's lit-mark groups) gains the transition tiles as a group (an addition).
  `control-layout.spec.ts:287` (AC15's fit, five sizes, DJ and VJ) now covers the section — it
  must pass unchanged.
- **Verification:** `pnpm test:browser tests/browser/control-transition.spec.ts tests/browser/control-look.spec.ts tests/browser/control-layout.spec.ts tests/browser/control-fader.spec.ts`;
  `pnpm run test --project unit tests/meta/control-look.test.ts web/src/control`; then `bash
  scripts/check.sh`.
- **Depends on:** T1, and PD1 and PD2 answered
- **Autonomy note:** markup and layout within the brief are the builder's. Stop if the section
  needs a colour, size or part the brief does not have (that is a `docs/design/` change), or if a
  `control-fader.spec.ts` case changes.

### T8 — The panel's three controls

- **Implements:** SD8, AC19, AC24
- **Expected output:** PD19's three rows in `Panel.tsx`, fed from the choice `Screen.tsx` holds
  (T1) and changing it through the same `setTransition` the applier uses, so a panel change is
  saved, mirrored in the next state push and seen by every controller; the duration readout uses
  `formatDuration`; disabled for Cut and Beat cut. About 60 source lines, 2 files.
  Tests: `tests/browser/transition-panel.spec.ts` — the panel shows Cut, 2.0 s, off on a fresh
  page; choosing Dissolve, sliding to the end ("8.0 s") and ticking Keep colour, then reloading,
  shows the same three (AC19); a `djv.transition` of `{"kind":"zoom"}` loads as Cut, 2.0 s, off
  (AC19); the slider is disabled for Cut and Beat cut; a controller paired to the page
  (`deviceClient`, `tests/browser/control-server.ts:155`) reads each panel change in the next
  `state` (AC24, panel to controller).
- **Verification:** `pnpm test:browser tests/browser/transition-panel.spec.ts tests/browser/live.spec.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** T1
- **Autonomy note:** row order and wording beyond PD19 are the builder's. Stop if the panel's key
  handling (`Screen.tsx:358`: `o`, `s`, `f` while a range or checkbox has focus) needs to change —
  that is outside this item.

### T9 — End to end, the request allow-list, the docs

- **Implements:** SD20, AC22, AC24, AC27
- **Expected output:** `tests/browser/transition-e2e.spec.ts` — two controllers, one in DJ mode
  and one in VJ: the VJ one sets Crossfade; the DJ one shows no transition control and its tile
  tap switches the screen with a crossfade (an intermediate frame) (AC22); a change on the VJ
  controller shows in the panel and on the other controller, a change in the panel shows on both
  (AC24). `live.spec.ts:543` and `control-e2e.spec.ts:341` run with a crossfade and a dip picked
  and allow nothing new (AC27). Docs, as SD20 approves: B-02 SD15
  (`phase-b-02-visual-profiles.md:105-108`) and B-04 SD6 (`phase-b-04-live-set-controls.md:72-75`)
  read "a pick uses the current transition; Cut is SD15's hard cut"; B-04 SD7 (`:76-79`) and
  SD9 (`:87-95`) name B-09 SD4 and SD7; `architecture.md` — the `engine/` row (`:71`),
  "Switching" (`:147-157`) and render scale's targets (`:421-423`) describe two looks and a mix
  during a transition; `custom-effects.md:57` and `:89-101` — during a transition `lastFrame` is
  the effect's own look's previous output, never the mixed frame, and the first frame of an
  incoming look reads the frame on screen at the start (SD15); `controller-style.md` — only
  under PD1 (a), TRANSITION in the legend list; `docs/runbooks/README.md` — "Human checks for
  transitions (B-09 H1, H2)" with the steps of spec Verification 2–5. About 0 source lines;
  4–6 doc files.
- **Verification:** `pnpm test:browser tests/browser/transition-e2e.spec.ts tests/browser/live.spec.ts tests/browser/control-e2e.spec.ts`;
  `git diff --stat main...HEAD -- server/src` prints nothing (no server source change, spec §6);
  then `bash scripts/check.sh` (its format step covers the docs).
- **Depends on:** T6, T7
- **Autonomy note:** doc wording is the builder's within SD20. Stop if a doc edit beyond SD20's
  list (and PD1 (a)) seems needed, or if any request outside `docs/invariants.md:27`'s list shows.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1, T2 | T1: `shared/src/control.ts`, `control.test.ts`, `web/src/profiles/transition.ts`, `transition.test.ts`, `web/src/control/apply.ts`, `apply.test.ts`, `screen-link.ts`, `screen-link.test.ts`, `device-link.test.ts`, `web/src/Screen.tsx`, `server/src/control/channel.test.ts`, four `server/test/*.int.test.ts`. T2: `engine/src/index.ts`, `engine/src/look-state.ts` |
| 2 | T3, T7, T8 | T3: `engine/src/index.ts`, `look-state.ts`, `transition.ts`, `transition.test.ts`, `gl.ts`, `index.test.ts`. T7: `web/src/control/Controller.tsx`, `Fader.tsx`, `controller.css`, `tests/browser/control-transition.spec.ts`, `control-look.spec.ts`. T8: `web/src/Panel.tsx`, `web/src/Screen.tsx`, `tests/browser/transition-panel.spec.ts` |
| 3 | T4 | `engine/src/gl.ts`, `transition.ts`, `transition.test.ts`, `index.ts`, `index.test.ts`, `shader.test.ts` |
| 4 | T5 | `engine/src/transition.ts`, `transition.test.ts`, `index.ts`, `index.test.ts` |
| 5 | T6 | `web/src/profiles/active.ts`, `active.test.ts`, `web/src/profiles/transition.ts`, `web/src/remote/sources.ts`, `sources.test.ts`, `web/src/Screen.tsx`, `tests/browser/fixtures/profiles.ts`, `tests/browser/transitions.spec.ts` |
| 6 | T9 | `tests/browser/transition-e2e.spec.ts`, `live.spec.ts`, `control-e2e.spec.ts`, the SD20 docs, `docs/runbooks/README.md` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph
docs/plans/phase-b-09-transitions.md` prints the groups the `Depends on` fields actually give.
T7 also waits for PD1 and PD2.

## Data changes

None in the database: no table, no migration, no profile field, no `formatVersion` change. One
browser-storage key on the screen page, `djv.transition` = `{ kind, duration, keepColour }`,
validated on read with `transitionChoiceSchema` (T1); a missing or bad value gives Cut, 2.0 s,
off. Removing the feature leaves an unread key; nothing to migrate.

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| **Two looks double the GPU work** on the owner's screen machine; the heaviest pair may drop below the refresh rate (AC28). | Measured only at H1 (SD11: the gate is structural). The scaler steps down after ~2 s above budget as for any load; if H1 fails, the owner decides (a spec question, not a build fix). |
| `engine/src/index.ts` is 648 lines and T3 changes its core loop; a regression in the Cut path would be the costliest kind. | T2 first, a pure refactor proven by 137 unchanged tests; T3 may not change an existing assertion (its stop); `tests/browser/profiles.spec.ts:53` (no black frame across a pick) runs in every gate. |
| The fake GL numbers programs by creation order and recognises present by `"uFrame"` (`index.test.ts:54-61`); a mix program linked at `createEngine` would shift every program-id expectation. | PD6: the fake recognises the mix program by its own marker, in T3, without touching an assertion. |
| Browser pixel proofs over time under SwiftShader: low and uneven frame rates make "the frame at `p = 0.5`" approximate. | Each sample is judged by its own frame timestamp, not wall time; AC4's dip runs 8 s so the nearest frame is close to 0.5; the maths is proven exactly in `transition.test.ts`. |
| AC5's beat rise cannot be scripted through the fake audio input in the browser. | AC5 rests on T5's unit tests (pure and fake GL), the not-`ok` branch on the browser (AC26), and H2 by eye. T6's autonomy note says so. |
| Three faders held at once would exceed the server's 120 controls a second, and the excess is dropped silently (`server/src/control/channel.ts:42-46`). | PD16. |
| PD1–PD3 block T7 (PD1, PD2) and T6 (PD3). | T1–T5 and T8 do not depend on them; the owner can answer at the audit. |
| Found in exploration, not this item's: a colour sent while a pick links is acknowledged and never applied (`web/src/profiles/active.ts:236` with `web/src/control/apply.ts:53-55,74`); a context loss during a pending pick shows "could not be prepared" (`engine/src/index.ts:420`, `active.ts:163`); the screen page drops a bad relayed message with no log (`web/src/control/screen-link.ts:137-138`). | Not fixed here (no "while I was here"). Beat cut's wait lengthens the first window by up to 2 s. The owner may register them as defects. |
| The spec's line refs predate PR #14's merge; `controlSchema` is now at `shared/src/control.ts:74-89`. | This plan cites `69a34ef`. |

## Human steps

- **H0 — before `/audit`.** Commit the working copy's spec (`docs/specs/phase-b-09-transitions.md`)
  and this plan on a docs branch, as for B-12 and B-19, apart from the unrelated working-copy
  changes on `fix/d-18-gate-ceiling` (`ci.yml`, `playwright.config.ts`, the register, the
  backlog, Silent Film). `/build` needs a clean tree.
- **PD1, PD2, PD3** — the owner's answers, recorded in the table above; T7 waits for PD1 and PD2,
  T6 for PD3.
- **H1 — after T9** (AC28; spec Verification 2–3). On the owner's screen machine: `pnpm start`,
  Start, `o`; pair a phone in VJ mode; Crossfade, 8 s; pick the heaviest profile, then the second
  heaviest; during the fade the overlay's p95 ≤ 50 ms and the frame rate not below the display's
  refresh rate.
- **H2 — after T9** (AC29; spec Verification 4–5). From the phone in VJ mode, all six types at
  0.5 s and at 4 s; Dip with a vivid live primary set first; Keep colour on with a Cut and a
  Crossfade, the primary carries, then Reset restores it; no blank or black frame; Beat cut on
  music cuts on a beat. Reload the screen page: the panel and the phone show the same choice.
  Recorded under `docs/runbooks/rehearsals/` as for B-06.
- Pushing, the PR and the merge are the owner's.

## Out of scope for this plan

- Everything under the spec's Out of scope.
- AC28 and AC29 have no task: they are the owner's checks, H1 and H2.
- The three defects found in exploration (Risks): reported, not fixed.
- `server/src/` source: the new control and state field need only `shared/` (spec In scope;
  `deviceMessageSchema` spreads `controlSchema.options`, `shared/src/control.ts:108`); T9 checks
  the diff is empty.
- `docs/invariants.md`: no row changes (SD20); AC27 extends the existing checks that enforce row
  B-01, B-06.

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

Audit notes: T1 touches 15 files (5 source, 10 test), over the 10-file guide; accepted as one
task, because the `ScreenState` literals cannot be split from the required schema field without
breaking the type check, and its source change is ~140 lines.

Owner rows answered at the audit: PD1 (a), PD2 (a), PD3 as recommended. PD4–PD19 confirmed as
written, including PD5's one-frame change to a Cut and PD16's 100 ms duration-fader gap.

Audited by: Martijn Boot  Date: 2026-11-23
