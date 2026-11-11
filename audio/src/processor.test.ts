// T2 (spec AC6, SD4): the worklet processor, with the AudioWorkletGlobalScope names stubbed, so
// the registration and the message per window are checked without a browser.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { windowFrames } from "./analysis.ts";

interface Processor {
  port: { postMessage: (data: unknown) => void };
  process(inputs: Float32Array[][]): boolean;
}

const SAMPLE_RATE = 48_000;
let registered: { name: string; ctor: new () => Processor } | null = null;

beforeAll(async () => {
  vi.stubGlobal("sampleRate", SAMPLE_RATE);
  vi.stubGlobal("currentTime", 0);
  vi.stubGlobal(
    "AudioWorkletProcessor",
    class {
      port = { postMessage: (_data: unknown) => {} };
    },
  );
  vi.stubGlobal("registerProcessor", (name: string, ctor: new () => Processor) => {
    registered = { name, ctor };
  });
  await import("./processor.ts");
});
afterEach(() => vi.stubGlobal("currentTime", 0));

function run(processor: Processor, inputs: () => Float32Array[][], quanta: number) {
  const posts: unknown[] = [];
  processor.port.postMessage = (data) => posts.push(data);
  const results: boolean[] = [];
  for (let q = 0; q < quanta; q++) {
    vi.stubGlobal("currentTime", (q * 128) / SAMPLE_RATE);
    results.push(processor.process(inputs()));
  }
  return { posts, results };
}

describe("djv-features processor", () => {
  it("registers under the name the source creates", () => {
    expect(registered?.name).toBe("djv-features");
  });

  it("posts one frame per window with the window's end in context seconds", () => {
    const processor = new registered!.ctor();
    const quantaPerWindow = windowFrames(SAMPLE_RATE) / 128;
    const tone = () => [[Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 3))]];
    const { posts, results } = run(processor, tone, quantaPerWindow * 4);
    expect(results.every((r) => r === true)).toBe(true);
    expect(posts).toHaveLength(4);
    const first = posts[0] as { frame: Record<string, unknown>; contextTime: number };
    expect(first.contextTime).toBeCloseTo(windowFrames(SAMPLE_RATE) / SAMPLE_RATE, 9);
    for (const key of ["level", "low", "mid", "high", "beat"]) {
      expect(typeof first.frame[key]).toBe("number");
    }
    expect((first.frame.level as number) > 0).toBe(true);
  });

  it("averages two channels: opposite channels cancel to silence", () => {
    const processor = new registered!.ctor();
    const left = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 3));
    const right = left.map((v) => -v);
    const { posts } = run(processor, () => [[left, right]], 12);
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts as { frame: { level: number } }[]) expect(post.frame.level).toBe(0);
  });

  it("tolerates an empty input and keeps running", () => {
    const processor = new registered!.ctor();
    const { posts, results } = run(processor, () => [[]], 6);
    expect(results.every((r) => r === true)).toBe(true);
    expect(posts).toEqual([]);
    expect(processor.process([])).toBe(true);
  });
});
