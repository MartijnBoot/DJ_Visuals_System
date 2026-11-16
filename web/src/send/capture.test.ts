// B-06 T18 (spec SD1, SD14, AC31, AC33): what a sender opens, and the reasons it shows instead.
import { describe, expect, it, vi } from "vitest";
import {
  cameraChoices,
  openCapture,
  SEND_REASON,
  sendAudioConstraints,
  videoConstraints,
} from "./capture.ts";

const OFF = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

class FakeTrack {
  stopped = false;
  kind: "audio" | "video";
  constructor(kind: "audio" | "video") {
    this.kind = kind;
  }
  stop() {
    this.stopped = true;
  }
}

const streamOf = (...tracks: FakeTrack[]) =>
  ({
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
  }) as unknown as MediaStream;

const named = (name: string) => Object.assign(new Error(name), { name });

function devices(over: Partial<Record<"getUserMedia" | "getDisplayMedia", unknown>> = {}) {
  return {
    getUserMedia: vi.fn(async (c: MediaStreamConstraints) =>
      streamOf(
        ...(c.video ? [new FakeTrack("video")] : []),
        ...(c.audio ? [new FakeTrack("audio")] : []),
      ),
    ),
    getDisplayMedia: vi.fn(async () => streamOf(new FakeTrack("video"), new FakeTrack("audio"))),
    ...over,
  } as unknown as Pick<MediaDevices, "getUserMedia" | "getDisplayMedia">;
}

class FakeMediaStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[]) {
    this.tracks = tracks;
  }
  getTracks = () => this.tracks;
}
vi.stubGlobal("MediaStream", FakeMediaStream);

describe("constraints (AC31, AC33)", () => {
  it("asks 1280×720 at 30 fps, with the facing mode chosen or the device", () => {
    const size = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    expect(videoConstraints()).toEqual({ video: size });
    expect(videoConstraints("front")).toEqual({ video: { ...size, facingMode: "user" } });
    expect(videoConstraints("back")).toEqual({ video: { ...size, facingMode: "environment" } });
    expect(videoConstraints("cam-2")).toEqual({
      video: { ...size, deviceId: { exact: "cam-2" } },
    });
  });

  it("captures audio with the three kinds of processing off, from an input and from System audio", () => {
    expect(sendAudioConstraints(undefined)).toEqual({ audio: OFF });
    expect(sendAudioConstraints({ kind: "input", deviceId: "mic-1" })).toEqual({
      audio: { deviceId: { exact: "mic-1" }, ...OFF },
    });
    expect(sendAudioConstraints({ kind: "system" })).toEqual({ audio: OFF, video: true });
  });
});

describe("the camera picker (AC31)", () => {
  it("offers Front and Back where the device has both", () => {
    expect(
      cameraChoices([
        { deviceId: "a", label: "Front Camera" },
        { deviceId: "b", label: "Back Camera" },
        { deviceId: "c", label: "Back Ultra Wide Camera" },
      ]),
    ).toEqual([
      { deviceId: "front", label: "Front" },
      { deviceId: "back", label: "Back" },
    ]);
    expect(
      cameraChoices([
        { deviceId: "a", label: "camera2 1, facing front" },
        { deviceId: "b", label: "camera2 0, facing back" },
      ]).map((c) => c.label),
    ).toEqual(["Front", "Back"]);
  });

  it("lists the cameras by name with two or more and no front and back, and offers none for one", () => {
    const two = [
      { deviceId: "a", label: "Integrated Webcam" },
      { deviceId: "b", label: "USB Camera" },
    ];
    expect(cameraChoices(two)).toEqual(two);
    expect(cameraChoices([{ deviceId: "a", label: "Integrated Webcam" }])).toEqual([]);
    // Before permission ids are empty: nothing to pick by.
    expect(
      cameraChoices([
        { deviceId: "", label: "Camera 1" },
        { deviceId: "", label: "Camera 2" },
      ]),
    ).toEqual([]);
  });
});

describe("openCapture (B-01's reasons)", () => {
  it("opens the camera and an input together, in one stream", async () => {
    const media = devices();
    const result = await openCapture(media, { video: true, audio: true, cameraId: "back" });
    expect("stream" in result && result.stream.getTracks().map((t) => t.kind)).toEqual([
      "video",
      "audio",
    ]);
    expect(media.getUserMedia).toHaveBeenCalledWith(videoConstraints("back"));
    expect(media.getUserMedia).toHaveBeenCalledWith(sendAudioConstraints(undefined));
  });

  it("keeps only the shared audio of System audio and stops its video", async () => {
    const video = new FakeTrack("video");
    const audio = new FakeTrack("audio");
    const media = devices({ getDisplayMedia: vi.fn(async () => streamOf(video, audio)) });
    const result = await openCapture(media, {
      video: false,
      audio: true,
      audioSource: { kind: "system" },
    });
    expect("stream" in result && result.stream.getTracks()).toEqual([audio]);
    expect(video.stopped).toBe(true);
  });

  it("a denied camera or microphone gives B-01's reason and stops whatever did open", async () => {
    const opened = new FakeTrack("audio");
    const camera = devices({
      getUserMedia: vi.fn(async (c: MediaStreamConstraints) => {
        if (c.video) throw named("NotAllowedError");
        return streamOf(opened);
      }),
    });
    expect(await openCapture(camera, { video: true, audio: true })).toEqual({
      reason: SEND_REASON.cameraDenied,
    });
    expect(opened.stopped).toBe(true);
    const mic = devices({
      getUserMedia: vi.fn(async () => Promise.reject(named("NotAllowedError"))),
    });
    expect(await openCapture(mic, { video: false, audio: true })).toEqual({
      reason: SEND_REASON.audioDenied,
    });
    expect(SEND_REASON.cameraDenied).toBe(
      "camera permission denied: allow it in the browser's site settings",
    );
  });

  it("a cancelled System audio share, or one without audio, gives its reason", async () => {
    const cancelled = devices({
      getDisplayMedia: vi.fn(async () => Promise.reject(named("NotAllowedError"))),
    });
    expect(
      await openCapture(cancelled, { video: false, audio: true, audioSource: { kind: "system" } }),
    ).toEqual({
      reason: SEND_REASON.systemCancelled,
    });
    const video = new FakeTrack("video");
    const silent = devices({ getDisplayMedia: vi.fn(async () => streamOf(video)) });
    expect(
      await openCapture(silent, { video: false, audio: true, audioSource: { kind: "system" } }),
    ).toEqual({
      reason: SEND_REASON.systemNoAudio,
    });
    expect(video.stopped).toBe(true);
  });

  it("no camera or no input found", async () => {
    const none = devices({
      getUserMedia: vi.fn(async () => Promise.reject(named("NotFoundError"))),
    });
    expect(await openCapture(none, { video: true, audio: false })).toEqual({
      reason: SEND_REASON.cameraAbsent,
    });
    expect(await openCapture(none, { video: false, audio: true })).toEqual({
      reason: SEND_REASON.audioAbsent,
    });
  });
});
