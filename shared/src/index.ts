import { z } from "zod";

export * from "./cloud.ts";
export * from "./control.ts";
export * from "./profile.ts";
export * from "./profile-api.ts";
export * from "./scenes.ts";
export * from "./sync.ts";
export { nextFreeName } from "./names.ts";

/** The body of `GET /api/health`: built by the server, parsed by the web before use. */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  schemaVersion: z.number().int().nonnegative(),
  uptimeSeconds: z.number().int().nonnegative(),
  /**
   * B-12 PD8: which way the app runs, whether a local install has cloud settings, and the
   * hosted sign-in's public settings. Optional: a page that reads none of them runs as the local
   * install with no cloud row, as before B-12.
   */
  mode: z.enum(["local", "hosted"]).optional(),
  cloud: z.boolean().optional(),
  signIn: z.object({ issuer: z.string(), clientId: z.string() }).nullable().optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
