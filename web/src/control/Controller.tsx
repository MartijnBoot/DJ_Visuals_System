// The controller page, `/control` (B-04 spec SD8, SD9, SD12, SD22, SD23, UI "/control"; plan T12):
// the link line, the code field when opened without a code or key, the DJ/VJ toggle, and the
// controls. It talks only to the device socket; it never starts the engine or audio and never
// asks for a camera or microphone. Every control is disabled while the link is locked (SD12),
// and the page shows the screen's state, never its own guess (SD5).
import type { ScreenState } from "@djv/shared";
import { useEffect, useState, useSyncExternalStore } from "react";
import { WaitingBadge } from "./Approvals.tsx";
import { VjPanel } from "./VjPanel.tsx";
import { Wheel } from "./Wheel.tsx";
import { createDeviceLink, openSocket, type DeviceLink } from "./device-link.ts";
import { keyStore, modeStore, type Mode } from "./remembered.ts";
import { styles } from "./styles.ts";

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

type DialName = (typeof DIALS)[number][0];

export function Controller() {
  const [link] = useState(createLink);
  const [modes] = useState(() => modeStore());
  const [mode, setMode] = useState<Mode>(() => modes.initial(window.innerWidth));
  const [code, setCode] = useState("");
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  /** The palette slot the wheel is open on, or null. */
  const [wheel, setWheel] = useState<number | null>(null);
  // A dial's own value while it is being moved, so the thumb follows the finger; the screen's
  // value otherwise (SD5).
  const [moving, setMoving] = useState<Partial<Record<DialName, number>>>({});
  const view = useSyncExternalStore(
    (fn) => link.subscribe(fn),
    () => link.view(),
  );

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
    <main data-testid="controller" style={styles.page}>
      <div style={styles.column}>
        <div data-testid="link-line" role="status" style={styles.linkLine}>
          {view.text}
        </div>

        {asking && (
          <form
            style={styles.row}
            onSubmit={(e) => {
              e.preventDefault();
              link.submitCode(code);
            }}
          >
            <label style={styles.row}>
              Code
              <input
                data-testid="code-input"
                value={code}
                maxLength={8}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                style={styles.input}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button type="submit" data-testid="code-submit" style={styles.button}>
              Connect
            </button>
          </form>
        )}

        <div style={styles.row} role="group" aria-label="Mode">
          {(["dj", "vj"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`mode-${m}`}
              aria-pressed={mode === m}
              style={mode === m ? styles.active : styles.button}
              onClick={() => choose(m)}
            >
              {m === "dj" ? "DJ" : "VJ"}
            </button>
          ))}
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

        {state && (
          <>
            <section aria-label="Profiles" style={{ display: "grid", gap: 8 }}>
              <div style={styles.row}>
                <h2 style={styles.heading}>Profile</h2>
                <button
                  type="button"
                  data-testid="refresh"
                  disabled={locked}
                  style={styles.button}
                  onClick={() => link.send({ type: "refresh" })}
                >
                  Refresh
                </button>
              </div>
              {state.reason && (
                <div data-testid="controller-reason" style={styles.note}>
                  {state.reason}
                </div>
              )}
              <div style={styles.grid}>
                {state.profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid="profile-tile"
                    data-profile-id={p.id}
                    aria-pressed={p.id === state.activeId}
                    disabled={locked}
                    style={p.id === state.activeId ? styles.activeTile : styles.tile}
                    onClick={() => link.send({ type: "pick", id: p.id })}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </section>

            <section aria-label="Camera" style={{ display: "grid", gap: 8 }}>
              <h2 style={styles.heading}>Camera</h2>
              {!state.started && (
                <div data-testid="camera-note" style={styles.note}>
                  Start on the screen machine
                </div>
              )}
              <div style={styles.grid}>
                {state.cameras.map((c, i) => (
                  <button
                    key={c.deviceId || i}
                    type="button"
                    data-testid="camera-tile"
                    data-camera-id={c.deviceId}
                    aria-pressed={c.deviceId === state.cameraId}
                    disabled={locked || !state.started}
                    style={c.deviceId === state.cameraId ? styles.activeTile : styles.tile}
                    onClick={() => link.send({ type: "camera", deviceId: c.deviceId })}
                  >
                    {c.label || `Camera ${i + 1}`}
                  </button>
                ))}
              </div>
            </section>

            <section aria-label="Dials" style={{ display: "grid", gap: 12 }}>
              {DIALS.map(([dial, label]) => (
                <label key={dial} style={{ display: "grid", gap: 4 }}>
                  {label}
                  <input
                    type="range"
                    data-testid={`dial-${dial}`}
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={locked}
                    value={moving[dial] ?? state.dials[dial]}
                    style={styles.slider}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setMoving((m) => ({ ...m, [dial]: value }));
                      link.send({ type: "dials", [dial]: value });
                    }}
                    onPointerUp={() => setMoving((m) => ({ ...m, [dial]: undefined }))}
                    onBlur={() => setMoving((m) => ({ ...m, [dial]: undefined }))}
                  />
                </label>
              ))}
            </section>

            <section aria-label="Colour" style={styles.row}>
              <button
                type="button"
                data-testid="primary-colour"
                disabled={locked}
                style={{ ...styles.button, display: "flex", gap: 8, alignItems: "center" }}
                onClick={() => setWheel(state.primary)}
              >
                <span
                  aria-hidden
                  data-testid="primary-swatch"
                  data-colour={state.palette[state.primary]}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    border: "1px solid #fff",
                    background: state.palette[state.primary],
                  }}
                />
                Primary colour
              </button>
            </section>

            {mode === "vj" && (
              <VjPanel
                state={state}
                linkText={view.text}
                locked={locked}
                pending={view.pending}
                roundTrip={() => link.roundTrip()}
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
    </main>
  );
}
