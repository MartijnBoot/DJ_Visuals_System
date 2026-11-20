# Spec: b-19 — Controller restyled as a venue lighting desk

Status: Approved · Depends on: B-04 (`docs/specs/phase-b-04-live-set-controls.md`, built), B-06
(`docs/specs/phase-b-06-remote-input-devices.md`, built) · Fixes: — · Backlog: B-19

Line references are to `main` at `a408a67`.

## Problem

In the booth, `/control` sits next to decks, a mixer and lighting gear, and looks like a web form
among them. Its two dials are hard to hit by hand mid-set.

- The whole look is one object of inline styles, `web/src/control/styles.ts:32-95`: grey
  buttons with a thin grey border (`:9-20`), the active choice in black on amber (`:66-69`). There
  is no stylesheet anywhere in `web/`; `web/index.html:7-15` holds the only CSS.
- The two dials are native `<input type="range">` with a thin track and a small thumb, styled
  only by `accentColor` (`web/src/control/styles.ts:70`, `web/src/control/Controller.tsx:277-300`).
  A touch on the track jumps the value to the touch point, so a thumb that misses the cap makes
  the visuals lurch. Inline styles cannot reach a range's thumb or track at all.
- The wheel's brightness slider is the same native range (`web/src/control/Wheel.tsx:170-185`).
- Everything is one column that scrolls (`web/src/control/styles.ts:33-49`). The link line is its
  first row (`web/src/control/Controller.tsx:125-127`), so once the page scrolls, "Reconnecting…"
  is off screen and the only sign of a dropped link is greyed controls. The dials are near the
  bottom (`Controller.tsx:277`), below the profile and camera tiles, so in DJ mode they can be
  scrolled away. B-16 (wheel next to the dials, no scrolling between them) and B-18 (effect
  faders, no DJ mode that needs scrolling) both need a place that does not scroll.
- The DJ-mode waiting badge sits in the mode row (`web/src/control/Controller.tsx:156-179`) and
  scrolls away with it.
- `/send` imports the same style object (`web/src/send/Send.tsx:14`), so restyling `styles.ts` as
  it stands would restyle `/send` too, which B-19 rules out.
- The B-04 browser checks for 320 CSS px and 48×48 targets (`tests/browser/control.spec.ts:249-271`)
  hold today and must keep holding.

Cost today: the controller looks out of place among the gear, and a mid-set dial move takes a
careful look and a precise thumb.

## Decisions

The owner's answers from the interview (2026-11-19), then defaults marked as such.

- **SD1 — The faders live in a bank pinned to the screen; the tiles scroll above it.** The bank
  never scrolls out of view. In the horizontal arrangement (SD5) it is pinned to the bottom edge
  and its faders run horizontally, full width. In the vertical arrangement it is pinned to the
  right edge, full height under the status bar, and its faders run vertically. Profile tiles,
  camera tiles, the Primary colour button and VJ mode's additions scroll in the remaining space.
- **SD2 — A fader is grabbed anywhere and moves relative to the drag.** A touch on the fader's
  track never changes the value; only the drag distance does, as with a physical fader pushed from
  wherever the finger lands. The fader is a hand-written component (`role="slider"`), not a native
  range. The rule "the cap follows the finger only while held, the screen's value otherwise"
  (`web/src/control/Controller.tsx:66-95`) carries over. This replaces the native slider's jump to
  the touch point, the one behaviour change in this item.
- **SD3 — A style brief comes first, as the plan's first task, and the owner approves it.** T1
  writes `docs/design/controller-style.md`: the tokens (colours as hex with their measured contrast
  ratios, type scale, spacing, radii, fader track and cap dimensions, the status colours of SD4,
  the active mark, the focus ring, the locked look) and mockups of the three arrangements (phone
  portrait, phone landscape, tablet) the owner can look at on a phone and a tablet. The owner's
  approval is a human step that blocks every styling task after T1. The brief takes its language
  from venue lighting gear in general and copies no particular manufacturer's console. Approving
  this spec approves adding that file to `docs/design/`; the brief's content is approved by the
  human step.
