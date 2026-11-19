// B-12 T10 (PD19, AC6, AC9, AC10, AC17): when a sync runs. Injected timers and a run whose
// answer each test decides, so every rule is checked without a clock or a cloud.
import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createScheduler, type Scheduler, type Timers } from "./scheduler.ts";
import type { SyncOutcome, SyncResult } from "./sync.ts";

interface Pending {
  at: number;
  fn: () => void;
  id: number;
}

let now: number;
let timers: Pending[];
let nextId: number;
let runs: { mayContinue: () => boolean; finish(outcome: SyncOutcome): void }[];
let scheduler: Scheduler;

const fakeTimers: Timers = {
  set(fn, ms) {
    nextId += 1;
    timers.push({ at: now + ms, fn, id: nextId });
    return nextId;
  },
  clear(handle) {
    timers = timers.filter((t) => t.id !== handle);
  },
};

/** Moves the clock on, firing every timer that comes due, in order. */
async function advance(ms: number) {
  const end = now + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    timers = timers.filter((t) => t !== due);
    now = due.at;
    due.fn();
    await settle();
  }
  now = end;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const result = (outcome: SyncOutcome): SyncResult => ({
  outcome,
  pulled: 0,
  pushed: 0,
  conflicts: 0,
});

/** Finishes the run in flight. */
async function finish(outcome: SyncOutcome = "done") {
  runs.at(-1)!.finish(outcome);
  await settle();
  await settle();
}

beforeEach(() => {
  now = 0;
  timers = [];
  nextId = 0;
  runs = [];
  scheduler = createScheduler({
    run: (mayContinue) =>
      new Promise<SyncResult>((resolve) => {
        runs.push({ mayContinue, finish: (outcome) => resolve(result(outcome)) });
      }),
    timers: fakeTimers,
    now: () => now,
    log: pino({ level: "silent" }),
  });
});

describe("triggers (PD19)", () => {
  it("runs at start, once", async () => {
    scheduler.start();
    await settle();
    expect(runs).toHaveLength(1);
  });

  it("runs 2 s after the last write, within AC6's 10 s", async () => {
    scheduler.start();
    await finish();
    scheduler.wrote();
    await advance(1000);
    scheduler.wrote();
    await advance(1999);
    expect(runs).toHaveLength(1);
    await advance(1);
    expect(runs).toHaveLength(2);
  });

  it("a trigger during a run gives exactly one more run after it", async () => {
    scheduler.start();
    scheduler.wrote();
    await advance(2000);
    scheduler.wrote();
    await advance(2000);
    expect(runs).toHaveLength(1);
    await finish();
    expect(runs).toHaveLength(2);
    await finish();
    expect(runs).toHaveLength(2);
  });

  it("does nothing before start and after stop", async () => {
    scheduler.wrote();
    await advance(10_000);
    expect(runs).toHaveLength(0);
    scheduler.start();
    await finish();
    scheduler.stop();
    scheduler.wrote();
    await advance(10_000);
    expect(runs).toHaveLength(1);
  });
});

describe("retries (AC17)", () => {
  it("retry at 5, 10, 20 s after failures, capped at 300 s; a success resets", async () => {
    scheduler.start();
    const gaps: number[] = [];
    let last = now;
    for (let i = 0; i < 8; i += 1) {
      await finish("offline");
      const before = runs.length;
      while (runs.length === before) await advance(1000);
      gaps.push(now - last);
      last = now;
    }
    expect(gaps).toEqual([5000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
    await finish("done");
    expect(scheduler.status().offline).toBe(false);
    scheduler.wrote();
    await advance(2000);
    await finish("offline");
    const before = runs.length;
    await advance(5000);
    expect(runs.length).toBe(before + 1);
  });

  it("is offline after a failed run until a good one", async () => {
    scheduler.start();
    await finish("offline");
    expect(scheduler.status()).toMatchObject({ offline: true, lastSyncAt: null });
    await advance(5000);
    now = Date.parse("2026-11-17T10:00:00.000Z");
    await finish("done");
    expect(scheduler.status()).toMatchObject({
      offline: false,
      lastSyncAt: "2026-11-17T10:00:00.000Z",
    });
  });

  it("does not retry a signed-out run", async () => {
    scheduler.start();
    await finish("signed_out");
    await advance(600_000);
    expect(runs).toHaveLength(1);
  });
});

describe("the set pause (AC9, AC10, SD2)", () => {
  it("a set starting mid-run lets the current request finish and asks for no other", async () => {
    scheduler.start();
    await settle();
    expect(runs[0]!.mayContinue()).toBe(true);
    scheduler.setRunning(true);
    expect(runs[0]!.mayContinue()).toBe(false);
  });

  it("while running: Sync now is refused, and no write or timer starts a run", async () => {
    scheduler.start();
    await finish("offline"); // a retry is due in 5 s
    scheduler.setRunning(true);
    expect(await scheduler.syncNow()).toEqual({ refused: true });
    scheduler.wrote();
    await advance(600_000);
    expect(runs).toHaveLength(1);
    expect(scheduler.status().paused).toBe(true);
  });

  it("the end of the set runs at once", async () => {
    scheduler.start();
    await finish();
    scheduler.setRunning(true);
    scheduler.wrote();
    await advance(10_000);
    expect(runs).toHaveLength(1);
    scheduler.setRunning(false);
    await settle();
    expect(runs).toHaveLength(2);
  });
});

describe("Sync now and close", () => {
  it("Sync now runs and answers with that run's result", async () => {
    scheduler.start();
    await finish();
    const answer = scheduler.syncNow();
    await settle();
    expect(runs).toHaveLength(2);
    await finish("done");
    expect(await answer).toEqual({ refused: false, result: result("done") });
  });

  it("Sync now during a run waits for the one after it", async () => {
    scheduler.start();
    await settle();
    const answer = scheduler.syncNow();
    await finish("done");
    expect(runs).toHaveLength(2);
    await finish("offline");
    expect(await answer).toEqual({ refused: false, result: result("offline") });
  });

  it("close cancels every timer and waits for the run in flight", async () => {
    scheduler.start();
    await finish("offline");
    scheduler.wrote();
    await advance(5000);
    let closed = false;
    const closing = scheduler.close().then(() => (closed = true));
    await settle();
    expect(closed).toBe(false);
    await finish();
    await closing;
    expect(timers).toEqual([]);
    expect(runs).toHaveLength(2);
  });
});
