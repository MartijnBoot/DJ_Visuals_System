// B-12 T11 (SD16): the PKCE pieces on WebCrypto.
import { describe, expect, it } from "vitest";
import { challengeOf, randomString } from "./pkce.ts";

describe("challengeOf (RFC 7636 S256)", () => {
  it("gives appendix B's challenge for appendix B's verifier", async () => {
    expect(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("randomString", () => {
  it("is base64url of the given bytes, 43 characters for 32 bytes", () => {
    const value = randomString((size) => new Uint8Array(size).fill(255));
    expect(value).toBe("_".repeat(42) + "8");
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("differs between two calls with the real random source", () => {
    expect(randomString()).not.toBe(randomString());
  });
});
