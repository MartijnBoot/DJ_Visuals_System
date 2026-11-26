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
// values (B-19 SD8, SD11). Transitions (B-09 SD6, SD7, PD1, PD2): in VJ mode only, a Transition
// section under Profiles — six type tiles, a duration fader in seconds outside the bank, and one
// lit "Keep colour" key — each sending a `transition` control and showing the screen's choice.
// The colour block (B-16 SD1, SD2, SD3, PD10): pinned between the scrolling middle and the bank,
// never a dialog; DJ mode aims it at the primary slot, VJ mode at the swatch last tapped.
// Effect strength (B-18 SD1, SD8, SD10, SD11): the DJ-ticked effect's fader after the two dials in
// the bank, in both modes; in VJ mode an Effects section under Transition with the VJ-ticked ones.
// Scenes (B-07 SD4, SD10, PD20): in VJ mode the Scenes section comes first; while a staged look
// exists its Editing switch decides which look every control below shows and edits
// (`scenes-view.ts`); DJ mode always edits the live look.
import type { ScreenState, TransitionKind } from "@djv/shared";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { WaitingBadge } from "./Approvals.tsx";
import { durationAt, formatDuration, positionOf } from "../profiles/transition.ts";
import { Fader } from "./Fader.tsx";
import { FaderBank } from "./FaderBank.tsx";
import { Scenes } from "./Scenes.tsx";
import { shownLook, withTarget, type Editing } from "./scenes-view.ts";
import { VjPanel } from "./VjPanel.tsx";
import { Wheel } from "./Wheel.tsx";
import { useArrangement } from "./arrangement.ts";
import {
  createDeviceLink,
  LINK_GROUP,
  openSocket,
  type ControlInput,
  type DeviceLink,
} from "./device-link.ts";
import { effectFader, placeEffects, type EffectControl } from "./effect-faders.ts";
import { createSendBudget } from "./send-budget.ts";
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

/** B-09 SD1: the six types, in the spec's order. */
const TRANSITIONS: readonly (readonly [TransitionKind, string])[] = [
  ["cut", "Cut"],
  ["crossfade", "Crossfade"],
  ["dissolve", "Dissolve"],
  ["wipe", "Wipe"],
  ["beatCut", "Beat cut"],
  ["dip", "Dip to colour"],
];

