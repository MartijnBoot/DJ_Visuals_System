// The certificate store (B-06 spec SD4, SD23, AC3, AC4, AC35; plan PD13, T3): the local root and
// the server certificate under `DATA_DIR/tls/` — `root.key`, `root.crt`, `server.key`,
// `server.crt`, PEM, the keys written owner-only where the OS allows. The root is made once; the
// server certificate is reused while its names are exactly the bound addresses and 30 days or
// more remain, else issued again under the same root. A root that is missing its pair, unreadable
// or unparseable, or whose key does not match it, is `cert_store` and nothing is written: starting
// over is deleting the folder (the runbook). This is the only module that reads a key file; logs
// name addresses and dates, never a key.
import {
  createPrivateKey,
  generateKeyPairSync,
  X509Certificate,
  type KeyObject,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fingerprint, rootCertificate, serverCertificate, toPem } from "./certificate.ts";

/** A server certificate with fewer days left than this is issued again (SD23). */
export const RENEW_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export interface CertificateStoreDeps {
  /** `DATA_DIR/tls`. */
  dir: string;
  now(): number;
  /** `size` random bytes (`crypto.getRandomValues` in the product). */
  random(size: number): Uint8Array;
  log: { info(fields: Record<string, unknown>, message: string): void };
}

export interface Certificates {
  /** The server's private key, PEM, for the TLS listener only. */
  key: string;
  /** The server certificate, PEM. */
  cert: string;
  /** The root certificate, DER: what `/trust` hands out (never its key). */
  root: Buffer;
  /** The root's fingerprint (SD24). */
  fingerprint: string;
}

export interface CertificateStore {
  forAddresses(addresses: readonly string[]): Certificates | { error: "cert_store" };
  /** The root's fingerprint, or null while there is no readable root. */
  fingerprint(): string | null;
}

interface Root {
  cert: X509Certificate;
  key: KeyObject;
}

const P256 = { namedCurve: "P-256" } as const;
const pkcs8 = (key: KeyObject) => key.export({ format: "pem", type: "pkcs8" }).toString();
const sameNames = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join() === [...b].sort().join();

/** `IP Address:192.168.1.5, IP Address:10.0.0.7` → the addresses. */
const ipNames = (cert: X509Certificate) =>
  (cert.subjectAltName ?? "")
    .split(", ")
    .filter((n) => n.startsWith("IP Address:"))
    .map((n) => n.slice("IP Address:".length));

export function createCertificateStore(deps: CertificateStoreDeps): CertificateStore {
  const path = (name: string) => join(deps.dir, name);
  const ROOT_KEY = path("root.key");
  const ROOT_CRT = path("root.crt");
  const SERVER_KEY = path("server.key");
  const SERVER_CRT = path("server.crt");

  /** 16 random bytes, top bit cleared (PD13). */
  const serial = () => {
    const bytes = Uint8Array.from(deps.random(16));
    bytes[0]! &= 0x7f;
    return bytes;
  };

  const writeKey = (file: string, key: KeyObject) => {
    writeFileSync(file, pkcs8(key), { mode: 0o600 });
    chmodSync(file, 0o600); // an existing file keeps its mode on write
  };

  /** The stored root, or null when there is none, or "broken". Reads only. */
  const loadRoot = (): Root | null | "broken" => {
    const hasKey = existsSync(ROOT_KEY);
    const hasCert = existsSync(ROOT_CRT);
    if (!hasKey && !hasCert) return null;
    if (!hasKey || !hasCert) return "broken";
    try {
      const cert = new X509Certificate(readFileSync(ROOT_CRT));
      const key = createPrivateKey(readFileSync(ROOT_KEY));
      if (!cert.ca || !cert.checkPrivateKey(key)) return "broken";
      return { cert, key };
    } catch {
      return "broken";
    }
  };

  const createRoot = (): Root => {
    const { privateKey } = generateKeyPairSync("ec", P256);
    const der = rootCertificate({
      key: privateKey,
      createdAt: new Date(deps.now()),
      serial: serial(),
    });
    mkdirSync(deps.dir, { recursive: true });
    writeKey(ROOT_KEY, privateKey);
    writeFileSync(ROOT_CRT, toPem(der));
    deps.log.info({}, "root created");
    return { cert: new X509Certificate(der), key: privateKey };
  };

  /** The stored server certificate when it still fits, else null. */
  const reusable = (root: Root, addresses: readonly string[]) => {
    try {
      const certPem = readFileSync(SERVER_CRT, "utf8");
      const keyPem = readFileSync(SERVER_KEY, "utf8");
      const cert = new X509Certificate(certPem);
      const fits =
        cert.verify(root.cert.publicKey) &&
        cert.checkPrivateKey(createPrivateKey(keyPem)) &&
        sameNames(ipNames(cert), addresses) &&
        Date.parse(cert.validTo) - deps.now() >= RENEW_DAYS * DAY;
      return fits ? { key: keyPem, cert: certPem } : null;
    } catch {
      return null;
    }
  };

  const issue = (root: Root, addresses: readonly string[]) => {
    const { privateKey } = generateKeyPairSync("ec", P256);
    const der = serverCertificate({
      key: privateKey,
      root: root.cert.raw,
      rootKey: root.key,
      addresses,
      createdAt: new Date(deps.now()),
      serial: serial(),
    });
    const cert = toPem(der);
    writeKey(SERVER_KEY, privateKey);
    writeFileSync(SERVER_CRT, cert);
    const expires = new Date(new X509Certificate(der).validTo).toISOString().slice(0, 10);
    deps.log.info({ addresses: [...addresses], expires }, "certificate issued");
    return { key: pkcs8(privateKey), cert };
  };

  return {
    forAddresses(addresses) {
      const stored = loadRoot();
      if (stored === "broken") return { error: "cert_store" };
      const root = stored ?? createRoot();
      const server = reusable(root, addresses) ?? issue(root, addresses);
      return { ...server, root: root.cert.raw, fingerprint: fingerprint(root.cert.raw) };
    },

    fingerprint() {
      const stored = loadRoot();
      return stored === null || stored === "broken" ? null : fingerprint(stored.cert.raw);
    },
  };
}