- **SD4 — The link state is a status bar pinned to the top, coloured by state, with the text
  always shown.** The colour is a second signal, never the only one. Live (`Connected`): the
  brief's "ok" colour. Needs action or in progress — `Scan the code on the screen machine`,
  `Connecting…`, `Waiting for approval`, `Reconnecting…`, `Screen not connected`: the brief's
  "attention" colour (amber family). Ended or refused — `Request rejected`, `Request expired — try
  again`, `Wrong code`, `Too many devices`, `Another device is sending audio`, `Too many wrong
  codes — try again in a minute`, `Pairing ended — scan the code again`: the brief's "stop" colour
  (red family). The texts are `LINK_TEXT` (`web/src/control/device-link.ts:22-36`), unchanged.
  While the controls are locked, the fader bank also shows its locked look: dimmed caps and the
  word "Locked" in the bank.
- **SD5 — The viewport decides the arrangement; the mode decides the content.** *Horizontal
  arrangement*: viewport narrower than 600 CSS px and taller than wide. *Vertical arrangement*:
  every other viewport (a phone in landscape, a tablet, a laptop). DJ and VJ mode differ only in
  what is shown, as B-04 SD9 already says; a phone in VJ mode gets the pinned horizontal bank with
  VJ's additions scrolling above it, a tablet in DJ mode gets vertical faders with fewer sections.
  Turning or resizing the device re-lays the page out live; nothing new is remembered. B-04 SD9's
  first-open rule (narrower than 600 CSS px starts in DJ mode) and the remembered mode are
  unchanged.
- **SD6 — The bank holds up to four faders within half the viewport.** The bank takes a list of
  faders; this item puts two in it (Recognisability, Audio reactivity). With four, it fits at most
  half the viewport height in the horizontal arrangement at 320×568 and at most half the viewport
  width in the vertical arrangement at 568×320, with no horizontal scrolling and every target at
  least 48×48 CSS px. No space is drawn or held for B-16's wheel. This budget is the rule B-16 and
  B-18 inherit: whatever they add to the bank fits in it, or their spec amends this one.
- **SD7 — Each fader shows its level as a number, 0 to 100.** Next to the fader's label, rounded
  to a whole number. It follows the finger while the fader is held and shows the screen's value
  otherwise, as the cap does. It is a readout, not an input. `aria-valuetext` carries the same
  number.
- **SD8 — The new look covers all of `/control` and nothing else.** In: the status bar, the code
  field and every pairing state on `/control`, the mode toggle, tiles, the fader bank, the Primary
  colour button, VJ mode's swatches, status strip and approvals, the waiting badge and its dialog,
  and the colour wheel's dialog. The wheel's brightness slider becomes the same fader component,
  horizontal, inside the dialog. Out: the screen page and its `s` panel (External control section
  included), the builder, `/send` and `/trust`; each keeps today's look exactly. `/send` stops
  sharing the controller's style module. *(default, not asked; the panel's exclusion is the
  backlog's "Not this")*
