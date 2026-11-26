# Controller style brief

Status: Approved by Martijn Boot on 2026-11-19 (B-19 plan, H2) · Spec:
[phase-b-19-controller-lighting-desk](../specs/phase-b-19-controller-lighting-desk.md) (SD3, AC1) ·
Plan: [phase-b-19-controller-lighting-desk](../plans/phase-b-19-controller-lighting-desk.md) (T1) ·
Mockups: [controller-style-mockups.html](controller-style-mockups.html)

Amended by B-16 (SD6), approved by Martijn Boot on 2026-11-24 at `/review` (H1) · Spec:
[phase-b-16-colour-wheel-always-on](../specs/phase-b-16-colour-wheel-always-on.md) · Plan:
[phase-b-16-colour-wheel-always-on](../plans/phase-b-16-colour-wheel-always-on.md) (T6): the
colour wheel's dialog becomes the pinned colour block; no new token.

Amended by B-18 (SD9), approval at `/review` · Spec:
[phase-b-18-effect-strength-faders](../specs/phase-b-18-effect-strength-faders.md) · Plan:
[phase-b-18-effect-strength-faders](../plans/phase-b-18-effect-strength-faders.md) (T7): a third
fader in the bank for the DJ-ticked effect, the Effects section in VJ mode, the stored-value tick,
the three-fader Budget rows; no new token.

The look of `/control`, and only `/control` (SD8). Every later B-19 task builds against this
file: the tokens below become custom properties on `.djv-control` in
`web/src/control/controller.css` under the same names, and `tests/meta/control-look.test.ts`
reads the contrast table below to check them. A change to a token or a pair is a change to this
file and goes back to the owner.

## Language

Venue lighting gear in general: a dark, matte panel; controls grouped into framed sections with
small upper-case legends printed on the panel; keys that light up when they are the active
choice; long-throw faders with a plain groove, a solid cap with an index line and a level that
reads at a glance; one status strip that changes colour with the link, like a status lamp. Light
comes only from things that mean something — the active choice, the levels, the link — so in a
dark booth the eye goes straight to them.

No manufacturer, product, logo, typeface or panel layout is named, copied or imitated. The type is
the device's own system font. No image, icon file, web font, sound or animation (SD12, Out of
scope).

## Tokens

### Colours

One dark theme; `prefers-color-scheme` is ignored (SD11).

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0b0c0e` | The page: the scrolling area behind the sections; the code field; the waiting badge |
| `--panel` | `#15181c` | A section's surface, the fader bank, the colour block, dialogs |
| `--line-soft` | `#2e343c` | A section's frame (decoration; no contrast needed) |
| `--line` | `#69727e` | Every control's edge: keys, tiles, the code field, fader tracks, the bank's and the colour block's edge, the disc's edge |
| `--key` | `#23272e` | A key or tile at rest |
| `--text` | `#eef1f4` | Text; the 3 px edge of a lit key; the wheel's target mark under a swatch |
| `--text-muted` | `#a3acb7` | Section legends, fader labels, notes, the VJ status strip |
| `--text-disabled` | `#6b737e` | A disabled key's text (inactive controls are exempt from 4.5:1) |
| `--select` | `#3db8f5` | The lit key (the active choice), the fader's level fill, the primary swatch's mark |
| `--on-select` | `#04141c` | Text on a lit key |
| `--ok` | `#1a7f45` | Status bar, ok group (green family) |
| `--on-ok` | `#ffffff` | Status bar text, ok group |
| `--attention` | `#f0a500` | Status bar, attention group (amber family); the "Locked" tag; the waiting badge's text and edge |
| `--on-attention` | `#120d00` | Text on the attention colour |
| `--stop` | `#c62828` | Status bar, stop group (red family) |
| `--on-stop` | `#ffffff` | Status bar text, stop group |
| `--track` | `#191c21` | A fader's track |
| `--hatch` | `#262b32` | The second stripe of a locked track's hatching; the stripes over a locked disc |
| `--fill` | `#3db8f5` | The level fill in the groove (the select colour) |
| `--cap` | `#e6e9ed` | The fader cap |
| `--cap-line` | `#0b0c0e` | The cap's index line and its 2 px outline |
| `--cap-locked` | `#7d8590` | The cap while locked (dimmed, still readable) |
| `--fill-locked` | `#4a525c` | The level fill while locked |
| `--focus` | `#ffffff` | The focus ring |
| `--focus-halo` | `#000000` | The 2 px gap between a control and its focus ring |

