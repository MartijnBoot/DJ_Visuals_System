import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

const valid = { APP_ENV: "development", LOG_LEVEL: "info", PORT: "8000", DATA_DIR: "./data" };

function problemsOf(env: Record<string, string | undefined>): Record<string, string> {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return Object.fromEntries(error.problems.map((p) => [p.variable, p.reason]));
    }
    throw error;
  }
  throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
  it("accepts all four variables valid and ignores the rest of the environment", () => {
    expect(loadConfig({ ...valid, PATH: "/usr/bin", SESSION_SECRET: "x" })).toEqual({
      APP_ENV: "development",
      LOG_LEVEL: "info",
      PORT: 8000,
      DATA_DIR: "./data",
    });
  });

  it.each(["APP_ENV", "LOG_LEVEL", "PORT", "DATA_DIR"])("reports %s missing", (name) => {
    const env: Record<string, string | undefined> = { ...valid };
    delete env[name];
    expect(problemsOf(env)).toEqual({ [name]: "is missing" });
  });

  it("reports APP_ENV malformed", () => {
    expect(problemsOf({ ...valid, APP_ENV: "staging" })).toEqual({
      APP_ENV: "must be one of development, test, production",
    });
  });

  it("reports LOG_LEVEL malformed", () => {
    expect(problemsOf({ ...valid, LOG_LEVEL: "trace" })).toEqual({
      LOG_LEVEL: "must be one of debug, info, warn, error",
    });
  });

  it.each(["abc", "0", "65536", "80.5", "", " 80", "-1"])("reports PORT=%j malformed", (port) => {
    expect(problemsOf({ ...valid, PORT: port })).toEqual({
      PORT: "must be an integer from 1 to 65535",
    });
  });

  it("reports DATA_DIR empty", () => {
    expect(problemsOf({ ...valid, DATA_DIR: "" })).toEqual({
      DATA_DIR: "must be a non-empty path",
    });
  });

  it("reports every bad variable at once, never a value", () => {
    const error = (() => {
      try {
        loadConfig({ APP_ENV: "staging-ish", PORT: "secret-looking-value" });
      } catch (e) {
        return e as ConfigError;
      }
      throw new Error("expected a throw");
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.problems.map((p) => p.variable)).toEqual([
      "APP_ENV",
      "LOG_LEVEL",
      "PORT",
      "DATA_DIR",
    ]);
    expect(JSON.stringify(error.problems)).not.toContain("secret-looking-value");
    expect(JSON.stringify(error.problems)).not.toContain("staging-ish");
  });
});
