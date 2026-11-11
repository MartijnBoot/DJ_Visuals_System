import Fastify from "fastify";
import type { Logger } from "./log.ts";

export function createApp(log: Logger) {
  // Fastify's request id (`reqId`) is on every log line that belongs to a request (SD17).
  return Fastify({ loggerInstance: log });
}

export type App = ReturnType<typeof createApp>;
