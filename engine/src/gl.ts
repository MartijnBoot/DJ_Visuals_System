// Small WebGL2 helpers for the look's single pass: compile and link (blocking for the first
// program, non-blocking for a profile switch), textures, render targets, and the vertex shader
// for a fullscreen triangle drawn from `gl_VertexID` with no buffers.

/** Three vertices that cover the viewport; draw with `drawArrays(TRIANGLES, 0, 3)`. */
export const FULLSCREEN_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL2: createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`WebGL2: shader did not compile: ${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`WebGL2: program did not link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

/** A program whose link was started and not yet read (B-02 plan PD4). */
export interface Linking {
  program: WebGLProgram;
  vertex: WebGLShader;
  fragment: WebGLShader;
}

export type LinkState =
  | { state: "pending" }
  | { state: "ready"; program: WebGLProgram }
  | { state: "failed"; message: string };

/** `KHR_parallel_shader_compile`, when the context has it. */
export interface ParallelCompile {
  COMPLETION_STATUS_KHR: number;
}

/**
 * Starts compiling and linking without reading any status, so the driver can work while the
 * current program keeps drawing. Read the result with `programReady`.
 */
export function beginProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): Linking {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("WebGL2: createShader failed");
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram();
  const linking = {
    program,
    vertex: shader(gl.VERTEX_SHADER, vertex),
    fragment: shader(gl.FRAGMENT_SHADER, fragment),
  };
  gl.attachShader(program, linking.vertex);
  gl.attachShader(program, linking.fragment);
  gl.linkProgram(program);
  return linking;
}

/**
 * With the extension, `pending` until the link has finished, without blocking; without it, the
 * status read waits for the link (one long frame at a structural switch). A failed program is
 * deleted.
 */
export function programReady(
  gl: WebGL2RenderingContext,
  linking: Linking,
  parallel: ParallelCompile | null,
): LinkState {
  const { program, vertex, fragment } = linking;
  if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
    return { state: "pending" };
  }
  const linked = Boolean(gl.getProgramParameter(program, gl.LINK_STATUS));
  const message = linked
    ? ""
    : `WebGL2: program did not link: ${gl.getProgramInfoLog(program) ?? ""} ${gl.getShaderInfoLog(fragment) ?? ""}`;
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!linked) {
    gl.deleteProgram(program);
    return { state: "failed", message };
  }
  return { state: "ready", program };
}

/** An RGBA8 texture with linear filtering and clamped edges, optionally sized. */
export function createTexture(gl: WebGL2RenderingContext, width = 1, height = 1): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return texture;
}

export interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

/** A framebuffer that renders into its own RGBA8 texture (no float targets needed). */
export function createTarget(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const texture = createTexture(gl, width, height);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, texture, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, target: Target): void {
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}