- **SD9 — Fader mechanics.** *(default, not asked)*
  - Range 0 to 1 in steps of 0.01, as today.
  - Drag gain: dragging the full length of the track moves the full range. The value clamps at 0
    and 1, and reversing direction moves at once from the clamp; overshoot is not remembered.
  - The fader captures its pointer, so a drag that leaves the track keeps working until the
    finger lifts. Each fader follows its own pointer: two fingers move two faders at once; a
    second finger on a held fader is ignored.
  - A touch without movement sends nothing.
  - While dragging, at most one change per fader is sent per animation frame, and the last value
    is always sent on release (the wheel's rule, B-04 SD11). This keeps two faders and the wheel
    under B-04's 120 messages per second per socket (SD20).
  - Keyboard: arrow keys move by 0.01, Page Up and Page Down by 0.1, Home and End to 0 and 1.
    Each key press sends one change.
  - A lock, a pointer cancel, a blur or a change of arrangement mid-drag lets go: the cap and the
    readout return to the screen's value, and nothing more is sent for that drag.
  - The fader's track, not only its cap, is the touch target: its cross size is at least 56 CSS
    px. In the horizontal arrangement the travel is at least 85% of the viewport width. In the
    vertical arrangement it is at least 180 CSS px at 568×320 and at least 300 CSS px at 768×1024.
  - The cap and the readout never animate; they follow the finger or the screen's value at once.
- **SD10 — The waiting badge sits in the status bar.** In DJ mode the "1 waiting" badge (B-04
  SD18) moves from the mode row into the pinned status bar, so a waiting device is seen without
  scrolling. Its dialog is unchanged in behaviour. VJ mode's pending list stays inline in VJ's
  scrolling content. *(default, not asked)*
- **SD11 — Legibility and accessibility.** Text at least 4.5:1 against its background (B-04,
  unchanged). Every non-text cue at least 3:1 against what is next to it: fader cap against
  track, track against background, the active-tile mark, the focus ring, the status bar's colour
  against the page. The active tile is marked by more than colour (for example a bar or a border
  weight; the brief decides), as is the locked look. Every control shows a visible focus ring for
  the keyboard. One dark theme; `prefers-color-scheme` is ignored. *(default, not asked)*
- **SD12 — CSS only; no font, image or dependency.** The look uses the system font stack and no
  web font, no image file and no new package. A stylesheet for `/control` is allowed (pseudo
  classes, media queries), scoped so that none of its rules can match an element of another
  route; it ships as part of the built `/assets/*`, so no route requests anything new.
  *(default, not asked)*
- **SD13 — B-04 rules amended, and only these.** Approving this spec approves these amendments to
  `docs/specs/phase-b-04-live-set-controls.md`, recorded here and not edited into it:
  - SD9 and UI "`/control`, DJ mode": "the two dials as wide sliders" becomes the pinned fader
    bank of SD1, SD5 and SD6.
  - UI "`/control`, link states": "one full-width line above the controls" becomes the pinned
    status bar of SD4.
  - UI "`/control`, DJ mode": the waiting badge moves to the status bar (SD10).
  - Non-functional "Accessibility": "native controls where they exist" gains one exception, the
    fader (SD2), which is a labelled `role="slider"` with the keyboard of SD9.

  Kept unchanged: every target at least 48×48 CSS px; no horizontal scrolling at 320 CSS px wide;
  the wheel usable by keyboard; text contrast at least 4.5:1; every B-04 behaviour, message,
  link text and limit. *(default, not asked)*
- **SD14 — The tests keep their test ids.** The faders keep `dial-recognisability` and
  `dial-reactivity`, the brightness fader keeps `wheel-brightness`, and every other `data-testid`
  on `/control` stays. Tests that drove a dial with `.fill()` or `toHaveValue` move to the
  keyboard, a pointer drag, or `aria-valuenow`. The four-fader budget (SD6) is proven without a
  route, a query flag or any other switch in the shipped page; the plan picks the seam (a
  component test or a browser test that mounts the bank). *(default, not asked)*

## Users and permissions

Unchanged from B-04: an approved controller can do exactly what it could before. This item adds
no role, no permission and no message.

## In scope

- `docs/design/controller-style.md`: the style brief and its mockups (SD3), plan task T1, then the
  owner's approval as a human step.
- `web/src/control/`: the fader component (SD2, SD7, SD9) with its own unit tests; the pinned
  status bar (SD4, SD10); the pinned fader bank and the two arrangements (SD1, SD5, SD6); the new
  look for `Controller.tsx`, `VjPanel.tsx`, `Wheel.tsx` (brightness as a fader), `Approvals.tsx`;
  `styles.ts` and, if the plan wants one, a scoped stylesheet (SD12).
- `web/src/send/`: its own copy of today's styles, so `/send` looks exactly as it does now (SD8).
- Tests: the B-04 and B-06 `/control` browser tests updated to drive faders (SD14), and new
  browser checks for every criterion below.
- Docs: one line in `docs/design/architecture.md` naming the brief as the controller's look.

## Out of scope

- New controls, new behaviour beyond SD2's grab rule, new control messages, any change to
  `shared/`, `server/`, `engine/` or `audio/`.
- B-16's always-visible wheel, its placement, and any space held for it (SD6).
- B-18's effect faders; only the bank's capacity for them (SD6) is in.
- The screen page, its `s` panel and its External control section, the builder, `/send`, `/trust`
  (SD8).
- A copy of a particular manufacturer's console, its logo, its type or its layout.
- A light theme, theme switching, user-chosen colours for the controller.
- Web fonts, icons as image files, sounds, haptics (vibration).
- Animations and transitions on faders; motion of any kind beyond a state change.
- Typing a value into a fader; double-tap to reset; fine-adjust modes; fader "pickup" or motor
  behaviour.
- Fixing D-04 (the colour-drag round trip over Wi-Fi); SD9's frame limit is not claimed to fix it.
- MIDI or hardware controllers, keyboard shortcuts beyond each fader's own keys.
- Localisation; the UI stays English.

## Acceptance criteria

### Brief

- **AC1.** When T1 is done, `docs/design/controller-style.md` shall exist with the token list of
  SD3, every text pair's contrast ratio at least 4.5:1 and every non-text pair at least 3:1, and
  mockups of the three arrangements; and no task after T1 shall start before the owner's approval
  is recorded in the plan.

### Fader

- **AC2.** When a finger touches a fader's track and lifts without moving, the fader's value
  shall not change and no `dials` message shall be sent.
- **AC3.** When a finger touches a fader anywhere along its track and drags by a distance d, the
  value shall change by d divided by the track's travel length (to within one step of 0.01),
  regardless of where the touch landed, clamped to 0 and 1.
- **AC4.** If a drag passes 0 or 1 and reverses, then the value shall move away from the clamp at
  once, without a dead zone.
- **AC5.** While a fader is dragged, the controller shall send at most one `dials` message for
  that fader per animation frame and shall always send the last value on release.
- **AC6.** When two pointers drag the two faders at the same time, each fader shall follow its own
  pointer and the screen shall end on both last values.
- **AC7.** When a fader has keyboard focus, the arrow keys shall move it by 0.01, Page Up and Page
  Down by 0.1, and Home and End to 0 and 1, each key press sending one change.
- **AC8.** The fader shall expose `role="slider"`, an accessible name (its label),
  `aria-valuemin` 0, `aria-valuemax` 1, `aria-valuenow`, and `aria-valuetext` equal to its
  0–100 readout.
- **AC9.** While a fader is held, its cap and readout shall follow the finger; when it is released,
  cancelled, blurred, locked or re-laid out, they shall show the screen's value (the B-04 rule,
  `web/src/control/Controller.tsx:66-95`).
