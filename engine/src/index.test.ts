// T4 (spec SD8, SD15; plan PD21) and B-02 T5 (spec SD15, SD17; plan PD4): the engine's frame
// loop with a stand-in WebGL2 context, so the per-frame latency record, the render scale in the
// stats, the scaled targets and the prepared profile swap are checked without a GPU. Every GL
// call is recorded; programs link when the test says so.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_PROFILE, createEngine, ZERO_FEATURES, type Profile } from "./index.ts";
import { fragmentLayout } from "./shader.ts";

interface Call {
  name: string;
  args: unknown[];
}

interface FakeProgram {
  id: number;
  /** `COMPLETION_STATUS_KHR`: the parallel link has finished. */
  complete: boolean;
  fails: boolean;
}

interface FakeOptions {
  /** Whether the context offers `KHR_parallel_shader_compile`. */
  parallel?: boolean;
}

function fakeCanvas(width: number, height: number, { parallel = true }: FakeOptions = {}) {
  const calls: Call[] = [];
  const programs: FakeProgram[] = [];
  const control = { failLinks: false, shaderLog: "" };
  const special: Record<string, (...args: unknown[]) => unknown> = {
    getExtension: (name) =>
      name === "KHR_parallel_shader_compile" && parallel
        ? { COMPLETION_STATUS_KHR: "COMPLETION_STATUS_KHR" }
        : null,
    createProgram: () => {
      const program: FakeProgram = {
        id: programs.length,
        complete: false,
        fails: control.failLinks,
      };
      programs.push(program);
      return program;
    },
    getProgramParameter: (program, pname) => {
      const p = program as FakeProgram;
      if (pname === "COMPLETION_STATUS_KHR") return p.complete;
      if (pname === "LINK_STATUS") return !p.fails;
      return true;
    },
    getProgramInfoLog: () => "fake link failure",
    getShaderInfoLog: () => control.shaderLog,
    getUniformLocation: (program, name) => ({ program: (program as FakeProgram).id, name }),
  };
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string) {
      if (/^[A-Z_0-9]+$/.test(prop)) return prop; // constants: their own name, for the record
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        return special[prop] ? special[prop](...args) : {}; // truthy: shaders compile, objects exist
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
  return {
    canvas,
    calls,
    programs,
    control,
    completeLinks: () => programs.forEach((p) => (p.complete = true)),
  };
}

let pending: FrameRequestCallback | null = null;
let now = 0;
let log: Call[] = [];

/** Runs one animation frame at `t`; `performance.now()` reads `t + 1` (after the draw calls). */
function frameAt(t: number) {
  const callback = pending!;
  pending = null;
  now = t + 1;
  log.push({ name: "@frame", args: [t] });
  callback(t);
}

/** The GL calls of each frame run so far, in order. */
function frames(): Call[][] {
  const out: Call[][] = [];
  for (const call of log) {
    if (call.name === "@frame") out.push([]);
    else out.at(-1)?.push(call);
  }
  return out;
}

const usedProgram = (frame: Call[]) =>
  (frame.find((c) => c.name === "useProgram")?.args[0] as FakeProgram | undefined)?.id;

const uniform = (frame: Call[], name: string) =>
  frame.find((c) => c.name.startsWith("uniform") && (c.args[0] as { name?: string }).name === name)
    ?.args[1];

const flush = () => new Promise((r) => setTimeout(r, 0));

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

