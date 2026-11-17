// `/api/cloud/*` on the local install (B-12 spec, API contract; plan PD18, PD20), on 127.0.0.1
// like everything else, registered only when the cloud settings are present. Every one answers
// on a user action: the panel opens, a button is pressed, or the provider sends the owner's
// browser back to the callback. The callback answers a plain page with PD4's texts and no script;
// nothing here ever carries a code or a token.
import { cloudConnectSchema, cloudStatusSchema, type CloudStatus } from "@djv/shared";
import type { App } from "../app.ts";
import type { Signin } from "./signin.ts";

export interface CloudRoutesDeps {
  signin: Signin;
  /** The panel's status (T10 adds syncing, offline, paused, the last sync and conflicts). */
  status(): CloudStatus;
  /** After a good callback: a sync starts (AC24). */
  onConnected(): void;
  /** After "Disconnect from cloud": the scheduler stops. */
  onDisconnected(): void;
}

const page = (text: string) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>DJ Visuals</title></head>` +
  `<body><p>${text}</p></body></html>\n`;

export const CALLBACK_TEXTS = {
  connected: "Connected to the cloud — you can close this tab",
  failed: "Sign-in failed — try again from the panel",
} as const;

export function registerCloud(app: App, deps: CloudRoutesDeps): void {
  const status = () => cloudStatusSchema.parse(deps.status());

  app.get("/api/cloud/status", () => status());

  app.post("/api/cloud/connect", async (request, reply) => {
    try {
      return cloudConnectSchema.parse({ url: await deps.signin.begin() });
    } catch {
      request.log.warn({ outcome: "failed", kind: "issuer" }, "cloud sign-in");
      return reply.code(503).send({ error: "unavailable" });
    }
  });

  app.get<{ Querystring: Record<string, string> }>(
    "/api/cloud/callback",
    async (request, reply) => {
      const params = new URLSearchParams();
      for (const key of ["code", "state", "error"]) {
        const value = request.query[key];
        if (typeof value === "string") params.set(key, value);
      }
      const outcome = await deps.signin.complete(params);
      if (outcome === "connected") deps.onConnected();
      return reply
        .code(outcome === "connected" ? 200 : 400)
        .header("content-type", "text/html; charset=utf-8")
        .header("cache-control", "no-store")
        .send(page(CALLBACK_TEXTS[outcome]));
    },
  );

  app.post("/api/cloud/disconnect", () => {
    deps.signin.disconnect();
    deps.onDisconnected();
    return status();
  });
}
