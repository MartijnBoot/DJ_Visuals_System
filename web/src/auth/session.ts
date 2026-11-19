// Hosted sign-in in the browser (B-12 SD16, PD1, PD9): authorisation code with PKCE straight
// against the provider; the ID and refresh tokens stay in memory, never in storage.
// sessionStorage holds only the pending attempt (verifier, state, whether it was silent) across
// the redirect, and `djv.signedIn`, the marker that this tab has signed in, so a later load in
// the tab goes to the provider by itself (`prompt=none`) and comes straight back.
// Renewal happens only on demand, inside `token()` or `renew()`: there is no timer, so a running
// set makes no automatic request. A failed renewal signs the page out once.
import { challengeOf, randomString } from "./pkce.ts";

export const SIGNED_IN_KEY = "djv.signedIn";
const PENDING_KEY = "djv.signIn.pending";
/** An ID token this close to its `exp` is renewed before use (PD9). */
const RENEW_BEFORE_MS = 60_000;
const TIMEOUT_MS = 10_000;

export interface SessionDeps {
  issuer: string;
  clientId: string;
  fetch: typeof fetch;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  location: { origin: string; pathname: string; search: string; assign(url: string): void };
  /** Replaces the address bar's URL without a load (`history.replaceState`). */
  replaceUrl(url: string): void;
  now(): number;
  random?(size: number): Uint8Array;
}

export type StartResult = "signed_in" | "redirecting" | "signed_out" | "failed";

export interface Session {
  /** On page load: completes a return from the provider, or goes back to it silently. */
  start(): Promise<StartResult>;
  /** Leaves the page for the provider's sign-in. */
  signIn(): Promise<void>;
  /** The ID token, renewed first when it is within 60 s of `exp`; null when signed out. */
  token(): Promise<string | null>;
  /** Renews now (after a 401); null and signed out when it fails. */
  renew(): Promise<string | null>;
  isSignedOut(): boolean;
  /** Called once, when renewal first fails. */
  onSignedOut(listener: () => void): () => void;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
}
interface Tokens {
  id_token: string;
  refresh_token?: string;
}
interface Pending {
  verifier: string;
  state: string;
  silent: boolean;
}

// Type guards for what the provider and storage hand back (types at the boundary).
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isDiscovery = (v: unknown): v is Discovery =>
  isRecord(v) &&
  typeof v.issuer === "string" &&
  typeof v.authorization_endpoint === "string" &&
  typeof v.token_endpoint === "string";
const isTokens = (v: unknown): v is Tokens =>
  isRecord(v) &&
  typeof v.id_token === "string" &&
  (v.refresh_token === undefined || typeof v.refresh_token === "string");
const isPending = (v: unknown): v is Pending =>
  isRecord(v) &&
  typeof v.verifier === "string" &&
  typeof v.state === "string" &&
  typeof v.silent === "boolean";

/** The token's `exp` in milliseconds, or 0 when unreadable (treated as due for renewal). */
function expiryOf(token: string): number {
  try {
    const payload = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const exp = (JSON.parse(atob(payload)) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function createSession(deps: SessionDeps): Session {
  let idToken: string | null = null;
  let refreshToken: string | null = null;
  let signedOut = false;
  let started: Promise<StartResult> | null = null;
  let renewing: Promise<string | null> | null = null;
  let discovery: Promise<Discovery> | null = null;
  const listeners = new Set<() => void>();

  const redirectUri = () =>
    `${deps.location.origin}${deps.location.pathname === "/builder" ? "/builder" : "/"}`;

  function readDiscovery() {
    discovery ??= (async () => {
      const response = await deps.fetch(
        `${deps.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      const body: unknown = response.ok ? await response.json() : null;
      if (!isDiscovery(body) || body.issuer !== deps.issuer) throw new Error("discovery");
      return body;
    })().catch((error: unknown) => {
      discovery = null;
      throw error;
    });
    return discovery;
  }

  /** One token request; the tokens on success, null on any refusal or failure. */
  async function tokenRequest(form: Record<string, string>) {
    try {
      const { token_endpoint } = await readDiscovery();
      const response = await deps.fetch(token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...form, client_id: deps.clientId }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return isTokens(body) ? body : null;
    } catch {
      return null;
    }
  }

  function keep(tokens: Tokens) {
    idToken = tokens.id_token;
    refreshToken = tokens.refresh_token ?? refreshToken;
  }

  function signOut() {
    if (signedOut) return;
    signedOut = true;
    idToken = null;
    refreshToken = null;
    for (const listener of listeners) listener();
  }

  async function redirect(silent: boolean) {
    const { authorization_endpoint } = await readDiscovery();
    const verifier = randomString(deps.random);
    const state = randomString(deps.random, 16);
    deps.storage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, silent }));
    const url = new URL(authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", deps.clientId);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("scope", "openid offline_access");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", await challengeOf(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    if (silent) url.searchParams.set("prompt", "none");
    deps.location.assign(url.toString());
  }

  async function complete(params: URLSearchParams): Promise<StartResult> {
    let pending: Pending | null;
    try {
      const stored: unknown = JSON.parse(deps.storage.getItem(PENDING_KEY) ?? "");
      pending = isPending(stored) ? stored : null;
    } catch {
      pending = null;
    }
    deps.storage.removeItem(PENDING_KEY);
    // The code and state never stay in the address bar (PD9).
    deps.replaceUrl(redirectUri());
    if (!pending || params.get("state") !== pending.state) return "failed";
    const code = params.get("code");
    if (code === null) {
      if (!pending.silent) return "failed";
      // The provider's own session did not answer: the plain sign-in page (PD1).
      deps.storage.removeItem(SIGNED_IN_KEY);
      return "signed_out";
    }
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: pending.verifier,
    });
    if (!tokens) return "failed";
    keep(tokens);
    signedOut = false;
    deps.storage.setItem(SIGNED_IN_KEY, "1");
    return "signed_in";
  }

  const session: Session = {
    start() {
      started ??= (async () => {
        const params = new URLSearchParams(deps.location.search);
        if (params.has("code") || params.has("error")) return complete(params);
        if (deps.storage.getItem(SIGNED_IN_KEY) === "1") {
          try {
            await redirect(true);
            return "redirecting";
          } catch {
            return "failed";
          }
        }
        return "signed_out";
      })();
      return started;
    },
    signIn: () => redirect(false),
    async token() {
      if (idToken === null) return null;
      if (expiryOf(idToken) - deps.now() < RENEW_BEFORE_MS) return session.renew();
      return idToken;
    },
    renew() {
      renewing ??= (async () => {
        const tokens =
          refreshToken === null
            ? null
            : await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
        if (!tokens) {
          signOut();
          return null;
        }
        keep(tokens);
        return idToken;
      })().finally(() => {
        renewing = null;
      });
      return renewing;
    },
    isSignedOut: () => signedOut,
    onSignedOut(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return session;
}

let current: Session | null = null;

/** The page's hosted session, or null on a local install (set once by `main.tsx`). */
export const hostedSession = (): Session | null => current;

export function setHostedSession(session: Session | null): void {
  current = session;
}