function started(width = 640, height = 360, options: FakeOptions = {}) {
  const fake = fakeCanvas(width, height, options);
  log = fake.calls;
  const engine = createEngine(fake.canvas);
  engine.start();
  return { engine, calls: fake.calls, fake };
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

describe("features in the frame loop (B-08 AC5, PD11)", () => {
  it("draws each frame with the features set before it", () => {
    const { engine } = started();
    engine.setFeatures({ ...ZERO_FEATURES, beat: 1, capturedAt: 1 });
    frameAt(0);
    expect(uniform(frames().at(-1)!, "uFlash")).toBeGreaterThan(0);
    engine.setFeatures(ZERO_FEATURES);
    frameAt(16);
    expect(uniform(frames().at(-1)!, "uFlash")).toBe(0);
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

describe("setProfile and the prepared swap (B-02 SD15, PD4)", () => {
  const zoomOnly: Profile = {
    ...BUILT_IN_PROFILE,
    name: "Zoom",
    effects: [{ type: "zoom", amount: 1 }],
  };

  it("starts on the built-in profile", () => {
    const { calls } = started();
    frameAt(0);
    expect(usedProgram(frames()[0]!)).toBe(0);
    expect(calls.filter((c) => c.name === "createProgram")).toHaveLength(1);
  });

  it("keeps drawing the old program until the link is ready, then swaps between two frames", async () => {
    const { engine, fake } = started();
    frameAt(0);
    let done = false;
    const switched = engine.setProfile(zoomOnly).then(() => (done = true));
    for (let i = 1; i <= 3; i++) frameAt(i * 16);
    await flush();
    expect(done).toBe(false);
    fake.completeLinks();
    frameAt(64);
    await switched;
    frameAt(80);
    const all = frames();
    expect(all.map(usedProgram)).toEqual([0, 0, 0, 0, 1, 1]);
    for (const frame of all) {
      expect(frame.filter((c) => c.name === "drawArrays")).toHaveLength(1);
    }
    expect(uniform(all[4]!, "uZoom")).toBeCloseTo(1.12, 9);
  });

  it("reads the link on the next frame when the context has no parallel compile", async () => {
    const { engine } = started(640, 360, { parallel: false });
    frameAt(0);
    const switched = engine.setProfile(zoomOnly);
    frameAt(16);
    await switched;
    expect(frames().map(usedProgram)).toEqual([0, 1]);
  });

  it("links nothing for a value-only change, and applies it on the next frame", async () => {
    const { engine, calls } = started();
    frameAt(0);
    const louder: Profile = {
      ...BUILT_IN_PROFILE,
      effects: BUILT_IN_PROFILE.effects.map((e) => (e.type === "zoom" ? { ...e, amount: 1 } : e)),
    };
    await engine.setProfile(louder);
    frameAt(16);
    expect(calls.filter((c) => c.name === "createProgram")).toHaveLength(1);
    expect(frames().map(usedProgram)).toEqual([0, 0]);
    expect(uniform(frames()[0]!, "uZoom")).toBe(1);
    expect(uniform(frames()[1]!, "uZoom")).toBeCloseTo(1.12, 9);
  });

  it("rejects a failed link, logs it once and keeps drawing the old profile", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { engine, fake } = started(640, 360, { parallel: false });
    frameAt(0);
    fake.control.failLinks = true;
    const first = engine.setProfile(zoomOnly);
    frameAt(16);
    await expect(first).rejects.toThrow(/link/);
    const second = engine.setProfile(zoomOnly);
    frameAt(32);
    await expect(second).rejects.toThrow(/link/);
    frameAt(48);
    expect(frames().map(usedProgram)).toEqual([0, 0, 0, 0]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("supersedes a pending profile with a later one", async () => {
    const { engine, fake } = started();
    frameAt(0);
    const first = engine.setProfile(zoomOnly);
    const second = engine.setProfile({ ...zoomOnly, effects: [{ type: "smear", amount: 1 }] });
    await expect(first).rejects.toThrow(/superseded/);
    fake.completeLinks();
    frameAt(16);
    await second;
    const last = frames().at(-1)!;
    expect(uniform(last, "uFeedback")).toBe(0); // the swap frame (below)
    frameAt(32);
    expect(uniform(frames().at(-1)!, "uFeedback")).toBeGreaterThan(0);
    expect(uniform(frames().at(-1)!, "uZoom")).toBe(1);
  });

  it("returning to the active effect list cancels the pending link and keeps the program", async () => {
    const { engine, fake } = started();
    frameAt(0);
    const away = engine.setProfile(zoomOnly);
    await engine.setProfile(BUILT_IN_PROFILE);
    await expect(away).rejects.toThrow(/superseded/);
    fake.completeLinks();
    frameAt(16);
    expect(frames().map(usedProgram)).toEqual([0, 0]);
  });

  it("draws no smear on the first frame after a swap, then the profile's", async () => {
    const { engine, fake } = started();
    engine.setDials({ recognisability: 1, reactivity: 0 });
    frameAt(0);
    const smearOnly: Profile = { ...zoomOnly, effects: [{ type: "smear", amount: 1 }] };
    const switched = engine.setProfile(smearOnly);
    fake.completeLinks();
    frameAt(16);
    await switched;
    frameAt(32);
    const all = frames();
    expect(uniform(all[0]!, "uFeedback")).toBeCloseTo(0.85 * 1, 9); // the built-in's smear
    expect(uniform(all[1]!, "uFeedback")).toBe(0);
    expect(uniform(all[2]!, "uFeedback")).toBeCloseTo(0.85, 9);
  });

  it("draws no smear on the first frame after the targets are recreated (scale step, resize)", () => {
    const { engine } = started();
    engine.setDials({ recognisability: 1, reactivity: 0 });
    frameAt(0); // creates the targets
    frameAt(16);
    frameAt(32);
    engine.setScaleCap(0.75); // recreates them, cleared black
    frameAt(48);
    frameAt(64);
    const all = frames();
    expect(uniform(all[2]!, "uFeedback")).toBeCloseTo(0.85, 9);
    expect(uniform(all[3]!, "uFeedback")).toBe(0);
    expect(uniform(all[4]!, "uFeedback")).toBeCloseTo(0.85, 9);
  });

  it("reuses a program it linked before, with no new link", async () => {
    const { engine, fake, calls } = started();
    frameAt(0);
    const there = engine.setProfile(zoomOnly);
    fake.completeLinks();
    frameAt(16);
    await there;
    const back = engine.setProfile(BUILT_IN_PROFILE);
    frameAt(32);
    await back;
    const again = engine.setProfile(zoomOnly);
    frameAt(48);
    await again;
    expect(calls.filter((c) => c.name === "createProgram")).toHaveLength(2);
    expect(frames().map(usedProgram)).toEqual([0, 1, 0, 1]);
  });
});

// B-03 T4 (spec SD1, SD3; plan PD7): a program is keyed by its effect list and every body's
// code; the code reaches the context only through `shaderSource`.
describe("custom effects in the engine (B-03)", () => {
  const CODE = "return source(uv).bgr * (0.5 + 0.5 * param[0]); // marker-7f3a";
  const coded = (code: string, value = 0.5): Profile => ({
    ...BUILT_IN_PROFILE,
    name: "Coded",
    effects: [
      { type: "zoom", amount: 0.2 },
      {
        type: "custom",
        label: "Swap",
        amount: 1,
        abstraction: false,
        params: [{ name: "mix", value }],
        code,
      },
    ],
  });

  it("links one program per distinct code, and none for a parameter change", async () => {
    const { engine, fake, calls } = started();
    frameAt(0);
    const first = engine.setProfile(coded(CODE));
    fake.completeLinks();
    frameAt(16);
    await first;
    await engine.setProfile(coded(CODE, 0.9));
    frameAt(32);
    expect(calls.filter((c) => c.name === "createProgram")).toHaveLength(2);
    expect(uniform(frames().at(-1)!, "uCustomParam")).toEqual(expect.arrayContaining([0.9]));
    const other = engine.setProfile(coded("return source(uv);"));
    fake.completeLinks();
    frameAt(48);
    await other;
    expect(calls.filter((c) => c.name === "createProgram")).toHaveLength(3);
    expect(frames().map(usedProgram)).toEqual([0, 1, 1, 2]);
  });

  it("hands the code to shaderSource and to no other call", async () => {
    const { engine, fake, calls } = started();
    frameAt(0);
    const switched = engine.setProfile(coded(CODE));
    fake.completeLinks();
    frameAt(16);
    await switched;
    frameAt(32);
    const carrying = calls.filter((c) => JSON.stringify(c.args).includes("marker-7f3a"));
    expect(carrying.map((c) => c.name)).toEqual(["shaderSource"]);
  });

  it("sets the custom uniforms only for a program that has them", async () => {
    const { engine, fake } = started();
    engine.setFeatures({ ...ZERO_FEATURES, level: 0.5, capturedAt: 1 });
    engine.setDials({ recognisability: 1, reactivity: 1 });
    frameAt(0);
    const builtIn = frames()[0]!;
    expect(
      builtIn.some(
        (c) => c.name.startsWith("uniform") && /uCustom|uAudio/.test(JSON.stringify(c.args[0])),
      ),
    ).toBe(false);
    const switched = engine.setProfile(coded(CODE));
    fake.completeLinks();
    frameAt(16);
    await switched;
    frameAt(32);
    const last = frames().at(-1)!;
    expect(uniform(last, "uCustomStrength")).toEqual(expect.arrayContaining([1]));
    expect(uniform(last, "uAudio.level")).toBe(0.5);
  });
});

// B-03 T5 (plan PD4): in a profile with a custom effect both targets start from the last output,
// at a swap and when they are recreated, so the limiter always has a real previous frame.
describe("the limiter's previous frame (B-03)", () => {
  const coded: Profile = {
    ...BUILT_IN_PROFILE,
    name: "Coded",
    effects: [
      {
        type: "custom",
        label: "Pass",
        amount: 1,
        abstraction: false,
        params: [],
        code: "return source(uv);",
      },
    ],
  };
  const blits = (frame: Call[]) => frame.filter((c) => c.name === "blitFramebuffer").length;

  it("copies the last output into both recreated targets, only in a custom profile", async () => {
    const builtIn = started();
    frameAt(0);
    frameAt(16);
    builtIn.engine.setScaleCap(0.75);
    frameAt(32);
    expect(frames().map(blits)).toEqual([1, 1, 1]);

    const custom = started();
    frameAt(0);
    const switched = custom.engine.setProfile(coded);
    custom.fake.completeLinks();
    frameAt(16);
    await switched;
    frameAt(32);
    custom.engine.setScaleCap(0.75);
    frameAt(48);
    frameAt(64);
    // The swap frame seeds the target it draws into; the recreate frame copies the old output
    // into the new previous target, then seeds the one it draws into.
    expect(frames().map(blits)).toEqual([1, 2, 1, 3, 1]);
  });

  it("copies nothing at a swap into a built-in-only profile", async () => {
    const { engine, fake } = started();
    frameAt(0);
    const switched = engine.setProfile({
      ...BUILT_IN_PROFILE,
      effects: [{ type: "zoom", amount: 1 }],
    });
    fake.completeLinks();
    frameAt(16);
    await switched;
    expect(frames().map(blits)).toEqual([1, 1]);
  });
});

// B-03 T6 (spec AC21; plan PD9): a custom body that does not compile rejects with the effect and
// the line in its own text; the same code is not compiled again on every slider move.
describe("compile errors (B-03)", () => {
  const BROKEN = "float b = nope;\nreturn source(uv);";
  const broken = (value = 0.5): Profile => ({
    ...BUILT_IN_PROFILE,
    name: "Broken",
    effects: [
      { type: "zoom", amount: 0.2 },
      {
        type: "custom",
        label: "Swirl",
        amount: 1,
        abstraction: false,
        params: [{ name: "a", value }],
        code: BROKEN,
      },
    ],
  });

  it("rejects with the effect, its label and the body's own line, and keeps drawing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { engine, fake, calls } = started(640, 360, { parallel: false });
    frameAt(0);
    const [body] = fragmentLayout(["zoom", { type: "custom", code: BROKEN }]);
    fake.control.failLinks = true;
    fake.control.shaderLog = `ERROR: 0:${body!.firstLine}: 'nope' : undeclared identifier\n`;
    const first = engine.setProfile(broken());
    frameAt(16);
    await expect(first).rejects.toMatchObject({
      name: "ProfileCompileError",
      issues: [
        { effectIndex: 1, label: "Swirl", line: 1, message: "'nope' : undeclared identifier" },
      ],
    });
    const compiled = calls.filter((c) => c.name === "createShader").length;
    // The same code with another parameter value: rejected from the cache, nothing compiled.
    await expect(engine.setProfile(broken(0.9))).rejects.toMatchObject({
      name: "ProfileCompileError",
    });
    expect(calls.filter((c) => c.name === "createShader").length).toBe(compiled);
    frameAt(32);
    expect(frames().map(usedProgram)).toEqual([0, 0, 0]);
  });

  it("rejects with a plain error when the log names no line", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { engine, fake } = started(640, 360, { parallel: false });
    frameAt(0);
    fake.control.failLinks = true;
    const switched = engine.setProfile(broken());
    frameAt(16);
    await expect(switched).rejects.toThrow(/link/);
    await expect(switched).rejects.not.toMatchObject({ name: "ProfileCompileError" });
  });
});

// B-03 T7 (spec AC11, SD8; plan PD8): on a GPU that cannot keep up, the custom effects go off.
describe("the slow-GPU guard (B-03)", () => {
  const heavy = (value = 0.5): Profile => ({
    ...BUILT_IN_PROFILE,
    name: "Heavy",
    effects: [
      { type: "zoom", amount: 0.2 },
      {
        type: "custom",
        label: "Heavy",
        amount: 1,
        abstraction: false,
        params: [{ name: "a", value }],
        code: "return source(uv);",
      },
    ],
  });
  const drawsCustom = (frame: Call[]) => uniform(frame, "uCustomStrength") !== undefined;

  /** 60 frames at 60 Hz (the refresh estimate), then frames 100 ms apart for `seconds`. */
  function load(start: number, seconds: number): number {
    let t = start;
    for (let i = 0; i < 60; i++) frameAt((t += 1000 / 60));
    for (let i = 0; i < seconds * 10; i++) frameAt((t += 100));
    return t;
  }

  async function heavyOnSlowGpu() {
    const rig = started(640, 360, { parallel: false });
    const events: unknown[] = [];
    rig.engine.onGuard((event) => events.push(event));
    frameAt(0);
    const switched = rig.engine.setProfile(heavy());
    frameAt(10);
    await switched;
    return { ...rig, events };
  }

  it("goes to the profile without its custom effects 3 s after reaching 50%, once", async () => {
    const { engine, events } = await heavyOnSlowGpu();
    let t = load(10, 5);
    expect(engine.stats().renderScale).toBe(0.5);
    expect(events).toEqual([]);
    expect(drawsCustom(frames().at(-1)!)).toBe(true);
    for (let i = 0; i < 40; i++) frameAt((t += 100));
    expect(events).toEqual([{ kind: "slow", customBypassed: true }]);
    expect(drawsCustom(frames().at(-1)!)).toBe(false);
    for (let i = 0; i < 40; i++) frameAt((t += 100));
    expect(events).toHaveLength(1);
  });

  it("keeps the bypass for a same-key call and retries on a pick", async () => {
    const { engine, events } = await heavyOnSlowGpu();
    let t = load(10, 9);
    expect(events).toHaveLength(1);
    await engine.setProfile(heavy(0.9)); // a slider or a live colour: same program key
    frameAt((t += 100));
    expect(drawsCustom(frames().at(-1)!)).toBe(false);
    const retried = engine.setProfile(heavy(), { pick: true });
    frameAt((t += 100));
    await retried;
    frameAt((t += 100));
    expect(drawsCustom(frames().at(-1)!)).toBe(true);
    // Still too slow: it gives up again only after another 3 s of its own.
    for (let i = 0; i < 20; i++) frameAt((t += 100));
    expect(events).toHaveLength(1);
    for (let i = 0; i < 20; i++) frameAt((t += 100));
    expect(events).toHaveLength(2);
  });

  it("another program key ends the bypass", async () => {
    const { engine } = await heavyOnSlowGpu();
    let t = load(10, 9);
    const edited: Profile = {
      ...heavy(),
      effects: [heavy().effects[1]!, heavy().effects[0]!],
    };
    const switched = engine.setProfile(edited);
    frameAt((t += 100));
    await switched;
    frameAt(t + 100);
    expect(drawsCustom(frames().at(-1)!)).toBe(true);
  });

  it("never fires for a built-in-only profile under the same load", () => {
    const { engine } = started(640, 360, { parallel: false });
    const events: unknown[] = [];
    engine.onGuard((event) => events.push(event));
    frameAt(0);
    load(0, 15);
    expect(engine.stats().renderScale).toBe(0.5);
    expect(events).toEqual([]);
  });
});
