// T13 (B-06 spec SD7, SD8, SD12, SD17, SD19, SD21, AC14 to AC18, AC20 to AC22, AC24, AC27; plan
// PD2, PD6, PD7, PD12): the composition of the session, the peers and the two state machines,
// against fakes for each, with the time handed in.
import type { AudioFeatures, FeatureSource } from "@djv/audio";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { AudioChoice } from "../capture/remembered.ts";
import type { Feed, PeerConnectionView } from "./peers.ts";
import { createSources, type Sources, type SourcesDeps } from "./sources.ts";

const LOCAL: AudioFeatures = { level: 0.1, low: 0.1, mid: 0.1, high: 0.1, beat: 0, capturedAt: 1 };
const REMOTE: AudioFeatures = { level: 0.9, low: 0.9, mid: 0.9, high: 0.9, beat: 1, capturedAt: 2 };

type Kind = "video" | "audio";
const VIDEO = {
  deviceId: "dV",
  hint: "Safari on iPhone",
  label: "Device 2",
  sends: ["video"] as Kind[],
};
const AUDIO = {
  deviceId: "dA",
  hint: "Chrome on Windows",
  label: "Device 3",
  sends: ["audio"] as Kind[],
};
const OTHER = {
  deviceId: "dW",
  hint: "Chrome on Android",
  label: "Device 4",
  sends: ["video"] as Kind[],
};
type Entry = typeof VIDEO;

const el = (name: string) => ({ name }) as unknown as HTMLVideoElement;
// One object per id, as a peer's feed keeps its track and stream until a new offer.
const objects = new Map<string, object>();
const once = <T>(id: string) => {
  if (!objects.has(id)) objects.set(id, { id, name: id });
  return objects.get(id) as T;
};
const stream = (id: string) => once<MediaStream>(`stream:${id}`);
const track = (id: string) => once<MediaStreamTrack>(`track:${id}`);

let feeds: Feed[];
let connections: Map<string, PeerConnectionView>;
let active: Map<string, boolean>;
let dropped: string[];
let audioChoice: AudioChoice | undefined;
let sessionVideo: HTMLVideoElement | null;
let cameraId: string | undefined;
let context: AudioContext | null;
let made: { stream: MediaStream; stop: ReturnType<typeof vi.fn> }[];
let pendingSource: ((s: FeatureSource) => void) | null;
let attached: MediaStream[];
let frames: Set<string>;
let logs: [string, string][];
let changes: number;
let setAudio: Mock<(choice: AudioChoice, options?: { remember: boolean }) => Promise<void>>;
let setCamera: Mock<(deviceId: string) => Promise<void>>;
let sources: Sources;

function feed(deviceId: string, kind: "audio" | "video", lost = false): Feed {
  return {
    deviceId,
    kind,
    track: track(`${deviceId}-${kind}`),
    stream: stream(`${deviceId}-${kind}`),
    lost,
  };
}

function make(overrides: Partial<SourcesDeps> = {}) {
  sources = createSources({
    session: {
      read: () => LOCAL,
      state: () => ({
        camera: "ok",
        audio: "ok",
        video: sessionVideo,
        contextState: context ? "running" : "none",
        ...(cameraId ? { cameraId } : {}),
        ...(audioChoice ? { audioChoice } : {}),
      }),
      context: () => context,
      setCamera,
      setAudio,
    },
    peers: {
      feeds: () => feeds,
      connection: (id) => connections.get(id) ?? null,
      setActive: (id, on) => void active.set(id, on),
      drop: (id) => void dropped.push(id),
      devices: () => [...connections.keys()],
    },
    createFeatureSource: (_context, s) => {
      const stop = vi.fn();
      made.push({ stream: s, stop });
      return new Promise((resolve) => {
        pendingSource = (source) => resolve({ ...source, stop });
      });
    },
    moduleUrl: "/processor.js",
    attachAudio: (s) => {
      attached.push(s);
      return { release: () => {} };
    },
    createVideo: (s) => el(`video:${(s as unknown as { id: string }).id.replace("stream:", "")}`),
    hasFrame: (video) => frames.has((video as unknown as { name: string }).name),
    log: (state, label) => void logs.push([state, label]),
    onChange: () => void (changes += 1),
    ...overrides,
  });
}

const connected = (id: string) =>
  connections.set(id, { state: "connected", firstOfferAt: 0, connected: true });

