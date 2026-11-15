// T9 (B-02 spec AC11 to AC14; plan PD1, PD16, AD2): the screen page's profile controller with
// fakes, so its rules are tested without a browser.
import { ProfileCompileError } from "@djv/engine";
import type { Profile, StoredProfile } from "@djv/shared";
import { describe, expect, it, vi } from "vitest";
import type { ListResult, ProfileResult } from "./api.ts";
import { createActiveProfile } from "./active.ts";
import { BUILTIN_ID } from "./builtin.ts";

const definition: Profile = {
  name: "Warm",
  palette: ["#000000", "#ffffff"],
  dials: { recognisability: 0.9, reactivity: 0.2 },
  effects: [{ type: "paletteMap", amount: 1 }],
};

const stored = (id: string, name: string): StoredProfile => ({
  ...definition,
  name,
  id,
  revision: 1,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
});

function setup(
  options: { remembered?: string | null; list?: ListResult; get?: ProfileResult } = {},
) {
  const warm = stored("w1", "Warm");
  const cool = stored("c1", "Cool");
  const memory = { id: options.remembered ?? null };
  const api = {
    list: vi.fn<() => Promise<ListResult>>(
      async () => options.list ?? { kind: "ok", profiles: [cool, warm] },
    ),
    get: vi.fn<(id: string) => Promise<ProfileResult>>(
      async (id) => options.get ?? { kind: "ok", profile: id === "w1" ? warm : cool },
    ),
  };
  const setProfile = vi.fn<(profile: Profile, options?: { retry?: boolean }) => Promise<void>>(
    async () => {},
  );
  const setDials = vi.fn();
  const log = vi.fn();
  const save = vi.fn((id: string) => void (memory.id = id));
  const active = createActiveProfile({
    api,
    storage: { load: () => memory.id, save },
    setProfile,
    setDials,
    log,
  });
  return { active, api, setProfile, setDials, log, save, memory, warm, cool };
}

describe("before any user action (AC12, PD1)", () => {
  it("makes no call and shows the built-in, picker not loaded", () => {
    const { active, api, setProfile } = setup();
    const state = active.state();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    expect(setProfile).not.toHaveBeenCalled();
    expect(state).toMatchObject({ loaded: false, activeId: BUILTIN_ID, activeName: "Built-in" });
    expect(state.selectedId).toBe(BUILTIN_ID);
    expect(state.reason).toBeNull();
  });

  it("shows a remembered id as 'remembered profile' while the picker is not loaded", () => {
    const { active } = setup({ remembered: "w1" });
    const state = active.state();
    expect(state.loaded).toBe(false);
    expect(state.entries).toEqual([{ id: "w1", name: "remembered profile" }]);
    expect(state.selectedId).toBe("w1");
    expect(state.activeName).toBe("Built-in");
  });
});

