import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.ts";

const valid = {
  APP_ENV: "development",
  LOG_LEVEL: "info",
  APP_MODE: "local",
  PORT: "8000",
  CONTROL_PORT: "8001",
  DATA_DIR: "./data",
};

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
  it("accepts all six variables valid and ignores the rest of the environment", () => {
    expect(loadConfig({ ...valid, PATH: "/usr/bin", SESSION_SECRET: "x" })).toEqual({
      APP_ENV: "development",
      LOG_LEVEL: "info",
      APP_MODE: "local",
      PORT: 8000,
      CONTROL_PORT: 8001,
      DATA_DIR: "./data",
      cloud: null,
      signIn: null,
      backup: null,
    });
  });

  it.each(["APP_ENV", "LOG_LEVEL", "APP_MODE", "PORT", "CONTROL_PORT", "DATA_DIR"])(
    "reports %s missing",
    (name) => {
      const env: Record<string, string | undefined> = { ...valid };
      delete env[name];
      expect(problemsOf(env)).toEqual({ [name]: "is missing" });
    },
  );

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

  it.each(["abc", "0", "65536", "80.5", "", " 80", "-1"])(
    "reports CONTROL_PORT=%j malformed (B-04 AC2)",
    (port) => {
      expect(problemsOf({ ...valid, CONTROL_PORT: port })).toEqual({
        CONTROL_PORT: "must be an integer from 1 to 65535",
      });
    },
  );

  it("reports CONTROL_PORT equal to PORT, also written differently (B-04 AC2, PD9)", () => {
    expect(problemsOf({ ...valid, CONTROL_PORT: "8000" })).toEqual({
      CONTROL_PORT: "must differ from PORT",
    });
    expect(problemsOf({ ...valid, CONTROL_PORT: "08000" })).toEqual({
      CONTROL_PORT: "must differ from PORT",
    });
  });

  it("reports only PORT when PORT is bad and CONTROL_PORT would equal it (PD9)", () => {
    expect(problemsOf({ ...valid, PORT: " 8001" })).toEqual({
      PORT: "must be an integer from 1 to 65535",
    });
    expect(problemsOf({ ...valid, PORT: undefined })).toEqual({ PORT: "is missing" });
    expect(problemsOf({ ...valid, PORT: "abc", CONTROL_PORT: "abc" })).toEqual({
      PORT: "must be an integer from 1 to 65535",
      CONTROL_PORT: "must be an integer from 1 to 65535",
    });
  });

  it("reports CONTROL_PORT equal to PORT alongside another bad variable, in schema order", () => {
    const error = (() => {
      try {
        loadConfig({ ...valid, APP_ENV: "nope", CONTROL_PORT: "8000", DATA_DIR: "" });
      } catch (e) {
        return e as ConfigError;
      }
      throw new Error("expected a throw");
    })();
    expect(error.problems.map((p) => p.variable)).toEqual(["APP_ENV", "CONTROL_PORT", "DATA_DIR"]);
    expect(JSON.stringify(error.problems)).not.toContain("8000");
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
      "APP_MODE",
      "PORT",
      "CONTROL_PORT",
      "DATA_DIR",
    ]);
    expect(JSON.stringify(error.problems)).not.toContain("secret-looking-value");
    expect(JSON.stringify(error.problems)).not.toContain("staging-ish");
  });
});

// B-12 SD14, PD5: the mode and the cloud settings.
const issuer = "https://issuer.example.test/tenant-value-1";
const clientId = "client-value-2";
const subject = "subject-value-3";
const cloudUrl = "https://cloud.example.test";
const hosted = {
  ...valid,
  APP_MODE: "hosted",
  OIDC_ISSUER: issuer,
  OIDC_CLIENT_ID: clientId,
  ALLOWED_SUBJECT: subject,
};
const connected = { ...valid, CLOUD_URL: cloudUrl, OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId };

/** Every problem of `env`, checked to carry none of the values passed in (PD5). */
function problemsWithoutValues(env: Record<string, string | undefined>): Record<string, string> {
  const problems = problemsOf(env);
  for (const value of [issuer, clientId, subject, cloudUrl, "http://example.com"]) {
    expect(JSON.stringify(problems)).not.toContain(value);
  }
  return problems;
}

