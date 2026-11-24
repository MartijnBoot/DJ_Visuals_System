// The controller page's one send budget (B-16 spec SD4, SD8, SD11; plan PD3, PD4, PD5): a
// page-wide queue between the controls and `link.send`. At most 100 messages in any 1000 ms and at
// least 10 ms between two, counted from the moment the previous send returned. Each control keeps
// only its newest unsent value, which replaces the waiting one in place and so keeps its turn; taps
// are appended and never replaced. An empty queue with a free budget sends at once, synchronously,
// so a single drag (16 or 20 ms apart) never waits and sends exactly as before. A `put` that
// reports the link is no longer live drops everything waiting, and so does `drop()` (a lock): a
// queued value is never sent late. The browser's clock and timer are injected, as for the throttle.

export const BUDGET_GAP_MS = 10;
export const BUDGET_PER_WINDOW = 100;
export const BUDGET_WINDOW_MS = 1000;

export interface BudgetDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
}

/** Sends one message; true when it went out, false when the link is no longer live. */
export type Put = () => boolean;

export interface SendBudget {
  /** The newest value of one control (PD5's key); replaces that control's waiting value. */
  value(key: string, put: Put): void;
  /** A tap: appended, never replaced. */
  tap(put: Put): void;
  /** The link locked or the page went away: everything waiting is forgotten. */
  drop(): void;
}

interface Waiting {
  key: string | null;
  put: Put;
}

export function createSendBudget(deps: BudgetDeps): SendBudget {
  let queue: Waiting[] = [];
  /** When the last sends returned, oldest first; at most BUDGET_PER_WINDOW kept. */
  const sends: number[] = [];
  let timer: number | null = null;
  let pumping = false;

  const earliest = (): number => {
    const afterGap = sends.length > 0 ? sends[sends.length - 1]! + BUDGET_GAP_MS : -Infinity;
    const afterWindow =
      sends.length >= BUDGET_PER_WINDOW ? sends[0]! + BUDGET_WINDOW_MS : -Infinity;
    return Math.max(afterGap, afterWindow);
  };

  const drop = () => {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    queue = [];
  };

  const pump = () => {
    if (pumping || timer !== null) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const wait = earliest() - deps.now();
        if (wait > 0) {
          timer = deps.setTimer(() => {
            timer = null;
            pump();
          }, wait);
          return;
        }
        const head = queue.shift()!;
        if (!head.put()) {
          drop();
          return;
        }
        sends.push(deps.now());
        if (sends.length > BUDGET_PER_WINDOW) sends.shift();
      }
    } finally {
      pumping = false;
    }
  };

  return {
    value(key, put) {
      const waiting = queue.find((w) => w.key === key);
      if (waiting) waiting.put = put;
      else queue.push({ key, put });
      pump();
    },
    tap(put) {
      queue.push({ key: null, put });
      pump();
    },
    drop,
  };
}
