// B-07 T9 (SD4, SD9, SD11, AC9, AC18, AC20, AC21; plan PD20): what each control on /control shows
// and sends, by which look the Editing switch reads.
import type { ScreenState, Staged } from "@djv/shared";
import { describe, expect, it } from "vitest";
import { feedLine, nameProblem, saveChoices, shownLook, withTarget } from "./scenes-view.ts";

const staged: Staged = {
  id: "c1",
  name: "Cool",
  palette: ["#001020", "#ff0000"],
  storedPalette: ["#001020", "#2080ff"],
  primary: 0,
  dials: { recognisability: 0.7, reactivity: 0.1 },
  effects: [{ index: 0, name: "smear", stored: 0.6, value: 0.2, dj: false, vj: true }],
  feed: { kind: "local", label: "Side" },
  transition: { kind: "wipe", duration: 5 },
  fromScene: { id: "s1", name: "Warm crowd" },
  settled: true,
  reason: null,
};

const state: ScreenState = {
  profiles: [
    { id: "w1", name: "Warm" },
    { id: "c1", name: "Cool" },
  ],
  activeId: "w1",
  palette: ["#000000", "#ffffff", "#123456"],
  storedPalette: ["#000000", "#ffffff", "#123456"],
  primary: 1,
  dials: { recognisability: 0.2, reactivity: 0.9 },
  cameras: [
    { deviceId: "cam-1", label: "Front", remote: false },
    { deviceId: "cam-2", label: "Side", remote: false },
    { deviceId: "remote:d9", label: "Chrome on Android — Device 2", remote: true },
  ],
  cameraId: "cam-1",
  camera: "ok",
  audio: "ok",
  started: true,
  reason: null,
  mainAudio: null,
  transition: { kind: "crossfade", duration: 2, keepColour: true },
  effects: [],
  staged,
  scenes: [
    { id: "s1", name: "Warm crowd" },
    { id: "s2", name: "Booth" },
  ],
};

describe("shownLook (PD20)", () => {
  it("is the live look while editing live", () => {
    expect(shownLook(state, "live")).toEqual({
      id: "w1",
      palette: state.palette,
      storedPalette: state.storedPalette,
      primary: 1,
      dials: state.dials,
      effects: [],
      transition: { kind: "crossfade", duration: 2, keepColour: true },
      cameraId: "cam-1",
    });
  });

  it("is the staged look while editing staged: its profile, colours, dials, effects, transition and feed's camera", () => {
    expect(shownLook(state, "staged")).toEqual({
      id: "c1",
      palette: staged.palette,
      storedPalette: staged.storedPalette,
      primary: 0,
      dials: staged.dials,
      effects: staged.effects,
      transition: { kind: "wipe", duration: 5, keepColour: false },
      cameraId: "cam-2",
    });
  });

  it("a staged remote feed presses the one sender whose label starts with its hint; none presses nothing", () => {
    const remote = {
      ...state,
      staged: { ...staged, feed: { kind: "remote" as const, label: "Chrome on Android" } },
    };
    expect(shownLook(remote, "staged").cameraId).toBe("remote:d9");
    const none = { ...state, staged: { ...staged, feed: null } };
    expect(shownLook(none, "staged").cameraId).toBeNull();
  });

  it("is the live look while editing staged with no staged look", () => {
    expect(shownLook({ ...state, staged: null }, "staged").id).toBe("w1");
  });
});

describe("withTarget (AC9)", () => {
  it("adds target staged to the seven while editing staged", () => {
    for (const message of [
      { type: "pick", id: "c1" },
      { type: "dials", reactivity: 0.5 },
      { type: "colour", slot: 0, value: "#ffffff" },
      { type: "resetColour", slot: 0 },
      { type: "camera", deviceId: "cam-2" },
      { type: "transition", kind: "cut" },
      { type: "effect", profile: "c1", index: 0, value: 1 },
    ] as const) {
      expect(withTarget(message, "staged")).toEqual({ ...message, target: "staged" });
      expect(withTarget(message, "live")).toEqual(message); // no target at all, as before
    }
  });

  it("never adds a target to anything else", () => {
    for (const message of [
      { type: "refresh" },
      { type: "mainAudio", source: "local" },
      { type: "stage", from: "live" },
      { type: "go" },
      { type: "saveScene", name: "A" },
    ] as const) {
      expect(withTarget(message, "staged")).toEqual(message);
    }
  });
});

describe("saveChoices (SD9, AC21)", () => {
  it("offers Update and Save as new while the scene the look came from is listed", () => {
    expect(saveChoices(staged, state.scenes!)).toEqual([
      { label: "Update Warm crowd", updateId: "s1", name: "Warm crowd" },
      { label: "Save as new", updateId: undefined, name: null },
    ]);
  });

  it("offers Save as new only once that scene is deleted, and Save for a look with no scene", () => {
    expect(saveChoices(staged, [{ id: "s2", name: "Booth" }])).toEqual([
      { label: "Save as new", updateId: undefined, name: null },
    ]);
    expect(saveChoices({ ...staged, fromScene: null }, state.scenes!)).toEqual([
      { label: "Save", updateId: undefined, name: null },
    ]);
    expect(saveChoices(null, state.scenes!)).toEqual([
      { label: "Save", updateId: undefined, name: null },
    ]);
  });
});

describe("nameProblem (AC20)", () => {
  it("is null for 1 to 60 characters, trimmed; says why otherwise", () => {
    expect(nameProblem("Warm crowd")).toBeNull();
    expect(nameProblem("  x  ")).toBeNull();
    expect(nameProblem("x".repeat(60))).toBeNull();
    expect(nameProblem("   ")).toBe("A name is 1 to 60 characters");
    expect(nameProblem("x".repeat(61))).toBe("A name is 1 to 60 characters");
  });
});

describe("feedLine (AC18)", () => {
  it("says what Go switches to while it differs from the live camera", () => {
    expect(feedLine(state)).toBe("Feed: Side (applies at Go)");
  });

  it("says nothing when the feed is the live camera, absent, or there is no staged look", () => {
    expect(
      feedLine({ ...state, staged: { ...staged, feed: { kind: "local", label: "Front" } } }),
    ).toBeNull();
    expect(feedLine({ ...state, staged: { ...staged, feed: null } })).toBeNull();
    expect(feedLine({ ...state, staged: null })).toBeNull();
  });

  it("a remote feed names its hint, and matches a live sender by it", () => {
    const remote = {
      ...state,
      staged: { ...staged, feed: { kind: "remote" as const, label: "Chrome on Android" } },
    };
    expect(feedLine(remote)).toBe("Feed: Chrome on Android (applies at Go)");
    expect(feedLine({ ...remote, cameraId: "remote:d9" })).toBeNull();
  });
});
