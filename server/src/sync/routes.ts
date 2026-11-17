// The cloud's sync endpoints (B-12 spec, API contract; plan PD16, PD17, PD21), hosted mode
// only, behind the token guard (`server/src/auth/guard.ts`). Every body and query is validated
// before use and every answer is built through `shared/src/sync.ts`. Logs carry ids and
// revisions, never a definition.
import {
  issuesFrom,
  storedProfileSchema,
  SYNC_PAGE_LIMIT,
  syncChangesSchema,
  syncDeleteSchema,
  syncFullSchema,
  syncPutSchema,
} from "@djv/shared";
import type { App } from "../app.ts";
import type { ProfileStore } from "../profiles/store.ts";

/** Tombstones are removed after 90 days, by the cloud's clock (SD8, AC18). */
export const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;

type Query = Record<string, string | undefined>;

const DIGITS = /^\d{1,15}$/;

/** A non-negative integer query value, its default when absent, or null when malformed. */
function count(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  return DIGITS.test(value) ? Number(value) : null;
}

const invalid = (path: string, message: string) => ({
  error: "invalid",
  issues: [{ path, message }],
});

export function registerSync(app: App, store: ProfileStore, now: () => number): void {
  const limitOf = (query: Query) => {
    const limit = count(query.limit, SYNC_PAGE_LIMIT);
    return limit !== null && limit >= 1 && limit <= SYNC_PAGE_LIMIT ? limit : null;
  };

  app.get<{ Querystring: Query }>("/api/sync/changes", (request, reply) => {
    const cursor = count(request.query.cursor, 0);
    if (cursor === null) return reply.code(400).send(invalid("cursor", "must be an integer"));
    const limit = limitOf(request.query);
    if (limit === null) {
      return reply.code(400).send(invalid("limit", `must be from 1 to ${SYNC_PAGE_LIMIT}`));
    }
    store.purgeTombstones(new Date(now() - TOMBSTONE_TTL_MS));
    // A machine whose cursor is below a purged tombstone missed a delete: it pulls the full set.
    if (cursor > 0 && cursor < store.purgedThrough()) {
      return syncChangesSchema.parse({ reset: true });
    }
    return syncChangesSchema.parse(store.changesSince(cursor, limit));
  });

  app.get<{ Querystring: Query }>("/api/sync/full", (request, reply) => {
    const limit = limitOf(request.query);
    if (limit === null) {
      return reply.code(400).send(invalid("limit", `must be from 1 to ${SYNC_PAGE_LIMIT}`));
    }
    return syncFullSchema.parse(store.fullPage(request.query.after ?? "", limit));
  });

  app.put<{ Params: { id: string } }>("/api/sync/profiles/:id", (request, reply) => {
    const parsed = syncPutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid", issues: issuesFrom(parsed.error) });
    }
    const { baseRevision, conflictCopy, ...profile } = parsed.data;
    const result = store.syncPut(request.params.id, profile, baseRevision, conflictCopy === true);
    switch (result.kind) {
      case "unusable":
        return reply.code(422).send({ error: "unusable" });
      case "stale":
        return reply.code(409).send({
          error: "conflict",
          reason: "stale_revision",
          current: storedProfileSchema.parse(result.current),
        });
      case "ok":
        request.log.info(
          { id: result.profile.id, revision: result.profile.revision },
          "profile synced",
        );
        return storedProfileSchema.parse(result.profile);
    }
  });

  app.delete<{ Params: { id: string }; Querystring: Query }>(
    "/api/sync/profiles/:id",
    (request, reply) => {
      const base = request.query.baseRevision;
      if (base === undefined || !DIGITS.test(base)) {
        return reply.code(400).send(invalid("baseRevision", "must be an integer"));
      }
      const result = store.syncDelete(request.params.id, Number(base));
      switch (result.kind) {
        case "missing":
          return reply.code(404).send({ error: "not_found" });
        case "unusable":
          return reply.code(422).send({ error: "unusable" });
        case "kept":
          request.log.info(
            { id: request.params.id, revision: result.current.revision },
            "sync delete refused: edited since",
          );
          return syncDeleteSchema.parse({ deleted: false, current: result.current });
        case "deleted":
          request.log.info({ id: request.params.id }, "profile deleted by sync");
          return syncDeleteSchema.parse({ deleted: true });
      }
    },
  );
}
