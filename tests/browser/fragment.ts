// Compiling and drawing generated fragment shaders in the page, for the shader specs (B-02 T5,
// T6; B-03 T4). The page's own WebGL2 context, the fullscreen vertex shader, the uniforms the
// test sets and nothing of the engine's frame loop.
import type { Page } from "@playwright/test";
import { FULLSCREEN_VERTEX } from "../../engine/src/gl.ts";
import { buildFragment, type FragmentEntry } from "../../engine/src/shader.ts";

export interface LinkResult {
  compiled: boolean;
  linked: boolean;
  log: string;
}

/** Compiles and links each fragment with the fullscreen vertex shader; returns the logs. */
export async function linkAll(page: Page, fragments: string[]): Promise<LinkResult[]> {
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

export const SIZE = 64;
export type Rgb = [number, number, number];

/** Uniforms set with a `…fv` call: an array, not one value. */
const VECTORS: Record<string, "uniform1fv" | "uniform3fv" | "uniform4fv"> = {
  uPalette: "uniform3fv",
  uCustomStrength: "uniform1fv",
  uCustomParam: "uniform4fv",
};

/**
 * Draws `entries` into a 64×64 canvas from a texture whose left half is `left` and right half
 * `right`, with the test setting the uniforms, and reads every pixel back (RGBA, row 0 first).
 */
export async function render(
  page: Page,
  entries: FragmentEntry[],
  left: Rgb,
  right: Rgb,
  uniforms: Record<string, number[]>,
): Promise<number[]> {
  return page.evaluate(
    ({ vertex, fragment, left, right, uniforms, size, vectors }) => {
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
        const vector = vectors[name];
        if (vector) gl[vector](l, v);
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
      fragment: buildFragment(entries),
      left,
      right,
      uniforms,
      size: SIZE,
      vectors: VECTORS,
    },
  );
}

/** The RGB of one pixel of a `render` result. */
export const px = (image: number[], x: number, y: number) =>
  image.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3);
