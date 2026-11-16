// The panel's External control section (B-04 spec SD2, SD3, SD4, SD14, SD18, SD24, UI "Panel (s),
// External control section"; plan T10). Off: the switch and one line. On: the address picker, the
// QR code, the URL, the code in large type, New code, the devices with Disconnect, the pending
// requests with Accept and Reject. Everything here is DOM in the panel; nothing is drawn on the
// output canvas (AC32), and the code is visible only while the panel is open (SD24). B-06 (UI
// "Panel", SD15, PD5, PD16): the trust block, then the `/control` QR and code, the `/send` QR,
// the controllers, the senders apart with their role and connection state, and pending requests
// naming the role. A sender's state is read from the page's own peer on each render, and the
// section renders every `SENDER_POLL_MS` while a sender is listed, so a connection change and the
// 10 s "Could not reach" (AC13) show without an event.
import type { ControlStatus, DeviceEntry } from "@djv/shared";
import { useEffect, useMemo, useState } from "react";
import { FIT } from "../SourcePickers.tsx";
import { requestText } from "./Approvals.tsx";
import { qrPath } from "./qr.ts";
import { addressStore } from "./remembered.ts";
import type { PanelAction, ScreenLinkView } from "./screen-link.ts";

/** B-06 PD5: a sender's connection as the panel shows it. */
export type SenderState = "connecting" | "connected" | "on screen" | "lost" | "could not reach";

export type SenderEntry = ControlStatus["senders"][number];

export interface ExternalControlProps {
  view: ScreenLinkView;
  onAction(action: PanelAction): void;
  senderState(entry: SenderEntry): SenderState;
}

/** AC13, word for word. */
const UNREACHABLE =
  "Could not reach the screen machine — the network may block devices from talking to each other";

/** "<hint> — Device n · video and audio · <state>" (UI "Panel"). */
function senderText(entry: SenderEntry, state: SenderState): string {
  const role = (["video", "audio"] as const).filter((k) => entry.sends.includes(k)).join(" and ");
  const shown = state === "could not reach" ? UNREACHABLE : state;
  return `${entry.hint} — ${entry.label} · ${role} · ${shown}`;
}

const ERRORS: Record<NonNullable<ControlStatus["error"]>, (port: number) => string> = {
  no_address: () => "No local network address found",
  port_in_use: (port) => `Port ${port} is in use`,
  unavailable: () => "External control unavailable: the listener could not start",
  cert_store: () => "Certificate store unreadable — see the runbook",
};

/** How often the senders' states are read while any is listed. */
const SENDER_POLL_MS = 500;

const QUIET = 4; // modules of white around the code, as scanners expect

const button = { minHeight: 24, cursor: "pointer" } as const;

function Device({
  entry,
  text,
  actions,
}: {
  entry: DeviceEntry;
  text: string;
  actions: { label: string; testId: string; run(): void }[];
}) {
  return (
    <li
      data-device-id={entry.deviceId}
      style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}
    >
      <span data-testid="control-device-text" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {text}
      </span>
      <span style={{ display: "flex", gap: 4 }}>
        {actions.map((a) => (
          <button
            key={a.testId}
            type="button"
            data-testid={a.testId}
            style={button}
            onClick={a.run}
          >
            {a.label}
          </button>
        ))}
      </span>
    </li>
  );
}

