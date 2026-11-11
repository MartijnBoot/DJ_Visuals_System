import { describe, expect, it } from "vitest";
import { checkHealth } from "./health.ts";

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
