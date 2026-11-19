// When a sync runs on a connected local install (B-12 SD2, AC6, AC9, AC10, AC17; plan PD19).
// One run in flight; a trigger during a run asks for exactly one more after it. Triggers: start
// (boot or a connect), 2 s after the last profile write, the end of a set, "Sync now" and each
// retry. A failed run retries at 5 s, doubling to 5 min, until a good one resets it. While a set
// runs nothing starts, the run in flight makes no further request, and "Sync now" is refused.
// Timers and the clock are injected; nothing here touches the network itself.
import type { Logger } from "../log.ts";
import type { SyncResult } from "./sync.ts";

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SchedulerDeps {
  /** One sync run; `mayContinue` is asked before each of its requests. */
  run(mayContinue: () => boolean): Promise<SyncResult>;
  timers: Timers;
  now(): number;
  log: Pick<Logger, "info">;
}

export interface SchedulerStatus {
  syncing: boolean;
  paused: boolean;
  offline: boolean;
  lastSyncAt: string | null;
}

export interface Scheduler {
  /** Connected (at boot or after a connect): runs now and listens to triggers. */
  start(): void;
  /** Disconnected: no more runs; a run in flight stops before its next request. */
  stop(): void;
  /** A profile was written (AC6). */
  wrote(): void;
  /** The screen's `started` changed (SD2). */
  setRunning(running: boolean): void;
  /** "Sync now": refused while a set runs (AC10), else the result of the run it waited for. */
  syncNow(): Promise<{ refused: true } | { refused: false; result: SyncResult }>;
  status(): SchedulerStatus;
  /** Cancels every timer and waits for the run in flight. */
  close(): Promise<void>;
}

export const DEBOUNCE_MS = 2000;
const FIRST_RETRY_MS = 5000;
const MAX_RETRY_MS = 300_000;

export function createScheduler(deps: SchedulerDeps): Scheduler {
  let enabled = false;
  let running = false;
  let inFlight: Promise<SyncResult> | null = null;
  let again = false;
  let failures = 0;
  let offline = false;
  let lastSyncAt: string | null = null;
  let debounce: unknown = null;
  let retry: unknown = null;

  const clear = () => {
    if (debounce !== null) deps.timers.clear(debounce);
    if (retry !== null) deps.timers.clear(retry);
    debounce = null;
    retry = null;
  };

  const mayContinue = () => enabled && !running;

  const trigger = () => {
    if (!enabled || running) return; // the end of the set triggers again (setRunning)
    if (inFlight) {
      again = true;
      return;
    }
    begin();
  };

  const settle = (result: SyncResult) => {
    if (result.outcome === "done") {
      failures = 0;
      offline = false;
      lastSyncAt = new Date(deps.now()).toISOString();
    } else if (result.outcome === "offline" && enabled) {
      offline = true;
      const delay = Math.min(FIRST_RETRY_MS * 2 ** failures, MAX_RETRY_MS);
      failures += 1;
      retry = deps.timers.set(() => {
        retry = null;
        trigger();
      }, delay);
      deps.log.info({ retryInMs: delay }, "sync retry scheduled");
    }
  };

  function begin(): void {
    clear();
    inFlight = deps
      .run(mayContinue)
      .then((result) => {
        settle(result);
        return result;
      })
      .finally(() => {
        inFlight = null;
        if (again) {
          again = false;
          trigger();
        }
      });
  }

  /** Waits until no run is in flight; the last run's result. */
  async function idle(): Promise<SyncResult | null> {
    let last: SyncResult | null = null;
    while (inFlight) last = await inFlight;
    return last;
  }

  return {
    start() {
      enabled = true;
      trigger();
    },
    stop() {
      enabled = false;
      again = false;
      clear();
    },
    wrote() {
      if (!enabled) return;
      if (debounce !== null) deps.timers.clear(debounce);
      debounce = deps.timers.set(() => {
        debounce = null;
        trigger();
      }, DEBOUNCE_MS);
    },
    setRunning(next) {
      if (next === running) return;
      running = next;
      deps.log.info({ running }, running ? "sync paused: a set is running" : "sync resumed");
      if (!running) trigger();
    },
    async syncNow() {
      if (running) return { refused: true };
      if (!enabled) {
        return {
          refused: false,
          result: { outcome: "not_connected", pulled: 0, pushed: 0, conflicts: 0 },
        };
      }
      trigger();
      const result = await idle();
      return {
        refused: false,
        result: result ?? { outcome: "paused", pulled: 0, pushed: 0, conflicts: 0 },
      };
    },
    status: () => ({ syncing: inFlight !== null, paused: running, offline, lastSyncAt }),
    async close() {
      enabled = false;
      again = false;
      clear();
      await idle();
    },
  };
}
