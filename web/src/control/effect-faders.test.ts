// B-18 T3 (spec SD8, SD10, SD11, AC8, AC9, AC10): which effects get a fader where, and that an
// effect fader's sends go through the page's budget under `effect:<index>`.
import type { EffectEntry } from "@djv/shared";
import { describe, expect, it } from "vitest";
import { createSendBudget } from "./send-budget.ts";
import { effectFader, placeEffects } from "./effect-faders.ts";

const entry = (index: number, dj: boolean, vj: boolean, name = `fx ${index}`): EffectEntry => ({
  index,
  name,
  stored: 0.25,
  value: 0.5,
  dj,
  vj,
});

describe("placeEffects (SD8, AC8, AC9)", () => {
  it("places nothing for a profile without ticks (AC4)", () => {
    expect(placeEffects([], "dj")).toEqual({ bank: null, section: [] });
    expect(placeEffects([], "vj")).toEqual({ bank: null, section: [] });
  });

  it("puts the DJ-ticked effect in the bank in both modes, and no section in DJ mode", () => {
    const effects = [entry(1, false, true), entry(3, true, false), entry(5, false, true)];
    expect(placeEffects(effects, "dj")).toEqual({ bank: effects[1], section: [] });
    expect(placeEffects(effects, "vj").bank).toEqual(effects[1]);
  });

  it("lists the VJ-ticked effects in the section in VJ mode, in stack order", () => {
    const effects = [entry(0, false, true), entry(2, false, true), entry(7, false, true)];
    expect(placeEffects(effects, "vj")).toEqual({ bank: null, section: effects });
    expect(placeEffects(effects, "dj")).toEqual({ bank: null, section: [] });
  });

  it("shows an effect ticked both once, in the bank", () => {
    const both = entry(2, true, true);
    const effects = [entry(0, false, true), both, entry(4, false, true)];
    const placed = placeEffects(effects, "vj");
    expect(placed.bank).toEqual(both);
    expect(placed.section.map((e) => e.index)).toEqual([0, 4]);
  });
});

describe("effectFader (SD10, SD11, AC10)", () => {
  function rig() {
    let clock = 0;
    let timers: { due: number; fn: () => void }[] = [];
    const budget = createSendBudget({
      now: () => clock,
      setTimer: (fn, ms) => timers.push({ due: clock + ms, fn }),
      clearTimer: () => {},
    });
    const keys: string[] = [];
    const sent: unknown[] = [];
    const value = (key: string, send: () => unknown) => {
      keys.push(key);
      budget.value(key, () => send() !== null);
    };
    const advance = (ms: number) => {
      clock += ms;
      for (const t of timers.filter((t) => t.due <= clock)) t.fn();
      timers = timers.filter((t) => t.due > clock);
    };
    return { value, keys, sent, advance, send: (m: unknown) => (sent.push(m), 1) };
  }

  it("is labelled with the name, shows the value and marks the stored value", () => {
    const r = rig();
    const fader = effectFader(entry(4, true, false, "Swirl"), "w1", r.value, r.send);
    expect(fader).toMatchObject({
      testId: "effect-4",
      label: "Swirl",
      value: 0.5,
      mark: 0.25,
      layout: "w1",
    });
  });

  it("sends effect with the profile, index and value under the key effect:<index>", () => {
    const r = rig();
    const fader = effectFader(entry(4, true, false), "w1", r.value, r.send);
    fader.onSend(0.7);
    expect(r.keys).toEqual(["effect:4"]);
    expect(r.sent).toEqual([{ type: "effect", profile: "w1", index: 4, value: 0.7 }]);
  });

  it("keeps only the newest waiting value, and always sends the last", () => {
    const r = rig();
    const fader = effectFader(entry(2, false, true), "w1", r.value, r.send);
    fader.onSend(0.1); // goes at once
    fader.onSend(0.2); // waits for the budget's gap
    fader.onSend(0.3); // replaces it
    r.advance(100);
    expect(r.sent).toEqual([
      { type: "effect", profile: "w1", index: 2, value: 0.1 },
      { type: "effect", profile: "w1", index: 2, value: 0.3 },
    ]);
  });
});
