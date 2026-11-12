// T4 (spec SD15, AC10; plan PD21): the latency window behind the overlay's last / p95 / worst.
import { describe, expect, it } from "vitest";
import { createLatencyWindow } from "./latency.ts";

describe("latency window (SD15)", () => {
  it("reads zeros with no samples", () => {
    expect(createLatencyWindow().read(1000)).toEqual({ last: 0, p95: 0, worst: 0, samples: 0 });
  });

  it("reads last, nearest-rank p95 and worst over 100 samples", () => {
    const w = createLatencyWindow();
    // 1..100 ms in a shuffled order (37 is coprime with 100), recorded 10 ms apart.
    const values = Array.from({ length: 100 }, (_, i) => ((i * 37) % 100) + 1);
    values.forEach((v, i) => w.record(v, i * 10));
    expect(values.at(-1)).toBe(64);
    expect(w.read(1000)).toEqual({ last: 64, p95: 95, worst: 100, samples: 100 });
  });

  it("evicts samples older than the window", () => {
    const w = createLatencyWindow(10_000);
    w.record(80, 0);
    w.record(20, 5000);
    expect(w.read(9999)).toMatchObject({ worst: 80, samples: 2 });
    expect(w.read(10_001)).toEqual({ last: 20, p95: 20, worst: 20, samples: 1 });
    expect(w.read(20_000)).toEqual({ last: 0, p95: 0, worst: 0, samples: 0 });
  });

  it("stays bounded to the window however long nobody reads it", () => {
    const w = createLatencyWindow(10_000);
    for (let i = 0; i < 100_000; i++) w.record(10, i * 8);
    expect(w.size()).toBeLessThanOrEqual(1251);
  });
});

describe("recording once per window of audio (PD21)", () => {
  it("frames repeating the same capturedAt add one sample, not one per frame", () => {
    const w = createLatencyWindow();
    for (let frame = 0; frame < 10; frame++) w.recordFrame(1000, 1010 + frame * 16);
    expect(w.read(1200)).toEqual({ last: 10, p95: 10, worst: 10, samples: 1 });
    w.recordFrame(1008, 1030);
    expect(w.read(1200)).toMatchObject({ last: 22, samples: 2 });
  });

  it("records nothing for features that never had a capture time", () => {
    const w = createLatencyWindow();
    w.recordFrame(0, 500);
    w.recordFrame(0, 516);
    expect(w.read(600).samples).toBe(0);
  });
});
