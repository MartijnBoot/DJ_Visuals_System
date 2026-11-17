# ADR 0003: Hosting on Oracle Cloud, profiles synced from local installs

Date: 2026-11-17 · Status: Accepted (by the approval of the B-12 spec) ·
Rests on: [0001](0001-setup-decision-record.md), [0002](0002-remote-input-over-the-lan.md)

## Context

ADR 0001 chose to host everything on the screen machine (question 2) and deferred hosting, a
hosted database, bought auth and Application Insights to Azure (§7). Two facts make the move
necessary now:

- **The screen machine is a single point of failure** (ADR 0001 §8). The owner's profiles live in
  one SQLite file on one machine; if the machine fails, the profiles go with it, and playing on
  another machine means carrying this one or moving profiles by export and import.
- **There is nowhere to open the app except that machine.** The server binds `127.0.0.1` and has
  no authentication, which is correct only because of that bind (ADR 0001 question 3).

§7's Azure answer costs money every month (Container Apps, Container Registry, a hosted database,
Application Insights). The trial asked for here is one owner, one account and a few dozen
profiles, which Oracle Cloud's Always Free tier covers at no cost.

## Decision

- **Two ways to run the app** (B-12 SD1). The **local install** is today's Node process on the
  screen machine; it keeps everything it has and syncs its profiles with the cloud. **Hosted use**
  is opening the cloud's URL in any browser, signing in, and running the screen and builder there;
  audio, camera and rendering stay in that browser (ADR 0001 decision A). External control and
  remote input (ADR 0002) exist on the local install only.
- **The cloud is one Always Free VM on Oracle Cloud running the same Node server in hosted mode**,
  behind Caddy, which terminates HTTPS and forwards to Node on `127.0.0.1` (SD6). Node never binds
  anything but `127.0.0.1`.
- **SQLite stays the store on both sides; profiles are synced, not shared** (SD8, SD9). Each side
  keeps its own SQLite file; a local install pulls the cloud's change feed and pushes its own
  writes. Deletes travel as tombstones; an edit beats a delete; the cloud decides names and wins
  conflicts, and the losing edit becomes a "Name (2)" copy on both sides (SD13).
- **Auth is bought, not built**: standard OpenID Connect with PKCE against an issuer set in
  configuration; the cloud verifies tokens and accepts one allowed subject. No provider SDK.
- **A merge to `main` deploys** over SSH through a restricted deploy user, only after the gate is
  green, with a backup before the migration and a rollback on a failed health check (SD7).
- **Backups go to Oracle Object Storage** nightly, the last 14 kept; the deploy's pre-migration
  backup uses the same routine (SD10).
- **The free instance may be reclaimed; recovery is cheap** (SD11): a rebuild script, a restore
  runbook, and a free external uptime monitor on `/api/health`.
- **This supersedes ADR 0001 §7's rows** "Cloud hosting", "Hosted database", "Bought auth" and
  "Application Insights" for hosting, the hosted database, auth and observability. Observability
  at hosting is pino JSON to the journal, kept 14 days, and the uptime monitor (SD18); no log
  shipping. §7's other rows stand.
- **It amends ADR 0001 question 2**: "nothing at a gig needs venue internet" holds for the local
  install. Hosted use needs internet at start-up.

## Alternatives

- **Azure Container Apps, as ADR 0001 §7 planned.** A container registry, a hosted database and
  Application Insights at roughly €20–35 a month by §7's own estimates, before anyone but the
  owner uses it. Lost on cost
  for a one-owner trial; nothing in this decision closes the door to it later.
- **A hosted database instead of synced SQLite.** Every local install would need the network to
  read a profile, which breaks "nothing at a gig needs venue internet" for the local install, and
  it adds a paid component. Sync keeps each install whole on its own.
- **Hosted only, no local install.** Loses External control and remote input (they need a listener
  on the screen machine's own network) and makes every set depend on venue internet.
- **Do nothing.** The single point of failure of ADR 0001 §8 stays, and the app runs on one
  machine only.

## Consequences

- **Easier:** the owner can play on any machine with a browser, and a lost screen machine no
  longer loses the profiles; a local install recovers them on its next sync.
- **Harder:** a second mode in one server, a sync protocol with conflicts and tombstones, a VM to
  keep alive on a tier that may reclaim it, and secrets (the deploy key, the provider settings,
  the bucket key, a refresh token) that live outside the repository.
- **To keep true, and what enforces it:**
  - The main server binds `127.0.0.1` only, in both modes — `docs/invariants.md` (the `127.0.0.1`
    row), `server/test/boot.int.test.ts` unchanged.
  - A hosted server never serves or opens External control, the local CA or a device socket — a
    new row in `docs/invariants.md`, enforced by `server/test/hosted.int.test.ts`.
  - No token, refresh token, subject or authorisation code in a log, a response or the console — a
    new row, enforced by `tests/browser/hosted.spec.ts` and `server/test/secrets.int.test.ts`.
  - The refresh token lives only under `DATA_DIR/cloud/` and is never served — a new row, enforced
    by `tests/meta/cloud-boundary.test.ts` (the `tls-boundary` pattern).
  - Nothing created in Oracle may cost money — the owner checks each resource against the Always
    Free list when creating it; no agent creates a cloud resource.
