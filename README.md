# DJ Visuals System

A web app that turns a live set's audio and a live camera into visuals that move with the beat on
the venue screen, for a DJ or a VJ working a single screen machine. Audio comes from device
capture or a microphone, the camera from a webcam or a phone; rendering happens in the browser on
the screen machine to keep audio-to-pixel latency minimal, and visual profiles — built in the app
or authored with Claude Code — are stored so they survive a redeploy. Stack: TypeScript end to
end — a WebGL2 + Web Audio renderer and a React + Vite UI (`web/`), a Node.js server (`server/`),
SQLite. It is self-hosted on the owner's machine for now; cloud hosting is deferred
([Setup Decision Record](docs/adr/0001-setup-decision-record.md)).

## Setup

```bash
bash scripts/setup.sh     # clone to running stack; idempotent
bash scripts/check.sh     # the gate — the same script CI runs
```

Requirements: git, bash (Git Bash on Windows), Python 3.9+ for the workflow's guard and plan
checker, Node 24 (`.nvmrc`; pnpm refuses another major) and pnpm 9 (`packageManager` in
`package.json`). Setup installs the dependencies and Playwright's Chromium, and creates
`.env.local` from `.env.example`.

```bash
pnpm start                # build the app and serve it on http://127.0.0.1:8000 (PORT)
pnpm dev                  # hot reload on http://localhost:5173, /api proxied to the server
pnpm profile:check <file> # check, compile and render stills of a profile file (below)
```

The output screen is `/`; the profile builder is `/builder` (also linked from the screen's
settings panel, key `s`).

`.env.local` needs five variables: `APP_ENV`, `LOG_LEVEL`, `PORT`, `CONTROL_PORT` and `DATA_DIR`
(see `.env.example`). A `.env.local` made before External control lacks `CONTROL_PORT`; add
`CONTROL_PORT=8001` (any free port other than `PORT`), or the server refuses to boot and says
which variable is missing.

## Pair a phone (External control)

A phone, tablet or laptop on the same network can control the set: switch profiles, move the two
dials, change colours live and switch the camera. Nothing is reachable from the network until you
switch it on, and nothing survives a restart.

1. `pnpm start`, open `http://127.0.0.1:8000/` on the screen machine, press **Start**.
2. Press `s` for the panel. Under **External control**, switch it on. The panel shows the
   address, a QR code, the URL and a six-character code. (`pnpm dev` has no controller page; use
   `pnpm start`.)
3. Scan the QR code with the phone, or open the URL and type the code. The phone shows "Waiting
   for approval".
4. Press **Accept** in the panel (or on an already paired controller). The phone gets the
   controls.
5. On the phone, pick **DJ** (large tiles, one Primary colour) or **VJ** (every colour, the
   status strip and the round-trip time).

The phone reconnects by itself after a Wi-Fi drop or a locked screen. **New code** disconnects
every device; **Disconnect** removes one; switching off, or restarting the server, ends every
pairing ("Pairing ended — scan the code again"). The first time you switch on, Windows asks
whether Node.js may use the network: allow it on private networks, or no device can reach it
(see [docs/runbooks/README.md](docs/runbooks/README.md)).

## Author a profile with Claude Code

A profile can carry its own look as GLSL code (a `custom` effect,
[docs/custom-effects.md](docs/custom-effects.md)). In a Claude Code session, put your inspiration
(a painting, photos) in `inspiration/<slug>/` (never committed) and run `/profile <slug>`. The agent
writes `profiles/<slug>.json` and `profiles/<slug>.md`, checks the file with `pnpm profile:check
profiles/<slug>.json` (stills under `profiles/.check/`) and iterates. Then open `/builder`,
**Import a file** and choose it; importing a newer version of a profile you already have offers
**Replace**, which keeps it picked on the screen and on controllers. In the builder the code is
editable, compiles as you type, and Save waits until it compiles.

## How work is done here

Every change goes through the loop in [docs/way-of-working.md](docs/way-of-working.md) §4.2,
driven by the commands in [.claude/](.claude/README.md), one fresh Claude Code session per step:

```
/backlog → /spec → /plan → /audit → /build → /verify → /review → you merge
```

No code before an approved spec; no implementation before an audited plan; every task test-first,
with the gate's output as evidence; the session that wrote the code never reviews it. What must
never break is in [docs/invariants.md](docs/invariants.md); what only the owner may do is in
[CLAUDE.md](CLAUDE.md) → Hard stops.

## Starting from this template

1. Fill in this README, [CLAUDE.md](CLAUDE.md) and [docs/adr/0001-setup-decision-record.md](docs/adr/0001-setup-decision-record.md)
   — the Setup Decision Record comes first: database, hosting, auth, cost. Default answer "no".
2. `bash scripts/check.sh` — green on the workflow checks, then the project steps format, lint,
   types, build, unit, integration and browser.
3. Run `/spec 0` for **Phase 0 — foundations**: the stack skeleton, `scripts/setup.sh` and
   `scripts/check.sh` wired to it, CI green, the config module that fails fast. Its exit condition:
   a fresh clone plus two commands gives a running app and a green gate.
4. Fill [docs/invariants.md](docs/invariants.md) as Phase 0 settles them.
5. Protect `main` on GitHub (PR required, the `check` and `secret-scan` jobs required, no
   force-push). That is a setting, so it is yours to make, not an agent's.

## Documentation

[docs/README.md](docs/README.md) — what is where.
