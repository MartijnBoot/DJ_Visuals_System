import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./index.ts";

const example = { status: "ok", schemaVersion: 1, uptimeSeconds: 12 };

describe("healthResponseSchema", () => {
  it("accepts the spec's example body", () => {
    expect(healthResponseSchema.parse(example)).toEqual(example);
  });

  it("rejects a missing field", () => {
    const { uptimeSeconds: _dropped, ...missing } = example;
    expect(healthResponseSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects a wrong status", () => {
    expect(healthResponseSchema.safeParse({ ...example, status: "down" }).success).toBe(false);
  });

  it("rejects a non-integer schema version", () => {
    expect(healthResponseSchema.safeParse({ ...example, schemaVersion: 1.5 }).success).toBe(false);
  });

  it("rejects a negative uptime", () => {
    expect(healthResponseSchema.safeParse({ ...example, uptimeSeconds: -1 }).success).toBe(false);
  });
});
