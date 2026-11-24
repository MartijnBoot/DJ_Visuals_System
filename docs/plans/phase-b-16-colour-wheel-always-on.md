# Plan: b-16 — Primary colour wheel always on the controller

Spec: [docs/specs/phase-b-16-colour-wheel-always-on.md](../specs/phase-b-16-colour-wheel-always-on.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001](../adr/0001-setup-decision-record.md) — rendering stays on the screen
machine and a live colour is never saved (B-04 AC22, kept by AC14); [0002](../adr/0002-remote-input-over-the-lan.md)
— no route, socket or message changes, the controller still speaks only on its device socket.
New dependencies: none.

Line references are to `main` at `dc05fde`. The spec is read from the uncommitted working copy
of 2026-11-24 (Human steps, H0).

## Approach

The send budget comes first because it is the one piece of new logic with a rule that can be
proven exactly, and every later task sends through it. T1 adds `web/src/control/send-budget.ts`,
a page-wide queue between the controls and `link.send` (`web/src/control/device-link.ts:146-158`),
with the browser APIs injected the way `createSendThrottle` takes them
(`web/src/control/wheel-math.ts:64-118`). Each control's own throttle stays as it is (SD4), so a
drag alone passes straight through, and only several drags together ever wait. `device-link.ts`
does not change, so its `seq` and round-trip rules and their tests stay as they are (SD11). T2
then turns the wheel from a modal `<dialog>` (`web/src/control/Wheel.tsx:75-77, 103-110`) into a
pinned section in the controller's grid (`web/src/control/controller.css:76-88`). It reuses the
existing `Fader` for brightness, standing vertical beside the disc, and removes the Primary colour
key and Done. It is split in two (audit, 2026-11-24): T2a changes the source and amends every
browser test the removal of the dialog makes untrue; T2b adds the measured layout tests (AC1–AC6)
and fixes the stylesheet only where a measurement fails. T3 adds the wheel's behaviour as a long-lived control: it follows the screen's colour
except while held (SD7), lets go of a drag, and shows the locked look (SD8). The disc's rule is
the fader's rule (`web/src/control/Fader.tsx:43-60`). T4 adds VJ mode's target: the swatch mark,
`aria-pressed`, and SD3's returns to the primary slot. T5 proves AC7 and AC8 together on the real
page with two and three pointers. T6 updates the style brief and its mockups (SD6).

Rejected:
- **The budget inside `device-link.ts`.** `send` returns the `seq` synchronously, and
  `device-link.test.ts:229-245, 372` depend on that. A queued value has no `seq` until it goes
  out. A separate module keeps that contract and the round-trip readout (SD11) as they are.
- **A budget that replaces per message type.** Two dials both send `dials`, so they would replace
  each other. The key is the control (PD5).
- **Keeping the dialog and making it non-modal (`show()`).** It would still float over the page
  and cover the scrolling area. SD1 and SD2 pin it in the grid.
- **A second fader component for the vertical brightness fader.** `Fader` already does vertical.
  Only its stylesheet is tied to the bank (`controller.css:294-342`), and PD9 frees it.

