// The overlay (spec SD8, SD13, AC12; B-01 SD18): fps, frame time and server health, then the
// in-app latency (last / p95 / worst over 10 s), the render scale, the audio and camera states
// and the wake lock, top left. It is only mounted while shown, so health is asked on show and
// every 5 s after, never while hidden. The server line reads `…` until the first answer (plan
// PD2); the latency reads `–` until the first sample (B-01 PD21). Remote input (B-06 SD3, SD11,
// SD22; plan PD15): `network ms` only while a sender's audio is the analysed source and
// `video ms` only while a sender's camera is drawn, each read from the receiver's statistics on
// every poll; `audio:` and `camera:` name the remote source while one is in use. `latency ms`
// stays the screen machine's own, from the features' capture time (AC30).
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
  /** The network leg of the analysed remote audio; null while none is analysed (B-06 AC28). */
  network: () => Promise<LatencyReading | null>;
  /** The network leg of the drawn remote camera; null while none is drawn (B-06 AC29). */
  video: () => Promise<LatencyReading | null>;
  /** The whole `audio:` and `camera:` lines while a remote source is in use, else null (SD22). */
  remote: () => RemoteLines;
}

export interface RemoteLines {
  audio: string | null;
  camera: string | null;
}

const ms = (v: number) => v.toFixed(1);

const readingLine = (name: string, r: LatencyReading) =>
  r.samples > 0
    ? `${name} ms ${ms(r.last)} / p95 ${ms(r.p95)} / worst ${ms(r.worst)}`
    : `${name} ms – / p95 – / worst –`;

export function Overlay(props: OverlayProps) {
  const { stats, latency, wakeLock, audio, camera, profileName, network, video, remote } = props;
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [frame, setFrame] = useState(stats);
  const [lag, setLag] = useState(latency);
  const [lock, setLock] = useState(wakeLock);
  const [lines, setLines] = useState(remote);
  const [legs, setLegs] = useState<{
    network: LatencyReading | null;
    video: LatencyReading | null;
  }>({ network: null, video: null });

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
    let mounted = true;
    const id = setInterval(() => {
      setFrame(stats());
      setLag(latency());
      setLock(wakeLock());
      setLines(remote());
      void Promise.all([network(), video()]).then(([n, v]) => {
        if (mounted) setLegs({ network: n, video: v });
      });
    }, STATS_EVERY_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [stats, latency, wakeLock, network, video, remote]);

  const latencyLine = lag ? readingLine("latency", lag) : "latency ms – / p95 – / worst –";

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
      {legs.network && (
        <>
          <span data-testid="overlay-network">{readingLine("network", legs.network)}</span>
          {"\n"}
        </>
      )}
      {legs.video && (
        <>
          <span data-testid="overlay-video">{readingLine("video", legs.video)}</span>
          {"\n"}
        </>
      )}
      <span data-testid="overlay-scale">
        scale {frame ? Math.round(frame.renderScale * 100) : 100}%
      </span>
      {"\n"}
      <span data-testid="overlay-audio">{lines.audio ?? `audio: ${audio}`}</span>
      {"\n"}
      <span data-testid="overlay-camera">{lines.camera ?? `camera: ${camera}`}</span>
      {"\n"}
      <span data-testid="overlay-wake-lock">wake lock: {lock}</span>
      {"\n"}
      <span data-testid="overlay-profile">profile: {profileName}</span>
    </pre>
  );
}
