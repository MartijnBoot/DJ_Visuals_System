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

/** How this page runs (B-12 PD8): read once, before the page renders. */
export interface PageMode {
  mode: "local" | "hosted";
  cloud: boolean;
  signIn: { issuer: string; clientId: string } | null;
}

const LOCAL: PageMode = { mode: "local", cloud: false, signIn: null };

/**
 * Reads the mode from `/api/health`. Anything short of a valid answer reads as the local page
 * with no cloud row, as before B-12; hosted is read only with its sign-in settings.
 */
export async function readHealth(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<PageMode> {
  try {
    const response = await fetchImpl("/api/health", { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status !== 200) return LOCAL;
    const parsed = healthResponseSchema.safeParse(await response.json());
    if (!parsed.success) return LOCAL;
    const { mode, cloud, signIn } = parsed.data;
    if (mode === "hosted") return signIn ? { mode, cloud: false, signIn } : LOCAL;
    return { mode: "local", cloud: cloud === true, signIn: null };
  } catch {
    return LOCAL;
  }
}