describe("loadConfig: APP_MODE and the cloud settings (B-12 SD14, PD5)", () => {
  it("reports APP_MODE malformed", () => {
    expect(problemsOf({ ...valid, APP_MODE: "cloud" })).toEqual({
      APP_MODE: "must be one of local, hosted",
    });
  });

  it("puts APP_MODE after LOG_LEVEL in the order of problems", () => {
    expect(Object.keys(problemsOf({ ...valid, APP_MODE: "x", LOG_LEVEL: "x", PORT: "x" }))).toEqual(
      ["LOG_LEVEL", "APP_MODE", "PORT"],
    );
  });

  it("accepts hosted with its three settings", () => {
    const config = loadConfig(hosted);
    expect(config.APP_MODE).toBe("hosted");
    expect(config.signIn).toEqual({ issuer, clientId, allowedSubject: subject });
    expect(config.cloud).toBeNull();
  });

  it.each(["OIDC_ISSUER", "OIDC_CLIENT_ID", "ALLOWED_SUBJECT"])(
    "refuses hosted without %s",
    (name) => {
      const env: Record<string, string | undefined> = { ...hosted };
      delete env[name];
      expect(problemsWithoutValues(env)).toEqual({ [name]: "is required for APP_MODE=hosted" });
      expect(problemsWithoutValues({ ...hosted, [name]: "" })).toEqual({
        [name]: "is required for APP_MODE=hosted",
      });
    },
  );

  it("refuses CLOUD_URL in hosted", () => {
    expect(problemsWithoutValues({ ...hosted, CLOUD_URL: cloudUrl })).toEqual({
      CLOUD_URL: "only for APP_MODE=local",
    });
  });

  it("accepts local with no cloud settings, or with all three", () => {
    expect(loadConfig(valid).cloud).toBeNull();
    const config = loadConfig(connected);
    expect(config.cloud).toEqual({ url: cloudUrl, issuer, clientId });
    expect(config.signIn).toBeNull();
  });

  it.each([
    [["CLOUD_URL"], ["OIDC_ISSUER", "OIDC_CLIENT_ID"]],
    [["OIDC_ISSUER"], ["CLOUD_URL", "OIDC_CLIENT_ID"]],
    [["OIDC_CLIENT_ID"], ["CLOUD_URL", "OIDC_ISSUER"]],
    [["CLOUD_URL", "OIDC_ISSUER"], ["OIDC_CLIENT_ID"]],
    [["CLOUD_URL", "OIDC_CLIENT_ID"], ["OIDC_ISSUER"]],
    [["OIDC_ISSUER", "OIDC_CLIENT_ID"], ["CLOUD_URL"]],
  ])("refuses local with only %j of the cloud settings", (given, absent) => {
    const env: Record<string, string | undefined> = { ...valid };
    for (const name of given) env[name] = connected[name as keyof typeof connected];
    expect(problemsWithoutValues(env)).toEqual(
      Object.fromEntries(
        absent.map((name) => [
          name,
          "must be set with CLOUD_URL, OIDC_ISSUER and OIDC_CLIENT_ID, or none of them",
        ]),
      ),
    );
  });

  it("refuses ALLOWED_SUBJECT in local", () => {
    expect(problemsWithoutValues({ ...connected, ALLOWED_SUBJECT: subject })).toEqual({
      ALLOWED_SUBJECT: "only for APP_MODE=hosted",
    });
    expect(problemsWithoutValues({ ...valid, ALLOWED_SUBJECT: subject })).toEqual({
      ALLOWED_SUBJECT: "only for APP_MODE=hosted",
    });
  });

  it.each(["http://example.com", "ftp://cloud.example.test", "not a url", "http://192.168.1.2"])(
    "refuses the URL %j",
    (value) => {
      expect(problemsWithoutValues({ ...connected, CLOUD_URL: value })).toEqual({
        CLOUD_URL: "must be an https URL, or http on 127.0.0.1 or localhost",
      });
      expect(problemsWithoutValues({ ...hosted, OIDC_ISSUER: value })).toEqual({
        OIDC_ISSUER: "must be an https URL, or http on 127.0.0.1 or localhost",
      });
    },
  );

  it.each(["http://127.0.0.1:9", "http://localhost:9/issuer", "https://cloud.example.test/"])(
    "accepts the URL %j",
    (value) => {
      expect(loadConfig({ ...connected, CLOUD_URL: value, OIDC_ISSUER: value }).cloud).toEqual({
        url: value,
        issuer: value,
        clientId,
      });
    },
  );

  it("reports the cloud settings after DATA_DIR, in a fixed order", () => {
    const error = (() => {
      try {
        loadConfig({ ...valid, DATA_DIR: "", ALLOWED_SUBJECT: subject, CLOUD_URL: "x" });
      } catch (e) {
        return e as ConfigError;
      }
      throw new Error("expected a throw");
    })();
    expect(error.problems.map((p) => p.variable)).toEqual([
      "DATA_DIR",
      "CLOUD_URL",
      "OIDC_ISSUER",
      "OIDC_CLIENT_ID",
      "ALLOWED_SUBJECT",
    ]);
    expect(JSON.stringify(error.problems)).not.toContain(subject);
  });
});

// B-12 T15, PD25: the backup group, all or none.
describe("loadConfig: the backup settings (B-12 PD25)", () => {
  const backup = {
    BACKUP_ENDPOINT: "https://ns.compat.objectstorage.eu-amsterdam-1.oraclecloud.com",
    BACKUP_REGION: "eu-amsterdam-1",
    BACKUP_BUCKET: "djvisuals-backups",
    BACKUP_ACCESS_KEY_ID: "access-key-value-4",
    BACKUP_SECRET_ACCESS_KEY: "secret-key-value-5",
  };
  const names = Object.keys(backup);

  it("accepts all five, in either mode", () => {
    expect(loadConfig({ ...valid, ...backup }).backup).toEqual({
      endpoint: backup.BACKUP_ENDPOINT,
      region: backup.BACKUP_REGION,
      bucket: backup.BACKUP_BUCKET,
      accessKeyId: backup.BACKUP_ACCESS_KEY_ID,
      secretAccessKey: backup.BACKUP_SECRET_ACCESS_KEY,
    });
    expect(loadConfig({ ...hosted, ...backup }).backup).not.toBeNull();
  });

  it("accepts none", () => {
    expect(loadConfig(valid).backup).toBeNull();
  });

  it.each(names)("refuses the group without %s, naming only it, never a value", (name) => {
    const env: Record<string, string | undefined> = { ...valid, ...backup };
    delete env[name];
    const problems = problemsOf(env);
    expect(problems).toEqual({
      [name]: "must be set with the other BACKUP_ variables, or none of them",
    });
    for (const value of Object.values(backup)) {
      expect(JSON.stringify(problems)).not.toContain(value);
    }
  });

  it("refuses an endpoint that is not https or loopback http", () => {
    expect(problemsOf({ ...valid, ...backup, BACKUP_ENDPOINT: "http://example.com" })).toEqual({
      BACKUP_ENDPOINT: "must be an https URL, or http on 127.0.0.1 or localhost",
    });
  });
});
