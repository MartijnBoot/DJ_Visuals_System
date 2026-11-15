// T11 (B-04 spec SD12, AC27; plan PD17): one reconnect delay sequence for the controller and the
// screen page.
import { describe, expect, it } from "vitest";
import { createBackoff } from "./backoff.ts";

describe("backoff", () => {
  it("waits 0.5 s doubling to at most 5 s", () => {
    const backoff = createBackoff();
    const delays = Array.from({ length: 7 }, () => backoff.next());
    expect(delays).toEqual([500, 1000, 2000, 4000, 5000, 5000, 5000]);
  });

  it("starts again at 0.5 s after a successful connect", () => {
    const backoff = createBackoff();
    backoff.next();
    backoff.next();
    backoff.reset();
    expect(backoff.next()).toBe(500);
  });
});
