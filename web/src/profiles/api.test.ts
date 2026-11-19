// T8 (B-02 plan PD10): each status maps to its result, with a fake fetch.
import type { Profile, StoredProfile } from "@djv/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setHostedSession } from "../auth/session.ts";
import {
  createProfile,
  deleteProfile,
  getProfile,
  importProfiles,
  listProfiles,
  updateProfile,
} from "./api.ts";

const profile: Profile = {
  name: "Warm",
  palette: ["#000000", "#ffffff"],
  dials: { recognisability: 0.3, reactivity: 0.7 },
  effects: [{ type: "zoom", amount: 0.5 }],
};

const stored: StoredProfile = {
  ...profile,
  id: "abc",
  revision: 1,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
};

const reply = (status: number, body?: unknown) =>
  vi.fn<typeof fetch>(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );

describe("reads", () => {
  it("lists stored profiles", async () => {
    const fetchImpl = reply(200, { profiles: [stored] });
    expect(await listProfiles(fetchImpl)).toEqual({ kind: "ok", profiles: [stored] });
    expect(fetchImpl.mock.calls[0]![0]).toBe("/api/profiles");
  });

  it("gets one, encoding its id", async () => {
    const fetchImpl = reply(200, stored);
    expect(await getProfile("a/b", fetchImpl)).toEqual({ kind: "ok", profile: stored });
    expect(fetchImpl.mock.calls[0]![0]).toBe("/api/profiles/a%2Fb");
  });

  it("maps 404 to missing and 422 to unusable", async () => {
    expect(await getProfile("x", reply(404, { error: "not_found" }))).toEqual({ kind: "missing" });
    expect(await getProfile("x", reply(422, { error: "unusable" }))).toEqual({ kind: "unusable" });
  });

  it("reads a 200 whose body fails the schema as unusable", async () => {
    expect(await getProfile("x", reply(200, { ...stored, palette: ["red"] }))).toEqual({
      kind: "unusable",
    });
    expect(await listProfiles(reply(200, { profiles: [{ nope: 1 }] }))).toEqual({
      kind: "unusable",
    });
    const notJson = vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 }));
    expect(await listProfiles(notJson)).toEqual({ kind: "unusable" });
  });

  it("reads a rejected fetch, a timeout and a 5xx as unreachable", async () => {
    const rejected = vi.fn<typeof fetch>(async () => {
      throw new TypeError("failed to fetch");
    });
    expect(await listProfiles(rejected)).toEqual({ kind: "unreachable" });
    expect(await getProfile("x", rejected)).toEqual({ kind: "unreachable" });
    expect(await listProfiles(reply(500, { error: "internal" }))).toEqual({ kind: "unreachable" });
  });
});

describe("writes", () => {
  it("send JSON with the content type and the profile as the body", async () => {
    const fetchImpl = reply(201, stored);
    expect(await createProfile(profile, fetchImpl)).toEqual({ kind: "ok", profile: stored });
    const [path, init] = fetchImpl.mock.calls[0]!;
    expect(path).toBe("/api/profiles");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual(profile);
  });

  it("send the revision with an update", async () => {
    const fetchImpl = reply(200, { ...stored, revision: 2 });
    const result = await updateProfile("abc", profile, 1, fetchImpl);
    expect(result).toMatchObject({ kind: "ok", profile: { revision: 2 } });
    const [path, init] = fetchImpl.mock.calls[0]!;
    expect(path).toBe("/api/profiles/abc");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({ ...profile, revision: 1 });
  });

  it("sends an import with the content type, and reads 201 as the stored profiles", async () => {
    const fetchImpl = reply(201, { profiles: [stored] });
    const file = { formatVersion: 1 as const, profiles: [profile] };
    expect(await importProfiles(file, fetchImpl)).toEqual({ kind: "ok", profiles: [stored] });
    const [path, init] = fetchImpl.mock.calls[0]!;
    expect(path).toBe("/api/profiles/import");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
  });

  it("maps 400 to invalid with its issues", async () => {
    const issues = [{ path: "effects.0.amount", message: "too big" }];
    expect(await createProfile(profile, reply(400, { error: "invalid", issues }))).toEqual({
      kind: "invalid",
      issues,
    });
  });

  it("maps 409 to a conflict, with the current profile for a stale revision", async () => {
    const stale = { error: "conflict", reason: "stale_revision", current: stored };
    expect(await updateProfile("abc", profile, 1, reply(409, stale))).toEqual({
      kind: "conflict",
      conflict: stale,
    });
    const taken = { error: "conflict", reason: "name_taken" };
    expect(await createProfile(profile, reply(409, taken))).toEqual({
      kind: "conflict",
      conflict: taken,
    });
    expect(await createProfile(profile, reply(409, { error: "conflict" }))).toEqual({
      kind: "unusable",
    });
  });

  it("maps 404 on update to missing, and 422 on import to an unsupported version", async () => {
    expect(await updateProfile("abc", profile, 1, reply(404, { error: "not_found" }))).toEqual({
      kind: "missing",
    });
    const file = { formatVersion: 1 as const, profiles: [profile] };
    expect(await importProfiles(file, reply(422, { error: "unsupported_version" }))).toEqual({
      kind: "unsupported_version",
    });
  });

  it("maps 413 and 415 to unusable", async () => {
    expect(await createProfile(profile, reply(413, { error: "payload_too_large" }))).toEqual({
      kind: "unusable",
    });
    expect(await createProfile(profile, reply(415, { error: "unsupported_media_type" }))).toEqual({
      kind: "unusable",
    });
  });
});

