# Plan: b-19 — Controller restyled as a venue lighting desk

Spec: [docs/specs/phase-b-19-controller-lighting-desk.md](../specs/phase-b-19-controller-lighting-desk.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001 Setup Decision Record](../adr/0001-setup-decision-record.md) — nothing moves
off the browser, no server change; [0002](../adr/0002-remote-input-over-the-lan.md) — the LAN
listener's routes are unchanged (`/control` asks for nothing new, AC23). New dependencies: none
(SD12). The stylesheet is a `.css` file imported with Vite's built-in `?inline` suffix; the fader
is hand-written; tests use Playwright and Vitest as they are. The spec's two edits under
`docs/design/` — the new `controller-style.md` (SD3) and one line in `architecture.md` (In scope)
— are approved by the spec; the third, `controller-style-mockups.html`, by the owner's answer
to PD1 (2026-11-19).

Line references are to `main` at `a408a67`. The spec is read from the uncommitted working copy of
2026-11-19 (Human steps, H1).

## Approach

The order is: the brief and the owner's look at it (T1, H2), then two pieces with no look at all —
`/send`'s own copy of today's styles (T2) and the fader's gesture rules as a pure module with
injected frames (T3) — then the fader component replacing both native ranges, in place, with
every existing dial test moved to it (T4), then the page shell: pinned status bar, scrolling
middle, pinned bank, the two arrangements (T5), then the status bar's colours and the waiting
badge (T6), then the rest of the look and the removal of `control/styles.ts` (T7), and last the
proofs across routes and the architecture line (T8). Each task leaves `/control` working and the
gate green; until T7 the untouched parts keep today's inline styles beside the new stylesheet.
T4 is the one big test change: about 30 dial lines in three spec files stop being true at once
(`.fill()`, `toHaveValue`, `.disabled` on an `<input type="range">`), so they move to one new
helper in the same commit.

The fader owns its gesture. Today `Controller.tsx:66-109` keeps `moving` and `held` per dial so
the thumb follows the finger only while held; that rule moves into `Fader.tsx`, backed by
`fader.ts` (relative drag, clamp without memory, keys, let-go), which is unit-tested without a
browser the way `wheel-math.ts` is. Sending reuses `createSendThrottle` from `wheel-math.ts`,
which gains a `drop()` for SD9's let-go and a configurable gap so two faders held together stay
under the socket's 120 a second (PD6). The arrangement is decided once, in JS
(`arrangement.ts`), and written as `data-arrangement` on the page root; the stylesheet selects on
it, and the fader reads its axis from it and lets go when it changes. The stylesheet is rendered
as a `<style>` inside `/control`'s own root, every selector under `.djv-control`, so no other
route ever has a rule of it in its document and no route requests a new file (AC22, AC23).

Rejected:

- Restyling `<input type="range">` with `::-webkit-slider-thumb`: it cannot stop the jump to the
  touch point (SD2), and iOS Safari ignores most of it.
- A plain `import "./controller.css"`: Vite links the one built CSS file from `index.html`, so
  `/`, `/builder` and `/send` would each request it (SD12: "no route requests anything new").
- The arrangement in CSS media queries alone: the fader must know its axis and must let go on a
  change (SD9), so JS needs the same answer; two sources of truth would drift.
- Gesture state kept per dial in `Controller.tsx`, as today: three faders (two dials, brightness)
  would repeat it.
- Playwright component testing or jsdom for the four-fader budget: a new dependency; a
  `react-dom/server` render from a test: `react` resolves only under `web/` in this workspace and
  it is a second render path. A route or query flag: SD14 forbids it.

