// T4 (spec SD8, SD15; plan PD21): the engine's frame loop with a stand-in WebGL2 context, so the
// per-frame latency record, the render scale in the stats and the scaled targets are checked
// without a GPU. Every GL call is a no-op except the ones the assertions read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine, ZERO_FEATURES, type Engine } from "./index.ts";

interface Call {
  name: string;
  args: unknown[];
}

function fakeCanvas(width: number, height: number) {
  const calls: Call[] = [];
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      if (/^[A-Z_0-9]+$/.test(prop)) return prop; // constants: their own name, for the record
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        return {}; // truthy: shaders compile, programs link, objects exist
      };
    },
  });
  const canvas = {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    getContext: () => gl,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

let pending: FrameRequestCallback | null = null;
let now = 0;

/** Runs one animation frame at `t`; `performance.now()` reads `t + 1` (after the draw calls). */
function frameAt(t: number) {
  const callback = pending!;
  pending = null;
  now = t + 1;
  callback(t);
}

beforeEach(() => {
  pending = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pending = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function started(width = 640, height = 360): { engine: Engine; calls: Call[] } {
  const { canvas, calls } = fakeCanvas(width, height);
  const engine = createEngine(canvas);
  engine.start();
  return { engine, calls };
}

describe("latency record in the frame loop (PD21)", () => {
  it("frames repeating the same capturedAt add one sample, not one per frame", () => {
    const { engine } = started();
    engine.setFeatures({ ...ZERO_FEATURES, beat: 1, capturedAt: 990 });
    for (let i = 0; i < 10; i++) frameAt(1000 + i * 16);
    expect(engine.latency()).toEqual({ last: 11, p95: 11, worst: 11, samples: 1 });
    engine.setFeatures({ ...ZERO_FEATURES, capturedAt: 1150 });
    frameAt(1170);
    expect(engine.latency()).toMatchObject({ last: 21, worst: 21, samples: 2 });
  });

  it("records nothing before any audio (zero features)", () => {
    const { engine } = started();
    for (let i = 0; i < 10; i++) frameAt(i * 16);
    expect(engine.latency().samples).toBe(0);
  });
});

describe("render scale in the frame loop (SD8)", () => {
  it("stats report the render scale, 100% at start and the cap when lower", () => {
    const { engine } = started();
    frameAt(0);
    expect(engine.stats().renderScale).toBe(1);
    engine.setScaleCap(0.5);
    frameAt(16);
    expect(engine.stats().renderScale).toBe(0.5);
  });

  it("renders at canvas size × scale and blits up to the full canvas", () => {
    const { engine, calls } = started(640, 360);
    engine.setScaleCap(0.75);
    frameAt(0);
    const viewport = calls.filter((c) => c.name === "viewport").at(-1)!;
    expect(viewport.args).toEqual([0, 0, 480, 270]);
    const blit = calls.filter((c) => c.name === "blitFramebuffer").at(-1)!;
    expect(blit.args.slice(0, 8)).toEqual([0, 0, 480, 270, 0, 0, 640, 360]);
    expect(blit.args[9]).toBe("LINEAR");
  });
});
