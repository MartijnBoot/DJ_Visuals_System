// A camera's frames reach the engine through a muted, never-shown video element. Used by the
// output screen and by the builder's preview (B-02 T14), each with its own capture session.
export function createVideo(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  void video.play().catch((e: unknown) => console.warn("camera video did not play", e));
  return video;
}

/** The longest a camera switch waits for the new camera's first frame (B-06 PD14). */
export const VIDEO_READY_MS = 2000;

/** Whether `video` has a decoded frame with a size, the engine can draw (B-06 AC16). */
export const hasFrame = (video: HTMLVideoElement) =>
  video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;

/**
 * Resolves at the first `loadeddata` with a width, or after 2 s (B-06 PD14): the session keeps
 * the old camera on screen until then, so a switch shows no frame of the no-camera look.
 */
export function videoReady(video: HTMLVideoElement, timeoutMs = VIDEO_READY_MS): Promise<void> {
  if (hasFrame(video)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      clearInterval(poll);
      video.removeEventListener("loadeddata", check);
      video.removeEventListener("resize", check);
      resolve();
    };
    const check = () => {
      if (hasFrame(video)) done();
    };
    const timer = setTimeout(done, timeoutMs);
    // `loadeddata` can come before the width is known; a short poll covers that gap.
    const poll = setInterval(check, 50);
    video.addEventListener("loadeddata", check);
    video.addEventListener("resize", check);
  });
}
