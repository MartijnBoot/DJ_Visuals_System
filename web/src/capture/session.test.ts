// T6 (spec SD3, SD6, SD7, SD9, AC2, AC4, AC5, AC12, AC13, AC14; plan PD9, PD11, PD15, PD17): the
// capture session against hand-rolled fakes of every browser API it touches, with fake timers
// for the retry and mute clocks. Runs in Node, no jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRemembered } from "./remembered.ts";
import { createSession, type Session } from "./session.ts";

class FakeTrack extends EventTarget {
  muted = false;
  readyState: "live" | "ended" = "live";
  readonly kind: "audio" | "video";
  readonly deviceId: string;
  constructor(kind: "audio" | "video", deviceId: string) {
    super();
    this.kind = kind;
    this.deviceId = deviceId;
  }
  stop() {
    this.readyState = "ended"; // like a real track, its own stop fires no `ended` (PD9)
  }
  getSettings() {
    return { deviceId: this.deviceId };
  }
  /** The device going away. */
  end() {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
  mute() {
    this.muted = true;
    this.dispatchEvent(new Event("mute"));
  }
  unmute() {
    this.muted = false;
    this.dispatchEvent(new Event("unmute"));
  }
}

function streamOf(...tracks: FakeTrack[]) {
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream & { tracks: FakeTrack[] };
}

const domError = (name: string) => Object.assign(new Error(name), { name });

type Outcome = "ok" | "denied" | "absent";
type DisplayOutcome = "ok" | "cancelled" | "no-audio";

function fakeMediaDevices() {
  const target = new EventTarget();
  const tracks: FakeTrack[] = [];
  const present = { video: ["cam-1", "cam-2"], audio: ["mic-1", "mic-2"] };
  const next: { camera: Outcome; audio: Outcome; display: DisplayOutcome } = {
    camera: "ok",
    audio: "ok",
    display: "ok",
  };
  const idealOf = (c: boolean | MediaTrackConstraints | undefined) =>
    typeof c === "object" ? ((c.deviceId as { ideal?: string } | undefined)?.ideal ?? null) : null;
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    const kind = constraints.video ? "video" : "audio";
    const outcome = kind === "video" ? next.camera : next.audio;
    if (outcome === "denied") throw domError("NotAllowedError");
    if (outcome === "absent") throw domError("NotFoundError");
    const wanted = idealOf(kind === "video" ? constraints.video : constraints.audio);
    const id = wanted && present[kind].includes(wanted) ? wanted : present[kind][0]!;
    const track = new FakeTrack(kind, id);
    tracks.push(track);
    return streamOf(track);
  });
  const getDisplayMedia = vi.fn(async (_constraints?: DisplayMediaStreamOptions) => {
    if (next.display === "cancelled") throw domError("NotAllowedError");
    const video = new FakeTrack("video", "screen");
    const made = next.display === "ok" ? [video, new FakeTrack("audio", "system")] : [video];
    tracks.push(...made);
    return streamOf(...made);
  });
  const enumerateDevices = vi.fn(async () => [
    ...present.video.map((deviceId) => ({ kind: "videoinput", deviceId, label: "" })),
    ...present.audio.map((deviceId) => ({ kind: "audioinput", deviceId, label: "" })),
  ]);
  const mediaDevices = {
    getUserMedia,
    getDisplayMedia,
    enumerateDevices,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  } as unknown as MediaDevices;
  const devicechange = () => target.dispatchEvent(new Event("devicechange"));
  const live = (kind: "audio" | "video") =>
    tracks.filter((t) => t.kind === kind && t.readyState === "live");
  return { mediaDevices, getUserMedia, getDisplayMedia, next, present, devicechange, live, tracks };
}

