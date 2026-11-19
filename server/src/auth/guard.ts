// The cloud's permission check (B-12 SD4, SD17, AC1–AC3, PD7, PD11): every request to
// `/api/profiles*` and `/api/sync/*` in hosted mode carries `Authorization: Bearer <ID token>`.
// No or a malformed header, or a token that fails verification: 401. A valid token of any
// subject but the allowed one: 403. Ten such refusals from one address within 60 s answer 429
// for 60 s, before anything is verified. An issuer that cannot be read is 503 and counts as no
// refusal: it is not the caller's fault. Log lines carry the outcome and a reason, never the
// token or a subject.
import type { Logger } from "../log.ts";
import { createRateWindow } from "../rate-window.ts";
import type { VerifyResult } from "./jwt.ts";

export interface GuardDeps {
  verify(token: string): Promise<VerifyResult>;
  allowedSubject: string;
  now(): number;
  log: Pick<Logger, "info" | "warn">;
}

export interface Refusal {
  status: 401 | 403 | 429 | 503;
  body: { error: "unauthorized" | "forbidden" | "rate_limited" | "unavailable" };
}

export interface Guard {
  /** A refusal to answer with, or null when the request may go on. */
  check(ip: string, authorization: string | undefined): Promise<Refusal | null>;
}

export const GUARD_LIMITS = { refusals: 10, windowMs: 60_000, blockMs: 60_000 } as const;

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/** Whether a path is behind the guard (SD5): the profiles API and the sync endpoints. */
export const isGuardedPath = (path: string): boolean =>
  path === "/api/profiles" || path.startsWith("/api/profiles/") || path.startsWith("/api/sync/");

export function createGuard({ verify, allowedSubject, now, log }: GuardDeps): Guard {
  const window = createRateWindow({
    limit: GUARD_LIMITS.refusals,
    windowMs: GUARD_LIMITS.windowMs,
    blockMs: GUARD_LIMITS.blockMs,
    now,
  });

  const refuse = (ip: string, refusal: Refusal, fields: Record<string, string>): Refusal => {
    window.record(ip);
    log.info({ outcome: refusal.body.error, ...fields }, "request refused");
    return refusal;
  };

  return {
    async check(ip, authorization) {
      if (window.blocked(ip)) {
        log.info({ outcome: "rate_limited" }, "request refused");
        return { status: 429, body: { error: "rate_limited" } };
      }
      const token = BEARER.exec(authorization ?? "")?.[1];
      if (token === undefined) {
        return refuse(ip, { status: 401, body: { error: "unauthorized" } }, { reason: "no_token" });
      }
      let result: VerifyResult;
      try {
        result = await verify(token);
      } catch {
        log.warn({ outcome: "unavailable" }, "token not checked: issuer unavailable");
        return { status: 503, body: { error: "unavailable" } };
      }
      if (!result.ok) {
        return refuse(
          ip,
          { status: 401, body: { error: "unauthorized" } },
          { reason: result.reason },
        );
      }
      if (result.subject !== allowedSubject) {
        return refuse(ip, { status: 403, body: { error: "forbidden" } }, {});
      }
      return null;
    },
  };
}
