// The settings panel (spec SD6, SD18, UI "Panel (s)"; plan PD12): Start, the two pickers, the
// two dials, the quality cap, the feature meters, the source states and one reason line. It is
// scaffolding over the canvas that B-04's control surface replaces. Keyboard-operable: native
// controls in tab order, each labelled.
import type { AudioFeatures } from "@djv/audio";
import type { Dials, RenderScale } from "@djv/engine";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { DeviceOption } from "./capture/devices.ts";
import type { AudioChoice } from "./capture/remembered.ts";
import type { SessionState } from "./capture/session.ts";

const METERS_EVERY_MS = 100;
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
}

const audioValue = (c: AudioChoice | undefined) =>
  !c ? "" : c.kind === "system" ? "system" : `input:${c.deviceId}`;

/** Options for a picker, keeping a remembered id the browser has not listed yet (PD12). */
function options(
  list: DeviceOption[],
  value: string,
  toValue: (id: string) => string,
  name: string,
) {
  const all = list.map((d) => ({ value: toValue(d.deviceId), label: d.label }));
  if (value && !all.some((o) => o.value === value))
    all.unshift({ value, label: `remembered ${name}` });
  if (!value) all.unshift({ value: "", label: "default" });
  return all.map((o) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  ));
}

function Row({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "9em 1fr", gap: 8, alignItems: "center" }}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

export function Panel(props: PanelProps) {
  const { started, capture, dials, read } = props;
  const [features, setFeatures] = useState(() => read(performance.now()));

  useEffect(() => {
    const id = setInterval(() => setFeatures(read(performance.now())), METERS_EVERY_MS);
    return () => clearInterval(id);
  }, [read]);

  const camera = props.cameraId ?? "";
  const audio = audioValue(props.audioChoice);

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
      <Row label="camera">
        {(id) => (
          <select
            id={id}
            data-testid="camera-picker"
            disabled={!started}
            value={camera}
            onChange={(e) => props.onCamera(e.target.value)}
          >
            {options(props.cameras, camera, (d) => d, "camera")}
          </select>
        )}
      </Row>
      <Row label="audio source">
        {(id) => (
          <select
            id={id}
            data-testid="audio-picker"
            disabled={!started}
            value={audio}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "system") props.onAudio({ kind: "system" });
              else if (v.startsWith("input:"))
                props.onAudio({ kind: "input", deviceId: v.slice(6) });
            }}
          >
            {options(props.audioInputs, audio, (d) => `input:${d}`, "input")}
            {props.systemAudio && <option value="system">System audio</option>}
          </select>
        )}
      </Row>
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
