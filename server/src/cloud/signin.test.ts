// B-12 T7 (SD15, AC24, AC25, AC26, PD20): the loopback sign-in against the fake issuer: one
// pending attempt, the code exchange, on-demand renewal, revoked versus offline.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeIssuer, type FakeIssuer } from "../../test/fake-issuer.ts";
import { createIssuer } from "../auth/issuer.ts";
import { createSessionStore, type SessionStore } from "./session-store.ts";
import { createSignin, type Signin } from "./signin.ts";

const CLIENT = "local-client";
const PORT = 8123;
let dataDir: string;
let fake: FakeIssuer;
let now: number;
let lines: string[];
let store: SessionStore;

function signinFor(): Signin {
  const log = pino({ level: "debug" }, { write: (line: string) => void lines.push(line) });
  return createSignin({
    clientId: CLIENT,
    port: PORT,
    issuer: createIssuer({ url: fake.url, fetch, now: () => now, log }),
    store,
    fetch,
    now: () => now,
    log,
  });
}

/** Starts an attempt and follows the fake issuer's redirect back: the callback's query. */
async function authorise(signin: Signin): Promise<URLSearchParams> {
  const url = await signin.begin();
  const response = await fetch(url, { redirect: "manual" });
  const back = new URL(response.headers.get("location")!);
  expect(`${back.origin}${back.pathname}`).toBe(`http://127.0.0.1:${PORT}/api/cloud/callback`);
  return back.searchParams;
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "djv-signin-"));
  now = Date.now();
  lines = [];
  fake = await startFakeIssuer({ clientId: CLIENT, now: () => now });
  store = createSessionStore(dataDir);
});

afterEach(async () => {
  await fake.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("connecting (AC24)", () => {
  it("asks for PKCE S256, offline_access and the loopback redirect", async () => {
    const url = new URL(await signinFor().begin());
    expect(url.searchParams.get("redirect_uri")).toBe(
      `http://127.0.0.1:${PORT}/api/cloud/callback`,
    );
    expect(url.searchParams.get("scope")).toBe("openid offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("client_id")).toBe(CLIENT);
  });

  it("exchanges the code, keeps the refresh token in the file and is connected", async () => {
    const signin = signinFor();
    expect(signin.state()).toBe("not_connected");
    expect(await signin.complete(await authorise(signin))).toBe("connected");
    expect(signin.state()).toBe("connected");
    expect(store.read()).toEqual({ kind: "connected", refreshToken: fake.issued.refreshTokens[0] });
    expect(await signin.idToken()).toEqual({ kind: "token", token: fake.issued.idTokens[0] });
  });

  it("refuses a wrong state, an expired attempt and a second callback", async () => {
    const signin = signinFor();
    const params = await authorise(signin);
    const wrong = new URLSearchParams(params);
    wrong.set("state", "not-it");
    expect(await signin.complete(wrong)).toBe("failed");
    // The wrong state did not use up the attempt.
    expect(await signin.complete(params)).toBe("connected");
    expect(await signin.complete(params)).toBe("failed");

    const late = await authorise(signin);
    now += 10 * 60_000 + 1;
    expect(await signin.complete(late)).toBe("failed");
  });

  it("refuses a provider error and a code the provider refuses", async () => {
    const signin = signinFor();
    const params = await authorise(signin);
    expect(
      await signin.complete(
        new URLSearchParams({ error: "access_denied", state: params.get("state")! }),
      ),
    ).toBe("failed");
    const again = await authorise(signin);
    again.set("code", "fake-code-not-issued");
    expect(await signin.complete(again)).toBe("failed");
    expect(store.read()).toEqual({ kind: "none" });
  });
});

describe("the ID token on demand (PD9, PD20)", () => {
  async function connected(): Promise<Signin> {
    const signin = signinFor();
    await signin.complete(await authorise(signin));
    return signin;
  }

  it("renews within 60 s of exp, keeping a rotated refresh token", async () => {
    const signin = await connected();
    now += 3600_000 - 30_000;
    const renewed = await signin.idToken();
    expect(renewed).toEqual({ kind: "token", token: fake.issued.idTokens[1] });
    expect(store.read()).toEqual({ kind: "connected", refreshToken: fake.issued.refreshTokens[1] });
  });

  it("after a restart, renews from the file", async () => {
    await connected();
    const restarted = signinFor();
    expect(restarted.state()).toBe("connected");
    expect(await restarted.idToken()).toEqual({ kind: "token", token: fake.issued.idTokens[1] });
  });

  it("invalid_grant is signed_out, kept in the file across a restart (AC25)", async () => {
    const signin = await connected();
    fake.refuseRefresh = true;
    expect(await signin.renew()).toEqual({ kind: "signed_out" });
    expect(signin.state()).toBe("signed_out");
    expect(store.read()).toEqual({ kind: "revoked" });
    expect(signinFor().state()).toBe("signed_out");
  });

  it("a token the cloud refuses right after renewal is signed_out (PD20)", async () => {
    const signin = await connected();
    signin.rejected();
    expect(signin.state()).toBe("signed_out");
    expect(store.read()).toEqual({ kind: "revoked" });
  });

  it("an unreachable provider is offline, never signed_out", async () => {
    const signin = await connected();
    await fake.close();
    expect(await signin.renew()).toEqual({ kind: "offline" });
    expect(signin.state()).toBe("connected");
    fake = await startFakeIssuer({ clientId: CLIENT });
  });

  it("disconnect removes the file and forgets the token", async () => {
    const signin = await connected();
    signin.disconnect();
    expect(store.read()).toEqual({ kind: "none" });
    expect(signin.state()).toBe("not_connected");
    expect(await signin.idToken()).toEqual({ kind: "not_connected" });
  });

  it("never logs a code, a token or a refresh token (AC26)", async () => {
    const signin = await connected();
    now += 3600_000;
    await signin.idToken();
    const secrets = [...fake.issued.codes, ...fake.issued.idTokens, ...fake.issued.refreshTokens];
    expect(secrets.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) for (const secret of secrets) expect(line).not.toContain(secret);
  });
});
