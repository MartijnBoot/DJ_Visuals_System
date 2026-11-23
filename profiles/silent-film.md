# Silent Film

**Source:** Peter Tscherkassky, _Outer Space_ (1999), a found-footage film made in the darkroom
from the horror film _The Entity_ (1982), frame by frame, without a camera. The owner pointed at
<https://www.youtube.com/watch?v=GxQ3PucXg8k&t=268s> (around 4:28). The brief: the room turned
into an old black-and-white film, with half see-through film strips running over it in quick
succession.

Looked at: the video's thumbnail, twelve stills from 4:22 to 4:34 and thirty-six from 4:22 to
4:40 at 720p (`hd/sheet-*.png`), under `inspiration/silent-film/` (with the stock
`test-room.jpg` and `test-person.jpg` used for the check; none of it committed). Checked with
`pnpm profile:check profiles/silent-film.json --camera inspiration/silent-film/test-room.jpg`, and
on `test-person.jpg` and the generated scene.

## Palette

| Slot | Colour    | What it is                                                              |
| ---- | --------- | ----------------------------------------------------------------------- |
| 0    | `#0a0a0b` | black: the crushed shadows, the film base at a strip's edges.           |
| 1    | `#37383a` | dark silver: the low mids.                                              |
| 2    | `#a4a5a3` | silver: the mids, most of the picture. The profile's `primary`.         |
| 3    | `#efefea` | paper white: burnt highlights, sprocket holes, the soundtrack's wave.   |

The palette is neutral silver, as _Outer Space_ is: no sepia. Slot 2 is `primary`, so a paired
controller's **Primary colour** tones the print: amber, blue or green, as silent films were
tinted, or a sepia.

## Texture: old film

Custom effect **Old film** (abstraction):

- **Silver contrast:** the camera to luminance, then a hard S-curve: blacks crushed, highlights
  burnt out. `contrast` sets how hard.
- **Two exposures:** a second copy of the picture, offset sideways and drifting slowly
  (about 10 s a swing), laid over the first where it is lighter, as in the film's double prints.
  `ghost` sets how strongly. Each copy gets its own contrast curve before they meet.
- **Uneven exposure:** slow, soft blotches of light and dark drifting over the frame, as a
  hand-made copy has.
- **The projector:** a brightness flicker that changes 24 times a second, a hot centre with
  falling-off corners, and a slow gate weave. The weave is smooth noise, not a jump per frame,
  so hard edges never jump past the flash limiter.
- **Wear:** up to three thin vertical scratches that live a few frames each, white (emulsion) or
  dark (base); dark dust specks, new every film frame; grain in clumps of 1.5 pixels, new every
  film frame, strongest in the mids and zero-mean. `wear` sets all three.


## Motion: film run

Custom effect **Film run** (abstraction). The first version cut short, flat strips in and out at
random places and angles. The owner found them amateurish. In _Outer Space_ upright film slides
sideways through the gate, right to left, fast, several lengths over each other at different
speeds, and the picture is seen _through_ them. This effect does that.

Three layers of upright 35 mm film, each running right to left at its own speed. Each follows
one band of the music:

| Layer | Width (× height) | Speed (heights/s at `speed` 0.6) | Band    | Frames carry                     |
| ----- | ---------------- | -------------------------------- | ------- | -------------------------------- |
| Bass  | 1.5              | 1.1                              | `low`   | the room (after **Old film**)    |
| Mids  | 1.05             | 2.0                              | `mid`   | the last frame: a print of a print |
| Highs | 0.65             | 3.8                              | `high`  | nothing: base, holes, track      |

- **Through the film:** the film base darkens what lies under it. The perforations, the optical
  soundtrack, burns and scratches let the light through to paper white. The frames lay their
  own picture over the room (each frame a little out of register; about 2 lengths in 5 a
  negative).
- **35 mm anatomy:** a column of rounded perforations at each edge; the soundtrack beside them,
  a jagged, uneven zigzag cutting into the picture (the torn edges at 4:30 to 4:38); frames
  with dark frame lines between them. Lengths of film come and go, so gaps run through as well.
- **Speed:** each layer is blurred along its run over three frames' travel (six taps), so the
  holes and the track become streaks, as in the reference, and never step further in a frame
  than the flash limiter allows. The film stutters as it catches in the gate (smooth noise,
  never a jump), leans up to about ±9°, and crawls slowly up or down its own length.
- **Damage**, moving with the film: burnt blotches (clear), soot (dark), fine scratches along
  the run, frames lost to white or black.
- **Smear:** the last frame, dragged on with the bass film, is mixed in where film runs: the
  speed leaves a trail.

## Sound

- **Kick** (`audio.beat`): the bass film shudders: thrown on and caught back as the beat falls
  (zero at the onset itself, so it never jumps). In **Old film** the second exposure burns in
  and the lamp flares.
- **Bass, mids, highs** (`audio.low`, `audio.mid`, `audio.high`): each makes its own layer show
  more and swings its soundtrack wave wider. The hats also flutter the high layer and roughen
  the grain.

## The idea

A haunted print: the room becomes a worn copy of an old horror film. Damaged film races through
it, too fast to hold, in layers that move with the music. Anxious and restless rather than
nostalgic.

Left out: in _Outer Space_ the picture jumps in the gate and the frame line rolls through it. Tried
as a slip on the kick, every hard edge jumped further than the flash limiter allows. On screen
that would smear, not jump, so the kick does the shudder and the double exposure instead. A
final contrast curve on **Film run** was also tried: it doubled every moving edge's step and
clipped the limiter in a third of the frames, so the film keeps its own soft greys.

## Effects, sliders and dials

1. `custom` **Old film** (abstraction):
   - `contrast` (0.75): 0 a soft grey print, 1 hard black and white.
   - `wear` (0.5): scratches, dust, grain, flicker and blotches. 0 a clean print, 1 a worn one.
   - `ghost` (0.55): the second exposure. 0 a single exposure.
2. `custom` **Film run** (abstraction):
   - `film` (0.7): how much of the film shows. 0 none.
   - `speed` (0.6): how fast all three layers run, 0.45× to 1.7× the base speeds.
   - `damage` (0.5): burns, soot, scratches and lost frames. 0 clean film.
   - `smear` (0.5): the trail the speed leaves. 0 none.

Starting dials: recognisability 0.9, reactivity 0.6. Both effects are flagged `abstraction`, so
at recognisability 0 the camera comes back plain.

**Flash limiter:** `pnpm profile:check` reports it not clipped on `test-room.jpg` and
`test-person.jpg`, and clipped in 1 of 69 frames on the generated scene. The film moves with
time, so other moments differ: shifted 3, 7 and 13 s on, the room clipped in 0, 5 and 0 of 69.
A clipped frame is a few pixels where three layers' edges meet; on screen they become a softer
step, not a flash. Raising `film`, `speed`, `damage`, `contrast` or `wear` towards 1 clips more.

**Cost:** **Old film** reads the camera twice per pixel. **Film run** reads the picture below it
once, plus three taps inside a bass frame (each running **Old film** again), and three
last-frame reads inside a mids frame and one for the smear. That is up to 8 camera reads per
pixel. Check the frame time in the builder, and lower the render scale if it is slow.
