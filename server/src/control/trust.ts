// The trust step (B-06 spec SD24, AC5, AC6, AC35; plan PD1, T6): `GET /trust` on the LAN listener
// answers a small page the server writes itself — no script, no asset, since it is the one page a
// device opens before it trusts the root — with the root's fingerprint, the steps per OS and a
// download button; `GET /trust?download` answers the root certificate as
// `application/x-x509-ca-cert`, the response iOS turns into a profile install. Same path, so the
// listener's routes stay AC5's list. Handed the root certificate and its fingerprint only: never
// the store, never a key.
import { X509Certificate } from "node:crypto";
import type { LanApp } from "./lan.ts";

export interface TrustDeps {
  /** The root certificate, DER. */
  root: Buffer;
  /** Its fingerprint, as the panel shows it. */
  fingerprint: string;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The steps per OS: the builder's draft, corrected by the owner's H1. */
const STEPS: readonly [string, readonly string[]][] = [
  [
    "iPhone and iPad",
    [
      "Tap Download certificate, then Allow.",
      "Open Settings → General → VPN & Device Management, tap the downloaded profile and Install it.",
      "Open Settings → General → About → Certificate Trust Settings and turn on full trust for the root named below.",
    ],
  ],
  [
    "Android",
    [
      "Tap Download certificate.",
      "Open Settings → Security → More security settings → Encryption & credentials → Install a certificate → CA certificate, and choose the downloaded file.",
    ],
  ],
  [
    "Windows",
    [
      "Download the certificate and open it.",
      "Choose Install Certificate → Current User → Place all certificates in the following store → Trusted Root Certification Authorities, then Finish and Yes.",
      "Restart the browser.",
    ],
  ],
  [
    "macOS",
    [
      "Download the certificate and open it: Keychain Access adds it to the login keychain.",
      "Double-click the root named below, open Trust and set When using this certificate to Always Trust.",
      "Restart the browser.",
    ],
  ],
];

export function trustPage({ root, fingerprint }: TrustDeps): string {
  const name = new X509Certificate(root).subject.replace(/^CN=/, "");
  const steps = STEPS.map(
    ([os, list]) =>
      `<h2>${escape(os)}</h2><ol>${list.map((s) => `<li>${escape(s)}</li>`).join("")}</ol>`,
  ).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trust DJ Visuals System</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:0 auto;padding:1rem;background:#111;color:#eee}
a.download{display:inline-block;padding:.75rem 1.25rem;background:#eee;color:#111;border-radius:.5rem;text-decoration:none;font-weight:bold}
code{font-size:1.4rem;letter-spacing:.1rem}
</style></head>
<body>
<h1>Install once per device</h1>
<p>This device needs to trust the screen machine's own certificate once. Then the control and
send pages open here with no warning.</p>
<p><a class="download" data-testid="trust-download" href="/trust?download">Download certificate</a></p>
<p>Root: <strong data-testid="trust-name">${escape(name)}</strong></p>
<p>Fingerprint — compare with the screen machine's panel:<br>
<code data-testid="trust-fingerprint">${escape(fingerprint)}</code></p>
${steps}
</body></html>
`;
}

export function registerTrust(app: LanApp, deps: TrustDeps): void {
  const page = trustPage(deps);
  app.get("/trust", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if ("download" in query) {
      return reply
        .type("application/x-x509-ca-cert")
        .header("content-disposition", 'attachment; filename="dj-visuals-root.crt"')
        .send(deps.root);
    }
    return reply
      .type("text/html; charset=utf-8")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
      .send(page);
  });
}
