# Spec: b-16 — Primary colour wheel always on the controller

Status: Approved · Depends on: B-04 (`docs/specs/phase-b-04-live-set-controls.md`, built), B-19
(`docs/specs/phase-b-19-controller-lighting-desk.md`, built: the pinned bank, the fader component,
the style brief), B-09 (`docs/specs/phase-b-09-transitions.md`, built: Keep colour writes the
primary slot live) · Fixes: — · Backlog: B-16

Line references are to `main` at `dc05fde`.

## Problem

Mid-set the owner wants to go quickly between the abstraction dial (Recognisability) and the
primary colour, and back again. On `/control` that takes one action too many on every colour
change.

- The colour is reached through a button, not a control: DJ and VJ mode both show a **Primary
  colour** key in the scrolling area (`web/src/control/Controller.tsx:325-344`) that only opens the
  wheel (`setWheel(state.primary)`, `:332`).
- The wheel is a modal dialog: `Wheel.tsx` opens it with `showModal()`
  (`web/src/control/Wheel.tsx:75-77`), so while it is open every other part of the page, the
  pinned fader bank included (`Controller.tsx:375-386`), is inert. Getting back to a dial means
  tapping **Done** (`Wheel.tsx:200-207`) first, which closes the dialog (`Controller.tsx:368`).
- VJ mode's palette swatches each open the same dialog on their own slot
  (`web/src/control/VjPanel.tsx:49`), with the same Done.
- The wheel reads the screen's colour once, when it opens (`useState(() => hexToHsv(props.current))`,
  `Wheel.tsx:61`), and never follows it afterwards. That was fine for a short-lived dialog. A wheel
  that is always on screen would show a stale colour after another controller, a Reset, a profile
  pick or B-09's Keep colour changed the slot.
- Because the dialog made the bank inert, the disc and a fader could never be dragged together.
  B-19 SD9 assumed "two faders and the wheel under B-04's 120 messages per second" without that
  ever happening. In fact the disc sends at most every 16 ms (about 62/s, `MIN_GAP_MS` in
  `web/src/control/wheel-math.ts`) and each fader every 20 ms (50/s,
  `web/src/control/fader.ts:13`), so disc plus two faders would be about 162/s. The server drops the
  excess without a word (`server/src/control/channel.ts:42-45`), which could include a drag's last
  value.
- B-19 SD6 holds no space for this item ("No space is drawn or held for B-16's wheel",
  `docs/specs/phase-b-19-controller-lighting-desk.md:83`), and the style brief's budget
  (`docs/design/controller-style.md:219-266`) leaves 366 px of scrolling area at 320×568 with two
  faders.

Cost today: every colour change ends with a Done tap before the dial can be reached. The visuals
follow the music a beat later than the owner's hands could.

## Decisions

The owner's answers from the interview (2026-11-24), then defaults marked as such.

- **SD1 — Phone in portrait: a pinned colour block directly above the bank.** In the horizontal
  arrangement (B-19 SD5) the colour block is pinned, full width, between the scrolling area and the
  fader bank. It holds a hue and saturation disc of 150 CSS px on the left, the brightness fader
  standing vertically beside the disc at the disc's height, and next to those the block's label,
  the current and stored colour, the hex value and Reset. The block is at most 180 CSS px tall at
  320×568. With two faders this leaves about 186 px of scrolling tiles at 320×568. With B-18's four
  faders it leaves about 60–70 px, so B-18 must amend this budget or show fewer faders in portrait.
- **SD2 — Vertical arrangement: a pinned column directly left of the bank.** In the vertical
  arrangement (a phone in landscape, a tablet, a laptop) the colour block is a pinned column under
  the status bar, between the scrolling area and the bank, so the disc sits next to the
  Recognisability fader. The column contains the disc with the brightness fader standing beside it,
  and the label, swatches of the current and stored colour, the hex value and Reset under them. At
  568×320 it is at most 240 CSS px wide and fits under the status bar without scrolling. The
  scrolling area then keeps about 190 px of width with two faders. With four faders it keeps about
  70 px, and again B-18 inherits that.
- **SD3 — A swatch points the pinned wheel at its slot; there is no colour dialog anywhere.** In VJ
  mode, tapping a palette swatch makes its slot the wheel's target. The wheel's label then reads
  "Colour *n*", or "Colour *n* · primary" on the primary slot, and the tapped swatch is lit as the
  target with a mark that differs from the primary mark. The wheel stays on that slot until another
  swatch is tapped. It goes back to the primary slot when a profile is picked (any profile, the
  active one included), when the mode switches to DJ, on a page reload, and whenever its slot no
  longer exists in the palette. DJ mode always aims at the primary slot (stored, or derived as B-04
  SD10 says). The **Primary colour** key and the **Done** key are gone in both modes. The target is
  this device's own: the screen and other controllers never know it.
