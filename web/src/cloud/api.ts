// The panel's cloud row client (B-12 spec API contract; plan PD18): `/api/cloud/*` on the local
// install, every call on a user action (the panel opening, a button, the page regaining focus
// after "Connect to cloud"), never on a timer. Every answer is parsed with the shared schemas;
// none throws.
import { cloudConnectSchema, cloudStatusSchema, type CloudStatus } from "@djv/shared";

export type CloudAnswer =
  | { kind: "status"; status: CloudStatus }
  /** "Sync now" while a set runs (AC10). */
  | { kind: "paused" }
  | { kind: "unreachable" };

const TIMEOUT_MS = 10_000;
/** A run waits for its requests' own 10 s timeouts; this one must outlast several. */
const SYNC_TIMEOUT_MS = 120_000;

async function call(
  method: "GET" | "POST",
  path: string,
  timeout = TIMEOUT_MS,
): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetch(path, {
      method,
      signal: AbortSignal.timeout(timeout),
      ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON: the status alone is read.
    }
    return { status: response.status, body };
  } catch {
    return null;
  }
}

function statusOf(answer: { status: number; body: unknown } | null): CloudAnswer {
  if (answer?.status === 409) return { kind: "paused" };
  const parsed = cloudStatusSchema.safeParse(answer?.body);
  return answer?.status === 200 && parsed.success
    ? { kind: "status", status: parsed.data }
    : { kind: "unreachable" };
}

export const readStatus = async () => statusOf(await call("GET", "/api/cloud/status"));
export const syncNow = async () => statusOf(await call("POST", "/api/cloud/sync", SYNC_TIMEOUT_MS));
export const disconnect = async () => statusOf(await call("POST", "/api/cloud/disconnect"));

/** The provider's sign-in page for "Connect to cloud", or null when it cannot be had. */
export async function connectUrl(): Promise<string | null> {
  const answer = await call("POST", "/api/cloud/connect");
  const parsed = cloudConnectSchema.safeParse(answer?.body);
  return answer?.status === 200 && parsed.success ? parsed.data.url : null;
}
