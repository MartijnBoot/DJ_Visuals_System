# Two-Step Chrome

**Source:** the owner's brief, no image: visuals for a UK garage set. The look is drawn from the
genre's own era and rhythm rather than one picture. It takes the late-90s and early-2000s garage
glamour: chrome lettering on rave and club-night flyers, the Y2K "liquid metal" look, champagne
and gold. It also takes 2-step itself: a skipping, swung kick, shuffling hi-hats and chopped,
pitched vocals. Checked against `inspiration/two-step-chrome/test-person.jpg` (the stock portrait
from the Starry Night folder, not committed).

## Palette

| Slot | Colour    | What it is                                                                     |
| ---- | --------- | ------------------------------------------------------------------------------ |
| 0    | `#160c33` | deep violet: the chrome's dark horizon line and the ground just below it.      |
| 1    | `#6fc8ff` | ice blue: the reflected sky at the horizon.                                    |
| 2    | `#c9d1de` | silver: the sky higher up.                                                     |
| 3    | `#f0b955` | champagne gold: the reflected ground, the glints' tint, the chop's cut lines. |
| 4    | `#fffaf0` | warm white: the top of the sky and the glints' core.                           |

Slot 3 is `primary`, so a paired controller's **Primary colour** turns the gold (and with it the
ground and cut lines) live.

## Texture: liquid chrome

Custom effect **Liquid chrome** (abstraction), the classic airbrushed-chrome trick done on the
camera:

- The camera's brightness is read as a surface. A normal comes from its gradient, taken with wide
  taps (1% of the frame height) so skin and hair read as smooth metal, not speckle.
- The surface "reflects" a fake environment: white sky, silver, ice blue, a hard deep-violet
  horizon, then a gold ground. Where it looks is the normal's upward part plus the (softened)
  brightness, folded into repeating bands, so one shape holds several horizons. `shine` adds both
  contrast and more horizons.
- Dark parts of the picture stay dark, so people keep their shape.
- **Glints:** a grid of 12 cells per frame height, one spot per cell. A spot on a bright part of
  the picture can light up a four-point star. Each spot lives in cycles of about two thirds of a
  second and fades in and out (so stars never pop). `glints` sets how many live.

## Motion

- **Bass** (`audio.low`): the built-in `zoom`, bound to low, pumps the picture. In the chrome a
  slow liquid wobble of the horizons gets stronger.
- **Hi-hat** (`audio.high`): more stars live, and their arms grow.
- **Kick** (`audio.beat`): custom effect **Two-step chop** (abstraction). The picture is cut into
  horizontal bands. On the kick about half of them slip sideways (wrapping round) and spring back
  as the beat falls. A few hold the last frame for a moment: a stutter, like a chopped vocal. A
  thin gold cut line marks each band that moved. Which bands move is re-dealt twice a second, so
  each kick cuts differently.
- **Swing:** even bands hit on the kick's onset. Odd bands hit on a bump that peaks halfway down
  the beat's fall: later than the kick, a second, off-beat hit. `swing` sets how late they are,
  from together (0) to fully shuffled (1).

## The idea

The dancefloor turned into the chrome on a garage flyer, glinting on the hats, and cut up and
shuffled on the kick the way 2-step cuts up a beat.

## Effects, sliders and dials

1. `zoom`: amount 0, bound to `low` at 0.6. Only the bass moves it.
2. `custom` **Liquid chrome** (abstraction):
   - `shine` (0.45): contrast and number of horizons. Low is a soft satin metal, high is busy
     liquid chrome.
   - `glints` (0.5): how many stars live. 0 is none.
3. `custom` **Two-step chop** (abstraction):
   - `slices` (0.4): from 3 to 18 bands.
   - `swing` (0.7): how late the odd bands land.

Starting dials: recognisability 0.85, reactivity 0.75. Both custom effects are flagged
`abstraction`: at recognisability 0 the camera is plain (the zoom still pumps on the bass while
reactivity is up).

**Flash limiter:** `pnpm profile:check` reports it clipped in 16 of 69 frames. That check counts
a frame when any single pixel moves the limiter's full step. Here that is the hard chrome
horizons jumping when the test's bass goes from 0 to 1 in one frame. Checked on the chrome effect
alone (without zoom and chop), the glints were 1 of the clipped frames, and with the glints and
the liquid wobble also taken out it reported not clipped. The chop added none. Halving the
wobble's bass range since then brought the whole profile to 16. On the screen the bass morph
becomes a ramp of a few frames, a swell, which suits it.

Cost: about 5 camera reads per pixel for the chrome, plus one per lit star near the pixel (at most
9). The chop reads the chain once more and the last frame once. Software WebGL says nothing about
real speed: check the frame time in the builder.

A busy, fine pattern (the bouquet in the test picture, a patterned shirt) turns to glittering
speckle rather than smooth metal. Lower `shine` for a calmer surface.
