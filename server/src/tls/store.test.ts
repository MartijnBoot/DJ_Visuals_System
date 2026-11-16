// T3 (B-06 spec AC3, AC4, AC35, SD4, SD23; plan PD13): the certificate store in a temporary
// folder, with a fake clock and a counting random source.
import { createPrivateKey, X509Certificate } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCertificateStore, RENEW_DAYS, type CertificateStore } from "./store.ts";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-11-16T10:00:00Z");

let dir: string;
let clock: number;
let counter: number;
let lines: { fields: Record<string, unknown>; message: string }[];
let store: CertificateStore;

const make = () =>
  createCertificateStore({
    dir,
    now: () => clock,
    random: (size) => Uint8Array.from({ length: size }, () => (counter++ * 37) % 256),
    log: { info: (fields, message) => void lines.push({ fields, message }) },
  });

const file = (name: string) => readFileSync(join(dir, name));
const snapshot = () =>
  existsSync(dir)
    ? Object.fromEntries(readdirSync(dir).map((n) => [n, file(n).toString("base64")]))
    : null;

const issued = (addresses: string[]) => {
  const result = store.forAddresses(addresses);
  if ("error" in result) throw new Error(`expected certificates, got ${result.error}`);
  return result;
};

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "djv-tls-")), "tls");
  clock = START;
  counter = 1;
  lines = [];
  store = make();
});
afterEach(() => rmSync(join(dir, ".."), { recursive: true, force: true }));

describe("first switch-on (AC1, SD4)", () => {
  it("creates the root and a server certificate: four files, two log lines", () => {
    const result = issued(["192.168.1.5"]);
    expect(readdirSync(dir).sort()).toEqual(["root.crt", "root.key", "server.crt", "server.key"]);
    expect(lines.map((l) => l.message)).toEqual(["root created", "certificate issued"]);
    expect(lines[1]!.fields).toEqual({ addresses: ["192.168.1.5"], expires: "2027-12-17" });
    const root = new X509Certificate(file("root.crt"));
    const server = new X509Certificate(result.cert);
    expect(root.ca).toBe(true);
    expect(server.verify(root.publicKey)).toBe(true);
    expect(server.checkIP("192.168.1.5")).toBe("192.168.1.5");
    expect(server.checkPrivateKey(createPrivateKey(result.key))).toBe(true);
    expect(Buffer.from(result.root).equals(root.raw)).toBe(true);
    expect(result.fingerprint).toMatch(/^[0-9A-F]{16}$/);
    expect(store.fingerprint()).toBe(result.fingerprint);
  });

  it("has no fingerprint before the root exists", () => {
    expect(store.fingerprint()).toBeNull();
  });
});

describe("reuse and reissue (AC3, SD23)", () => {
  it("the same addresses again give the same certificate bytes", () => {
    const first = issued(["192.168.1.5", "10.0.0.7"]);
    const again = make().forAddresses(["10.0.0.7", "192.168.1.5"]);
    expect(again).toEqual(first);
    expect(lines.filter((l) => l.message === "certificate issued")).toHaveLength(1);
  });

  it("another address gives a new server certificate under the same root", () => {
    issued(["192.168.1.5"]);
    const rootBefore = file("root.crt");
    const next = issued(["192.168.1.6"]);
    expect(new X509Certificate(next.cert).checkIP("192.168.1.6")).toBe("192.168.1.6");
    expect(new X509Certificate(next.cert).checkIP("192.168.1.5")).toBeUndefined();
    expect(file("root.crt").equals(rootBefore)).toBe(true);
  });

  it("a subset of the addresses is not exactly them: reissued", () => {
    issued(["192.168.1.5", "10.0.0.7"]);
    const next = issued(["192.168.1.5"]);
    expect(new X509Certificate(next.cert).subjectAltName).toBe("IP Address:192.168.1.5");
  });

  it(`reissues with fewer than ${RENEW_DAYS} days left, reuses with exactly that many`, () => {
    const first = issued(["192.168.1.5"]);
    const expiry = Date.parse(new X509Certificate(first.cert).validTo);
    clock = expiry - RENEW_DAYS * DAY;
    expect(issued(["192.168.1.5"]).cert).toBe(first.cert);
    clock = expiry - (RENEW_DAYS - 1) * DAY;
    const renewed = issued(["192.168.1.5"]);
    expect(renewed.cert).not.toBe(first.cert);
    expect(renewed.fingerprint).toBe(first.fingerprint); // the same root
    expect(RENEW_DAYS).toBe(30);
  });

  it("a truncated server.crt is issued again", () => {
    const first = issued(["192.168.1.5"]);
    writeFileSync(join(dir, "server.crt"), file("server.crt").subarray(0, 40));
    const next = issued(["192.168.1.5"]);
    expect(next.cert).not.toBe(first.cert);
    expect(new X509Certificate(next.cert).checkIP("192.168.1.5")).toBe("192.168.1.5");
  });

  it("a server key that does not match its certificate is issued again", () => {
    issued(["192.168.1.5"]);
    writeFileSync(join(dir, "server.key"), file("root.key"));
    const next = issued(["192.168.1.5"]);
    expect(new X509Certificate(next.cert).checkPrivateKey(createPrivateKey(next.key))).toBe(true);
  });
});

describe("an unreadable root (AC4)", () => {
  const broken = (damage: () => void) => {
    issued(["192.168.1.5"]);
    damage();
    const before = snapshot();
    const result = make().forAddresses(["192.168.1.6"]);
    expect(result).toEqual({ error: "cert_store" });
    expect(snapshot()).toEqual(before);
  };

  it("a truncated root.crt gives cert_store and leaves the folder as it was", () => {
    broken(() => writeFileSync(join(dir, "root.crt"), file("root.crt").subarray(0, 50)));
  });

  it("a missing root.key gives cert_store and leaves the folder as it was", () => {
    broken(() => rmSync(join(dir, "root.key")));
  });

  it("a missing root.crt gives cert_store and leaves the folder as it was", () => {
    broken(() => rmSync(join(dir, "root.crt")));
  });

  it("a root key that does not match its certificate gives cert_store", () => {
    broken(() => writeFileSync(join(dir, "root.key"), file("server.key")));
  });

  it("an unparseable root key gives cert_store", () => {
    broken(() => writeFileSync(join(dir, "root.key"), "not a key"));
  });

  it("has no fingerprint while the root cannot be read", () => {
    issued(["192.168.1.5"]);
    writeFileSync(join(dir, "root.crt"), "garbage");
    expect(make().fingerprint()).toBeNull();
  });
});

describe("keys (SD23, AC35)", () => {
  it("never logs a key", () => {
    issued(["192.168.1.5"]);
    clock += 400 * DAY;
    issued(["192.168.1.6"]);
    for (const line of lines) expect(JSON.stringify(line)).not.toContain("PRIVATE KEY");
  });

  it("writes keys as PKCS#8 PEM and certificates as PEM", () => {
    issued(["192.168.1.5"]);
    for (const name of ["root.key", "server.key"]) {
      expect(file(name).toString()).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    }
    for (const name of ["root.crt", "server.crt"]) {
      expect(file(name).toString()).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
    }
  });

  // SD23: "owner-only where the OS allows". On Windows Node's file modes do not reach the ACL
  // (a 0o600 write reads back 0o666), so the mode is asserted where the OS keeps it.
  it.skipIf(process.platform === "win32")("writes the key files owner-only (0o600)", () => {
    issued(["192.168.1.5"]);
    for (const name of ["root.key", "server.key"]) {
      expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600);
    }
  });
});
