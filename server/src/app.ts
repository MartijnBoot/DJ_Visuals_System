import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { Logger } from "./log.ts";

export function createApp(log: Logger) {
  // Fastify's request id (`reqId`) is on every log line that belongs to a request (SD17).
  return Fastify({ loggerInstance: log });
}

export type App = ReturnType<typeof createApp>;

/** Serves the built web app from `root` (spec SD10): `/` is its index.html, anything else that
 *  is not a file there is 404. Paths cannot leave `root`. */
export async function registerStatic(app: App, root: string): Promise<void> {
  await app.register(fastifyStatic, { root, index: "index.html", wildcard: true });
}
