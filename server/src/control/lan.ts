// The External control listener (B-04 spec SD2, SD14, AC3 to AC6; plan PD8; B-06 SD4, SD13, AC1,
// AC4, AC5): one small Fastify instance per private IPv4 address, on `CONTROL_PORT`, created when
// the operator switches on and closed when they switch off. HTTPS only, with the server
// certificate the store issues for exactly the addresses bound (B-06 T5); a store that cannot be
// read binds nothing (`cert_store`), and no plain-HTTP listener exists. It answers `GET /control`
// (the page), `GET /assets/*` (the built assets, nothing else of `web/dist`), `GET /trust` (B-06
// T6) and the device socket (T7); every other path is Fastify's
// 404. No body parser hook and no CORS header: there is nothing here to write to. Binding is all
// or nothing: if one address fails, every one already bound is closed and the switch stays off.
// Under `--api-only` there is no built page, so only the device socket answers.
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../log.ts";
import type { Certificates } from "../tls/store.ts";
import type { ControlAddress } from "./addresses.ts";
import { registerTrust } from "./trust.ts";

const lanApp = (log: Logger, tls: { key: string; cert: string }) =>
  Fastify({ loggerInstance: log, https: tls });
export type LanApp = ReturnType<typeof lanApp>;

export type EnableResult =
  | { ok: true; addresses: ControlAddress[] }
  | { ok: false; error: "no_address" | "port_in_use" | "unavailable" | "cert_store" };

export interface LanDeps {
  log: Logger;
  port: number;
  /** The built web app; absent under `--api-only`. */
  staticDir?: string;
  /** The seam (PD10): the addresses to bind. */
  addresses(): ControlAddress[];
  /** The certificate store (B-06 T3): the key and certificate for exactly these addresses. */
  certificates(addresses: string[]): Certificates | { error: "cert_store" };
  /** Adds the device socket to an instance before it listens (T7). */
  prepare?(app: LanApp, address: ControlAddress): void;
}

export interface Lan {
  enable(): Promise<EnableResult>;
  disable(): Promise<void>;
  isOn(): boolean;
  addresses(): ControlAddress[];
  /** The local root's fingerprint while on, else null (B-06 SD24). */
  fingerprint(): string | null;
}

export function createLan({
  log,
  port,
  staticDir,
  addresses,
  certificates,
  prepare,
}: LanDeps): Lan {
  let bound: { app: LanApp; address: ControlAddress }[] = [];
  let issued: Certificates | null = null;

  // Wrapped: a Fastify instance is thenable, so an async function returning it would await it.
  const instance = async (address: ControlAddress, tls: Certificates): Promise<{ app: LanApp }> => {
    const app = lanApp(log, { key: tls.key, cert: tls.cert });
    // The trust step (B-06 SD24): the root and its fingerprint only, also under --api-only.
    registerTrust(app, { root: tls.root, fingerprint: tls.fingerprint });
    if (staticDir !== undefined) {
      // `root` is the assets folder itself, so no other file of the build is reachable.
      await app.register(fastifyStatic, {
        root: join(staticDir, "assets"),
        prefix: "/assets/",
        index: false,
        wildcard: true,
      });
      app.get("/control", async (_request, reply) =>
        reply.type("text/html; charset=utf-8").send(await readFile(join(staticDir, "index.html"))),
      );
    }
    prepare?.(app, address);
    return { app };
  };

  const closeAll = async () => {
    const closing = bound;
    bound = [];
    issued = null;
    await Promise.all(closing.map(({ app }) => app.close()));
  };

  return {
    async enable() {
      if (bound.length > 0) return { ok: true, addresses: bound.map((b) => b.address) };
      const wanted = addresses();
      if (wanted.length === 0) return { ok: false, error: "no_address" };
      const tls = certificates(wanted.map((a) => a.address));
      if ("error" in tls) {
        log.warn({ port }, "certificate store unreadable");
        return { ok: false, error: "cert_store" };
      }
      for (const address of wanted) {
        const { app } = await instance(address, tls);
        try {
          await app.listen({ host: address.address, port });
        } catch (error) {
          await app.close().catch(() => {});
          await closeAll();
          const code = (error as NodeJS.ErrnoException).code;
          log.warn({ code, port }, "external control could not listen");
          return { ok: false, error: code === "EADDRINUSE" ? "port_in_use" : "unavailable" };
        }
        bound.push({ app, address });
      }
      issued = tls;
      return { ok: true, addresses: bound.map((b) => b.address) };
    },
    disable: closeAll,
    isOn: () => bound.length > 0,
    addresses: () => bound.map((b) => b.address),
    fingerprint: () => issued?.fingerprint ?? null,
  };
}
