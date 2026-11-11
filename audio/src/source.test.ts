// T2 (spec AC2, AC6, AC12; plan PD2, PD3): the main-thread feature source, against a
// hand-rolled fake AudioContext and AudioWorkletNode, so it runs in Node.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZERO_FEATURES } from "./features.ts";
import { createFeatureSource } from "./source.ts";

interface FakePort {
  onmessage: ((event: { data: unknown }) => void) | null;
  closed: boolean;
  close(): void;
}

class FakeNode {
  static created: FakeNode[] = [];
  port: FakePort = {
    onmessage: null,
    closed: false,
    close() {
      this.closed = true;
    },
  };
  disconnected = false;
  readonly name: string;
  readonly options: AudioWorkletNodeOptions;
  constructor(_context: unknown, name: string, options: AudioWorkletNodeOptions) {
    this.name = name;
    this.options = options;
    FakeNode.created.push(this);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** What the worklet would post at the end of a window. */
  post(data: unknown) {
    this.port.onmessage?.({ data });
  }
}

function fakeContext(baseLatency = 0.01, outputLatency = 0) {
  const input = {
    connectedTo: null as unknown,
    disconnected: false,
    connect(node: unknown) {
      this.connectedTo = node;
    },
    disconnect() {
      this.disconnected = true;
    },
  };
  const context = {
    baseLatency,
    outputLatency,
    audioWorklet: { addModule: vi.fn(async (_url: string) => {}) },
    createMediaStreamSource: vi.fn((_stream: MediaStream) => input),
    // Context time 0 s was performance time 1000 ms.
    getOutputTimestamp: vi.fn(() => ({ contextTime: 0, performanceTime: 1000 })),
  };
  return { context, input, asContext: context as unknown as AudioContext };
}

const stream = {} as MediaStream;
const frame = { level: 0.5, low: 0.9, mid: 0.2, high: 0.1, beat: 1, flux: 0.8, onset: true };

let now = 0;
beforeEach(() => {
  FakeNode.created = [];
  now = 1000;
  vi.stubGlobal("AudioWorkletNode", FakeNode);
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createFeatureSource", () => {
  it("loads the module once per context and wires stream → worklet with no outputs", async () => {
    const { context, input, asContext } = fakeContext();
    await createFeatureSource(asContext, stream, "/assets/processor.js");
    await createFeatureSource(asContext, stream, "/assets/processor.js");
    expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    expect(context.audioWorklet.addModule).toHaveBeenCalledWith("/assets/processor.js");
    const node = FakeNode.created[0]!;
    expect(node.name).toBe("djv-features");
    expect(node.options.numberOfOutputs).toBe(0);
    expect(context.createMediaStreamSource).toHaveBeenCalledWith(stream);
    expect(input.connectedTo).toBe(FakeNode.created[1]);
  });

  it("reads zero features before the first window", async () => {
    const { asContext } = fakeContext();
    const source = await createFeatureSource(asContext, stream, "u");
    expect(source.read(now)).toEqual(ZERO_FEATURES);
    expect(source.lastBlockAt()).toBe(0);
  });

  it("hands the newest window's features to read, with capturedAt on the performance clock", async () => {
    const { asContext } = fakeContext(0.01);
    const source = await createFeatureSource(asContext, stream, "u");
    const node = FakeNode.created[0]!;
    now = 1505;
    node.post({ frame: { ...frame, level: 0.1 }, contextTime: 0.49 });
    node.post({ frame, contextTime: 0.5 });
    expect(source.lastBlockAt()).toBe(1505);
    // 0.5 s of context time is heard at performance 1500 ms. The graph processed it
    // baseLatency + outputLatency (10 ms) earlier, and SD15 adds baseLatency (10 ms) once more.
    expect(source.read(1510)).toEqual({
      level: 0.5,
      low: 0.9,
      mid: 0.2,
      high: 0.1,
      beat: 1,
      capturedAt: 1480,
    });
  });

  it("puts capturedAt at the processing instant, before the output latency (PD2)", async () => {
    // getOutputTimestamp maps context time to when it is heard; the graph runs ahead of that
    // by baseLatency + outputLatency, so without both the sample lands in the future.
    const { asContext } = fakeContext(0.01, 0.05);
    const source = await createFeatureSource(asContext, stream, "u");
    FakeNode.created[0]!.post({ frame, contextTime: 0.5 });
    expect(source.read(now).capturedAt).toBeCloseTo(1500 - 60 - 10, 9);
  });

  it("ignores a message that is not a feature window", async () => {
    const { asContext } = fakeContext();
    const source = await createFeatureSource(asContext, stream, "u");
    const node = FakeNode.created[0]!;
    node.post({ frame, contextTime: 0.5 });
    node.post({ frame: { level: "loud" }, contextTime: 0.6 });
    node.post("hello");
    expect(source.read(now).capturedAt).toBeCloseTo(1480, 9);
  });

  it("refreshes the clock map from getOutputTimestamp once a second", async () => {
    const { context, asContext } = fakeContext(0);
    const source = await createFeatureSource(asContext, stream, "u");
    const node = FakeNode.created[0]!;
    node.post({ frame, contextTime: 2 });
    expect(source.read(1500).capturedAt).toBe(3000);
    context.getOutputTimestamp.mockReturnValue({ contextTime: 1, performanceTime: 2100 });
    expect(source.read(1900).capturedAt).toBe(3000); // not yet a second since the last refresh
    expect(source.read(2001).capturedAt).toBe(3100);
  });

  it("decays to ZERO_FEATURES, except capturedAt, after 700 ms with no message (AC12)", async () => {
    const { asContext } = fakeContext(0);
    const source = await createFeatureSource(asContext, stream, "u");
    FakeNode.created[0]!.post({ frame, contextTime: 0.5 });
    const read = source.read(now + 700);
    expect(read).toEqual({ ...ZERO_FEATURES, capturedAt: 1500 });
  });

  it("stop disconnects the graph and closes the port, and leaves the tracks alone", async () => {
    const { input, asContext } = fakeContext();
    const stop = vi.fn();
    const withTracks = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const source = await createFeatureSource(asContext, withTracks, "u");
    const node = FakeNode.created[0]!;
    source.stop();
    expect(input.disconnected).toBe(true);
    expect(node.disconnected).toBe(true);
    expect(node.port.closed).toBe(true);
    expect(node.port.onmessage).toBeNull();
    expect(stop).not.toHaveBeenCalled();
  });
});
