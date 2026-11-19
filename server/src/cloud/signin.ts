// The local install's sign-in to the cloud (B-12 SD15, AC24, AC25, PD20): authorisation code
// with PKCE, returning to a loopback callback on 127.0.0.1:PORT. One pending attempt, kept 10
// minutes. The refresh token is the session store's; the ID token stays in memory and is renewed
// on demand within 60 s of its `exp`. A token endpoint answering `invalid_grant`, or the cloud
// refusing a token just renewed, is "signed out", kept across restarts; a network failure is
// "offline", never "signed out". No token, code or verifier is ever logged or returned.
import { createHash, randomBytes } from "node:crypto";
import type { Issuer } from "../auth/issuer.ts";
import type { Logger } from "../log.ts";
import type { SessionStore } from "./session-store.ts";

export type SigninState = "not_connected" | "connected" | "signed_out";

export type TokenResult =
  | { kind: "token"; token: string }
  | { kind: "not_connected" }
  | { kind: "signed_out" }
  | { kind: "offline" };

export interface SigninDeps {
  clientId: string;
  /** The main listener's port: the callback is http://127.0.0.1:PORT/api/cloud/callback. */
  port: number;
  issuer: Issuer;
  store: SessionStore;
  fetch: typeof fetch;
  now(): number;
  log: Pick<Logger, "info" | "warn">;
}

export interface Signin {
  /** A new attempt (replacing any pending one): the provider URL to open. */
  begin(): Promise<string>;
  /** The callback's query: "connected" when the code was exchanged and the token stored. */
  complete(params: URLSearchParams): Promise<"connected" | "failed">;
  state(): SigninState;
  /** The ID token, renewed first when it is within 60 s of `exp`. */
  idToken(): Promise<TokenResult>;
  /** Renews now. */
  renew(): Promise<TokenResult>;
  /** The cloud answered 401 to a token just renewed: signed out (PD20). */
  rejected(): void;
  disconnect(): void;
}

const ATTEMPT_MS = 10 * 60_000;
const RENEW_BEFORE_MS = 60_000;
const TIMEOUT_MS = 10_000;

const b64url = (bytes: Buffer) => bytes.toString("base64url");

function expiryOf(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function createSignin(deps: SigninDeps): Signin {
  const redirectUri = `http://127.0.0.1:${deps.port}/api/cloud/callback`;
  let pending: { state: string; verifier: string; at: number } | null = null;
  let idToken: string | null = null;
  let renewing: Promise<TokenResult> | null = null;

  /** One token request: tokens, a refusal (`invalid_grant`), or offline. */
  async function tokenRequest(
    form: Record<string, string>,
  ): Promise<{ id: string; refresh?: string } | "refused" | "offline"> {
    let response: Response;
    try {
      const { token } = await deps.issuer.endpoints();
      response = await deps.fetch(token, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...form, client_id: deps.clientId }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return "offline";
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON: read by status alone.
    }
    const record = (typeof body === "object" && body !== null ? body : {}) as Record<
      string,
      unknown
    >;
    if (response.status === 400 || response.status === 401) {
      return record.error === "invalid_grant" ? "refused" : "offline";
    }
    if (!response.ok || typeof record.id_token !== "string") return "offline";
    return {
      id: record.id_token,
      ...(typeof record.refresh_token === "string" ? { refresh: record.refresh_token } : {}),
    };
  }

  const signin: Signin = {
    async begin() {
      const { authorization } = await deps.issuer.endpoints();
      const verifier = b64url(randomBytes(32));
      const state = b64url(randomBytes(16));
      pending = { state, verifier, at: deps.now() };
      const url = new URL(authorization);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", deps.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", "openid offline_access");
      url.searchParams.set("state", state);
      url.searchParams.set(
        "code_challenge",
        b64url(createHash("sha256").update(verifier).digest()),
      );
      url.searchParams.set("code_challenge_method", "S256");
      deps.log.info({ outcome: "started" }, "cloud sign-in");
      return url.toString();
    },

    async complete(params) {
      const attempt = pending;
      if (!attempt || params.get("state") !== attempt.state) {
        deps.log.warn({ outcome: "failed", kind: "state" }, "cloud sign-in");
        return "failed";
      }
      pending = null; // one use, right or wrong from here on
      if (deps.now() - attempt.at > ATTEMPT_MS) {
        deps.log.warn({ outcome: "failed", kind: "expired" }, "cloud sign-in");
        return "failed";
      }
      const code = params.get("code");
      if (code === null) {
        deps.log.warn({ outcome: "failed", kind: "provider" }, "cloud sign-in");
        return "failed";
      }
      const tokens = await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: attempt.verifier,
      });
      if (typeof tokens === "string" || tokens.refresh === undefined) {
        deps.log.warn({ outcome: "failed", kind: "exchange" }, "cloud sign-in");
        return "failed";
      }
      deps.store.write(tokens.refresh);
      idToken = tokens.id;
      deps.log.info({ outcome: "connected" }, "cloud sign-in");
      return "connected";
    },

    state() {
      const file = deps.store.read();
      return file.kind === "none"
        ? "not_connected"
        : file.kind === "revoked"
          ? "signed_out"
          : "connected";
    },

    async idToken() {
      if (signin.state() !== "connected") return { kind: signin.state() as "not_connected" };
      if (idToken !== null && expiryOf(idToken) - deps.now() > RENEW_BEFORE_MS) {
        return { kind: "token", token: idToken };
      }
      return signin.renew();
    },

    renew() {
      renewing ??= (async (): Promise<TokenResult> => {
        const file = deps.store.read();
        if (file.kind !== "connected") return { kind: signin.state() as "not_connected" };
        const tokens = await tokenRequest({
          grant_type: "refresh_token",
          refresh_token: file.refreshToken,
        });
        if (tokens === "offline") return { kind: "offline" };
        // Disconnected, or connected afresh, while this request was out: its answer is about a
        // session that no longer exists, so it neither writes nor revokes (AC24).
        const latest = deps.store.read();
        if (latest.kind !== "connected" || latest.refreshToken !== file.refreshToken) {
          const state = signin.state();
          if (state === "connected" && idToken !== null) return { kind: "token", token: idToken };
          return { kind: state === "connected" ? "offline" : state };
        }
        if (tokens === "refused") {
          signin.rejected();
          return { kind: "signed_out" };
        }
        if (tokens.refresh !== undefined && tokens.refresh !== file.refreshToken) {
          deps.store.write(tokens.refresh);
        }
        idToken = tokens.id;
        return { kind: "token", token: tokens.id };
      })().finally(() => {
        renewing = null;
      });
      return renewing;
    },

    rejected() {
      idToken = null;
      if (deps.store.read().kind === "none") return;
      deps.store.revoke();
      deps.log.warn({ outcome: "signed_out" }, "cloud sign-in");
    },

    disconnect() {
      deps.store.remove();
      idToken = null;
      pending = null;
      deps.log.info({ outcome: "disconnected" }, "cloud sign-in");
    },
  };
  return signin;
}
