// The settings panel (spec SD6, SD18, UI "Panel (s)"; plan PD12; B-02 SD6, SD13): Start, the
// two device pickers, the profile picker with its reason line and a link to the builder, the
// two dials, the quality cap, the feature meters, the source states and one reason line. It is
// scaffolding over the canvas that B-04's control surface replaces. Keyboard-operable: native
// controls in tab order, each labelled. B-04 (SD24): an External control section at the end; the
// panel scrolls when it is taller than the window, never sideways (T18, D-05). B-06 (UI "Panel",
// SD8, SD22): senders' cameras in the camera picker, and a "main audio" row with the playing
// source's line while an audio sender is approved. B-09 (SD8, PD19): under the profile picker, a
// transition select, a duration slider with its seconds readout (off for Cut and Beat cut) and a
// Keep colour checkbox, each changing the page's one choice. B-07 (SD8, SD10, PD19): under them, a
// scene row — a picker, Stage, Go, Rename (a prompt), Delete (a confirm), Export and Import — and
// its status line; no staged editing and no picture; absent in hosted use.
import type { AudioFeatures } from "@djv/audio";
import {
  sceneNameSchema,
  type SceneEntry,
  type SceneResult,
  type Staged,
  type TransitionChoice,
  type TransitionKind,
} from "@djv/shared";
import type { Dials, RenderScale } from "@djv/engine";
import { useEffect, useRef, useState } from "react";
import type { DeviceOption } from "./capture/devices.ts";
import type { AudioChoice } from "./capture/remembered.ts";
import type { SessionState } from "./capture/session.ts";
import { ExternalControl, type SenderEntry, type SenderState } from "./control/ExternalControl.tsx";
import { refusalOf } from "./control/apply.ts";
import type { PanelAction, SceneAsk, ScreenLinkView } from "./control/screen-link.ts";
import { SCENE_PREFIX, type ActiveState } from "./profiles/active.ts";
import { download } from "./profiles/file.ts";
import {
  exportScenes,
  importParts,
  readSceneImport,
  sceneIssueLine,
  toSceneImportIssue,
} from "./scenes/file.ts";
import { durationAt, formatDuration, positionOf } from "./profiles/transition.ts";
import type { AudioSource } from "./remote/main-audio.ts";
import { CloudRow } from "./cloud/CloudRow.tsx";
import { FIT, Row, SourcePickers } from "./SourcePickers.tsx";

const METERS = ["level", "low", "mid", "high", "beat"] as const;

/** B-09 SD1, SD8: the six types, as the controller names them. */
const TRANSITIONS: readonly (readonly [TransitionKind, string])[] = [
  ["cut", "Cut"],
  ["crossfade", "Crossfade"],
  ["dissolve", "Dissolve"],
  ["wipe", "Wipe"],
  ["beatCut", "Beat cut"],
  ["dip", "Dip to colour"],
];

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
  /** B-09 SD8: the current transition, and a change to it (saved and mirrored by the page). */
  transition: TransitionChoice;
  onTransition(change: Partial<TransitionChoice>): void;
  control: ScreenLinkView;
  onControl(action: PanelAction): void;
  /**
   * B-12 (SD1, AC21, AC23): hosted use. No External control block, the line saying where it
   * lives, and "Sign in again" once renewal has failed. Absent on a local install.
   */
  hosted?: { signedOut: boolean; onSignInAgain(): void };
  /** B-12 (UI "Panel, cloud row"): a local install with cloud settings; absent otherwise. */
  cloud?: boolean;
  /** B-07 (SD10): the scene row's facts and actions; absent in hosted use (SD7). */
  scenes?: PanelScenes;
}

export interface PanelScenes {
  /** The saved scenes by name; null when the list could not load. */
  list: SceneEntry[] | null;
  staged: Staged | null;
  /** Stage a saved scene (AC6) and Go (SD3), applied at the next frame as a controller's. */
  stage(id: string): void;
  go(): void;
  /** One request over the screen socket; null when it is not open. */
  ask(request: SceneAsk): Promise<SceneResult | null>;
}