- **AC10.** Each fader shall show its value as a whole number from 0 to 100 next to its label,
  matching the value it shows the screen (a screen value of 0.42 reads 42).
- **AC11.** The wheel's brightness control shall be the same fader component (AC2–AC9), and the
  wheel shall stay usable by keyboard alone (B-04 UI "Colour wheel").

### Layout

- **AC12.** While the viewport is narrower than 600 CSS px and taller than wide, the fader bank
  shall be pinned to the bottom edge with horizontal faders whose travel is at least 85% of the
  viewport width; in every other viewport it shall be pinned to the right edge with vertical
  faders, with travel at least 180 CSS px at 568×320 and at least 300 CSS px at 768×1024.
- **AC13.** When the page is scrolled to its end, the status bar and the whole fader bank shall
  stay fully in view, in both modes and both arrangements.
- **AC14.** When the viewport changes from one arrangement to the other, the page shall re-lay
  out without a reload, keeping the mode, the link and every value.
- **AC15.** In DJ and VJ mode, at 320×568, 320×640, 568×320, 768×1024 and 1024×768, there shall be
  no horizontal scrolling and every visible target shall be at least 48×48 CSS px (B-04, kept).
- **AC16.** When the bank holds four faders, it shall take at most half the viewport height at
  320×568 in the horizontal arrangement and at most half the viewport width at 568×320 in the
  vertical arrangement, with AC15 still true.

### Status bar and legibility

- **AC17.** For every link state in `LINK_TEXT`, the status bar shall show the state's text and
  the colour of SD4's group for it, and the text shall be at least 4.5:1 against the bar.
- **AC18.** While the controls are locked, every fader shall be disabled, show the locked look,
  and the bank shall show "Locked"; when the controls unlock, both shall go.
- **AC19.** In DJ mode, while a device is waiting for approval, the waiting badge shall be in the
  status bar and open the approvals dialog (B-04 AC8, SD18, unchanged behaviour).
- **AC20.** The active profile tile, the active camera tile, the active mode and the active main
  audio choice shall each be marked by more than colour, and the mark's colour shall be at least
  3:1 against an inactive tile.
- **AC21.** When a control has keyboard focus, it shall show a focus ring at least 3:1 against
  its surroundings.

### Scope and boundaries

- **AC22.** When `/send`, `/`, `/builder` or `/trust` loads, its look shall be unchanged: no rule
  of the controller's look shall match any of its elements, and `/send` shall not import the
  controller's style module.
- **AC23.** While `/control` runs, it shall request nothing beyond what it requests today
  (`/control`, `/assets/*`, the device socket): no font, image or other new resource.