describe("open (AC11, AC12)", () => {
  it("lists the built-in first, then the stored names, and loads the picker", async () => {
    const { active, api } = setup();
    await active.open();
    expect(api.list).toHaveBeenCalledTimes(1);
    const state = active.state();
    expect(state.loaded).toBe(true);
    expect(state.entries.map((e) => e.name)).toEqual(["Built-in", "Cool", "Warm"]);
    expect(state.entries[0]!.id).toBe(BUILTIN_ID);
    expect(state.reason).toBeNull();
  });

  it("picks the remembered id when the list has it, applying its starting dials", async () => {
    const { active, api, setProfile, setDials, log, warm } = setup({ remembered: "w1" });
    await active.open();
    expect(api.get).toHaveBeenCalledWith("w1");
    expect(setProfile).toHaveBeenCalledTimes(1);
    expect(setDials).toHaveBeenCalledWith(warm.dials);
    expect(log).toHaveBeenCalledWith("w1");
    expect(active.state()).toMatchObject({ activeId: "w1", activeName: "Warm", selectedId: "w1" });
  });

  it("selects the built-in when the remembered id is not listed, with no reason", async () => {
    const { active, api, setProfile, memory } = setup({ remembered: "gone" });
    await active.open();
    expect(api.get).not.toHaveBeenCalled();
    expect(setProfile).not.toHaveBeenCalled();
    expect(active.state()).toMatchObject({
      activeId: BUILTIN_ID,
      selectedId: BUILTIN_ID,
      reason: null,
    });
    expect(memory.id).toBe("gone"); // an automatic fallback does not forget it
  });

  it("selects the remembered id only on the first open; later opens just re-list", async () => {
    const { active, api, setProfile } = setup({ remembered: "w1" });
    await active.open();
    await active.pick("c1");
    await active.open();
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(setProfile).toHaveBeenCalledTimes(2); // w1, then c1: not w1 again
    expect(active.state().activeId).toBe("c1");
  });

  it("shows no reason for an empty database (AD2)", async () => {
    const { active } = setup({ list: { kind: "ok", profiles: [] } });
    await active.open();
    expect(active.state()).toMatchObject({ loaded: true, activeId: BUILTIN_ID, reason: null });
    expect(active.state().entries.map((e) => e.name)).toEqual(["Built-in"]);
  });

  it("keeps the built-in and gives a reason when the list cannot be fetched (AC13)", async () => {
    for (const kind of ["unreachable", "unusable"] as const) {
      const { active, setProfile } = setup({ remembered: "w1", list: { kind } });
      await active.open();
      const state = active.state();
      expect(state.reason).toMatch(/profiles/i);
      expect(state.activeId).toBe(BUILTIN_ID);
      expect(state.entries.map((e) => e.id)).toContain(BUILTIN_ID);
      expect(setProfile).not.toHaveBeenCalled();
    }
  });

  it("clears the reason when a later open succeeds", async () => {
    const { active, api } = setup();
    api.list.mockResolvedValueOnce({ kind: "unreachable" });
    await active.open();
    expect(active.state().reason).not.toBeNull();
    await active.open();
    expect(active.state().reason).toBeNull();
  });
});

