# Neon Silhouette

**Source:** the owner's brief, no image: "only the lines of the silhouettes are visible. That line
has a primary colour and an RGB split effect on it. The silhouettes are neon lines, with an echo
on the movement and on the RGB split." Checked against `inspiration/neon-silhouette/test-person.jpg`
(a stock portrait from the Starry Night inspiration folder, not committed).

The look draws on neon tube signs and on the club-video habit of outlining dancers in light,
with the chromatic aberration of a cheap lens pushed until it shows.

## Palette

| Slot | Colour    | What it is                                                                    |
| ---- | --------- | ----------------------------------------------------------------------------- |
| 0    | `#ff1a3c` | the tube: the line's colour and its glow. The profile's `primary` slot.       |
| 1    | `#fff1f3` | the hot core: the line's centre leans 45% toward it, as a lit tube whitens.   |

Slot 0 is marked `primary`, so the DJ's **Primary colour** button on a paired controller turns the
line's colour live (neon blue `#1a5cff` and neon yellow `#ffe100` are the other two primaries
worth trying). Everything that is not a line is black.

## Texture: the lines

One custom effect, **Neon outline**:

- **The line.** A Sobel edge on the camera's luminance, with a step of 0.0035 of the frame height,
  so the line keeps its width at any resolution. A hard threshold gives the core and a softer,
  lower one gives the halo around it. `detail` sets the threshold: low keeps only strong contours
  (the silhouette against the room), high draws every edge (faces, folds, hands).
- **The split.** The edge is taken three times at offsets either side of the pixel. Red comes from
  one copy, green from the centre and blue from the other. Because the core is whitened, the
  three copies separate into red, green and blue fringes around the line colour. The offset turns
  slowly (±20°) so the fringes do not sit still.
- **The glow.** The previous frame is read on two small rings that turn every frame, so they leave
  no pattern. The result is added to the new line, which makes the tube bleed light a few pixels
  around it.

## Motion

- **Echo.** The previous frame fades and is kept where it is brighter than the new line (a max,
  never a sum, so the feedback cannot build up). A moving silhouette leaves fading copies of
  itself. On every frame the echo's red drifts a little further one way and its blue the other.
  The trails fan out into colour, which is the echo on the split.
- **Kick** (`audio.beat`): the split jumps almost three times as wide and the tube pumps brighter.
- **Hi-hat** (`audio.high`): the tube flickers a little, like a neon sign on a bad starter.

## The idea

The room goes dark and the people in it become neon signs of themselves: outlines that hum on the
beat and leave colour behind when they move.

## Effects, sliders and dials

1. `custom` **Neon outline** (abstraction):
   - `echo` (0.6): how long the trails last. 0 is none, 0.6 halves in about 14 frames (a quarter
     second at 60 fps), and 1 lasts about half a second.
   - `split` (0.35): the RGB split's width at rest, 0.003 to 0.025 of the frame height.
   - `detail` (0.25): which edges become lines. Low gives silhouettes only, high every edge.

Starting dials: recognisability 0.9, reactivity 0.7. The effect is flagged `abstraction`, so its
strength is recognisability. Above about 0.67 the room is fully black. Lower down, the camera fades
in behind the lines, and at recognisability 0 the camera is plain.

`pnpm profile:check` reports the flash limiter not clipped: the line colour's luminance stays well
inside the 0.35 step.

Edge detection cannot tell a silhouette from any other strong edge. A busy, high-contrast
background or patterned clothing draws lines too (the bouquet in the test picture does). Turn
`detail` down, or light the people against a plainer background.

Cost: 25 `source` calls per pixel (8 per split copy, plus the pixel itself) and 9 `lastFrame`
reads. The camera is the only link before it, so each `source` call is a single camera read.
Software WebGL says nothing about real speed: check the frame time in the builder.
