// B-12's browser specs' own servers (plan T13, T14), as `control-server.ts` does for External
// control: `boot()` in the test process on free ports, serving the built `web/dist`, each with a
// fresh DATA_DIR, every log line kept. The fake OIDC issuer (`server/test/fake-issuer.ts`) runs
// beside them. `startHostedCloud` is the cloud (hosted mode); `startLocalWithCloud` is a local
// install whose cloud settings point at it.
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { boot, type Booted, type CloudInternals } from "../../server/src/boot.ts";
import { loadConfig } from "../../server/src/config.ts";
import type { Logger } from "../../server/src/log.ts";
import { startFakeIssuer, type FakeIssuer } from "../../server/test/fake-issuer.ts";

const root = resolve(import.meta.dirname, "../..");

// The server's own logger package, from the server's dependencies (as control-server.ts).
const { pino } = createRequire(resolve(root, "server/package.json"))("pino") as {
  pino(options: { level: string }, stream: { write(line: string): void }): Logger;
};

export const CLIENT_ID = "browser-test-client";

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => res(port));
    });
  });
}

export interface TestServer {
  port: number;
  origin: string;
  /** Every log line so far, raw. */
  lines: string[];
  /** The local install's cloud parts; undefined on the cloud. */
  internals(): CloudInternals | undefined;
  close(): Promise<void>;
  /** Boots again on the same port and DATA_DIR. */
  restart(): Promise<void>;
  dispose(): Promise<void>;
}

async function start(name: string, env: Record<string, string>): Promise<TestServer> {
  const port = await freePort();
  let controlPort = await freePort();
  while (controlPort === port) controlPort = await freePort();
  const dir = mkdtempSync(join(tmpdir(), `djv-${name}-`));
  const lines: string[] = [];
  let booted: Booted | null = null;
  let internals: CloudInternals | undefined;
  const bootOnce = async () => {
    booted = await boot(
      loadConfig({
        APP_ENV: "test",
        LOG_LEVEL: "debug",
        PORT: String(port),
        CONTROL_PORT: String(controlPort),
        DATA_DIR: join(dir, "data"),
        ...env,
      } as Record<string, string>),
      {
        migrationsDir: resolve(root, "server/migrations"),
        staticDir: resolve(root, "web/dist"),
        cloudInternals: (i) => (internals = i),
      },
      pino({ level: "debug" }, { write: (line: string) => void lines.push(line) }),
    );
  };
  await bootOnce();
  const close = async () => {
    const current = booted;
    booted = null;
    await current?.close();
  };
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    lines,
    internals: () => internals,
    close,
    restart: bootOnce,
    async dispose() {
      await close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface HostedCloud {
  issuer: FakeIssuer;
  cloud: TestServer;
  dispose(): Promise<void>;
}

/** The cloud in hosted mode, and the fake issuer whose default subject it allows. */
export async function startHostedCloud(): Promise<HostedCloud> {
  const issuer = await startFakeIssuer({ clientId: CLIENT_ID });
  const cloud = await start("cloud", {
    APP_MODE: "hosted",
    OIDC_ISSUER: issuer.url,
    OIDC_CLIENT_ID: CLIENT_ID,
    ALLOWED_SUBJECT: issuer.subject,
  });
  return {
    issuer,
    cloud,
    async dispose() {
      await cloud.dispose();
      await issuer.close();
    },
  };
}

/** A local install with cloud settings pointing at `cloudUrl` and `issuer`. */
export function startLocalWithCloud(cloudUrl: string, issuer: FakeIssuer): Promise<TestServer> {
  return start("local", {
    APP_MODE: "local",
    CLOUD_URL: cloudUrl,
    OIDC_ISSUER: issuer.url,
    OIDC_CLIENT_ID: CLIENT_ID,
  });
}
