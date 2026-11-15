// The panel's External control section (B-04 spec SD2, SD3, SD4, SD14, SD18, SD24, UI "Panel (s),
// External control section"; plan T10). Off: the switch and one line. On: the address picker, the
// QR code, the URL, the code in large type, New code, the devices with Disconnect, the pending
// requests with Accept and Reject. Everything here is DOM in the panel; nothing is drawn on the
// output canvas (AC32), and the code is visible only while the panel is open (SD24).
import type { ControlStatus, DeviceEntry } from "@djv/shared";
import { useMemo, useState } from "react";
import { FIT } from "../SourcePickers.tsx";
import { qrPath } from "./qr.ts";
import { addressStore } from "./remembered.ts";
import type { PanelAction, ScreenLinkView } from "./screen-link.ts";

export interface ExternalControlProps {
  view: ScreenLinkView;
  onAction(action: PanelAction): void;
}

const ERRORS: Record<NonNullable<ControlStatus["error"]>, (port: number) => string> = {
  no_address: () => "No local network address found",
  port_in_use: (port) => `Port ${port} is in use`,
  unavailable: () => "External control unavailable: the listener could not start",
};

const QUIET = 4; // modules of white around the code, as scanners expect

const button = { minHeight: 24, cursor: "pointer" } as const;

function Device({
  entry,
  actions,
}: {
  entry: DeviceEntry;
  actions: { label: string; testId: string; run(): void }[];
}) {
  return (
    <li
      data-device-id={entry.deviceId}
      style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}
    >
      <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {entry.hint} · {entry.label}
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

export function ExternalControl({ view, onAction }: ExternalControlProps) {
  const [store] = useState(() => addressStore());
  const [chosen, setChosen] = useState<string | null>(null);
  const status = view.status;
  const addresses = status?.addresses ?? [];
  const address = addresses.find((a) => a.address === chosen) ?? store.pick(addresses) ?? null;
  const url =
    status?.on && status.code && address
      ? `http://${address.address}:${status.port}/control#code=${status.code}`
      : null;
  const qr = useMemo(() => (url ? qrPath(url) : null), [url]);

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
            {qr && (
              <svg
                data-testid="control-qr"
                role="img"
                aria-label="QR code for the control page"
                viewBox={`${-QUIET} ${-QUIET} ${qr.size + 2 * QUIET} ${qr.size + 2 * QUIET}`}
                width={200}
                height={200}
                shapeRendering="crispEdges"
                style={{ justifySelf: "center", background: "#fff" }}
              >
                <path d={qr.path} fill="#000" />
              </svg>
            )}
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
            <div>devices</div>
            <ul
              data-testid="control-devices"
              style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}
            >
              {status.devices.length === 0 && <li>none</li>}
              {status.devices.map((entry) => (
                <Device
                  key={entry.deviceId}
                  entry={entry}
                  actions={[
                    {
                      label: "Disconnect",
                      testId: "control-disconnect",
                      run: () => onAction({ type: "disconnect", deviceId: entry.deviceId }),
                    },
                  ]}
                />
              ))}
            </ul>
            {status.pending.length > 0 && (
              <>
                <div>waiting for approval</div>
                <ul
                  data-testid="control-pending"
                  style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}
                >
                  {status.pending.map((entry) => (
                    <Device
                      key={entry.deviceId}
                      entry={entry}
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
