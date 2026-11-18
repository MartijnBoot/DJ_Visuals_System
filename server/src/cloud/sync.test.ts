// B-12 AC9 (review finding 4): a run in flight makes no further request once a set has started,
// on any path — between requests, and between a 401 and its renewal and resend. Fakes only: the
// cloud, the store and the sign-in; the real exchange is server/test/sync.int.test.ts.
import { describe, expect, it } from "vitest";
import type { PendingChange, ProfileStore } from "../profiles/store.ts";
import type { Signin } from "./signin.ts";
import { runSync } from "./sync.ts";

const quiet = { info: () => {}, warn: () => {} };

/** A store with nothing to pull into and the given changes waiting to be pushed. */
function storeWith(pending: PendingChange[]): ProfileStore {
  return {
    cursor: () => 0,
    pending: () => pending,
    applyPull: () => ({ conflicts: 0 }),
    acknowledgeDelete: () => {},
  } as unknown as ProfileStore;
}

function signinCounting() {
  const counts = { renewals: 0 };
  const signin = {
    idToken: async () => ({ kind: "token", token: "id-token" }),
    renew: async () => {
      counts.renewals += 1;
      return { kind: "token", token: "renewed-token" };
    },
    rejected: () => {},
  } as unknown as Signin;
  return { signin, counts };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const twoDeletes: PendingChange[] = [
  { kind: "delete", id: "p-1", seq: 1, baseRevision: 1 },
  { kind: "delete", id: "p-2", seq: 2, baseRevision: 1 },
];

describe("a set starting during a run (AC9)", () => {
  it("stops before the next request: the pull was the only one", async () => {
    let requests = 0;
    let running = false;
    const fetch = (async () => {
      requests += 1;
      running = true; // the set starts while the first request is out
      return json(200, { changes: [], cursor: 0, more: false });
    }) as typeof globalThis.fetch;
    const { signin } = signinCounting();
    const result = await runSync({
      store: storeWith(twoDeletes),
      signin,
      cloudUrl: "http://127.0.0.1:9",
      fetch,
      log: quiet,
      mayContinue: () => !running,
    });
    expect(result.outcome).toBe("paused");
    expect(requests).toBe(1);
  });

  it("does not renew or resend after a 401 that came back once the set had started", async () => {
    let requests = 0;
    let running = false;
    const fetch = (async () => {
      requests += 1;
      running = true;
      return json(401, { error: "unauthorized" });
    }) as typeof globalThis.fetch;
    const { signin, counts } = signinCounting();
    const result = await runSync({
      store: storeWith([]),
      signin,
      cloudUrl: "http://127.0.0.1:9",
      fetch,
      log: quiet,
      mayContinue: () => !running,
    });
    expect(result.outcome).toBe("paused");
    expect(requests).toBe(1);
    expect(counts.renewals).toBe(0);
  });
});
