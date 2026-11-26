// B-07 T12 (SD12, SD14, SD15, AC18, AC28, AC30, AC31, AC32, AC34; plan PD12 to PD14): the staged
// look's preview on the screen page — a second engine on a detached canvas, sent to the one
// controller holding the stream — against a fake engine, a fake canvas and a fake peer. The live
// engine is never handed to the preview, so nothing here can reach it.
import { ZERO_FEATURES, type EngineOptions } from "@djv/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePeer, FakeTrack } from "../send/fake-peer.ts";
import {
  createPreview,
  PREVIEW_FPS,
  PREVIEW_SIZE,
  type Preview,
  type PreviewEngine,
} from "./preview.ts";
import type { StagedDefinition } from "./staged.ts";

const settle = () => vi.advanceTimersByTimeAsync(0);
const calm = { overBudget: false, transitioning: false };
const busy = { overBudget: false, transitioning: true };

const LOOK: StagedDefinition = {
  id: "w1",
  name: "Warm",
  stored: {
    name: "Warm",
    palette: ["#000000", "#ffffff"],
    dials: { recognisability: 0.9, reactivity: 0.2 },
    effects: [{ type: "zoom", amount: 0.5 }],
  },
  palette: ["#ff0000", "#ffffff"],
  amounts: [0.8],
  dials: { recognisability: 0.6, reactivity: 0.4 },
  feed: { kind: "local", deviceId: "cam-9", label: "Booth" },
  transition: { kind: "crossfade", duration: 4 },
};

interface FakeEngine extends PreviewEngine {
  canvas: FakeCanvas;
  options: EngineOptions;
  running: boolean;
  disposed: boolean;
  calls: string[];
}

class FakeCanvas {
  track = new FakeTrack("video");
  fps: number | null = null;
  captureStream(fps: number) {
    this.fps = fps;
    return { getVideoTracks: () => [this.track] } as unknown as MediaStream;
  }
}

let engines: FakeEngine[];
let canvases: FakeCanvas[];
let sent: unknown[];
let staged: StagedDefinition | null;
let changes: number;
let preview: Preview;

function fakeEngine(canvas: FakeCanvas, options: EngineOptions): FakeEngine {
  const engine: FakeEngine = {
    canvas,
    options,
    running: false,
    disposed: false,
    calls: [],
    start: vi.fn(() => void (engine.running = true)),
    stop: vi.fn(() => void (engine.running = false)),
    setFeatures: vi.fn(),
    setDials: vi.fn((d) => void engine.calls.push(`dials ${d.recognisability}`)),
    setSource: vi.fn(),
    setProfile: vi.fn(async (p) => void engine.calls.push(`profile ${p.palette.join()}`)),
    dispose: vi.fn(() => void (engine.disposed = true)),
  };
  engines.push(engine);
  return engine;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakePeer.all = [];
  engines = [];
  canvases = [];
  sent = [];
  staged = null;
  changes = 0;
  preview = createPreview({
    createEngine: (canvas, options) => fakeEngine(canvas as unknown as FakeCanvas, options),
    createCanvas: () => {
      const canvas = new FakeCanvas();
      canvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    },
    createPeer: (config) => new FakePeer(config) as unknown as RTCPeerConnection,
    staged: () => staged,
    send: (message) => void sent.push(message),
    onChange: () => void changes++,
  });
});
afterEach(() => vi.useRealTimers());

const engine = () => engines.at(-1)!;
const peer = () => FakePeer.all.at(-1)!;

describe("nothing without a holder and a staged look (AC32)", () => {
  it("creates no engine, canvas or peer while no controller holds the stream", async () => {
    staged = LOOK;
    preview.changed();
    preview.frame(16, ZERO_FEATURES, null, calm);
    await settle();
    expect(engines).toEqual([]);
    expect(canvases).toEqual([]);
    expect(FakePeer.all).toEqual([]);
    expect(preview.state()).toBe("off");
  });

  it("a holder with no staged look waits; a staged look appearing starts it; Unstage then re-stage starts it again", async () => {
    preview.holder("d1");
    expect(engines).toEqual([]);
    staged = LOOK;
    preview.changed();
    await settle();
    expect(engines).toHaveLength(1);
    expect(preview.state()).toBe("on");
    staged = null;
    preview.changed();
    expect(engines[0]!.disposed).toBe(true);
    expect(peer().closed).toBe(true);
    expect(preview.state()).toBe("off");
    staged = LOOK;
    preview.changed();
    await settle();
    expect(engines).toHaveLength(2);
    expect(preview.state()).toBe("on");
  });
});