- **SD4 — One send budget for the whole controller page.** The controller puts at most 100
  messages per second on its socket in total, across every control, with at least 10 ms between
  any two. Each control keeps only its newest unsent value: a new value replaces an older unsent
  one from the same control. Values from different controls take turns fairly. No value is thrown
  away except one replaced by a newer value from the same control, so every drag's last value
  arrives. Every control keeps its own existing spacing (disc 16 ms, fader 20 ms, transition
  duration 100 ms), so a drag on its own sends exactly as it does today. Taps (pick, camera,
  refresh, main audio, a transition type or Keep colour, accept, reject, Reset) go through the same budget and are never
  replaced. The server, its limit (120/s, B-04 SD20) and the control messages are unchanged.
- **SD5 — The disc grows with the room, from 150 to 240 CSS px.** The disc's size is 31.25% of the
  viewport's shorter side, clamped to between 150 and 240 CSS px. That gives 150 at 320×568, 320×640
  and 568×320, and 240 at 768×1024 and 1024×768. The size is the same in DJ and VJ mode (B-19 SD5:
  the viewport decides the arrangement, the mode decides the content). The brightness fader is
  always the disc's height.
- **SD6 — The style brief is updated with the code, and the owner approves it at review.** The
  build updates `docs/design/controller-style.md` and `docs/design/controller-style-mockups.html`
  alongside the layout code: the colour wheel's dialog part becomes the pinned colour block, the
  Budget section gains the block's rows for the five viewports with two and four faders, and the
  mockups show the block in phone portrait, phone landscape and tablet, in DJ and VJ mode. Approving
  this spec approves changing those files. Their content is approved by the owner at `/review`;
  there is no separate human step before the layout tasks.
- **SD7 — The wheel shows the screen's colour except while held.** This is the fader's rule (B-19
  SD2, SD9) applied to the disc. While a pointer holds the disc, the marker, the hex value and the
  sent colour follow the finger. Otherwise the marker, the brightness fader and the hex value show
  the target slot's colour as the screen last reported it, whoever changed it: another controller,
  Reset, a pick, B-09's Keep colour. When the screen's colour is the one the wheel's own hue,
  saturation and brightness already produce, the wheel keeps them, so hue is not lost at black or at
  grey. *(default, not asked)*
- **SD8 — Locked, the colour block keeps its place and ignores input.** While the link is locked
  (B-04 SD12), the disc, the brightness fader and Reset ignore pointers and keys. The marker and
  fader show the screen's last value, and the block shows the locked look of B-19 SD4 (hatching or
  dimming plus the word "Locked", never colour alone). A lock, a pointer cancel, a blur or a change
  of arrangement in the middle of a disc drag lets go: nothing more is sent for that drag, and the
  marker returns to the screen's value. Values waiting in the send budget (SD4) are dropped when the
  link locks, never sent later (B-04 SD12). The block appears once the first state arrives, as the
  bank does. *(default, not asked)*
- **SD9 — Keyboard and focus are unchanged in kind.** The disc stays focusable, with arrow keys for
  hue (left, right) and saturation (up, down), each press sending one change. The brightness fader
  keeps B-19 SD9's keys. Focus order follows the page: status bar, scrolling area, colour block,
  bank. *(default, not asked)*
- **SD10 — Test ids.** The block keeps `wheel` (now a pinned section, not a dialog), with `data-slot`
  set to its target, and keeps `wheel-disc`, `wheel-brightness`, `wheel-current`, `wheel-stored`,
  `wheel-value` and `wheel-reset`. It adds `wheel-label`. `swatch` gains `aria-pressed` for the
  target. `primary-colour`, `primary-swatch` and `wheel-done` are removed, and the tests that used
  them move to the pinned block. *(default, not asked)*
- **SD11 — The round-trip readout counts from the moment a message goes on the socket**, as it does
  today (`trip.sent` in `web/src/control/device-link.ts:156`). A value waiting in the budget is not
  yet sent. *(default, not asked)*
