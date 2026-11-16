// T2 (B-06 spec AC2, SD5, SD23; plan PD13): the root and the server certificate, read back by
// Node's own parser. Keys are made here; nothing touches a file or the clock.
import { X509Certificate, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fingerprint, rootCertificate, serverCertificate, toPem } from "./certificate.ts";

const DAY = 24 * 60 * 60 * 1000;
const ec = () => generateKeyPairSync("ec", { namedCurve: "P-256" });
const serial = (first: number) => Buffer.from([first, ...Array.from({ length: 15 }, (_, i) => i)]);

const createdAt = new Date("2026-11-16T10:20:30.456Z");
const rootKeys = ec();
const serverKeys = ec();
const addresses = ["192.168.1.5", "10.0.0.7"];

const rootDer = rootCertificate({ key: rootKeys.privateKey, createdAt, serial: serial(0x12) });
const root = new X509Certificate(rootDer);
const serverDer = serverCertificate({
  key: serverKeys.publicKey,
  root: rootDer,
  rootKey: rootKeys.privateKey,
  addresses,
  createdAt,
  serial: serial(0x34),
});
const server = new X509Certificate(serverDer);

const span = (cert: X509Certificate) => ({
  from: new Date(cert.validFrom),
  to: new Date(cert.validTo),
});

describe("rootCertificate (SD23, PD13)", () => {
  it("is a CA with the dated subject, self-issued", () => {
    expect(root.ca).toBe(true);
    expect(root.subject).toBe("CN=DJ Visuals System local root 2026-11-16");
    expect(root.issuer).toBe(root.subject);
    expect(root.checkIssued(root)).toBe(true);
    expect(root.verify(rootKeys.publicKey)).toBe(true);
  });

  it("starts one day before creation and is valid exactly 10 years", () => {
    const { from, to } = span(root);
    expect(from.toISOString()).toBe("2026-11-15T10:20:30.000Z");
    expect(to.toISOString()).toBe("2036-11-15T10:20:30.000Z");
  });

  it("carries the given serial", () => {
    expect(root.serialNumber.toUpperCase()).toBe(serial(0x12).toString("hex").toUpperCase());
  });

  it("holds the root's public key", () => {
    expect(root.publicKey.equals(rootKeys.publicKey)).toBe(true);
  });

  it("reads keyCertSign and cRLSign in its key usage extension", () => {
    // 2.5.29.15, critical, BIT STRING with one unused bit, 0x06.
    expect(Buffer.from(rootDer).includes(Buffer.from("0603551d0f0101ff040403020106", "hex"))).toBe(
      true,
    );
  });
});

describe("serverCertificate (AC2, SD23, PD13)", () => {
  it("verifies with the root's public key and not with another key", () => {
    expect(server.verify(rootKeys.publicKey)).toBe(true);
    expect(server.verify(ec().publicKey)).toBe(false);
    expect(server.checkIssued(root)).toBe(true);
    expect(server.issuer).toBe(root.subject);
  });

  it("is not a CA and holds the server's public key", () => {
    expect(server.ca).toBe(false);
    expect(server.publicKey.equals(serverKeys.publicKey)).toBe(true);
  });

  it("matches each address given by checkIP and no other", () => {
    for (const address of addresses) expect(server.checkIP(address)).toBe(address);
    expect(server.checkIP("10.9.9.9")).toBeUndefined();
    expect(server.checkIP("127.0.0.1")).toBeUndefined();
    expect(server.subjectAltName).toBe("IP Address:192.168.1.5, IP Address:10.0.0.7");
  });

  it("is valid exactly 397 days from one day before creation", () => {
    const { from, to } = span(server);
    expect(from.toISOString()).toBe("2026-11-15T10:20:30.000Z");
    expect(to.getTime() - from.getTime()).toBe(397 * DAY);
  });

  it("is for serverAuth", () => {
    expect(server.keyUsage).toEqual(["1.3.6.1.5.5.7.3.1"]);
  });

  it("names the root's key as its authority key", () => {
    const rootSki = /0603551d0e0416(0414[0-9a-f]{40})/.exec(Buffer.from(rootDer).toString("hex"));
    expect(rootSki).not.toBeNull();
    // authorityKeyIdentifier: SEQUENCE { [0] the same 20 bytes }
    const aki = `0603551d23041830168014${rootSki![1]!.slice(4)}`;
    expect(Buffer.from(serverDer).toString("hex")).toContain(aki);
  });

  it("works with a key pair's private key as the server key too", () => {
    const der = serverCertificate({
      key: serverKeys.privateKey,
      root: rootDer,
      rootKey: rootKeys.privateKey,
      addresses: ["172.16.0.1"],
      createdAt,
      serial: serial(0x01),
    });
    const cert = new X509Certificate(der);
    expect(cert.publicKey.equals(serverKeys.publicKey)).toBe(true);
    expect(cert.checkIP("172.16.0.1")).toBe("172.16.0.1");
  });
});

describe("dates from 2050", () => {
  it("a root valid into 2050 and beyond parses with the right end", () => {
    const der = rootCertificate({
      key: rootKeys.privateKey,
      createdAt: new Date("2045-06-01T00:00:00Z"),
      serial: serial(0x7f),
    });
    const cert = new X509Certificate(der);
    expect(new Date(cert.validTo).toISOString()).toBe("2055-05-31T00:00:00.000Z");
    expect(cert.verify(rootKeys.publicKey)).toBe(true);
  });
});

describe("serials", () => {
  it("a serial with its top bit set still reads as given", () => {
    const der = rootCertificate({ key: rootKeys.privateKey, createdAt, serial: serial(0x80) });
    const cert = new X509Certificate(der);
    expect(cert.serialNumber.toUpperCase().replace(/^00/, "")).toBe(
      serial(0x80).toString("hex").toUpperCase(),
    );
  });
});

describe("toPem and fingerprint", () => {
  it("toPem round-trips through X509Certificate", () => {
    const pem = toPem(rootDer);
    expect(pem).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
    expect(pem).toMatch(/\n-----END CERTIFICATE-----\n$/);
    for (const line of pem.trim().split("\n")) expect(line.length).toBeLessThanOrEqual(64);
    expect(new X509Certificate(pem).raw.equals(Buffer.from(rootDer))).toBe(true);
  });

  it("fingerprint is the first 16 hex characters of the SHA-256, upper case", () => {
    const full = root.fingerprint256.replaceAll(":", "");
    expect(fingerprint(rootDer)).toBe(full.slice(0, 16));
    expect(fingerprint(rootDer)).toMatch(/^[0-9A-F]{16}$/);
  });
});
