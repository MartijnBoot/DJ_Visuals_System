// T11 (B-04 spec SD17, AC43): the round trip from sending a change to the screen page's
// acknowledgement of the frame that applied it, last and p95 over 10 s.
import { describe, expect, it } from "vitest";
import { createRoundTrip } from "./round-trip.ts";

describe("round trip (AC43)", () => {
  it("is empty before any acknowledgement", () => {
    expect(createRoundTrip().read(0)).toEqual({ last: 0, p95: 0, samples: 0 });
  });

  it("times each acknowledged change from its send", () => {
    const trip = createRoundTrip();
    trip.sent(1, 1000);
    trip.sent(2, 1010);
    trip.applied(2, 1040);
    trip.applied(1, 1050);
    expect(trip.read(1050)).toEqual({ last: 50, p95: 50, samples: 2 });
  });

  it("gives the nearest-rank p95 of a known sample set", () => {
    const trip = createRoundTrip();
    // Twenty changes taking 1..20 ms: p95 is the 19th smallest.
    for (let i = 1; i <= 20; i++) {
      trip.sent(i, i * 100);
      trip.applied(i, i * 100 + i);
    }
    expect(trip.read(2020)).toEqual({ last: 20, p95: 19, samples: 20 });
  });

  it("keeps 10 s of samples", () => {
    const trip = createRoundTrip();
    trip.sent(1, 0);
    trip.applied(1, 30);
    trip.sent(2, 5000);
    trip.applied(2, 5010);
    expect(trip.read(10_029).samples).toBe(2);
    expect(trip.read(10_030)).toEqual({ last: 10, p95: 10, samples: 1 });
  });

  it("ignores an acknowledgement for a change it never sent, or twice", () => {
    const trip = createRoundTrip();
    trip.applied(9, 100);
    trip.sent(1, 0);
    trip.applied(1, 20);
    trip.applied(1, 90);
    expect(trip.read(100)).toEqual({ last: 20, p95: 20, samples: 1 });
  });

  it("forgets sends never acknowledged after 10 s, so it stays bounded", () => {
    const trip = createRoundTrip();
    for (let i = 0; i < 5000; i++) trip.sent(i, i);
    trip.sent(9999, 20_000);
    expect(trip.outstanding()).toBe(1);
  });
});
