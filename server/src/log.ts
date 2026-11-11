// Boot logger and the one-line fatal exit. Every boot failure goes through `fatal`: one `fatal`
// JSON line on stdout, exit code 1. Synchronous destination so the line is flushed before exit.
import { pino, type Logger } from "pino";
import { ConfigError } from "./config.ts";

export type { Logger };

// pid only: the host name is nothing a log line needs.
const base = { pid: process.pid };

export function createLogger(level: string): Logger {
  return pino({ level, base }, pino.destination({ fd: 1, sync: true }));
}

const fatalLogger = () => pino({ level: "fatal", base }, pino.destination({ fd: 1, sync: true }));

/** Logs one line describing why boot failed and exits 1. Never logs the environment. */
export function fatal(error: unknown): never {
  const log = fatalLogger();
  if (error instanceof ConfigError) {
    log.fatal({ problems: error.problems }, "boot failed: invalid configuration");
  } else if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    log.fatal({ reason: error.message, ...(code ? { code } : {}) }, "boot failed");
  } else {
    log.fatal({ reason: String(error) }, "boot failed");
  }
  process.exit(1);
}
