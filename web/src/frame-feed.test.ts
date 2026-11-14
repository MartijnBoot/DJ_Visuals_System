// B-08 AC4 (plan PD10, T5): the screen reads the audio features in the same frame, before the
// engine draws. A controlled frame clock queues every requestAnimationFrame callback and runs a
// frame's callbacks in registration order, as the browser does. The stand-in engine registers
// its own loop on `start()`, like the real one, and records the features it holds as it draws.
import type { AudioFeatures, Engine } from "@djv/engine";
import { ZERO_FEATURES } from "@djv/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFrameFeed } from "./frame-feed.ts";

let queue: { id: number; cb: FrameRequestCallback }[] = [];
let nextId = 1;

/** Runs every callback queued before this frame, in registration order. */
function runFrame(t: number) {
  const due = queue;
  queue = [];
  for (const { cb } of due) cb(t);
}

beforeEach(() => {
  queue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.push({ id: nextId, cb });
    return nextId++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    queue = queue.filter((q) => q.id !== id);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The newest window, numbered: `capturedAt` carries the window's number. */
const windowNo = (n: number): AudioFeatures => ({ ...ZERO_FEATURES, capturedAt: n });

function standInEngine(events: string[]) {
  let held: AudioFeatures = ZERO_FEATURES;
  const drawn: number[] = [];
  const engine: Pick<Engine, "start" | "setFeatures"> = {
    start() {
      requestAnimationFrame(function frame() {
        requestAnimationFrame(frame);
        events.push(`draw ${held.capturedAt}`);
        drawn.push(held.capturedAt);
      });
    },
    setFeatures(features) {
      held = features;
    },
  };
  return { engine, drawn };
}

describe("startFrameFeed (B-08 AC4)", () => {
  it("reads before the engine draws, and each frame draws the window newest at that frame", () => {
    const events: string[] = [];
    const { engine, drawn } = standInEngine(events);
    let newest = 0;
    startFrameFeed(engine, () => {
      events.push(`read ${newest}`);
      return windowNo(newest);
    });
    for (let n = 1; n <= 5; n++) {
      newest = n; // a new window arrives before frame n
      runFrame(n * 16);
    }
    expect(drawn).toEqual([1, 2, 3, 4, 5]);
    for (let n = 1; n <= 5; n++) {
      expect(events.indexOf(`read ${n}`)).toBeLessThan(events.indexOf(`draw ${n}`));
    }
  });

  it("stops reading after stop, leaving the engine's own loop to the engine", () => {
    const events: string[] = [];
    const { engine, drawn } = standInEngine(events);
    let reads = 0;
    const stop = startFrameFeed(engine, () => windowNo(++reads));
    runFrame(16);
    stop();
    runFrame(32);
    expect(reads).toBe(1);
    expect(drawn).toEqual([1, 1]);
  });
});