## Decisions this plan makes

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 | **Owner — answered 2026-11-19: yes, the HTML mockups file.** SD3 wants mockups "the owner can look at on a phone and a tablet", and approving the spec approved adding *that file* (`controller-style.md`) to `docs/design/`. Markdown cannot show a look on a phone (GitHub strips inline styles and inline SVG). Where do the mockups live? | One self-contained `docs/design/controller-style-mockups.html` beside the brief — the three arrangements at real CSS px, the brief's tokens, no external resource (no `src=`/`href=` to another file or origin, no `@import`, no `url(` but `data:`), opened on the phone and tablet from the file (iOS Files and Android Chrome both render a local `.html`). The brief links it. Rejected: box diagrams inside the `.md` only. | A second file in `docs/design/` is a change the spec did not approve (CLAUDE.md hard stop), so it was asked; the owner approved it. The rejected option meets AC1's letter but not SD3's purpose: the owner would approve a look they had not seen. |
| PD2 | **Confirm.** How the stylesheet ships and stays scoped (SD12, AC22, AC23). | `web/src/control/controller.css`, imported in `Controller.tsx` as `import css from "./controller.css?inline"` and rendered as `<style>{css}</style>` inside `<main class="djv-control">`. Every selector starts with `.djv-control`; no `url(`, `@import` or `@font-face`. The tokens are custom properties on `.djv-control`. `tests/meta/control-look.test.ts` checks all three. | Vite's `?inline` is built in (`vite/client` types, already in `web/tsconfig.json`); nothing is emitted as a file, so no route requests anything new, and the rules exist only in `/control`'s DOM. |
| PD3 | **Confirm.** How the arrangement is decided (SD5, AC12, AC14). | `arrangementFor(width, height)`: `"horizontal"` when `width < 600 && height > width`, else `"vertical"` (a square viewport is vertical: "taller than wide" is strict). A `useArrangement()` hook over `resize` via `useSyncExternalStore`; `data-arrangement` on `<main>`. Bank layout keys off that attribute only, never off a per-fader attribute. | One answer for JS and CSS; the fader needs its axis and SD9's let-go. Keying layout off the root only is what makes PD9's clone seam measure the real layout. |
| PD4 | **Confirm.** Where the "cap follows the finger only while held" rule lives (SD2, AC9). | In `Fader.tsx`, per fader: its shown value is the held value while its own pointer drags, the `value` prop (the screen's) otherwise. `Controller.tsx:66-109` (`moving`, `held`, `hold`, `letGo`, the lock effect) is removed. | One implementation for both dials and the brightness fader. |
| PD5 | **Confirm.** Travel length, gain, rounding, direction (SD9, AC3, AC4, AC12). | Travel = the `role="slider"` element's length along its axis (`getBoundingClientRect` at pointer down). Value += Δposition ÷ travel per move, clamped to [0, 1] each move (so overshoot is forgotten and reversal moves at once). The internal value is unrounded; the sent, shown and `aria-valuenow` value is rounded to 0.01. Horizontal: right is more. Vertical: up is more. Keys: ArrowRight and ArrowUp +0.01, ArrowLeft and ArrowDown −0.01, Page Up +0.1, Page Down −0.1, Home 0, End 1, each clamped, one send per press, nothing sent when the value does not change. | Rounding each move would lose sub-step moves and make the cap lag the finger. "Travel" measured on the same element the tests measure for AC12. |
| PD6 | **Confirm.** The send limit (SD9, AC5). | `createSendThrottle` (`web/src/control/wheel-math.ts:78`) gains `drop()` (cancel the frame, forget the pending value, send nothing) and an optional `minGapMs` (default stays 16 for the wheel's disc). Each fader has its own throttle with `minGapMs: 20`: at most one send per frame and at most 50 a second, so both faders held together send at most ~100 a second. Release always sends the last value at once. | SD9 says two faders and the wheel stay under 120 a second; at 16 ms two faders alone reach 125, and the server drops the excess silently (`server/src/control/channel.test.ts:98`), which could drop a release. The wheel's dialog is modal, so the bank and the disc never send together. |
| PD7 | **Confirm.** The fader's element (SD2, SD13, AC8, AC18). | A `<div role="slider" tabIndex={0}>` holding an `aria-hidden` cap; `aria-labelledby` its visible label; `aria-valuemin="0"`, `aria-valuemax="1"`, `aria-valuenow` (the shown value), `aria-valuetext` (the 0–100 readout), `aria-orientation`; `aria-disabled="true"` while locked (still focusable, keys and pointers do nothing). `touch-action: none` on it. The `data-testid` stays on this element. The readout is a sibling `<span data-testid="<testid>-readout">`. | Playwright's `toBeDisabled()` honours `aria-disabled` on a slider, so `toBeDisabled` lines stay true; `.disabled` reads do not (listed under T4). |
| PD8 | **Confirm.** Readout and `aria-valuetext` (SD7, AC10). | `Math.round(value * 100)` of the shown value, as a plain integer string. A screen value off the grid shows its exact position on the cap and the rounded number in the readout. | The spec's edge case. |
| PD9 | **Confirm.** The four-fader seam (SD14, AC16). | A browser test on a real paired `/control` clones the bank's last real fader node twice into the bank (DOM only, no React state change in between), measures, removes the clones, resizes, clones again, measures again. | No switch in the shipped page, the real CSS and real markup, no new dependency (Rejected list). |
| PD10 | **Confirm.** The link colour groups (SD4, AC17). | `LINK_GROUP: Readonly<Record<LinkStatus, "ok" \| "attention" \| "stop">>` in `web/src/control/device-link.ts` beside `LINK_TEXT` (`:22-36`), exhaustive by type; `live` ok; `needs_code`, `connecting`, `waiting`, `reconnecting`, `screen_off` attention; `rejected`, `expired`, `wrong_code`, `too_many`, `audio_taken`, `throttled`, `ended` stop. The status bar carries `data-testid="status-bar"` and `data-link-group`; `link-line` (role `status`) stays on the text inside it. | SD4's table, made a type the compiler checks against every status. |
| PD11 | **Confirm.** New test ids (SD14 keeps every old one). | `status-bar`, `fader-bank`, `bank-locked` (the "Locked" word, present only while locked), `control-scroll` (the scrolling middle), `<testid>-readout` for each fader. | Needed to prove AC12–AC18; none replaces an existing id. |
| PD12 | **Confirm.** `/send`'s styles (SD8, AC22). | `web/src/send/styles.ts`: the keys `Send.tsx` uses (`page`, `column`, `heading`, `linkLine`, `note`, `row`, `input`, `button`) with today's values copied verbatim from `web/src/control/styles.ts:6-95`. `web/src/control/styles.ts` is deleted in T7, once nothing imports it. | `/send` looks exactly as now and stops sharing the module; `/control`'s look moves to classes. |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `docs/design/controller-style.md` | Create | The style brief (SD3, AC1) — T1 |
| `docs/design/controller-style-mockups.html` | Create | The three arrangements, and the four-fader variants, to look at on a device (PD1) — T1 |
| `web/src/send/styles.ts` | Create | `/send`'s own copy of today's look (PD12) — T2 |
| `web/src/send/Send.tsx` | Modify | Import its own styles (`:14`) — T2 |
| `web/src/control/fader.ts` | Create | Pure gesture rules: relative drag, clamp, keys, readout, let-go (PD5, PD8) — T3 |
| `web/src/control/fader.test.ts` | Create | Its unit tests — T3 |
| `web/src/control/wheel-math.ts` | Modify | `createSendThrottle` gains `drop()` and `minGapMs` (PD6) — T3 |
| `web/src/control/wheel-math.test.ts` | Modify | Tests for both — T3 |
| `web/src/control/Fader.tsx` | Create | The fader component (PD4, PD7) — T4, axis in T5 |
| `web/src/control/controller.css` | Create, then Modify | Tokens and the fader (T4), shell and bank (T5), status bar (T6), the rest (T7) |
| `web/src/control/Controller.tsx` | Modify | Faders in (T4), shell and bank (T5), status bar (T6), classes (T7) |
| `web/src/control/Wheel.tsx` | Modify | Brightness as a fader (T4), look (T7) |
| `web/src/control/arrangement.ts` | Create | `arrangementFor`, `useArrangement` (PD3) — T5 |
| `web/src/control/arrangement.test.ts` | Create | Its unit tests — T5 |
| `web/src/control/FaderBank.tsx` | Create | The pinned bank: a list of faders, "Locked" — T5 |
| `web/src/control/device-link.ts` | Modify | `LINK_GROUP` (PD10) — T6 |
| `web/src/control/device-link.test.ts` | Modify | Every status has its group — T6 |
| `web/src/control/Approvals.tsx` | Modify | Badge in the status bar (T6), look (T7) |
| `web/src/control/VjPanel.tsx` | Modify | Look (T7) |
| `web/src/control/styles.ts` | Delete | Last importer gone — T7 |
| `docs/design/architecture.md` | Modify | One line naming the brief as the controller's look — T8 |
| `tests/contrast.ts` | Create | WCAG 2.x contrast ratio of two colours (`#rrggbb` or `rgb()`), for the meta and browser tests — T4 |
| `tests/meta/control-look.test.ts` | Create, then Modify | Import boundary (T2); selector scope, no `url(`/`@import`/`@font-face`, token contrast pairs (T4); status group pairs (T6) |
| `tests/browser/fader.ts` | Create | `setFader(locator, value)` by keyboard from the current `aria-valuenow` (≤ 10 presses: Page Up/Down then arrows; Home/End for 0 and 1), `faderValue(locator)`, `dragFader(page, locator, { from, by })` — T4 |
| `tests/browser/control-fader.spec.ts` | Create | AC2–AC11 in the browser — T4 |
| `tests/browser/control-layout.spec.ts` | Create | AC9 (re-laid out), AC12–AC16, AC18 — T5 |
| `tests/browser/control-look.spec.ts` | Create, then Modify | AC17, AC19 (T6); AC20, AC21, AC11's look (T7) |
| `tests/browser/control-scope.spec.ts` | Create, then Modify | `/send`'s look pinned (T2); `/`, `/builder`, `/trust` free of the controller's rules, `/control`'s requests (T8) |
| `tests/browser/control.spec.ts` | Modify | Dials to faders (T4); 48×48 includes sliders and the scroll region (T5) |
| `tests/browser/control-e2e.spec.ts` | Modify | Dials to faders, `watchLink` on `aria-disabled` (T4) |
| `tests/browser/control-modes.spec.ts` | Modify | Dials to faders (T4) |

## Tasks

Each task is one vertical slice that leaves the system working, reviewable in one sitting:
about ≤400 changed source lines (tests do not count) across ≤10 files. **Every task after T1
waits for H2** (the owner's approval of the brief, recorded below) — AC1, SD3.

### T1 — The style brief

- **Implements:** AC1, SD3
- **Expected output:** `docs/design/controller-style.md` with, in this order: the language (venue
  lighting gear in general — no manufacturer, logo, typeface or layout named or copied); the
  tokens as a table — background layers, text, muted text, the three status colours (ok,
  attention in the amber family, stop in the red family) with the text colour used on each, the
  active mark, the focus ring, the locked look, the fader track, cap and fill, type scale (system
  font stack only), spacing, radii, fader track cross size (≥ 56 CSS px) and cap dimensions; a
  contrast table naming every text pair (≥ 4.5:1) and every non-text pair of SD11 (≥ 3:1: cap
  against track, track against background, active mark against an inactive tile, focus ring
  against its surroundings, status bar colour against the page) with each ratio to two decimals;
  how the active tile and the locked look are marked by more than colour; the **budget
  arithmetic** for SD6 and SD9 — four faders at 320×568 horizontal in ≤ 284 px of height with
  travel ≥ 272 px, four at 568×320 vertical in ≤ 284 px of width with travel ≥ 180 px, two at
  768×1024 with travel ≥ 300 px — showing where the labels "Recognisability" and "Audio
  reactivity", the 0–100 readouts and "Locked" go in each (see Risks: at 320×568 they cannot
  have a row of their own); and a link to the mockups. `docs/design/controller-style-mockups.html`
  (PD1): one self-contained page showing phone portrait (320×568), phone landscape (568×320) and
  tablet (768×1024) at real CSS px, each in DJ and VJ mode, a locked state and a "Reconnecting…"
  bar, plus the four-fader variants of the first two; built from the brief's tokens (one
  `<style>` block, the same custom-property names the brief lists, so T4 can carry them over);
  the system font stack; static markup, no script needed to view it. No source file.
- **Verification:** `bash scripts/check.sh` (the format step covers both new files); every ratio
  recomputed with the WCAG 2.x relative-luminance formula by a scratch script whose output is
  pasted in the task's evidence; `grep -nE 'src=|href=|@import|url\(' docs/design/controller-style-mockups.html`
  shows nothing but in-page anchors and `data:` URLs; the page opened in Chromium from the file
  with the network off requests nothing beyond itself (Playwright `page.on("request")` from a
  scratch script, output in the evidence) and its three arrangements are screenshotted at their
  sizes into the evidence. Then H2.
- **Depends on:** —
- **Autonomy note:** the palette, sizes, wording and the mockup page's structure are the
  builder's to propose — the owner judges them at H2. Stop if the budget arithmetic cannot meet
  SD6 or SD9 with legible labels (that is a spec amendment, the owner's), or if the mockups need
  anything beyond the one HTML file (an image, a font, a script file).

### T2 — `/send` keeps today's look on its own module

- **Implements:** SD8, AC22
- **Expected output:** `web/src/send/styles.ts` (PD12) and `Send.tsx:14` importing it; no other
  change to `/send`. `tests/meta/control-look.test.ts`: no file outside `web/src/control/`
  imports `control/styles` or `controller.css`. `tests/browser/control-scope.spec.ts`, written
  and run green **before** the import moves: on `/send` over the LAN listener, the computed
  `background-color` of `sender` is `rgb(17, 17, 17)`, `link-line`'s is `rgb(34, 34, 34)` with
  `font-weight` 600 and `border-radius` 8px, the code input's border is `1px solid rgb(119, 119,
  119)` and its `min-height` 48px, the submit button's background `rgb(42, 42, 42)`. About 70
  source lines, 2 files.
- **Verification:** `pnpm run test --project unit tests/meta/control-look.test.ts`;
  `pnpm test:browser tests/browser/control-scope.spec.ts tests/browser/send.spec.ts`; then
  `bash scripts/check.sh`.
- **Depends on:** T1 (and H2 recorded)
- **Autonomy note:** which computed properties pin the look is the builder's, as long as each
  `styles.ts` key `Send.tsx` uses is covered once. Stop if `Send.tsx` uses a key not in PD12's
  list in a way that changes what the copy must hold.

### T3 — The fader's gesture rules, without a browser

- **Implements:** SD9, AC2, AC3, AC4, AC5, AC7, AC9, AC10
- **Expected output:** `web/src/control/fader.ts`: `createFaderGesture({ send, throttle deps })`
  with `down(pointerId, position, value, travel)`, `move(pointerId, position)` (returns the
  shown value), `up(pointerId)`, `letGo()`, `key(key, value)` (returns the new value or `null`
  for an unhandled key or no change), `held()`; `readout(value)` (PD8). A second pointer while
  one is held is ignored; a `down` then `up` without a `move` sends nothing; `letGo()` drops the
  pending send and sends nothing more for that drag, and a later `up` of that pointer sends
  nothing. `createSendThrottle` gains `drop()` and `minGapMs` (PD6); the wheel's use is
  unchanged. No UI change. About 150 source lines, 2 files.
- **Verification:** `pnpm run test --project unit web/src/control/fader.test.ts web/src/control/wheel-math.test.ts`
  — with fake frames and clock: tap without move sends nothing (AC2); a drag of 0.3 × travel
  from a down at 10 % and from one at 90 % both change the value by 0.30 ± 0.01 (AC3); a drag
  past 1 then back by 0.1 × travel reads 0.90 (AC4); 100 moves inside one frame send one value,
  release sends the last at once, and two gestures driven at 120 frames a second send ≤ 100 in a
  simulated second (AC5, PD6); every key of PD5 at 0, 0.5 and 1 (AC7); `letGo()` mid-drag then
  `up` sends nothing more (AC9); a second pointer is ignored (SD9); `readout(0.42)` is 42 and
  `readout(0.425)` is 42 or 43 consistently with `Math.round` (AC10); `drop()` cancels the frame
  and forgets the value; the existing wheel-math tests pass unchanged.
- **Depends on:** T1 (and H2 recorded)
- **Autonomy note:** the module's shape and names are the builder's. Stop if the existing
  `wheel-math.test.ts` cases need changing to fit `drop()` or `minGapMs` — the wheel's behaviour
  must not move.

### T4 — The fader replaces both native ranges

- **Implements:** SD2, SD7, SD12, SD13, SD14, AC2, AC3, AC5, AC6, AC7, AC8, AC9, AC10, AC11,
  AC21
- **Expected output:** `web/src/control/Fader.tsx` (PD4, PD5, PD7, PD8) on `fader.ts`, with
  pointer capture, its own throttle, and let-go on `pointercancel`, `blur` and `disabled`
  becoming true. `controller.css` created with the whole token block from the brief (custom
  properties on `.djv-control`) and the fader's rules, including its focus ring; rendered by
  `Controller.tsx` as in PD2, with `class="djv-control"` on `<main>`. The two dials
  (`Controller.tsx:277-300`) become two horizontal `Fader`s in the same place, label and readout
  per the brief; `moving`, `held`, `hold`, `letGo` and the lock effect (`:66-109`) are removed.
  `Wheel.tsx:170-185`'s range becomes a horizontal `Fader` whose send calls
  `change({ ...hsv, v }, true)`. Everything else keeps today's inline styles. About 330 source
  lines, 5 files (`Fader.tsx`, `controller.css`, `Controller.tsx`, `Wheel.tsx`; no change to
  `fader.ts` expected).
  Tests: `tests/browser/fader.ts`; `tests/contrast.ts`; `tests/meta/control-look.test.ts` gains
  the selector-scope, no-`url(`/`@import`/`@font-face`, and token-pair contrast checks (pairs
  from the brief's table); `tests/browser/control-fader.spec.ts` — at 320×568 paired: a tap on
  the track away from the cap changes neither the screen's `slider-recognisability` nor sends a
  `"type":"dials"` frame (counted with `ws.on("framesent")`, AC2); a drag starting away from the
  cap moves the screen by the drag ÷ the slider's width ± 0.01 (AC3); two touch pointers
  through a CDP session (`Input.dispatchTouchEvent`, context with `hasTouch`) drag both faders
  at once and the screen ends on both last values (AC6); keys of PD5 (AC7); `getByRole("slider",
  { name: "Recognisability" })` with the `aria-*` of AC8; panel at 0.42 reads `42` in
  `dial-recognisability-readout` and in `aria-valuetext` (AC10); the screen's value shows after
  release, after `pointercancel`, after blur, and after a lock (`context.setOffline(true)`)
  mid-drag with no further `dials` frame (AC9); `wheel-brightness` driven by keys and by a drag
  changes `wheel-current` (AC11); a fader focused by Tab shows an outline whose colour is ≥ 3:1
  against the bank's background (AC21, fader part).
- **Existing tests this makes untrue, amended here:**
  - `tests/browser/control.spec.ts:91, 99-106, 118-127` (`.fill()`, `toHaveValue` on dials) →
    `setFader` and `aria-valuenow`; `:109-140` rewritten for the fader: after a key, after a
    release, after a `pointercancel` mid-drag starting away from the cap (the old `box.width *
    0.5` start assumed a native jump).
  - `tests/browser/control-e2e.spec.ts:112-127` (`watchLink` reads `dial.disabled`, observes
    `disabled`) → `aria-disabled`; `:198-206, 226, 236, 252, 259, 271, 285, 371, 500-504, 509,
    562, 576` → `setFader` / `aria-valuenow`.
  - `tests/browser/control-modes.spec.ts:185, 200` → `setFader`. `:170-172` (`wheel-brightness`
    focus + ArrowLeft) stays true — watch it.
  - Stays true, watch: `toBeDisabled()` on dials (`control.spec.ts:216`,
    `control-e2e.spec.ts:276, 558`) via `aria-disabled` (PD7).
- **Verification:** `pnpm run test --project unit tests/meta/control-look.test.ts`;
  `pnpm test:browser tests/browser/control-fader.spec.ts tests/browser/control.spec.ts tests/browser/control-e2e.spec.ts tests/browser/control-modes.spec.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** T2, T3
- **Autonomy note:** component structure, the helper's key sequence and the CDP plumbing are the
  builder's. Stop if two-pointer touch cannot be driven in headless Chromium (AC6 would rest on
  the unit test alone — the owner's call), if `?inline` does not work in `pnpm dev` or the
  build, or if a token from the brief fails its contrast pair (the brief changes, H2 again).

### T5 — Pinned status bar, scrolling middle, pinned fader bank, two arrangements

- **Implements:** SD1, SD5, SD6, SD9, AC9, AC12, AC13, AC14, AC15, AC16, AC18
- **Expected output:** `arrangement.ts` (PD3); `FaderBank.tsx` taking a list of fader
  definitions and `locked`, showing `bank-locked` ("Locked") and the brief's locked look while
  locked, shown only once the state has arrived; `Controller.tsx` restructured into
  `<main class="djv-control" data-arrangement>`: the link line in a pinned top bar (its own
  colours come in T6), `control-scroll` holding the code field, mode toggle, tiles, main audio,
  Primary colour and VJ's panel, and the bank — bottom with horizontal faders in the horizontal
  arrangement, right edge under the bar with vertical faders otherwise. `Fader.tsx` gains its
  vertical axis and lets go when its orientation changes mid-drag. The bank's layout is CSS
  keyed off `[data-arrangement]` only (PD3), so it holds up to four faders without JS. About 310
  source lines, 6 files.
  Tests: `arrangement.test.ts` (599×600 horizontal, 600×601 vertical, 320×320 vertical, 568×320
  vertical); `tests/browser/control-layout.spec.ts` — bank at the bottom edge with slider width ≥
  0.85 × 320 at 320×568, at the right edge with slider height ≥ 180 at 568×320 and ≥ 300 at
  768×1024 (AC12); `control-scroll` scrolled to its end, `status-bar` region and `fader-bank`
  fully inside the viewport in DJ and VJ at 320×568 and 568×320 (AC13); `setViewportSize` from
  320×568 to 568×320 with a `window` marker kept (no reload), mode, "Connected" and both
  `aria-valuenow` unchanged (AC14); mid-drag resize: the screen's value shows and no `dials`
  frame follows the release (AC9); at 320×568, 320×640, 568×320, 768×1024, 1024×768, in DJ and
  VJ, started, with a long profile name: `scrollWidth ≤ clientWidth` on `controller` and
  `control-scroll`, and every visible `button`, `input` and `[role=slider]` ≥ 48×48 (AC15);
  PD9's clones: bank height ≤ 284 at 320×568, bank width ≤ 284 at 568×320, AC15 still true
  (AC16); `context.setOffline(true)` → both faders `aria-disabled`, `bank-locked` visible; back
  online → both gone (AC18).
- **Existing tests this makes untrue, amended here:** `tests/browser/control.spec.ts:249-274`
  (measures only `controller` and only `button, input`) → also `control-scroll` and
  `[role=slider]`; its 320×640 case stays.
- **Verification:** `pnpm run test --project unit web/src/control/arrangement.test.ts`;
  `pnpm test:browser tests/browser/control-layout.spec.ts tests/browser/control.spec.ts tests/browser/control-fader.spec.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** T4
- **Autonomy note:** markup and CSS are the builder's within the brief. Stop if AC16 or AC12
  cannot both hold with the brief's dimensions (the brief or the spec changes — the owner's), or
  if a pinned bank breaks the B-04 first-open rule (`modes.initial(window.innerWidth)`, which
  stays as is).

### T6 — The status bar's colours and the waiting badge in it

- **Implements:** SD4, SD10, AC17, AC19
- **Expected output:** `LINK_GROUP` (PD10); the top bar becomes `status-bar` with
  `data-link-group` and the group's colours from the tokens, text always shown, wrapping on a
  narrow screen; in DJ mode `WaitingBadge` renders in the bar instead of the mode row
  (`Controller.tsx:169-178` moves), its dialog unchanged; VJ's inline list unchanged. About 90
  source lines, 4 files (`device-link.ts`, `Controller.tsx`, `Approvals.tsx`, `controller.css`).
  Tests: `device-link.test.ts` — every `LinkStatus` maps to SD4's group (a table, one row per
  status); `tests/meta/control-look.test.ts` — the text on each group colour ≥ 4.5:1 and each
  group colour ≥ 3:1 against the page; `tests/browser/control-look.spec.ts` — "Waiting for
  approval" and "Reconnecting…" (offline) show `attention`, "Connected" `ok`, "Wrong code" and
  "Pairing ended — scan the code again" (External control switched off) `stop`, each with the
  computed text colour ≥ 4.5:1 against the computed bar colour (AC17); at 320×568 in DJ mode a
  second device's request puts `waiting-badge` inside `status-bar`, it opens the dialog, Accept
  approves (AC19); with the badge and "Too many wrong codes — try again in a minute"-length text
  at 320×568, AC16's budget still holds.
- **Verification:** `pnpm run test --project unit web/src/control/device-link.test.ts tests/meta/control-look.test.ts`;
  `pnpm test:browser tests/browser/control-look.spec.ts tests/browser/control.spec.ts tests/browser/control-layout.spec.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** T5
- **Autonomy note:** which states the browser test reaches is the builder's beyond the five
  named (the unit table covers all thirteen). Stop if any `LINK_TEXT` would need to change.

### T7 — The rest of `/control` in the brief's look; `control/styles.ts` goes

- **Implements:** SD8, SD11, AC11, AC20, AC21
- **Expected output:** every remaining inline look in `Controller.tsx`, `VjPanel.tsx`,
  `Approvals.tsx` and `Wheel.tsx` moves to classes in `controller.css`: code field and Connect,
  mode toggle, profile and camera tiles (with the remote mark), main audio, Primary colour, VJ's
  swatches, status strip and pending list, the approvals dialog, the wheel's dialog. The active
  profile tile, camera tile, mode and main audio choice carry the brief's mark (more than
  colour, AC20); every control has the brief's focus ring on `:focus-visible` (AC21); one dark
  theme, no `prefers-color-scheme`. Inline styles remain only for data-driven values (swatch
  colours, the wheel's marker position, a fader's level). `web/src/control/styles.ts` deleted.
  About 350 source lines (net of the deleted 95), 6 files.
  Tests: `tests/browser/control-look.spec.ts` — with an audio sender (`remote(server)` and
  `r.pairedSender` from `tests/browser/remote-fixtures.ts`), started, two profiles: the active
  profile tile, camera tile, mode button and main audio button each differ from their inactive
  sibling in a non-colour computed property the brief names (border width, an inset bar, …) and
  the mark's colour is ≥ 3:1 against the inactive tile's background (AC20); Tab through every
  control on `/control` and in the wheel dialog, each focused element's outline (or the brief's
  ring) ≥ 3:1 against its background (AC21); the wheel dialog opens, the disc and brightness work
  by keyboard alone, Reset and Done behave as before (AC11). Every B-04 and B-06 `/control` spec
  passes unchanged.
- **Verification:** `pnpm test:browser tests/browser/control-look.spec.ts tests/browser/control.spec.ts tests/browser/control-modes.spec.ts tests/browser/remote-control.spec.ts tests/browser/control-layout.spec.ts`;
  then `bash scripts/check.sh`.
- **Depends on:** T6
- **Autonomy note:** class names and CSS structure are the builder's within the brief. Stop if a
  behaviour has to change to get the look (SD8: behaviour unchanged), or if this grows past ~400
  source lines — split it then at the dialogs (`Wheel.tsx`, `Approvals.tsx`) as a T7b.

### T8 — Proofs across routes, and the architecture line

- **Implements:** AC22, AC23, AC24
- **Expected output:** `tests/browser/control-scope.spec.ts` gains: on `/`, `/builder`, `/send`
  and `/trust`, no element matches `.djv-control` and no stylesheet in `document.styleSheets`
  has a rule whose selector contains `djv-control`, and `/send`'s pinned values (T2) still hold
  (AC22); a paired `/control` at 320×568 through pairing, a tile, both faders, the wheel and a
  turn to 568×320 requests only `GET /control`, `GET /assets/*` and `WS /api/control/device`
  (AC23). `docs/design/architecture.md`: one line in the `web/` row (`:73`) or the External
  control section naming `docs/design/controller-style.md` as the controller's look. No source
  change.
- **Verification:** `pnpm test:browser tests/browser/control-scope.spec.ts`;
  `git diff --stat main...HEAD -- shared server engine audio` prints nothing (AC24);
  `bash scripts/check.sh` green with every B-04 and B-06 spec in it (AC24).
- **Depends on:** T7
- **Autonomy note:** wording of the architecture line is the builder's. Stop if `/control`
  requests anything outside the three, or if any file under `shared/`, `server/`, `engine/` or
  `audio/` shows in the diff.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1 | `docs/design/controller-style.md`, `docs/design/controller-style-mockups.html` |
| — | H2 | the owner's approval, recorded below; blocks every group after 1 |
| 2 | T2, T3 | T2: `web/src/send/styles.ts`, `web/src/send/Send.tsx`, `tests/meta/control-look.test.ts`, `tests/browser/control-scope.spec.ts`. T3: `web/src/control/fader.ts`, `fader.test.ts`, `wheel-math.ts`, `wheel-math.test.ts` |
| 3 | T4 | `Fader.tsx`, `controller.css`, `Controller.tsx`, `Wheel.tsx`, `tests/contrast.ts`, `tests/meta/control-look.test.ts`, `tests/browser/fader.ts`, `control-fader.spec.ts`, `control.spec.ts`, `control-e2e.spec.ts`, `control-modes.spec.ts` |
| 4 | T5 | `arrangement.ts`, `arrangement.test.ts`, `FaderBank.tsx`, `Fader.tsx`, `Controller.tsx`, `controller.css`, `control-layout.spec.ts`, `control.spec.ts` |
| 5 | T6 | `device-link.ts`, `device-link.test.ts`, `Controller.tsx`, `Approvals.tsx`, `controller.css`, `tests/meta/control-look.test.ts`, `control-look.spec.ts` |
| 6 | T7 | `Controller.tsx`, `VjPanel.tsx`, `Approvals.tsx`, `Wheel.tsx`, `controller.css`, `styles.ts` (deleted), `control-look.spec.ts` |
| 7 | T8 | `tests/browser/control-scope.spec.ts`, `docs/design/architecture.md` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph
docs/plans/phase-b-19-controller-lighting-desk.md` prints the groups the `Depends on` fields
actually give.

## Data changes

None. No table, no migration, no new browser storage key (`djv.controlMode`, `djv.controlKey`
unchanged).

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| **The four-fader budget is tight.** At 320×568 horizontal, four tracks of ≥ 56 px already take 224 of the 284 px; a label row of its own per fader (≈ 18 px) makes 296 + gaps. At 568×320 vertical, four columns of ≥ 56 px leave ≈ 66 px each, narrower than "Recognisability" at 14 px. So labels and readouts must sit on or inside the track (horizontal) and be stacked, rotated or set small (vertical). | T1 must show the arithmetic and the label placement for both, and the owner judges legibility at H2. If no legible answer fits, T1 stops: SD6 is the spec's, and B-16/B-18 inherit it. |
| The server drops controls beyond 120 a second quietly (`server/src/control/channel.test.ts:98`); two faders at 16 ms each could reach 125 and lose a release. | PD6: faders at 20 ms (≤ 100 a second for both), unit-tested at 120 frames a second; the test helper's key sequences stay ≤ 10 presses. |
| Two-pointer touch (AC6) in headless Chromium through CDP may not yield two pointer ids with capture. | Tried first in T4; if it fails, T4 stops and the owner decides whether AC6 rests on the unit test plus H3. |
| iOS Safari: pointer capture and `touch-action: none` on a `div` slider, and Quick Look rendering of PD1's HTML. | H3 on the owner's phone. For the mockups: static markup with no script, so Quick Look's preview shows it; if it still does not, the owner opens it in Safari or Chrome from the Files app at H2 (no plan change). |
| About 30 dial lines across three spec files change in T4; a wrong conversion hides a regression. | One helper (`tests/browser/fader.ts`) for all; each converted assertion keeps its value; the review checks the list under T4 line by line. |
| React reconciling the bank while PD9's clones are in it. | Clone, measure and remove with no state change in between; re-clone after a resize. |
| A token fails a contrast pair late (T4/T6) after H2 approved the brief. | `tests/meta/control-look.test.ts` reads the tokens from `controller.css` and the pairs from the brief's table; a failure stops the task and the brief goes back to H2. |
| Restyling the status bar could hide the D-10 watcher's signal (`control-e2e.spec.ts:105-127`). | `link-line` keeps its id and text; T4 moves the watcher to `aria-disabled`. |

## Human steps

- **H1 — before `/audit`.** Commit the working copy (the spec, `docs/backlog.md`) and this plan on
  a docs branch, as for B-03, B-06 and B-12. `/build` needs a clean tree.
- **H2 — after T1, before any other task** (AC1, SD3; spec Verification 2). The owner reads
  `docs/design/controller-style.md` and opens the mockups on a phone (portrait and landscape) and
  a tablet, and approves or returns it. Record here: *Brief approved by Martijn Boot on 2026-11-19.*
  Until that line is filled, `/build` starts nothing after T1.
- **H3 — after T8** (spec Verification 3, the exit condition; AC6, AC12, AC17 and AC20 judged
  by eye). On the screen machine, phone and tablet, in a darkened room at arm's length: pair
  both; in DJ mode on the phone in portrait move both faders with a thumb landing off the cap,
  then both at once, turn the phone and do it again; read the readouts; in VJ mode on the tablet
  edit a swatch with the brightness fader; drop the Wi-Fi and read the status bar at a glance;
  tell the active profile tile from the others without looking closely; judge that the
  controller reads as lighting gear next to the decks.
- Pushing, the PR and the merge are the owner's.

## Out of scope for this plan

- B-16's always-visible wheel and any space for it; B-18's effect faders (SD6: only the
  capacity, proven by PD9's clones).
- Any change to `shared/`, `server/`, `engine/`, `audio/` (AC24), the screen page and its panel,
  the builder, `/trust`.
- Editing the B-04 spec: SD13's amendments are recorded in the B-19 spec, not written into B-04.
- D-04 (colour-drag round trip over Wi-Fi): PD6 is not claimed to fix it.

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

Audited by: Martijn Boot  Date: 2026-11-19

PD2–PD12 confirmed as written at the audit; T4 kept as one task (the file limit counts source files).