### Type, sizes, spacing, radii

| Token | Value | Use |
|---|---|---|
| `--font` | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Everything; the device's own font, nothing downloaded |
| `--fs-body` | 16px, line height 20px | Keys, tiles, the code field, the status bar (weight 700) |
| `--fs-note` | 14px, line height 18px | Notes, the VJ status strip, the remote mark (12px) |
| `--fs-legend` | 12px, line height 16px, weight 700, upper case, letter spacing 0.08em | Section legends, the bank's legend |
| `--fs-label` | 13px, line height 16px, weight 700, upper case, letter spacing 0.06em | Fader labels, the "Locked" tag |
| `--fs-readout` | 18px, line height 18px, weight 700, tabular figures | Fader readouts (0–100) |
| `--target` | 48px | Smallest touch target, both ways (B-04, kept) |
| `--space-1` … `--space-4` | 4px, 8px, 12px, 16px | Gaps and padding |
| `--radius-key` | 6px | Keys, tiles, the code field |
| `--radius-panel` | 8px | Sections |
| `--radius-dialog` | 10px | Dialogs |
| `--radius-track` | 4px | Fader tracks |
| `--radius-cap` | 3px | Fader caps |
| `--bar-min` | 48px | The status bar's smallest height |
| `--fader-cross` | 56px | A fader's cross size: the whole track is the touch target (SD9) |
| `--fader-edge` | 2px | The track's edge, in `--line` |
| `--cap-along` | 22px | The cap's size along the travel |
| `--cap-across` | 30px | The cap's size across the travel |
| `--groove` | 6px | The groove's width; the fill is the same width |
| `--label-band` | 18px | The strip inside the track that holds the label (and, horizontal, the readout) |
| `--readout-band` | 22px | Vertical only: the strip at the top of the track that holds the readout |
| `--bank-legend` | 16px | The bank's legend row |
| `--bank-gap` | 6px | Between the bank's legend row and faders, and between faders |
| `--bank-pad-block` | 6px | The bank's padding, top and bottom |
| `--bank-pad-inline` | 8px | The bank's padding, left and right |

## The parts

- **Status bar** (top, pinned, full width). The bar is the colour of the link's group (SD4), its
  text the group's text colour, 16px bold, wrapping rather than truncating. Height `--bar-min`,
  growing 20px a line: at 320px the longest text takes two lines (52px), or three (72px) beside
  the badge. In DJ mode the waiting badge sits at its right end as a key the bar's full height,
  never wrapping its own words: `--bg` with `--attention` text and a 2px `--attention` edge, so
  it stands apart from all three bar colours.
