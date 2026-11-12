// The profile client (B-02 plan T8; PD10): one function per endpoint, each taking an optional
// `fetch` like `web/src/health.ts`, sending JSON with its content type, parsing every answer
// with the shared schemas and returning a result union. None throws: a dead server can never
// stop the screen.
import {
  conflictErrorSchema,
  invalidErrorSchema,
  profileListSchema,
  storedProfileSchema,
  type ConflictError,
  type Issue,
  type Profile,
  type ProfileFile,
  type StoredProfile,
} from "@djv/shared";

export type Failure =
  | { kind: "invalid"; issues: Issue[] }
  | { kind: "conflict"; conflict: ConflictError }
  | { kind: "missing" }
  /** A stored row that fails the schema (422), or an answer that does not parse. */
  | { kind: "unusable" }
  /** An import file with a format version this server does not know (422). */
  | { kind: "unsupported_version" }
  /** The request failed, timed out or the server errored. */
  | { kind: "unreachable" };

export type ListResult = { kind: "ok"; profiles: StoredProfile[] } | Failure;
export type ProfileResult = { kind: "ok"; profile: StoredProfile } | Failure;
export type DeleteResult = { kind: "ok" } | Failure;

type FetchLike = typeof fetch;
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

const TIMEOUT_MS = 10_000;

interface Answer {
  status: number;
  body: unknown;
}

async function call(
  fetchImpl: FetchLike,
  method: string,
  path: string,
  body?: unknown,
): Promise<Answer | null> {
  try {
    const response = await fetchImpl(path, {
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // No body (204) or not JSON: the status alone is read.
    }
    return { status: response.status, body: parsed };
  } catch {
    return null;
  }
}

/** The failure an error status stands for. */
function failure(answer: Answer): Failure {
  const { status, body } = answer;
  if (status === 400) {
    const parsed = invalidErrorSchema.safeParse(body);
    return parsed.success ? { kind: "invalid", issues: parsed.data.issues } : { kind: "unusable" };
  }
  if (status === 404) return { kind: "missing" };
  if (status === 409) {
    const parsed = conflictErrorSchema.safeParse(body);
    return parsed.success ? { kind: "conflict", conflict: parsed.data } : { kind: "unusable" };
  }
  if (status === 422) {
    const unsupported =
      typeof body === "object" &&
      body !== null &&
      (body as { error?: unknown }).error === "unsupported_version";
    return unsupported ? { kind: "unsupported_version" } : { kind: "unusable" };
  }
  return status >= 500 ? { kind: "unreachable" } : { kind: "unusable" };
}

async function oneProfile(
  fetchImpl: FetchLike,
  method: string,
  path: string,
  expected: number,
  body?: unknown,
): Promise<ProfileResult> {
  const answer = await call(fetchImpl, method, path, body);
  if (!answer) return { kind: "unreachable" };
  if (answer.status !== expected) return failure(answer);
  const parsed = storedProfileSchema.safeParse(answer.body);
  return parsed.success ? { kind: "ok", profile: parsed.data } : { kind: "unusable" };
}

async function manyProfiles(
  fetchImpl: FetchLike,
  method: string,
  path: string,
  expected: number,
  body?: unknown,
): Promise<ListResult> {
  const answer = await call(fetchImpl, method, path, body);
  if (!answer) return { kind: "unreachable" };
  if (answer.status !== expected) return failure(answer);
  const parsed = profileListSchema.safeParse(answer.body);
  return parsed.success ? { kind: "ok", profiles: parsed.data.profiles } : { kind: "unusable" };
}

export const listProfiles = (fetchImpl: FetchLike = defaultFetch) =>
  manyProfiles(fetchImpl, "GET", "/api/profiles", 200);

export const getProfile = (id: string, fetchImpl: FetchLike = defaultFetch) =>
  oneProfile(fetchImpl, "GET", `/api/profiles/${encodeURIComponent(id)}`, 200);

export const createProfile = (profile: Profile, fetchImpl: FetchLike = defaultFetch) =>
  oneProfile(fetchImpl, "POST", "/api/profiles", 201, profile);

/** `revision` is the one the edit started from (SD10). */
export const updateProfile = (
  id: string,
  profile: Profile,
  revision: number,
  fetchImpl: FetchLike = defaultFetch,
) =>
  oneProfile(fetchImpl, "PUT", `/api/profiles/${encodeURIComponent(id)}`, 200, {
    ...profile,
    revision,
  });

export async function deleteProfile(
  id: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<DeleteResult> {
  const answer = await call(fetchImpl, "DELETE", `/api/profiles/${encodeURIComponent(id)}`);
  if (!answer) return { kind: "unreachable" };
  return answer.status === 204 ? { kind: "ok" } : failure(answer);
}

export const importProfiles = (file: ProfileFile, fetchImpl: FetchLike = defaultFetch) =>
  manyProfiles(fetchImpl, "POST", "/api/profiles/import", 201, file);
