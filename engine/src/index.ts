// The renderer's public surface (spec, In scope: engine/). Framework-free: raw WebGL2 and
// requestAnimationFrame, no dependency of any kind (AC16).
import { driftColour } from "./colour.ts";
import { createFrameStats, type FrameStats } from "./stats.ts";

export type { FrameStats } from "./stats.ts";

export interface Engine {
  start(): void;
  stop(): void;
  stats(): FrameStats;
}

/** Thrown by `createEngine` when the canvas gives no WebGL2 context. */
export class WebGL2UnavailableError extends Error {
  constructor() {
    super("WebGL2 is not available in this browser");
    this.name = "WebGL2UnavailableError";
  }
}

export function createEngine(canvas: HTMLCanvasElement): Engine {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new WebGL2UnavailableError();

  const frames = createFrameStats();
  let handle: number | null = null;

  const frame = (timestamp: number) => {
    handle = requestAnimationFrame(frame);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    const [r, g, b] = driftColour(timestamp);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    frames.record(timestamp);
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
  };
}