- **Scrolling area** (`--bg`, 8px padding). Each block is a section: `--panel`, 1px `--line-soft`
  frame, `--radius-panel`, 10px padding. A section's heading today becomes its legend, in
  `--fs-legend` `--text-muted`, like a label printed on the panel: PROFILE, CAMERA, MAIN AUDIO,
  PALETTE, WAITING FOR APPROVAL, and TRANSITION in VJ mode (B-09, approved by the owner at its
  plan's audit, 2026-11-23), and EFFECTS in VJ mode under it (B-18, below). No other heading is
  added or removed. The mode toggle (DJ, VJ) is a row
  of two keys above the sections; VJ's status strip sits in a section without a legend, as today.
  The colour block is not in the scrolling area: it is pinned (below).
- **Keys and tiles.** At rest: `--key`, 1px `--line` edge, `--text`, weight 600, at least
  `--target` both ways. Tiles keep today's grid (`minmax(120px, 1fr)`) and wrap a long name.
  Disabled: `--text-disabled` text and a dashed edge.
- **Lit key — the active mark** (active profile tile, active camera tile, active mode, active main
  audio choice). `--select` background, `--on-select` text, weight 800 and a **3px
  `--text` edge** instead of 1px `--line`. It is marked three ways: a light surface instead of a
  dark one (lightness, not only hue), a three-times-heavier edge, and heavier type — the edge
  width and the weight are what T7's test reads as "more than colour" (AC20). A lit key that is
  disabled keeps its light surface and takes the dashed edge.
- **Code field.** `--bg`, 1px `--line` edge, `--radius-key`, letter spacing 4px, upper case.
  Connect is a key.
- **Palette swatches** (VJ mode). The swatch shows its own colour; its edge is 2px
  `--text-muted`. The primary swatch's edge is 4px `--select`. The swatch the pinned wheel aims at
  is pressed and carries the **target mark**: a 4px `--text` bar, 6px in from each side, 4px below
  the swatch, on the section — so it holds 3:1 whatever the swatch's colour, and it is neither the
  primary's edge nor the focus ring. Exactly one swatch carries it, the primary by default; the
  primary swatch then shows both marks (B-16 PD2).
- **VJ status strip.** `--fs-note`, `--text-muted`, tabular figures, items with a 16px gap.
- **Dialogs** (approvals only). `--panel`, 1px `--line` edge, `--radius-dialog`, 16px
  padding, the page behind dimmed by a backdrop of black at 72%.
- **Focus ring** (every control, `:focus-visible`). A 3px `--focus` outline 2px outside the
  control, the 2px gap filled with `--focus-halo`. White against the dark page and panels, black
  against anything light, so it holds 3:1 wherever it lands.

### The colour block (B-16 SD1, SD2, SD5)

Pinned between the scrolling area and the bank, never a dialog, once the screen's state has
arrived (as the bank). `--panel`, 8px padding, and a `--fader-edge` `--line` edge on the side it
meets the scrolling area: the top in the horizontal arrangement, the left in the vertical one.
The focus order is the page's: status bar, scrolling area, block (disc, brightness, Reset), bank.

- **Disc.** `--disc` square: `clamp(150px, 31.25vmin, 240px)`, so 150px at 320×568, 320×640 and
  568×320 and 240px at 768×1024 and 1024×768, the same in both modes. A hue and saturation disc
  drawn on a canvas (240×240, scaled), with a 2px `--line` edge over its rim. The marker is a 16px
  ring, 2px white with a 2px black ring outside it — the focus ring's two tones, so it holds 3:1
  on any colour of the disc.
- **Brightness.** The fader, standing vertically beside the disc at the disc's height, in both
  arrangements: the vertical fader below, selected by class (`.djv-fader.is-vertical`).
- **Label.** `--fs-legend` `--text-muted`: "COLOUR *n* · PRIMARY" on the primary slot, "COLOUR
  *n*" on any other. At 320 CSS px it may wrap to two lines.
- **Pair.** The colour on screen and the stored colour, each a 24px swatch with a 2px
  `--text-muted` edge: the first captioned with its hex value, the second with "stored"
  (`--fs-note`, `--text-muted`, tabular figures). They are not targets.
- **Reset.** A key.
- **Horizontal** (phone portrait): full width; the disc on the left, the brightness fader beside
  it, then an 86px column at 320 CSS px holding the label, the pair and Reset, top to bottom.
- **Vertical** (phone landscape, tablet): a column under the status bar, left of the bank; the
  disc and the fader on top, the label under them, then the pair with Reset beside it.
- **Locked.** The label's place shows the "Locked" tag; the disc is covered by the bank's 135°
  stripes, every other 6px stripe `--hatch` over the disc's colours; the brightness fader takes the
  fader's locked look and Reset the disabled key's. Nothing moves.

### The effect faders (B-18 SD1, SD8, SD10)

An effect's strength is a fader like any other, labelled with the effect's name as the builder
shows it (the built-in type, or the custom effect's label), with the stored-value tick below.

- **In the bank.** The effect ticked for DJ mode is the bank's third fader, after the two dials,
  in DJ and VJ mode alike, orientation as the bank's. A profile with no DJ tick keeps the
  two-fader bank; the fourth place stays free (B-23).
- **The Effects section** (VJ mode only). A section like the others, legend EFFECTS, right under
  TRANSITION; one horizontal fader per effect ticked for VJ mode and not for DJ mode, in the
  profile's stack order, 8px apart (the section's gap), as B-09's Duration fader sits outside the
  bank. Absent when there is none, and in DJ mode. Height = 2 (frame) + 10 (pad) + 16 (legend) +
  (8 + 56)·n + 10 (pad) = **38 + 64·n** px: 166px with two.

### The fader

The slider element is the whole track, `--fader-cross` thick: `--track` with a `--fader-edge`
`--line` edge and `--radius-track`. Its length along the axis is the travel (plan PD5).

- **Horizontal** (56px tall): the top `--label-band` holds the label at the left (`--fs-label`,
  `--text-muted`) and the readout at the right (`--fs-readout`, `--text`). The lower 34px is the
  travel band: a `--groove`-wide groove in `--bg` from 11px to 11px short of each end, the level
  filled in `--fill` from the left end to the cap's centre, and the cap — `--cap-along` wide,
  `--cap-across` tall, `--cap` with a 2px `--cap-line` outline and a 2px `--cap-line` index line
  across its middle. Right is more.
- **Vertical** (56px wide): the top `--readout-band` holds the readout, centred. Below it, the
  left `--label-band` holds the label turned to read from bottom to top, anchored at the bottom.
  The remaining 34px-wide band holds the groove, the fill (from the bottom up to the cap's
  centre) and the cap (`--cap-across` wide, `--cap-along` tall). Up is more.
- The cap's centre runs from 11px inside one end of the travel band to 11px inside the other,
  while the value covers the full range over the slider's full length (PD5). So the cap moves a
  little less than the finger: 278px for 304px (91%) horizontal at 320 CSS px, 190px for 238px
  (80%) vertical at 568×320, where the readout band and the edges also take their share. It
  never animates (SD9).
- The label and the readout sit on the track and pass no pointer events; the whole box is the
  touch target.
- **The stored-value tick** (B-18 SD6, PD9; effect faders only). A 2px bar of `--text` across the
  travel band at the stored value, placed by the cap's own maths, from the label band (the
  readout band's side in the vertical fader) to the track's outer edge, ending there in a 6px
  diamond notch of the same colour. It is drawn under the cap, so the cap covers its middle when
  the value is the stored one and its two ends and the notch still show: a shape, never a colour
  alone. It stays put while the value moves; the dials have none.

### The locked look (SD4, AC18)

While the controls are locked, each track is hatched — 135° stripes of `--track` and `--hatch`,
6px each — the cap turns `--cap-locked`, the fill `--fill-locked`, a stored-value tick
`--cap-locked` in the same shape (B-18), and the bank's legend row
shows a **"Locked"** tag in place of its "Faders" legend: `--fs-label` in `--on-attention` on
`--attention`, 6px side padding. So the locked look is the hatching, the dimmed cap and the word,
not a colour alone. The colour block does the same in its label's place, with the stripes over
the disc (above). The readouts and caps stay where the screen's values put them. Every
control the lock disables today takes its disabled look (dashed edge); the mode toggle stays
live, as today.

### Status groups (SD4, plan PD10)

| Group | Bar | Text | Link texts (`LINK_TEXT`, unchanged) |
|---|---|---|---|
| ok | `--ok` | `--on-ok` | Connected |
| attention | `--attention` | `--on-attention` | Scan the code on the screen machine · Connecting… · Waiting for approval · Reconnecting… · Screen not connected |
| stop | `--stop` | `--on-stop` | Request rejected · Request expired — try again · Wrong code · Too many devices · Another device is sending audio · Too many wrong codes — try again in a minute · Pairing ended — scan the code again |

## Contrast

WCAG 2.x contrast ratio, `(L1 + 0.05) / (L2 + 0.05)` of the relative luminances, to two decimals.
Text pairs need at least 4.5:1, non-text pairs at least 3:1 (SD11). The table is read by
`tests/meta/control-look.test.ts` from T4 on: one pair per row, the tokens by name.

| Pair | Foreground | Background | Minimum | Ratio | Where |
|---|---|---|---|---|---|
| T1 | `--text` | `--bg` | 4.5 | 17.26 | Text on the page, the code field's text |
| T2 | `--text` | `--panel` | 4.5 | 15.71 | Text in a section, the bank, a dialog |
| T3 | `--text` | `--key` | 4.5 | 13.22 | A key's or tile's text |
| T4 | `--text-muted` | `--bg` | 4.5 | 8.52 | Muted text on the page |
| T5 | `--text-muted` | `--panel` | 4.5 | 7.75 | Section legends, notes, the status strip, the bank's legend |
| T6 | `--text-muted` | `--key` | 4.5 | 6.52 | The remote mark on a tile |
| T7 | `--text-muted` | `--track` | 4.5 | 7.44 | A fader's label |
| T8 | `--text` | `--track` | 4.5 | 15.07 | A fader's readout |
| T9 | `--text-muted` | `--hatch` | 4.5 | 6.20 | A fader's label while locked |
| T10 | `--text` | `--hatch` | 4.5 | 12.57 | A fader's readout while locked |
| T11 | `--on-select` | `--select` | 4.5 | 8.35 | A lit key's text |
| T12 | `--on-ok` | `--ok` | 4.5 | 5.04 | Status bar text, ok |
| T13 | `--on-attention` | `--attention` | 4.5 | 9.31 | Status bar text, attention; the "Locked" tag |
| T14 | `--on-stop` | `--stop` | 4.5 | 5.62 | Status bar text, stop |
| T15 | `--attention` | `--bg` | 4.5 | 9.40 | The waiting badge's text |
| N1 | `--cap` | `--track` | 3 | 14.03 | Fader cap against its track |
| N2 | `--line` | `--panel` | 3 | 3.65 | Track edge against the bank; a key's edge against its section |
| N3 | `--line` | `--bg` | 3 | 4.02 | A key's or the code field's edge against the page |
| N4 | `--fill` | `--track` | 3 | 7.62 | The level fill against the track |
| N5 | `--select` | `--key` | 3 | 6.69 | The active mark against an inactive tile |
| N6 | `--select` | `--panel` | 3 | 7.95 | A lit key and the primary swatch's mark against their section |
| N7 | `--focus` | `--bg` | 3 | 19.57 | Focus ring against the page |
| N8 | `--focus` | `--panel` | 3 | 17.81 | Focus ring against a section, the bank, a dialog |
| N9 | `--focus` | `--ok` | 3 | 5.04 | Focus ring on the waiting badge, inside the ok bar |
| N10 | `--focus` | `--focus-halo` | 3 | 21.00 | Focus ring against its halo (next to a lit key) |
| N11 | `--ok` | `--bg` | 3 | 3.88 | Status bar, ok, against the page |
| N12 | `--attention` | `--bg` | 3 | 9.40 | Status bar, attention, against the page |
| N13 | `--stop` | `--bg` | 3 | 3.48 | Status bar, stop, against the page |
| N14 | `--cap-locked` | `--track` | 3 | 4.58 | Locked cap against its track |
| N15 | `--cap-locked` | `--hatch` | 3 | 3.82 | Locked cap against the hatching |
| N16 | `--focus-halo` | `--attention` | 3 | 10.09 | Focus ring's halo on the waiting badge, inside the attention bar |
| N17 | `--focus` | `--stop` | 3 | 5.62 | Focus ring on the waiting badge, inside the stop bar |
| N18 | `--line` | `--panel` | 3 | 3.65 | The disc's edge and the colour block's edge against the block (B-16) |
| N19 | `--text` | `--panel` | 3 | 15.71 | The wheel's target mark against the Palette section (B-16) |
| N20 | `--text-muted` | `--panel` | 3 | 7.75 | The colour block's pair swatches' edge against the block (B-16) |
| N21 | `--text` | `--track` | 3 | 15.07 | The stored-value tick against the track (B-18) |
| N22 | `--text` | `--panel` | 3 | 15.71 | The tick's notch past the track's edge, on the bank or a section (B-18) |
| N23 | `--cap-locked` | `--track` | 3 | 4.58 | The tick while locked, against the track (B-18) |
| N24 | `--cap-locked` | `--hatch` | 3 | 3.82 | The tick while locked, against the hatching (B-18) |
| N25 | `--cap-locked` | `--panel` | 3 | 4.77 | The locked tick's notch on the bank or a section (B-18) |

The waiting badge is never disabled: the lock disables only Accept and Reject, and the pending list
lasts until pairing ends (`web/src/control/device-link.ts:122`), so the badge stays focusable
while the bar reads "Reconnecting…" or "Screen not connected". Its ring can land on any of the
three bar colours. On the ok bar (N9) and the stop bar (N17) the white ring carries the contrast. On
the attention bar the white ring is only 2.08:1, so the black halo carries it (N16). This is the
two-tone ring of the focus-ring part above. The lock must not disable the badge to avoid this case
(SD10 and SD13: behaviour unchanged). A disabled key's text is not held to 4.5:1 (WCAG 1.4.3 exempts inactive
controls); it still reads at 3.13:1 on `--key`.

