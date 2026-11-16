// B-02 T5, T6 (spec SD12, SD15; plan PD3): every generated fragment shader compiles and links in
// Chromium's WebGL2 (ANGLE on SwiftShader), in a context the test creates in the page.
import { expect, test, type Page } from "@playwright/test";
import { BUILT_IN_PROFILE, EFFECTS, type EffectType } from "../../engine/src/profile.ts";
import { buildFragment } from "../../engine/src/shader.ts";
import { linkAll, px, render, SIZE, type Rgb } from "./fragment.ts";

const ALL = Object.keys(EFFECTS) as EffectType[];
const BUILT_IN = BUILT_IN_PROFILE.effects.map((e) => e.type);

/** A fixed shuffle, so a failure names the same list every run. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function expectAllLink(page: Page, lists: EffectType[][]) {
  const results = await linkAll(page, lists.map(buildFragment));
  results.forEach((result, i) => {
    expect(result, `effects: ${lists[i]!.join(", ") || "(none)"}`).toEqual({
      compiled: true,
      linked: true,
      log: "",
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the built-in list, the empty list, each single effect and three shuffles link (T5)", async ({
  page,
}) => {
  await expectAllLink(page, [
    BUILT_IN,
    [],
    ...ALL.map((type) => [type]),
    shuffled(BUILT_IN, 1),
    shuffled(BUILT_IN, 2),
    shuffled(BUILT_IN, 3),
  ]);
});

test("the full twelve-effect list, each new effect alone and two shuffles of twelve link (T6)", async ({
  page,
}) => {
  await expectAllLink(page, [
    ALL,
    ["paletteMap"],
    ["mirror"],
    ["rgbSplit"],
    shuffled(ALL, 11),
    shuffled(ALL, 12),
  ]);
});

const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const BLACK_WHITE = [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

test("all three new effects at strength 0 give the input back within ±2 (T6)", async ({ page }) => {
  const input = await render(page, [], RED, BLUE, {});
  expect(px(input, 10, 10)).toEqual([255, 0, 0]);
  expect(px(input, 50, 10)).toEqual([0, 0, 255]);
  const out = await render(page, ["paletteMap", "mirror", "rgbSplit"], RED, BLUE, {
    uPalette: BLACK_WHITE,
    uPaletteMix: [0],
    uMirror: [0],
    uSegments: [6],
    uRgbSplit: [0],
  });
  let worst = 0;
  input.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - out[i]!))));
  expect(worst).toBeLessThanOrEqual(2);
});

test("paletteMap at 1 with black-to-white gives a grey of the input's luma within ±6 (T6)", async ({
  page,
}) => {
  const out = await render(page, ["paletteMap"], RED, BLUE, {
    uPalette: BLACK_WHITE,
    uPaletteMix: [1],
  });
  const red = px(out, 10, 32);
  const blue = px(out, 50, 32);
  const lumaRed = 0.299 * 255;
  const lumaBlue = 0.114 * 255;
  for (const c of red) expect(Math.abs(c - lumaRed)).toBeLessThanOrEqual(6);
  for (const c of blue) expect(Math.abs(c - lumaBlue)).toBeLessThanOrEqual(6);
});

test("mirror at 1 with 2 segments makes the left half the mirror of the right (T6)", async ({
  page,
}) => {
  const plain = await render(page, ["mirror"], RED, BLUE, { uMirror: [0], uSegments: [2] });
  expect(px(plain, 10, 20)).toEqual([255, 0, 0]);
  const out = await render(page, ["mirror"], RED, BLUE, { uMirror: [1], uSegments: [2] });
  for (const y of [10, 20, 44, 54]) {
    for (const x of [6, 14, 22]) {
      const mirrored = px(out, SIZE - 1 - x, y);
      const left = px(out, x, y);
      for (let c = 0; c < 3; c++) expect(Math.abs(left[c]! - mirrored[c]!)).toBeLessThanOrEqual(2);
    }
  }
  expect(px(out, 10, 20)).not.toEqual([255, 0, 0]); // the left half changed
});

test("rgbSplit at 1 moves the red edge and not the green one (T6)", async ({ page }) => {
  const white: Rgb = [255, 255, 255];
  const black: Rgb = [0, 0, 0];
  const plain = await render(page, ["rgbSplit"], white, black, { uRgbSplit: [0] });
  expect(px(plain, 28, 32)).toEqual([255, 255, 255]);
  const out = await render(page, ["rgbSplit"], white, black, { uRgbSplit: [0.1] });
  const [r, g, b] = px(out, 28, 32);
  expect(r).toBeLessThan(40); // red read from 6 px to the right: already black
  expect(g).toBeGreaterThan(215); // green stays at the plain edge
  expect(b).toBeGreaterThan(215);
  const [r2, g2] = px(out, 35, 32);
  expect(g2).toBeLessThan(40);
  expect(r2).toBeLessThan(40);
  expect(px(out, 4, 32)).toEqual([255, 255, 255]); // far from the edge nothing moves
});
