// The one module that reads the environment (docs/invariants.md). `loadConfig` is pure so tests
// pass an object; `loadConfigFromProcess` is the single `process.env` reader, used by the
// entry points only. Defaults live in .env.example, never here (spec SD6).
import { z } from "zod";

export interface ConfigProblem {
  variable: string;
  reason: string;
}

/** Thrown when one or more variables are missing or malformed. Reasons never carry a value. */
export class ConfigError extends Error {
  readonly problems: ConfigProblem[];

  constructor(problems: ConfigProblem[]) {
    super(`invalid configuration: ${problems.map((p) => `${p.variable} ${p.reason}`).join("; ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const missingOr = (reason: string) => (issue: { input?: unknown }) =>
  issue.input === undefined ? "is missing" : reason;

const port = () =>
  z
    .string({ error: missingOr("must be an integer from 1 to 65535") })
    .refine((s) => /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 65535, {
      error: "must be an integer from 1 to 65535",
    })
    .transform(Number);

const configSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"], {
    error: missingOr("must be one of development, test, production"),
  }),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"], {
    error: missingOr("must be one of debug, info, warn, error"),
  }),
  /** The local install on the screen machine, or the cloud (B-12 SD1, SD14). */
  APP_MODE: z.enum(["local", "hosted"], { error: missingOr("must be one of local, hosted") }),
  PORT: port(),
  /** The External control listener's port (B-04 SD14); nothing listens on it until switched on. */
  CONTROL_PORT: port(),
  DATA_DIR: z
    .string({ error: missingOr("must be a non-empty path") })
    .min(1, { error: "must be a non-empty path" }),
});

/** A local install's way to the cloud (B-12 SD14): present together or not at all. */
export interface CloudSettings {
  url: string;
  issuer: string;
  clientId: string;
}

/** The cloud's sign-in settings (B-12 SD4, SD14): required together in hosted mode. */
export interface SignInSettings {
  issuer: string;
  clientId: string;
  allowedSubject: string;
}

export type Config = z.infer<typeof configSchema> & {
  /** Local mode with the cloud settings present; otherwise null. */
  cloud: CloudSettings | null;
  /** Hosted mode only; otherwise null. */
  signIn: SignInSettings | null;
};

const CLOUD_VARIABLES = ["CLOUD_URL", "OIDC_ISSUER", "OIDC_CLIENT_ID", "ALLOWED_SUBJECT"] as const;
const CLOUD_GROUP = ["CLOUD_URL", "OIDC_ISSUER", "OIDC_CLIENT_ID"] as const;
const HOSTED_GROUP = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "ALLOWED_SUBJECT"] as const;
const URL_VARIABLES = ["CLOUD_URL", "OIDC_ISSUER"] as const;
const URL_REASON = "must be an https URL, or http on 127.0.0.1 or localhost";
const GROUP_REASON = "must be set with CLOUD_URL, OIDC_ISSUER and OIDC_CLIENT_ID, or none of them";

const ORDER: readonly string[] = [...Object.keys(configSchema.shape), ...CLOUD_VARIABLES];

/** `https:`, or `http:` on the loopback names only: the gate's fake issuer and cloud (PD5). */
function isServiceUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

/**
 * The cloud settings' problems (PD5). An empty value counts as absent, so an env file with the
 * names and no values reads as "not set". A setting of the other mode is refused, not ignored.
 */
function cloudProblems(
  env: Record<string, string | undefined>,
  mode: "local" | "hosted" | undefined,
  problems: Map<string, string>,
): void {
  const has = (name: string) => (env[name] ?? "") !== "";
  for (const name of URL_VARIABLES) {
    if (has(name) && !isServiceUrl(env[name]!)) problems.set(name, URL_REASON);
  }
  if (mode === "hosted") {
    for (const name of HOSTED_GROUP) {
      if (!has(name)) problems.set(name, "is required for APP_MODE=hosted");
    }
    if (has("CLOUD_URL") && !problems.has("CLOUD_URL")) {
      problems.set("CLOUD_URL", "only for APP_MODE=local");
    }
  } else if (mode === "local") {
    if (CLOUD_GROUP.some(has)) {
      for (const name of CLOUD_GROUP) if (!has(name)) problems.set(name, GROUP_REASON);
    }
    if (has("ALLOWED_SUBJECT")) problems.set("ALLOWED_SUBJECT", "only for APP_MODE=hosted");
  }
}

/**
 * Parses the environment. `CONTROL_PORT` equal to `PORT` is checked only when both parse, so a
 * bad `PORT` is reported as itself alone (B-04 PD9).
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  const problems = new Map<string, string>();
  for (const issue of result.error?.issues ?? []) {
    const variable = String(issue.path[0]);
    if (!problems.has(variable)) problems.set(variable, issue.message);
  }
  const ports = [env.PORT, env.CONTROL_PORT].map((v) => port().safeParse(v));
  if (ports[0]!.success && ports[1]!.success && ports[0]!.data === ports[1]!.data) {
    problems.set("CONTROL_PORT", "must differ from PORT");
  }
  const mode = configSchema.shape.APP_MODE.safeParse(env.APP_MODE).data;
  cloudProblems(env, mode, problems);
  if (result.success && problems.size === 0) {
    const cloud =
      mode === "local" && env.CLOUD_URL
        ? { url: env.CLOUD_URL, issuer: env.OIDC_ISSUER!, clientId: env.OIDC_CLIENT_ID! }
        : null;
    const signIn =
      mode === "hosted"
        ? {
            issuer: env.OIDC_ISSUER!,
            clientId: env.OIDC_CLIENT_ID!,
            allowedSubject: env.ALLOWED_SUBJECT!,
          }
        : null;
    return { ...result.data, cloud, signIn };
  }
  const ordered = [...problems].sort(([a], [b]) => ORDER.indexOf(a) - ORDER.indexOf(b));
  throw new ConfigError(ordered.map(([variable, reason]) => ({ variable, reason })));
}

export function loadConfigFromProcess(): Config {
  return loadConfig(process.env);
}