class FakeContext extends EventTarget {
  state: AudioContextState = "running";
  resume = vi.fn(async () => this.set("running"));
  close = vi.fn(async () => this.set("closed"));
  set(state: AudioContextState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

const LOUD = { level: 0.8, low: 0.9, mid: 0.3, high: 0.2, beat: 1, capturedAt: 100 };

function rig() {
  const media = fakeMediaDevices();
  const contexts: FakeContext[] = [];
  const sources: { stream: MediaStream; stop: ReturnType<typeof vi.fn> }[] = [];
  const createFeatureSource = vi.fn(async (_c: AudioContext, stream: MediaStream, _u: string) => {
    const stop = vi.fn();
    sources.push({ stream, stop });
    return { read: () => LOUD, stop, lastBlockAt: () => 0 };
  });
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: map.set.bind(map) };
  const gestures = new EventTarget();
  const log = vi.fn();
  const session = createSession({
    mediaDevices: media.mediaDevices,
    createContext: () => {
      const c = new FakeContext();
      contexts.push(c);
      return c as unknown as AudioContext;
    },
    createFeatureSource,
    moduleUrl: "/assets/processor.js",
    createVideo: (stream) => ({ srcObject: stream }) as unknown as HTMLVideoElement,
    gestures,
    storage,
    log,
  });
  const logged = (kind: string, state: string) =>
    log.mock.calls.filter(([k, s]) => k === kind && s === state).length;
  return {
    ...media,
    session,
    contexts,
    sources,
    createFeatureSource,
    storage,
    gestures,
    log,
    logged,
  };
}

/** Lets pending promise callbacks run without moving the fake clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("before Start (AC1, PD19)", () => {
  it("is idle and has asked for nothing", () => {
    const r = rig();
    expect(r.session.state()).toMatchObject({ camera: "idle", audio: "idle", video: null });
    expect(r.getUserMedia).not.toHaveBeenCalled();
    expect(r.contexts).toHaveLength(0);
    expect(r.session.read(0)).toMatchObject({ level: 0, beat: 0 });
  });
});

describe("Start (AC2, SD9)", () => {
  it("requests the chosen devices with processing off and feeds the renderer", async () => {
    const r = rig();
    await r.session.start({ cameraId: "cam-2", audio: { kind: "input", deviceId: "mic-2" } });
    expect(r.getUserMedia).toHaveBeenCalledWith({ video: { deviceId: { ideal: "cam-2" } } });
    expect(r.getUserMedia).toHaveBeenCalledWith({
      audio: {
        deviceId: { ideal: "mic-2" },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    expect(r.contexts).toHaveLength(1);
    expect(r.createFeatureSource).toHaveBeenCalledWith(
      r.contexts[0],
      r.sources[0]!.stream,
      "/assets/processor.js",
    );
    const state = r.session.state();
    expect(state).toMatchObject({ camera: "ok", audio: "ok", contextState: "running" });
    expect(state.video).not.toBeNull();
    expect(r.session.read(0)).toEqual(LOUD);
    expect(r.logged("camera", "ok")).toBe(1);
    expect(r.logged("audio", "ok")).toBe(1);
  });

  it("with nothing remembered asks for any camera and any input", async () => {
    const r = rig();
    await r.session.start({});
    expect(r.getUserMedia).toHaveBeenCalledWith({ video: true });
    expect(r.session.state()).toMatchObject({ camera: "ok", audio: "ok" });
  });

  it("starts once: a second Start asks for nothing more", async () => {
    const r = rig();
    await r.session.start({});
    await r.session.start({});
    expect(r.getUserMedia).toHaveBeenCalledTimes(2);
    expect(r.contexts).toHaveLength(1);
  });

  it("notifies subscribers of every change", async () => {
    const r = rig();
    const seen: string[] = [];
    const off = r.session.subscribe((s) => seen.push(`${s.camera}/${s.audio}`));
    await r.session.start({});
    expect(seen.at(-1)).toBe("ok/ok");
    off();
    r.live("video")[0]!.end();
    expect(seen.at(-1)).toBe("ok/ok");
  });
});

describe("remembering (AC5)", () => {
  it("saves the devices in use at Start and every device chosen after", async () => {
    const r = rig();
    await r.session.start({});
    expect(loadRemembered(r.storage)).toEqual({
      cameraId: "cam-1",
      audio: { kind: "input", deviceId: "mic-1" },
    });
    await r.session.setCamera("cam-2");
    await r.session.setAudio({ kind: "input", deviceId: "mic-2" });
    expect(loadRemembered(r.storage)).toEqual({
      cameraId: "cam-2",
      audio: { kind: "input", deviceId: "mic-2" },
    });
    expect(r.session.state()).toMatchObject({
      cameraId: "cam-2",
      audioChoice: { kind: "input", deviceId: "mic-2" },
    });
  });
});

describe("system audio (SD3, AC4)", () => {
  it("uses the share's audio track and stops its video track at once", async () => {
    const r = rig();
    await r.session.start({ audio: { kind: "system" } });
    expect(r.getDisplayMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: true,
    });
    expect(r.session.state().audio).toBe("ok");
    const screen = r.tracks.find((t) => t.deviceId === "screen")!;
    expect(screen.readyState).toBe("ended");
    expect(loadRemembered(r.storage).audio).toEqual({ kind: "system" });
  });

  it.each([
    ["cancelled", /cancelled/],
    ["no-audio", /no audio/],
  ] as const)("a %s share keeps the previous source and says why", async (outcome, reason) => {
    const r = rig();
    await r.session.start({ audio: { kind: "input", deviceId: "mic-2" } });
    const before = r.live("audio")[0]!;
    r.next.display = outcome;
    await r.session.setAudio({ kind: "system" });
    const state = r.session.state();
    expect(state.audio).toBe("ok");
    expect(state.reason).toMatch(reason);
    expect(state.audioChoice).toEqual({ kind: "input", deviceId: "mic-2" });
    expect(before.readyState).toBe("live");
    expect(r.sources.at(-1)!.stop).not.toHaveBeenCalled();
    expect(r.live("video").filter((t) => t.deviceId === "screen")).toEqual([]);
    expect(loadRemembered(r.storage).audio).toEqual({ kind: "input", deviceId: "mic-2" });
  });
});

describe("switching while running (PD11)", () => {
  it("stops the old camera without reading it as a loss", async () => {
    const r = rig();
    await r.session.start({});
    const old = r.live("video")[0]!;
    const oldVideo = r.session.state().video;
    await r.session.setCamera("cam-2");
    expect(old.readyState).toBe("ended");
    old.dispatchEvent(new Event("ended")); // even if a browser did fire it
    expect(r.session.state().camera).toBe("ok");
    expect(r.session.state().video).not.toBe(oldVideo);
    expect(r.logged("camera", "lost")).toBe(0);
  });

  it("swaps the audio feature source and stops the old one", async () => {
    const r = rig();
    await r.session.start({});
    const old = r.live("audio")[0]!;
    await r.session.setAudio({ kind: "input", deviceId: "mic-2" });
    expect(r.sources[0]!.stop).toHaveBeenCalled();
    expect(old.readyState).toBe("ended");
    expect(r.session.state().audio).toBe("ok");
    expect(r.logged("audio", "lost")).toBe(0);
  });
});

describe("loss and retry (SD7, AC12, AC13, PD9, PD17)", () => {
  it.each([
    ["audio", "audio"],
    ["camera", "video"],
  ] as const)("%s: an ended track is lost, a retry at 2 s brings it back", async (kind, track) => {
    const r = rig();
    await r.session.start({});
    r.next[kind] = "absent";
    r.live(track)[0]!.end();
    expect(r.session.state()[kind]).toBe("lost");
    expect(r.logged(kind, "lost")).toBe(1);
    if (kind === "camera") expect(r.session.state().video).toBeNull();
    if (kind === "audio") expect(r.sources[0]!.stop).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(r.session.state()[kind]).toBe("lost"); // still unplugged
    r.next[kind] = "ok";
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.session.state()[kind]).toBe("ok");
    expect(r.logged(kind, "restored")).toBe(1);
    expect(r.session.state().reason).toBeUndefined();
  });

  it("retries at once when a device is plugged in", async () => {
    const r = rig();
    await r.session.start({});
    r.next.camera = "absent";
    r.live("video")[0]!.end();
    r.next.camera = "ok";
    r.devicechange();
    await settle();
    expect(r.session.state().camera).toBe("ok");
  });

  it("a device removed from the list is lost", async () => {
    const r = rig();
    await r.session.start({ audio: { kind: "input", deviceId: "mic-2" } });
    r.present.audio = ["mic-1"];
    r.next.audio = "absent";
    r.devicechange();
    await settle();
    expect(r.session.state().audio).toBe("lost");
  });

  it("a track muted for more than 1 s is lost; a shorter mute is not", async () => {
    const r = rig();
    await r.session.start({});
    const track = r.live("audio")[0]!;
    track.mute();
    await vi.advanceTimersByTimeAsync(900);
    track.unmute();
    await vi.advanceTimersByTimeAsync(500);
    expect(r.session.state().audio).toBe("ok");
    track.mute();
    await vi.advanceTimersByTimeAsync(1100);
    expect(r.session.state().audio).toBe("lost");
  });

  it("permission denied at Start is none, and retrying continues until allowed", async () => {
    const r = rig();
    r.next.camera = "denied";
    await r.session.start({});
    expect(r.session.state()).toMatchObject({ camera: "none", audio: "ok", video: null });
    expect(r.session.state().reason).toMatch(/camera/);
    expect(r.logged("camera", "none")).toBe(1);
    const calls = () => r.getUserMedia.mock.calls.filter(([c]) => c.video).length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls()).toBe(3);
    r.next.camera = "ok";
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.session.state().camera).toBe("ok");
    expect(r.logged("camera", "restored")).toBe(1);
  });

  it("no camera at all is none", async () => {
    const r = rig();
    r.next.camera = "absent";
    await r.session.start({});
    expect(r.session.state().camera).toBe("none");
  });

  it("stop ends every track, the source, the context and the retries", async () => {
    const r = rig();
    r.next.camera = "denied";
    await r.session.start({});
    r.session.stop();
    expect(r.live("audio")).toEqual([]);
    expect(r.sources[0]!.stop).toHaveBeenCalled();
    expect(r.contexts[0]!.close).toHaveBeenCalled();
    const before = r.getUserMedia.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(r.getUserMedia.mock.calls.length).toBe(before);
  });
});

describe("a suspended audio context (AC14, PD15)", () => {
  it("shows audio lost with a click-to-resume reason, and one pointerdown resumes", async () => {
    const r = rig();
    await r.session.start({});
    r.contexts[0]!.set("suspended");
    expect(r.session.state()).toMatchObject({ audio: "lost", contextState: "suspended" });
    expect(r.session.state().reason).toMatch(/click anywhere to resume/);
    r.gestures.dispatchEvent(new Event("pointerdown"));
    await settle();
    expect(r.contexts[0]!.resume).toHaveBeenCalledTimes(1);
    expect(r.session.state()).toMatchObject({ audio: "ok", contextState: "running" });
    expect(r.session.state().reason).toBeUndefined();
  });
});

describe("the session type", () => {
  it("exposes read for the frame loop", () => {
    const session: Session = rig().session;
    expect(typeof session.read).toBe("function");
  });
});
