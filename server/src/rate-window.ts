// A per-key sliding window in memory (B-12 PD11), lifted out of the pairing throttle (B-04 SD19):
// `limit` records within `windowMs` block the key for `blockMs` from the record that reached the
// limit, and the count starts afresh. Two users: the wrong-code throttle and the cloud's token
// guard. A restart forgets everything.

export interface RateWindowOptions {
  limit: number;
  windowMs: number;
  blockMs: number;
  now(): number;
}

export interface RateWindow {
  /** Whether `key` is blocked now; an ended block is forgotten here. */
  blocked(key: string): boolean;
  /** Records one hit for `key`; the `limit`-th within the window starts its block. */
  record(key: string): void;
  clear(): void;
}

export function createRateWindow({ limit, windowMs, blockMs, now }: RateWindowOptions): RateWindow {
  const hits = new Map<string, number[]>();
  const blockedUntil = new Map<string, number>();
  return {
    blocked(key) {
      const until = blockedUntil.get(key);
      if (until === undefined) return false;
      if (now() < until) return true;
      blockedUntil.delete(key);
      return false;
    },
    record(key) {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((t) => at - t < windowMs);
      recent.push(at);
      if (recent.length >= limit) {
        blockedUntil.set(key, at + blockMs);
        hits.delete(key);
      } else {
        hits.set(key, recent);
      }
    },
    clear() {
      hits.clear();
      blockedUntil.clear();
    },
  };
}
