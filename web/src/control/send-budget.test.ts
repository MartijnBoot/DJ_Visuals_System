import { describe, expect, it } from "vitest";
import {
  BUDGET_GAP_MS,
  BUDGET_PER_WINDOW,
  BUDGET_WINDOW_MS,
  createSendBudget,
} from "./send-budget.ts";

// B-16 plan T1: the budget's rules with a fake clock and a manual timer (SD4, PD4, PD5).

interface Sent {
  what: string;
  at: number;
}

function rig(options: { sendTakesMs?: number } = {}) {
  let clock = 0;
  let nextId = 1;
  let timers: { id: number; due: number; fn: () => void }[] = [];
  const cleared: number[] = [];
  const sent: Sent[] = [];
  const budget = createSendBudget({
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, due: clock + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      cleared.push(id);
      timers = timers.filter((t) => t.id !== id);
    },
  });
  /** A `put` that records what went out and when, and reports the link live. */
  const put =
    (what: string, live = true) =>
    () => {
      if (!live) return false;
      sent.push({ what, at: clock });
      clock += options.sendTakesMs ?? 0;
      return true;
    };
  /** Moves the clock forward `ms`, 1 ms at a time, firing every timer that falls due. */
  const advance = (ms: number) => {
    const end = clock + ms;
    while (clock < end) {
      clock = Math.min(end, clock + 1);
      fireDue();
    }
  };
  const fireDue = () => {
    for (;;) {
      const due = timers.filter((t) => t.due <= clock).sort((a, b) => a.due - b.due)[0];
      if (!due) return;
      timers = timers.filter((t) => t !== due);
      due.fn();
    }
  };
  return {
    budget,
    put,
    advance,
    sent,
    cleared,
    timers: () => timers,
    now: () => clock,
    set: (t: number) => {
      clock = t;
    },
  };
}

/** Every gap at least 10 ms, and no 1000 ms window holding more than 100 sends. */
function expectWithinBudget(sent: readonly Sent[]) {
  for (let i = 1; i < sent.length; i++) {
    expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(BUDGET_GAP_MS);
  }
  for (let i = 0; i < sent.length; i++) {
    const inWindow = sent.filter(
      (s) => s.at >= sent[i]!.at && s.at < sent[i]!.at + BUDGET_WINDOW_MS,
    ).length;
    expect(inWindow).toBeLessThanOrEqual(BUDGET_PER_WINDOW);
  }
}