## Budget (SD6, SD9, AC12, AC16)

The arrangement (plan PD3): horizontal while the viewport is narrower than 600 CSS px and taller
than wide; vertical otherwise. The bank is pinned to the bottom (horizontal) or to the right edge
under the status bar (vertical). With n faders:

**Horizontal bank height** = 2 (edge) + 6 (pad) + 16 (legend) + 6 (gap) + 56·n + 6·(n − 1) + 6
(pad) = **30 + 62·n** px.

| Viewport | Faders | Bank height | Limit | Travel (slider width) | Needed |
|---|---|---|---|---|---|
| 320×568 | 2 | 154 | — | 320 − 16 = 304 (95%) | ≥ 272 (85%) |
| 320×568 | 3 (B-18) | 216 | ≤ 216 (B-18 SD9) | 304 | ≥ 272 |
| 320×568 | 4 | 278 | ≤ 284 (half of 568) | 304 | ≥ 272 |
| 320×640 | 3 (B-18) | 216 | ≤ 320 | 304 | ≥ 272 |
| 320×640 | 4 | 278 | ≤ 320 | 304 | ≥ 272 |

At 320×568 with two faders the scrolling area keeps 568 − 48 − 154 = 366px; with four,
568 − 48 − 278 = 242px — 238px under a two-line status bar, 218px under the three-line bar of
the longest text beside the badge. The bar's height never changes the bank.