## Decisions this plan makes

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 | **Owner.** SD3 and AC11 say the wheel goes back to the primary slot "when a profile is picked (any profile, the active one included)". Picked by whom? This controller can see its own pick tap. It sees another controller's pick only when `state.activeId` changes, and it cannot see another controller re-picking the active profile at all. | **Owner, 2026-11-24: (a)** — "a profile picked by the VJ or the DJ", on any controller. The wheel goes back to the primary slot on this controller's own pick tap, any profile, the active one included. It also goes back when `state.activeId` changes, whoever picked: a new profile's slot 3 is not the colour that was being edited. **(b)** Only this controller's own pick tap. A VJ on slot 3 then stays on slot 3 after another controller switches profiles, as long as the new palette has a slot 3. | Two readings with different screens. (a) never leaves the wheel on a slot of a palette the VJ did not choose. Limit, accepted with (a): another controller's re-pick of the **active** profile does not change `activeId`, so it does not move this controller's wheel; detecting it would need a new state field, which the spec rules out (Out of scope: no change to `shared/`). |
| PD2 | **Owner.** Is the primary swatch marked as the target when the wheel is on the primary slot without a tap (on entering VJ mode, after a reload, after a return under SD3)? AC10 speaks only of "the tapped swatch". | **Owner, 2026-11-24: (a).** In VJ mode exactly one swatch always carries the target mark and `aria-pressed="true"`: the wheel's slot, so the primary swatch by default. It then shows both marks, the primary mark and the target mark. **(b)** Only a tapped swatch is marked. After any return to the primary slot no swatch is marked, although the wheel aims at it. | Different screens. (a) always shows where the wheel aims. Under (b), tapping the primary swatch and not tapping it aim at the same slot but look different. |
| PD3 | **Confirm.** Where the budget lives and its shape. | `web/src/control/send-budget.ts`: `createSendBudget({ now, setTimer, clearTimer })` returns `{ value(key, put), tap(put), drop() }`. `put` is a closure that calls `link.send(...)` and reports whether the message went out. `Controller.tsx` builds one budget beside `link` and routes **every** send through it: the taps, the approvals, the bank's dials, the duration fader, the wheel's `colour` and `resetColour`. It drops the budget when `link.view().locked` turns true (through `link.subscribe`). Inside the budget, a `put` that returns false (the link is no longer live) drops everything waiting. | SD4 lets the plan choose. Two guards mean a lock between a render and its effect still sends nothing late (SD8, AC15). |
| PD4 | **Confirm.** The budget's schedule. | One queue in order of arrival. A value whose control already waits **replaces the waiting value in place**, keeping its turn. A tap is appended and never replaced. The head goes out as soon as two things hold: at least 10 ms have passed since the previous send **returned**, and fewer than 100 sends fall in the last 1000 ms (the times of the last 100 sends are kept). Otherwise one `setTimer` is set for the earliest time the head may go. An empty queue and a free budget send at once, synchronously. | Keeping the turn on replace is the fairness of SD4: a waiting control goes out within as many turns as there are controls waiting, so a fast one never starves a slow one. Measuring the gap from the moment `put` returns means a stamp taken inside `WebSocket.send` (T5) can never show less than 10 ms. A single drag (16 or 20 ms apart) never waits, so it sends as it does today (AC8). |
| PD5 | **Confirm.** What counts as "one control" for replacement. | Keys: `dials:recognisability`, `dials:reactivity`, `transition:duration`, and `colour:<slot>` for the wheel. The disc and the brightness fader together are **one** control per slot. Every other send is a tap. | The disc and the brightness fader both send the slot's whole colour, built from the wheel's one HSV. The newer value already holds the newest part of the other. If they had separate keys, an older colour could go out last and undo a brightness change. Keying by slot also keeps a waiting colour for slot 1 apart from a new target's colour. |
| PD6 | **Confirm.** SD7's "held" and "already produce". | The wheel is held while its disc **or** its brightness fader is held. `Fader` gains an optional `onHold?(held: boolean)`. While the wheel is held it ignores the screen's reports for display. Otherwise it shows `follow(ours, screen)`, a new pure function in `wheel-math.ts`: it keeps `ours` when `hsvToHex(ours)` equals the screen's colour without regard to case (the schema allows upper case, `shared/src/control.ts:35`), and returns `hexToHsv(screen)` otherwise. | While the brightness fader is dragged, the screen echoes older values. Adopting them would lose hue at low brightness and pull the hue and saturation that the next brightness value is built from. |
| PD7 | **Confirm.** Several pointers on the disc. | One pointer holds the disc and a second is ignored, as for a fader (B-19 SD7, `web/src/control/fader.ts:64-67`). | Today any pointer the canvas captures moves the marker (`Wheel.tsx:122-129`). A second finger would make the marker jump between fingers. |
| PD8 | **Confirm.** The disc's size (SD5). | The colour block sets `--disc: clamp(150px, 31.25vmin, 240px)`. The disc is `--disc` square, and the brightness fader's height is `--disc`. The canvas bitmap stays 240×240 (`Wheel.tsx:31`), scaled by CSS. Pointer maths already scales by the box (`:89-90`). | One rule gives 150 at 320×568, 320×640 and 568×320, and 240 at 768×1024 and 1024×768 (AC3), the same in both modes. |
| PD9 | **Confirm.** A vertical fader outside the bank. | `Fader` adds `is-vertical` to its `.djv-fader` root when `orientation="vertical"`. The vertical rules (`controller.css:294-342`) select `.djv-fader.is-vertical` instead of `[data-arrangement="vertical"] .djv-bank .djv-fader`. The bank's faders already get `orientation={arrangement}` (`web/src/control/FaderBank.tsx:37`), so they look exactly as before. The wheel's brightness fader is always `orientation="vertical"`. | The brightness fader stands vertically in both arrangements (SD1, SD2). Today the vertical look exists only inside the bank in the vertical arrangement. |
| PD10 | **Confirm.** The page grid. | Horizontal: the rows `bar` / `scroll` / `colour` / `bank`. Vertical: `"bar bar bar" auto "scroll colour bank" minmax(0, 1fr) / minmax(0, 1fr) auto auto`. The block is a sibling of `.djv-scroll` and `.djv-bank`, between them in the DOM, so the focus order is bar, scrolling area, block, bank (SD9). It renders only once `state` exists, as the bank does (`Controller.tsx:375`). | AC2's places and SD9's focus order from DOM order alone, with no `tabindex`. |
| PD11 | **Confirm.** A change of arrangement during a drag (AC16, B-19 SD9). | `Wheel` takes `arrangement`. When it changes, the disc lets go (its throttle `drop()`, the hold cleared). `Fader` gains an optional `layout?: string` that joins `vertical` in its let-go effect (`Fader.tsx:57-60`). The wheel passes `arrangement` there, so a brightness drag lets go too. The bank's faders pass nothing and behave as before. | The brightness fader never changes axis, so the existing axis rule would not catch the move. Re-mounting it with a `key` instead would leave its throttle's pending frame running and sending (no unmount clean-up today). |
| PD12 | **Confirm.** The block's locked look (SD8). | As the bank does it (`FaderBank.tsx:27-33`): the label's place shows the "Locked" tag (`djv-locked-tag`, test id `wheel-locked`) instead of the label. The disc is covered by the locked hatching (the bank's 135° stripes, at a strength the brief sets, T6). The brightness fader takes its existing locked look. Reset takes the disabled key's look. Nothing moves. | The brief's existing locked parts. "Never colour alone": the word and the hatching. |
| PD13 | **Confirm.** The block's parts at 320 CSS px wide. | 320 − 16 (padding) − 150 (disc) − 6 − 56 (fader) − 6 leaves an 86 px column. In it: the label (12 px legend, it may wrap to two lines), the "on screen" swatch with the hex value as its caption, the "stored" swatch with "stored", and Reset. The pair swatches shrink from 56 to 24 px; they are not targets. In the vertical column: label and hex in one row under the disc and fader, then the pair and Reset in one row. The builder may arrange them differently if AC5 and AC6 hold. | Today's pair (two 56 px swatches with captions, `controller.css:569-581`) does not fit 86 px wide and 150 px tall together with Reset. |
| PD14 | **Confirm.** "The target slot is no longer in the palette". | The target is reset to the primary slot (state set to null) as soon as a state arrives without that slot, so a palette that later grows again does not bring the old target back. | SD3 says the wheel "goes back", which is a one-way event, not a derived value. |
| PD15 | **Confirm.** B-19's four-fader test with the colour block (`tests/browser/control-layout.spec.ts:318`). | It keeps the bank at no more than half the viewport, the sliders at least 180 px long, the bank in view, and adds the colour block in view. At 568×320 it no longer runs `fitProblems` on the scrolling area: about 70 px of width with four faders is B-18's to resolve (SD2, Out of scope). At 320×568 `fitProblems` still runs. | That test checks a budget the spec has knowingly spent. Leaving the check in would fail the gate on a case the spec gives to B-18. Two faders, the shipped page, stay under AC6 at all five sizes. |
| PD16 | **Confirm.** How AC8 is measured in the browser. | A new `recordSends(context)` in `tests/browser/sockets.ts`: an init script that wraps `WebSocket.prototype.send` and records `performance.now()` and the message's `type` for each frame. The test asserts that consecutive gaps are ≥ 10 ms and that every 1000 ms window holds ≤ 100 frames. | Playwright's `framesent` is stamped on the test's side. PD4 measures the gap from the end of `put`, so the stamp inside `send` is exact, with no tolerance. Under load the sends only get sparser, so the check is not a timing test in B-08's sense. |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `web/src/control/send-budget.ts` | Create | The page-wide send budget (SD4, PD3, PD4) — T1 |
| `web/src/control/send-budget.test.ts` | Create | Its rules with a fake clock and timer — T1 |
| `web/src/control/Controller.tsx` | Modify | Every send through the budget (T1); the block in the grid, Primary colour key gone, target state (T2a); SD3's returns (T4) |
| `web/src/control/Wheel.tsx` | Modify | Dialog to pinned section, label, vertical brightness, no Done (T2a); follow, hold, let-go, locked look (T3) |
| `web/src/control/Fader.tsx` | Modify | `is-vertical` (T2a, PD9); `onHold`, `layout` (T3, PD6, PD11) |
| `web/src/control/wheel-math.ts` | Modify | `follow()` (T3, PD6) |
| `web/src/control/wheel-math.test.ts` | Modify | `follow()` at black, grey, a match, a mismatch, upper case — T3 |
| `web/src/control/VjPanel.tsx` | Modify | `aria-pressed` and the target mark on swatches — T4 |
| `web/src/control/controller.css` | Modify | Grid areas, block parts, vertical fader by class, wheel dialog rules removed (T2a); a fix only where a T2b measurement fails (T2b); locked look (T3); target mark (T4) |
| `tests/browser/control-wheel.spec.ts` | Create | AC12, AC13, AC15, AC16 — T3 |
| `tests/browser/control-target.spec.ts` | Create | AC10, AC11, AC14, AC18 (mark) — T4 |
| `tests/browser/control-together.spec.ts` | Create | AC7, AC8, spec Verification 2 and 3 — T5 |
| `tests/browser/sockets.ts` | Modify | `recordSends` (PD16) — T5 |
| `tests/browser/control-modes.spec.ts`, `control-look.spec.ts`, `control-fader.spec.ts`, `control-scope.spec.ts`, `control-e2e.spec.ts`, `control-layout.spec.ts` (`:318` only, PD15) | Modify | Moved to the pinned block — T2a (list under T2a) |
| `tests/browser/control-layout.spec.ts` | Modify | The block's measured layout, new and amended cases — T2b |
| `docs/design/controller-style.md` | Modify | The pinned colour block, its Budget rows, its contrast pairs — T6 |
| `docs/design/controller-style-mockups.html` | Modify | The block in phone portrait, phone landscape and tablet, DJ and VJ — T6 |

## Tasks

### T1 — The send budget

- **Implements:** SD4, SD11, AC8, AC15
- **Expected output:** `send-budget.ts` per PD3 and PD4, about 110 source lines, deps-injected
  like `ThrottleDeps` (`wheel-math.ts:64-71`). In `Controller.tsx`, one budget is created with
  `useState` beside `link` (`:83`). Every `link.send` (`:138, 139, 197, 217, 237, 252, 262, 288,
  313, 354, 355, 366, 367, 383`) goes through `budget.tap` or `budget.value` with PD5's keys. A
  `useEffect` subscribes to `link` and calls `budget.drop()` whenever `link.view().locked` is
  true, and the budget is dropped on unmount. About 40 changed lines. Nothing else changes: each
  throttle and gap stays (`MIN_GAP_MS`, `FADER_GAP_MS`, `DURATION_GAP_MS`), and so does `device-link.ts`.
  Tests, `send-budget.test.ts`, with a fake `now` and a manual timer:
  - an empty budget sends at once, synchronously;
  - a value 16 ms or 20 ms after the last send goes at once, so a lone disc or fader never waits;
  - 3 keys pushed at 16, 20 and 20 ms for 3 s give ≤ 100 sends in every 1000 ms window and every
    gap ≥ 10 ms;
  - a replaced value keeps its turn, and each key's last value goes out;
  - a key that waits goes out within (number of waiting keys) turns;
  - taps are never replaced and keep their order among values;
  - `drop()` cancels the timer, and nothing goes out afterwards;
  - a `put` returning false drops everything waiting;
  - the gap is counted from the moment `put` returns (PD4).
- **Verification:** `pnpm run test --project unit web/src/control/send-budget.test.ts web/src/control`;
  `pnpm test:browser tests/browser/control-fader.spec.ts tests/browser/control-transition.spec.ts tests/browser/control-modes.spec.ts`
  (no change in behaviour, every existing case passes unchanged); then `bash scripts/check.sh`.
- **Depends on:** —
- **Autonomy note:** names, the queue's data structure and the test layout are the builder's.
  Stop if an existing browser test needs a change: under PD4 a single control never waits, so a
  change means the budget changed behaviour.

### T2a — The pinned colour block in the page

- **Implements:** SD1, SD2, SD5, SD9, SD10, SD12, AC1, AC9, AC14, AC17, AC18
- **Expected output:**
  - `Wheel.tsx`: a `<section data-testid="wheel" data-slot={slot} aria-label=…>`, never a
    `<dialog>`. No `showModal`, no `onDone`, no `wheel-done`.
  - `Wheel.tsx` keeps `wheel-disc` (`role="application"`, `tabIndex={0}`, arrow keys), `wheel-current`,
    `wheel-stored`, `wheel-value` and `wheel-reset`. It adds `wheel-label`: "Colour *n* · primary"
    on the primary slot, "Colour *n*" on any other. The brightness `Fader` is
    `orientation="vertical"`, at the disc's height, beside it (PD8, PD9). The disc gets a 2 px
    `--line` edge (AC18).
  - `Controller.tsx`: the Colour section with `primary-colour`/`primary-swatch` (`:325-344`) is
    removed. State `target: number | null` (null means the primary slot) replaces `wheel` (`:90`).
    The slot shown is `mode === "dj" ? state.primary : target ?? state.primary`. VJ's `onSwatch`
    sets `target` (`:353`). The block renders after `.djv-scroll` and before `FaderBank` (PD10),
    with `onColour` → `budget.value(\`colour:${slot}\`, …)` and `onReset` → `budget.tap(…)`.
  - `Fader.tsx`: `is-vertical` (PD9).
  - `controller.css`: PD10's grid, the block's parts (PD13), `--disc` (PD8), the vertical rules by
    class. The rules the wheel no longer uses are removed: `.djv-wheel-fader`, `.djv-colour-key`,
    `.djv-chip`, and the wheel's mention in the dialog comment. `.djv-dialog` stays for the
    approvals.
  - About 300 changed source lines, 4 source files, 6 test files (10 in all).
- **Existing tests this makes untrue, amended here** (the gate must stay green at the end of
  T2a, so every test the removal of the dialog breaks moves in this task):
  - `control-modes.spec.ts:86`: drop `wheel-done` (`:124-125`). `dj.getByTestId("primary-swatch")`
    (`:114, :128`) becomes `dj.getByTestId("wheel-current")`, since DJ's wheel is on the primary slot.
  - `control-modes.spec.ts:131`: becomes "DJ's pinned wheel aims at slot 1 for the built-in and at
    a stored primary (AC9)". The `primary-colour` clicks and Done are removed, and `wheel-label`
    is checked.
  - `control-look.spec.ts:295`: `primary-colour` leaves the expected list. `wheel-disc`,
    `wheel-brightness` and `wheel-reset` join the page's own tab-through. The second, in-dialog
    pass and `wheel-done` are removed. Raise `tabThrough(phone, 80)` only if the run shows it is
    exceeded, and say so.
  - `control-look.spec.ts:332`: the Done steps (`:363-365`) are removed. The title becomes "…
    disc, brightness and Reset (AC17)".
  - `control-fader.spec.ts:263`: drop the `primary-colour` click (`:268`).
  - `control-scope.spec.ts:168`: drop `primary-colour` and `wheel-done` (`:191, :196-197`).
  - `control-e2e.spec.ts`: drop `wheel-done` (`:373, :401, :526`). The AC22 case (`:341`) keeps
    asserting no `POST`, `PUT` or `DELETE` during the controlled run.
  - `control-layout.spec.ts:318`: per PD15 (the four-fader case would otherwise fail on the
    block's width at 568×320).
- **Verification:** `pnpm test:browser tests/browser/control-layout.spec.ts tests/browser/control-modes.spec.ts tests/browser/control-look.spec.ts tests/browser/control-fader.spec.ts tests/browser/control-scope.spec.ts tests/browser/control-e2e.spec.ts tests/browser/control-transition.spec.ts`;
  `pnpm run test --project unit tests/meta/control-look.test.ts web/src/control`; then `bash scripts/check.sh`.
- **Depends on:** T1
- **Autonomy note:** markup, class names, and how the label, pair, hex and Reset sit inside the
  block within PD13 and AC5 are the builder's. The builder lays the block out for AC5's numbers
  and checks them by eye at 320×568 and 568×320; T2b proves them. Stop and ask in these cases:
  - AC5's numbers clearly cannot be met at 320×568 or 568×320, which is a spec question;
  - a part needs a colour, token or size the brief does not have and PD13 does not name (T6
    records it, but the owner approves it at `/review`);
  - an amended test would need to assert less than the list above says.

### T2b — The pinned colour block, measured

- **Implements:** AC1, AC2, AC3, AC4, AC5, AC6, AC9
- **Expected output:** new and amended cases in `control-layout.spec.ts`. No source change, except
  a `controller.css` fix where a measurement below fails and the fix stays inside PD8, PD10 and
  PD13 (say which rule and why in the commit).
  - **New:**
    - at the five sizes in both modes: the block present with no `dialog[open]`, and no
      `primary-colour` or `wheel-done` (AC1);
    - at 320×568 the block above the bank and full width; at 568×320 left of the bank and under
      the bar (AC2);
    - the disc 150 ±1 or 240 ±1 by viewport, the same in DJ and VJ mode, and the brightness
      slider's height equal to the disc's ±1 (AC3);
    - block height ≤ 180 and scrolling area height ≥ 180 at 320×568; block width ≤ 240 and
      scrolling area width ≥ 190 at 568×320 (AC5);
    - in DJ mode `wheel` `data-slot` is `state.primary` and the label reads "Colour 2 · primary"
      on the built-in (AC9).
  - **Amended:**
    - `:176` (B-19 AC13): adds `wheel` in view at the scroll's start and end (AC2);
    - `:200` (B-19 AC14): adds a VJ target on swatch 3 (`data-slot="2"`) kept across both turns
      (AC4);
    - `:287` (B-19 AC15): `fitProblems` (`:88`) adds `[role=application]` (AC6).
  - 0 source lines expected; 1 test file (2 files if `controller.css` needs a fix).
- **Verification:** `pnpm test:browser tests/browser/control-layout.spec.ts tests/browser/control-modes.spec.ts tests/browser/control-look.spec.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** T2a
- **Autonomy note:** test structure and helpers are the builder's. Stop and ask in these cases:
  - AC5's numbers cannot be met at 320×568 or 568×320 inside PD13, which is a spec question;
  - a fix needs more than `controller.css`, or changes a bank fader's look (an existing
    `control-layout.spec.ts` or `control-fader.spec.ts` case changes);
  - a measurement would need a tolerance wider than the spec's ±1.

### T3 — The wheel follows the screen, lets go, and locks

- **Implements:** SD7, SD8, AC12, AC13, AC15, AC16
- **Expected output:**
  - `wheel-math.ts`: `follow(ours, screen)` (PD6).
  - `Wheel.tsx` keeps the wheel's own HSV in a ref. While held (disc or brightness, PD6), the
    marker, the brightness value and `wheel-value` show the held HSV. Otherwise they show
    `follow(own, props.current)`, and that result becomes the wheel's own HSV.
  - The disc takes one pointer (PD7). It lets go on `pointercancel`, on `blur`, on an arrangement
    change (PD11) and when `disabled` turns true: `throttle.drop()`, the hold cleared, the marker
    back on the screen's value, as `Fader.tsx:47-60` does.
  - While locked, the disc, the brightness fader and Reset ignore pointers and keys, and the
    locked look shows (PD12).
  - Reset no longer sets the HSV itself (`Wheel.tsx:194`). The screen's reply to `resetColour`
    moves the marker (AC13).
  - `Fader.tsx`: `onHold`, `layout` (PD6, PD11).
  - `controller.css`: the block's locked look.
  - About 130 changed source lines, 4 source files.
- **Tests:**
  - `wheel-math.test.ts`: `follow` keeps hue and saturation at black (`v = 0`) and grey (`s = 0`)
    when the screen's colour matches. It adopts `hexToHsv` when the colour differs. It ignores
    case.
  - New `control-wheel.spec.ts`, two paired controllers on one screen:
    - B changes the primary colour by keys, and A's `wheel-value` and `wheel-current` follow (AC12);
    - B presses Reset, and A shows the stored colour (AC12, AC13);
    - a pick of another profile shows that profile's primary (AC12);
    - with Keep colour on (`transition-keep-colour`), a pick shows the carried colour (AC12);
    - during A's disc drag (mouse held), B's change does not move A's `wheel-value`; after the
      release A shows the screen's value (AC12);
    - offline (`dropNetwork`), the block shows `wheel-locked`, and disc keys, a disc drag,
      brightness keys and Reset send no `colour` or `resetColour` frame. A lock in the middle of
      a held disc drag sends nothing after the release, nor after the link returns (AC15);
    - a `pointercancel` (CDP `touchCancel`), a blur (Tab away) and a turn to 568×320 in the
      middle of a drag each let go: no frame after it, and `wheel-value` back on the screen's
      colour (AC16).
- **Verification:** `pnpm run test --project unit web/src/control/wheel-math.test.ts web/src/control/fader.test.ts`;
  `pnpm test:browser tests/browser/control-wheel.spec.ts tests/browser/control-modes.spec.ts tests/browser/control-look.spec.ts tests/browser/control-fader.spec.ts tests/browser/control-layout.spec.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** T2b
- **Autonomy note:** the HSV state's shape and the test structure are the builder's. Stop if
  any of these comes up:
  - a bank fader's behaviour changes (an existing `control-fader.spec.ts` or
    `control-layout.spec.ts:232` case needs a change);
  - the hatching over the disc needs a token the brief lacks;
  - B-09's Keep colour does not reach the controller's state, which would be a B-09 defect: register it, do not fix it here.

### T4 — VJ mode's target

- **Implements:** SD3, AC10, AC11, AC14, AC18
- **Expected output:**
  - `VjPanel.tsx`: each swatch gets `aria-pressed={slot === target}` and a target class (PD2), and
    its comment is updated.
  - `Controller.tsx` passes `target` down. It sets `target` to null:
    - on its own pick tap (`:217`), the active profile included;
    - on `choose("dj")` (`:102-105`);
    - when `state.activeId` changes, whoever picked (PD1);
    - when the target slot is no longer in `state.palette` (PD14).
    A reload starts at null, since nothing is stored.
  - `controller.css`: the target mark, which differs from the primary mark (4 px `--select` edge,
    `controller.css:497-499`) and from the focus ring (`:346-350`). For example a bar in `--text`
    under the swatch. The final look is the brief's (T6).
  - About 70 changed source lines, 3 source files.
- **Tests,** new `control-target.spec.ts`:
  - in VJ mode, tap swatch 3: the label reads "Colour 3", `data-slot="2"`, the swatch has
    `aria-pressed="true"` and the mark, no `dialog` exists, and a disc key press sends `colour`
    with `slot: 2`, which the screen applies to that slot (AC10);
  - on the primary swatch the label reads "Colour *n* · primary" (AC10);
  - the mark's computed style differs from the primary mark's, and it is ≥ 3:1 against the
    section (AC18, with `tests/contrast.ts`);
  - the target returns to the primary slot after a re-pick of the active profile, a switch to DJ
    and back, a reload, a palette that shrinks under it (`PUT` a profile with fewer slots through
    `api`, then Refresh), and another controller's pick of a different profile, in DJ and in VJ
    mode (AC11, PD1);
  - on entering VJ mode, after a reload and after each return above, the primary swatch is the
    one pressed and carries both marks (PD2);
  - **AC14** (added at audit, 2026-11-24), on a profile with at least three distinct slots, with
    the screen's requests and its `profile` console lines recorded from before the first change:
    - in DJ mode, a disc drag on the pinned wheel changes the screen's primary slot (its colour
      on the screen moves, as `redness` in `control-modes.spec.ts:86` measures), and every other
      swatch's `data-colour` stays as it was;
    - in VJ mode, after tapping swatch 3, a disc drag changes slot 3 only, the same way;
    - throughout, the overlay still names the same profile and no `profile` console line appears
      (no pick, so no new shader program), and no `POST`, `PUT` or `DELETE` request is made.
