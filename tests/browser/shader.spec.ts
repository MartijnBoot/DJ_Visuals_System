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
