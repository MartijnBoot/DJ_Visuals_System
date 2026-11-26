// T9 (B-04 spec SD17, AC19, AC20, AC24, AC25, AC26; plan PD5): controls received between frames
// are applied at the start of the next frame, before the engine draws, and acknowledged once per
// frame. A controlled frame clock runs a frame's callbacks in registration order, as the browser
// does (the same clock as `frame-feed.test.ts`).
import type { Control, Staged } from "@djv/shared";
import type { AudioFeatures, Dials, Engine } from "@djv/engine";
import { DEFAULT_DIALS, ZERO_FEATURES } from "@djv/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFrameFeed } from "../frame-feed.ts";
import type { StagedLook } from "../scenes/staged.ts";
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

const LIVE = {
  name: "Warm",
  palette: ["#000000", "#ffffff"],
  dials: { recognisability: 0.9, reactivity: 0.2 },
  effects: [{ type: "zoom" as const, amount: 0.5 }],
};

/** B-07: a staged look whose every method is a spy; `exists` says whether one is staged. */
function fakeStaged(exists: { current: boolean }) {
  const look = { id: "w1" } as Staged;
  return {
    fromLive: vi.fn(() => void (exists.current = true)),
    pick: vi.fn(async () => {}),
    setDials: vi.fn(),
    setColour: vi.fn(),
    resetColour: vi.fn(),
    setStrength: vi.fn(),
    setFeed: vi.fn(),
    setTransition: vi.fn(),
    clear: vi.fn(() => void (exists.current = false)),
    state: () => (exists.current ? look : null),
    definition: vi.fn(() => null),
  } satisfies StagedLook;
}