/** A QR code as SVG, with the quiet zone scanners expect. */
function QrCode({ url, testId, label }: { url: string; testId: string; label: string }) {
  const qr = useMemo(() => qrPath(url), [url]);
  return (
    <svg
      data-testid={testId}
      role="img"
      aria-label={label}
      viewBox={`${-QUIET} ${-QUIET} ${qr.size + 2 * QUIET} ${qr.size + 2 * QUIET}`}
      width={200}
      height={200}
      shapeRendering="crispEdges"
      style={{ justifySelf: "center", background: "#fff" }}
    >
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

/** B-06 SD24: the first step on a new device — trust the screen machine's root once. */
function Trust({ url, fingerprint }: { url: string; fingerprint: string | null }) {
  return (
    <div data-testid="control-trust" style={{ display: "grid", gap: 6 }}>
      <div>Install once per device</div>
      <QrCode url={url} testId="control-trust-qr" label="QR code for the trust page" />
      <div data-testid="control-trust-url" style={{ wordBreak: "break-all" }}>
        {url}
      </div>
      {fingerprint && (
        <div>
          fingerprint{" "}
          <span data-testid="control-trust-fingerprint" style={{ fontFamily: "monospace" }}>
            {fingerprint}
          </span>
        </div>
      )}
    </div>
  );
}

const list = { margin: 0, paddingLeft: 0, listStyle: "none" } as const;

export function ExternalControl({ view, onAction, senderState }: ExternalControlProps) {
  const [store] = useState(() => addressStore());
  const [chosen, setChosen] = useState<string | null>(null);
  const status = view.status;
  const [, tick] = useState(0);
  const listed = status?.senders.length ?? 0;
  useEffect(() => {
    if (listed === 0) return;
    const id = setInterval(() => tick((n) => n + 1), SENDER_POLL_MS);
    return () => clearInterval(id);
  }, [listed]);
  const addresses = status?.addresses ?? [];
  const address = addresses.find((a) => a.address === chosen) ?? store.pick(addresses) ?? null;
  const url =
    status?.on && status.code && address
      ? `https://${address.address}:${status.port}/control#code=${status.code}`
      : null;
  const trustUrl = status?.on && address ? `https://${address.address}:${status.port}/trust` : null;
  const sendUrl = url?.replace("/control#", "/send#") ?? null; // the same code (PD16)
  const disconnect = (entry: DeviceEntry) => ({
    label: "Disconnect",
    testId: "control-disconnect",
    run: () => onAction({ type: "disconnect", deviceId: entry.deviceId }),
  });

  let body;
  if (view.superseded) {
    body = <div data-testid="control-other-tab">External control is on another screen tab</div>;
  } else if (!status) {
    body =
      view.connection === "down" ? (
        <div data-testid="control-unreachable">
          External control unavailable: server unreachable
        </div>
      ) : null;
  } else {
    body = (
      <>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            role="switch"
            data-testid="control-switch"
            checked={status.on}
            onChange={(e) => onAction({ type: e.target.checked ? "enable" : "disable" })}
          />
          External control {status.on ? "on" : "off"}
        </label>
        {status.error && <div data-testid="control-error">{ERRORS[status.error](status.port)}</div>}
        {!status.on && (
          <div data-testid="control-off-line">
            Lets a phone, tablet or laptop on this network control the visuals
          </div>
        )}
        {status.on && address && (
          <>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              address
              <select
                data-testid="control-address"
                style={{ ...FIT, flex: 1 }}
                value={address.address}
                onChange={(e) => {
                  setChosen(e.target.value);
                  store.save(e.target.value);
                }}
              >
                {addresses.map((a) => (
                  <option key={a.address} value={a.address}>
                    {a.name} — {a.address}
                  </option>
                ))}
              </select>
            </label>
            {trustUrl && <Trust url={trustUrl} fingerprint={status.fingerprint} />}
            {url && <QrCode url={url} testId="control-qr" label="QR code for the control page" />}
            <div data-testid="control-url" style={{ wordBreak: "break-all" }}>
              {url}
            </div>
            <div
              data-testid="control-code"
              aria-label="pairing code"
              style={{ font: "bold 28px/1.2 monospace", letterSpacing: 4, textAlign: "center" }}
            >
              {status.code}
            </div>
            <button
              type="button"
              data-testid="control-new-code"
              style={button}
              onClick={() => onAction({ type: "newCode" })}
            >
              New code
            </button>
            {sendUrl && (
              <>
                <div>send video or audio from a device</div>
                <QrCode url={sendUrl} testId="control-send-qr" label="QR code for the send page" />
                <div data-testid="control-send-url" style={{ wordBreak: "break-all" }}>
                  {sendUrl}
                </div>
              </>
            )}
            <div>controllers</div>
            <ul data-testid="control-devices" style={list}>
              {status.devices.length === 0 && <li>none</li>}
              {status.devices.map((entry) => (
                <Device
                  key={entry.deviceId}
                  entry={entry}
                  text={requestText(entry)}
                  actions={[disconnect(entry)]}
                />
              ))}
            </ul>
            <div>senders</div>
            <ul data-testid="control-senders" style={list}>
              {status.senders.length === 0 && <li>none</li>}
              {status.senders.map((entry) => (
                <Device
                  key={entry.deviceId}
                  entry={entry}
                  text={senderText(entry, senderState(entry))}
                  actions={[disconnect(entry)]}
                />
              ))}
            </ul>
            {status.pending.length > 0 && (
              <>
                <div>waiting for approval</div>
                <ul data-testid="control-pending" style={list}>
                  {status.pending.map((entry) => (
                    <Device
                      key={entry.deviceId}
                      entry={entry}
                      text={requestText(entry)}
                      actions={[
                        {
                          label: "Accept",
                          testId: "control-accept",
                          run: () => onAction({ type: "accept", deviceId: entry.deviceId }),
                        },
                        {
                          label: "Reject",
                          testId: "control-reject",
                          run: () => onAction({ type: "reject", deviceId: entry.deviceId }),
                        },
                      ]}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <section
      data-testid="control-section"
      aria-label="External control"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: 6,
        borderTop: "1px solid #666",
        paddingTop: 6,
      }}
    >
      {body}
    </section>
  );
}
