// T6 (spec SD3, SD9, AC2, AC3): device lists and the constraint builders.
import { describe, expect, it } from "vitest";
import {
  audioConstraints,
  cameraConstraints,
  listDevices,
  supportsSystemAudio,
  systemAudioConstraints,
} from "./devices.ts";

const OFF = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

describe("constraints (AC2, SD9)", () => {
  it("asks for a camera by id as exact, or any camera", () => {
    expect(cameraConstraints("cam-2")).toEqual({ video: { deviceId: { exact: "cam-2" } } });
    expect(cameraConstraints()).toEqual({ video: true });
  });

  it("turns echo cancellation, noise suppression and auto gain off on every audio request", () => {
    expect(audioConstraints("mic-2")).toEqual({ audio: { deviceId: { exact: "mic-2" }, ...OFF } });
    expect(audioConstraints()).toEqual({ audio: OFF });
    expect(systemAudioConstraints()).toEqual({ audio: OFF, video: true });
  });
});

describe("device lists (AC3)", () => {
  const devices = [
    { kind: "videoinput", deviceId: "cam-1", label: "Webcam" },
    { kind: "audioinput", deviceId: "default", label: "Default" },
    { kind: "audioinput", deviceId: "mic-2", label: "" },
    { kind: "audiooutput", deviceId: "spk", label: "Speakers" },
    { kind: "videoinput", deviceId: "cam-2", label: "" },
  ] as MediaDeviceInfo[];
  const mediaDevices = { enumerateDevices: async () => devices };

  it("splits cameras and audio inputs, and drops outputs", async () => {
    const { cameras, audioInputs } = await listDevices(mediaDevices);
    expect(cameras.map((d) => d.deviceId)).toEqual(["cam-1", "cam-2"]);
    expect(audioInputs.map((d) => d.deviceId)).toEqual(["default", "mic-2"]);
  });

  it("names an unlabelled device by kind and position, never empty", async () => {
    const { cameras, audioInputs } = await listDevices(mediaDevices);
    expect(cameras[1]!.label).toBe("Camera 2");
    expect(audioInputs[1]!.label).toBe("Audio input 2");
  });

  it("reads an empty list when enumeration fails", async () => {
    const failing = {
      enumerateDevices: async (): Promise<MediaDeviceInfo[]> => {
        throw new Error("nope");
      },
    };
    expect(await listDevices(failing)).toEqual({ cameras: [], audioInputs: [] });
  });

  it("offers system audio only when getDisplayMedia exists", () => {
    expect(supportsSystemAudio({ getDisplayMedia: async () => ({}) as MediaStream })).toBe(true);
    expect(supportsSystemAudio({})).toBe(false);
  });
});
