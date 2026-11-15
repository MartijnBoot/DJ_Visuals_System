// B-03 T4 (spec AC4, AC5, SD3, SD13; plan PD7): a custom effect's code is one link of the chain,
// compiled by Chromium's WebGL2 (ANGLE on SwiftShader) in a context the test creates.
import { expect, test } from "@playwright/test";
import type { CustomEntry, FragmentEntry } from "../../engine/src/shader.ts";
import { buildFragment } from "../../engine/src/shader.ts";
import { linkAll, px, render, SIZE, type Rgb } from "./fragment.ts";

const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const BLACK_WHITE = [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const custom = (code: string): CustomEntry => ({ type: "custom", code });
const SWAP = custom("return source(uv).bgr;");

/** The first custom effect on at full strength, the rest off. */
const strengths = (first: number) => [first, ...Array<number>(11).fill(0)];

/** A green flash before, and (optionally) a palette map to grey after. */
const FLASH = { uFlash: [0.35], uFlashColour: [0, 1, 0] };
const GREY = { uPalette: BLACK_WHITE, uPaletteMix: [1] };

const near = (got: number[], want: number[], tolerance: number) =>
  got.forEach((v, i) =>
    expect(Math.abs(v - want[i]!), `${got} vs ${want}`).toBeLessThanOrEqual(tolerance),
  );

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("custom code runs at its stack position: it sees the effect before, the next sees it (AC4)", async ({
  page,
}) => {
  // Red under a 0.35 green flash is (0.65, 0.35, 0); the body swaps it to (0, 0.35, 0.65).
  const swapped = await render(page, ["flash", SWAP], RED, BLUE, {
    ...FLASH,
    uCustomStrength: strengths(1),
  });
  near(px(swapped, 10, 32), [0, 89, 166], 3);

  // A palette map after it greys the swapped picture: luma (0, 0.35, 0.65) is 0.28. Had it run
  // on the unswapped picture it would be luma (0.65, 0.35, 0) = 0.40.
  const after = await render(page, ["flash", SWAP, "paletteMap"], RED, BLUE, {
    ...FLASH,
    ...GREY,
    uCustomStrength: strengths(1),
  });
  near(px(after, 10, 32), [71, 71, 71], 6);
  const without = await render(page, ["flash", "paletteMap"], RED, BLUE, { ...FLASH, ...GREY });
  near(px(without, 10, 32), [102, 102, 102], 6);
});

test("a custom effect at strength 0 renders exactly the list without it (AC5, SD13)", async ({
  page,
}) => {
  const paintRed = custom("return vec3(1.0, 0.0, 0.0);");
  const list: FragmentEntry[] = ["flash", paintRed, "paletteMap"];
  const off = await render(page, list, RED, BLUE, {
    ...FLASH,
    ...GREY,
    uPaletteMix: [0.5],
    uCustomStrength: strengths(0),
  });
  const absent = await render(page, ["flash", "paletteMap"], RED, BLUE, {
    ...FLASH,
    ...GREY,
    uPaletteMix: [0.5],
  });
  expect(off).toEqual(absent);
  const on = await render(page, list, RED, BLUE, {
    ...FLASH,
    ...GREY,
    uPaletteMix: [0.5],
    uCustomStrength: strengths(1),
  });
  expect(px(on, 50, 32)).not.toEqual(px(absent, 50, 32)); // the body does paint when on
  expect(on).toHaveLength(SIZE * SIZE * 4);
});

test("a body using every contract name links, as do twelve custom effects (PD7)", async ({
  page,
}) => {
  const everything = custom(`
  vec3 c = source(uv) + lastFrame(uv) * 0.1;
  c += vec3(resolution.x / resolution.y, time, 0.0) * 0.0;
  c += vec3(audio.level + audio.low + audio.mid + audio.high + audio.beat) * 0.01;
  for (int i = 0; i < 6; i++) {
    if (i >= paletteSize) break;
    c = mix(c, palette[i], 0.05);
  }
  c *= strength * (param[0] + param[1] + param[2] + param[3]);
  return c + vec3(hash(uv), valueNoise(uv * 4.0), 0.0) * 0.01;`);
  const twelve = Array.from({ length: 12 }, (_, i) =>
    custom(`return source(uv + vec2(${i}.0 * 0.001)) * (0.9 + 0.1 * param[${i % 4}]);`),
  );
  const lists: FragmentEntry[][] = [[everything], ["zoom", everything, "flash"], twelve];
  const results = await linkAll(page, lists.map(buildFragment));
  results.forEach((result, i) => {
    expect(result, `list ${i}`).toEqual({ compiled: true, linked: true, log: "" });
  });
});
