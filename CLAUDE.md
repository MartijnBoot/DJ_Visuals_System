# CLAUDE.md

Guidance for Claude Code in this repo. Fuller context: [README.md](README.md),
[docs/way-of-working.md](docs/way-of-working.md), [docs/invariants.md](docs/invariants.md).

## Project

DJ Visuals System — a web app that renders live visuals from live audio and a live camera on a
DJ's or VJ's screen machine, shaped by saved visual profiles. TypeScript end to end:
framework-free WebGL2 + Web Audio renderer (`engine/`), React + Vite UI (`web/`), Node.js
server for profiles API, control WebSocket and WebRTC signalling (`server/`), SQLite + local
`assets/` folder. Rendering stays in the browser on the screen machine (latency); self-hosted on
`localhost`, cloud deferred — see [docs/adr/0001-setup-decision-record.md](docs/adr/0001-setup-decision-record.md).

## Commands

- `bash scripts/setup.sh` — clone to running stack. Idempotent.
- `bash scripts/check.sh` — the gate: format, lint, types, build, unit, integration, browser,
  stopping at the first failure. CI runs this same script. Run it before calling any task done.
- `python scripts/check_plans.py --graph docs/plans/<plan>.md` — a plan's build order.
- `pnpm start` — builds `web/dist`, then one process serves it and `/api` on `127.0.0.1:PORT`.
- `pnpm dev` — the server under `node --watch` (API only) and Vite with hot reload on
  `localhost:5173`, proxying `/api` to the server (`scripts/dev.ts`).
- `pnpm migrate` — applies pending migrations without listening; boot applies them too. A new
  migration is a new file `server/migrations/NNNN_<slug>.sql` with the next number.
- `pnpm run test --project unit` (`*.test.ts`), `pnpm run test --project integration`
  (`*.int.test.ts`), `pnpm test:browser` (Playwright, `tests/browser/`).

## Workflow

- New work: `/backlog` → `/spec` → `/plan` → `/audit` → `/build` → `/verify` → `/review`, one
  fresh session per step ([.claude/README.md](.claude/README.md)). Existing code first gets
  `/adopt` once.
- Work from an audited plan in `docs/plans/phase-<id>-*.md`. No task without a signed audit —
  not yours to waive.
- One task per branch (`feature/phase-<id>-t<n>-<slug>`), conventional commits
  (`feat(phase-<id>): T<n> — ...`).
- Bug fixes start with a failing test; a feature's acceptance criteria become its test cases.
- Run `bash scripts/check.sh` and paste the actual output before saying a task is done —
  "tests pass" is not evidence.
- If a requirement is genuinely ambiguous, stop and ask; do not guess.

## Conventions

- The environment is read only in `server/src/config.ts` (`APP_ENV`, `LOG_LEVEL`, `PORT`,
  `DATA_DIR`, validated with zod at boot, no defaults in code). ESLint's
  `no-restricted-properties` and `tests/meta/config-boundary.test.ts` fail any other
  `process.env`. Root scripts that need a value import `config.ts` (`scripts/dev.ts` does).
- `engine/` — the framework-free WebGL2 renderer; `audio/` — the framework-free AudioWorklet
  analysis; neither has a dependency of any kind and neither imports the other
  (`tests/meta/engine-boundary.test.ts`); `engine/` declares its own `Profile` and never
  imports `shared/`. `web/` — the React + Vite app, two routes in one page: the screen at `/` and
  the profile builder at `/builder` (`web/src/main.tsx`, no router); imports `engine/`, `audio/`
  and `shared/`, never `server/`. `server/` — Fastify, SQLite, migrations, static serving, the
  profile endpoints. `shared/` — zod schemas both sides validate against, including the profile.
  Profile data lives in the `profiles` table (`server/src/profiles/store.ts` is the only SQL for
  it); the built-in profile is code (`engine/src/profile.ts`). `tests/meta/` — tests about
  the codebase's own boundaries. `tests/browser/` — Playwright against `pnpm start`.
- Types at the boundary: every external input is validated before use.
- A new dependency needs justification (what, why not the standard library, licence,
  maintenance) — ask first.
- Node 24 runs the TypeScript directly (type stripping): erasable syntax only (no `enum`,
  `namespace` or parameter properties) and relative imports carry `.ts`. `.npmrc`
  `engine-strict` makes pnpm refuse another Node major.
- Dev is on `5173` (Vite); start is on `PORT`. Without `--api-only` the server refuses to boot
  when `web/dist/index.html` is missing; `pnpm dev` and the integration tests pass the flag.
- The browser check needs software WebGL in headless Chromium (`--use-gl=angle`
  `--use-angle=swiftshader` `--enable-unsafe-swiftshader`, in `playwright.config.ts`).

## Never

- Never edit a migration that already has a successor — add a new one
  (`.claude/guard-paths.json` blocks Write/Edit; it does not see Bash, so no `sed -i` either).
- Never commit `.env*` (except `.env.example`), real secrets or credentials.
- Never use production credentials, or connect to production, from a dev or agent session.
- Never hand-edit `pnpm-lock.yaml` (pnpm writes it) or `web/dist` (`pnpm build` writes it).

## Hard stops — the owner's, never an agent's

Everything with a consequence a `git revert` cannot undo stays with the owner. Stop, state the
question, the evidence and your recommended answer, and wait:

- A spec ambiguity with two readings that produce different user-visible behaviour.
- A guarded area in `docs/invariants.md` changes behaviour, or its guardian reports a change.
- A new third-party dependency is needed.
- A decision that reverses or contradicts an accepted ADR, or changes anything in `docs/design/`.
- A credential, secret or external account is needed — anything you would have to be given
  rather than compute.
- A cross-phase invariant is broken and cannot be restored inside the task that broke it.
- Pushing, merging, opening a PR, deleting a remote branch, any history rewrite or force-push.
- Anything that touches production.
