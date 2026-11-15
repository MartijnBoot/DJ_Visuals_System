// VJ mode's additions (B-04 spec SD9, SD17, SD18, AC8, AC23, AC43, UI "/control, VJ mode"): every
// palette swatch (each opens the wheel on its own slot), the status strip — camera, audio, Start,
// link, and the round trip from sending a change to the screen's acknowledgement of the frame that
// applied it, last and p95 over 10 s — and pending requests inline with Accept and Reject.
import type { DeviceEntry, ScreenState } from "@djv/shared";
import { useEffect, useState } from "react";
import { ApprovalList } from "./Approvals.tsx";
import type { RoundTripReading } from "./round-trip.ts";
import { styles } from "./styles.ts";

export interface VjPanelProps {
  state: ScreenState;
  linkText: string;
  locked: boolean;
  pending: readonly DeviceEntry[];
  roundTrip(): RoundTripReading;
  onSwatch(slot: number): void;
  onAccept(deviceId: string): void;
  onReject(deviceId: string): void;
}

const ms = (n: number) => `${Math.round(n)} ms`;

export function VjPanel(props: VjPanelProps) {
  const { state, roundTrip } = props;
  const [trip, setTrip] = useState(roundTrip);
  // Keyed on `roundTrip` alone: every state re-renders this, and restarting the interval on each
  // would freeze the readout while states arrive faster than it refreshes.
  useEffect(() => {
    const id = setInterval(() => setTrip(roundTrip()), 500);
    return () => clearInterval(id);
  }, [roundTrip]);

  return (
    <>
      <section aria-label="Palette" style={{ display: "grid", gap: 8 }}>
        <h2 style={styles.heading}>Palette</h2>
        <div style={styles.row}>
          {state.palette.map((colour, slot) => (
            <button
              key={slot}
              type="button"
              data-testid="swatch"
              data-slot={slot}
              data-colour={colour}
              aria-label={`Colour ${slot + 1}${slot === state.primary ? ", primary" : ""}`}
              disabled={props.locked}
              style={{
                ...styles.button,
                width: 56,
                height: 56,
                background: colour,
                border: slot === state.primary ? "3px solid #f5c518" : "2px solid #fff",
              }}
              onClick={() => props.onSwatch(slot)}
            />
          ))}
        </div>
      </section>

      <section
        aria-label="Status"
        data-testid="status-strip"
        style={{ ...styles.row, ...styles.note, gap: 16 }}
      >
        <span data-testid="status-camera">camera: {state.camera}</span>
        <span data-testid="status-audio">audio: {state.audio}</span>
        <span data-testid="status-started">{state.started ? "started" : "not started"}</span>
        <span data-testid="status-link">link: {props.linkText}</span>
        <span data-testid="round-trip">
          round trip {trip.samples > 0 ? `${ms(trip.last)} / p95 ${ms(trip.p95)}` : "–"}
        </span>
      </section>

      {props.pending.length > 0 && (
        <section aria-label="Waiting for approval" style={{ display: "grid", gap: 8 }}>
          <h2 style={styles.heading}>Waiting for approval</h2>
          <ApprovalList
            pending={props.pending}
            disabled={props.locked}
            onAccept={props.onAccept}
            onReject={props.onReject}
          />
        </section>
      )}
    </>
  );
}