export function Panel(props: PanelProps) {
  const { started, capture, dials, read, mainAudio } = props;
  const fromScene = props.profiles.activeId.startsWith(SCENE_PREFIX);
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
            value={fromScene ? "" : props.profiles.selectedId}
            onChange={(e) => props.onProfile(e.target.value)}
          >
            {/* B-07 PD5: a scene's look is no profile, so the picker selects none. */}
            {fromScene && <option value="" disabled hidden />}
            {props.profiles.entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        )}
      </Row>
      {props.profiles.reason && <div data-testid="profile-reason">{props.profiles.reason}</div>}
      <Row label="transition">
        {(id) => (
          <select
            id={id}
            data-testid="transition-kind"
            style={FIT}
            value={props.transition.kind}
            onChange={(e) => props.onTransition({ kind: e.target.value as TransitionKind })}
          >
            {TRANSITIONS.map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Row>
      <Row label="duration">
        {(id) => (
          <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
            <input
              id={id}
              data-testid="transition-duration"
              type="range"
              min={0}
              max={1}
              step={0.01}
              style={{ minWidth: 0, flex: 1 }}
              disabled={props.transition.kind === "cut" || props.transition.kind === "beatCut"}
              value={positionOf(props.transition.duration)}
              onChange={(e) => props.onTransition({ duration: durationAt(Number(e.target.value)) })}
            />
            <span data-testid="transition-duration-readout">
              {formatDuration(props.transition.duration)}
            </span>
          </div>
        )}
      </Row>
      <Row label="keep colour">
        {(id) => (
          <input
            id={id}
            data-testid="transition-keep-colour"
            type="checkbox"
            style={{ justifySelf: "start" }}
            checked={props.transition.keepColour}
            onChange={(e) => props.onTransition({ keepColour: e.target.checked })}
          />
        )}
      </Row>
      {props.scenes && !props.hosted && <SceneRow scenes={props.scenes} />}
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
      {props.cloud && !props.hosted && <CloudRow />}
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

const plural = (n: number) => `${n} scene${n === 1 ? "" : "s"}`;

/**
 * B-07 (SD8, SD9, SD10, AC6, AC22, AC25; plan PD9, PD19): the scene row. Rename asks through
 * `window.prompt` and Delete through `window.confirm`, so the panel gets no text field. Export
 * fetches every scene and downloads one file; Import checks the file here, then sends it in parts
 * the server stores all or nothing. The status line says what happened, or why nothing did.
 */
function SceneRow({ scenes }: { scenes: PanelScenes }) {
  const { list, staged } = scenes;
  const [chosen, setChosen] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const importId = useRef(0);
  const selected = list?.find((s) => s.id === chosen) ?? list?.[0] ?? null;
  const say = (...lines: string[]) => setStatus(lines);

  const rename = async (scene: SceneEntry) => {
    const answer = window.prompt("Rename scene", scene.name);
    if (answer === null || answer.trim() === scene.name) return;
    const name = sceneNameSchema.safeParse(answer);
    if (!name.success) return say("A name is 1 to 60 characters");
    const result = await scenes.ask({ type: "scenes.rename", id: scene.id, name: name.data });
    say(result?.ok ? `Renamed to ${name.data}` : refusalOf(result));
  };

  const remove = async (scene: SceneEntry) => {
    if (!window.confirm(`Delete ${scene.name}?`)) return;
    const result = await scenes.ask({ type: "scenes.delete", id: scene.id });
    say(result?.ok ? `Deleted ${scene.name}` : refusalOf(result));
  };

  const exportAll = async () => {
    const result = await exportScenes(list ?? [], async (id) => {
      const reply = await scenes.ask({ type: "scenes.get", id });
      return reply?.ok ? (reply.scene ?? null) : null;
    });
    if (result.kind === "empty") return say("No scenes to export");
    if (result.kind === "failed") return say("Export failed: a scene could not be read");
    download(result.text, result.fileName);
    say(`Exported ${plural(result.count)}`);
  };

  const importFile = async (file: File) => {
    const read = readSceneImport(await file.text());
    if (read.kind === "not_json") return say("Not a scenes file");
    if (read.kind === "unsupported_version")
      return say("This file's format version is not supported");
    if (read.kind === "invalid") return say(...read.issues.map(sceneIssueLine));
    const parts = importParts(read.file.scenes);
    const id = ++importId.current;
    for (const [part, chunk] of parts.entries()) {
      const result = await scenes.ask({
        type: "scenes.import",
        importId: id,
        part,
        parts: parts.length,
        scenes: chunk,
      });
      if (!result?.ok) {
        const issues = result?.error?.issues ?? [];
        if (issues.length === 0) return say(refusalOf(result));
        return say(...issues.map((i) => sceneIssueLine(toSceneImportIssue(i))));
      }
    }
    say(`Imported ${plural(read.file.scenes.length)}`);
  };

  const keys = { display: "flex", flexWrap: "wrap", gap: 6 } as const;
  return (
    <>
      <Row label="scene">
        {(id) => (
          <select
            id={id}
            data-testid="panel-scene-picker"
            style={FIT}
            disabled={!list || list.length === 0}
            value={selected?.id ?? ""}
            onChange={(e) => setChosen(e.target.value)}
          >
            {!list && (
              <option value="" disabled>
                Scenes unavailable
              </option>
            )}
            {list?.length === 0 && (
              <option value="" disabled>
                No scenes yet
              </option>
            )}
            {list?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </Row>
      <div style={keys}>
        <button
          type="button"
          data-testid="panel-scene-stage"
          disabled={!selected}
          onClick={() => selected && scenes.stage(selected.id)}
        >
          Stage
        </button>
        <button type="button" data-testid="panel-scene-go" disabled={!staged} onClick={scenes.go}>
          Go
        </button>
        <button
          type="button"
          data-testid="panel-scene-rename"
          disabled={!selected}
          onClick={() => selected && void rename(selected)}
        >
          Rename
        </button>
        <button
          type="button"
          data-testid="panel-scene-delete"
          disabled={!selected}
          onClick={() => selected && void remove(selected)}
        >
          Delete
        </button>
        <button
          type="button"
          data-testid="panel-scene-export"
          disabled={!list || list.length === 0}
          onClick={() => void exportAll()}
        >
          Export
        </button>
        <label>
          Import{" "}
          <input
            type="file"
            accept=".json,application/json"
            data-testid="panel-scene-import"
            disabled={!list}
            style={FIT}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // the same file again is a second import
              setStatus([]);
              if (file) void importFile(file);
            }}
          />
        </label>
      </div>
      {staged && (
        <div data-testid="panel-scene-staged">staged: {staged.fromScene?.name ?? staged.name}</div>
      )}
      {status.length > 0 && (
        <div data-testid="panel-scene-status">
          {status.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </>
  );
}
