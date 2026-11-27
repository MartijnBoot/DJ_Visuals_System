// B-07 T5 (SD2, SD3, SD11, AC1, AC2, AC5, AC7, AC8; plan PD3, PD4, PD7): the staged look on the
// screen page, with a fake profile API. It holds its own copy of everything and calls nothing
// live: its only dependency besides `onChange` is `api.get`.
import type { Profile, StoredProfile } from "@djv/shared";
import { describe, expect, it, vi } from "vitest";
import type { ProfileResult } from "../profiles/api.ts";
import { BUILTIN_ID } from "../profiles/builtin.ts";
import { createStagedLook, type LiveSnapshot } from "./staged.ts";

const warm: Profile = {
  name: "Warm",
  palette: ["#1a0500", "#c2410c", "#fbbf24"],
  dials: { recognisability: 0.2, reactivity: 0.9 },
  effects: [
    { type: "paletteMap", amount: 1 },
    { type: "zoom", amount: 0.3, vj: true },
    { type: "flash", amount: 0.5, colourSlot: 2, dj: true },
  ],
};
const cool: Profile = {
  name: "Cool",
  palette: ["#001020", "#2080ff"],
  dials: { recognisability: 0.7, reactivity: 0.1 },
  effects: [{ type: "smear", amount: 0.6, vj: true }],
  primary: 1,
};
const stored = (id: string, profile: Profile): StoredProfile => ({
  ...profile,
  id,
  revision: 3,
  createdAt: "2026-11-26T10:00:00.000Z",
  updatedAt: "2026-11-26T10:00:00.000Z",
});

const live: LiveSnapshot = {
  id: "w1",
  name: "Warm",
  stored: warm,
  palette: ["#1a0500", "#ff0000", "#fbbf24"],
  amounts: [1, 0.8, 0.5],
};
const feed = { kind: "local" as const, deviceId: "cam-1", label: "Front" };
const transition = { kind: "crossfade" as const, duration: 2 };