describe("pick (AC11, AC13, AC14)", () => {
  it("re-fetches the profile every time, then switches, applies its dials and remembers it", async () => {
    const { active, api, setProfile, setDials, save, log, warm } = setup();
    await active.open();
    await active.pick("w1");
    await active.pick("w1");
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(setProfile).toHaveBeenCalledTimes(2);
    expect(setProfile.mock.calls[0]![0]).toMatchObject({ name: "Warm", palette: warm.palette });
    expect(setDials).toHaveBeenCalledWith(warm.dials);
    expect(save).toHaveBeenCalledWith("w1");
    expect(log).toHaveBeenCalledWith("w1");
    expect(active.state()).toMatchObject({ activeId: "w1", activeName: "Warm" });
  });

  it("applies the starting dials after the engine has the profile", async () => {
    const { active, setProfile, setDials } = setup();
    await active.open();
    let release: () => void = () => {};
    setProfile.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const picking = active.pick("w1");
    await Promise.resolve();
    await Promise.resolve();
    expect(setDials).not.toHaveBeenCalled();
    release();
    await picking;
    expect(setDials).toHaveBeenCalledTimes(1);
  });

  it("picks the built-in from code, with no fetch", async () => {
    const { active, api, setProfile, setDials, save } = setup();
    await active.open();
    await active.pick("w1");
    api.get.mockClear();
    await active.pick(BUILTIN_ID);
    expect(api.get).not.toHaveBeenCalled();
    expect(setProfile).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Built-in" }), {
      retry: true, // B-03 PD8: a pick retries custom effects the guard turned off
    });
    expect(setDials).toHaveBeenLastCalledWith({ recognisability: 0.3, reactivity: 0.7 });
    expect(save).toHaveBeenLastCalledWith(BUILTIN_ID);
    expect(active.state().activeId).toBe(BUILTIN_ID);
  });

  const failures: [string, ProfileResult, RegExp][] = [
    ["unreachable", { kind: "unreachable" }, /reach/i],
    ["missing", { kind: "missing" }, /no longer exists/i],
    ["unusable", { kind: "unusable" }, /read/i],
    ["invalid", { kind: "invalid", issues: [] }, /read/i],
  ];
  for (const [label, get, reason] of failures) {
    it(`keeps the previous look and gives a reason when the fetch is ${label} (AC13)`, async () => {
      const { active, api, setProfile, setDials, save } = setup();
      await active.open();
      await active.pick("c1");
      setProfile.mockClear();
      setDials.mockClear();
      save.mockClear();
      api.get.mockResolvedValueOnce(get);
      await active.pick("w1");
      const state = active.state();
      expect(state.activeId).toBe("c1");
      expect(state.selectedId).toBe("c1");
      expect(state.reason).toMatch(reason);
      expect(setProfile).not.toHaveBeenCalled();
      expect(setDials).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });
  }

  it("keeps the previous look and gives a reason when the engine cannot prepare it", async () => {
    const { active, setProfile, setDials } = setup();
    await active.open();
    setProfile.mockRejectedValueOnce(new Error("did not link"));
    await active.pick("w1");
    expect(active.state()).toMatchObject({ activeId: BUILTIN_ID, selectedId: BUILTIN_ID });
    expect(active.state().reason).toMatch(/prepare/i);
    expect(setDials).not.toHaveBeenCalled();
  });

  // B-03 AC21 (plan PD9): the reason names the custom effect, never the compiler's text.
  it("names the custom effect whose code does not compile, and keeps the look", async () => {
    const { active, setProfile, setDials } = setup();
    await active.open();
    setProfile.mockRejectedValueOnce(
      new ProfileCompileError([
        { effectIndex: -1, label: "", line: 40, message: "'x' : syntax error" },
        { effectIndex: 2, label: "Swirl", line: 3, message: "'nope' : undeclared identifier" },
      ]),
    );
    await active.pick("w1");
    expect(active.state()).toMatchObject({ activeId: BUILTIN_ID });
    expect(active.state().reason).toBe(
      'that profile could not be prepared: custom effect "Swirl" does not compile; keeping the current look',
    );
    expect(active.state().reason).not.toContain("nope");
    expect(setDials).not.toHaveBeenCalled();
  });

  it("keeps the plain reason when no compile issue names an effect", async () => {
    const { active, setProfile } = setup();
    await active.open();
    setProfile.mockRejectedValueOnce(
      new ProfileCompileError([{ effectIndex: -1, label: "", line: 40, message: "x" }]),
    );
    await active.pick("w1");
    expect(active.state().reason).toBe(
      "that profile could not be prepared; keeping the current look",
    );
  });

  it("leaves what it shows alone when the profile is edited or deleted elsewhere (AC14)", async () => {
    const { active, api, setProfile } = setup();
    await active.open();
    await active.pick("w1");
    setProfile.mockClear();
    api.list.mockResolvedValueOnce({ kind: "ok", profiles: [] }); // deleted elsewhere
    await active.open();
    expect(setProfile).not.toHaveBeenCalled();
    expect(active.state()).toMatchObject({ activeId: "w1", activeName: "Warm" });
  });

  it("lets the newest pick win when two overlap", async () => {
    const { active, api, setProfile } = setup();
    await active.open();
    let releaseFirst: (r: ProfileResult) => void = () => {};
    api.get.mockImplementationOnce(
      () => new Promise<ProfileResult>((resolve) => (releaseFirst = resolve)),
    );
    const first = active.pick("w1");
    await active.pick("c1");
    releaseFirst({ kind: "ok", profile: stored("w1", "Warm") });
    await first;
    expect(setProfile).toHaveBeenCalledTimes(1);
    expect(active.state().activeId).toBe("c1");
  });
});

