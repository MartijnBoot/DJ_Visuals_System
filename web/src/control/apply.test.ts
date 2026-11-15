// T9 (B-04 spec SD17, AC19, AC20, AC24, AC25, AC26; plan PD5): controls received between frames
// are applied at the start of the next frame, before the engine draws, and acknowledged once per
// frame. A controlled frame clock runs a frame's callbacks in registration order, as the browser
// does (the same clock as `frame-feed.test.ts`).
import type { Control } from "@djv/shared";
import type { AudioFeatures, Dials, Engine } from "@djv/engine";
import { DEFAULT_DIALS, ZERO_FEATURES } from "@djv/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFrameFeed } from "../frame-feed.ts";
import { createApplier, type ApplierDeps } from "./apply.ts";

let queue: { id: number; cb: FrameRequestCallback }[] = [];
let nextId = 1;

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
afterEach(() => vi.unstubAllGlobals());

function rig(started = true) {
  let dials: Dials = { ...DEFAULT_DIALS };
  const drawn: Dials[] = [];
  const events: string[] = [];
  const engine: Pick<Engine, "start" | "setFeatures"> = {
    start() {
      requestAnimationFrame(function frame() {
        requestAnimationFrame(frame);
        events.push("draw");
        drawn.push({ ...dials });
      });
    },
    setFeatures: (_f: AudioFeatures) => {},
  };
  let release: (() => void) | null = null;
  const deps: ApplierDeps = {
    dials: () => dials,
    setDials: vi.fn((next: Dials) => {
      events.push("setDials");
      dials = next;
    }),
    setColour: vi.fn(),
    resetColour: vi.fn(),
    setCamera: vi.fn(),
    pick: vi.fn(() => new Promise<void>((r) => (release = r))),
    refresh: vi.fn(),
    started: () => started,
  };
  const applier = createApplier(deps);
  const acks: unknown[][] = [];
  startFrameFeed(
    engine,
    () => ZERO_FEATURES,
    () => {
      const entries = applier.drain();
      if (entries.length > 0) acks.push(entries);
    },
  );
  return { applier, deps, drawn, events, acks, release: () => release?.() };
}

const dials = (seq: number, d: Partial<Dials>): Control => ({ type: "dials", seq, ...d });

describe("start-of-frame application (AC19, SD17)", () => {
  it("applies a control received between frames in the next frame, before the engine draws", () => {
    const r = rig();
    runFrame(16);
    r.applier.receive("d1", dials(1, { recognisability: 0.9 }));
    expect(r.deps.setDials).not.toHaveBeenCalled(); // never applied on receipt
    runFrame(32);
    expect(r.drawn.at(-1)).toEqual({ ...DEFAULT_DIALS, recognisability: 0.9 });
    expect(r.events.slice(-2)).toEqual(["setDials", "draw"]);
  });

  it("never applies later than that frame", () => {
    const r = rig();
    r.applier.receive("d1", dials(1, { reactivity: 0.1 }));
    runFrame(16);
    runFrame(32);
    expect(r.drawn.map((d) => d.reactivity)).toEqual([0.1, 0.1]);
  });

  it("applies two dials messages of one frame in order, so the last wins, keeping the other dial", () => {
    const r = rig();
    r.applier.receive("d1", dials(1, { recognisability: 0.2 }));
    r.applier.receive("d2", dials(1, { recognisability: 0.8 }));
    r.applier.receive("d1", dials(2, { reactivity: 0.4 }));
    runFrame(16);
    expect(r.drawn.at(-1)).toEqual({ recognisability: 0.8, reactivity: 0.4 });
  });

  it("acknowledges every applied control once, in one batch per frame", () => {
    const r = rig();
    r.applier.receive("d1", dials(1, { recognisability: 0.2 }));
    r.applier.receive("d2", { type: "colour", seq: 5, slot: 0, value: "#ff0000" });
    runFrame(16);
    runFrame(32);
    expect(r.acks).toEqual([
      [
        { deviceId: "d1", seq: 1 },
        { deviceId: "d2", seq: 5 },
      ],
    ]);
  });
});

describe("each control (AC20, AC21, AC24, AC26)", () => {
  it("colour and reset go to the live palette", () => {
    const r = rig();
    r.applier.receive("d1", { type: "colour", seq: 1, slot: 2, value: "#00ff00" });
    r.applier.receive("d1", { type: "resetColour", seq: 2, slot: 1 });
    runFrame(16);
    expect(r.deps.setColour).toHaveBeenCalledWith(2, "#00ff00");
    expect(r.deps.resetColour).toHaveBeenCalledWith(1);
  });

  it("a camera switches after Start and is a no-op before, acknowledged either way", () => {
    const after = rig(true);
    after.applier.receive("d1", { type: "camera", seq: 1, deviceId: "cam-2" });
    runFrame(16);
    expect(after.deps.setCamera).toHaveBeenCalledWith("cam-2");
    expect(after.acks).toEqual([[{ deviceId: "d1", seq: 1 }]]);
    const before = rig(false);
    before.applier.receive("d1", { type: "camera", seq: 1, deviceId: "cam-2" });
    runFrame(16);
    expect(before.deps.setCamera).not.toHaveBeenCalled();
    expect(before.acks).toEqual([[{ deviceId: "d1", seq: 1 }]]);
  });

  it("refresh lists the profiles again; nothing else fetches", () => {
    const r = rig();
    r.applier.receive("d1", dials(1, { recognisability: 0.5 }));
    r.applier.receive("d1", { type: "colour", seq: 2, slot: 0, value: "#000000" });
    runFrame(16);
    expect(r.deps.refresh).not.toHaveBeenCalled();
    r.applier.receive("d1", { type: "refresh", seq: 3 });
    runFrame(32);
    expect(r.deps.refresh).toHaveBeenCalledTimes(1);
  });

  it("a pick is acknowledged in the frame after it resolves (the swap), not before", async () => {
    const r = rig();
    r.applier.receive("d1", { type: "pick", seq: 4, id: "w1" });
    runFrame(16);
    expect(r.deps.pick).toHaveBeenCalledWith("w1");
    expect(r.acks).toEqual([]);
    r.release();
    await Promise.resolve();
    await Promise.resolve();
    runFrame(32);
    expect(r.acks).toEqual([[{ deviceId: "d1", seq: 4 }]]);
  });

  it("acknowledges a pick that fails too: the controller learns from the state", async () => {
    const r = rig();
    vi.mocked(r.deps.pick).mockRejectedValueOnce(new Error("missing"));
    r.applier.receive("d1", { type: "pick", seq: 4, id: "gone" });
    runFrame(16);
    await Promise.resolve();
    await Promise.resolve();
    runFrame(32);
    expect(r.acks).toEqual([[{ deviceId: "d1", seq: 4 }]]);
  });
});
