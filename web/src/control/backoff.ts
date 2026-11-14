// The reconnect delays (B-04 spec SD12, AC27; plan PD17): 0.5 s doubling to at most 5 s, reset
// by a successful connect. One helper for the controller's link (`device-link.ts`) and the screen
// page's (`screen-link.ts`).

export const FIRST_DELAY_MS = 500;
export const MAX_DELAY_MS = 5000;

export interface Backoff {
  /** The wait before the next attempt; each call doubles the next, up to the maximum. */
  next(): number;
  reset(): void;
}

export function createBackoff(): Backoff {
  let attempts = 0;
  return {
    next() {
      const delay = Math.min(FIRST_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
      attempts = Math.min(attempts + 1, 16);
      return delay;
    },
    reset() {
      attempts = 0;
    },
  };
}
