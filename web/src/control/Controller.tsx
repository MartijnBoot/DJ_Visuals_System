// The controller page, `/control` (B-04 spec SD8, SD9, SD12, SD22, SD23, UI "/control"; plan T12):
// the link line, the code field when opened without a code or key, the DJ/VJ toggle, and the
// controls. B-19 (SD1, SD4, SD5, SD10, PD3, PD10): the link line in a status bar pinned at the top,
// coloured by the link's group, with DJ mode's waiting badge at its end; everything else in a
// scrolling middle, and the faders in a bank pinned at the bottom or the right edge as the
// viewport's arrangement decides. It talks only to the device socket; it never starts the engine or
// audio and never asks for a camera or microphone. Every control is disabled while the link is
// locked (SD12), and the page shows the screen's state, never its own guess (SD5). Remote input
// (B-06 SD8, AC14, AC20, AC24): a sender's camera tile carries a remote mark and, like every tile,
// waits for Start; "Main audio: laptop / screen machine" shows while an audio sender is approved.
// No control for the screen machine's input or System audio. The look is the style brief's
// (`docs/design/controller-style.md`), in `controller.css`; inline styles only for data-driven
// values (B-19 SD8, SD11).
import type { ScreenState } from "@djv/shared";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { WaitingBadge } from "./Approvals.tsx";
import { FaderBank } from "./FaderBank.tsx";
import { VjPanel } from "./VjPanel.tsx";
import { Wheel } from "./Wheel.tsx";
import { useArrangement } from "./arrangement.ts";
import { createDeviceLink, LINK_GROUP, openSocket, type DeviceLink } from "./device-link.ts";
import { keyStore, modeStore, type Mode } from "./remembered.ts";
// The controller's look (B-19 PD2): a <style> inside this page's own root, never a linked file,
// so no other route has a rule of it and none requests anything new.
import css from "./controller.css?inline";

