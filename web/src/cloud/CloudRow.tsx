// The panel's cloud row (B-12 spec UI "Panel, cloud row"; plan PD3, PD4, PD18): rendered only on
// a local install with cloud settings. Not connected + "Connect to cloud" (the provider in a new
// tab); Connected + "Last synced HH:MM" + "Sync now"; "Syncing…"; "Offline — changes will sync";
// the Paused line, which is also "Sync now"'s refusal; "Sign in again"; "n conflicts kept as
// copies" linking to the builder; "Disconnect from cloud" behind a confirm. The status is read
// when the row mounts (the panel opening), as each action's answer, and when the page regains
// focus after the provider's tab was opened. Nothing polls. Nothing is wider than the panel.
import type { CloudStatus } from "@djv/shared";
import { useCallback, useEffect, useState } from "react";
import { connectUrl, disconnect, readStatus, syncNow, type CloudAnswer } from "./api.ts";

const PAUSED = "A set is running — sync resumes when it stops";

const wrap = { overflowWrap: "anywhere", minWidth: 0 } as const;
const button = { minHeight: 24, cursor: "pointer", maxWidth: "100%" } as const;

/** "HH:MM" on this machine's clock (PD4). */
const clock = (iso: string) => {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
};

function line(status: CloudStatus): string {
  switch (status.state) {
    case "not_connected":
      return "Not connected";
    case "connected":
      return status.lastSyncAt ? `Last synced ${clock(status.lastSyncAt)}` : "Connected";
    case "syncing":
      return "Syncing…";
    case "offline":
      return "Offline — changes will sync";
    case "paused":
      return PAUSED;
    case "signed_out":
      return "Signed out of the cloud";
  }
}

export function CloudRow() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const take = useCallback((answer: CloudAnswer) => {
    if (answer.kind === "status") {
      setStatus(answer.status);
      setNote(null);
    } else if (answer.kind === "paused") {
      setNote(PAUSED);
    } else {
      setNote("cloud status unavailable");
    }
  }, []);

  useEffect(() => {
    void readStatus().then(take);
  }, [take]);

  const openProvider = async () => {
    const url = await connectUrl();
    if (!url) {
      setNote("cloud sign-in unavailable");
      return;
    }
    // The owner comes back to this page after signing in: read the status then (PD18).
    window.addEventListener("focus", () => void readStatus().then(take), { once: true });
    window.open(url, "_blank", "noopener");
  };

  const act = async (action: () => Promise<CloudAnswer>) => {
    setBusy(true);
    try {
      take(await action());
    } finally {
      setBusy(false);
    }
  };

  const state = status?.state;
  const connected = state !== undefined && state !== "not_connected";
  return (
    <section
      data-testid="cloud-row"
      aria-label="Cloud"
      style={{ display: "grid", gap: 4, borderTop: "1px solid #444", paddingTop: 6, ...wrap }}
    >
      <div data-testid="cloud-line" style={wrap}>
        cloud: {busy ? "Syncing…" : status ? line(status) : "…"}
      </div>
      {note && (
        <div data-testid="cloud-note" role="status" style={wrap}>
          {note}
        </div>
      )}
      {status && status.conflicts > 0 && (
        <a href="/builder" data-testid="cloud-conflicts" style={{ color: "#fff", ...wrap }}>
          {status.conflicts} conflicts kept as copies
        </a>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {state === "not_connected" && (
          <button
            type="button"
            data-testid="cloud-connect"
            style={button}
            onClick={() => void openProvider()}
          >
            Connect to cloud
          </button>
        )}
        {state === "signed_out" && (
          <button
            type="button"
            data-testid="cloud-sign-in-again"
            style={button}
            onClick={() => void openProvider()}
          >
            Sign in again
          </button>
        )}
        {connected && state !== "signed_out" && (
          <button
            type="button"
            data-testid="cloud-sync-now"
            style={button}
            disabled={busy}
            onClick={() => void act(syncNow)}
          >
            Sync now
          </button>
        )}
        {connected && (
          <button
            type="button"
            data-testid="cloud-disconnect"
            style={button}
            onClick={() => {
              const sure = window.confirm(
                "Disconnect from cloud? Profiles stay on this machine; syncing stops.",
              );
              if (sure) void act(disconnect);
            }}
          >
            Disconnect from cloud
          </button>
        )}
      </div>
    </section>
  );
}