**Vertical bank width** = 2 (edge) + 8 (pad) + 56·n + 6·(n − 1) + 8 (pad) = **12 + 62·n** px.
**Vertical travel** = viewport height − status bar − 6 (pad) − 16 (legend) − 6 (gap) − 6 (pad)
= viewport height − 48 − 34.

| Viewport | Faders | Bank width | Limit | Travel (slider height) | Needed |
|---|---|---|---|---|---|
| 568×320 | 2 | 136 | — | 320 − 82 = 238 | ≥ 180 |
| 568×320 | 3 (B-18) | 198 | ≤ 198 (B-18 SD9) | 238 | ≥ 180 |
| 568×320 | 4 | 260 | ≤ 284 (half of 568) | 238 | ≥ 180 |
| 768×1024 | 2 | 136 | — | 1024 − 82 = 942 | ≥ 300 |
| 768×1024 | 3 (B-18) | 198 | — | 942 | ≥ 300 |
| 1024×768 | 2 | 136 | — | 768 − 82 = 686 | — |
| 1024×768 | 3 (B-18) | 198 | — | 686 | — |

At 568×320 the scrolling area keeps 568 − 136 = 432px of width with two faders and 308px with
four; at 768×1024, 632px.

**Where the words go.** Neither arrangement has room for a label row of its own with four faders
(plan Risks), so the words sit on the track:

- *Horizontal:* the label at the left and the readout at the right of the track's top 18px band;
  the cap runs in the 34px band below them and never covers either. At 320 CSS px the band is
  300px long inside the edge: "AUDIO REACTIVITY" at 13px is about 140px and "100" at 18px about
  32px, leaving more than 100px between them.
- *Vertical:* the readout centred in the track's top 22px; the label turned to read from bottom to
  top in an 18px band down the track's left side, beside the cap's band. At 568×320 that band is
  212px long; "AUDIO REACTIVITY" needs about 140px.
- *"Locked":* the bank's 16px legend row, in both arrangements, where "Faders" stands while
  unlocked — so locking never moves a fader. With two vertical faders the row is 118px wide; the
  tag is about 70px.
- *Targets:* every fader is 56px across and at least 238px long; every key at least 48×48. The
  status bar is 48px tall; the waiting badge is the bar's full height.

**The colour block (B-16 SD1, SD2, AC5).** Horizontal block height = 2 (edge) + 8 (pad) +
`--disc` + 8 (pad) = 18 + `--disc`; vertical block width = 2 (edge) + 8 (pad) + `--disc` + 6 (gap)
+ 56 (brightness) + 8 (pad) = 80 + `--disc`. The scrolling area keeps what the bar, the block and
the bank leave:

