import { describe, expect, it } from "vitest";
import { checkHealth, readHealth } from "./health.ts";

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

const validBody = { status: "ok", schemaVersion: 1, uptimeSeconds: 12 };

describe("checkHealth (spec AC12, AC13)", () => {
  it("asks /api/health and reads ok from a valid body", async () => {
    const urls: string[] = [];
    const status = await checkHealth((input) => {
      urls.push(String(input));
      return json(validBody);
    });
    expect(status).toBe("ok");
    expect(urls).toEqual(["/api/health"]);
  });

  it("reads unreachable when the fetch rejects", async () => {
    const status = await checkHealth(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(status).toBe("unreachable");
  });

  it("reads unreachable on status 500", async () => {
    expect(await checkHealth(() => json(validBody, 500))).toBe("unreachable");
  });

  it("reads unreachable when the body is missing schemaVersion", async () => {
    const { schemaVersion: _omitted, ...body } = validBody;
    expect(await checkHealth(() => json(body))).toBe("unreachable");
  });

  it("reads unreachable when the body is not JSON", async () => {
    expect(await checkHealth(() => Promise.resolve(new Response("<html>")))).toBe("unreachable");
  });
});

describe("readHealth (B-12 PD8)", () => {
  it("reads the mode, cloud and sign-in settings from /api/health", async () => {
    const urls: string[] = [];
    const signIn = { issuer: "https://issuer.example.test", clientId: "c" };
    const info = await readHealth((input) => {
      urls.push(String(input));
      return json({ ...validBody, mode: "hosted", cloud: false, signIn });
    });
    expect(info).toEqual({ mode: "hosted", cloud: false, signIn });
    expect(urls).toEqual(["/api/health"]);
  });

  it("reads a local install with cloud settings", async () => {
    const info = await readHealth(() =>
      json({ ...validBody, mode: "local", cloud: true, signIn: null }),
    );
    expect(info).toEqual({ mode: "local", cloud: true, signIn: null });
  });

  it.each([
    ["the fetch rejects", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["status 500", () => json(validBody, 500)],
    ["a body without the fields", () => json(validBody)],
    ["a body that is not JSON", () => Promise.resolve(new Response("<html>"))],
    ["hosted without sign-in settings", () => json({ ...validBody, mode: "hosted", signIn: null })],
  ])("reads the local page with no cloud row when %s", async (_name, answer) => {
    expect(await readHealth(answer as typeof fetch)).toEqual({
      mode: "local",
      cloud: false,
      signIn: null,
    });
  });
});