/** The remote audio's feature source becomes ready (it is made asynchronously). */
async function sourceReady() {
  pendingSource!({ read: () => REMOTE, stop: () => {}, lastBlockAt: () => 0 });
  pendingSource = null;
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  feeds = [];
  connections = new Map();
  active = new Map();
  dropped = [];
  audioChoice = { kind: "input", deviceId: "mic-1" };
  sessionVideo = el("local");
  cameraId = "cam-1";
  context = null;
  made = [];
  pendingSource = null;
  attached = [];
  frames = new Set(["local"]);
  logs = [];
  changes = 0;
  setAudio = vi.fn(async (_choice: AudioChoice, _options?: { remember: boolean }) => {});
  setCamera = vi.fn(async (_deviceId: string) => {});
  make();
});

/** An approved audio sender, its track in, after Start, its source ready: remote plays. */
async function audioMain(now = 1000) {
  sources.setSenders([AUDIO]);
  connected("dA");
  feeds = [feed("dA", "audio")];
  context = {} as AudioContext;
  sources.start();
  sources.frame(now);
  await sourceReady();
  sources.frame(now + 16);
}

describe("before Start (SD17, AC24)", () => {
  it("keeps every sender paused and makes no remote feature source", () => {
    sources.setSenders([VIDEO, AUDIO]);
    connected("dV");
    connected("dA");
    feeds = [feed("dV", "video"), feed("dA", "audio")];
    sources.frame(1000);
    expect(active.get("dV")).toBe(false);
    expect(active.get("dA")).toBe(false);
    expect(made).toEqual([]);
    expect(sources.read(1000)).toBe(LOCAL);
    expect(sources.facts(1000).mainAudio).toBeNull();
  });
});

describe("main audio (SD7, SD8, SD22, AC17 to AC20, PD6, PD12)", () => {
  it("at Start a connected audio sender becomes main: its track analysed, the local input kept", async () => {
    await audioMain();
    expect(attached).toEqual([feeds[0]!.stream]); // the muted element first (PD12)
    expect(made.map((m) => m.stream)).toEqual([feeds[0]!.stream]);
    expect(sources.read(1016)).toBe(REMOTE);
    expect(sources.facts(1016).mainAudio).toEqual({
      choice: "remote",
      playing: "remote",
      label: "Device 3",
    });
    expect(active.get("dA")).toBe(true); // streaming from Start on (PD7)
    expect(setAudio).not.toHaveBeenCalled(); // a remembered input is the standby as it is
  });

  it("a loss plays local in the same frame it is seen, and logs it with the label", async () => {
    await audioMain();
    feeds = [feed("dA", "audio", true)];
    sources.frame(2000);
    expect(sources.read(2000)).toBe(LOCAL);
    expect(sources.facts(2000).mainAudio).toMatchObject({ choice: "remote", playing: "local" });
    expect(logs).toEqual([
      ["remote audio lost", "Device 3"],
      ["fallback local", "Device 3"],
    ]);
  });

  it("returns after 3 s back, and logs restored remote", async () => {
    await audioMain();
    feeds = [feed("dA", "audio", true)];
    sources.frame(2000);
    feeds = [feed("dA", "audio")];
    sources.frame(2100);
    expect(sources.read(2100)).toBe(LOCAL);
    sources.frame(5099);
    expect(sources.read(5099)).toBe(LOCAL);
    sources.frame(5100);
    expect(sources.read(5100)).toBe(REMOTE);
    expect(logs.at(-1)).toEqual(["restored remote", "Device 3"]);
  });

  it("the local choice pins the local input through a loss and a return (AC20)", async () => {
    await audioMain();
    sources.setMainAudio("local");
    sources.frame(2000);
    expect(sources.read(2000)).toBe(LOCAL);
    feeds = [feed("dA", "audio", true)];
    sources.frame(3000);
    feeds = [feed("dA", "audio")];
    sources.frame(9000);
    expect(sources.read(9000)).toBe(LOCAL);
    expect(sources.facts(9000).mainAudio).toMatchObject({ choice: "local", playing: "local" });
    sources.setMainAudio("remote");
    sources.frame(9016);
    expect(sources.read(9016)).toBe(LOCAL); // back 16 ms: the 3 s still apply (AC19)
    sources.frame(12_000);
    expect(sources.read(12_000)).toBe(REMOTE);
  });

  it("with System audio remembered, the share stops and the default input is the standby (AC21, PD2)", async () => {
    audioChoice = { kind: "system" };
    await audioMain();
    expect(setAudio).toHaveBeenCalledTimes(1);
    expect(setAudio).toHaveBeenCalledWith(
      { kind: "input", deviceId: "default" },
      { remember: false },
    );
  });

  it("a new track from the same sender (it offered again) is analysed in place of the old one", async () => {
    await audioMain();
    const second = {
      ...feed("dA", "audio"),
      track: track("dA-audio-2"),
      stream: stream("dA-audio-2"),
    };
    feeds = [second];
    sources.frame(2000);
    expect(sources.read(2000)).toBe(LOCAL); // lost until the new source is there
    await sourceReady();
    sources.frame(2016);
    expect(made[0]!.stop).toHaveBeenCalled();
    sources.frame(5016);
    expect(sources.read(5016)).toBe(REMOTE);
  });

  it("the sender leaving the status drops its peer and its main audio", async () => {
    await audioMain();
    sources.setSenders([]);
    expect(dropped).toEqual(["dA"]);
    sources.frame(2000);
    expect(sources.facts(2000).mainAudio).toBeNull();
    expect(sources.read(2000)).toBe(LOCAL);
  });
});

