// The camera's frames reach the engine through a muted, never-shown video element. Used by the
// output screen and by the builder's preview (B-02 T14), which each own a capture session.

export function createVideo(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  void video.play().catch((e: unknown) => console.warn("camera video did not play", e));
  return video;
}