- **Verification:** `pnpm test:browser tests/browser/control-target.spec.ts tests/browser/control-modes.spec.ts tests/browser/control-look.spec.ts tests/browser/control-layout.spec.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** T3 (PD1 and PD2 answered 2026-11-24)
- **Autonomy note:** the mark's exact form within PD2 and AC18 is the builder's, recorded in the
  brief by T6. Stop if the mark needs a new token.

### T5 — Colour and dial together, end to end

- **Implements:** SD4, AC4, AC7, AC8, AC15
- **Expected output:** `sockets.ts` gains `recordSends` (PD16). New `control-together.spec.ts`
  holds three tests. No source change.
  - **At 320×568, DJ mode** (AC7, spec Verification 2). CDP touch drives the disc and the
    Recognisability fader together, ten or more moves each:
    - both kinds of frame appear throughout the drag;
    - the last `colour` frame equals `wheel-value` as read just before `touchEnd`;
    - the screen's panel slider and the controller's `wheel-current` end on the last values sent.
    It then scrolls to the end and checks the bar, the block and the bank are in view. It turns to
    568×320: the block is a column left of the bank, still `data-slot` = primary (AC4).
  - **AC8.** Three pointers (the disc and both faders) for two seconds:
    - every gap ≥ 10 ms, ≤ 100 frames in any 1000 ms window;
    - each control's last value is the screen's final value.
  - **At 768×1024, VJ mode** (spec Verification 3):
    - a 240 px disc;
    - swatch 3 → "Colour 3"; a drag changes the screen's slot 3;
    - a re-pick of the same profile puts the wheel back on the primary slot;
    - a second controller's change moves the first one's marker;
    - `dropNetwork` during a drag shows "Locked", with no frame after it (AC15).
- **Verification:** `pnpm test:browser tests/browser/control-together.spec.ts`; then
  `bash scripts/check.sh`; then `pnpm check:load` once, since the multi-pointer drag is the kind
  of test a loaded machine exposes (D-02, B-08).
- **Depends on:** T4
- **Autonomy note:** the number of moves, the order of the steps and the helper's shape are the
  builder's. Stop if AC8's bound fails in the browser while `send-budget.test.ts` passes: that
  means a send bypasses the budget, a source defect for T1's area, not something to loosen here.

### T6 — The style brief and its mockups

- **Implements:** SD6, AC19, AC18
- **Expected output:**
  - `controller-style.md`:
    - "Dialogs" keeps only the approvals.
    - A new part, "Colour block", describes the disc (`--disc`, its `--line` edge, the marker),
      the vertical brightness fader, the label, the pair (24 px), the hex value, Reset, the locked
      look (PD12) and the target mark (T4).
    - "Primary colour, palette swatches" loses the Primary colour key and gains the target mark.
    - The Done lit key is removed from the lit-key list.
    - The Budget gains the block's rows for 320×568, 320×640, 568×320, 768×1024 and 1024×768 with
      two and four faders: block height or width, and what the scrolling area keeps, using the
      spec's numbers. For example at 320×568 with two faders 568 − 48 − 154 − block ≥ 180, and
      with four 568 − 48 − 278 − block, about 60–70 (B-18's).
    - The contrast table gains the block's non-text pairs, each a new row read by
      `tests/meta/control-look.test.ts`: the disc edge against `--panel`, the target mark against
      `--panel`, and any new token.
  - `controller-style-mockups.html`:
    - the colour wheel's dialog frame (`:911-`) is replaced by the block;
    - the Primary colour key (`:685-686, :1000-1001, :1229-1230, :1295-1296`) is replaced by the
      block in the phone portrait, phone landscape and tablet frames, DJ and VJ, at real CSS
      pixels, with the target mark in VJ.
  - The status line stays "Approved by Martijn Boot on 2026-11-19". A line under it reads
    "Amended by B-16 (SD6), approval at `/review`". 0 source lines, 2 doc files.
- **Verification:** `pnpm run test --project unit tests/meta/control-look.test.ts` (every
  contrast row against the stylesheet's tokens); open the mockups file from disk and compare with
  the built page at 320×568, 568×320 and 768×1024 (screenshots from T5's run); then
  `bash scripts/check.sh` (format covers the docs).
- **Depends on:** T4
- **Autonomy note:** wording and mockup markup are the builder's. Stop if the brief would need a
  token or pair the code does not have: the code and the brief must say the same thing. The
  content is the owner's to approve at `/review` (AC19, Human steps).

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1 | `web/src/control/send-budget.ts`, `send-budget.test.ts`, `Controller.tsx` |
| 2 | T2a | `web/src/control/Wheel.tsx`, `Controller.tsx`, `Fader.tsx`, `controller.css`; `tests/browser/control-layout.spec.ts` (`:318`), `control-modes.spec.ts`, `control-look.spec.ts`, `control-fader.spec.ts`, `control-scope.spec.ts`, `control-e2e.spec.ts` |
| 3 | T2b | `tests/browser/control-layout.spec.ts`; `web/src/control/controller.css` only if a measurement fails |
| 4 | T3 | `web/src/control/Wheel.tsx`, `Fader.tsx`, `wheel-math.ts`, `wheel-math.test.ts`, `controller.css`; `tests/browser/control-wheel.spec.ts` |
| 5 | T4 | `web/src/control/Controller.tsx`, `VjPanel.tsx`, `controller.css`; `tests/browser/control-target.spec.ts` |
| 6 | T5, T6 | T5: `tests/browser/control-together.spec.ts`, `tests/browser/sockets.ts`. T6: `docs/design/controller-style.md`, `docs/design/controller-style-mockups.html` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph
docs/plans/phase-b-16-colour-wheel-always-on.md` prints the groups the `Depends on` fields actually
give.

