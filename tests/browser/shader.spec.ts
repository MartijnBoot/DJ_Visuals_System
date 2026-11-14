// B-02 T5, T6 (spec SD12, SD15; plan PD3): every generated fragment shader compiles and links in
// Chromium's WebGL2 (ANGLE on SwiftShader), in a context the test creates in the page.
import { expect, test, type Page } from "@playwright/test";
import { FULLSCREEN_VERTEX } from "../../engine/src/gl.ts";
import { BUILT_IN_PROFILE, EFFECTS, type EffectType } from "../../engine/src/profile.ts";
import { buildFragment } from "../../engine/src/shader.ts";

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

/** Compiles and links each fragment with the fullscreen vertex shader; returns the logs. */
async function linkAll(page: Page, fragments: string[]) {
  return page.evaluate(
    ({ vertex, fragments }) => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) throw new Error("no WebGL2");
      return fragments.map((fragment) => {
        const shader = (type: number, source: string) => {
          const s = gl.createShader(type)!;
          gl.shaderSource(s, source);
          gl.compileShader(s);
          return s;
        };
        const vs = shader(gl.VERTEX_SHADER, vertex);
        const fs = shader(gl.FRAGMENT_SHADER, fragment);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        return {
          compiled: gl.getShaderParameter(fs, gl.COMPILE_STATUS) as boolean,
          linked: gl.getProgramParameter(program, gl.LINK_STATUS) as boolean,
          log: `${gl.getShaderInfoLog(fs) ?? ""}${gl.getProgramInfoLog(program) ?? ""}`,
        };
      });
    },
    { vertex: FULLSCREEN_VERTEX, fragments },
  );
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

const SIZE = 64;
type Rgb = [number, number, number];

/**
 * Draws `types` into a 64×64 canvas from a texture whose left half is `left` and right half
 * `right`, with the test setting the uniforms, and reads every pixel back (RGBA, row 0 first).
 */
async function render(
  page: Page,
  types: EffectType[],
  left: Rgb,
  right: Rgb,
  uniforms: Record<string, number[]>,
): Promise<number[]> {
  return page.evaluate(
    ({ vertex, fragment, left, right, uniforms, size }) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
      const program = gl.createProgram();
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("did not link");
      gl.useProgram(program);

      const data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const c = x < size / 2 ? left : right;
          data.set([c[0], c[1], c[2], 255], (y * size + x) * 4);
        }
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(program, "uSource"), 0);
      gl.uniform1i(gl.getUniformLocation(program, "uPrevious"), 0);

      const defaults: Record<string, number[]> = {
        uResolution: [size, size],
        uCover: [1, 1],
        uHasSource: [1],
        uTime: [0],
        uTint: [1, 1, 1],
        uTintWeight: [0],
        uBlock: [1],
        uLevels: [256],
        uPaletteSize: [2],
        uSegments: [2],
      };
      for (const [name, v] of Object.entries({ ...defaults, ...uniforms })) {
        const l = gl.getUniformLocation(program, name);
        if (name === "uPalette") gl.uniform3fv(l, v);
        else if (v.length === 1) gl.uniform1f(l, v[0]!);
        else if (v.length === 2) gl.uniform2f(l, v[0]!, v[1]!);
        else gl.uniform3f(l, v[0]!, v[1]!, v[2]!);
      }
      gl.viewport(0, 0, size, size);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const out = new Uint8Array(size * size * 4);
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return Array.from(out);
    },
    {
      vertex: FULLSCREEN_VERTEX,
      fragment: buildFragment(types),
      left,
      right,
      uniforms,
      size: SIZE,
    },
  );
}

const px = (image: number[], x: number, y: number) =>
  image.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3);

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
