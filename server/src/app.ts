import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyError } from "fastify";
import type { Logger } from "./log.ts";

/** A write's body limit (B-02 SD18); the import route sets its own, larger one. */
export const BODY_LIMIT = 64 * 1024;

export function createApp(log: Logger) {
  // Fastify's request id (`reqId`) on every log line belongs to the request (SD17).
  const app = Fastify({ loggerInstance: log, bodyLimit: BODY_LIMIT });

  // JSON only (B-02 SD18, AC21, plan PD11): a page on another origin cannot write with a simple
  // request, because `text/plain` is not a parser here. Checked before any body is read, so a
  // missing content type is 415 too. DELETE carries no body and is exempt.
  app.removeContentTypeParser("text/plain");
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "POST" && request.method !== "PUT") return;
    const type = request.headers["content-type"] ?? "";
    if (!/^application\/json(\s*;|$)/i.test(type)) {
      await reply.code(415).send({ error: "unsupported_media_type" });
    }
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = typeof error.statusCode === "number" ? error.statusCode : 500;
    if (status === 413) return reply.code(413).send({ error: "payload_too_large" });
    if (status === 400) {
      return reply
        .code(400)
        .send({ error: "invalid", issues: [{ path: "", message: "the body is not valid JSON" }] });
    }
    if (status < 500) return reply.code(status).send({ error: error.code ?? "error" });
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send({ error: "internal" });
  });
  return app;
}

export type App = ReturnType<typeof createApp>;

/** Serves the built web app from `root` (spec SD10): `/` is its index.html, anything else that
 * is not a file is 404. Paths cannot leave `root`. */
export async function registerStatic(app: App, root: string): Promise<void> {
  await app.register(fastifyStatic, { root, index: "index.html", wildcard: true });
  // The builder is a second route of the same app (B-02 PD14): that one path gets the page, every
  // other unknown path stays 404. Vite's dev server falls back to index.html on its own.
  app.get("/builder", (_request, reply) => reply.sendFile("index.html"));
}
