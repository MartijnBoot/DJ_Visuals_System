# Night Bus

**Source:** the owner's brief, no image: visuals for a UK garage set, the late end of it. The look
is the ride home after the club: the top deck of a London night bus, rain on the window, the
orange of sodium-vapour streetlights (the low-pressure lamps that turn everything one orange),
red brake lights in the wet, and light streaming past. Checked against
`inspiration/night-bus/test-room.jpg` (the stock picture from the Starry Night folder, not
committed). A club camera in a dark room will sit lower on the grade than this sunset does.

## Palette

| Slot | Colour    | What it is                                                         |
| ---- | --------- | ------------------------------------------------------------------ |
| 0    | `#060b16` | night: the deepest shadows.                                        |
| 1    | `#12333f` | wet teal: shadows a little lit, as glass and tarmac reflect.       |
| 2    | `#ff6f12` | sodium orange: the mid and high tones. The profile's `primary`.     |
| 3    | `#ffc777` | lamp core: the brightest tones, the passing lamp, drop highlights. |
| 4    | `#ff2a3d` | brake light: strong reds in the picture are kept red.              |

Slot 2 is `primary`. A paired controller's **Primary colour** retints the streetlight (a cold
mercury green-white, or the newer white LEDs, are the other lamps worth trying).

## Texture: the window

Custom effect **Rain on the window** (abstraction):

- **Fog:** outside the drops the room is softened (four taps, 1.1% of the frame height apart), as
  through steamed glass.
- **Drops:** columns of cells, each sliding down at its own speed, with at most one drop per
  cell. A drop is a little taller than wide, with a soft darker rim and one small highlight at the
  top. Inside it the room is sharp and upside down, as through a real drop. Above a drop, its wet
  streak clears the fog. `rain` sets how many drops there are and how small.
- **Sodium grade:** shadows go to night and wet teal, highs go to sodium orange and the lamp core.
  Strong reds go to brake-light red. `sodium` sets how far the grade goes (0 keeps the camera's
  colour under the rain).

## Motion

- **Passing lamps:** a soft band of lamp light slides across the frame all the time, as the bus
  passes under streetlights. The **kick** (`audio.beat`) brightens it, so each kick is the next
  lamp.
- **Light trails:** custom effect **Passing lights** (abstraction). What is bright leaves a trail
  that streams sideways and a touch downward, like lights sliding past a bus window, then fades.
  The **hi-hats** (`audio.high`) chop the trails into dashes. While the hats are loud the trail
  is dimmed hard 7.5 times a second, so a light passing becomes a dotted line on the shuffle.
- **Grain:** the built-in `grain` in the lamp colour, a little, all the time: night-camera noise.

## The idea

The 4 a.m. end of the set: tired, warm, a bit melancholy. The room seen through a rainy bus
window under orange streetlight, with the hats ticking the lights past.

## Effects, sliders and dials

1. `custom` **Rain on the window** (abstraction):
   - `rain` (0.5): how many drops, and how small.
   - `sodium` (0.85): how far the grade goes toward streetlight.
2. `custom` **Passing lights** (abstraction):
   - `trails` (0.6): how long and how fast the trails stream. 0 halves in about 3 frames, 1 in
     about 20 (a third of a second at 60 fps).
3. `grain`: amount 0.35, colour slot 3.

Starting dials: recognisability 0.85, reactivity 0.6. Both custom effects are flagged
`abstraction`, so at recognisability 0 the camera comes back plain, with only the grain left.

**Flash limiter:** `pnpm profile:check` reports it clipped in 12 of 69 frames. That check counts
a frame when any single pixel moves the limiter's full step. Here those pixels are drop edges
sliding over the picture. Checked on the rain effect alone (without trails and grain), it went
from 35 clipped frames to 1 with the drops taken out, and to none with the kick's lamp taken out
too. Softening the drop rims since then brought the whole profile to 12. That is no flash on the
screen.

Cost: 6 camera reads per pixel (the pixel, four fog taps, one through the drop) and one last-frame
read. Software WebGL says nothing about real speed: check the frame time in the builder.
