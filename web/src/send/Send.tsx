// The sending page, `/send` (B-06 spec SD1, SD12, SD14, SD18, AC13, AC25, AC26, AC31 to AC33,
// UI "Sender"; plan PD3, T18), served by the LAN listener. It asks what to send first — Camera,
// Audio, the camera picker, the audio picker with "System audio" where the browser has it —
// remembered in `djv.sendChoice`; Send opens the capture inside the click and only then requests
// (`send-link.ts`). While sending: the link line, the role, one status line per thing sent (PD3),
// "Keep this page open", a small muted preview and a screen wake lock. A refusal or an ended
// pairing stops the capture (the link does) and offers the choice again; a capture that fails
// shows B-01's reason and requests nothing.
import type { SendKind } from "@djv/shared";
import { useCallback, useEffect, useState } from "react";
import { listDevices, supportsSystemAudio, type DeviceOption } from "../capture/devices.ts";
import { openSocket } from "../control/pair-link.ts";
import { sendChoiceStore, sendKeyStore, type SendChoice } from "../control/remembered.ts";
import { styles } from "../control/styles.ts";
import { createWakeLock } from "../wake-lock.ts";
import { cameraChoices, openCapture } from "./capture.ts";
import { createSendLink, type SendLink, type SendView } from "./send-link.ts";

/** Statuses that end this attempt: the capture is stopped and Send is offered again. */
const OVER = new Set([
  "rejected",
  "expired",
  "wrong_code",
  "too_many",
  "audio_taken",
  "throttled",
  "ended",
]);

const KINDS = ["video", "audio"] as const;
const SYSTEM = "system";

let taken: string | null = null;

/**
 * The code from the QR link, read once per page load and cleared from the address bar (B-04
 * SD19); kept here, since StrictMode calls a state initialiser twice in development.
 */
