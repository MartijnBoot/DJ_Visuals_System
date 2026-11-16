// The network leg of a remote source (B-06 spec SD3, SD11; plan PD15), from one `getStats()`
// report and the sample before it: the selected candidate pair's round trip / 2, plus the change
// in the receiver's jitter-buffer delay over the change in its emitted samples. Pure; the caller
// keeps the previous sample and feeds the result into a latency window.

export interface LegSample {
  /** `jitterBufferDelay`, seconds, cumulative. */
  delay: number;
  /** `jitterBufferEmittedCount`, cumulative. */
  emitted: number;
}

export interface Leg {
  /** Milliseconds, or null when this report adds no sample. */
  ms: number | null;
  /** What to pass as `previous` next time. */
  sample: LegSample | null;
}

/** The part of an `RTCStatsReport` read here. */
export type StatsLike = Pick<Map<string, unknown>, "values" | "get">;

type Stat = Record<string, unknown> & { type?: unknown };

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function selectedPair(report: StatsLike): Stat | undefined {
  const all = [...report.values()] as Stat[];
  for (const s of all) {
    if (s.type !== "transport" || typeof s.selectedCandidatePairId !== "string") continue;
    const pair = report.get(s.selectedCandidatePairId) as Stat | undefined;
    if (pair) return pair;
  }
  const pairs = all.filter((s) => s.type === "candidate-pair");
  return (
    pairs.find((p) => p.selected === true) ??
    pairs.find((p) => p.nominated === true && p.state === "succeeded")
  );
}

export function legMs(previous: LegSample | null, report: StatsLike, kind: "audio" | "video"): Leg {
  const inbound = ([...report.values()] as Stat[]).find(
    (s) => s.type === "inbound-rtp" && s.kind === kind,
  );
  const delay = num(inbound?.jitterBufferDelay);
  const emitted = num(inbound?.jitterBufferEmittedCount);
  if (delay === undefined || emitted === undefined) return { ms: null, sample: previous };
  const sample = { delay, emitted };
  const rtt = num(selectedPair(report)?.currentRoundTripTime);
  const count = emitted - (previous?.emitted ?? 0);
  if (rtt === undefined || count <= 0) return { ms: null, sample };
  const buffered = (delay - (previous?.delay ?? 0)) / count;
  return { ms: (rtt / 2 + buffered) * 1000, sample };
}
