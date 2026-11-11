# Architecture

The system as built at the end of Phase 0 (the walking skeleton): spec
[phase-0-walking-skeleton](../specs/phase-0-walking-skeleton.md), decisions in the
[Setup Decision Record](../adr/0001-setup-decision-record.md). Plans read this and do not
redesign it; a change here is an owner stop (CLAUDE.md). Diagrams stay text so they diff.

## Overview

One Node 24 process on the screen machine, bound to `127.0.0.1:PORT`, serves the built web app
and a small JSON API. The browser on the same machine runs the screen page, which drives the
renderer on a full-window canvas and, while the overlay is shown, asks the server for its
health. Rendering never leaves the browser (latency, SDR). Four workspace packages:

```
  browser, screen machine                         Node 24 process, 127.0.0.1:PORT
 +------------------------------------+          +--------------------------------------+
 | web/   React screen page, route /  |  GET /   | server/  Fastify                     |
 |   engine/   WebGL2 clear colour,   | -------> |   static web/dist  (@fastify/static) |
 |             frame statistics       |          |                                      |
 |   overlay (key o) --- health ------+--------> |   GET /api/health                    |
 +------------------+-----------------+          |   boot: config -> DATA_DIR -> db ->   |
                    |                            |         migrate -> listen            |
                    |  imports                   +------------------+-------------------+
                    v                                               | imports
            shared/  zod schemas  ----------------------------------+
                                                                    |
                                     DATA_DIR/djvisuals.sqlite, DATA_DIR/assets/ (empty)
```

`pnpm dev` changes only the front: Vite serves `web/` on `localhost:5173` with hot reload and
proxies `/api` to the server, which runs under `node --watch` with `--api-only`
(`scripts/dev.ts`). Nothing may work in dev that does not work under `pnpm start` (SD10); the
browser check runs only against `pnpm start`.

## Modules and boundaries

| Module | Owns | Public surface | Must not |
|---|---|---|---|
| `engine/` | The WebGL2 context, the animation loop, frame statistics | `createEngine(canvas)` returning `{ start, stop, stats }`, `WebGL2UnavailableError`, `FrameStats` (`engine/src/index.ts`) | Declare or import any package; use Node types (`tests/meta/engine-boundary.test.ts`) |
| `web/` | The screen page at `/`, the overlay, the health client | The built app in `web/dist` | Import from `server/`; read the environment |
| `server/` | Configuration, logging, the database and migrations, HTTP | `GET /api/health`, static `web/dist`, `pnpm migrate` | Listen on anything but `127.0.0.1`; read the environment outside `config.ts` |
| `shared/` | The schemas both sides validate against | `healthResponseSchema`, `HealthResponse` (`shared/src/index.ts`) | — |

`shared/` and `engine/` export their `src/index.ts`; there is no build step for the server or
those packages. Only `web/` is built, by Vite, into `web/dist`.

## Data

- **Store.** One SQLite file, `DATA_DIR/djvisuals.sqlite`, opened through `node:sqlite` in
  `server/src/db.ts`, the only file that imports the driver. Every open sets
  `journal_mode = WAL` and `foreign_keys = ON`, with a busy timeout of 0.
- **Tables.** `schema_migrations(name, applied_at)`, owned by the runner; `app_meta(key, value)`,
  created by `server/migrations/0001_init.sql` with one row, `schema_created_at`. Nothing a
  person made is stored yet. `DATA_DIR/assets/` exists and is empty.
- **Migrations.** Files `server/migrations/NNNN_<slug>.sql`, applied in name order by
  `server/src/migrate.ts`, each in its own transaction together with its `schema_migrations`
  row. The runner takes `BEGIN IMMEDIATE` on every run, so a file locked by another process
  fails boot at once. A misnamed `.sql` file or a duplicate number fails boot naming the file.
  The schema version reported by health is the highest applied number.
- **When they run.** At boot, before listening, and through `pnpm migrate`. This departs from
  way-of-working 5.6 on purpose (SD7): one process on one machine has no replica race. The
  hosting trigger in SDR §7 reopens it.
- **Direction.** Forward-only. The restore plan is to delete the file. The guard hook keeps
  `server/migrations` append-only for agents (`.claude/guard-paths.json`).

## Configuration

`server/src/config.ts` is the one module that reads the environment. `loadConfig(env)` is a pure
zod parse of four variables, all required, no defaults in code: `APP_ENV` (`development`,
`test`, `production`), `LOG_LEVEL` (`debug`, `info`, `warn`, `error`), `PORT` (1 to 65535) and
`DATA_DIR` (a non-empty path). `loadConfigFromProcess()` is the single `process.env` reader.
`.env.example` is the contract; `scripts/setup.sh` copies it to `.env.local`.

The run scripts start `node --env-file-if-exists=.env.local` from the repository root, so a
relative `DATA_DIR` resolves against the root and the process environment wins over the file.
Any missing or malformed variable is one `fatal` log line naming every bad variable, never a
value, and exit 1 before the database is opened. A `DATA_DIR` that cannot be created or written
is reported the same way. `scripts/dev.ts` learns `PORT` for the Vite proxy by importing
`config.ts`.

## Cross-cutting

- **Auth.** None (SDR question 3). The server binds `127.0.0.1` only, so no other device can
  reach it (`server/test/boot.int.test.ts`).
- **Logging.** pino JSON lines on stdout at `LOG_LEVEL`. Fastify's request id (`reqId`) is on
  every line that belongs to a request. The environment and the config object are never
  logged whole.
- **Errors.** Every boot failure goes through `fatal` in `server/src/log.ts`: one `fatal` line,
  exit 1, nothing listening. In the browser, a failed or invalid health answer reads
  `server: unreachable` and never stops the engine; no WebGL2 context shows one line of text
  in place of the canvas.
- **Time.** The drift colour is a function of the frame timestamp, one hue cycle per 60 s.
  `applied_at` and `schema_created_at` are ISO-8601 UTC. Health reports whole seconds since
  listen.