describe("the send budget (B-16 SD4, PD4)", () => {
  it("an empty budget sends at once, synchronously", () => {
    const { budget, put, sent } = rig();
    budget.tap(put("pick"));
    expect(sent).toEqual([{ what: "pick", at: 0 }]);
    budget.value("dials:recognisability", put("dial"));
    // 0 ms after the last send: this one waits for the gap.
    expect(sent).toHaveLength(1);
  });

  it.each([
    ["the disc", "colour:0", 16],
    ["a fader", "dials:recognisability", 20],
    ["the duration", "transition:duration", 100],
  ])("%s alone (every %s ms) never waits: each value goes out as it is given", (_, key, gap) => {
    const { budget, put, advance, sent } = rig();
    for (let i = 0; i < 3000 / gap; i++) {
      budget.value(key, put(`${key}=${i}`));
      expect(sent).toHaveLength(i + 1); // synchronously, before the next tick
      advance(gap);
    }
  });

  it("3 controls at 16, 20 and 20 ms for 3 s: ≤ 100 in every second, every gap ≥ 10 ms, each last value out", () => {
    const { budget, put, advance, sent } = rig();
    for (let t = 0; t < 3000; t++) {
      if (t % 16 === 0) budget.value("colour:0", put(`colour=${t}`));
      if (t % 20 === 0) budget.value("dials:recognisability", put(`rec=${t}`));
      if (t % 20 === 0) budget.value("dials:reactivity", put(`rea=${t}`));
      advance(1);
    }
    advance(1000);
    // 162 offered a second, so the budget did make them wait.
    expect(sent.length).toBeLessThan(162 * 3);
    expect(sent.length).toBeGreaterThanOrEqual(290);
    expectWithinBudget(sent);
    const last = (prefix: string) => sent.filter((s) => s.what.startsWith(prefix)).at(-1)?.what;
    expect(last("colour=")).toBe("colour=2992");
    expect(last("rec=")).toBe("rec=2980");
    expect(last("rea=")).toBe("rea=2980");
  });

  it("a replaced value keeps its turn, and only the newest of a control goes out", () => {
    const { budget, put, advance, sent } = rig();
    budget.tap(put("busy"));
    budget.value("a", put("a1"));
    budget.value("b", put("b1"));
    budget.value("a", put("a2"));
    budget.value("a", put("a3"));
    advance(100);
    expect(sent.map((s) => s.what)).toEqual(["busy", "a3", "b1"]);
  });

  it("a waiting control goes out within as many turns as there are controls waiting", () => {
    const { budget, put, advance, sent } = rig();
    budget.tap(put("busy"));
    budget.value("fast", put("fast0"));
    budget.value("b", put("b"));
    budget.value("slow", put("slow"));
    // The fast control replaces its value every millisecond and never starves the slow one.
    for (let t = 1; t <= 100; t++) {
      budget.value("fast", put(`fast${t}`));
      advance(1);
    }
    const order = sent.map((s) => s.what);
    expect(order.indexOf("slow")).toBeLessThanOrEqual(3);
    expect(order.slice(1, 4).map((w) => w.replace(/\d+$/, ""))).toEqual(["fast", "b", "slow"]);
  });

  it("taps are never replaced and keep their order among values", () => {
    const { budget, put, advance, sent } = rig();
    budget.tap(put("busy"));
    budget.tap(put("tap1"));
    budget.value("a", put("a1"));
    budget.tap(put("tap2"));
    budget.value("a", put("a2"));
    budget.tap(put("tap2"));
    advance(100);
    expect(sent.map((s) => s.what)).toEqual(["busy", "tap1", "a2", "tap2", "tap2"]);
  });

  it("drop() cancels the timer, and nothing waiting goes out afterwards", () => {
    const { budget, put, advance, sent, cleared, timers } = rig();
    budget.tap(put("busy"));
    budget.value("a", put("a"));
    budget.tap(put("t"));
    expect(timers()).toHaveLength(1);
    const id = timers()[0]!.id;
    budget.drop();
    expect(cleared).toEqual([id]);
    advance(2000);
    expect(sent.map((s) => s.what)).toEqual(["busy"]);
    // The budget still works for what comes after.
    budget.tap(put("after"));
    expect(sent.map((s) => s.what)).toEqual(["busy", "after"]);
  });

  it("a put reporting the link gone drops everything waiting", () => {
    const { budget, put, advance, sent } = rig();
    budget.tap(put("busy"));
    budget.value("a", put("a", false));
    budget.value("b", put("b"));
    budget.tap(put("t"));
    advance(2000);
    expect(sent.map((s) => s.what)).toEqual(["busy"]);
  });

  it("counts the gap from the moment put returns", () => {
    const { budget, put, advance, sent } = rig({ sendTakesMs: 7 });
    budget.tap(put("first")); // goes at 0, returns at 7
    budget.tap(put("second"));
    advance(30);
    expect(sent.map((s) => s.at)).toEqual([0, 17]);
  });

  it("a full window (100 sends, 0 … 990 ms) holds the 101st back until 1000 ms", () => {
    const { budget, put, advance, sent, set } = rig();
    for (let i = 0; i < BUDGET_PER_WINDOW; i++) {
      set(i * BUDGET_GAP_MS);
      budget.tap(put(`t${i}`));
    }
    expect(sent).toHaveLength(BUDGET_PER_WINDOW);
    set(995);
    budget.tap(put("over"));
    expect(sent).toHaveLength(BUDGET_PER_WINDOW);
    advance(10);
    expect(sent.at(-1)).toEqual({ what: "over", at: BUDGET_WINDOW_MS });
    expectWithinBudget(sent);
  });
});
