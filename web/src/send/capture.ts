// What a sender opens (B-06 spec SD1, SD11, SD14, AC31, AC33; plan T18): the camera at 1280×720,
// 30 fps — by facing mode where the device has a front and a back camera, else by device — and the
// audio from an input or System audio, with echo cancellation, noise suppression and auto gain
// off (the screen machine's own constraints, `capture/devices.ts`). Everything is asked for at
// once, inside the Send click (System audio needs that click). If one part fails, whatever did
// open is stopped and B-01's reason is shown instead; no request is sent.
import { audioConstraints, systemAudioConstraints, type DeviceOption } from "../capture/devices.ts";
import type { SendChoice } from "../control/remembered.ts";

/** B-01's words (`capture/session.ts`), without "kept the previous …": a sender keeps nothing. */
export const SEND_REASON = {
  cameraDenied: "camera permission denied: allow it in the browser's site settings",
  cameraAbsent: "no camera found",
  audioDenied: "microphone permission denied: allow it in the browser's site settings",
  audioAbsent: "no audio input found",
  systemCancelled: "system audio share cancelled",
  systemNoAudio: "the shared source has no audio (tick 'share audio')",
} as const;

/** The two pseudo ids a phone's picker uses: facing modes, not devices. */
const FACING = { front: "user", back: "environment" } as const;

const SIZE = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };

export function videoConstraints(camera?: string): MediaStreamConstraints {
  if (camera === "front" || camera === "back") {
    return { video: { ...SIZE, facingMode: FACING[camera] } };
  }
  return { video: camera ? { ...SIZE, deviceId: { exact: camera } } : SIZE };
}

const inputId = (source: SendChoice["audioSource"]) =>
  source?.kind === "input" ? source.deviceId : undefined;

export function sendAudioConstraints(
  source: SendChoice["audioSource"],
): MediaStreamConstraints | DisplayMediaStreamOptions {
  return source?.kind === "system" ? systemAudioConstraints() : audioConstraints(inputId(source));
}

const FRONT_BACK: DeviceOption[] = [
  { deviceId: "front", label: "Front" },
  { deviceId: "back", label: "Back" },
];

/**
 * The camera picker (AC31): Front and Back where the labels show both (iOS "Front Camera", Android
 * "facing front"); else the cameras by name when there are two or more; else none. Labels and ids
 * are empty until the first permission, and there is no second Send after an approval (SD14), so
 * a phone (`phone`: a coarse pointer) is offered Front and Back until then: they ask by facing
 * mode, which needs no label (review C6).
 */
export function cameraChoices(cameras: readonly DeviceOption[], phone = false): DeviceOption[] {
  const known = cameras.filter((c) => c.deviceId !== "");
  if (known.length === 0) return phone ? FRONT_BACK : [];
  const front = known.some((c) => /front/i.test(c.label));
  const back = known.some((c) => /\b(back|rear)\b/i.test(c.label));
  if (front && back) return FRONT_BACK;
  return known.length >= 2 ? [...known] : [];
}

type Media = Pick<MediaDevices, "getUserMedia" | "getDisplayMedia">;

const denied = (e: unknown) => (e as { name?: string } | null)?.name === "NotAllowedError";

export async function openCapture(
  media: Media,
  choice: SendChoice,
): Promise<{ stream: MediaStream } | { reason: string }> {
  const system = choice.audio && choice.audioSource?.kind === "system";
  // Both asked for before either is awaited: the click's activation covers both.
  const [video, audio] = await Promise.allSettled([
    choice.video ? media.getUserMedia(videoConstraints(choice.cameraId)) : null,
    !choice.audio
      ? null
      : system
        ? media.getDisplayMedia(systemAudioConstraints())
        : media.getUserMedia(audioConstraints(inputId(choice.audioSource))),
  ]);
  const tracks: MediaStreamTrack[] = [];
  let reason: string | null = null;
  if (video.status === "fulfilled") tracks.push(...(video.value?.getTracks() ?? []));
  else reason = denied(video.reason) ? SEND_REASON.cameraDenied : SEND_REASON.cameraAbsent;
  if (audio.status === "fulfilled" && audio.value) {
    for (const track of audio.value.getTracks()) {
      if (track.kind === "audio") tracks.push(track);
      else track.stop(); // System audio is a screen share: its picture is not sent
    }
    if (system && audio.value.getAudioTracks().length === 0) {
      reason ??= SEND_REASON.systemNoAudio;
    }
  } else if (audio.status === "rejected") {
    reason ??= system
      ? SEND_REASON.systemCancelled
      : denied(audio.reason)
        ? SEND_REASON.audioDenied
        : SEND_REASON.audioAbsent;
  }
  if (reason !== null) {
    for (const track of tracks) track.stop();
    return { reason };
  }
  return { stream: new MediaStream(tracks) };
}