describe("the second engine (SD12, AC28, AC30, AC34, PD13)", () => {
  beforeEach(async () => {
    staged = LOOK;
    preview.holder("d1");
    await settle();
  });

  it("is its own instance on a detached canvas at 320×180 and 10 fps, captured at 10 fps", () => {
    expect(PREVIEW_SIZE).toEqual({ width: 320, height: 180 });
    expect(PREVIEW_FPS).toBe(10);
    expect(engine().options).toEqual({ size: PREVIEW_SIZE, maxFps: 10 });
    expect(engine().canvas).toBe(canvases[0]);
    expect(canvases[0]!.fps).toBe(10);
    expect(engine().running).toBe(true);
  });

  it("draws the staged look — its palette and strengths baked in — at the staged dials", () => {
    expect(engine().calls).toEqual(["profile #ff0000,#ffffff", "dials 0.6"]);
    expect(engine().setProfile).toHaveBeenCalledWith(
      expect.objectContaining({ effects: [{ type: "zoom", amount: 0.8 }] }),
    );
  });

  it("follows each staged change (AC30)", () => {
    staged = {
      ...LOOK,
      palette: ["#00ff00", "#ffffff"],
      dials: { recognisability: 0.1, reactivity: 0.4 },
    };
    preview.changed();
    expect(engine().calls.slice(-2)).toEqual(["profile #00ff00,#ffffff", "dials 0.1"]);
  });

  it("sends one video track over a peer with no ICE server, its offer and candidates to the holder (AC28)", async () => {
    expect(peer().config).toEqual({ iceServers: [] });
    expect(peer().senders.map((s) => s.track)).toEqual([canvases[0]!.track]);
    expect(peer().senders[0]!.parameters.encodings).toEqual([{ active: true, maxFramerate: 10 }]);
    expect(peer().transceivers[0]!.direction).toBe("sendonly");
    peer().candidate({ candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 });
    expect(sent).toEqual([
      expect.objectContaining({ type: "previewOffer", deviceId: "d1" }),
      {
        type: "previewCandidate",
        deviceId: "d1",
        candidate: "candidate:1",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    ]);
    await preview.answer("d1", "v=0 answer");
    expect(peer().remote).toEqual({ type: "answer", sdp: "v=0 answer" });
    await preview.answer("d2", "v=0 stray");
    expect(peer().remote).toEqual({ type: "answer", sdp: "v=0 answer" });
  });

  it("is fed the features and the very video element the output gets, and opens no camera (AC18)", () => {
    const video = {} as HTMLVideoElement;
    const features = { ...ZERO_FEATURES, level: 0.5 };
    preview.frame(16, features, video, calm);
    preview.frame(32, features, video, calm);
    expect(engine().setFeatures).toHaveBeenLastCalledWith(features);
    expect(engine().setSource).toHaveBeenCalledTimes(1);
    expect(engine().setSource).toHaveBeenCalledWith(video);
    // A staged feed change is only what Go will switch to: the preview's source stays the output's.
    staged = { ...LOOK, feed: { kind: "remote", hint: "Chrome on Android" } };
    preview.changed();
    preview.frame(48, features, video, calm);
    expect(engine().setSource).toHaveBeenCalledTimes(1);
  });

  it("a new holder moves the stream: a new peer to it, the old closed", async () => {
    const first = peer();
    preview.holder("d2");
    await settle();
    expect(first.closed).toBe(true);
    expect(sent.at(-1)).toMatchObject({ type: "previewOffer", deviceId: "d2" });
  });

  it("stops when no one holds it: the peer closed, the engine disposed, the canvas dropped", () => {
    const track = canvases[0]!.track;
    preview.holder(null);
    expect(peer().closed).toBe(true);
    expect(engine().disposed).toBe(true);
    expect(track.readyState).toBe("ended");
    expect(preview.state()).toBe("off");
  });

  it("gives up when the peer cannot be reached in 10 s, until the holder asks again", async () => {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine().disposed).toBe(true);
    expect(preview.state()).toBe("off");
    preview.changed(); // a staged edit does not start it again
    expect(engines).toHaveLength(1);
    preview.holder("d1"); // the hub's repeated `preview { deviceId }`
    await settle();
    expect(engines).toHaveLength(2);
  });
});

describe("yielding to the output (SD14, AC31, PD12)", () => {
  beforeEach(async () => {
    staged = LOOK;
    preview.holder("d1");
    await settle();
  });

  it("stops the preview engine while the output is busy and starts it again after 2 s calm", () => {
    preview.frame(16, ZERO_FEATURES, null, busy);
    expect(engine().running).toBe(false);
    expect(preview.state()).toBe("paused");
    const before = changes;
    preview.frame(2_015, ZERO_FEATURES, null, calm);
    expect(engine().running).toBe(false);
    preview.frame(2_016, ZERO_FEATURES, null, calm);
    expect(engine().running).toBe(true);
    expect(preview.state()).toBe("on");
    expect(changes).toBeGreaterThan(before);
  });

  it("with the preview live through a Crossfade, the output still draws one look a frame, or two during it", () => {
    // The output's own engine, as the page drives it: one look, two during the transition.
    const draws: number[] = [];
    const output = { looks: 1, draw: () => draws.push(output.looks) };
    for (let t = 0; t < 60; t++) {
      output.looks = t >= 10 && t < 40 ? 2 : 1; // a Crossfade from frame 10 to 40
      preview.frame(t * 16, ZERO_FEATURES, null, {
        overBudget: false,
        transitioning: output.looks === 2,
      });
      output.draw();
    }
    expect(new Set(draws)).toEqual(new Set([1, 2]));
    expect(draws.filter((n) => n === 2)).toHaveLength(30);
    expect(engine().running).toBe(false); // paused through it, and for 2 s after
  });
});
