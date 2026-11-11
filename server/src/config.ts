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

const configSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"], {
    error: missingOr("must be one of development, test, production"),
  }),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"], {
    error: missingOr("must be one of debug, info, warn, error"),
  }),
  PORT: z
    .string({ error: missingOr("must be an integer from 1 to 65535") })
    .refine((s) => /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 65535, {
      error: "must be an integer from 1 to 65535",
    })
    .transform(Number),
  DATA_DIR: z
    .string({ error: missingOr("must be a non-empty path") })
    .min(1, { error: "must be a non-empty path" }),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (result.success) return result.data;
  const problems = new Map<string, string>();
  for (const issue of result.error.issues) {
    const variable = String(issue.path[0]);
    if (!problems.has(variable)) problems.set(variable, issue.message);
  }
  throw new ConfigError([...problems].map(([variable, reason]) => ({ variable, reason })));
}

export function loadConfigFromProcess(): Config {
  return loadConfig(process.env);
}
