// A fake OpenID Connect issuer for the gate (B-12 PD22): no network and no real provider. It
// follows the RFCs, not one vendor: discovery, a JWKS with one RSA key, an authorise endpoint
// that redirects straight back with a code for the subject the test sets (no page), and a token
// endpoint for the code grant (PKCE S256 checked) and the refresh grant. Switches let a test make
// it refuse refresh, issue expired tokens, sign with a second, unpublished key, or claim another
// issuer. Discovery and the token endpoint carry CORS headers so a browser page can call them.
// Every token, code and refresh token it hands out is kept in `issued`, so a test can scan logs
// for them (AC26).
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const FAKE_EMAIL = "owner.fake@example.test";

export interface FakeIssuerOptions {
  clientId: string;
  /** The subject the authorise endpoint signs in as; `subject` changes it later. */
  subject?: string;
  /** Seconds an ID token lives. */
  lifetime?: number;
  now?: () => number;
}

export interface SignOptions {
  /** Signs with the second key, whose `kid` the JWKS never lists. */
  secondKey?: boolean;
  /** Header overrides, e.g. `{ alg: "none" }`. */
  header?: Record<string, unknown>;
}

export interface FakeIssuer {
  /** The issuer identifier and base URL, `http://127.0.0.1:<port>`. */
  url: string;
  subject: string;
  /** The token endpoint answers `invalid_grant` to every refresh. */
  refuseRefresh: boolean;
  /** Tokens are issued already expired (two minutes ago). */
  issueExpired: boolean;
  /** Tokens are signed with the second key. */
  signWithSecondKey: boolean;
  /** Tokens carry this `iss` instead of `url`. */
  claimIssuer: string | null;
  /** Everything secret it handed out, for log scans (AC26). */
  issued: { idTokens: string[]; refreshTokens: string[]; codes: string[] };
  /** "METHOD /path" of every request, in order. */
  requests: string[];
  /** Signs an ID token with the given claims over the defaults. */
  token(claims?: Record<string, unknown>, options?: SignOptions): string;
  /** The published public key, as in the JWKS. */
  publicJwk: Record<string, unknown>;
  close(): Promise<void>;
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** Signs a compact JWS: RS256 or ES256 by the key's type; any other `alg` header signs nothing. */
export function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: KeyObject,
): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const alg = header.alg;
  if (alg !== "RS256" && alg !== "ES256") return `${input}.`;
  const signature =
    alg === "ES256"
      ? sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" })
      : sign("sha256", Buffer.from(input), key);
  return `${input}.${b64url(signature)}`;
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

