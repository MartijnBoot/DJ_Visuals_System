// The overlay's server line (spec SD13, AC13): `/api/health` parsed with the shared schema
// before use. Anything short of a valid 200 body reads `unreachable`; this never throws, so
// a dead server can never stop the engine.
import { healthResponseSchema } from "@djv/shared";

export type ServerStatus = "ok" | "unreachable";

// Below the 5 s poll, so a server that accepts but never answers still flips the line.
const TIMEOUT_MS = 4000;

export async function checkHealth(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<ServerStatus> {
  try {
    const response = await fetchImpl("/api/health", { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status !== 200) return "unreachable";
    return healthResponseSchema.safeParse(await response.json()).success ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}