describe("delete", () => {
  it("sends no body or content type, and reads 204 as ok and 404 as missing", async () => {
    const fetchImpl = reply(204);
    expect(await deleteProfile("abc", fetchImpl)).toEqual({ kind: "ok" });
    const [path, init] = fetchImpl.mock.calls[0]!;
    expect(path).toBe("/api/profiles/abc");
    expect(init?.method).toBe("DELETE");
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeUndefined();
    expect(await deleteProfile("abc", reply(404, { error: "not_found" }))).toEqual({
      kind: "missing",
    });
  });
});

// B-12 T12 (AC21–AC23, PD9): hosted, every profile request carries the session's ID token; a 401
// renews once and retries once; then the request fails as signed out. 403 is "not allowed".
describe("hosted: the bearer (B-12 PD9)", () => {
  let tokens: (string | null)[];
  let renewals: (string | null)[];
  let renewCalls: number;

  beforeEach(() => {
    tokens = ["tok-1"];
    renewals = ["tok-2"];
    renewCalls = 0;
    setHostedSession({
      start: async () => "signed_in",
      signIn: async () => {},
      token: async () => tokens.shift() ?? null,
      renew: async () => {
        renewCalls += 1;
        return renewals.shift() ?? null;
      },
      isSignedOut: () => false,
      onSignedOut: () => () => {},
    });
  });
  afterEach(() => setHostedSession(null));

  const auth = (init: RequestInit | undefined) =>
    (init?.headers as Record<string, string> | undefined)?.authorization;

  it("sends the token on GET, DELETE and PUT", async () => {
    const list = reply(200, { profiles: [stored] });
    await listProfiles(list);
    expect(auth(list.mock.calls[0]![1])).toBe("Bearer tok-1");

    tokens = ["tok-1"];
    const del = reply(204);
    expect(await deleteProfile("abc", del)).toEqual({ kind: "ok" });
    expect(del.mock.calls[0]![1]?.headers).toEqual({ authorization: "Bearer tok-1" });

    tokens = ["tok-1"];
    const put = reply(200, stored);
    await updateProfile("abc", profile, 1, put);
    expect(put.mock.calls[0]![1]?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer tok-1",
    });
  });

  it("renews once on a 401 and retries once with the new token", async () => {
    const answers = [401, 200];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const status = answers.shift()!;
      return new Response(JSON.stringify(status === 200 ? { profiles: [] } : {}), { status });
    });
    expect(await listProfiles(fetchImpl)).toEqual({ kind: "ok", profiles: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(auth(fetchImpl.mock.calls[1]![1])).toBe("Bearer tok-2");
    expect(renewCalls).toBe(1);
  });

  it("is signed_out after a second 401, renewing only once", async () => {
    const fetchImpl = reply(401, { error: "unauthorized" });
    expect(await getProfile("abc", fetchImpl)).toEqual({ kind: "signed_out" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(renewCalls).toBe(1);
  });

  it("is signed_out with no retry when renewal fails", async () => {
    renewals = [null];
    const fetchImpl = reply(401, { error: "unauthorized" });
    expect(await listProfiles(fetchImpl)).toEqual({ kind: "signed_out" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("is signed_out and asks nothing when there is no token", async () => {
    tokens = [null];
    const fetchImpl = reply(200, { profiles: [] });
    expect(await listProfiles(fetchImpl)).toEqual({ kind: "signed_out" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads 403 as not_allowed", async () => {
    expect(await listProfiles(reply(403, { error: "forbidden" }))).toEqual({
      kind: "not_allowed",
    });
  });
});

describe("local: no bearer (B-12 AC19)", () => {
  it("sends no authorization header on any request", async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ profiles: [] }), { status: 200 });
    });
    await listProfiles(fetchImpl);
    await getProfile("abc", fetchImpl);
    await createProfile(profile, fetchImpl);
    await updateProfile("abc", profile, 1, fetchImpl);
    await deleteProfile("abc", fetchImpl);
    for (const init of calls) expect(auth(init)).toBeUndefined();
  });
  const auth = (init: RequestInit) =>
    (init.headers as Record<string, string> | undefined)?.authorization;
});
