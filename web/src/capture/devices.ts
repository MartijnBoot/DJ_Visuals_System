// Device lists and the media constraints (spec SD3, SD9, AC2, AC3).

export interface DeviceOption {
  deviceId: string;
  label: string;
}

/** Echo cancellation, noise suppression and auto gain all damage music analysis (SD9). */
const PROCESSING_OFF = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
} as const;

export function cameraConstraints(deviceId?: string): MediaStreamConstraints {
  return { video: deviceId ? { deviceId: { ideal: deviceId } } : true };
}

export function audioConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: deviceId ? { deviceId: { ideal: deviceId }, ...PROCESSING_OFF } : PROCESSING_OFF,
  };
}

/** System audio is a screen share with audio; its video track is stopped at once. */
export function systemAudioConstraints(): DisplayMediaStreamOptions {
  return { audio: PROCESSING_OFF, video: true };
}

export function supportsSystemAudio(mediaDevices: Partial<Pick<MediaDevices, "getDisplayMedia">>) {
  return typeof mediaDevices.getDisplayMedia === "function";
}

/** Cameras and audio inputs, each named; labels are empty until permission is granted. */
export async function listDevices(
  mediaDevices: Pick<MediaDevices, "enumerateDevices">,
): Promise<{ cameras: DeviceOption[]; audioInputs: DeviceOption[] }> {
  let all: MediaDeviceInfo[] = [];
  try {
    all = await mediaDevices.enumerateDevices();
  } catch {
    // An empty list: the pickers show the defaults.
  }
  const options = (kind: MediaDeviceKind, name: string) =>
    all
      .filter((d) => d.kind === kind)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${name} ${i + 1}` }));
  return {
    cameras: options("videoinput", "Camera"),
    audioInputs: options("audioinput", "Audio input"),
  };
}