- **SD12 — Amendments recorded here, not edited into the earlier specs.** Approving this spec
  approves these amendments:
  - B-04 SD9: "a **Primary colour** button that opens the colour wheel on the active profile's
    primary slot" becomes the pinned colour block aimed at the primary slot (SD1–SD3). "every
    palette swatch (each opens the same wheel)" becomes "every palette swatch (each aims the pinned
    wheel at its slot)".
  - B-04 SD11: "DJ mode's Primary colour button and VJ mode's swatches open the same wheel" becomes
    SD3.
  - B-04 UI "Colour wheel: modal over the controller, … Reset and Done" becomes the pinned colour
    block without Done. B-04 UI "`/control`, DJ mode": "the Primary colour button showing the
    current primary colour" becomes the pinned colour block.
  - B-04 AC23 becomes AC9 and AC10 here.
  - B-19 SD1: "the Primary colour button … scroll in the remaining space" becomes: the colour block
    is pinned (SD1, SD2).
  - B-19 SD6: "No space is drawn or held for B-16's wheel" is replaced by SD1, SD2 and AC5. The
    bank's own four-fader budget (half the viewport) is unchanged.
  - B-19 SD8, AC11: the brightness fader stands vertically beside the disc, no longer horizontal in
    a dialog. It is still the same fader component, with the same keys.
  - B-19 SD9: the bound "two faders and the wheel under 120 per second" is now held by SD4, not by
    the per-control spacing alone.
  - B-19 AC13: the whole colour block joins the status bar and the bank as always in view.

  Kept unchanged: every target at least 48×48 CSS px; no horizontal scrolling at 320 CSS px wide;
  the wheel usable by keyboard; text contrast at least 4.5:1, non-text cues at least 3:1; while
  dragging, the disc sends at most one change per animation frame and always its last position
  (B-04 SD11); every control message, the server's limits and the screen's handling of `colour` and
  `resetColour`. *(default, not asked)*

## Users and permissions

Unchanged from B-04: an approved controller can do exactly what it could before. No role, no
permission and no message is added.

## In scope

- `web/src/control/Wheel.tsx`: from a modal dialog to a pinned section. It follows the screen's
  colour while not held (SD7), shows the locked look (SD8), sizes its disc to the viewport (SD5) and
  has a vertical brightness fader beside the disc.
- `web/src/control/Controller.tsx`: the colour block placed between the scrolling area and the
  bank in both arrangements (SD1, SD2); the Primary colour key removed; the wheel's target slot as
  page state with SD3's resets.
- `web/src/control/VjPanel.tsx`: a swatch tap aims the wheel; the target mark and `aria-pressed`.
- `web/src/control/controller.css`: the grid areas for the colour block in both arrangements, the
  block's parts, a vertical fader outside the bank; the dialog rules the wheel no longer uses
  removed (the approvals dialog keeps its own).
- The send budget (SD4): a page-wide coordinator between the controls and the device socket, with
  its own unit tests. The plan picks where it lives (`device-link.ts` or a module beside it).
- `docs/design/controller-style.md` and `docs/design/controller-style-mockups.html` (SD6).
- Tests: the `/control` browser tests that open or close the wheel (`control-modes.spec.ts`,
  `control-look.spec.ts`, `control-e2e.spec.ts`, `control-fader.spec.ts`,
  `control-scope.spec.ts`) move to the pinned block; new tests for every criterion below.

## Out of scope

- Any change to `shared/`, `server/`, `engine/` or `audio/`; any new or changed control message;
  any change to the server's 120/s limit or to how the screen applies `colour` and `resetColour`.
- B-18's effect faders and how they fit beside the colour block with four faders (SD1, SD2 note the
  numbers; B-18 decides).
- B-10's global colour layer, hue shift or tint.
- Choosing the primary slot live: it stays the builder's (B-04 SD10).
- Saving a live colour into the profile (ADR 0001, B-04 AC22).
- Moving the palette swatches into the pinned block (they stay in VJ's scrolling Palette section;
  interview Q5).
