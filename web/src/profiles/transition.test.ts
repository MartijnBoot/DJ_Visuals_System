// T1 (B-09 spec SD6, SD9, AC19; plan PD14): the transition choice remembered under
// `djv.transition`, validated on read, never throwing; and the duration fader's curve.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSITION,
  durationAt,
  formatDuration,
  loadTransition,
  positionOf,
  saveTransition,
  TRANSITION_KEY,
} from "./transition.ts";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const throwing = {
  getItem: () => {
    throw new Error("storage disabled");
  },
  setItem: () => {
    throw new Error("quota exceeded");
  },
};

describe("the remembered transition choice (SD9, AC19)", () => {
  it("defaults to Cut, 2.0 s, Keep colour off", () => {
    expect(DEFAULT_TRANSITION).toEqual({ kind: "cut", duration: 2, keepColour: false });
    expect(TRANSITION_KEY).toBe("djv.transition");
  });

  it("round-trips a saved choice", () => {
    const storage = memory();
    const choice = { kind: "dissolve", duration: 8, keepColour: true } as const;
    saveTransition(choice, storage);
    expect(JSON.parse(storage.data.get("djv.transition")!)).toEqual(choice);
    expect(loadTransition(storage)).toEqual(choice);
  });

  it("reads a missing key, broken JSON, a wrong shape and an out-of-range duration as the default", () => {
    expect(loadTransition(memory())).toEqual(DEFAULT_TRANSITION);
    expect(loadTransition(memory({ "djv.transition": "{" }))).toEqual(DEFAULT_TRANSITION);
    expect(loadTransition(memory({ "djv.transition": '{"kind":"zoom"}' }))).toEqual(
      DEFAULT_TRANSITION,
    );
    expect(loadTransition(memory({ "djv.transition": "[1,2]" }))).toEqual(DEFAULT_TRANSITION);
    const nine = JSON.stringify({ kind: "wipe", duration: 9, keepColour: false });
    expect(loadTransition(memory({ "djv.transition": nine }))).toEqual(DEFAULT_TRANSITION);
  });

  it("reads a throwing storage as the default, and saving never throws", () => {
    expect(loadTransition(throwing)).toEqual(DEFAULT_TRANSITION);
    expect(() => saveTransition(DEFAULT_TRANSITION, throwing)).not.toThrow();
  });

  it("returns a copy of the default, so a caller cannot change it", () => {
    const loaded = loadTransition(memory());
    loaded.duration = 4;
    expect(DEFAULT_TRANSITION.duration).toBe(2);
  });
});

describe("the duration curve (SD6, AC21)", () => {
  it("maps 0, 0.5 and 1 to 0.5 s, 2 s and 8 s", () => {
    expect(durationAt(0)).toBeCloseTo(0.5, 10);
    expect(durationAt(0.5)).toBeCloseTo(2, 10);
    expect(durationAt(1)).toBeCloseTo(8, 10);
  });

  it("inverts: positionOf(durationAt(x)) is x", () => {
    for (let x = 0; x <= 1; x += 0.05) expect(positionOf(durationAt(x))).toBeCloseTo(x, 10);
  });

  it("keeps a position inside 0 to 1 for any duration", () => {
    expect(positionOf(0.1)).toBe(0);
    expect(positionOf(100)).toBe(1);
  });

  it("formats seconds with one decimal", () => {
    expect(formatDuration(2)).toBe("2.0 s");
    expect(formatDuration(0.5)).toBe("0.5 s");
    expect(formatDuration(8)).toBe("8.0 s");
    expect(formatDuration(durationAt(0.3))).toBe("1.1 s");
  });
});
