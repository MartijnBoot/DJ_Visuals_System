// T10 (B-06 spec SD3, SD11; plan PD15): the network leg from one `getStats()` report and the one
// before it — the selected pair's round trip / 2 plus the jitter-buffer delay per emitted sample.
import { describe, expect, it } from "vitest";
import { legMs, type LegSample } from "./stats.ts";

type Entry = Record<string, unknown> & { id: string; type: string };
const report = (...entries: Entry[]) => new Map(entries.map((e) => [e.id, e]));

const transport = (pair = "CP1"): Entry => ({
  id: "T1",
  type: "transport",
  selectedCandidatePairId: pair,
});
const pair = (id: string, rtt: number | undefined, extra: Record<string, unknown> = {}): Entry => ({
  id,
  type: "candidate-pair",
  ...(rtt === undefined ? {} : { currentRoundTripTime: rtt }),
  ...extra,
});
const inbound = (kind: "audio" | "video", delay: number, emitted: number): Entry => ({
  id: `IN-${kind}`,
  type: "inbound-rtp",
  kind,
  jitterBufferDelay: delay,
  jitterBufferEmittedCount: emitted,
});

describe("legMs (PD15)", () => {
  it("RTT 0.02 s and 4.8 s of delay over 480 samples is 20 ms", () => {
    const r = report(transport(), pair("CP1", 0.02), inbound("audio", 4.8, 480));
    expect(legMs(null, r, "audio").ms).toBeCloseTo(20, 9);
  });

  it("takes the change since the previous sample", () => {
    const first = legMs(
      null,
      report(transport(), pair("CP1", 0.01), inbound("audio", 1, 100)),
      "audio",
    );
    const second = legMs(
      first.sample,
      report(transport(), pair("CP1", 0.01), inbound("audio", 1 + 0.06, 100 + 2)),
      "audio",
    );
    // 5 ms + 0.06 s / 2 samples = 5 + 30
    expect(second.ms).toBeCloseTo(35, 9);
    expect(second.sample).toEqual<LegSample>({ delay: 1.06, emitted: 102 });
  });

  it("no emitted sample since the previous → null", () => {
    const prev: LegSample = { delay: 1, emitted: 100 };
    const r = report(transport(), pair("CP1", 0.02), inbound("audio", 1, 100));
    expect(legMs(prev, r, "audio").ms).toBeNull();
    expect(
      legMs(null, report(transport(), pair("CP1", 0.02), inbound("audio", 0, 0)), "audio").ms,
    ).toBeNull();
  });

  it("reads the inbound stream of the kind asked for", () => {
    const r = report(
      transport(),
      pair("CP1", 0.02),
      inbound("audio", 4.8, 480),
      inbound("video", 3, 30),
    );
    expect(legMs(null, r, "video").ms).toBeCloseTo(110, 9);
  });

  it("finds the pair by selected or nominated-and-succeeded when no transport names one", () => {
    const bySelected = report(
      pair("CPx", 0.5),
      pair("CP2", 0.02, { selected: true }),
      inbound("audio", 4.8, 480),
    );
    expect(legMs(null, bySelected, "audio").ms).toBeCloseTo(20, 9);
    const byNominated = report(
      pair("CPx", 0.5, { state: "failed" }),
      pair("CP3", 0.02, { nominated: true, state: "succeeded" }),
      inbound("audio", 4.8, 480),
    );
    expect(legMs(null, byNominated, "audio").ms).toBeCloseTo(20, 9);
  });

  it("without a round trip or an inbound stream is null", () => {
    expect(
      legMs(null, report(transport(), pair("CP1", undefined), inbound("audio", 4.8, 480)), "audio")
        .ms,
    ).toBeNull();
    expect(legMs(null, report(transport(), pair("CP1", 0.02)), "audio").ms).toBeNull();
    expect(legMs(null, report(), "audio").ms).toBeNull();
  });
});
