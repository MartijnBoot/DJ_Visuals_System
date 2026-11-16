// The two certificate shapes of the local CA (B-06 spec SD5, SD23; plan PD13): the root and the
// server certificate for the bound private addresses, EC P-256 signed with ECDSA-SHA256, as DER.
// Keys come in as KeyObjects and the time as a Date; nothing here touches a file or the clock.
import { createHash, createPublicKey, sign, X509Certificate, type KeyObject } from "node:crypto";
import { isIPv4 } from "node:net";
import {
  bitString,
  boolean,
  explicit,
  implicit,
  integer,
  octetString,
  oid,
  sequence,
  set,
  time,
  utf8,
} from "./der.ts";

const DAY = 24 * 60 * 60 * 1000;
export const SERVER_DAYS = 397;
export const ROOT_YEARS = 10;

const OID = {
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
  commonName: "2.5.4.3",
  subjectKeyIdentifier: "2.5.29.14",
  keyUsage: "2.5.29.15",
  subjectAltName: "2.5.29.17",
  basicConstraints: "2.5.29.19",
  authorityKeyIdentifier: "2.5.29.35",
  extKeyUsage: "2.5.29.37",
  serverAuth: "1.3.6.1.5.5.7.3.1",
} as const;

const SIGNATURE_ALGORITHM = sequence(oid(OID.ecdsaWithSha256));

const name = (commonName: string) => sequence(set(sequence(oid(OID.commonName), utf8(commonName))));

const extension = (id: string, critical: boolean, value: Uint8Array) =>
  critical
    ? sequence(oid(id), boolean(true), octetString(value))
    : sequence(oid(id), octetString(value));

const publicOf = (key: KeyObject) => (key.type === "public" ? key : createPublicKey(key));

/** SHA-256 of the public key's point, first 20 bytes (PD13). */
function keyIdentifier(key: KeyObject): Buffer {
  const spki = publicOf(key).export({ format: "der", type: "spki" });
  // The SubjectPublicKeyInfo ends with the BIT STRING of the point; for P-256 it is the last
  // 65 bytes (0x04 || x || y).
  return createHash("sha256")
    .update(spki.subarray(spki.length - 65))
    .digest()
    .subarray(0, 20);
}

/** Whole seconds, starting one day before creation (PD13: a phone whose clock runs behind). */
function notBefore(createdAt: Date): Date {
  const start = new Date(createdAt.getTime() - DAY);
  start.setUTCMilliseconds(0);
  return start;
}

function signed(tbs: Buffer, issuerKey: KeyObject): Buffer {
  const signature = sign("sha256", tbs, issuerKey);
  return sequence(tbs, SIGNATURE_ALGORITHM, bitString(signature));
}

function tbsCertificate(fields: {
  serial: Uint8Array;
  issuer: Buffer;
  from: Date;
  to: Date;
  subject: Buffer;
  key: KeyObject;
  extensions: Buffer[];
}): Buffer {
  const spki = publicOf(fields.key).export({ format: "der", type: "spki" });
  return sequence(
    explicit(0, integer(2)), // v3
    integer(fields.serial),
    SIGNATURE_ALGORITHM,
    fields.issuer,
    sequence(time(fields.from), time(fields.to)),
    fields.subject,
    spki,
    explicit(3, sequence(...fields.extensions)),
  );
}

export function rootSubject(createdAt: Date): string {
  return `DJ Visuals System local root ${createdAt.toISOString().slice(0, 10)}`;
}

/** The root: a CA valid 10 years, keyCertSign and cRLSign, self-signed with `key`. */
export function rootCertificate(input: {
  key: KeyObject;
  createdAt: Date;
  serial: Uint8Array;
}): Buffer {
  const from = notBefore(input.createdAt);
  const to = new Date(from);
  to.setUTCFullYear(to.getUTCFullYear() + ROOT_YEARS);
  const subject = name(rootSubject(input.createdAt));
  const tbs = tbsCertificate({
    serial: input.serial,
    issuer: subject,
    from,
    to,
    subject,
    key: input.key,
    extensions: [
      extension(OID.basicConstraints, true, sequence(boolean(true))),
      // keyCertSign (bit 5) and cRLSign (bit 6): 0b0000_0110, one unused bit.
      extension(OID.keyUsage, true, bitString(Buffer.from([0x06]), 1)),
      extension(OID.subjectKeyIdentifier, false, octetString(keyIdentifier(input.key))),
    ],
  });
  return signed(tbs, input.key);
}

/** The server certificate: valid 397 days, serverAuth, IP names exactly `addresses`. */
export function serverCertificate(input: {
  key: KeyObject;
  root: Uint8Array;
  rootKey: KeyObject;
  addresses: readonly string[];
  createdAt: Date;
  serial: Uint8Array;
}): Buffer {
  const issuer = new X509Certificate(input.root);
  const from = notBefore(input.createdAt);
  const to = new Date(from.getTime() + SERVER_DAYS * DAY);
  const names = input.addresses.map((address) => {
    if (!isIPv4(address)) throw new Error(`not an IPv4 address: ${address}`);
    return implicit(7, Buffer.from(address.split(".").map(Number)));
  });
  const tbs = tbsCertificate({
    serial: input.serial,
    issuer: name(issuer.subject.replace(/^CN=/, "")),
    from,
    to,
    subject: name("DJ Visuals System"),
    key: input.key,
    extensions: [
      extension(OID.basicConstraints, true, sequence()),
      // digitalSignature (bit 0): 0b1000_0000, seven unused bits.
      extension(OID.keyUsage, true, bitString(Buffer.from([0x80]), 7)),
      extension(OID.extKeyUsage, false, sequence(oid(OID.serverAuth))),
      extension(OID.subjectAltName, false, sequence(...names)),
      extension(OID.subjectKeyIdentifier, false, octetString(keyIdentifier(input.key))),
      extension(
        OID.authorityKeyIdentifier,
        false,
        sequence(implicit(0, keyIdentifier(issuer.publicKey))),
      ),
    ],
  });
  return signed(tbs, input.rootKey);
}

export function toPem(der: Uint8Array): string {
  const lines =
    Buffer.from(der)
      .toString("base64")
      .match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

/** SHA-256 of the certificate, first 16 hex characters, upper case (SD24). */
export function fingerprint(der: Uint8Array): string {
  return createHash("sha256").update(der).digest("hex").slice(0, 16).toUpperCase();
}