function createLink(): DeviceLink {
  return createDeviceLink({
    url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/control/device`,
    connect: openSocket,
    storage: keyStore(),
    location: {
      hash: () => location.hash,
      // The code must not stay in the address bar or the history once it has been read (SD19).
      clearHash: () => history.replaceState(null, "", location.pathname + location.search),
    },
    events: {
      onVisible: (fn) =>
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") fn();
        }),
      onOnline: (fn) => window.addEventListener("online", fn),
    },
    now: () => performance.now(),
  });
}

const DIALS = [
  ["recognisability", "Recognisability"],
  ["reactivity", "Audio reactivity"],
] as const;

/** B-06 SD8, SD22: the switch, in DJ and VJ mode while an audio sender is approved. */
const MAIN_AUDIO = [
  ["remote", "laptop"],
  ["local", "screen machine"],
] as const;

/** The choice is the pressed button; this line is what plays (SD22's wording, as the overlay). */
function mainAudioLine(main: NonNullable<ScreenState["mainAudio"]>): string {
  if (main.playing === "remote") return `audio: remote (${main.label}) ok`;
  return main.choice === "remote" ? "audio: local (fallback: remote lost)" : "audio: local";
}

export function Controller() {
  const [link] = useState(createLink);
  const [modes] = useState(() => modeStore());
  const [mode, setMode] = useState<Mode>(() => modes.initial(window.innerWidth));
  const arrangement = useArrangement();
  const [code, setCode] = useState("");
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  /** The palette slot the wheel is open on, or null. */
  const [wheel, setWheel] = useState<number | null>(null);
  const view = useSyncExternalStore(
    (fn) => link.subscribe(fn),
    () => link.view(),
  );
  const roundTrip = useCallback(() => link.roundTrip(), [link]);

  useEffect(() => {
    link.start();
    return () => link.stop();
  }, [link]);

  const choose = (next: Mode) => {
    setMode(next);
    modes.save(next);
  };

  const state: ScreenState | null = view.state;
  const locked = view.locked;
  const asking = !locked
    ? false
    : [
        "needs_code",
        "wrong_code",
        "rejected",
        "expired",
        "too_many",
        "throttled",
        "ended",
      ].includes(view.status);

  return (
    <main data-testid="controller" className="djv-control" data-arrangement={arrangement}>
      <style>{css}</style>
      <div
        data-testid="status-bar"
        className="djv-status"
        data-link-group={LINK_GROUP[view.status]}
      >
        <div data-testid="link-line" role="status" className="djv-status-text">
          {view.text}
        </div>
        {mode === "dj" && (
          <WaitingBadge
            pending={view.pending}
            disabled={locked}
            open={approvalsOpen}
            onOpen={setApprovalsOpen}
            onAccept={(deviceId) => link.send({ type: "accept", deviceId })}
            onReject={(deviceId) => link.send({ type: "reject", deviceId })}
          />
        )}
      </div>

      <div data-testid="control-scroll" className="djv-scroll">
        {asking && (
          <form
            className="djv-row"
            onSubmit={(e) => {
              e.preventDefault();
              link.submitCode(code);
            }}
          >
            <label className="djv-row">
              Code
              <input
                data-testid="code-input"
                value={code}
                maxLength={8}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="djv-code"
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button type="submit" data-testid="code-submit" className="djv-key">
              Connect
            </button>
          </form>
        )}

        <div className="djv-row" role="group" aria-label="Mode">
          {(["dj", "vj"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`mode-${m}`}
              aria-pressed={mode === m}
              className="djv-key djv-mode"
              onClick={() => choose(m)}
            >
              {m === "dj" ? "DJ" : "VJ"}
            </button>
          ))}
        </div>

        {state && (
          <>
            <section aria-label="Profiles" className="djv-section">
              <div className="djv-row">
                <h2 className="djv-legend">Profile</h2>
                <button
                  type="button"
                  data-testid="refresh"
                  disabled={locked}
                  className="djv-key"
                  onClick={() => link.send({ type: "refresh" })}
                >
                  Refresh
                </button>
              </div>
              {state.reason && (
                <div data-testid="controller-reason" className="djv-note">
                  {state.reason}
                </div>
              )}
              <div className="djv-grid">
                {state.profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid="profile-tile"
                    data-profile-id={p.id}
                    aria-pressed={p.id === state.activeId}
                    disabled={locked}
                    className="djv-key djv-tile"
                    onClick={() => link.send({ type: "pick", id: p.id })}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </section>

            <section aria-label="Camera" className="djv-section">
              <h2 className="djv-legend">Camera</h2>
              {!state.started && (
                <div data-testid="camera-note" className="djv-note">
                  Start on the screen machine
                </div>
              )}
              <div className="djv-grid">
                {state.cameras.map((c, i) => (
                  <button
                    key={c.deviceId || i}
                    type="button"
                    data-testid="camera-tile"
                    data-camera-id={c.deviceId}
                    aria-pressed={c.deviceId === state.cameraId}
                    disabled={locked || !state.started}
                    className="djv-key djv-tile"
                    onClick={() => link.send({ type: "camera", deviceId: c.deviceId })}
                  >
                    {c.label || `Camera ${i + 1}`}
                    {c.remote && (
                      <span data-testid="remote-mark" className="djv-remote">
                        · remote
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>

            {state.mainAudio && (
              <section aria-label="Main audio" data-testid="main-audio" className="djv-section">
                <div className="djv-row">
                  <h2 className="djv-legend">Main audio</h2>
                  {MAIN_AUDIO.map(([source, label]) => (
                    <button
                      key={source}
                      type="button"
                      data-testid={`main-audio-${source}`}
                      aria-pressed={state.mainAudio?.choice === source}
                      disabled={locked}
                      className="djv-key"
                      onClick={() => link.send({ type: "mainAudio", source })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div data-testid="main-audio-line" className="djv-note">
                  {mainAudioLine(state.mainAudio)}
                </div>
              </section>
            )}

            <section aria-label="Colour" className="djv-section">
              <div className="djv-row">
                <button
                  type="button"
                  data-testid="primary-colour"
                  disabled={locked}
                  className="djv-key djv-colour-key"
                  onClick={() => setWheel(state.primary)}
                >
                  <span
                    aria-hidden
                    data-testid="primary-swatch"
                    data-colour={state.palette[state.primary]}
                    className="djv-chip"
                    style={{ background: state.palette[state.primary] }}
                  />
                  Primary colour
                </button>
              </div>
            </section>

            {mode === "vj" && (
              <VjPanel
                state={state}
                linkText={view.text}
                locked={locked}
                pending={view.pending}
                roundTrip={roundTrip}
                onSwatch={setWheel}
                onAccept={(deviceId) => link.send({ type: "accept", deviceId })}
                onReject={(deviceId) => link.send({ type: "reject", deviceId })}
              />
            )}

            {wheel !== null && wheel < state.palette.length && (
              <Wheel
                key={wheel}
                slot={wheel}
                current={state.palette[wheel]!}
                stored={state.storedPalette[wheel] ?? state.palette[wheel]!}
                disabled={locked}
                onColour={(value) => link.send({ type: "colour", slot: wheel, value })}
                onReset={() => link.send({ type: "resetColour", slot: wheel })}
                onDone={() => setWheel(null)}
              />
            )}
          </>
        )}
      </div>

      {state && (
        <FaderBank
          arrangement={arrangement}
          locked={locked}
          faders={DIALS.map(([dial, label]) => ({
            testId: `dial-${dial}`,
            label,
            value: state.dials[dial],
            onSend: (value: number) => link.send({ type: "dials", [dial]: value }),
          }))}
        />
      )}
    </main>
  );
}
