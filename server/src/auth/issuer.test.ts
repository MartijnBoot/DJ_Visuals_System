// B-12 T4, PD7: discovery, the JWKS cache, and the once-a-minute refetch on an unknown kid.
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeIssuer, type FakeIssuer } from "../../test/fake-issuer.ts";
import { createIssuer } from "./issuer.ts";

const clientId = "client-under-test";
let fake: FakeIssuer;
let now: number;
let lines: string[];

const log = () => pino({ level: "debug" }, { write: (line: string) => void lines.push(line) });

beforeEach(async () => {
  now = 1_800_000_000_000;
  lines = [];
  fake = await startFakeIssuer({ clientId, subject: "subject-kept-out-of-logs", now: () => now });
});
afterEach(async () => {
  await fake.close();
});

const jwksFetches = () => fake.requests.filter((r) => r === "GET /jwks").length;

describe("createIssuer (PD7)", () => {
  it("reads discovery once and exposes the authorise and token endpoints", async () => {
    const issuer = createIssuer({ url: fake.url, fetch, now: () => now, log: log() });
    expect(await issuer.endpoints()).toEqual({
      authorization: `${fake.url}/authorize`,
      token: `${fake.url}/token`,
    });
    await issuer.endpoints();
    expect(fake.requests.filter((r) => r.includes("openid-configuration"))).toHaveLength(1);
  });

  it("refuses a discovery document naming another issuer", async () => {
    const issuer = createIssuer({ url: `${fake.url}/`, fetch, now: () => now, log: log() });
    await expect(issuer.endpoints()).rejects.toThrow(/issuer/);
    await expect(issuer.verify(fake.token(), clientId)).rejects.toThrow(/issuer/);
  });

  it("verifies a token against the JWKS, fetched once", async () => {
    const issuer = createIssuer({ url: fake.url, fetch, now: () => now, log: log() });
    expect(await issuer.verify(fake.token(), clientId)).toEqual({
      ok: true,
      subject: "subject-kept-out-of-logs",
    });
    expect(await issuer.verify(fake.token(), clientId)).toMatchObject({ ok: true });
    expect(jwksFetches()).toBe(1);
  });

  it("refetches the JWKS once on an unknown kid, and not again within a minute", async () => {
    const issuer = createIssuer({ url: fake.url, fetch, now: () => now, log: log() });
    await issuer.verify(fake.token(), clientId);
    expect(jwksFetches()).toBe(1);
    now += 61_000;
    const unknown = () => fake.token({}, { secondKey: true });
    expect(await issuer.verify(unknown(), clientId)).toEqual({ ok: false, reason: "key" });
    expect(jwksFetches()).toBe(2);
    now += 30_000;
    expect(await issuer.verify(unknown(), clientId)).toEqual({ ok: false, reason: "key" });
    expect(jwksFetches()).toBe(2);
    now += 31_000;
    await issuer.verify(unknown(), clientId);
    expect(jwksFetches()).toBe(3);
  });

  it("logs no token and no subject", async () => {
    const issuer = createIssuer({ url: fake.url, fetch, now: () => now, log: log() });
    const token = fake.token();
    await issuer.verify(token, clientId);
    now += 61_000;
    await issuer.verify(fake.token({}, { secondKey: true }), clientId);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(token.split(".")[2]!);
      expect(line).not.toContain("subject-kept-out-of-logs");
    }
  });

  it("reports an unreachable issuer as a throw, never as a token reason", async () => {
    const url = fake.url;
    const token = fake.token();
    await fake.close();
    const issuer = createIssuer({ url, fetch, now: () => now, log: log() });
    await expect(issuer.verify(token, clientId)).rejects.toThrow();
    fake = await startFakeIssuer({ clientId });
  });
});
