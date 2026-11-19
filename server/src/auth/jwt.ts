// OIDC ID token verification on node:crypto (B-12 SD3, PD7): no provider SDK and no JWT
// library. A compact JWS, `alg` RS256 or ES256 only (anything else, `none` and HS256 included,
// is refused before a key is touched), the key found by `kid` in the issuer's JWKS, then the
// claims: `iss`, `aud`, `exp` and `nbf` with 60 s of leeway. Pure: the keys and the clock are
// arguments. The result carries a reason, never the token or a claim's value, so a caller can
// log it as it stands.
import { createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";

export type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };

export type VerifyFailure =
  "malformed" | "alg" | "key" | "signature" | "issuer" | "audience" | "expired" | "not_yet";

export type VerifyResult = { ok: true; subject: string } | { ok: false; reason: VerifyFailure };

export interface VerifyOptions {
  /** The configured issuer; `iss` must equal it exactly. */
  issuer: string;
  /** `aud` must be it, or a list holding it. */
  clientId: string;
  keys: readonly Jwk[];
  /** Milliseconds since the epoch. */
  now: number;
}

const LEEWAY_SECONDS = 60;
const SEGMENT = /^[A-Za-z0-9_-]+$/;
/** The key type each accepted algorithm needs. */
const KEY_TYPE = { RS256: "RSA", ES256: "EC" } as const;

type Header = { alg: unknown; kid?: unknown };

function parseSegment(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The header's `kid`, or null when the token is not a compact JWS with a string `kid`. */
export function tokenKeyId(token: string): string | null {
  const header = parseSegment(token.split(".")[0] ?? "");
  return typeof header?.kid === "string" ? header.kid : null;
}

function publicKey(jwk: Jwk, alg: keyof typeof KEY_TYPE): KeyObject | null {
  if (jwk.kty !== KEY_TYPE[alg] || (jwk.alg !== undefined && jwk.alg !== alg)) return null;
  if (alg === "ES256" && jwk.crv !== "P-256") return null;
  try {
    return createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return null;
  }
}

export function verifyIdToken(token: string, options: VerifyOptions): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p))) {
    // A signature-less token (`alg: none`) has an empty third part: report its alg, not its shape.
    const header = parts.length === 3 ? (parseSegment(parts[0]!) as Header | null) : null;
    if (header && header.alg !== "RS256" && header.alg !== "ES256") return fail("alg");
    return fail("malformed");
  }
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = parseSegment(headerPart) as Header | null;
  const payload = parseSegment(payloadPart);
  if (!header || !payload) return fail("malformed");
  if (header.alg !== "RS256" && header.alg !== "ES256") return fail("alg");
  const alg = header.alg;

  const jwk = options.keys.find((k) => typeof header.kid === "string" && k.kid === header.kid);
  const key = jwk ? publicKey(jwk, alg) : null;
  if (!key) return fail("key");
  let valid: boolean;
  try {
    const data = Buffer.from(`${headerPart}.${payloadPart}`);
    const signature = Buffer.from(signaturePart, "base64url");
    valid =
      alg === "ES256"
        ? verify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature)
        : verify("sha256", data, key, signature);
  } catch {
    valid = false;
  }
  if (!valid) return fail("signature");

  const { iss, aud, exp, nbf, sub } = payload;
  if (typeof sub !== "string" || sub.length === 0 || typeof exp !== "number") {
    return fail("malformed");
  }
  if (nbf !== undefined && typeof nbf !== "number") return fail("malformed");
  if (iss !== options.issuer) return fail("issuer");
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(options.clientId)) return fail("audience");
  const seconds = options.now / 1000;
  if (seconds > exp + LEEWAY_SECONDS) return fail("expired");
  if (nbf !== undefined && seconds < nbf - LEEWAY_SECONDS) return fail("not_yet");
  return { ok: true, subject: sub };
}

const fail = (reason: VerifyFailure): VerifyResult => ({ ok: false, reason });
