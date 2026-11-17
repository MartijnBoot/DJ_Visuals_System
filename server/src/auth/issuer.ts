// The configured OIDC issuer (B-12 SD3, PD7): its discovery document, read once (its `issuer`
// must equal the configured one), and its JWKS, kept and refetched at most once a minute when a
// token names a `kid` the cached set lacks. An issuer that cannot be reached throws; that is
// never a token's fault, so callers keep it apart from a refused token. Log lines carry counts
// and kinds, never a token, a claim or a subject.
import { z } from "zod";
import type { Logger } from "../log.ts";
import { tokenKeyId, verifyIdToken, type Jwk, type VerifyResult } from "./jwt.ts";

export interface IssuerDeps {
  /** The configured issuer identifier (`OIDC_ISSUER`). */
  url: string;
  fetch: typeof fetch;
  now(): number;
  log: Logger;
}

export interface IssuerEndpoints {
  authorization: string;
  token: string;
}

export interface Issuer {
  endpoints(): Promise<IssuerEndpoints>;
  /** Verifies an ID token for `clientId`; throws only when the issuer cannot be read. */
  verify(token: string, clientId: string): Promise<VerifyResult>;
}

const REFETCH_MS = 60_000;
const TIMEOUT_MS = 10_000;

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  jwks_uri: z.string(),
});
const jwksSchema = z.object({ keys: z.array(z.looseObject({ kty: z.string() })) });

export class IssuerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IssuerError";
  }
}

export function createIssuer(deps: IssuerDeps): Issuer {
  let discovery: Promise<z.infer<typeof discoverySchema>> | null = null;
  let keys: Jwk[] | null = null;
  let keysFetchedAt = -Infinity;
  let keysInFlight: Promise<Jwk[]> | null = null;

  async function getJson(url: string): Promise<unknown> {
    const response = await deps.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new IssuerError(`issuer answered ${response.status}`);
    return response.json();
  }

  function readDiscovery() {
    discovery ??= (async () => {
      const url = `${deps.url.replace(/\/$/, "")}/.well-known/openid-configuration`;
      const parsed = discoverySchema.safeParse(await getJson(url));
      if (!parsed.success) throw new IssuerError("issuer discovery document is malformed");
      if (parsed.data.issuer !== deps.url) {
        throw new IssuerError("issuer discovery names another issuer");
      }
      return parsed.data;
    })().catch((error: unknown) => {
      discovery = null; // the next request tries again
      deps.log.warn({ kind: "discovery" }, "issuer unavailable");
      throw error;
    });
    return discovery;
  }

  function fetchKeys(): Promise<Jwk[]> {
    keysInFlight ??= (async () => {
      keysFetchedAt = deps.now();
      const parsed = jwksSchema.safeParse(await getJson((await readDiscovery()).jwks_uri));
      if (!parsed.success) throw new IssuerError("issuer key set is malformed");
      keys = parsed.data.keys as Jwk[];
      deps.log.debug({ keys: keys.length }, "issuer keys fetched");
      return keys;
    })()
      .catch((error: unknown) => {
        deps.log.warn({ kind: "keys" }, "issuer unavailable");
        throw error;
      })
      .finally(() => {
        keysInFlight = null;
      });
    return keysInFlight;
  }

  return {
    async endpoints() {
      const d = await readDiscovery();
      return { authorization: d.authorization_endpoint, token: d.token_endpoint };
    },
    async verify(token, clientId) {
      let known = keys ?? (await fetchKeys());
      const kid = tokenKeyId(token);
      const unknownKid = kid !== null && !known.some((k) => k.kid === kid);
      if (unknownKid && deps.now() - keysFetchedAt >= REFETCH_MS) known = await fetchKeys();
      return verifyIdToken(token, { issuer: deps.url, clientId, keys: known, now: deps.now() });
    },
  };
}
