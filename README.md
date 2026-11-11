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
checker, and <the stack's tools>.

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
2. `bash scripts/check.sh` — green on the workflow checks, with a warning that no project checks
   are wired yet.
3. Run `/spec 0` for **Phase 0 — foundations**: the stack skeleton, `scripts/setup.sh` and
   `scripts/check.sh` wired to it, CI green, the config module that fails fast. Its exit condition:
   a fresh clone plus two commands gives a running app and a green gate.
4. Fill [docs/invariants.md](docs/invariants.md) as Phase 0 settles them.
5. Protect `main` on GitHub (PR required, the `check` and `secret-scan` jobs required, no
   force-push). That is a setting, so it is yours to make, not an agent's.

## Documentation

[docs/README.md](docs/README.md) — what is where.