- A different layout or disc size per mode.
- Remembering the wheel's target across a reload, a mode switch or a profile pick.
- The approvals dialog (DJ's waiting badge): unchanged, still a dialog.
- D-04 (VJ colour drag over 100 ms p95 on the owner's Wi-Fi): this item neither claims nor worsens
  it; the round-trip readout stays as it is (SD11).
- The screen page, its `s` panel, the builder, `/send`, `/trust`.
- Any viewport outside B-19's five (320×568, 320×640, 568×320, 768×1024, 1024×768), for example a
  laptop window shorter than 320 px.

## Acceptance criteria

### The pinned wheel

- **AC1.** While the controller holds the screen's state, in DJ and VJ mode, it shall show the
  colour block (disc, brightness fader, label, current and stored colour, hex value, Reset) with no
  dialog open. It shall have no Primary colour key and no Done key, and no tap shall be needed
  before a dial can be reached after a colour drag.
- **AC2.** While the arrangement is horizontal, the colour block shall be pinned full width directly
  above the fader bank, and while it is vertical, directly left of the bank under the status bar.
  When the page is scrolled to its start or to its end, the status bar, the whole colour block and
  the whole bank shall be fully in view, in both modes.
- **AC3.** The disc shall be 150 CSS px across (±1) at 320×568, 320×640 and 568×320, and 240 CSS px
  (±1) at 768×1024 and 1024×768, the same in DJ and VJ mode. The brightness fader shall stand
  vertically beside the disc at the disc's height (±1).
- **AC4.** When the viewport changes from one arrangement to the other, the colour block shall move
  to its other place without a reload, keeping the target slot, the mode, the link and every value.
- **AC5.** With two faders in the bank, the colour block shall take at most 180 CSS px of height at
  320×568 and at most 240 CSS px of width at 568×320, and the scrolling area shall keep at least
  180 CSS px of height at 320×568 and at least 190 CSS px of width at 568×320.
- **AC6.** In DJ and VJ mode, at 320×568, 320×640, 568×320, 768×1024 and 1024×768, there shall be no
  horizontal scrolling, and every visible target shall be at least 48×48 CSS px, the disc included
  (B-19 AC15, kept).

### Colour and dial together

- **AC7.** When one pointer drags the disc and another drags the Recognisability fader at the same
  time, both drags shall send changes throughout, and the screen shall end on each drag's last
  value.
- **AC8.** While any number of controls are dragged at once, the controller shall put no more than
  100 messages on its socket in any one-second window and none less than 10 ms after the previous
  one. A value shall be left unsent only when a newer value from the same control replaced it, and
  each drag's last value shall be sent. A single drag on its own shall send as it does today (the
  disc at most one change per animation frame and at least 16 ms apart, a fader at least 20 ms
  apart, the transition duration at least 100 ms apart).
- **AC9.** In DJ mode the wheel shall aim at the active profile's primary slot (stored, or derived
  when absent), and its label shall read "Colour *n* · primary".
- **AC10.** When a VJ-mode swatch is tapped, the wheel shall aim at that swatch's slot: the label
  shall read "Colour *n*" ("Colour *n* · primary" on the primary slot), the swatch shall be marked
  as the target (`aria-pressed="true"`) with a mark that differs from the primary mark, a drag shall
  send `colour` for that slot, and no dialog shall open.
- **AC11.** When a profile is picked (the active one included), the mode switches to DJ, the page
  reloads, or the target slot is no longer in the palette, the wheel shall aim at the primary slot
  again.
- **AC12.** While the disc is not held, its marker, the brightness fader and the hex value shall
  show the target slot's colour as the screen last reported it, including after a change by another
  controller, Reset, a profile pick and B-09's Keep colour. While it is held, they shall follow the
  finger. When the screen reports the colour the wheel's own hue, saturation and brightness already
  produce (black or grey included), the wheel shall keep its hue and saturation.
- **AC13.** When Reset is pressed, the target slot shall return to its stored colour and the wheel
  shall show it (B-04 AC21, kept).
- **AC14.** The screen shall apply a pinned-wheel colour as B-04 AC20 says (that slot, the next
  frame, no new shader program), and no request shall write a profile while live colour edits exist
  (B-04 AC22, kept).

### Locked, keyboard, look

- **AC15.** While the link is locked, the disc, the brightness fader and Reset shall ignore pointers
  and keys, show the screen's last value and show the locked look (not by colour alone). A lock in
  the middle of a drag shall let go and send nothing more for that drag, and values waiting in the
  send budget shall be dropped, not sent after the link comes back.
- **AC16.** A pointer cancel, a blur or a change of arrangement in the middle of a disc drag shall
  let go: nothing more shall be sent for that drag, and the marker shall return to the screen's
  value.
- **AC17.** The colour block shall be usable by keyboard alone: the disc focusable with arrow keys
  for hue and saturation, the brightness fader with B-19 SD9's keys, Reset as a key, each press
  sending one change and each control showing the focus ring (B-19 AC21).
- **AC18.** Non-text cues in the colour block (the disc's edge, the marker, the target swatch's
  mark, the fader) shall be at least 3:1 against what is next to them, and its text at least 4.5:1
  (B-19 SD11, kept).
