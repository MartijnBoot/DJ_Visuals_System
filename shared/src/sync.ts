// The sync endpoints' bodies (B-12 spec, API contract; plan PD16, PD17): the cloud builds every
// answer through these and a local install parses every answer with them before use.
import { z } from "zod";
import { checkProfileRules, profileFields } from "./profile.ts";
import { storedProfileSchema } from "./profile-api.ts";

/** Sync pages hold at most this many changes or profiles (SD17, PD21). */
export const SYNC_PAGE_LIMIT = 50;

const counter = z.number().int().nonnegative();

/**
 * One change in the cloud's feed, in counter order: a profile as it is now (its conflict-copy
 * mark inside it), or the record of a delete (SD8).
 */
export const syncChangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("profile"), seq: counter, profile: storedProfileSchema }),
  z.strictObject({
    kind: z.literal("tombstone"),
    seq: counter,
    id: z.string().min(1),
    revision: z.number().int().positive(),
  }),
]);

export type SyncChange = z.infer<typeof syncChangeSchema>;

/** `GET /api/sync/changes`: a page of changes after `cursor`, or `reset` (AC18). */
export const syncChangesSchema = z.union([
  z.strictObject({ changes: z.array(syncChangeSchema), cursor: counter, more: z.boolean() }),
  z.strictObject({ reset: z.literal(true) }),
]);

export type SyncChanges = z.infer<typeof syncChangesSchema>;

/**
 * `GET /api/sync/full`: the whole set, paged by id. `counter` is the cloud's change counter when
 * the page was read; the first page's is the cursor a full pull ends on (PD16).
 */
export const syncFullSchema = z.strictObject({
  profiles: z.array(storedProfileSchema),
  counter,
  more: z.boolean(),
});

export type SyncFull = z.infer<typeof syncFullSchema>;

/**
 * `PUT /api/sync/profiles/:id`: the machine's profile and the cloud revision its edit started
 * from (0: the cloud never held it), plus the conflict-copy mark when set (PD28).
 */
export const syncPutSchema = z
  .strictObject({
    ...profileFields,
    baseRevision: z.number().int().nonnegative(),
    conflictCopy: z.literal(true).optional(),
  })
  .superRefine(checkProfileRules);

export type SyncPut = z.infer<typeof syncPutSchema>;

/** `DELETE /api/sync/profiles/:id?baseRevision=`: done, or refused with the cloud's (AC12). */
export const syncDeleteSchema = z.union([
  z.strictObject({ deleted: z.literal(true) }),
  z.strictObject({ deleted: z.literal(false), current: storedProfileSchema }),
]);

export type SyncDelete = z.infer<typeof syncDeleteSchema>;
