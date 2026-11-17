// The local install's cloud row (B-12 spec, API contract, UI; plan PD18): the status every
// `/api/cloud/*` answer carries, and the provider URL "Connect to cloud" opens.
import { z } from "zod";

export const CLOUD_STATES = [
  "not_connected",
  "connected",
  "syncing",
  "offline",
  "paused",
  "signed_out",
] as const;

export const cloudStatusSchema = z.strictObject({
  state: z.enum(CLOUD_STATES),
  /** ISO-8601 UTC of the last good sync, or null before one. */
  lastSyncAt: z.string().nullable(),
  /** Profiles marked "Conflict copy" right now (PD3). */
  conflicts: z.number().int().nonnegative(),
});

export type CloudStatus = z.infer<typeof cloudStatusSchema>;

/** `POST /api/cloud/connect`: the provider's sign-in page, opened in a new tab. */
export const cloudConnectSchema = z.strictObject({ url: z.string().url() });
