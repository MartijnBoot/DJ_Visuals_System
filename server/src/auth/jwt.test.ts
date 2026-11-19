// B-12 T4, PD7: the ID token's checks, one reason each.
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signJwt, startFakeIssuer, type FakeIssuer } from "../../test/fake-issuer.ts";
import { verifyIdToken, type Jwk } from "./jwt.ts";

const clientId = "client-under-test";
const NOW = 1_800_000_000_000;
let issuer: FakeIssuer;
let keys: Jwk[];

beforeAll(async () => {
  issuer = await startFakeIssuer({ clientId, subject: "the-subject", now: () => NOW });
  keys = [issuer.publicJwk as Jwk];
});
afterAll(async () => {
  await issuer.close();
});

const check = (token: string, now = NOW) =>
  verifyIdToken(token, { issuer: issuer.url, clientId, keys, now });

const seconds = Math.floor(NOW / 1000);

describe("verifyIdToken (PD7)", () => {
  it("accepts a token the fake issuer signs, and returns its subject", () => {
    expect(check(issuer.token())).toEqual({ ok: true, subject: "the-subject" });
  });

  it("accepts an audience list holding the client id", () => {
    expect(check(issuer.token({ aud: ["other", clientId] }))).toEqual({
      ok: true,
      subject: "the-subject",
    });
  });

  it("allows 60 s of leeway on exp and nbf", () => {
    expect(check(issuer.token({ exp: seconds - 59 })).ok).toBe(true);
    expect(check(issuer.token({ nbf: seconds + 59 })).ok).toBe(true);
  });

  it.each<[string, () => string, string]>([
    ["expired by 61 s", () => issuer.token({ exp: seconds - 61 }), "expired"],
    ["nbf 61 s ahead", () => issuer.token({ nbf: seconds + 61 }), "not_yet"],
    ["signed with the second key", () => issuer.token({}, { secondKey: true }), "key"],
    ["iss of another issuer", () => issuer.token({ iss: "https://other.example.test" }), "issuer"],
    ["aud of another client", () => issuer.token({ aud: "another-client" }), "audience"],
    ["aud a list without the client", () => issuer.token({ aud: ["a", "b"] }), "audience"],
    ["alg none", () => issuer.token({}, { header: { alg: "none" } }), "alg"],
    ["no exp", () => issuer.token({ exp: undefined }), "malformed"],
    ["no sub", () => issuer.token({ sub: undefined }), "malformed"],
    ["three-part garbage", () => "abc.def.ghi", "malformed"],
    ["two parts", () => issuer.token().split(".").slice(0, 2).join("."), "malformed"],
    ["an empty string", () => "", "malformed"],
  ])("refuses %s", (_name, make, reason) => {
    expect(check(make())).toEqual({ ok: false, reason });
  });

  it("refuses HS256 signed with the public key as its secret (alg confusion)", async () => {
    const { createHmac } = await import("node:crypto");
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const input = `${b64({ alg: "HS256", kid: "main" })}.${b64({
      iss: issuer.url,
      sub: "the-subject",
      aud: clientId,
      exp: seconds + 600,
    })}`;
    const secret = JSON.stringify(issuer.publicJwk);
    const token = `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
    expect(check(token)).toEqual({ ok: false, reason: "alg" });
  });

  it("refuses a flipped signature byte", () => {
    const [h, p, s] = issuer.token().split(".") as [string, string, string];
    const bytes = Buffer.from(s, "base64url");
    bytes[10] = bytes[10]! ^ 0xff;
    expect(check(`${h}.${p}.${bytes.toString("base64url")}`)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("refuses a payload changed after signing", () => {
    const [h, , s] = issuer.token().split(".") as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({ iss: issuer.url, sub: "someone-else", aud: clientId, exp: seconds + 600 }),
    ).toString("base64url");
    expect(check(`${h}.${forged}.${s}`)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a key whose type does not fit the alg", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = { ...ec.publicKey.export({ format: "jwk" }), kid: "main" } as Jwk;
    expect(
      verifyIdToken(issuer.token(), { issuer: issuer.url, clientId, keys: [jwk], now: NOW }),
    ).toEqual({ ok: false, reason: "key" });
  });

  it("verifies ES256 (P-256, IEEE P1363 signature)", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = { ...ec.publicKey.export({ format: "jwk" }), kid: "ec1", alg: "ES256" } as Jwk;
    const token = signJwt(
      { alg: "ES256", kid: "ec1" },
      { iss: issuer.url, sub: "ec-subject", aud: clientId, exp: seconds + 600 },
      ec.privateKey,
    );
    expect(verifyIdToken(token, { issuer: issuer.url, clientId, keys: [jwk], now: NOW })).toEqual({
      ok: true,
      subject: "ec-subject",
    });
  });
});