describe("remote cameras (SD8, SD9, SD12, SD21, AC14 to AC16, AC22)", () => {
  function videoSenders() {
    sources.setSenders([VIDEO, OTHER] as Entry[]);
    connected("dV");
    connected("dW");
    feeds = [feed("dV", "video"), feed("dW", "video")];
    context = {} as AudioContext;
    sources.start();
  }

  it("lists a connected video sender as <hint> — Device n, remote, and the picture does not change", () => {
    videoSenders();
    sources.frame(1000);
    expect(sources.facts(1000).cameras).toEqual([
      { deviceId: "remote:dV", label: "Safari on iPhone — Device 2", remote: true },
      { deviceId: "remote:dW", label: "Chrome on Android — Device 4", remote: true },
    ]);
    expect(sources.video()).toBe(sessionVideo);
    expect(active.get("dV")).toBe(false);
    expect(active.get("dW")).toBe(false);
  });

  it("picking one streams it alone and draws it once it has a frame (AC15, AC16)", () => {
    videoSenders();
    sources.frame(1000);
    sources.setCamera("remote:dV");
    expect(setCamera).not.toHaveBeenCalled(); // a remote id never reaches the session
    sources.frame(1016);
    expect(active.get("dV")).toBe(true);
    expect(active.get("dW")).toBe(false);
    expect(sources.video()).toBe(sessionVideo); // no frame yet: the local one stays
    frames.add("video:dV-video");
    sources.frame(1032);
    expect(sources.video()?.toString()).toBe(el("video:dV-video").toString());
    expect((sources.video() as unknown as { name: string }).name).toBe("video:dV-video");
    expect(sources.facts(1032).cameraId).toBe("remote:dV");
  });

  it("a local pick goes to the session and back to the local camera", () => {
    videoSenders();
    sources.setCamera("remote:dV");
    frames.add("video:dV-video");
    sources.frame(1000);
    sources.setCamera("cam-2");
    expect(setCamera).toHaveBeenCalledWith("cam-2");
    sources.frame(1016);
    expect(sources.video()).toBe(sessionVideo);
    expect(active.get("dV")).toBe(false);
  });

  it("a remote camera lost for 1 s falls back to the local one (AC22)", () => {
    videoSenders();
    sources.setCamera("remote:dV");
    frames.add("video:dV-video");
    sources.frame(1000);
    feeds = [feed("dV", "video", true), feed("dW", "video")];
    sources.frame(1500);
    expect((sources.video() as unknown as { name: string }).name).toBe("video:dV-video");
    sources.frame(2500);
    expect(sources.video()).toBe(sessionVideo);
    expect(active.get("dV")).toBe(true); // waiting to return
  });

  it("a video sender without a connected peer is not listed", () => {
    sources.setSenders([VIDEO]);
    feeds = [feed("dV", "video")];
    sources.frame(1000);
    expect(sources.facts(1000).cameras).toEqual([]);
  });

  it("marks the state dirty when the camera list changes, not on every frame", () => {
    videoSenders();
    sources.frame(1000);
    const after = changes;
    sources.frame(1016);
    sources.frame(1032);
    expect(changes).toBe(after);
    sources.setSenders([VIDEO]);
    sources.frame(1048);
    expect(changes).toBeGreaterThan(after);
  });
});
