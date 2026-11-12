// The profile endpoints (B-02 spec, API contract; plan PD10): every body parsed with the shared
// schemas and every answer built through them, as `health.ts` does, so server and web agree by
// construction. No route sets a CORS header. Logs carry the id and revision, never the
// definition.
import {
  FORMAT_VERSION,
  issuesFrom,
  profileFileSchema,
  profileListSchema,
  profileSchema,
  storedProfileSchema,
  updateProfileSchema,
  type Issue,
} from "@djv/shared";
import type { App } from "../app.ts";
import type { ProfileStore } from "./store.ts";

/** A bundle import's body limit (B-02 SD18). */
export const IMPORT_BODY_LIMIT = 1024 * 1024;

export function registerProfiles(app: App, store: ProfileStore): void {
  app.get("/api/profiles", () => profileListSchema.parse({ profiles: store.list() }));

  app.get<{ Params: { id: string } }>("/api/profiles/:id", (request, reply) => {
    const result = store.get(request.params.id);
    if (result.kind === "missing") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "unusable") return reply.code(422).send({ error: "unusable" });
    return storedProfileSchema.parse(result.profile);
  });

  app.post("/api/profiles", (request, reply) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid", issues: issuesFrom(parsed.error) });
    }
    const result = store.create(parsed.data);
    if (result.kind === "name_taken") {
      return reply.code(409).send({ error: "conflict", reason: "name_taken" });
    }
    request.log.info(
      { id: result.profile.id, revision: result.profile.revision },
      "profile created",
    );
    return reply.code(201).send(storedProfileSchema.parse(result.profile));
  });

  app.put<{ Params: { id: string } }>("/api/profiles/:id", (request, reply) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid", issues: issuesFrom(parsed.error) });
    }
    const { revision, ...profile } = parsed.data;
    const result = store.update(request.params.id, profile, revision);
    switch (result.kind) {
      case "missing":
        return reply.code(404).send({ error: "not_found" });
      case "unusable":
        return reply.code(422).send({ error: "unusable" });
      case "name_taken":
        return reply.code(409).send({ error: "conflict", reason: "name_taken" });
      case "stale":
        return reply.code(409).send({
          error: "conflict",
          reason: "stale_revision",
          current: storedProfileSchema.parse(result.current),
        });
      case "ok":
        request.log.info(
          { id: result.profile.id, revision: result.profile.revision },
          "profile updated",
        );
        return storedProfileSchema.parse(result.profile);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", (request, reply) => {
    if (!store.remove(request.params.id)) return reply.code(404).send({ error: "not_found" });
    request.log.info({ id: request.params.id }, "profile deleted");
    return reply.code(204).send();
  });

  app.post("/api/profiles/import", { bodyLimit: IMPORT_BODY_LIMIT }, (request, reply) => {
    const body = request.body;
    // A version this server does not know is told apart first: the rest of the file may be in a
    // shape it cannot read at all (AC10).
    if (
      isRecord(body) &&
      typeof body.formatVersion === "number" &&
      body.formatVersion !== FORMAT_VERSION
    ) {
      return reply.code(422).send({ error: "unsupported_version" });
    }
    const parsed = profileFileSchema.safeParse(body);
    if (!parsed.success) {
      const issues: Issue[] = issuesFrom(parsed.error).map((issue) => {
        const name = profileNameAt(body, issue.path);
        return name === undefined ? issue : { ...issue, profile: name };
      });
      return reply.code(400).send({ error: "invalid", issues });
    }
    const stored = store.importAll(parsed.data.profiles);
    request.log.info({ count: stored.length, ids: stored.map((p) => p.id) }, "profiles imported");
    return reply.code(201).send(profileListSchema.parse({ profiles: stored }));
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The name of the profile an issue path `profiles.<index>…` points into, when readable. */
function profileNameAt(body: unknown, path: string): string | undefined {
  const match = /^profiles\.(\d+)(\.|$)/.exec(path);
  if (!match || !isRecord(body) || !Array.isArray(body.profiles)) return undefined;
  const entry: unknown = body.profiles[Number(match[1])];
  return isRecord(entry) && typeof entry.name === "string" ? entry.name : undefined;
}
