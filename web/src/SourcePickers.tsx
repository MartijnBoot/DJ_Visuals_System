// The camera and audio-source rows (B-01 spec SD6, SD18; plan PD12), shared by the output
// screen's panel and the builder's preview (B-02 T14). Moved out of `Panel.tsx` unchanged, with
// the same test ids. Native controls in tab order, each labelled.
import { useId, type ReactNode } from "react";
import type { DeviceOption } from "./capture/devices.ts";
import type { AudioChoice } from "./capture/remembered.ts";
import type { SessionState } from "./capture/session.ts";

export interface SourcePickersProps {
  started: boolean;
  capture: SessionState;
  cameraId: string | undefined;
  audioChoice: AudioChoice | undefined;
  cameras: DeviceOption[];
  audioInputs: DeviceOption[];
  systemAudio: boolean;
  onCamera(deviceId: string): void;
  onAudio(choice: AudioChoice): void;
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

export function Row({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "9em 1fr", gap: 8, alignItems: "center" }}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}

export function SourcePickers(props: SourcePickersProps) {
  const { started, capture } = props;
  const camera = props.cameraId ?? "";
  // A stopped share leaves the picker on a placeholder, so choosing "System audio" again is a
  // change the browser reports (review C3); otherwise the select already shows it and stays mute.
  const systemStopped = props.audioChoice?.kind === "system" && capture.audio === "lost";
  const audio = systemStopped ? "stopped" : audioValue(props.audioChoice);

  return (
    <>
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
            {systemStopped ? (
              <option value="stopped" disabled>
                system audio stopped
              </option>
            ) : (
              options(props.audioInputs, audio, (d) => `input:${d}`, "input")
            )}
            {systemStopped &&
              props.audioInputs.map((d) => (
                <option key={d.deviceId} value={`input:${d.deviceId}`}>
                  {d.label}
                </option>
              ))}
            {props.systemAudio && <option value="system">System audio</option>}
          </select>
        )}
      </Row>
    </>
  );
}
