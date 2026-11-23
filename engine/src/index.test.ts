// T4 (spec SD8, SD15; plan PD21) and B-02 T5 (spec SD15, SD17; plan PD4): the engine's frame
// loop with a stand-in WebGL2 context, so the per-frame latency record, the render scale in the
// stats, the scaled targets and the prepared profile swap are checked without a GPU. Every GL
// call is recorded; programs link when the test says so.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_PROFILE,
  createEngine,
  ZERO_FEATURES,
  type Profile,
  type SetProfileOptions,
  type TransitionKind,
} from "./index.ts";
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
  /** The program that puts a finished frame on the canvas (D-14): not a look, not numbered. */
  present?: boolean;
  /** B-09 PD6: the program that mixes two looks onto the canvas; also `present`, not a look. */
  mix?: boolean;
}

interface FakeOptions {
  /** Whether the context offers `KHR_parallel_shader_compile`. */
  parallel?: boolean;
}

function fakeCanvas(width: number, height: number, { parallel = true }: FakeOptions = {}) {
  const calls: Call[] = [];
  const programs: FakeProgram[] = [];
  const control = { failLinks: false, shaderLog: "" };
  const sources = new WeakMap<object, string>();
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
    // Sources are kept beside the shader objects, never on them: a recorded call that takes a
    // shader must not appear to carry its code (B-03 T4's shaderSource check).
    createShader: () => ({}),
    shaderSource: (shader, source) => {
      sources.set(shader as object, source as string);
    },
    // The present program is told apart by its fragment shader and takes no number, so the
    // looks keep theirs: the built-in is 0 and each linked profile the next. The mix program
    // (B-09 PD6), by its own marker, is put on the canvas the same way and is numbered neither.
    attachShader: (program, shader) => {
      const p = program as FakeProgram;
      const source = sources.get(shader as object) ?? "";
      const mix = source.includes("uIncoming");
      if (!(source.includes("uFrame") || mix) || p.present) return;
      p.present = true;
      p.mix = mix;
      p.fails = false;
      programs.splice(programs.indexOf(p), 1);
      p.id = -1;
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
  const listeners = new Map<string, ((event: Event) => void)[]>();
  const canvas = {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    getContext: () => gl,
    addEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  } as unknown as HTMLCanvasElement;
  /** Dispatches a canvas event as Chromium does; says whether its default was prevented. */
  const fire = (type: string): boolean => {
    let prevented = false;
    const event = { type, preventDefault: () => (prevented = true) } as unknown as Event;
    for (const listener of listeners.get(type) ?? []) listener(event);
    return prevented;
  };
  return {
    canvas,
    fire,
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

/** The look's draws in a frame: every `drawArrays` but the present's (D-14). */
const lookDraws = (frame: Call[]) => {
  let present = false;
  let n = 0;
  for (const c of frame) {
    if (c.name === "useProgram") present = (c.args[0] as FakeProgram | null)?.present === true;
    if (c.name === "drawArrays" && !present) n++;
  }
  return n;
};

/** Look programs created so far: every `createProgram` but the present's (D-14). */
const looksLinked = (calls: Call[]) =>
  calls.filter((c) => c.name === "createProgram").length -
  new Set(
    calls
      .filter((c) => c.name === "attachShader" && (c.args[0] as FakeProgram).present)
      .map((c) => c.args[0]),
  ).size;

/** Each render target's framebuffer → the texture attached to it, from every call so far. */
const textureOf = (calls: Call[]) => {
  const map = new Map<unknown, unknown>();
  let bound: unknown = null;
  for (const c of calls) {
    if (c.name === "bindFramebuffer" && c.args[0] === "FRAMEBUFFER") bound = c.args[1];
    if (c.name === "framebufferTexture2D") map.set(bound, c.args[3]);
  }
  return map;
};

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

  it("renders at canvas size × scale and draws it up to the full canvas, linear-filtered", () => {
    const { engine, calls } = started(640, 360);
    engine.setScaleCap(0.75);
    frameAt(0);
    const frame = frames().at(-1)!;
    const viewports = frame.filter((c) => c.name === "viewport").map((c) => c.args);
    expect(viewports).toEqual([
      [0, 0, 480, 270], // the look, into the scaled target
      [0, 0, 640, 360], // the present, onto the canvas
    ]);
    // The targets sample with LINEAR filtering, so the present scales up as the blit did.
    expect(calls).toContainEqual({
      name: "texParameteri",
      args: ["TEXTURE_2D", "TEXTURE_MAG_FILTER", "LINEAR"],
    });
  });

  // D-14: Chromium can run a blit into the canvas with its read binding on the canvas too
  // (`glBlitFramebuffer: Blit feedback loop`); the blit is rejected and the frame shows black.
  // The frame reaches the canvas by a draw that samples the target's texture instead.
  it("puts the frame on the canvas with a draw from the target just drawn, never a blit (D-14)", () => {
    const { calls } = started(640, 360);
    frameAt(0);
    frameAt(16);
    for (const frame of frames()) {
      expect(frame.filter((c) => c.name === "blitFramebuffer")).toEqual([]);
      const look = frame.findIndex((c) => c.name === "drawArrays");
      const lookTarget = frame
        .slice(0, look)
        .filter((c) => c.name === "bindFramebuffer" && c.args[0] === "FRAMEBUFFER")
        .at(-1)!.args[1];
      const after = frame.slice(look + 1);
      const presentAt = after.findIndex((c) => c.name === "drawArrays");
      expect(presentAt).toBeGreaterThan(-1);
      const setup = after.slice(0, presentAt);
      const program = setup.filter((c) => c.name === "useProgram").at(-1)!.args[0] as FakeProgram;
      expect(program.present).toBe(true);
      expect(setup.filter((c) => c.name === "bindFramebuffer").at(-1)!.args).toEqual([
        "FRAMEBUFFER",
        null,
      ]);
      expect(setup.filter((c) => c.name === "viewport").at(-1)!.args).toEqual([0, 0, 640, 360]);
      const texture = setup.filter((c) => c.name === "bindTexture").at(-1)!.args[1];
      expect(texture).toBe(textureOf(calls).get(lookTarget));
      expect(lookDraws(frame)).toBe(1);
    }
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
    expect(looksLinked(calls)).toBe(1);
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
      expect(lookDraws(frame)).toBe(1);
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
    expect(looksLinked(calls)).toBe(1);
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
    expect(looksLinked(calls)).toBe(2);
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
    expect(looksLinked(calls)).toBe(2);
    expect(uniform(frames().at(-1)!, "uCustomParam")).toEqual(expect.arrayContaining([0.9]));
    const other = engine.setProfile(coded("return source(uv);"));
    fake.completeLinks();
    frameAt(48);
    await other;
    expect(looksLinked(calls)).toBe(3);
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
  /** Copies between targets: since D-14 the frame reaches the canvas by a draw, not a blit. */
  const blits = (frame: Call[]) => frame.filter((c) => c.name === "blitFramebuffer").length;

  it("copies the last output into both recreated targets, only in a custom profile", async () => {
    const builtIn = started();
    frameAt(0);
    frameAt(16);
    builtIn.engine.setScaleCap(0.75);
    frameAt(32);
    expect(frames().map(blits)).toEqual([0, 0, 0]);

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
    expect(frames().map(blits)).toEqual([0, 1, 0, 2, 0]);
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
    expect(frames().map(blits)).toEqual([0, 0]);
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

// B-03 T8 (spec AC12, SD8; plan PD8): a lost WebGL context is restored and the active profile
// drawn again, without its custom effects when it holds any.
describe("context loss (B-03)", () => {
  const coded: Profile = {
    ...BUILT_IN_PROFILE,
    name: "Coded",
    effects: [
      { type: "zoom", amount: 0.2 },
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
  const draws = lookDraws;
  const created = (frame: Call[], name: string) => frame.filter((c) => c.name === name).length;

  async function playing(profile: Profile) {
    const rig = started(640, 360, { parallel: false });
    const events: unknown[] = [];
    rig.engine.onGuard((event) => events.push(event));
    frameAt(0);
    if (profile !== BUILT_IN_PROFILE) {
      const switched = rig.engine.setProfile(profile);
      frameAt(16);
      await switched;
    }
    return { ...rig, events };
  }

  it("prevents the default, draws nothing while lost, and draws again after the restore", async () => {
    const { fake } = await playing(BUILT_IN_PROFILE);
    expect(fake.fire("webglcontextlost")).toBe(true);
    frameAt(100);
    frameAt(116);
    expect(frames().slice(-2).map(draws)).toEqual([0, 0]);
    fake.fire("webglcontextrestored");
    frameAt(132);
    const first = log.slice(log.findIndex((c) => c.name === "@frame" && c.args[0] === 116));
    expect(created(first, "createProgram")).toBeGreaterThan(0);
    expect(created(first, "createFramebuffer")).toBe(2);
    expect(draws(frames().at(-1)!)).toBe(1);
  });

  it("brings a custom profile back without its custom effects and says so", async () => {
    const { fake, events } = await playing(coded);
    expect(uniform(frames().at(-1)!, "uCustomStrength")).toBeDefined();
    fake.fire("webglcontextlost");
    frameAt(100);
    fake.fire("webglcontextrestored");
    frameAt(116);
    const after = frames().at(-1)!;
    expect(draws(after)).toBe(1);
    expect(uniform(after, "uCustomStrength")).toBeUndefined();
    expect(uniform(after, "uZoom")).toBeGreaterThan(1); // the built-in effects still draw
    expect(events).toEqual([{ kind: "contextLost", customBypassed: true }]);
  });

  it("says nothing was bypassed for a built-in-only profile", async () => {
    const { fake, events } = await playing(BUILT_IN_PROFILE);
    fake.fire("webglcontextlost");
    fake.fire("webglcontextrestored");
    frameAt(100);
    expect(events).toEqual([{ kind: "contextLost", customBypassed: false }]);
  });

  it("keeps the bypass for a same-key call after the restore, and a pick retries", async () => {
    const { engine, fake } = await playing(coded);
    fake.fire("webglcontextlost");
    fake.fire("webglcontextrestored");
    frameAt(100);
    await engine.setProfile({ ...coded, palette: ["#111111", "#ffffff"] });
    frameAt(116);
    expect(uniform(frames().at(-1)!, "uCustomStrength")).toBeUndefined();
    const retried = engine.setProfile(coded, { pick: true });
    frameAt(132);
    await retried;
    frameAt(148);
    expect(uniform(frames().at(-1)!, "uCustomStrength")).toBeDefined();
  });

  it("rejects a switch that was linking when the context went, and links anew after", async () => {
    const { engine, fake } = await playing(BUILT_IN_PROFILE);
    const linking = engine.setProfile(coded);
    fake.fire("webglcontextlost");
    await expect(linking).rejects.toThrow(/lost/);
    fake.fire("webglcontextrestored");
    frameAt(100);
    const again = engine.setProfile(coded);
    frameAt(116);
    await again;
    frameAt(132);
    expect(uniform(frames().at(-1)!, "uCustomStrength")).toBeDefined();
  });

  it("takes a profile handed over while lost, and restores that one", async () => {
    const { engine, fake, events } = await playing(BUILT_IN_PROFILE);
    fake.fire("webglcontextlost");
    await engine.setProfile(coded);
    fake.fire("webglcontextrestored");
    frameAt(100);
    expect(uniform(frames().at(-1)!, "uZoom")).toBeGreaterThan(1);
    expect(events).toEqual([{ kind: "contextLost", customBypassed: true }]);
  });
});

// B-09 T3 (spec SD2, SD3, SD11, SD13, SD15 to SD18, AC1, AC7 to AC16, AC18, AC20; plan PD4 to
// PD7, PD11 to PD13, PD18): during a transition the engine draws two looks, each into its own
// pair of targets, then mixes them onto the canvas; outside one it draws one look as before.
describe("transitions: two looks and the Crossfade (B-09)", () => {
  /** One draw in a frame: its program, the uniforms set since that program was used, its target. */
  interface Draw {
    program: FakeProgram;
    uniforms: Map<string, unknown>;
    /** The framebuffer drawn into; null for the canvas. */
    target: unknown;
    /** The texture bound to each unit at the draw. */
    units: Map<unknown, unknown>;
  }
  const drawsOf = (frame: Call[]): Draw[] => {
    const out: Draw[] = [];
    let program: FakeProgram | null = null;
    let uniforms = new Map<string, unknown>();
    let target: unknown = null;
    let unit: unknown = "TEXTURE0";
    const units = new Map<unknown, unknown>();
    for (const c of frame) {
      if (c.name === "useProgram") {
        program = c.args[0] as FakeProgram;
        uniforms = new Map();
      }
      if (c.name === "bindFramebuffer" && c.args[0] === "FRAMEBUFFER") target = c.args[1];
      if (c.name === "activeTexture") unit = c.args[0];
      if (c.name === "bindTexture") units.set(unit, c.args[1]);
      if (c.name.startsWith("uniform")) {
        uniforms.set((c.args[0] as { name: string }).name, c.args[1]);
      }
      if (c.name === "drawArrays")
        out.push({ program: program!, uniforms, target, units: new Map(units) });
    }
    return out;
  };
  const looksOf = (frame: Call[]) => drawsOf(frame).filter((d) => !d.program.present);
  const mixesOf = (frame: Call[]) => drawsOf(frame).filter((d) => d.program.mix === true);
  const presentsOf = (frame: Call[]) =>
    drawsOf(frame).filter((d) => d.program.present && !d.program.mix);
  const lookIds = (frame: Call[]) => looksOf(frame).map((d) => d.program.id);
  const progressOf = (frame: Call[]) => mixesOf(frame)[0]?.uniforms.get("uProgress");
  const deleted = (frame: Call[]) =>
    frame.filter((c) => c.name === "deleteFramebuffer").map((c) => c.args[0]);

  const zoomOnly: Profile = {
    ...BUILT_IN_PROFILE,
    name: "Zoom",
    effects: [{ type: "zoom", amount: 1 }],
  };
  const smearOnly: Profile = {
    ...BUILT_IN_PROFILE,
    name: "Smear",
    effects: [{ type: "smear", amount: 1 }],
  };
  const coded = (n = 0): Profile => ({
    ...BUILT_IN_PROFILE,
    name: `Coded ${n}`,
    effects: [
      { type: "smear", amount: 1 },
      {
        type: "custom",
        label: "Pass",
        amount: 1,
        abstraction: false,
        params: [],
        code: `return source(uv); // ${n}`,
      },
    ],
  });
  const fade = (durationMs = 2000, kind: TransitionKind = "crossfade"): SetProfileOptions => ({
    pick: true,
    transition: { kind, durationMs, dipColour: "#000000", seed: 0.25 },
  });

  /** The built-in on screen at 0, then a pick of `to` with `options`, starting at `t`. */
  async function fading(to: Profile, options = fade(), t = 16, size: FakeOptions = {}) {
    const rig = started(640, 360, size);
    frameAt(0);
    const switched = rig.engine.setProfile(to, options);
    rig.fake.completeLinks();
    frameAt(t);
    await switched;
    return rig;
  }

  it("draws the outgoing look, the incoming look, then one mix, in every transition frame (AC13, PD18)", async () => {
    await fading(zoomOnly, fade(100));
    frameAt(50);
    frameAt(116);
    frameAt(132);
    frameAt(148);
    const all = frames();
    expect(all.map(lookIds)).toEqual([[0], [0, 1], [0, 1], [0, 1], [1], [1]]);
    expect(all.map((f) => mixesOf(f).length)).toEqual([0, 1, 1, 1, 0, 0]);
    expect(all.map((f) => presentsOf(f).length)).toEqual([1, 0, 0, 0, 1, 1]);
    expect(all.map((f) => drawsOf(f).length)).toEqual([2, 3, 3, 3, 2, 2]);
  });

  it("mixes the two looks' targets just drawn by elapsed frame time, 0 first and 1 at the end (AC1, PD7)", async () => {
    const { calls } = await fading(zoomOnly, fade(100));
    frameAt(50);
    frameAt(116);
    const all = frames();
    expect(all.slice(1).map(progressOf)).toEqual([0, 0.34, 1]);
    const textures = textureOf(calls);
    for (const frame of all.slice(1)) {
      const [outgoing, incoming] = looksOf(frame);
      const [mix] = mixesOf(frame);
      expect(mix!.target).toBeNull(); // onto the canvas
      expect(mix!.units.get("TEXTURE0")).toBe(textures.get(outgoing!.target));
      expect(mix!.units.get("TEXTURE1")).toBe(textures.get(incoming!.target));
      expect(mix!.uniforms.get("uOutgoing")).toBe(0);
      expect(mix!.uniforms.get("uIncoming")).toBe(1);
      expect(mix!.uniforms.get("uCanvas")).toBe(640);
    }
  });

  it("deletes the outgoing look's targets on the frame after progress reaches 1, and nothing else (AC1)", async () => {
    await fading(zoomOnly, fade(100));
    frameAt(116);
    frameAt(132);
    frameAt(148);
    const all = frames();
    const outgoingTargets = new Set(all.slice(1, 3).map((f) => looksOf(f)[0]!.target));
    expect(outgoingTargets.size).toBe(2);
    expect(all.map((f) => deleted(f).length)).toEqual([0, 0, 0, 2, 0]);
    expect(new Set(deleted(all[3]!))).toEqual(outgoingTargets);
  });

  it("ends within one frame interval of its duration at 10 frames a second (AC15)", async () => {
    await fading(zoomOnly, fade(500), 100);
    for (const t of [190, 310, 420, 530, 640, 750]) frameAt(t);
    const all = frames();
    const stamps = [0, 100, 190, 310, 420, 530, 640, 750];
    const last = all.findLastIndex((f) => mixesOf(f).length > 0);
    expect(progressOf(all[last]!)).toBe(1);
    expect(stamps[last]! - 100).toBeGreaterThanOrEqual(500);
    expect(stamps[last]! - 100).toBeLessThan(500 + 120); // one frame interval at 10 fps
    expect(progressOf(all[last - 1]!)).toBeLessThan(1);
    expect(lookIds(all[last + 1]!)).toEqual([1]);
  });

  it("freezes the outgoing look's dials and palette; a dial or colour change reaches the incoming only (AC7)", async () => {
    const red: Profile = { ...smearOnly, palette: ["#ff0000", "#ffffff"] };
    const rig = started();
    rig.engine.setDials({ recognisability: 1, reactivity: 0 });
    frameAt(0);
    const switched = rig.engine.setProfile(red, fade());
    rig.fake.completeLinks();
    frameAt(16);
    await switched;
    frameAt(32);
    rig.engine.setDials({ recognisability: 0.5, reactivity: 0 });
    await rig.engine.setProfile({ ...red, palette: ["#00ff00", "#ffffff"] }); // a live colour
    frameAt(48);
    const [outBefore, inBefore] = looksOf(frames()[2]!);
    const [outAfter, inAfter] = looksOf(frames()[3]!);
    expect(outBefore!.uniforms.get("uFeedback")).toBeCloseTo(0.85, 9);
    expect(outAfter!.uniforms.get("uFeedback")).toBe(outBefore!.uniforms.get("uFeedback"));
    expect(outAfter!.uniforms.get("uPalette")).toEqual(outBefore!.uniforms.get("uPalette"));
    expect(inBefore!.uniforms.get("uFeedback")).toBeCloseTo(0.85 * 0.3, 9); // its own dials (PD5)
    expect(inAfter!.uniforms.get("uFeedback")).toBeCloseTo(0.85 * 0.5, 9);
    expect((inBefore!.uniforms.get("uPalette") as number[]).slice(0, 3)).toEqual([1, 0, 0]);
    expect((inAfter!.uniforms.get("uPalette") as number[]).slice(0, 3)).toEqual([0, 1, 0]);
  });

  it("starts a picked look at its profile's dials, not the engine's, from its first frame (PD5)", async () => {
    const rig = started();
    rig.engine.setDials({ recognisability: 1, reactivity: 0 });
    frameAt(0);
    const half: Profile = { ...smearOnly, dials: { recognisability: 0.5, reactivity: 0 } };
    const switched = rig.engine.setProfile(half, { pick: true }); // a Cut
    rig.fake.completeLinks();
    frameAt(16);
    await switched;
    frameAt(32);
    expect(uniform(frames()[1]!, "uFeedback")).toBe(0); // the swap frame mixes no smear
    expect(uniform(frames()[2]!, "uFeedback")).toBeCloseTo(0.85 * 0.5, 9);
  });

  it("gives each look its own history; the incoming's first frame reads the frame on screen, no smear (AC8)", async () => {
    const rig = started();
    frameAt(0);
    frameAt(16);
    const switched = rig.engine.setProfile(coded(), fade());
    rig.fake.completeLinks();
    frameAt(32);
    await switched;
    frameAt(48);
    frameAt(64);
    const all = frames();
    const textures = textureOf(rig.calls);
    const onScreen = looksOf(all[1]!)[0]!.target; // the built-in's latest output
    const start = all[2]!;
    const [, incoming] = looksOf(start);
    // The incoming pair's previous target is seeded from the frame on screen, then copied into
    // the target it draws (B-03 PD4); it mixes no smear on that frame.
    const blits: { read: unknown; draw: unknown }[] = [];
    let read: unknown = null;
    let draw: unknown = null;
    for (const c of start) {
      if (c.name === "bindFramebuffer" && c.args[0] === "READ_FRAMEBUFFER") read = c.args[1];
      if (c.name === "bindFramebuffer" && c.args[0] === "DRAW_FRAMEBUFFER") draw = c.args[1];
      if (c.name === "blitFramebuffer") blits.push({ read, draw });
    }
    expect(blits[0]!.read).toBe(onScreen);
    expect(textures.get(blits[0]!.draw)).toBe(incoming!.units.get("TEXTURE1"));
    expect(incoming!.uniforms.get("uFeedback")).toBe(0);
    for (const i of [3, 4]) {
      const [outgoing, next] = looksOf(all[i]!);
      const [outgoingBefore, nextBefore] = looksOf(all[i - 1]!);
      expect(outgoing!.units.get("TEXTURE1")).toBe(textures.get(outgoingBefore!.target));
      expect(next!.units.get("TEXTURE1")).toBe(textures.get(nextBefore!.target));
      expect(next!.uniforms.get("uFeedback")).toBeGreaterThan(0);
    }
    const pairs = [3, 4].flatMap((i) => looksOf(all[i]!).map((d) => d.target));
    expect(new Set(pairs).size).toBe(4); // two looks, two targets each, none shared
  });

  it("jumps when a newer pick is ready mid-transition and never draws three looks (AC9, SD2)", async () => {
    const { engine, fake } = await fading(zoomOnly);
    frameAt(32);
    const third = engine.setProfile(smearOnly, fade());
    fake.completeLinks();
    frameAt(48);
    await third;
    frameAt(64);
    const all = frames();
    expect(all.map(lookIds)).toEqual([[0], [0, 1], [0, 1], [1, 2], [1, 2]]);
    expect(all.map((f) => mixesOf(f).length)).toEqual([0, 1, 1, 1, 1]);
    expect(progressOf(all[3]!)).toBe(0); // the new transition starts in that frame
    const firstOutgoing = new Set([looksOf(all[1]!)[0]!.target, looksOf(all[2]!)[0]!.target]);
    expect(new Set(deleted(all[3]!))).toEqual(firstOutgoing); // the built-in's pair
    for (const frame of all) expect(looksOf(frame).length).toBeLessThanOrEqual(2);
  });

  it("ends a running transition and cuts when a Cut is picked mid-transition (SD2)", async () => {
    for (const cut of [{ pick: true }, fade(2000, "cut")]) {
      const { engine, fake } = await fading(zoomOnly);
      frameAt(32);
      const switched = engine.setProfile(smearOnly, cut);
      fake.completeLinks();
      frameAt(48);
      await switched;
      frameAt(64);
      const all = frames();
      expect(all.map(lookIds)).toEqual([[0], [0, 1], [0, 1], [2], [2]]);
      expect(all.map((f) => mixesOf(f).length)).toEqual([0, 1, 1, 0, 0]);
      expect(deleted(all[3]!)).toHaveLength(2);
    }
  });

  it("keeps a running transition going when a newer pick does not link (AC10)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { engine, fake } = await fading(zoomOnly);
    frameAt(32);
    fake.control.failLinks = true;
    const failing = engine.setProfile(smearOnly, fade());
    fake.completeLinks();
    frameAt(48);
    await expect(failing).rejects.toThrow(/link/);
    frameAt(516);
    const all = frames();
    expect(all.slice(1).map(lookIds)).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    expect(progressOf(all.at(-1)!)).toBe(0.25);
  });

  it("draws the incoming profile alone after a context loss mid-transition (AC11)", async () => {
    const { fake } = await fading(zoomOnly);
    frameAt(32);
    fake.fire("webglcontextlost");
    frameAt(48);
    fake.fire("webglcontextrestored");
    frameAt(64);
    frameAt(80);
    for (const frame of frames().slice(-2)) {
      expect(looksOf(frame)).toHaveLength(1);
      expect(mixesOf(frame)).toHaveLength(0);
      expect(presentsOf(frame)).toHaveLength(1);
      expect(looksOf(frame)[0]!.uniforms.get("uZoom")).toBeCloseTo(1.12, 9); // zoomOnly's
    }
  });

  it("never lets the guard bypass a custom look during a transition, and counts every frame (AC12)", async () => {
    const rig = started(640, 360, { parallel: false });
    const events: unknown[] = [];
    rig.engine.onGuard((event) => events.push(event));
    let t = 0;
    for (let i = 0; i < 60; i++) frameAt((t += 1000 / 60));
    for (let i = 0; i < 90; i++) frameAt((t += 100)); // the built-in under load: scale at 50%
    expect(rig.engine.stats().renderScale).toBe(0.5);
    const switched = rig.engine.setProfile(coded(), fade(8000));
    frameAt((t += 100));
    await switched;
    for (let i = 0; i < 80; i++) frameAt((t += 100)); // through the 8 s, and the end frame
    expect(events).toEqual([]);
    expect(rig.engine.stats().fps).toBe(10);
    expect(looksOf(frames().at(-2)!)[1]!.uniforms.get("uCustomStrength")).toBeDefined();
    // Once the transition is over, the guard acts as before: the load was real.
    for (let i = 0; i < 10; i++) frameAt((t += 100));
    expect(events).toEqual([{ kind: "slow", customBypassed: true }]);
  });

  it("keeps a running transition's kind and duration when other options come later (AC16)", async () => {
    const { engine } = await fading(zoomOnly, fade(2000));
    // A live colour on the incoming look, carrying other transition options: not a pick.
    const later = { transition: fade(100).transition! };
    await engine.setProfile({ ...zoomOnly, palette: ["#111111", "#ffffff"] }, later);
    frameAt(516);
    expect(progressOf(frames().at(-1)!)).toBe(0.25);
  });

  it("resolves the pick in the frame that first draws the incoming look (AC18)", async () => {
    const { engine, fake } = started();
    frameAt(0);
    let done = false;
    const switched = engine.setProfile(zoomOnly, fade()).then(() => (done = true));
    frameAt(16);
    await flush();
    expect(done).toBe(false);
    fake.completeLinks();
    frameAt(32);
    await switched;
    expect(lookIds(frames().at(-1)!)).toEqual([0, 1]);
  });

  it("transitions on a re-pick of the active profile with Crossfade, not with Cut (AC20, PD12)", async () => {
    const stored: Profile = { ...BUILT_IN_PROFILE, palette: ["#0000ff", "#ffffff"] };
    const live: Profile = { ...BUILT_IN_PROFILE, palette: ["#ff0000", "#ffffff"] };
    const rig = started();
    frameAt(0);
    await rig.engine.setProfile(live); // a live colour on the built-in
    frameAt(16);
    const again = rig.engine.setProfile(stored, fade());
    frameAt(32);
    await again;
    frameAt(48);
    const [outgoing, incoming] = looksOf(frames()[3]!);
    expect(lookIds(frames()[3]!)).toEqual([0, 0]);
    expect(mixesOf(frames()[3]!)).toHaveLength(1);
    expect(outgoing!.target).not.toBe(incoming!.target);
    expect((outgoing!.uniforms.get("uPalette") as number[]).slice(0, 3)).toEqual([1, 0, 0]);
    expect((incoming!.uniforms.get("uPalette") as number[]).slice(0, 3)).toEqual([0, 0, 1]);

    const cut = started();
    frameAt(0);
    await cut.engine.setProfile(stored, { pick: true });
    frameAt(16);
    expect(lookIds(frames().at(-1)!)).toEqual([0]);
    expect(mixesOf(frames().at(-1)!)).toHaveLength(0);
  });

  it("keeps the outgoing look's program when a ninth program is linked (PD13)", async () => {
    const rig = started(640, 360, { parallel: false });
    frameAt(0);
    let t = 0;
    for (let n = 1; n <= 7; n++) {
      const cut = rig.engine.setProfile(coded(n), { pick: true });
      frameAt((t += 16));
      await cut;
    }
    const outgoingProgram = rig.fake.programs.at(-1);
    const switched = rig.engine.setProfile(coded(8), fade());
    frameAt((t += 16));
    await switched;
    frameAt(t + 16);
    const removed = rig.calls.filter((c) => c.name === "deleteProgram").map((c) => c.args[0]);
    expect(removed).toHaveLength(1); // the oldest, the first coded program
    expect(removed).not.toContain(outgoingProgram);
    expect(lookIds(frames().at(-1)!)).toEqual([7, 8]);
  });
});
