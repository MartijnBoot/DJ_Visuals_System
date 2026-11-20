// B-19 T3 (spec SD9, AC2, AC3, AC4, AC5, AC7, AC9, AC10; plan PD5, PD6, PD8): the fader's gesture
// rules, without a browser — relative drag, clamp without memory, the frame limit, keys, let-go.
import { describe, expect, it } from "vitest";
import { createFaderGesture, FADER_GAP_MS, readout } from "./fader.ts";

/** A gesture on a fake clock and fake frames; `frame(ms)` runs one animation frame. */
function rig() {
  let clock = 0;
  let frames = new Map<number, () => void>();
  let next = 0;
  const deps = {
    now: () => clock,
    requestFrame: (fn: () => void) => {
      frames.set(++next, fn);
      return next;
    },
    cancelFrame: (id: number) => void frames.delete(id),
  };
  const make = () => {
    const sent: number[] = [];
    const gesture = createFaderGesture({ ...deps, send: (v) => sent.push(v) });
    return { gesture, sent };
  };
  const frame = (ms: number) => {
    clock += ms;
    const due = [...frames.values()];
    frames = new Map();
    due.forEach((f) => f());
  };
  return { make, frame };
}

const TRAVEL = 300;

describe("a tap (AC2)", () => {
  it("down then up without a move sends nothing", () => {
    const { make, frame } = rig();
    const { gesture, sent } = make();
    gesture.down(1, 150, 0.5, TRAVEL);
    expect(gesture.held()).toBe(true);
    frame(16);
    gesture.up(1);
    frame(16);
    expect(sent).toEqual([]);
    expect(gesture.held()).toBe(false);
  });

  it("a move that does not change the value sends nothing either", () => {
    const { make, frame } = rig();
    const { gesture, sent } = make();
    gesture.down(1, 150, 0.5, TRAVEL);
    expect(gesture.move(1, 150.5)).toBe(0.5);
    frame(16);
    gesture.up(1);
    expect(sent).toEqual([]);
  });
});

describe("relative drag (AC3)", () => {
  it.each([0.1, 0.9])("a drag of 0.3 × travel from a down at %s moves the value by 0.30", (at) => {
    const { make } = rig();
    const { gesture, sent } = make();
    // The finger lands at `at` along the track; the screen's value is 0.35 wherever it lands.
    const start = at * TRAVEL;
    gesture.down(1, start, 0.35, TRAVEL);
    gesture.move(1, start + 0.15 * TRAVEL);
    expect(gesture.move(1, start + 0.3 * TRAVEL)).toBeCloseTo(0.65, 2);
    gesture.up(1);
    expect(sent.at(-1)).toBeCloseTo(0.65, 2);
  });

  it("a drag the other way lowers the value by the same rule", () => {
    const { make } = rig();
    const { gesture, sent } = make();
    gesture.down(1, 200, 0.5, TRAVEL);
    expect(gesture.move(1, 200 - 0.25 * TRAVEL)).toBe(0.25);
    gesture.up(1);
    expect(sent).toEqual([0.25]);
  });

  it("sends and shows values on the 0.01 grid", () => {
    const { make } = rig();
    const { gesture, sent } = make();
    gesture.down(1, 0, 0.5, TRAVEL);
    expect(gesture.move(1, 1)).toBe(0.5); // 1/300 is less than half a step
    expect(gesture.move(1, 2)).toBe(0.51); // 2/300 rounds up, the sub-step moves were kept
    gesture.up(1);
    expect(sent).toEqual([0.51]);
  });
});

describe("clamp without memory (AC4)", () => {
  it("a drag past 1 then back by 0.1 × travel reads 0.90", () => {
    const { make } = rig();
    const { gesture, sent } = make();
    gesture.down(1, 0, 0.8, TRAVEL);
    expect(gesture.move(1, 0.5 * TRAVEL)).toBe(1);
    expect(gesture.move(1, 0.4 * TRAVEL)).toBe(0.9);
    gesture.up(1);
    expect(sent.at(-1)).toBe(0.9);
  });

  it("a drag past 0 then back reverses at once", () => {
    const { make } = rig();
    const { gesture } = make();
    gesture.down(1, 300, 0.2, TRAVEL);
    expect(gesture.move(1, 0)).toBe(0);
    expect(gesture.move(1, 30)).toBe(0.1);
  });
});