/** B-09 PD16: the duration matters only at the next pick, so it sends at most every 100 ms. */
const DURATION_GAP_MS = 100;

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
  // B-16 SD4, PD3: every send goes through one page-wide budget; a lock drops what waits (SD8).
  const [budget] = useState(() =>
    createSendBudget({
      now: () => performance.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => window.clearTimeout(id),
    }),
  );
  const [modes] = useState(() => modeStore());
  const [mode, setMode] = useState<Mode>(() => modes.initial(window.innerWidth));
  const arrangement = useArrangement();
  const [code, setCode] = useState("");
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  /**
   * VJ mode's wheel target (B-16 SD3), with the profile it was tapped on; null is the primary slot.
   * Page memory only: a reload starts at null.
   */
  const [target, setTarget] = useState<{ slot: number; profile: string | null } | null>(null);
  /** B-07 PD20: the Editing switch, this page's own; never stored. */
  const [editing, setEditing] = useState<Editing>("staged");
  const view = useSyncExternalStore(
    (fn) => link.subscribe(fn),
    () => link.view(),
  );
  const roundTrip = useCallback(() => link.roundTrip(), [link]);

  useEffect(() => {
    link.start();
    return () => link.stop();
  }, [link]);

  useEffect(() => {
    const off = link.subscribe(() => {
      if (link.view().locked) budget.drop();
    });
    return () => {
      off();
      budget.drop();
    };
  }, [link, budget]);

  /** A tap (PD5): through the budget, never replaced. */
  const tap = (send: () => unknown) => budget.tap(() => send() !== null);
  /** One control's newest value (PD5's key): replaces that control's waiting value. */
  const value = (key: string, send: () => unknown) => budget.value(key, () => send() !== null);
  /** B-07 PD20: a control of the seven carries the look the switch reads. */
  const sendTo = (message: ControlInput) => link.send(withTarget(message, edits));
  const sendEffect = (control: EffectControl) => sendTo(control);

  const choose = (next: Mode) => {
    setMode(next);
    modes.save(next);
    if (next === "dj") setTarget(null); // SD3: DJ mode always aims at the primary slot
  };

  const state: ScreenState | null = view.state;
  const hasStaged = Boolean(state?.staged);
  // AC9: a staged look appearing sets the switch to Staged.
  useEffect(() => {
    if (hasStaged) setEditing("staged");
  }, [hasStaged]);
  /** Which look the controls edit: DJ mode and no staged look are always the live one. */
  const edits: Editing = mode === "vj" && hasStaged ? editing : "live";
  const shown = state ? shownLook(state, edits) : null;
  const activeId = shown?.id ?? null;
  const paletteSize = shown?.palette.length ?? 0;
  // SD3, PD1: a new active profile, whoever picked it, sends the wheel back to the primary slot.
  useEffect(() => setTarget(null), [activeId]);
  // PD14: so does a palette without the target's slot, for good: a palette that grows again later
  // does not bring the old target back.
  useEffect(() => {
    if (target && target.slot >= paletteSize) setTarget(null);
  }, [target, paletteSize]);
  /** The wheel's slot (B-16 SD3): DJ mode's is the primary, VJ mode's the target or the primary. */
  const slot = !shown
    ? null
    : mode === "vj" &&
        target !== null &&
        target.profile === activeId &&
        target.slot < shown.palette.length
      ? target.slot
      : shown.primary;
  const locked = view.locked;
  /** B-18 SD8: the bank's effect fader and the Effects section's, for this mode. */
  const placed = placeEffects(shown?.effects ?? [], mode);
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
            onAccept={(deviceId) => tap(() => link.send({ type: "accept", deviceId }))}
            onReject={(deviceId) => tap(() => link.send({ type: "reject", deviceId }))}
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

        {state && shown && (
          <>
            {mode === "vj" && (
              <Scenes
                state={state}
                locked={locked}
                editing={edits}
                onEditing={setEditing}
                send={(message) => tap(() => link.send(message))}
                link={link}
                holder={view.previewHolder}
              />
            )}

            <section aria-label="Profiles" className="djv-section">
              <div className="djv-row">
                <h2 className="djv-legend">Profile</h2>
                <button
                  type="button"
                  data-testid="refresh"
                  disabled={locked}
                  className="djv-key"
                  onClick={() => tap(() => link.send({ type: "refresh" }))}
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
                    aria-pressed={p.id === shown.id}
                    disabled={locked}
                    className="djv-key djv-tile"
                    onClick={() => {
                      // SD3, PD1: any pick, the active profile included, aims at the primary.
                      setTarget(null);
                      tap(() => sendTo({ type: "pick", id: p.id }));
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </section>

            {mode === "vj" && (
              <section aria-label="Transition" className="djv-section">
                <h2 className="djv-legend">Transition</h2>
                <div className="djv-grid">
                  {TRANSITIONS.map(([kind, label]) => (
                    <button
                      key={kind}
                      type="button"
                      data-testid={`transition-${kind}`}
                      aria-pressed={shown.transition.kind === kind}
                      disabled={locked}
                      className="djv-key djv-tile"
                      onClick={() => tap(() => sendTo({ type: "transition", kind }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Fader
                  testId="transition-duration"
                  label="Duration"
                  value={positionOf(shown.transition.duration)}
                  disabled={
                    locked || shown.transition.kind === "cut" || shown.transition.kind === "beatCut"
                  }
                  format={(x) => formatDuration(durationAt(x))}
                  gapMs={DURATION_GAP_MS}
                  onSend={(x) =>
                    value("transition:duration", () =>
                      sendTo({ type: "transition", duration: durationAt(x) }),
                    )
                  }
                />
                <div className="djv-row">
                  <button
                    type="button"
                    data-testid="transition-keep-colour"
                    aria-pressed={shown.transition.keepColour}
                    disabled={locked || edits === "staged"}
                    className="djv-key"
                    onClick={() =>
                      tap(() =>
                        link.send({ type: "transition", keepColour: !state.transition.keepColour }),
                      )
                    }
                  >
                    Keep colour
                  </button>
                </div>
              </section>
            )}

            {mode === "vj" && placed.section.length > 0 && (
              <section aria-label="Effects" data-testid="effects" className="djv-section">
                <h2 className="djv-legend">Effects</h2>
                {placed.section.map((effect) => {
                  const fader = effectFader(effect, shown.id, value, sendEffect);
                  return <Fader key={fader.testId} {...fader} disabled={locked} />;
                })}
              </section>
            )}

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
                    aria-pressed={c.deviceId === shown.cameraId}
                    disabled={locked || !state.started}
                    className="djv-key djv-tile"
                    onClick={() => tap(() => sendTo({ type: "camera", deviceId: c.deviceId }))}
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
                      onClick={() => tap(() => link.send({ type: "mainAudio", source }))}
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

            {mode === "vj" && (
              <VjPanel
                state={{ ...state, palette: shown.palette, primary: shown.primary }}
                linkText={view.text}
                locked={locked}
                pending={view.pending}
                roundTrip={roundTrip}
                target={slot ?? shown.primary}
                onSwatch={(tapped) => setTarget({ slot: tapped, profile: activeId })}
                onAccept={(deviceId) => tap(() => link.send({ type: "accept", deviceId }))}
                onReject={(deviceId) => tap(() => link.send({ type: "reject", deviceId }))}
              />
            )}
          </>
        )}
      </div>

      {shown && slot !== null && (
        <Wheel
          key={`${edits}:${slot}`}
          slot={slot}
          primary={slot === shown.primary}
          current={shown.palette[slot]!}
          stored={shown.storedPalette[slot] ?? shown.palette[slot]!}
          disabled={locked}
          arrangement={arrangement}
          onColour={(hex) =>
            value(`colour:${slot}`, () => sendTo({ type: "colour", slot, value: hex }))
          }
          onReset={() => tap(() => sendTo({ type: "resetColour", slot }))}
        />
      )}

      {shown && (
        <FaderBank
          arrangement={arrangement}
          locked={locked}
          faders={[
            ...DIALS.map(([dial, label]) => ({
              testId: `dial-${dial}`,
              label,
              value: shown.dials[dial],
              onSend: (x: number) =>
                value(`dials:${dial}`, () => sendTo({ type: "dials", [dial]: x })),
            })),
            ...(placed.bank ? [effectFader(placed.bank, shown.id, value, sendEffect)] : []),
          ]}
        />
      )}
    </main>
  );
}
