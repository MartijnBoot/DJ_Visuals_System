// GET /api/health (spec SD12, AC9): built through the shared schema so the server and the web
// agree on the body by construction.
import { healthResponseSchema, type HealthResponse } from "@djv/shared";
import type { App } from "./app.ts";

export interface HealthState {
  /** The number of the highest applied migration (plan PD19). */
  schemaVersion: number;
  /** Whole seconds since the server started listening. */
  uptimeSeconds(): number;
}

export function registerHealth(app: App, state: HealthState): void {
  app.get("/api/health", (): HealthResponse => {
    return healthResponseSchema.parse({
      status: "ok",
      schemaVersion: state.schemaVersion,
      uptimeSeconds: state.uptimeSeconds(),
    });
  });
}
