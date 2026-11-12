// The settings panel (spec SD6, SD18, UI "Panel (s)"; plan PD12; B-02 SD6, SD13): Start, the
// two device pickers, the profile picker with its reason line and a link to the builder, the
// two dials, the quality cap, the feature meters, the source states and one reason line. It is
// scaffolding over the canvas that B-04's control surface replaces. Keyboard-operable: native
// controls in tab order, each labelled.
import type { AudioFeatures } from "@djv/audio";
import type { Dials, RenderScale } from "@djv/engine";
import { useEffect, useState } from "react";
import type { DeviceOption } from "./capture/devices.ts";
import type { AudioChoice } from "./capture/remembered.ts";
import type { SessionState } from "./capture/session.ts";
import type { ActiveState } from "./profiles/active.ts";
import { Row, SourcePickers } from "./SourcePickers.tsx";

const METERS = ["level", "low", "mid", "high", "beat"] as const;

export interface PanelProps {
  started: boolean;
  onStart(): void;
  capture: SessionState;
  cameraId: string | undefined;
  audioChoice: AudioChoice | undefined;
  cameras: DeviceOption[];
  audioInputs: DeviceOption[];
  systemAudio: boolean;
  onCamera(deviceId: string): void;
  onAudio(choice: AudioChoice): void;
  dials: Dials;
  onDials(dials: Dials): void;
  cap: RenderScale;
  onCap(cap: RenderScale): void;
  read(now: number): AudioFeatures;
  profiles: ActiveState;
  onProfile(id: string): void;
}

export function Panel(props: PanelProps) {
  const { started, capture, dials, read } = props;
  const [features, setFeatures] = useState(() => read(performance.now()));

  // The meters follow the features once per animation frame, so a test reading them sees
  // each beat no later than one frame after it (AC6; changed at build 2026-11-12).
  useEffect(() => {
    let id = requestAnimationFrame(function tick() {
      id = requestAnimationFrame(tick);
      setFeatures(read(performance.now()));
    });
    return () => cancelAnimationFrame(id);
  }, [read]);

  return (
    <section
      data-testid="panel"
      aria-label="Settings"
      style={{
        position: "fixed",
        top: 8,
        right: 8,
        width: 340,
        display: "grid",
        gap: 6,
        padding: "8px 10px",
        font: "12px/1.4 monospace",
        color: "#fff",
        background: "rgba(0, 0, 0, 0.75)",
      }}
    >
      {!started && (
        <button type="button" onClick={props.onStart} autoFocus>
          Start
        </button>
      )}
      <SourcePickers
        started={started}
        capture={capture}
        cameraId={props.cameraId}
        audioChoice={props.audioChoice}
        cameras={props.cameras}
        audioInputs={props.audioInputs}
        systemAudio={props.systemAudio}
        onCamera={props.onCamera}
        onAudio={props.onAudio}
      />
      <Row label="profile">
        {(id) => (
          <select
            id={id}
            data-testid="profile-picker"
            disabled={!props.profiles.loaded}
            value={props.profiles.selectedId}
            onChange={(e) => props.onProfile(e.target.value)}
          >
            {props.profiles.entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        )}
      </Row>
      {props.profiles.reason && <div data-testid="profile-reason">{props.profiles.reason}</div>}
      <a href="/builder" data-testid="open-builder" style={{ color: "#fff" }}>
        Open builder
      </a>
      {(["recognisability", "reactivity"] as const).map((dial) => (
        <Row key={dial} label={dial === "reactivity" ? "audio reactivity" : dial}>
          {(id) => (
            <input
              id={id}
              data-testid={`slider-${dial}`}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={dials[dial]}
              onChange={(e) => props.onDials({ ...dials, [dial]: Number(e.target.value) })}
            />
          )}
        </Row>
      ))}
      <Row label="quality cap">
        {(id) => (
          <select
            id={id}
            data-testid="quality-cap"
            value={String(props.cap)}
            onChange={(e) => props.onCap(Number(e.target.value) as RenderScale)}
          >
            <option value="1">100%</option>
            <option value="0.75">75%</option>
            <option value="0.5">50%</option>
          </select>
        )}
      </Row>
      {METERS.map((name) => (
        <Row key={name} label={name}>
          {(id) => (
            <meter
              id={id}
              data-testid={`meter-${name}`}
              data-value={features[name].toFixed(3)}
              min={0}
              max={1}
              value={features[name]}
              style={{ width: "100%" }}
            />
          )}
        </Row>
      ))}
      <div data-testid="panel-camera-state">camera: {capture.camera}</div>
      <div data-testid="panel-audio-state">audio: {capture.audio}</div>
      {capture.reason && <div data-testid="panel-reason">{capture.reason}</div>}
    </section>
  );
}