- **AC19.** The style brief and its mockups shall describe the pinned colour block in place of the
  wheel's dialog, with the Budget rows for the block at the five viewports with two and four faders,
  and the owner shall have approved them at review (SD6).

## Data

None.

## API contract

None. The control messages (`shared/src/control.ts`: `colour`, `resetColour`, `dials`, …) and the
socket's limits are unchanged.

## UI

- **Phone, portrait (horizontal arrangement):** status bar; scrolling area (code field, mode,
  profiles, VJ's transition, cameras, main audio, VJ's palette, status strip, pending); the pinned
  colour block, full width (disc 150 px on the left, brightness fader standing beside it, then a
  narrow column with the label, the current/stored pair, the hex value and Reset); the pinned bank.
- **Phone, landscape; tablet; laptop (vertical arrangement):** status bar across the top; under it,
  from left to right: the scrolling area, the pinned colour column (disc with the brightness fader
  beside it, the label, the pair, the hex value and Reset under them), the pinned bank.
- **States:** before the first state: no colour block, as no bank. Locked: the block in place,
  locked look, "Locked" shown. DJ mode: always the primary slot. VJ mode: the target swatch lit in
  the Palette section, the label naming the slot.
- **Dialogs:** only the approvals dialog is left.

## Non-functional

- **Message rate:** at most 100 messages per second per controller page, at least 10 ms apart
  (SD4), under the server's 120 (B-04 SD20).
- **Render budget:** the screen is untouched. B-01's p95 ≤ 50 ms audio-to-frame still holds.
- **Accessibility:** as B-19 SD11. The disc keeps `role="application"` with its keyboard hint.
- **Requests:** the controller requests nothing new; no route, file or font is added (B-19 SD12).

## Edge cases and failure modes

- **Mid-set, with people waiting (probe):** a colour drag and a dial drag together never cost a
  dropped last value (SD4, AC7, AC8). A lock in the middle of a drag sends nothing late (AC15).
- **Restart or reload while a drag is under way (probe):** the controller reloads aimed at the
  primary slot (AC11). A screen page reload locks the controller (B-04 SD13), and the queued values
  are dropped (AC15).
- **No network:** as B-04 SD12. The block stays in place and locked; nothing is queued for later.
- **Two controllers on the same slot:** the last one the screen applied wins (B-04 AC25). The
  controller not dragging shows it (AC12). The one dragging follows its finger and returns to the
  screen's value on release.
- **Keep colour (B-09):** a pick with Keep colour on writes the primary slot live. The wheel aims at
  the primary slot after the pick (AC11) and shows that carried colour (AC12).
- **A palette shrinks under the target** (a refresh after the builder saved fewer slots): the wheel
  goes back to the primary slot (AC11).
- **Brightness at 0, or saturation at 0:** the marker keeps its hue and saturation as long as the
  screen's colour matches (AC12). After another controller set the slot to black, the marker sits
  where `hexToHsv` puts black.
- **Four faders (B-18):** the scrolling area shrinks to about 60–70 px in portrait and 70 px of
  width at 568×320 (SD1, SD2). That is B-18's to resolve, not a failure of this item.
- **Who may do this:** any approved controller, as before. No guarded area is touched.

## Verification

1. `bash scripts/check.sh` green, with the new and moved `/control` browser tests among them.
2. A browser test at 320×568 in DJ mode: pair a controller, then check that the colour block is
   pinned above the bank with a 150 px disc and that no dialog exists. With two pointers, drag the
   disc and the Recognisability fader together. Count the messages the page puts on its socket
   (≤ 100 in any second, ≥ 10 ms apart), and check that the screen ends on both last values.
   Scroll to the end and check that the bar, the block and the bank are in view. Turn to 568×320 and
   check that the block becomes a column left of the bank, still aimed at the primary slot.
3. The same in VJ mode at 768×1024: a 240 px disc; tap swatch 3, see "Colour 3" and the lit swatch,
   drag, and the screen's slot 3 changes; pick the same profile and the wheel is back on the primary
   slot; a second controller changes the primary colour and the first one's marker follows; drop
   the link in the middle of a drag, see the block "Locked" with nothing sent after it.
4. The owner, on a phone in portrait and in landscape: drag a colour, move the abstraction dial,
   back to the colour, without opening or closing anything. Then look at the brief's mockups
   against the built page at `/review` (SD6).

## Exit condition

On `/control`, in both modes and both arrangements, the owner can drag the colour, move the
abstraction dial and go back to the colour without a tap in between or scrolling, and the
gate proves it.

## Open questions

None.