describe("the frame limit (AC5, PD6)", () => {
  it("100 moves inside one frame send one value; release sends the last at once", () => {
    const { make, frame } = rig();
    const { gesture, sent } = make();
    gesture.down(1, 0, 0, TRAVEL);
    for (let i = 1; i <= 100; i++) gesture.move(1, i);
    expect(sent).toEqual([]);
    frame(FADER_GAP_MS);
    expect(sent).toEqual([0.33]);
    gesture.move(1, 120);
    gesture.move(1, 150);
    gesture.up(1);
    expect(sent).toEqual([0.33, 0.5]);
    frame(FADER_GAP_MS);
    expect(sent).toEqual([0.33, 0.5]);
  });

  it("two faders dragged at 120 frames a second send at most 100 values in a second together", () => {
    const { make, frame } = rig();
    const a = make();
    const b = make();
    a.gesture.down(1, 0, 0, 10_000);
    b.gesture.down(2, 0, 0, 10_000);
    for (let i = 1; i <= 120; i++) {
      a.gesture.move(1, i * 50);
      b.gesture.move(2, i * 50);
      frame(1000 / 120);
    }
    expect(a.sent.length + b.sent.length).toBeLessThanOrEqual(100);
    expect(a.sent.length).toBeGreaterThan(20);
  });
});

describe("keys (AC7)", () => {
  // The key, then its result from 0, from 0.5 and from 1; null where the value does not change.
  it.each([
    ["ArrowRight", 0.01, 0.51, null],
    ["ArrowUp", 0.01, 0.51, null],
    ["ArrowLeft", null, 0.49, 0.99],
    ["ArrowDown", null, 0.49, 0.99],
    ["PageUp", 0.1, 0.6, null],
    ["PageDown", null, 0.4, 0.9],
    ["Home", null, 0, 0],
    ["End", 1, 1, null],
  ] as const)("%s from 0, 0.5 and 1", (key, from0, from5, from1) => {
    const { make } = rig();
    const { gesture, sent } = make();
    const expected = [from0, from5, from1];
    [0, 0.5, 1].forEach((value, i) => {
      expect(gesture.key(key, value)).toBe(expected[i]);
    });
    // One send per press that changes the value, at once; nothing when it does not change.
    expect(sent).toEqual(expected.filter((v) => v !== null));
  });

  it("an unhandled key does nothing", () => {
    const { make } = rig();
    const { gesture, sent } = make();
    expect(gesture.key("Enter", 0.5)).toBeNull();
    expect(gesture.key("a", 0.5)).toBeNull();
    expect(sent).toEqual([]);
  });

  it("keys do nothing while a pointer holds the fader", () => {
    const { make } = rig();
    const { gesture, sent } = make();
    gesture.down(1, 0, 0.5, TRAVEL);
    expect(gesture.key("ArrowUp", 0.5)).toBeNull();
    expect(sent).toEqual([]);
  });
});

describe("let go (AC9)", () => {
  it("letGo() mid-drag drops the pending send; a later up sends nothing more", () => {
    const { make, frame } = rig();
    const { gesture, sent } = make();
    gesture.down(1, 0, 0.5, TRAVEL);
    gesture.move(1, 30);
    frame(FADER_GAP_MS);
    expect(sent).toEqual([0.6]);
    gesture.move(1, 60);
    gesture.letGo();
    expect(gesture.held()).toBe(false);
    frame(FADER_GAP_MS);
    gesture.move(1, 90);
    gesture.up(1);
    frame(FADER_GAP_MS);
    expect(sent).toEqual([0.6]);
  });

  it("a new drag after a let-go works as usual", () => {
    const { make } = rig();
    const { gesture, sent } = make();
    gesture.down(1, 0, 0.5, TRAVEL);
    gesture.letGo();
    gesture.down(2, 0, 0.5, TRAVEL);
    gesture.move(2, 30);
    gesture.up(2);
    expect(sent).toEqual([0.6]);
  });
});

describe("one pointer per fader (SD9)", () => {
  it("a second pointer while one is held is ignored", () => {
    const { make } = rig();
    const { gesture, sent } = make();
    expect(gesture.down(1, 0, 0.5, TRAVEL)).toBe(true);
    expect(gesture.down(2, 100, 0.5, TRAVEL)).toBe(false);
    expect(gesture.move(2, 200)).toBeNull();
    gesture.up(2);
    expect(gesture.held()).toBe(true);
    expect(gesture.move(1, 30)).toBe(0.6);
    gesture.up(1);
    expect(sent).toEqual([0.6]);
  });
});

describe("the readout (AC10, PD8)", () => {
  it("is the value × 100, rounded to a whole number", () => {
    expect(readout(0.42)).toBe(42);
    expect(readout(0)).toBe(0);
    expect(readout(1)).toBe(100);
    expect(readout(0.425)).toBe(Math.round(0.425 * 100));
    expect(readout(0.004)).toBe(0);
  });
});