## Data changes

None: no table, no migration, no profile field, no browser-storage key. The wheel's target lives
only in the page's memory (SD3, Out of scope: no remembering).

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| The 86 px column beside the disc and fader at 320 CSS px is tight. The label wraps, and the pair, hex and Reset must fit 150 px of height for the block to stay ≤ 180 (AC5). | PD13's arrangement fits about 140 px. T2a lays it out and T2b measures AC5 at 320×568. If it cannot hold, T2b stops (a spec question, not a design choice). |
| Headless Chromium may deliver CDP touch moves slower than 100 a second, so the browser test may never make the budget wait. AC8 would then pass without the queue being exercised. | Three pointers (162 a second offered, spec Problem). The queue's exact rules are proven in `send-budget.test.ts` with a fake clock (T1). The browser checks only that the bounds hold on the real page (PD16). |
| With several drags at once, a value can wait up to about 30 ms in the budget. D-04 (the VJ drag's round trip over 100 ms on the owner's Wi-Fi) is open. | A drag alone never waits (PD4), so D-04's measure is unchanged (SD11). Waiting happens only when the server would otherwise have dropped values. |
| B-19's four-fader test cannot keep its scrolling-area fit at 568×320 (PD15). | Spec SD2 gives that case to B-18. The bank's own budget is still checked. Written as an amendment in T2a, not a deletion. |
| The disc is redrawn pixel by pixel (240×240) on every brightness change, now also when another controller changes the slot's brightness. | The same cost per change as today. It runs on the controller, never on the screen (render budget untouched, spec Non-functional). |
| `control-look.spec.ts:298`'s tab-through (80 presses) may fall short now that the block's three stops sit before the bank. | T2a raises it only if the run shows the bound is exceeded, and says so. |
| Another controller's re-pick of the active profile does not move this controller's wheel (PD1's limit). | Accepted: it is invisible without a new state field, which the spec rules out. The re-pick still resets the slot's colour to stored, and the wheel shows that (AC12). |
| The B-09 Keep colour path is the newest code the wheel now has to follow (merged in PR #15). | T3's test covers it. A failure there is registered as a B-09 defect, not patched here (T3 autonomy note). |

## Human steps

- **H0 — before `/audit`.** Commit the spec (`docs/specs/phase-b-16-colour-wheel-always-on.md`),
  the backlog change (`docs/backlog.md`) and this plan on a docs branch, as for B-09 and B-12.
  `/build` needs a clean tree.
- **PD1, PD2** — answered by the owner on 2026-11-24, both (a), recorded in the table above.
- **H1 — at `/review`, after T6** (AC19, SD6; spec Verification 4). The owner opens the mockups
  and the built page side by side at 320×568, 568×320 and 768×1024 and approves the brief's new
  content. Then, on a phone in portrait and in landscape against a running screen: drag a colour,
  move the abstraction dial, go back to the colour, all without opening or closing anything. AC19's
  approval exists only here.
  - [x] Notes: 2026-11-24 — the device check passed on a phone and on an iPad, on the owner's
    attestation ("they look great"), against PR #16 at dc403be. Orientations and per-item
    observations not recorded.
  - [ ] The brief and mockups approved against the built page (AC19): not yet recorded.
- Pushing, the PR and the merge are the owner's.

## Out of scope for this plan

- Everything under the spec's Out of scope (B-18's faders, B-10, choosing the primary live, saving
  a live colour, moving the swatches into the block, a per-mode layout, remembering the target, the
  approvals dialog, D-04, the screen page, other viewports).
- `shared/`, `server/`, `engine/`, `audio/`, `device-link.ts`, `pair-link.ts`: unchanged (PD3).
- The earlier specs B-04 and B-19: amended by this spec's SD12, not edited (SD12).
- `README.md:58` ("one Primary colour") stays true as a description of DJ mode's one colour. Not
  edited.
- AC19's approval is a human step (H1). T6 writes the content and the owner approves it.

## Audit (PASS required before implementation starts)

- [x] Every AC maps to at least one task (AC14 given its own test in T4 at audit)
- [x] Every task maps to at least one AC (no orphans)
- [x] Each task's expected output is concrete enough to check, and is what we actually need
- [x] Existing patterns reused; nothing reinvented
- [x] No new dependency without an approval note
- [x] Data changes additive and reversible
- [x] Errors, empty states and permissions are tasks, not afterthoughts
- [x] Each task reviewable in one sitting (T2 split into T2a and T2b at audit)
- [x] Verification named per task
- [x] Nothing touches prod, secrets or infra it should not
- [x] Every task has a Depends on and an Autonomy note
- [x] No two tasks in one parallel group write the same file

Audited by: Martijn Boot  Date: 2026-11-24
