// Pending approval requests on a controller (B-04 spec SD18, AC8, AC10): each with its device hint
// and sequence label, Accept and Reject. VJ mode lists them inline; DJ mode shows a "1 waiting"
// badge that opens the same list as a prompt; B-19 (SD10): the badge sits in the pinned status bar,
// never disabled, so a waiting device is seen and reachable without scrolling. A device never sees
// its own request here: it is not approved while it waits. A sender's request names its role (B-06
// AC8): "<hint> — Device n wants to send video" (or "audio", "video and audio").
import type { DeviceEntry } from "@djv/shared";
import { useEffect, useRef } from "react";
import { styles } from "./styles.ts";

export interface ApprovalsProps {
  pending: readonly DeviceEntry[];
  disabled: boolean;
  onAccept(deviceId: string): void;
  onReject(deviceId: string): void;
}

/** What a request reads: a controller's hint and label, a sender's with the role (B-06 AC8). */
export function requestText(entry: Pick<DeviceEntry, "hint" | "label" | "sends">): string {
  if (entry.sends.length === 0) return `${entry.hint} · ${entry.label}`;
  const role = (["video", "audio"] as const).filter((k) => entry.sends.includes(k)).join(" and ");
  return `${entry.hint} — ${entry.label} wants to send ${role}`;
}

export function ApprovalList({ pending, disabled, onAccept, onReject }: ApprovalsProps) {
  return (
    <ul data-testid="approvals" style={{ ...styles.list, display: "grid", gap: 8 }}>
      {pending.map((entry) => (
        <li key={entry.deviceId} data-device-id={entry.deviceId} style={styles.request}>
          <span data-testid="approval-text" style={{ flex: "1 1 160px" }}>
            {requestText(entry)}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              data-testid="approve"
              disabled={disabled}
              style={styles.button}
              onClick={() => onAccept(entry.deviceId)}
            >
              Accept
            </button>
            <button
              type="button"
              data-testid="refuse"
              disabled={disabled}
              style={styles.button}
              onClick={() => onReject(entry.deviceId)}
            >
              Reject
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** DJ mode's badge and the prompt it opens. */
export function WaitingBadge(
  props: ApprovalsProps & { open: boolean; onOpen(open: boolean): void },
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const count = props.pending.length;
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (props.open && count > 0 && !d.open) d.showModal();
    if ((!props.open || count === 0) && d.open) d.close();
  }, [props.open, count]);
  return (
    <>
      {count > 0 && (
        <button
          type="button"
          data-testid="waiting-badge"
          className="djv-badge"
          onClick={() => props.onOpen(true)}
        >
          {count} waiting
        </button>
      )}
      <dialog
        ref={dialog}
        aria-label="Devices waiting for approval"
        style={styles.dialog}
        onClose={() => props.onOpen(false)}
      >
        <ApprovalList {...props} />
        <button
          type="button"
          style={{ ...styles.button, marginTop: 12, width: "100%" }}
          onClick={() => props.onOpen(false)}
        >
          Close
        </button>
      </dialog>
    </>
  );
}