describe("subscribe", () => {
  it("notifies on every state change until unsubscribed", async () => {
    const { active } = setup();
    const listener = vi.fn();
    const off = active.subscribe(listener);
    await active.open();
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;
    off();
    await active.pick("w1");
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});

describe("live colours (B-04 SD7, AC20, AC21, PD6)", () => {
  const palette3: Profile = { ...definition, palette: ["#000000", "#ffffff", "#ff0000"] };

  it("exposes the live palette, the stored palette and the primary slot", async () => {
    const { active } = setup();
    // The built-in before any pick: primary derived as 1 (SD10).
    expect(active.state()).toMatchObject({
      palette: ["#000000", "#ffffff"],
      storedPalette: ["#000000", "#ffffff"],
      primary: 1,
    });
    const { active: other } = setup({
      get: { kind: "ok", profile: { ...stored("w1", "Warm"), ...palette3, primary: 2 } },
    });
    await other.pick("w1");
    expect(other.state()).toMatchObject({ palette: palette3.palette, primary: 2 });
  });

  it("setColour hands the engine the same effects with the new palette, once", async () => {
    const { active, setProfile, warm } = setup();
    await active.pick("w1");
    setProfile.mockClear();
    active.setColour(1, "#123456");
    expect(setProfile).toHaveBeenCalledTimes(1);
    const sent = setProfile.mock.calls[0]![0];
    expect(sent.effects).toEqual(warm.effects);
    expect(sent.palette).toEqual(["#000000", "#123456"]);
    expect(active.state().palette).toEqual(["#000000", "#123456"]);
    expect(active.state().storedPalette).toEqual(["#000000", "#ffffff"]);
  });

  it("resetColour restores the stored colour", async () => {
    const { active, setProfile } = setup();
    await active.pick("w1");
    active.setColour(0, "#abcdef");
    active.resetColour(0);
    expect(active.state().palette).toEqual(["#000000", "#ffffff"]);
    expect(setProfile.mock.calls.at(-1)![0].palette).toEqual(["#000000", "#ffffff"]);
  });

  it("works on the built-in before any pick", () => {
    const { active, setProfile } = setup();
    active.setColour(1, "#00ff00");
    expect(setProfile.mock.calls[0]![0]).toMatchObject({
      name: "Built-in",
      palette: ["#000000", "#00ff00"],
    });
  });

  it("a pick of the same profile discards the edits", async () => {
    const { active } = setup();
    await active.pick("w1");
    active.setColour(1, "#123456");
    await active.pick("w1");
    expect(active.state().palette).toEqual(["#000000", "#ffffff"]);
  });

  it("drops a colour while a pick is pending: no setProfile, no reason", async () => {
    let release!: () => void;
    const { active, setProfile } = setup();
    setProfile.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const picking = active.pick("w1");
    await vi.waitFor(() => expect(setProfile).toHaveBeenCalledTimes(1));
    active.setColour(1, "#123456");
    active.resetColour(1);
    expect(setProfile).toHaveBeenCalledTimes(1);
    release();
    await picking;
    expect(active.state().reason).toBeNull();
    expect(active.state().palette).toEqual(["#000000", "#ffffff"]);
    active.setColour(1, "#123456"); // and takes colours again once the pick is done
    expect(setProfile).toHaveBeenCalledTimes(2);
  });

  it("ignores a slot outside the palette", async () => {
    const { active, setProfile } = setup();
    await active.pick("w1");
    setProfile.mockClear();
    active.setColour(5, "#123456");
    active.resetColour(5);
    expect(setProfile).not.toHaveBeenCalled();
  });

  it("notifies on a colour change", async () => {
    const { active } = setup();
    const listener = vi.fn();
    active.subscribe(listener);
    active.setColour(0, "#111111");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// B-03 T9 (spec AC11, AC12, SD8; plan PD8): the guard's reason, kept apart from the list and
// pick reasons; a pick retries custom effects the guard turned off.
describe("the guard's reason (B-03)", () => {
  const SLOW =
    "custom effects are off: this look is too heavy for this GPU; pick the profile again to retry";
  const LOST_CUSTOM =
    "the graphics context was lost and restored; custom effects are off; pick the profile again to retry";
  const LOST = "the graphics context was lost and restored";

  it("names each guard event", () => {
    const { active } = setup();
    active.guard({ kind: "slow", customBypassed: true });
    expect(active.state().reason).toBe(SLOW);
    active.guard({ kind: "contextLost", customBypassed: true });
    expect(active.state().reason).toBe(LOST_CUSTOM);
    active.guard({ kind: "contextLost", customBypassed: false });
    expect(active.state().reason).toBe(LOST);
  });

  it("survives opening the panel", async () => {
    const { active } = setup();
    await active.open();
    active.guard({ kind: "slow", customBypassed: true });
    await active.open();
    expect(active.state().reason).toBe(SLOW);
  });

  it("gives way to a pick's own reason, and clears on a successful pick", async () => {
    const { active, setProfile } = setup();
    await active.open();
    active.guard({ kind: "slow", customBypassed: true });
    setProfile.mockRejectedValueOnce(new Error("did not link"));
    await active.pick("w1");
    expect(active.state().reason).toMatch(/could not be prepared/);
    await active.pick("c1");
    expect(active.state().reason).toBeNull();
  });

  it("asks the engine to retry on a pick, never on a live colour", async () => {
    const { active, setProfile } = setup();
    await active.open();
    await active.pick("w1");
    expect(setProfile.mock.calls.at(-1)![1]).toEqual({ retry: true });
    active.setColour(0, "#123456");
    expect(setProfile.mock.calls.at(-1)![0].palette[0]).toBe("#123456");
    expect(setProfile.mock.calls.at(-1)![1]).toBeUndefined();
  });
});
