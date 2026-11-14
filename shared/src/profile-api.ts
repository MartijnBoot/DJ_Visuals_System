// The bodies of the profile endpoints (B-02 spec, API contract) and their error shapes (plan
// PD10). The server builds every answer through these and `web/` parses every answer with them.
import { z } from "zod";
import { checkProfileRules, profileFields } from "./profile.ts";

/** A profile as the server stores and returns it. */
export const storedProfileSchema = z
  .strictObject({
    ...profileFields,
    id: z.string().min(1),
    revision: z.number().int().positive(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .superRefine(checkProfileRules);

export type StoredProfile = z.infer<typeof storedProfileSchema>;

/** `GET /api/profiles` and `POST /api/profiles/import`. */
export const profileListSchema = z.strictObject({ profiles: z.array(storedProfileSchema) });

/** `PUT /api/profiles/:id`: the profile plus the revision the edit started from (SD10). */
export const updateProfileSchema = z
  .strictObject({ ...profileFields, revision: z.number().int().positive() })
  .superRefine(checkProfileRules);

export type UpdateProfile = z.infer<typeof updateProfileSchema>;

export const issueSchema = z.strictObject({
  /** Dotted, e.g. `effects.2.amount`; for an import it starts `profiles.<index>`. */
  path: z.string(),
  message: z.string(),
  /** On an import: the failing profile's name, when it is readable. */
  profile: z.string().optional(),
});

export type Issue = z.infer<typeof issueSchema>;

/** 400. */
export const invalidErrorSchema = z.strictObject({
  error: z.literal("invalid"),
  issues: z.array(issueSchema),
});

/** 409: a stale revision carries the stored profile, so the builder can offer "reload theirs". */
export const conflictErrorSchema = z.discriminatedUnion("reason", [
  z.strictObject({
    error: z.literal("conflict"),
    reason: z.literal("stale_revision"),
    current: storedProfileSchema,
  }),
  z.strictObject({ error: z.literal("conflict"), reason: z.literal("name_taken") }),
]);

export type ConflictError = z.infer<typeof conflictErrorSchema>;

/** 404, 413, 415, 422. */
export const errorSchema = z.object({ error: z.string() });

/** A zod error as the API's issues, each with its dotted path, optionally under a prefix. */
export function issuesFrom(error: z.ZodError, prefix: readonly (string | number)[] = []): Issue[] {
  return error.issues.map((issue) => ({
    path: [...prefix, ...issue.path].map(String).join("."),
    message: issue.message,
  }));
}
