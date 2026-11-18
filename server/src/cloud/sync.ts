// One sync run between a local install and the cloud (B-12 SD2, SD8, SD9, SD13; plan PD16,
// PD21). First the pull: every page of the cloud's feed is fetched, then all are applied in one
// transaction with the new cursor (AC16); a `reset` answer switches to the full set (AC18). Then
// the push: every unsynced row and pending delete, one request each, in change order (AC7).
// Every request has a 10 s timeout. A 401 renews the ID token once and retries once; a second
// is "signed out". No answer, a refused connection, 429 or 5xx end the run "offline" with the
// queue intact (AC17). `mayContinue` is asked before every request: false ends the run
// "paused" there (a set started, AC9). Log lines carry counts and kinds, never a token or a
// definition (SD18, AC26).
import {
  conflictErrorSchema,
  storedProfileSchema,
  SYNC_PAGE_LIMIT,
  syncChangesSchema,
  syncDeleteSchema,
  syncFullSchema,
  type StoredProfile,
  type SyncChange,
} from "@djv/shared";
import type { Logger } from "../log.ts";
import type { PendingChange, ProfileStore } from "../profiles/store.ts";
import type { Signin } from "./signin.ts";

export type SyncOutcome = "done" | "offline" | "signed_out" | "not_connected" | "paused";

export interface SyncResult {
  outcome: SyncOutcome;
  pulled: number;
  pushed: number;
  conflicts: number;
}

export interface SyncDeps {
  store: ProfileStore;
  signin: Signin;
  cloudUrl: string;
  fetch: typeof fetch;
  log: Pick<Logger, "info" | "warn">;
  /** Asked before each request; false stops the run there (SD2). */
  mayContinue?: () => boolean;
}

const TIMEOUT_MS = 10_000;
/** Push passes per run: a conflict's copy is pushed in the same run, but a run always ends. */
const PUSH_PASSES = 3;

class Stop extends Error {
  readonly outcome: Exclude<SyncOutcome, "done">;
  constructor(outcome: Exclude<SyncOutcome, "done">, kind: string) {
    super(kind);
    this.outcome = outcome;
  }
}

interface Answer {
  status: number;
  body: unknown;
}

export async function runSync(deps: SyncDeps): Promise<SyncResult> {
  const base = deps.cloudUrl.replace(/\/$/, "");
  const counts = { pulled: 0, pushed: 0, conflicts: 0 };

  async function send(method: string, path: string, token: string, body?: unknown) {
    try {
      const response = await deps.fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        // No body or not JSON: the status alone is read.
      }
      return { status: response.status, body: parsed };
    } catch {
      throw new Stop("offline", "no_answer");
    }
  }

  /** Before every outgoing request, the renewal's included: a set may have started (AC9). */
  function mayGoOn(): void {
    if (deps.mayContinue && !deps.mayContinue()) throw new Stop("paused", "set_running");
  }

  async function request(method: string, path: string, body?: unknown): Promise<Answer> {
    mayGoOn();
    const token = await deps.signin.idToken();
    if (token.kind !== "token") throw new Stop(token.kind, "token");
    mayGoOn();
    let answer = await send(method, path, token.token, body);
    if (answer.status === 401) {
      mayGoOn();
      const renewed = await deps.signin.renew();
      if (renewed.kind !== "token") throw new Stop(renewed.kind, "renewal");
      mayGoOn();
      answer = await send(method, path, renewed.token, body);
      if (answer.status === 401) {
        deps.signin.rejected(); // a token just renewed and still refused: signed out (PD20)
        throw new Stop("signed_out", "refused");
      }
    }
    if (answer.status === 429 || answer.status >= 500) throw new Stop("offline", "busy");
    if (answer.status === 403) throw new Stop("signed_out", "forbidden");
    return answer;
  }

  function parsed<T>(schema: { safeParse(v: unknown): { success: boolean; data?: T } }, a: Answer) {
    const result = schema.safeParse(a.body);
    if (a.status !== 200 || !result.success) throw new Stop("offline", "unusable_answer");
    return result.data as T;
  }

  async function pull(): Promise<void> {
    const cursor = deps.store.cursor();
    const changes: SyncChange[] = [];
    let next = cursor;
    for (;;) {
      const page = parsed(
        syncChangesSchema,
        await request("GET", `/api/sync/changes?cursor=${next}&limit=${SYNC_PAGE_LIMIT}`),
      );
      if ("reset" in page) return pullFull();
      changes.push(...page.changes);
      next = page.cursor;
      if (!page.more) break;
    }
    if (changes.length === 0 && next === cursor) return; // nothing to move: one request
    counts.conflicts += deps.store.applyPull(changes, next).conflicts;
    counts.pulled += changes.length;
  }

  async function pullFull(): Promise<void> {
    const profiles: StoredProfile[] = [];
    let after = "";
    let counter: number | null = null;
    for (;;) {
      const page = parsed(
        syncFullSchema,
        await request(
          "GET",
          `/api/sync/full?after=${encodeURIComponent(after)}&limit=${SYNC_PAGE_LIMIT}`,
        ),
      );
      counter ??= page.counter;
      profiles.push(...page.profiles);
      if (!page.more || page.profiles.length === 0) break;
      after = page.profiles.at(-1)!.id;
    }
    counts.conflicts += deps.store.applyFull(profiles, counter).conflicts;
    counts.pulled += profiles.length;
    deps.log.info({ profiles: profiles.length }, "sync pulled the full set");
  }

  async function pushOne(change: PendingChange): Promise<void> {
    const path = `/api/sync/profiles/${encodeURIComponent(change.id)}`;
    if (change.kind === "delete") {
      const answer = await request("DELETE", `${path}?baseRevision=${change.baseRevision}`);
      if (answer.status === 404) {
        deps.store.acknowledgeDelete(change.id, null);
      } else {
        const result = parsed(syncDeleteSchema, answer);
        deps.store.acknowledgeDelete(change.id, result.deleted ? null : result.current);
      }
      counts.pushed += 1;
      return;
    }
    const answer = await request("PUT", path, {
      ...change.profile,
      baseRevision: change.baseRevision,
      ...(change.conflictCopy ? { conflictCopy: true } : {}),
    });
    if (answer.status === 409) {
      const conflict = conflictErrorSchema.safeParse(answer.body);
      if (!conflict.success || conflict.data.reason !== "stale_revision") {
        throw new Stop("offline", "unusable_answer");
      }
      deps.store.conflict(change.id, conflict.data.current);
      counts.conflicts += 1;
      return;
    }
    if (answer.status === 400 || answer.status === 422) {
      // The cloud cannot take this profile; it stays here, unsynced (spec Edge cases).
      deps.log.warn({ id: change.id, status: answer.status }, "sync push refused");
      return;
    }
    deps.store.acknowledgePut(change.id, change.seq, parsed(storedProfileSchema, answer));
    counts.pushed += 1;
  }

  async function push(): Promise<void> {
    const tried = new Set<string>();
    for (let pass = 0; pass < PUSH_PASSES; pass += 1) {
      const fresh = deps.store.pending().filter((c) => !tried.has(`${c.kind}:${c.id}:${c.seq}`));
      if (fresh.length === 0) return;
      for (const change of fresh) {
        tried.add(`${change.kind}:${change.id}:${change.seq}`);
        await pushOne(change);
      }
    }
  }

  try {
    await pull();
    await push();
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    deps.log.warn({ kind: error.message, outcome: error.outcome, ...counts }, "sync failed");
    return { outcome: error.outcome, ...counts };
  }
  deps.log.info(counts, "sync finished");
  return { outcome: "done", ...counts };
}