- **AC24.** Every B-04 and B-06 `/control` acceptance criterion shall still pass, through the
  same `data-testid`s, with no change to `shared/`, `server/`, `engine/` or `audio/`.

## Data

None. No table, no migration, no new browser storage key. `djv.controlMode` and `djv.controlKey`
are unchanged.

## API contract

None changed. No route, socket or message is added or altered (`shared/src/control.ts` untouched).

## UI

- **Status bar** (top, pinned, both modes): the link text in its state colour (SD4); in DJ mode
  the waiting badge at its end (SD10). Wraps on a narrow screen rather than truncating.
- **Scrolling area:** opened without a code or key, the code field and Connect; then the mode
  toggle, profile tiles with Refresh, camera tiles, main audio (when an audio sender is approved),
  the Primary colour button; in VJ mode also the palette swatches, the status strip with the round
  trip, and pending requests.
- **Fader bank** (pinned; bottom with horizontal faders, or right edge with vertical faders,
  SD5): one fader per dial, each with its label and 0–100 readout. Locked: dimmed caps and
  "Locked". Shown only once the screen's state has arrived, as the dials are today.
- **Colour wheel dialog:** the brief's look; disc, brightness fader, current and stored swatches,
  Reset and Done, unchanged in behaviour.
- **Approvals dialog** (DJ badge) and VJ's pending list: the brief's look, unchanged in behaviour.
- **Empty and error states:** unchanged texts; "Scan the code on the screen machine" and every
  refusal show in the status bar in their colour.

## Non-functional

- **Render budget:** the screen is untouched; the controller's own frame limit per fader (SD9)
  keeps the screen's received rate at or below today's.
- **Accessibility:** SD11; the fader exception (SD13).
- **Assets:** no new request (AC23); no font, image or package (SD12).
- **Logging:** none added; the controller logs nothing new.

## Edge cases and failure modes

- **Mid-set, users waiting (probe):** a missed touch on a fader changes nothing (AC2); a dropped
  link turns the pinned bar amber and the bank to "Locked" while every value stays (AC17, AC18); a
  drag in progress when the link drops is let go and nothing is queued (AC9, B-04 SD12).
- **Process restart (probe):** unchanged from B-04 AC28; the status bar shows "Pairing ended —
  scan the code again" in the stop colour.
- **Device turned mid-drag:** the drag lets go, the last value already sent stands, the page
  re-lays out (AC9, AC14).
- **Two fingers on one fader:** the second is ignored (SD9).
- **A long status text at 320 px with the waiting badge:** the bar wraps to two lines; the bank's
  budget (AC16) still holds.
- **A screen value off the 0.01 grid** (set on the panel): the readout rounds; the cap shows the
  exact position.
- **Two controllers dragging the same dial:** last applied wins and both readouts show it
  (B-04 AC25, unchanged).
- **Money, roles, guarded areas (probes):** nothing touches money; no role changes; no guarded
  area (`docs/invariants.md`) and no invariant row changes.

## Verification

1. `bash scripts/check.sh` green, with the new unit tests for the fader (relative drag, clamp and
   reverse, frame limit, keys, let-go cases) and browser checks: a paired phone context at
   320×568 drags each fader from a point away from its cap and the screen's dials move by the
   drag only; a tap on the track changes nothing; the context is turned to 568×320 and the bank
   moves to the right edge with vertical faders; the page scrolled to its end still shows the
   status bar and bank; the socket is dropped and the bar reads "Reconnecting…" in the attention
   colour with the bank "Locked"; the four-fader bank fits its budget; `/send` and `/` are
   unchanged; every B-04 and B-06 `/control` test passes.
2. The owner approves the brief (T1's human step) on a phone and a tablet before any styling task.
3. On the owner's screen machine, phone and tablet, in a darkened room at arm's length (human
   steps): pair both; in DJ mode on the phone in portrait, move both faders with a thumb that
   lands off the cap, then turn the phone and do it again; read the readouts; in VJ mode on the
   tablet, edit a swatch with the brightness fader; drop the Wi-Fi and read the status bar at a
   glance; tell the active profile tile from the others without looking closely; judge that the
   controller reads as a piece of lighting gear next to the decks.

## Exit condition

In a dark booth the owner reads the link state and the active choice at a glance and moves either
fader by hand from wherever the thumb lands, on a phone in either orientation and on a tablet, in
a controller that looks like lighting gear and behaves exactly as B-04 built it otherwise.

## Open questions

None from the interview.
