// The settings panel (spec SD6, SD18, UI "Panel (s)"; plan PD12; B-02 SD6, SD13): Start, the
// two device pickers, the profile picker with its reason line and a link to the builder, the
// two dials, the quality cap, the feature meters, the source states and one reason line. It is
// scaffolding over the canvas that B-04's control surface replaces. Keyboard-operable: native
// controls in tab order, each labelled. B-04 (SD24): an External control section at the end; the
// panel scrolls when it is taller than the window, never sideways (T18, D-05). B-06 (UI "Panel",
// SD8, SD22): senders' cameras in the camera picker, and a "main audio" row with the playing
// source's line while an audio sender is approved.
import type { AudioFeatures } from "@djv/audio";
import type { Dials, RenderScale } from "@djv/engine";
import { useEffect, useState } from "react";
import type { DeviceOption } from "./capture/devices.ts";
import type { AudioChoice } from "./capture/remembered.ts";
import type { SessionState } from "./capture/session.ts";
import { ExternalControl, type SenderEntry, type SenderState } from "./control/ExternalControl.tsx";
import type { PanelAction, ScreenLinkView } from "./control/screen-link.ts";
import type { ActiveState } from "./profiles/active.ts";
import type { AudioSource } from "./remote/main-audio.ts";
import { FIT, Row, SourcePickers } from "./SourcePickers.tsx";

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
  /** B-06 AC14: the senders' cameras, labelled "<hint> — Device n". */
  remoteCameras: readonly DeviceOption[];
  /** B-06 SD22: the choice and the `audio:` line; null while no audio sender is approved. */
  mainAudio: { choice: AudioSource; line: string } | null;
  onMainAudio(source: AudioSource): void;
  senderState(entry: SenderEntry): SenderState;
  dials: Dials;
  onDials(dials: Dials): void;
  cap: RenderScale;
  onCap(cap: RenderScale): void;
  read(now: number): AudioFeatures;
  profiles: ActiveState;
  onProfile(id: string): void;
  control: ScreenLinkView;
  onControl(action: PanelAction): void;
  /**
   * B-12 (SD1, AC21, AC23): hosted use. No External control block, the line saying where it
   * lives, and "Sign in again" once renewal has failed. Absent on a local install.
   */
  hosted?: { signedOut: boolean; onSignInAgain(): void };
}

export function Panel(props: PanelProps) {
  const { started, capture, dials, read, mainAudio } = props;
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
        // 400 px, never wider than the window; the one column may shrink below its content so
        // nothing in it scrolls the panel sideways (B-04 T18, D-05).
        width: 400,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(100vh - 16px)",
        overflowY: "auto",
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
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
        remoteCameras={props.remoteCameras}
      />
      {mainAudio && (
        <>
          <Row label="main audio">
            {(id) => (
              <select
                id={id}
                data-testid="panel-main-audio"
                style={FIT}
                value={mainAudio.choice}
                onChange={(e) => props.onMainAudio(e.target.value as AudioSource)}
              >
                <option value="remote">remote</option>
                <option value="local">local</option>
              </select>
            )}
          </Row>
          <div data-testid="panel-main-audio-line">{mainAudio.line}</div>
        </>
      )}
      <Row label="profile">
        {(id) => (
          <select
            id={id}
            data-testid="profile-picker"
            disabled={!props.profiles.loaded}
            style={FIT}
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
            style={FIT}
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
      {props.hosted ? (
        <>
          <div data-testid="hosted-control-line">External control needs the local install</div>
          {props.hosted.signedOut && (
            <button type="button" data-testid="sign-in-again" onClick={props.hosted.onSignInAgain}>
              Sign in again
            </button>
          )}
        </>
      ) : (
        <ExternalControl
          view={props.control}
          onAction={props.onControl}
          senderState={props.senderState}
        />
      )}
    </section>
  );
}
