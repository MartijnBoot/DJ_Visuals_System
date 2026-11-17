// B-12 T5 (AC1, AC2, AC3, SD4, SD17, PD11): the bearer check, the allowed subject and the
// rate limit, with a fake verifier. The guard answers a refusal or null (let through).
import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createGuard, type Guard } from "./guard.ts";
import type { VerifyResult } from "./jwt.ts";

const ALLOWED = "allowed-subject-value";
const OTHER = "other-subject-value";
let now: number;
let lines: string[];
let verified: string[];
let guard: Guard;
let issuerDown: boolean;

const results: Record<string, VerifyResult> = {
  good: { ok: true, subject: ALLOWED },
  other: { ok: true, subject: OTHER },
  expired: { ok: false, reason: "expired" },
};

beforeEach(() => {
  now = 0;
  lines = [];
  verified = [];
  issuerDown = false;
  guard = createGuard({
    verify: async (token) => {
      verified.push(token);
      if (issuerDown) throw new Error("issuer unavailable");
      return results[token] ?? { ok: false, reason: "malformed" };
    },
    allowedSubject: ALLOWED,
    now: () => now,
    log: pino({ level: "debug" }, { write: (line: string) => void lines.push(line) }),
  });
});

const bearer = (token: string) => `Bearer ${token}`;

describe("the bearer check (AC1, AC3)", () => {
  it("lets the allowed subject through", async () => {
    expect(await guard.check("1.1.1.1", bearer("good"))).toBeNull();
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["another scheme", "Basic dXNlcjpwdw=="],
    ["a bearer with nothing", "Bearer "],
    ["a bearer with a space inside", "Bearer a b"],
  ])("answers 401 to %s, without verifying", async (_name, header) => {
    expect(await guard.check("1.1.1.1", header)).toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
    expect(verified).toEqual([]);
  });

  it("answers 401 to a token that fails verification", async () => {
    expect(await guard.check("1.1.1.1", bearer("expired"))).toEqual({
      status: 401,
      body: { error: "unauthorized" },
    });
  });

  it("answers 503 when the issuer cannot be read, and counts nothing", async () => {
    issuerDown = true;
    for (let i = 0; i < 12; i += 1) {
      expect(await guard.check("1.1.1.1", bearer("good"))).toEqual({
        status: 503,
        body: { error: "unavailable" },
      });
    }
    issuerDown = false;
    expect(await guard.check("1.1.1.1", bearer("good"))).toBeNull();
  });
});

describe("the allowed subject (AC2, SD4)", () => {
  it("answers 403 to another subject and logs the outcome without the subject", async () => {
    expect(await guard.check("1.1.1.1", bearer("other"))).toEqual({
      status: 403,
      body: { error: "forbidden" },
    });
    const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(logged.some((l) => l.outcome === "forbidden")).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(OTHER);
      expect(line).not.toContain(ALLOWED);
    }
  });
});

describe("the rate limit (SD17, PD11)", () => {
  it("answers 429 to the 11th request after ten rejections within 60 s, for 60 s", async () => {
    for (let i = 0; i < 10; i += 1) {
      now = i * 5_000;
      expect((await guard.check("1.1.1.1", bearer("expired")))?.status).toBe(401);
    }
    now = 50_000;
    verified = [];
    expect(await guard.check("1.1.1.1", bearer("good"))).toEqual({
      status: 429,
      body: { error: "rate_limited" },
    });
    expect(verified).toEqual([]); // refused before verifying anything
    now = 45_000 + 59_999;
    expect((await guard.check("1.1.1.1", bearer("good")))?.status).toBe(429);
    now = 45_000 + 60_000;
    expect(await guard.check("1.1.1.1", bearer("good"))).toBeNull();
  });

  it("counts 403s as rejections too", async () => {
    for (let i = 0; i < 10; i += 1) await guard.check("1.1.1.1", bearer("other"));
    expect((await guard.check("1.1.1.1", bearer("good")))?.status).toBe(429);
  });

  it("leaves another address unaffected", async () => {
    for (let i = 0; i < 10; i += 1) await guard.check("1.1.1.1", undefined);
    expect((await guard.check("1.1.1.1", bearer("good")))?.status).toBe(429);
    expect(await guard.check("2.2.2.2", bearer("good"))).toBeNull();
  });

  it("lets nine rejections and a good token through", async () => {
    for (let i = 0; i < 9; i += 1) await guard.check("1.1.1.1", undefined);
    expect(await guard.check("1.1.1.1", bearer("good"))).toBeNull();
  });
});
