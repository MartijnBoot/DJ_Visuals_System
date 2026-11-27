// A scene's feed (B-07 spec SD6; plan PD6, PD7, T6): how the camera on screen is stored, and what
// Go switches to. Pure: the screen page hands in the cameras and the connected video senders it
// already lists. A local camera is matched by its id, then by a label exactly one camera has; a
// remote one when exactly one connected video sender has its hint. Two of a kind is no match:
// the spec keeps the current camera then and says so.
import type { Feed } from "@djv/shared";

export interface LocalCamera {
  deviceId: string;
  label: string;
}

/** A sender whose video is connected now, as `sources.facts` lists it. */
export interface VideoSender {
  deviceId: string;
  hint: string;
}

/** The camera on screen: a local id, a sender's device id, or none. */
export type OnScreen = { kind: "local"; deviceId: string } | { kind: "remote"; deviceId: string };

/** `capture/devices.ts` names a camera the browser gave no label "Camera n": never stored (PD6). */
const FALLBACK = /^Camera \d+$/;

const browserLabel = (label: string) => (FALLBACK.test(label) ? "" : label);

/** What a scene stores for the camera on screen. */
export function feedOf(
  onScreen: OnScreen | null,
  cameras: readonly LocalCamera[],
  senders: readonly VideoSender[],
): Feed | null {
  if (!onScreen) return null;
  if (onScreen.kind === "remote") {
    const sender = senders.find((s) => s.deviceId === onScreen.deviceId);
    return sender ? { kind: "remote", hint: sender.hint } : null;
  }
  const camera = cameras.find((c) => c.deviceId === onScreen.deviceId);
  return { kind: "local", deviceId: onScreen.deviceId, label: browserLabel(camera?.label ?? "") };
}

/** The camera id Go switches to (local, or `remote:<deviceId>`), or null for no match (AC16). */
export function matchFeed(
  feed: Feed,
  cameras: readonly LocalCamera[],
  senders: readonly VideoSender[],
): string | null {
  if (feed.kind === "remote") {
    const found = senders.filter((s) => s.hint === feed.hint);
    return found.length === 1 ? `remote:${found[0]!.deviceId}` : null;
  }
  if (cameras.some((c) => c.deviceId === feed.deviceId)) return feed.deviceId;
  if (feed.label === "") return null;
  const found = cameras.filter((c) => browserLabel(c.label) === feed.label);
  return found.length === 1 ? found[0]!.deviceId : null;
}
