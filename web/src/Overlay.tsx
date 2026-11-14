// The overlay (spec SD8, SD13, AC12; B-01 SD18): fps, frame time and server health, then the
// in-app latency (last / p95 / worst over 10 s), the render scale, the audio and camera states
// and the wake lock, top left. It is only mounted while shown, so health is asked on show and
// every 5 s after, never while hidden. The server line reads `…` until the first answer (plan
// PD2); the latency reads `–` until the first sample (B-01 PD21).
import type { EngineStats, LatencyReading } from "@djv/engine";
import { useEffect, useState } from "react";
import type { SourceState } from "./capture/session.ts";
import { checkHealth, type ServerStatus } from "./health.ts";
import type { WakeLockState } from "./wake-lock.ts";

const HEALTH_EVERY_MS = 5000;
const STATS_EVERY_MS = 250;

export interface OverlayProps {
  stats: () => EngineStats | null;
  latency: () => LatencyReading | null;
  wakeLock: () => WakeLockState;
  audio: SourceState;
  camera: SourceState;
  /** The name of the profile on screen (B-02 SD6). */
  profileName: string;
}

const ms = (v: number) => v.toFixed(1);

export function Overlay({ stats, latency, wakeLock, audio, camera, profileName }: OverlayProps) {
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [frame, setFrame] = useState(stats);
  const [lag, setLag] = useState(latency);
  const [lock, setLock] = useState(wakeLock);

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
    const id = setInterval(() => {
      setFrame(stats());
      setLag(latency());
      setLock(wakeLock());
    }, STATS_EVERY_MS);
    return () => clearInterval(id);
  }, [stats, latency, wakeLock]);

  const latencyLine =
    lag && lag.samples > 0
      ? `latency ms ${ms(lag.last)} / p95 ${ms(lag.p95)} / worst ${ms(lag.worst)}`
      : "latency ms – / p95 – / worst –";

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
      {"\n"}
      <span data-testid="overlay-latency">{latencyLine}</span>
      {"\n"}
      <span data-testid="overlay-scale">
        scale {frame ? Math.round(frame.renderScale * 100) : 100}%
      </span>
      {"\n"}
      <span data-testid="overlay-audio">audio: {audio}</span>
      {"\n"}
      <span data-testid="overlay-camera">camera: {camera}</span>
      {"\n"}
      <span data-testid="overlay-wake-lock">wake lock: {lock}</span>
      {"\n"}
      <span data-testid="overlay-profile">profile: {profileName}</span>
    </pre>
  );
}