function takeCode(): string {
  if (taken !== null) return taken;
  const match = /(?:^#|&)code=([^&]*)/.exec(location.hash);
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  let code: string;
  try {
    code = match ? decodeURIComponent(match[1]!) : "";
  } catch {
    code = match![1]!; // not valid percent-encoding: the link reports the wrong code
  }
  return (taken = code);
}

interface Sending {
  link: SendLink;
  stream: MediaStream;
  sends: SendKind[];
}

export function Send() {
  const [choices] = useState(() => sendChoiceStore());
  const [keys] = useState(() => sendKeyStore());
  const [code, setCode] = useState(takeCode);
  /** No code from the link, or the last attempt used it up: the field stays while it is typed. */
  const [askCode, setAskCode] = useState(() => takeCode() === "");
  const [choice, setChoice] = useState<SendChoice>(
    () => choices.load() ?? { video: true, audio: false },
  );
  const [devices, setDevices] = useState<{ cameras: DeviceOption[]; audioInputs: DeviceOption[] }>({
    cameras: [],
    audioInputs: [],
  });
  const [reason, setReason] = useState<string | null>(null);
  const [sending, setSending] = useState<Sending | null>(null);
  const [view, setView] = useState<SendView | null>(null);
  const [wakeLock] = useState(() => createWakeLock(navigator, document));

  const refreshDevices = useCallback(() => {
    void listDevices(navigator.mediaDevices).then(setDevices);
  }, []);
  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
  }, [refreshDevices]);

  useEffect(() => {
    if (!sending) return;
    setView(sending.link.view());
    const unsubscribe = sending.link.subscribe(() => setView(sending.link.view()));
    return () => {
      unsubscribe();
      sending.link.stop();
    };
  }, [sending]);

  const over = view !== null && OVER.has(view.status);
  const live = sending !== null && !over;
  useEffect(() => {
    if (over) void wakeLock.release();
  }, [over, wakeLock]);

  const cameras = cameraChoices(devices.cameras, matchMedia("(pointer: coarse)").matches);
  const cameraId = cameras.some((c) => c.deviceId === choice.cameraId)
    ? choice.cameraId
    : cameras[0]?.deviceId;
  const inputs = devices.audioInputs.filter((d) => d.deviceId !== "");
  const system = supportsSystemAudio(navigator.mediaDevices);
  const audioValue =
    choice.audioSource?.kind === "system"
      ? SYSTEM
      : (inputs.find(
          (d) => choice.audioSource?.kind === "input" && d.deviceId === choice.audioSource.deviceId,
        )?.deviceId ?? "");

  const send = async () => {
    setReason(null);
    const asked: SendChoice = {
      video: choice.video,
      audio: choice.audio,
      ...(cameraId ? { cameraId } : {}),
      ...(choice.audioSource ? { audioSource: choice.audioSource } : {}),
    };
    const opening = openCapture(navigator.mediaDevices, asked); // inside the click (SD1)
    void wakeLock.hold();
    const result = await opening;
    if ("reason" in result) {
      setReason(result.reason);
      void wakeLock.release();
      return;
    }
    choices.save(asked);
    const presented = code.trim();
    setCode("");
    setAskCode(true);
    const link = createSendLink({
      url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/control/device`,
      connect: openSocket,
      storage: keys,
      location: {
        hash: () => (presented ? `#code=${encodeURIComponent(presented)}` : ""),
        clearHash: () => {},
      },
      events: {
        onVisible: (fn) =>
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") fn();
          }),
        onOnline: (fn) => window.addEventListener("online", fn),
      },
      sends: KINDS.filter((k) => asked[k]),
      tracks: result.stream.getTracks(),
      stream: result.stream,
    });
    setSending({ link, stream: result.stream, sends: KINDS.filter((k) => asked[k]) });
    link.start();
    refreshDevices(); // labels and ids are readable once permission is granted
  };

  const needsCode = !live && askCode && keys.load() === null;

  return (
    <main data-testid="sender" style={styles.page}>
      <div style={styles.column}>
        <h1 style={styles.heading}>Send to the screen</h1>
        {view && (
          <div data-testid="link-line" role="status" style={styles.linkLine}>
            {view.text}
          </div>
        )}

        {live ? (
          <>
            <div data-testid="send-role">Sends {sending.sends.join(" and ")}</div>
            {sending.sends.map((kind) =>
              view?.lines[kind] ? (
                <div key={kind}>
                  {kind === "video" ? "Camera" : "Audio"}:{" "}
                  <span data-testid={`send-line-${kind}`}>{view.lines[kind]}</span>
                </div>
              ) : null,
            )}
            <div data-testid="send-keep" style={styles.note}>
              Keep this page open
            </div>
            {sending.sends.includes("video") && (
              <video
                data-testid="send-preview"
                muted
                autoPlay
                playsInline
                style={{ width: 160, borderRadius: 4 }}
                ref={(el) => {
                  if (el && el.srcObject !== sending.stream) el.srcObject = sending.stream;
                }}
              />
            )}
          </>
        ) : (
          <form
            style={{ display: "grid", gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label style={styles.row}>
              <input
                type="checkbox"
                data-testid="send-video"
                checked={choice.video}
                onChange={(e) => setChoice({ ...choice, video: e.target.checked })}
              />
              Camera
            </label>
            {choice.video && cameras.length > 0 && (
              <select
                data-testid="send-camera"
                aria-label="Camera"
                value={cameraId}
                style={styles.input}
                onChange={(e) => setChoice({ ...choice, cameraId: e.target.value })}
              >
                {cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
            <label style={styles.row}>
              <input
                type="checkbox"
                data-testid="send-audio"
                checked={choice.audio}
                onChange={(e) => setChoice({ ...choice, audio: e.target.checked })}
              />
              Audio
            </label>
            {choice.audio && (
              <select
                data-testid="send-audio-source"
                aria-label="Audio"
                value={audioValue}
                style={styles.input}
                onChange={(e) => {
                  const value = e.target.value;
                  const { audioSource: _, ...rest } = choice;
                  setChoice(
                    value === SYSTEM
                      ? { ...rest, audioSource: { kind: "system" } }
                      : value
                        ? { ...rest, audioSource: { kind: "input", deviceId: value } }
                        : rest,
                  );
                }}
              >
                <option value="">Default input</option>
                {inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
                {system && <option value={SYSTEM}>System audio</option>}
              </select>
            )}
            {needsCode && (
              <label style={styles.row}>
                Code
                <input
                  data-testid="send-code"
                  value={code}
                  maxLength={8}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  style={styles.input}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            )}
            <button
              type="submit"
              data-testid="send-button"
              disabled={!choice.video && !choice.audio}
              style={styles.button}
            >
              Send
            </button>
          </form>
        )}

        {reason && (
          <div data-testid="send-reason" role="alert" style={styles.note}>
            {reason}
          </div>
        )}
      </div>
    </main>
  );
}
