// The skeleton render: a solid colour whose hue cycles once per minute (spec SD8, plan PD15),
// about 3 degrees per 500 ms: several 8-bit steps, visible to a test, calm to the eye.

export const HUE_PERIOD_MS = 60_000;

const SATURATION = 0.6;
const LIGHTNESS = 0.45;

export type Rgb = readonly [number, number, number];

/** The clear colour for a frame timestamp, as three channels in 0..1. */
export function driftColour(timestampMs: number): Rgb {
  const hue = (((timestampMs / HUE_PERIOD_MS) % 1) + 1) % 1;
  return hslToRgb(hue, SATURATION, LIGHTNESS);
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  const sextant = Math.floor(h * 6) % 6;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sextant]!;
  return [r + m, g + m, b + m];
}
