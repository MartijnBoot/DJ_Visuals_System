// The renderer's public surface (spec, In scope: engine/). Framework-free: raw WebGL2 and
// requestAnimationFrame, no dependency of any kind (Phase 0 AC16). Each frame draws the look
// (`look.ts`) into one of two ping-pong targets, reading the other as the previous frame, and
// blits the result to the canvas.
import { DEFAULT_DIALS, ZERO_FEATURES, type AudioFeatures, type Dials } from "./features.ts";
import {
  createProgram,
  createTarget,
  createTexture,
  deleteTarget,
  FULLSCREEN_VERTEX,
  type Target,
} from "./gl.ts";
import { LOOK_FRAGMENT, lookUniforms } from "./look.ts";
import { createFrameStats, type FrameStats } from "./stats.ts";

export type { FrameStats } from "./stats.ts";
export type { AudioFeatures, Dials } from "./features.ts";
export { DEFAULT_DIALS, ZERO_FEATURES } from "./features.ts";

export interface Engine {
  start(): void;
  stop(): void;
  stats(): FrameStats;
  /** The newest audio features; read by the next frame. */
  setFeatures(features: AudioFeatures): void;
  /** The two dials; applied on the next frame (AC9). */
  setDials(dials: Dials): void;
  /** The camera, or `null` for the generative input (SD10). */
  setSource(video: HTMLVideoElement | null): void;
}

/** Thrown by `createEngine` when the canvas gives no WebGL2 context. */
export class WebGL2UnavailableError extends Error {
  constructor() {
    super("WebGL2 is not available in this browser");
    this.name = "WebGL2UnavailableError";
  }
}

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: a frame can be uploaded. */
const HAVE_CURRENT_DATA = 2;

export function createEngine(canvas: HTMLCanvasElement): Engine {
  // No multisampling: `blitFramebuffer` may not write to a multisampled default framebuffer.
  const gl = canvas.getContext("webgl2", { antialias: false });
  if (!gl) throw new WebGL2UnavailableError();

  const program = createProgram(gl, FULLSCREEN_VERTEX, LOOK_FRAGMENT);
  const at = (name: string) => gl.getUniformLocation(program, name);
  const loc = {
    source: at("uSource"),
    previous: at("uPrevious"),
    resolution: at("uResolution"),
    cover: at("uCover"),
    hasSource: at("uHasSource"),
    time: at("uTime"),
    tint: at("uTint"),
    tintWeight: at("uTintWeight"),
    block: at("uBlock"),
    levels: at("uLevels"),
    feedback: at("uFeedback"),
    zoom: at("uZoom"),
    displace: at("uDisplace"),
    flash: at("uFlash"),
    grain: at("uGrain"),
    edges: at("uEdges"),
    brightness: at("uBrightness"),
  };
  const sourceTexture = createTexture(gl);

  const frames = createFrameStats();
  let handle: number | null = null;
  let features: AudioFeatures = ZERO_FEATURES;
  let dials: Dials = DEFAULT_DIALS;
  let video: HTMLVideoElement | null = null;
  let targets: [Target, Target] | null = null;
  let current = 0;

  const targetsFor = (width: number, height: number): [Target, Target] => {
    if (targets && targets[0].width === width && targets[0].height === height) return targets;
    if (targets) for (const t of targets) deleteTarget(gl, t);
    targets = [createTarget(gl, width, height), createTarget(gl, width, height)];
    return targets;
  };

  /** Uploads the camera's current frame; returns its size, or null to draw the noise field. */
  const uploadSource = (): { width: number; height: number } | null => {
    if (!video || video.readyState < HAVE_CURRENT_DATA || video.videoWidth === 0) return null;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      return null; // the picture never stops (SD7): fall back to the noise field
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
    return { width: video.videoWidth, height: video.videoHeight };
  };

  const frame = (timestamp: number) => {
    handle = requestAnimationFrame(frame);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (width > 0 && height > 0) draw(timestamp, width, height);
    frames.record(timestamp);
  };

  const draw = (timestamp: number, width: number, height: number) => {
    const pair = targetsFor(width, height);
    const target = pair[current]!;
    const previous = pair[1 - current]!;
    const size = uploadSource();
    const u = lookUniforms(features, dials, timestamp, size !== null, width);

    // Cover fit: the camera fills the frame, cropped on the long side, never stretched.
    let cover: [number, number] = [1, 1];
    if (size) {
      const ratio = size.width / size.height / (width / height);
      cover = ratio > 1 ? [1 / ratio, 1] : [1, ratio];
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(loc.source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, previous.texture);
    gl.uniform1i(loc.previous, 1);
    gl.uniform2f(loc.resolution, width, height);
    gl.uniform2f(loc.cover, cover[0], cover[1]);
    gl.uniform1f(loc.hasSource, size ? 1 : 0);
    gl.uniform1f(loc.time, u.time);
    gl.uniform3f(loc.tint, u.tint[0], u.tint[1], u.tint[2]);
    gl.uniform1f(loc.tintWeight, u.tintWeight);
    gl.uniform1f(loc.block, u.block);
    gl.uniform1f(loc.levels, u.levels);
    gl.uniform1f(loc.feedback, u.feedback);
    gl.uniform1f(loc.zoom, u.zoom);
    gl.uniform1f(loc.displace, u.displace);
    gl.uniform1f(loc.flash, u.flash);
    gl.uniform1f(loc.grain, u.grain);
    gl.uniform1f(loc.edges, u.edges);
    gl.uniform1f(loc.brightness, u.brightness);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    current = 1 - current;
  };

  return {
    start() {
      if (handle === null) handle = requestAnimationFrame(frame);
    },
    stop() {
      if (handle !== null) cancelAnimationFrame(handle);
      handle = null;
    },
    stats() {
      return frames.read(performance.now());
    },
    setFeatures(next) {
      features = next;
    },
    setDials(next) {
      dials = next;
    },
    setSource(next) {
      video = next;
    },
  };
}
