// B-12 T11 (SD16, PD1, PD9): hosted sign-in in the browser, against a fake provider behind a
// fake fetch. Tokens live in memory only; sessionStorage holds the PKCE verifier, the state and
// the "this tab signed in" marker, never a token.
import { beforeEach, describe, expect, it } from "vitest";
import { challengeOf } from "./pkce.ts";
import { createSession, SIGNED_IN_KEY, type SessionDeps } from "./session.ts";

const ISSUER = "https://issuer.example.test";
const CLIENT = "the-client";
const ORIGIN = "https://cloud.example.test";

const b64url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (exp: number, n: number) => `${b64url({ alg: "RS256" })}.${b64url({ exp, n })}.sig${n}`;

interface Provider {
  calls: { url: string; body?: URLSearchParams }[];
  issued: string[];
  refuseRefresh: boolean;
  /** Seconds from now each issued ID token lives. */
  lifetime: number;
  challenge: string | null;
  /** Every request rejects, as with no network. */
  offline: boolean;
}

let now: number;
let provider: Provider;
let storage: Map<string, string>;
let assigned: string[];
let replaced: string[];
let search: string;
let pathname: string;

function fakeFetch(): typeof fetch {
  let n = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (provider.offline) throw new TypeError("Failed to fetch");
    const url = String(input);
    const body = init?.body ? new URLSearchParams(String(init.body)) : undefined;
    provider.calls.push({ url, ...(body ? { body } : {}) });
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
      });
    }
    if (url === `${ISSUER}/token`) {
      const grant = body?.get("grant_type");
      if (grant === "authorization_code") {
        const challenge = await challengeOf(body?.get("code_verifier") ?? "");
        if (body?.get("code") !== "the-code" || challenge !== provider.challenge) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
      } else if (grant === "refresh_token") {
        if (provider.refuseRefresh || !body?.get("refresh_token")?.startsWith("refresh-")) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
      }
      n += 1;
      const idToken = jwt(Math.floor(now / 1000) + provider.lifetime, n);
      const refreshToken = `refresh-${n}`;
      provider.issued.push(idToken, refreshToken);
      return Response.json({ id_token: idToken, refresh_token: refreshToken });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

function deps(): SessionDeps {
  return {
    issuer: ISSUER,
    clientId: CLIENT,
    fetch: fakeFetch(),
    storage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
      removeItem: (k) => void storage.delete(k),
    },
    location: {
      origin: ORIGIN,
      get pathname() {
        return pathname;
      },
      get search() {
        return search;
      },
      assign: (url) => void assigned.push(url),
    },
    replaceUrl: (url) => void replaced.push(url),
    now: () => now,
  };
}

/** Storage never holds an issued token. */
function expectNoTokenStored() {
  const stored = [...storage.values()].join("\n");
  for (const secret of provider.issued) expect(stored).not.toContain(secret);
}

/** Starts a sign-in, then lands back on the page with the provider's answer. */
async function signInAndReturn(params: (state: string) => string) {
  const first = createSession(deps());
  await first.signIn();
  const url = new URL(assigned.at(-1)!);
  provider.challenge = url.searchParams.get("code_challenge");
  search = `?${params(url.searchParams.get("state")!)}`;
  const returned = createSession(deps());
  return { session: returned, result: await returned.start() };
}

beforeEach(() => {
  now = 1_800_000_000_000;
  provider = {
    calls: [],
    issued: [],
    refuseRefresh: false,
    lifetime: 3600,
    challenge: null,
    offline: false,
  };
  storage = new Map();
  assigned = [];
  replaced = [];
  search = "";
  pathname = "/";
});

describe("a first load (PD1)", () => {
  it("is signed out and makes no request", async () => {
    const session = createSession(deps());
    expect(await session.start()).toBe("signed_out");
    expect(provider.calls).toEqual([]);
    expect(await session.token()).toBeNull();
  });
});

