# Starry Night

**Source:** _Loving Vincent_ (Dorota Kobiela and Hugh Welchman, BreakThru Films / Trademark
Films, 2017), the first fully oil-painted feature film: about 65,000 frames, each painted by hand
in Van Gogh's style by a team of more than 100 painters.
Trailer: <https://www.youtube.com/watch?v=MUd3tVDZqSg>. The trailer's thumbnail (Vincent's portrait
against the swirling turquoise wall) is kept in `inspiration/starry-night/loving-vincent-trailer.jpg`,
not committed. Behind it: Vincent van Gogh's paintings of 1888–1890, _The Starry Night_ among them
(`inspiration/starry-night/starry-night.jpg`, the Google Art Project scan from Wikimedia Commons,
public domain).

The first version of this profile twisted the camera picture into the painting's two spirals and
laid stars and a moon over it. It read as an effect on a video. This version paints the camera:
everything on the screen is made of brush strokes, as in the film.

## Palette

Picked from the trailer frame and Van Gogh's late canvases, darkest to lightest:

| Slot | Colour    | What it is                                        |
| ---- | --------- | ------------------------------------------------- |
| 0    | `#1d2b53` | Prussian blue, the contour lines and the darks    |
| 1    | `#3f64a8` | cobalt, coats and shadows                         |
| 2    | `#4f8a6e` | viridian green, the cool middle tones             |
| 3    | `#c0762f` | ochre and burnt orange, beard and skin in shadow  |
| 4    | `#8fc9b5` | the turquoise of the swirling walls and skies     |
| 5    | `#f1d77a` | chrome yellow and cream, the lit skin and the sun |

The strokes keep the camera's own colours, saturated. Each stroke also leans toward the palette
colour of its own lightness, interpolated between slots in the order above. One stroke in three
leans hard, as an accent. That way a changed palette still colours the painting.

## Texture: the strokes

The look is a stroke painter in one custom effect, **Painted strokes**. It has no overlays and no
warping.

- **Stroke placement.** The frame is cut into a grid of cells (frame height units, so it does not
  stretch). Every cell holds one stroke at a jittered place. The picture is read once at each cell
  corner. The average of the four corners is the stroke's single colour: one brush, one colour.
- **Stroke direction.** The difference across the corners gives the form's gradient. On a contour
  the stroke runs _along_ it, as the painters followed a cheek or a sleeve. Where the picture is
  flat (a sky, a wall), the stroke follows a slow curl-noise current. That current gathers into
  the swirls of the trailer's background and of _The Starry Night_. Each stroke bends slightly
  along its length and sits a little askew.
- **Two layers.** Broad strokes cover everything. A random rank per stroke decides which lies on top, and a pixel no stroke reaches takes the nearest one, so no camera shows through. Fine
  strokes at less than half the size are added only where the picture has detail (eyes, edges,
  hands), with soft edges.
- **Paint body.** Bristle grooves run along every stroke, and the stroke has a ridge of thick
  paint lit from the top left (impasto). Contours get a dark line in palette slot 0, broken up
  like a brush line.

## Motion

- **Boil.** The film's frames were each repainted, so the strokes boil. The painter does the
  same: a few times a second (`boil`) every stroke is nudged and turned a little, but keeps its
  place. The painting shimmers and does not jump. The current drifts slowly over time.
- **Kick** (`audio.beat`): every stroke jolts askew and stretches a little, so the whole canvas's
  brushwork shudders on the beat.
- **Hi-hat** (`audio.high`): the impasto ridges catch the light.

## The idea

The room is painted, frame by frame, by Van Gogh's hand: you still see who is there, but
everything is paint, and nothing holds quite still.

## Effects, sliders and dials

1. `custom` **Painted strokes** (abstraction):
   - `stroke size`: cell size, 0.022 to 0.075 of the frame height.
   - `stroke length`: how long a stroke runs against its width.
   - `boil`: how often the strokes are repainted, 1 to 12 times a second.
   - `palette`: how far the colours lean toward the palette.

Starting dials: recognisability 0.8, reactivity 0.6. The effect is flagged `abstraction`, so its
strength is recognisability. Lower strength paints with smaller strokes (down to a third of the
size), so detail returns before the paint fades. Below 0.3 it blends back to the camera, and at
recognisability 0 the camera is plain.

`pnpm profile:check` reports the flash limiter clipping 18 to 25 of 69 frames. That is the boil
and the kick moving bright strokes over dark ones. On the screen it softens into a short pulse,
which suits wet paint.

Cost: 37 `source` calls per pixel (16 cell corners per layer, the pixel itself, four for the
contours). The camera is the only link before it, so each call is a single camera read. The two
stroke loops visit 9 cells each, with four noise reads per cell for the current. The cost per
pixel does not depend on the sliders. Software WebGL says nothing about real speed: check the
frame time in the builder.