function setup(results: Record<string, ProfileResult> = {}) {
  const pending = new Map<string, (result: ProfileResult) => void>();
  const get = vi.fn(
    (id: string) =>
      new Promise<ProfileResult>((resolve) => {
        if (results[id]) resolve(results[id]);
        else pending.set(id, resolve);
      }),
  );
  const onChange = vi.fn();
  const staged = createStagedLook({ api: { get }, onChange });
  return { staged, get, onChange, pending };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Stage from live (AC1)", () => {
  it("copies palette, strengths, dials, feed and transition, and nothing is fetched", () => {
    const { staged, get, onChange } = setup();
    expect(staged.state()).toBeNull();
    staged.fromLive(live, { recognisability: 0.4, reactivity: 0.6 }, feed, transition);
    expect(staged.state()).toEqual({
      id: "w1",
      name: "Warm",
      palette: ["#1a0500", "#ff0000", "#fbbf24"],
      storedPalette: warm.palette,
      primary: 2,
      dials: { recognisability: 0.4, reactivity: 0.6 },
      effects: [
        { index: 1, name: "zoom", stored: 0.3, value: 0.8, dj: false, vj: true },
        { index: 2, name: "flash", stored: 0.5, value: 0.5, dj: true, vj: false },
      ],
      feed: { kind: "local", label: "Front" },
      transition,
      fromScene: null,
      settled: true,
      reason: null,
    });
    expect(get).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it("keeps a scene tie when given one, and a remote feed shows its hint", () => {
    const { staged } = setup();
    staged.fromLive(live, warm.dials, { kind: "remote", hint: "Chrome on Android" }, transition, {
      id: "s1",
      name: "Crowd",
    });
    expect(staged.state()).toMatchObject({
      feed: { kind: "remote", label: "Chrome on Android" },
      fromScene: { id: "s1", name: "Crowd" },
    });
    expect(staged.definition()).toMatchObject({
      feed: { kind: "remote", hint: "Chrome on Android" },
    });
  });
});

describe("after a Go lands (AC11, SD11, PD21)", () => {
  const scene: LiveSnapshot = {
    id: "scene:s1",
    name: "Crowd",
    stored: cool,
    palette: cool.palette,
    amounts: [0.6],
  };
  const tie = { id: "s1", name: "Crowd" };

  it("becomes the copy of the new live look when nothing changed since Go", () => {
    const { staged } = setup();
    staged.fromLive(live, warm.dials, feed, transition);
    const at = staged.revision();
    staged.afterGo(at, scene, cool.dials, null, transition, tie);
    expect(staged.state()).toMatchObject({ id: "scene:s1", fromScene: tie, settled: true });
  });

  it("is kept as it is when it changed since Go, and is never brought back once unstaged", () => {
    const { staged } = setup();
    staged.fromLive(live, warm.dials, feed, transition);
    const at = staged.revision();
    staged.setDials({ reactivity: 0.05 });
    staged.afterGo(at, scene, cool.dials, null, transition, tie);
    expect(staged.state()).toMatchObject({ id: "w1", dials: { reactivity: 0.05 } });
    staged.clear();
    staged.afterGo(staged.revision(), scene, cool.dials, null, transition, tie);
    expect(staged.state()).toBeNull();
  });
});

describe("edits change only the staged look (AC2, PD7)", () => {
  it("dials, colour, reset, strength, feed and transition", () => {
    const { staged } = setup();
    staged.fromLive(live, { recognisability: 0.4, reactivity: 0.6 }, feed, transition);
    staged.setDials({ reactivity: 0.1 });
    staged.setColour(0, "#00ff00");
    staged.setColour(9, "#00ff00"); // outside the palette: dropped
    staged.resetColour(1);
    staged.setStrength("w1", 1, 0.2);
    staged.setStrength("w1", 7, 0.2); // no effect there: dropped
    staged.setStrength("c1", 1, 0.9); // a stale profile id: dropped
    staged.setFeed({ kind: "remote", hint: "Safari on iPhone" });
    staged.setTransition({ duration: 6 });
    expect(staged.state()).toMatchObject({
      dials: { recognisability: 0.4, reactivity: 0.1 },
      palette: ["#00ff00", "#c2410c", "#fbbf24"],
      effects: [
        { index: 1, value: 0.2 },
        { index: 2, value: 0.5 },
      ],
      feed: { kind: "remote", label: "Safari on iPhone" },
      transition: { kind: "crossfade", duration: 6 },
    });
    staged.setFeed(null);
    expect(staged.state()!.feed).toBeNull();
  });

  it("does nothing without a staged look", () => {
    const { staged, onChange } = setup();
    staged.setDials({ reactivity: 0.1 });
    staged.setColour(0, "#00ff00");
    staged.setStrength("w1", 1, 0.2);
    staged.setTransition({ kind: "cut" });
    expect(staged.state()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("a staged pick (AC5, PD4)", () => {
  it("loads the profile with its starting dials and stored palette, keeping feed, transition and the scene tie", async () => {
    const { staged, get } = setup({ c1: { kind: "ok", profile: stored("c1", cool) } });
    staged.fromLive(live, { recognisability: 0.4, reactivity: 0.6 }, feed, transition, {
      id: "s1",
      name: "Crowd",
    });
    staged.setColour(0, "#00ff00");
    const picked = staged.pick("c1");
    expect(staged.state()!.settled).toBe(false);
    await picked;
    expect(get).toHaveBeenCalledWith("c1");
    expect(staged.state()).toMatchObject({
      id: "c1",
      name: "Cool",
      palette: cool.palette,
      storedPalette: cool.palette,
      primary: 1,
      dials: cool.dials,
      effects: [{ index: 0, name: "smear", stored: 0.6, value: 0.6 }],
      feed: { kind: "local", label: "Front" },
      transition,
      fromScene: { id: "s1", name: "Crowd" },
      settled: true,
      reason: null,
    });
    // The base keeps only a profile's own fields: nothing of the stored row.
    expect(staged.definition()!.stored).toEqual(cool);
  });

  it("the built-in is picked without a fetch", async () => {
    const { staged, get } = setup();
    staged.fromLive(live, warm.dials, null, transition);
    await staged.pick(BUILTIN_ID);
    expect(get).not.toHaveBeenCalled();
    expect(staged.state()).toMatchObject({ id: BUILTIN_ID, name: "Built-in", settled: true });
  });

  it("a newer pick supersedes a pending one", async () => {
    const { staged, pending } = setup();
    staged.fromLive(live, warm.dials, null, transition);
    const first = staged.pick("w2");
    const second = staged.pick("c1");
    pending.get("c1")!({ kind: "ok", profile: stored("c1", cool) });
    await second;
    pending.get("w2")!({ kind: "ok", profile: stored("w2", { ...warm, name: "Late" }) });
    await first;
    expect(staged.state()).toMatchObject({ id: "c1", name: "Cool", settled: true });
  });

  it("a failure keeps the look as it was and says why, in today's words", async () => {
    const { staged } = setup({ gone: { kind: "missing" }, down: { kind: "unreachable" } });
    staged.fromLive(live, warm.dials, feed, transition);
    const before = staged.state()!;
    await staged.pick("gone");
    expect(staged.state()).toEqual({
      ...before,
      reason: "that profile no longer exists; keeping the current look",
    });
    await staged.pick("down");
    expect(staged.state()!.reason).toBe(
      "that profile could not be fetched: the server cannot be reached; keeping the current look",
    );
  });

  it("an Unstage during a pick leaves no staged look when the pick lands", async () => {
    const { staged, pending } = setup();
    staged.fromLive(live, warm.dials, null, transition);
    const picked = staged.pick("c1");
    staged.clear();
    pending.get("c1")!({ kind: "ok", profile: stored("c1", cool) });
    await picked;
    await flush();
    expect(staged.state()).toBeNull();
  });
});

describe("Unstage (AC7)", () => {
  it("clears the staged look", () => {
    const { staged, onChange } = setup();
    staged.fromLive(live, warm.dials, feed, transition);
    onChange.mockClear();
    staged.clear();
    expect(staged.state()).toBeNull();
    expect(staged.definition()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("the staged definition (SD1, SD18)", () => {
  it("is the base with the live palette and strengths, the dials, feed and transition", () => {
    const { staged } = setup();
    staged.fromLive(live, { recognisability: 0.4, reactivity: 0.6 }, feed, transition);
    expect(staged.definition()).toEqual({
      id: "w1",
      name: "Warm",
      stored: warm,
      palette: live.palette,
      amounts: [1, 0.8, 0.5],
      dials: { recognisability: 0.4, reactivity: 0.6 },
      feed,
      transition,
    });
  });
});

// B-07 T7 (SD3, SD11, AC6, AC21; plan PD3, PD4, PD8): staging a saved scene, the scene tie a Save
// sets, and the reason a refused save, rename or delete gives.
describe("a staged scene (AC6, SD11)", () => {
  const scene = {
    profile: {
      ...cool,
      palette: ["#ff00ff", "#00ffff"],
      effects: [{ type: "smear" as const, amount: 0.9, vj: true }],
    },
    dials: { recognisability: 0.3, reactivity: 0.8 },
    feed: { kind: "remote" as const, hint: "Safari on iPhone" },
    transition: { kind: "wipe" as const, duration: 5 },
  };

  it("holds the scene's copy, palette, strengths, dials, feed and transition, tied to it", () => {
    const { staged, get } = setup();
    staged.fromScene(scene, "s1", "Warm crowd");
    expect(staged.state()).toEqual({
      id: "scene:s1",
      name: "Warm crowd",
      palette: ["#ff00ff", "#00ffff"],
      storedPalette: ["#ff00ff", "#00ffff"],
      primary: 1,
      dials: { recognisability: 0.3, reactivity: 0.8 },
      effects: [{ index: 0, name: "smear", stored: 0.9, value: 0.9, dj: false, vj: true }],
      feed: { kind: "remote", label: "Safari on iPhone" },
      transition: { kind: "wipe", duration: 5 },
      fromScene: { id: "s1", name: "Warm crowd" },
      settled: true,
      reason: null,
    });
    expect(staged.definition()).toMatchObject({ stored: scene.profile, amounts: [0.9] });
    expect(get).not.toHaveBeenCalled();
  });

  it("a scene with no feed stages none", () => {
    const { staged } = setup();
    const { feed: _feed, ...noFeed } = scene;
    staged.fromScene(noFeed, "s2", "Booth");
    expect(staged.state()!.feed).toBeNull();
  });

  it("any later stage replaces the tie; a staged pick keeps it (PD4)", async () => {
    const { staged } = setup({ c1: { kind: "ok", profile: stored("c1", cool) } });
    staged.fromScene(scene, "s1", "Warm crowd");
    await staged.pick("c1");
    expect(staged.state()!.fromScene).toEqual({ id: "s1", name: "Warm crowd" });
    staged.fromLive(live, warm.dials, null, transition);
    expect(staged.state()!.fromScene).toBeNull();
  });

  it("a Save ties the look to what it was saved as; a reason shows until the next change", () => {
    const { staged } = setup();
    staged.fromLive(live, warm.dials, null, transition);
    staged.tie({ id: "s9", name: "Saved" });
    expect(staged.state()!.fromScene).toEqual({ id: "s9", name: "Saved" });
    staged.setReason("That name is taken");
    expect(staged.state()!.reason).toBe("That name is taken");
    staged.setDials({ reactivity: 0.5 });
    expect(staged.state()!.reason).toBeNull();
  });

  it("tie and setReason do nothing without a staged look", () => {
    const { staged, onChange } = setup();
    staged.tie({ id: "s9", name: "Saved" });
    staged.setReason("x");
    expect(staged.state()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
