// D-22: Chromium's first `new RTCPeerConnection()` in a browser blocks the main thread while it
// starts its WebRTC stack (about 2 s measured headless; every later one takes a few ms, in any
// page). Made inside the output's frame — the preview's sender at Stage (B-07), a remote sender's
// peer (B-06) — that is a frozen output during a set. So the local screen pays it once, after
// `/api/health` has answered and before anything renders: one peer with no ICE server, closed at
// once. Hosted use and the builder make no peer connection and pay nothing.
import type { PageMode } from "./health.ts";

type CreatePeer = (config: RTCConfiguration) => { close(): void };

export function warmUpPeers(
  path: string,
  { mode }: PageMode,
  create: CreatePeer = (config) => new RTCPeerConnection(config),
): void {
  if (mode !== "local" || path === "/builder") return;
  try {
    create({ iceServers: [] }).close();
  } catch {
    // No WebRTC here: the remote sources and the preview say so where they are used.
  }
}
