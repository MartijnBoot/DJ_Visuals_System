// The overlay (spec SD8, SD13, AC12): fps, frame time and server health, top left. It is only
// mounted while shown, so health is asked on show and every 5 s after, never while hidden.
// The server line reads `…` until the first answer (plan PD2).
import type { FrameStats } from "@djv/engine";
import { useEffect, useState } from "react";
import { checkHealth, type ServerStatus } from "./health.ts";

const HEALTH_EVERY_MS = 5000;
const STATS_EVERY_MS = 250;

export function Overlay({ stats }: { stats: () => FrameStats | null }) {
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [frame, setFrame] = useState(stats);

  useEffect(() => {
    let mounted = true;
    const poll = () => {
      void checkHealth().then((status) => {
        if (mounted) setServer(status);
      });
    };
    poll();
    const id = setInterval(poll, HEALTH_EVERY_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setFrame(stats()), STATS_EVERY_MS);
    return () => clearInterval(id);
  }, [stats]);

  return (
    <pre
      data-testid="overlay"
      style={{
        position: "fixed",
        top: 8,
        left: 8,
        margin: 0,
        padding: "6px 8px",
        font: "12px/1.4 monospace",
        color: "#fff",
        background: "rgba(0, 0, 0, 0.6)",
        pointerEvents: "none",
      }}
    >
      <span data-testid="overlay-fps">fps {frame ? frame.fps.toFixed(1) : "–"}</span>
      {"\n"}
      <span data-testid="overlay-frame-ms">
        frame ms {frame ? frame.frameTimeMs.toFixed(1) : "–"}
      </span>
      {"\n"}
      <span data-testid="overlay-server">server: {server ?? "…"}</span>
    </pre>
  );
}
