// B-12 T5 (PD11): the per-key sliding window, lifted out of the pairing throttle.
import { describe, expect, it } from "vitest";
import { createRateWindow } from "./rate-window.ts";

function make(limit = 3, windowMs = 60_000, blockMs = 60_000) {
  let now = 0;
  const window = createRateWindow({ limit, windowMs, blockMs, now: () => now });
  return { window, at: (t: number) => (now = t) };
}

describe("createRateWindow", () => {
  it("blocks a key for blockMs once `limit` records fall within windowMs", () => {
    const { window, at } = make();
    window.record("a");
    at(10_000);
    window.record("a");
    expect(window.blocked("a")).toBe(false);
    at(20_000);
    window.record("a");
    expect(window.blocked("a")).toBe(true);
    at(79_999);
    expect(window.blocked("a")).toBe(true);
    at(80_000);
    expect(window.blocked("a")).toBe(false);
  });

  it("lets an older record fall out of the window", () => {
    const { window, at } = make();
    window.record("a");
    at(30_000);
    window.record("a");
    at(60_000); // the first is exactly windowMs old: out
    window.record("a");
    expect(window.blocked("a")).toBe(false);
    at(60_001);
    window.record("a");
    expect(window.blocked("a")).toBe(true);
  });

  it("starts counting afresh after a block ends", () => {
    const { window, at } = make();
    for (let i = 0; i < 3; i += 1) window.record("a");
    at(60_000);
    expect(window.blocked("a")).toBe(false);
    window.record("a");
    window.record("a");
    expect(window.blocked("a")).toBe(false);
  });

  it("keeps keys independent", () => {
    const { window } = make();
    for (let i = 0; i < 3; i += 1) window.record("a");
    window.record("b");
    expect(window.blocked("a")).toBe(true);
    expect(window.blocked("b")).toBe(false);
  });

  it("clear() forgets records and blocks", () => {
    const { window } = make();
    for (let i = 0; i < 3; i += 1) window.record("a");
    window.record("b");
    window.record("b");
    window.clear();
    expect(window.blocked("a")).toBe(false);
    window.record("b");
    expect(window.blocked("b")).toBe(false);
  });
});