describe("signIn", () => {
  it("redirects to the authorise endpoint with PKCE S256, the page as redirect_uri, offline_access", async () => {
    pathname = "/builder";
    await createSession(deps()).signIn();
    const url = new URL(assigned[0]!);
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/authorize`);
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(CLIENT);
    expect(q.get("redirect_uri")).toBe(`${ORIGIN}/builder`);
    expect(q.get("scope")).toBe("openid offline_access");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("state")).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(q.has("prompt")).toBe(false);
  });
});

describe("the return from the provider (SD16, PD9)", () => {
  it("exchanges the code, keeps tokens in memory only, marks the tab, and clears the address bar", async () => {
    const { session, result } = await signInAndReturn((state) => `code=the-code&state=${state}`);
    expect(result).toBe("signed_in");
    expect(replaced).toEqual([`${ORIGIN}/`]);
    const exchange = provider.calls.find((c) => c.body?.get("grant_type") === "authorization_code");
    expect(exchange?.body?.get("redirect_uri")).toBe(`${ORIGIN}/`);
    expect(exchange?.body?.get("client_id")).toBe(CLIENT);
    expect(await session.token()).toBe(provider.issued[0]);
    expect(storage.get(SIGNED_IN_KEY)).toBe("1");
    expectNoTokenStored();
    expect([...storage.keys()].sort()).toEqual([SIGNED_IN_KEY]);
  });

  it("fails on a wrong state and exchanges nothing", async () => {
    const { result } = await signInAndReturn(() => "code=the-code&state=not-the-state");
    expect(result).toBe("failed");
    expect(provider.calls.some((c) => c.url.endsWith("/token"))).toBe(false);
    expect(storage.has(SIGNED_IN_KEY)).toBe(false);
    expect(replaced).toEqual([`${ORIGIN}/`]);
  });

  it("fails when the provider refuses the code", async () => {
    const { session, result } = await signInAndReturn((state) => `code=wrong&state=${state}`);
    expect(result).toBe("failed");
    expect(await session.token()).toBeNull();
  });

  it("fails on a code with no sign-in pending in this tab", async () => {
    search = "?code=the-code&state=x";
    expect(await createSession(deps()).start()).toBe("failed");
  });

  it("fails on the provider's error after a clicked sign-in", async () => {
    const { result } = await signInAndReturn((state) => `error=access_denied&state=${state}`);
    expect(result).toBe("failed");
  });
});

describe("a later load in the same tab (PD1)", () => {
  it("redirects without a click, with prompt=none", async () => {
    storage.set(SIGNED_IN_KEY, "1");
    expect(await createSession(deps()).start()).toBe("redirecting");
    expect(new URL(assigned[0]!).searchParams.get("prompt")).toBe("none");
  });

  it("shows the plain sign-in page when the silent return fails, and forgets the marker", async () => {
    storage.set(SIGNED_IN_KEY, "1");
    await createSession(deps()).start();
    const state = new URL(assigned[0]!).searchParams.get("state");
    search = `?error=login_required&state=${state}`;
    expect(await createSession(deps()).start()).toBe("signed_out");
    expect(storage.has(SIGNED_IN_KEY)).toBe(false);
  });
});

describe("token() and renewal on demand (PD9)", () => {
  it("renews an ID token within 60 s of exp before handing it out", async () => {
    provider.lifetime = 90;
    const { session } = await signInAndReturn((state) => `code=the-code&state=${state}`);
    const first = provider.issued[0];
    expect(await session.token()).toBe(first);
    now += 31_000; // 59 s left
    const renewed = await session.token();
    expect(renewed).not.toBe(first);
    expect(renewed).toBe(provider.issued[2]);
    const refresh = provider.calls.filter((c) => c.body?.get("grant_type") === "refresh_token");
    expect(refresh).toHaveLength(1);
    expect(refresh[0]!.body?.get("refresh_token")).toBe(provider.issued[1]);
    expectNoTokenStored();
  });

  it("makes no request while the token has more than 60 s left", async () => {
    const { session } = await signInAndReturn((state) => `code=the-code&state=${state}`);
    const before = provider.calls.length;
    await session.token();
    await session.token();
    expect(provider.calls.length).toBe(before);
  });

  it("a failed renewal fires signedOut once and token() is null after it", async () => {
    const { session } = await signInAndReturn((state) => `code=the-code&state=${state}`);
    let fired = 0;
    session.onSignedOut(() => (fired += 1));
    provider.refuseRefresh = true;
    expect(await session.renew()).toBeNull();
    expect(await session.renew()).toBeNull();
    expect(await session.token()).toBeNull();
    expect(fired).toBe(1);
    expect(session.isSignedOut()).toBe(true);
  });

  it("a network failure on renewal also signs out (PD9)", async () => {
    const { session } = await signInAndReturn((state) => `code=the-code&state=${state}`);
    let fired = 0;
    session.onSignedOut(() => (fired += 1));
    provider.offline = true;
    expect(await session.renew()).toBeNull();
    expect(fired).toBe(1);
  });
});
