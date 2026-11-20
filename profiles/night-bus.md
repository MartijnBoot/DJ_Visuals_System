# Night Bus

**Source:** the owner's brief, no image: visuals for a UK garage set, the late end of it. The look
is the ride home after the club: the top deck of a London night bus, the orange of sodium-vapour
streetlights (the low-pressure lamps that turn everything one orange), red brake lights, and light
streaming past. The bus's own little CCTV screen, or an old telly at home, shows it: soft, lined
and a bit snowy. Checked against `inspiration/night-bus/test-room.jpg` (the stock picture from the
Starry Night folder, not committed). A club camera in a dark room will sit lower on the grade than
this sunset does.

The first version put rain drops sliding down a fogged window over the picture. The owner found
the drops fake. They gave way to the old-screen texture below.

## Palette

| Slot | Colour    | What it is                                                     |
| ---- | --------- | -------------------------------------------------------------- |
| 0    | `#060b16` | night: the deepest shadows.                                    |
| 1    | `#12333f` | wet teal: shadows a little lit, as wet tarmac reflects.        |
| 2    | `#ff6f12` | sodium orange: the mid and high tones. The profile's `primary`. |
| 3    | `#ffc777` | lamp core: the brightest tones and the passing lamp.           |
| 4    | `#ff2a3d` | brake light: strong reds in the picture are kept red.          |

Slot 2 is `primary`. A paired controller's **Primary colour** retints the streetlight (a cold
mercury green-white, or the newer white LEDs, are the other lamps worth trying).

## Texture: the old screen

Custom effect **Old screen** (abstraction):

- **Soft lines:** the picture is smeared a little along its lines only (two taps either side,
  0.25% and 0.6% of the width), as a tired tube or a VHS signal does.
- **Sodium grade:** shadows go to night and wet teal, highs go to sodium orange and the lamp core.
  Strong reds go to brake-light red. `sodium` sets how far the grade goes (0 keeps the camera's
  colour).
- **Scanlines:** about 240 lines at any resolution, each dipping 12% between lines.
- **Hum bar:** a wide band, 5% brighter, rolls slowly up the screen (about 14 s a pass).
- **Static:** fine snow, one value per output pixel, new every frame and zero-mean, so it does
  not lift the picture. It is a little stronger in the shadows, where a weak signal shows it
  most. `static` sets how much: slight at the start, clear snow at 1.
- **Corners:** the tube's corners fall off by up to 25%.

## Motion

- **Passing lamps:** a soft band of lamp light slides across the frame all the time, as the bus
  passes under streetlights. The **kick** (`audio.beat`) brightens it, so each kick is the next
  lamp.
- **Light trails:** custom effect **Passing lights** (abstraction). What is bright leaves a trail
  that streams sideways and a touch downward, like lights sliding past a bus window, then fades.
  The **hi-hats** (`audio.high`) chop the trails into dashes. While the hats are loud the trail
  is dimmed hard 7.5 times a second, so a light passing becomes a dotted line on the shuffle.

## The idea

The 4 a.m. end of the set: tired, warm, a bit melancholy. The room under orange streetlight on an
old screen, with the hats ticking the lights past.

## Effects, sliders and dials

1. `custom` **Old screen** (abstraction):
   - `static` (0.35): how much snow. 0 is a faint trace, 1 clear snow.
   - `sodium` (0.85): how far the grade goes toward streetlight.
2. `custom` **Passing lights** (abstraction):
   - `trails` (0.6): how long and how fast the trails stream. 0 halves in about 3 frames, 1 in
     about 20 (a third of a second at 60 fps).

Starting dials: recognisability 0.85, reactivity 0.6. Both custom effects are flagged
`abstraction`, so at recognisability 0 the camera comes back plain.

**Flash limiter:** `pnpm profile:check` reports it not clipped.

Cost: 5 camera reads per pixel (the pixel and four line taps) and one last-frame read. Software
WebGL says nothing about real speed: check the frame time in the builder.
