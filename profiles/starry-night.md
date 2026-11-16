# Starry Night

**Source:** Vincent van Gogh, _The Starry Night_ (_De sterrennacht_), oil on canvas, June 1889,
Museum of Modern Art, New York. Public domain.
Image used: [Wikimedia Commons, Google Art Project scan](https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg)
(the 1280 px thumbnail, kept in `inspiration/starry-night/starry-night.jpg`, not committed).

## Palette

Picked from the canvas, darkest to lightest, because `paletteMap` spreads the picture's luma
over the slots in that order:

| Slot | Colour    | Where in the painting                         |
| ---- | --------- | --------------------------------------------- |
| 0    | `#1c2a24` | the cypress, black-green                      |
| 1    | `#1e3f8f` | the deep ultramarine of the night sky         |
| 2    | `#4a78c2` | the cerulean strokes of the swirls            |
| 3    | `#a9c4c9` | the pale green-blue of the big swirl's arms   |
| 4    | `#f2c832` | the moon and the star centres, cadmium yellow |
| 5    | `#f4efb4` | the cream of the halos                        |

The stars and the moon read the last two slots (`palette[paletteSize - 2]` for the cores,
`palette[paletteSize - 1]` for the rings), so a changed palette keeps that relation.

## Motion

The sky in the painting never stands still: one big double spiral at the centre, a smaller one
below it and to the right, and long bands running left to right. The **Swirling brushwork**
effect builds that flow from three parts. A curl-noise field gives currents that never pool. A
left-to-right lean with a slow wave in it gives the bands. Two vortices sit where the painting has
them, at (0.5, 0.66) and (0.69, 0.5) of the frame. The picture is twisted around both centres. The
**kick** winds the main spiral tighter for a moment and lights its arms in slot 3. The flow drifts
slowly with time (`drift`). A small share of the previous frame, carried along the current, makes
the paint look wet.

## Texture

Van Gogh's short, parallel, thick strokes. The effect averages the picture and a fine value noise
along the flow direction over six steps, a line integral convolution. The noise becomes streaks
that follow the current, and they modulate the brightness, so the palette map turns them into
alternating blue and pale strokes. Even a flat wall becomes brushwork. The streaks are anchored in
the frame, not in time, so they move only where the flow turns, like paint, and do not shimmer.

## Stars and moon

**Stars and moon** puts ringed stars on a jittered grid in the upper part of the frame only (the
sky). Each has a yellow core and concentric cream rings that slowly breathe outward. The **hi-hat**
(`audio.high`) makes them swell and twinkle. A crescent moon sits top right with the widest halo.

## The idea

The room seen as Van Gogh saw that night from his window: nothing is still, everything flows and
burns. At recognisability 0 both custom effects are off (both are flagged `abstraction`). The
camera comes back plainly, only coloured three quarters of the way into the night palette, so the
look stays recognisable as this profile.

## Effects and sliders

1. `custom` **Swirling brushwork** (abstraction): `swirl` (how hard the vortices pull and twist),
   `stroke length` (how far the strokes smear), `drift` (how fast the currents move).
2. `paletteMap` at 0.75.
3. `custom` **Stars and moon** (abstraction): `stars` (how many, 3 to 8 cells per frame height),
   `halo` (how bright the rings are).

Starting dials: recognisability 0.7, reactivity 0.6.

`pnpm profile:check` reports the flash limiter clipping 5 to 8 of 69 frames. Those frames are the
kick twisting bright paint quickly through the spiral. On the screen it becomes a pulse, which
suits the look.

Cost: six `source` calls in the brushwork, and the camera is the only link before it, so the extra
work is small. The stars loop over 9 cells and make no `source` calls beyond their one.