function rig(started = true, staging = false) {
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
    setMainAudio: vi.fn(),
    setTransition: vi.fn(() => void events.push("setTransition")),
    setStrength: vi.fn(() => void events.push("setStrength")),
    pick: vi.fn(() => new Promise<void>((r) => (release = r))),
    refresh: vi.fn(),
    started: () => started,
    staged: fakeStaged({ current: staging }),
    snapshot: () => ({
      id: "w1",
      name: "Warm",
      stored: LIVE,
      palette: ["#111111", "#222222"],
      amounts: [0.7],
    }),
    feedOnScreen: () => ({ kind: "local", deviceId: "cam-1", label: "Front" }),
    feedOf: (deviceId) =>
      deviceId === "cam-2"
        ? { kind: "local", deviceId: "cam-2", label: "Side" }
        : deviceId === "remote:d9"
          ? { kind: "remote", hint: "Chrome on Android" }
          : null,
    transition: () => ({ kind: "wipe", duration: 3, keepColour: true }),
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

describe("B-06 controls (T13, SD8, SD22, AC14, AC20)", () => {
  it("mainAudio goes to the main-audio choice and is acknowledged", () => {
    const r = rig();
    r.applier.receive("d1", { type: "mainAudio", seq: 4, source: "local" });
    runFrame(16);
    expect(r.deps.setMainAudio).toHaveBeenCalledWith("local");
    expect(r.acks).toEqual([[{ deviceId: "d1", seq: 4 }]]);
  });

  it("a remote: camera goes to the camera choice like a local one, after Start only", () => {
    const before = rig(false);
    before.applier.receive("d1", { type: "camera", seq: 1, deviceId: "remote:d9" });
    runFrame(16);
    expect(before.deps.setCamera).not.toHaveBeenCalled();
    const after = rig();
    after.applier.receive("d1", { type: "camera", seq: 2, deviceId: "remote:d9" });
    runFrame(32);
    expect(after.deps.setCamera).toHaveBeenCalledWith("remote:d9");
  });
});

describe("the effect control (B-18 SD7, AC11, AC12; plan PD6)", () => {
  it("reaches the strength in the next frame, before the engine draws, acknowledged in that batch", () => {
    const r = rig();
    runFrame(16);
    r.applier.receive("d1", { type: "effect", seq: 7, profile: "w1", index: 2, value: 0.8 });
    r.applier.receive("d2", { type: "effect", seq: 3, profile: "w1", index: 0, value: 0 });
    expect(r.deps.setStrength).not.toHaveBeenCalled(); // never applied on receipt
    runFrame(32);
    expect(r.deps.setStrength).toHaveBeenNthCalledWith(1, "w1", 2, 0.8);
    expect(r.deps.setStrength).toHaveBeenNthCalledWith(2, "w1", 0, 0);
    expect(r.events.slice(-3)).toEqual(["setStrength", "setStrength", "draw"]);
    expect(r.acks).toEqual([
      [
        { deviceId: "d1", seq: 7 },
        { deviceId: "d2", seq: 3 },
      ],
    ]);
  });

  it("is acknowledged when the screen drops it too (a stale profile or index)", () => {
    const r = rig();
    // The dependency decides to drop: it changes nothing, yet the controller hears back.
    vi.mocked(r.deps.setStrength).mockImplementation(() => {});
    r.applier.receive("d1", { type: "effect", seq: 9, profile: "gone", index: 11, value: 1 });
    runFrame(16);
    expect(r.deps.setStrength).toHaveBeenCalledWith("gone", 11, 1);
    expect(r.acks).toEqual([[{ deviceId: "d1", seq: 9 }]]);
  });
});

// B-07 T5 (SD3, SD4, AC1-AC4, AC7, AC8; plan PD1, PD7): a control's target decides which look it
// edits; Stage and Unstage make and discard the staged look.
type FakeStaged = ReturnType<typeof fakeStaged>;
const stagedOf = (deps: ApplierDeps) => deps.staged as FakeStaged;
const stagedSpies = (s: FakeStaged) => [
  s.setDials,
  s.setColour,
  s.resetColour,
  s.setFeed,
  s.setTransition,
  s.setStrength,
  s.pick,
];
const liveCalls = (deps: ApplierDeps) =>
  [
    deps.setDials,
    deps.setColour,
    deps.resetColour,
    deps.setCamera,
    deps.setTransition,
    deps.setStrength,
    deps.pick,
  ].map((fn) => vi.mocked(fn).mock.calls.length);
const seqs = (acks: unknown[][]) =>
  acks
    .flat()
    .map((a) => (a as { seq: number }).seq)
    .sort((a, b) => a - b);

describe("routing by target (B-07 AC2, AC3, AC4)", () => {
  const seven = (target?: "live" | "staged"): Control[] => {
    const t = target === undefined ? {} : { target };
    return [
      { type: "dials", seq: 1, reactivity: 0.3, ...t },
      { type: "colour", seq: 2, slot: 0, value: "#00ff00", ...t },
      { type: "resetColour", seq: 3, slot: 1, ...t },
      { type: "camera", seq: 4, deviceId: "cam-2", ...t },
      { type: "transition", seq: 5, kind: "dip", duration: 4, keepColour: true, ...t },
      { type: "effect", seq: 6, profile: "w1", index: 0, value: 0.2, ...t },
      { type: "pick", seq: 7, id: "c1", ...t },
    ];
  };

  it("each of the seven with target staged reaches the staged look, never the live side (AC2)", async () => {
    const r = rig(true, true);
    for (const control of seven("staged")) r.applier.receive("d1", control);
    runFrame(16);
    await Promise.resolve();
    await Promise.resolve();
    const s = stagedOf(r.deps);
    expect(s.setDials).toHaveBeenCalledWith({ reactivity: 0.3 });
    expect(s.setColour).toHaveBeenCalledWith(0, "#00ff00");
    expect(s.resetColour).toHaveBeenCalledWith(1);
    expect(s.setFeed).toHaveBeenCalledWith({ kind: "local", deviceId: "cam-2", label: "Side" });
    expect(s.setTransition).toHaveBeenCalledWith({ kind: "dip", duration: 4 }); // no Keep colour
    expect(s.setStrength).toHaveBeenCalledWith("w1", 0, 0.2);
    expect(s.pick).toHaveBeenCalledWith("c1");
    expect(liveCalls(r.deps)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    runFrame(32);
    // Six in their frame, the pick at its settle (PD7).
    expect(r.acks[0]).toHaveLength(6);
    expect(seqs(r.acks)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("a staged camera names a sender by its hint, and an unknown id changes nothing (PD7)", () => {
    const r = rig(false, true); // before Start: a staged camera opens nothing, so it still lands
    r.applier.receive("d1", { type: "camera", seq: 1, deviceId: "remote:d9", target: "staged" });
    r.applier.receive("d1", { type: "camera", seq: 2, deviceId: "nope", target: "staged" });
    runFrame(16);
    const s = stagedOf(r.deps);
    expect(s.setFeed).toHaveBeenCalledTimes(1);
    expect(s.setFeed).toHaveBeenCalledWith({ kind: "remote", hint: "Chrome on Android" });
    expect(r.deps.setCamera).not.toHaveBeenCalled();
    expect(seqs(r.acks)).toEqual([1, 2]);
  });

  it.each([undefined, "live"] as const)(
    "target %s reaches the live side exactly as before (AC3)",
    (target) => {
      const r = rig(true, true);
      for (const control of seven(target)) r.applier.receive("d1", control);
      runFrame(16);
      expect(r.deps.setDials).toHaveBeenCalledWith({ ...DEFAULT_DIALS, reactivity: 0.3 });
      expect(r.deps.setColour).toHaveBeenCalledWith(0, "#00ff00");
      expect(r.deps.resetColour).toHaveBeenCalledWith(1);
      expect(r.deps.setCamera).toHaveBeenCalledWith("cam-2");
      expect(r.deps.setTransition).toHaveBeenCalledWith({
        kind: "dip",
        duration: 4,
        keepColour: true,
      });
      expect(r.deps.setStrength).toHaveBeenCalledWith("w1", 0, 0.2);
      expect(r.deps.pick).toHaveBeenCalledWith("c1");
      for (const fn of stagedSpies(stagedOf(r.deps))) expect(fn).not.toHaveBeenCalled();
    },
  );

  it("with no staged look, a staged control is dropped and acknowledged (AC4)", () => {
    const r = rig(true, false);
    for (const control of seven("staged")) r.applier.receive("d1", control);
    runFrame(16);
    for (const fn of stagedSpies(stagedOf(r.deps))) expect(fn).not.toHaveBeenCalled();
    expect(liveCalls(r.deps)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(seqs(r.acks)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("stage and unstage (B-07 AC1, AC5, AC7, AC8)", () => {
  it("stage from live copies the live look, the camera on screen and the transition, and calls nothing live (AC1)", () => {
    const r = rig();
    r.applier.receive("d1", dials(1, { recognisability: 0.4 }));
    r.applier.receive("d1", { type: "stage", seq: 2, from: "live" });
    runFrame(16);
    expect(stagedOf(r.deps).fromLive).toHaveBeenCalledWith(
      { id: "w1", name: "Warm", stored: LIVE, palette: ["#111111", "#222222"], amounts: [0.7] },
      { ...DEFAULT_DIALS, recognisability: 0.4 },
      { kind: "local", deviceId: "cam-1", label: "Front" },
      { kind: "wipe", duration: 3 },
    );
    expect(liveCalls(r.deps)).toEqual([1, 0, 0, 0, 0, 0, 0]); // only the dials control before it
    expect(seqs(r.acks)).toEqual([1, 2]);
  });

  it("stage a profile makes a staged look and picks it there, acknowledged at its settle (AC5)", async () => {
    const r = rig();
    r.applier.receive("d1", { type: "stage", seq: 3, from: { profile: "c1" } });
    runFrame(16);
    const s = stagedOf(r.deps);
    expect(s.fromLive).toHaveBeenCalledTimes(1);
    expect(s.pick).toHaveBeenCalledWith("c1");
    expect(r.deps.pick).not.toHaveBeenCalled();
    expect(r.acks).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    runFrame(32);
    expect(r.acks).toEqual([[{ deviceId: "d1", seq: 3 }]]);
  });

  it("stage a scene is acknowledged and changes nothing yet", () => {
    const r = rig();
    r.applier.receive("d1", { type: "stage", seq: 4, from: { scene: "s1" } });
    runFrame(16);
    expect(stagedOf(r.deps).fromLive).not.toHaveBeenCalled();
    expect(r.acks).toEqual([[{ deviceId: "d1", seq: 4 }]]);
  });

  it("unstage clears the staged look and touches nothing live (AC7)", () => {
    const r = rig(true, true);
    r.applier.receive("d1", { type: "unstage", seq: 5 });
    runFrame(16);
    expect(stagedOf(r.deps).clear).toHaveBeenCalledTimes(1);
    expect(liveCalls(r.deps)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(r.acks).toEqual([[{ deviceId: "d1", seq: 5 }]]);
  });

  it("no staging control lists or picks a profile on the live side (AC8)", () => {
    const r = rig(true, true);
    r.applier.receive("d1", { type: "stage", seq: 1, from: "live" });
    r.applier.receive("d1", {
      type: "colour",
      seq: 2,
      slot: 0,
      value: "#00ff00",
      target: "staged",
    });
    r.applier.receive("d1", { type: "unstage", seq: 3 });
    runFrame(16);
    expect(r.deps.refresh).not.toHaveBeenCalled();
    expect(r.deps.pick).not.toHaveBeenCalled();
  });
});

describe("the transition control (B-09 SD19, AC25)", () => {
  it("reaches the choice in the next frame, before the engine draws, acknowledged in that batch", () => {
    const r = rig();
    runFrame(16);
    r.applier.receive("d1", { type: "transition", seq: 6, kind: "crossfade" });
    r.applier.receive("d2", { type: "transition", seq: 2, duration: 4, keepColour: true });
    expect(r.deps.setTransition).not.toHaveBeenCalled(); // never applied on receipt
    runFrame(32);
    expect(r.deps.setTransition).toHaveBeenNthCalledWith(1, { kind: "crossfade" });
    expect(r.deps.setTransition).toHaveBeenNthCalledWith(2, { duration: 4, keepColour: true });
    expect(r.events.slice(-3)).toEqual(["setTransition", "setTransition", "draw"]);
    expect(r.acks).toEqual([
      [
        { deviceId: "d1", seq: 6 },
        { deviceId: "d2", seq: 2 },
      ],
    ]);
  });
});
