# Custom effects — the contract

A profile may carry its own look as GLSL code: a `custom` effect (B-03 spec SD1, SD3). This page
is the contract that code is written against, for a person in `/builder` and for an agent running
`/profile`. The engine, the builder's template and `tests/meta/custom-contract.test.ts` keep it
true: the test fails when the names below and the engine's drift apart.

## What a custom effect is

One link in the profile's stack, beside the twelve built-in effects and ordered freely among them.
Its `code` is the **body** of a function:

```
vec3 fxN(vec2 uv) {
  <your code>
}
```

`uv` is this pixel's place in the output, `(0, 0)` bottom-left to `(1, 1)` top-right. The body
must `return` a `vec3`: this pixel's colour, each channel 0 to 1 (the engine clamps). It may read
the picture before it, at any place and as often as it likes, and nothing else than the names
below.

In the profile file:

```json
{
  "type": "custom",
  "label": "Swirl",
  "amount": 0.5,
  "binding": { "feature": "beat", "amount": 1 },
  "abstraction": false,
  "params": [{ "name": "turn", "value": 0.6 }],
  "code": "vec3 c = source(uv);\nreturn c;"
}
```

- `label`: 1 to 40 characters, unique in the profile. A profile may hold several custom effects;
  all effects together are at most 12.
- `amount`: the base strength, 0 to 1. `binding` (optional): one audio feature that adds to it,
  as for every built-in effect.
- `abstraction`: when true, the recognisability dial scales the strength, as for pixelate,
  posterise and smear.
- `params`: 0 to 4 named values, 0 to 1, each a slider in the builder; names 1 to 24 characters,
  unique in the effect.
- `code`: at most 8192 bytes (UTF-8).

A file holding a custom effect is `formatVersion` 2. Any effect, built-in or custom, may also
carry `"dj": true` (at most one effect per profile) or `"vj": true`: a strength fader for it on
`/control` in that mode (B-18). A file in which any effect has one of them is `formatVersion` 3;
versions 1 and 2 refuse both keys.

## Names

These names, and no others, are the contract.

| Name            | Type    | What it is                                                                                                                   |
| --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `source(p)`     | `vec3`  | The picture before this effect, at place `p` (a `vec2`). Each call runs everything before it in the stack again.            |
| `lastFrame(p)`  | `vec3`  | This look's previous output frame at `p`, after the flash limiter; during a transition never the mixed frame (below).       |
| `resolution`    | `vec2`  | The output's size in pixels as it is drawn now (the render scale may lower it).                                             |
| `time`          | `float` | Seconds, wrapping after an hour.                                                                                             |
| `audio.level`   | `float` | Loudness, 0 to 1, after the reactivity dial: at reactivity 0 every `audio` value is 0.                                       |
| `audio.low`     | `float` | Bass, 0 to 1, after the reactivity dial.                                                                                     |
| `audio.mid`     | `float` | Mids, 0 to 1, after the reactivity dial.                                                                                     |
| `audio.high`    | `float` | Highs, 0 to 1, after the reactivity dial.                                                                                    |
| `audio.beat`    | `float` | A beat: 1 on the onset, falling to 0; after the reactivity dial.                                                             |
| `palette[i]`    | `vec3`  | The profile's colours, `i` from 0 to `paletteSize - 1`; the slots after those, up to 5, are black.                           |
| `paletteSize`   | `int`   | How many colours the palette has, 2 to 6.                                                                                    |
| `strength`      | `float` | This effect's strength now, 0 to 1: its amount, scaled by recognisability when flagged, plus its binding.                    |
| `param[i]`      | `float` | This effect's parameters, `i` from 0 to 3 in the order they are declared; one not declared is 0.                             |
| `hash(p)`       | `float` | A repeatable random value, 0 to 1, for a `vec2`.                                                                             |
| `valueNoise(p)` | `float` | Smooth noise, 0 to 1, for a `vec2`.                                                                                          |

The code never reads a dial: recognisability and reactivity reach it only through `strength` and
`audio`.

## Rules a body must keep

The server refuses a profile whose code breaks one of these, naming the effect; the compiler is
the real check, and `pnpm profile:check` runs it.

- No `#` anywhere: no preprocessor, not even in a comment.
- No `uniform`, and no `in`, `out` or `inout` declaration at the start of a line.
- Braces balanced, counted outside comments: a body cannot leave its function.
- No functions of its own (GLSL has no nested functions): write loops and inline the rest.
- The names above are reserved: a local variable called `strength`, `time` or `source` does not
  compile.
- Only the names above are supported. The shader's other names (`uBlock`, `uPrevious`, …) belong
  to the engine and may change without notice.

## What the engine adds around a body

- **Strength 0 is the identity.** Below 0.001 the body does not run at all and the picture
  passes through unchanged.
- **The flash limiter.** In a profile with any custom effect, no output pixel's luminance moves
  by more than 0.35 of full scale from one frame to the next, whatever the code does: a strobe in
  code becomes a pulse. A colour that is not a number becomes the previous frame's.
  `pnpm profile:check` says when the limiter clipped a look.
- **The guard.** If the GPU cannot keep up even at a 50% render scale for 3 s, the screen turns
  the profile's custom effects off and says so; picking the profile again retries, and in the
  builder an edit to the code does. If the graphics context is lost, the screen comes back
  without the custom effects. The guard does not act while a transition runs.
- **Transitions.** While the screen mixes two looks, each keeps its own history: `lastFrame` and
  the flash limiter read this effect's own look's previous output, never the mixed frame on
  screen. On the first frame of an incoming look, `lastFrame` is the frame that was on screen when
  the transition started; the outgoing look runs on at the dials and colours it had then.

Cost: everything before a custom effect runs once per `source` call, so a body that samples
`source` nine times makes the stack before it nine times as heavy. The builder shows the frame
time.

## Worked bodies

A duotone from the palette's first and last colours:

```glsl
vec3 c = source(uv);
float y = dot(c, vec3(0.299, 0.587, 0.114));
vec3 tone = mix(palette[0], palette[paletteSize - 1], y);
return mix(c, tone, strength);
```

Ripples from the centre that grow on the kick; `param[0]` sets their calm size:

```glsl
vec2 centre = uv - 0.5;
float wave = sin(length(centre) * 40.0 - time * 6.0) * 0.01 * (param[0] + audio.beat);
return source(uv + normalize(centre + 0.00001) * wave * strength);
```

Light trails: what was bright fades over a few frames instead of at once:

```glsl
vec3 now = source(uv);
vec3 before = lastFrame(uv) * 0.96;
return mix(now, max(now, before), strength * param[0]);
```
