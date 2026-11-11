import { z } from "zod";

/** The body of `GET /api/health`: built by the server, parsed by the web before use. */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  schemaVersion: z.number().int().nonnegative(),
  uptimeSeconds: z.number().int().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
