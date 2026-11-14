// The External control listener (B-04 spec SD2, SD14, AC3 to AC6; plan PD8): one small Fastify
// instance per private IPv4 address, on `CONTROL_PORT`, created when the operator switches on and
// closed when they switch off. It answers `GET /control` (the page), `GET /assets/*` (the built
// assets, nothing else of `web/dist`) and the device socket (T7); every other path is Fastify's
// 404. No body parser hook and no CORS header: there is nothing here to write to. Binding is all
// or nothing: if one address fails, every one already bound is closed and the switch stays off.
// Under `--api-only` there is no built page, so only the device socket answers.
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../log.ts";
import type { ControlAddress } from "./addresses.ts";

const lanApp = (log: Logger) => Fastify({ loggerInstance: log });
export type LanApp = ReturnType<typeof lanApp>;

export type EnableResult =
  | { ok: true; addresses: ControlAddress[] }
  | { ok: false; error: "no_address" | "port_in_use" | "unavailable" };

export interface LanDeps {
  log: Logger;
  port: number;
  /** The built web app; absent under `--api-only`. */
  staticDir?: string;
  /** The seam (PD10): the addresses to bind. */
  addresses(): ControlAddress[];
  /** Adds the device socket to an instance before it listens (T7). */
  prepare?(app: LanApp, address: ControlAddress): void;
}

export interface Lan {
  enable(): Promise<EnableResult>;
  disable(): Promise<void>;
  isOn(): boolean;
  addresses(): ControlAddress[];
}

export function createLan({ log, port, staticDir, addresses, prepare }: LanDeps): Lan {
  let bound: { app: LanApp; address: ControlAddress }[] = [];

  // Wrapped: a Fastify instance is thenable, so an async function returning it would await it.
  const instance = async (address: ControlAddress): Promise<{ app: LanApp }> => {
    const app = lanApp(log);
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
    await Promise.all(closing.map(({ app }) => app.close()));
  };

  return {
    async enable() {
      if (bound.length > 0) return { ok: true, addresses: bound.map((b) => b.address) };
      const wanted = addresses();
      if (wanted.length === 0) return { ok: false, error: "no_address" };
      for (const address of wanted) {
        const { app } = await instance(address);
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
      return { ok: true, addresses: bound.map((b) => b.address) };
    },
    disable: closeAll,
    isOn: () => bound.length > 0,
    addresses: () => bound.map((b) => b.address),
  };
}
