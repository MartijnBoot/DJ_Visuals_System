// The screen's audio-to-engine feed (B-08 PD10): each frame reads the newest audio features
// and hands them to the engine before it draws. The order lives here so it is tested
// (`frame-feed.test.ts`, B-08 AC4) and is the order the product runs.
import type { AudioFeatures, Engine } from "@djv/engine";

/** Starts the feed, then the engine; returns a stop for the feed (the engine stops itself). */
export function startFrameFeed(
  engine: Pick<Engine, "start" | "setFeatures">,
  read: () => AudioFeatures,
): () => void {
  // Registered before the engine's loop: frame callbacks run in registration order, so each
  // frame's features are read just before the engine draws with them.
  let feed = requestAnimationFrame(function tick() {
    feed = requestAnimationFrame(tick);
    engine.setFeatures(read());
  });
  engine.start();
  return () => cancelAnimationFrame(feed);
}