| Viewport | Arrangement | Disc | Block | Faders | Scrolling area keeps | Needed (AC5) |
|---|---|---|---|---|---|---|
| 320×568 | horizontal | 150 | 168 tall (≤ 180) | 2 | 568 − 48 − 168 − 154 = 198 tall | ≥ 180 |
| 320×568 | horizontal | 150 | 168 tall | 3 (B-18) | 568 − 48 − 168 − 216 = 136 tall | ≥ 130 (B-18 SD9) |
| 320×568 | horizontal | 150 | 168 tall | 4 | 568 − 48 − 168 − 278 = 74 tall | — (not shipped) |
| 320×640 | horizontal | 150 | 168 tall | 2 | 640 − 48 − 168 − 154 = 270 tall | — |
| 320×640 | horizontal | 150 | 168 tall | 3 (B-18) | 640 − 48 − 168 − 216 = 208 tall | — |
| 320×640 | horizontal | 150 | 168 tall | 4 | 640 − 48 − 168 − 278 = 146 tall | — (not shipped) |
| 568×320 | vertical | 150 | 230 wide (≤ 240) | 2 | 568 − 230 − 136 = 202 wide | ≥ 190 |
| 568×320 | vertical | 150 | 230 wide | 3 (B-18) | 568 − 230 − 198 = 140 wide | ≥ 130 (B-18 SD9) |
| 568×320 | vertical | 150 | 230 wide | 4 | 568 − 230 − 260 = 78 wide | — (not shipped) |
| 768×1024 | vertical | 240 | 320 wide | 2 | 768 − 320 − 136 = 312 wide | — |
| 768×1024 | vertical | 240 | 320 wide | 3 (B-18) | 768 − 320 − 198 = 250 wide | — |
| 768×1024 | vertical | 240 | 320 wide | 4 | 768 − 320 − 260 = 188 wide | — |
| 1024×768 | vertical | 240 | 320 wide | 2 | 1024 − 320 − 136 = 568 wide | — |
| 1024×768 | vertical | 240 | 320 wide | 3 (B-18) | 1024 − 320 − 198 = 506 wide | — |
| 1024×768 | vertical | 240 | 320 wide | 4 | 1024 − 320 − 260 = 444 wide | — |

The scrolling-area figures under the bank's tables above are B-19's, before the block. In the
vertical arrangement the column is 8 + `--disc` + 6 + 16 (label) + 6 + 54 (the pair beside Reset)
+ 8 tall: 248px at 568×320, inside the 272px under the bar, so it never scrolls.

**Three faders (B-18 SD9, amending B-16 AC5).** B-16's AC5 numbers hold for a bank of two. A
profile with a DJ tick puts three faders in the bank, and the scrolling area then keeps 136px of
height at 320×568 and 140px of width at 568×320 — at least 130 each (`control-layout.spec.ts`
measures them on the built page, the same to the pixel). B-18 shows at most three, so the
four-fader rows are B-19's capacity, not a shipped layout; a fourth fader (B-23) comes back to
this budget. In VJ mode the Effects section (38 + 64·n px tall) scrolls with the rest.

Every number above is a CSS pixel in the mockups, which use these tokens.

## Mockups

[controller-style-mockups.html](controller-style-mockups.html) — one self-contained page, no
script, no external file: phone portrait (320×568), phone landscape (568×320) and tablet
(768×1024) at real CSS pixels, each in DJ and VJ mode; a locked bank under "Reconnecting…"; the
four-fader bank at 320×568 and 568×320 (faders 3 and 4 are placeholders for B-18's capacity, not
a design for them); pairing with the code field; and the status bar in all thirteen link states.
Since B-16 every frame with a bank shows the pinned colour block — aimed at the primary slot in
DJ mode, at swatch 3 with the target mark in VJ mode, locked in the locked frames — and the colour
wheel's dialog frame is gone. Since B-18 three more frames show the effect faders with their
stored-value ticks: DJ mode with three faders in the bank at 320×568 and at 568×320, and VJ mode
at 768×1024 with the effect fader in the bank and the Effects section under Transition. Open it on
a phone and a tablet from the file; turn the phone to landscape to see the 568×320 frames at full
size. Each frame scrolls inside itself like the page.