export async function startFakeIssuer(options: FakeIssuerOptions): Promise<FakeIssuer> {
  const now = options.now ?? (() => Date.now());
  const lifetime = options.lifetime ?? 3600;
  const main = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const second = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = {
    ...main.publicKey.export({ format: "jwk" }),
    kid: "main",
    alg: "RS256",
    use: "sig",
  };
  const pendingCodes = new Map<
    string,
    { challenge: string; redirectUri: string; subject: string }
  >();
  const refreshTokens = new Map<string, string>(); // token -> subject

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.statusCode = 500;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  const issuer: FakeIssuer = {
    url,
    subject: options.subject ?? "fake-subject-allowed",
    refuseRefresh: false,
    issueExpired: false,
    signWithSecondKey: false,
    claimIssuer: null,
    issued: { idTokens: [], refreshTokens: [], codes: [] },
    requests: [],
    publicJwk,
    token(claims = {}, signOptions = {}) {
      const seconds = Math.floor(now() / 1000);
      const payload = {
        iss: url,
        sub: issuer.subject,
        aud: options.clientId,
        iat: seconds,
        exp: seconds + lifetime,
        email: FAKE_EMAIL,
        ...claims,
      };
      const useSecond = signOptions.secondKey ?? false;
      const header = {
        alg: "RS256",
        typ: "JWT",
        kid: useSecond ? "second" : "main",
        ...signOptions.header,
      };
      return signJwt(header, payload, useSecond ? second.privateKey : main.privateKey);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };

  function issueTokens(subject: string): Record<string, unknown> {
    const seconds = Math.floor(now() / 1000);
    const claims: Record<string, unknown> = { sub: subject };
    if (issuer.issueExpired) Object.assign(claims, { iat: seconds - 600, exp: seconds - 120 });
    if (issuer.claimIssuer) claims.iss = issuer.claimIssuer;
    const idToken = issuer.token(claims, { secondKey: issuer.signWithSecondKey });
    const refreshToken = `fake-refresh-${randomBytes(16).toString("hex")}`;
    refreshTokens.set(refreshToken, subject);
    issuer.issued.idTokens.push(idToken);
    issuer.issued.refreshTokens.push(refreshToken);
    return {
      id_token: idToken,
      refresh_token: refreshToken,
      access_token: `fake-access-${randomBytes(8).toString("hex")}`,
      token_type: "Bearer",
      expires_in: lifetime,
    };
  }

  function send(response: ServerResponse, status: number, body: unknown, cors = false): void {
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    if (cors) response.setHeader("access-control-allow-origin", "*");
    response.end(JSON.stringify(body));
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const target = new URL(request.url ?? "/", url);
    issuer.requests.push(`${request.method} ${target.pathname}`);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("access-control-allow-origin", "*");
      response.setHeader("access-control-allow-methods", "GET, POST");
      response.setHeader("access-control-allow-headers", "content-type");
      response.end();
      return;
    }
    if (request.method === "GET" && target.pathname === "/.well-known/openid-configuration") {
      send(
        response,
        200,
        {
          issuer: url,
          authorization_endpoint: `${url}/authorize`,
          token_endpoint: `${url}/token`,
          jwks_uri: `${url}/jwks`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
        },
        true,
      );
      return;
    }
    if (request.method === "GET" && target.pathname === "/jwks") {
      send(response, 200, { keys: [publicJwk] }, true);
      return;
    }
    if (request.method === "GET" && target.pathname === "/authorize") {
      const q = target.searchParams;
      const redirectUri = q.get("redirect_uri");
      const challenge = q.get("code_challenge");
      if (
        q.get("client_id") !== options.clientId ||
        q.get("response_type") !== "code" ||
        q.get("code_challenge_method") !== "S256" ||
        !redirectUri ||
        !challenge
      ) {
        send(response, 400, { error: "invalid_request" });
        return;
      }
      const code = `fake-code-${randomBytes(12).toString("hex")}`;
      issuer.issued.codes.push(code);
      pendingCodes.set(code, { challenge, redirectUri, subject: issuer.subject });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      const state = q.get("state");
      if (state !== null) back.searchParams.set("state", state);
      response.statusCode = 302;
      response.setHeader("location", back.toString());
      response.end();
      return;
    }
    if (request.method === "POST" && target.pathname === "/token") {
      const form = new URLSearchParams(await readBody(request));
      if (form.get("client_id") !== options.clientId) {
        send(response, 401, { error: "invalid_client" }, true);
        return;
      }
      if (form.get("grant_type") === "authorization_code") {
        const pending = pendingCodes.get(form.get("code") ?? "");
        pendingCodes.delete(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        if (
          !pending ||
          pending.challenge !== challenge ||
          pending.redirectUri !== form.get("redirect_uri")
        ) {
          send(response, 400, { error: "invalid_grant" }, true);
          return;
        }
        send(response, 200, issueTokens(pending.subject), true);
        return;
      }
      if (form.get("grant_type") === "refresh_token") {
        const subject = refreshTokens.get(form.get("refresh_token") ?? "");
        if (issuer.refuseRefresh || subject === undefined) {
          send(response, 400, { error: "invalid_grant" }, true);
          return;
        }
        send(response, 200, issueTokens(subject), true);
        return;
      }
      send(response, 400, { error: "unsupported_grant_type" }, true);
      return;
    }
    send(response, 404, { error: "not_found" });
  }

  return issuer;
}
