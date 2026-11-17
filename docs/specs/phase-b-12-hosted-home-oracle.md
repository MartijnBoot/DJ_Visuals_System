# Spec: b-12 — Hosted home on Oracle Cloud (free tier trial)

Status: Approved · Depends on: B-02 (`docs/specs/phase-b-02-visual-profiles.md`, built), B-04
(`docs/specs/phase-b-04-live-set-controls.md`, built), B-06
(`docs/specs/phase-b-06-remote-input-devices.md`, built), B-08
(`docs/specs/phase-b-08-load-proof-gate.md`, built) · Fixes: — · Backlog: B-12

Line references are to `main` at `adf8d89`.

## Problem

The owner's profiles live in one SQLite file on one machine (`docs/adr/0001-setup-decision-record.md`
§1, §8). Playing at another location, or on a different screen machine, means carrying that
machine or moving profiles by export and import; if the machine fails, the profiles go with it
(ADR 0001 §8: "the single screen machine is a single point of failure").

What the code does today, and why nothing can be hosted as it stands:

- **The server can only be reached from the machine it runs on.** The main listener binds the
  constant `127.0.0.1` (`server/src/boot.ts:24`, `:175`), and that is a guarded row in
  `docs/invariants.md:26`. It has no authentication at all, which is correct only because of that
  bind (ADR 0001 Q3; `docs/design/architecture.md`, Cross-cutting, Auth).
- **Profiles are local rows with no history.** A save is one `UPDATE … WHERE id = ? AND revision
  = ?` (`server/src/profiles/store.ts:122-134`); a delete is `DELETE FROM profiles WHERE id = ?`
  (`:149`) and leaves nothing to compare against, so a delete cannot be told to another copy.
  Ids are made on the machine that creates the profile and names are unique ignoring case
  (`shared/src/names.ts`), so two machines can hold different profiles under one name.
- **The browser talks to a fixed local API.** `web/src/profiles/api.ts:119-149` calls relative
  `/api/profiles…` with no credentials, and the server serves `web/dist` itself
  (`server/src/boot.ts:46`, `:174`).
- **Configuration has five required variables and no hosted setting**
  (`server/src/config.ts:33-46`); nothing says "this process is the cloud".
- **There is no deploy.** CI runs the gate on every push to `main`
  (`.github/workflows/ci.yml`) and stops there; no infrastructure folder exists, and ADR 0001 §7
  defers hosting to Azure, not Oracle.
- **The screen's "set is running" fact does exist, but only on the screen page**:
  `ScreenState.started` (`shared/src/control.ts:143`), sent to the server with every state and
  held by the hub as the last state, but never read by the server for any decision.

## Decisions

- **SD1 — Two ways to run the app.** The **local install** (today's Node process on the screen
  machine) keeps everything it has and syncs its profiles with the cloud. **Hosted use** is
  opening the cloud's URL in any browser, signing in, and running the screen and builder there:
  audio, camera and rendering stay in that browser, profiles are read and saved on the cloud.
  External control and remote input (B-04, B-06) need a listener on the screen machine's own
  network, so they exist on the local install only; the hosted app has none of them and says so.
  Hosted use needs internet at start-up; offline hosted use (a service worker) is out of scope.
- **SD2 — Sync is automatic, never during a set.** A local install syncs at boot (when
  connected), after each profile save or delete, when the network returns, and on "Sync now" in
  the panel. Local edits made offline are kept and pushed when sync can run. Sync is paused from
  the moment a screen page reports `started: true` until it reports `false`, the page's socket
  closes or the process restarts; "Sync now" while paused is refused with the reason. No new
  control message is needed: the pause reads the `started` field the screen already sends
  (`shared/src/control.ts:143`).
- **SD3 — Sign-in is standard OpenID Connect, vendor-neutral.** Authorisation code with PKCE
  against an issuer set in configuration. No provider SDK is added; the server verifies tokens
  on `node:crypto` (as B-06 did for certificates), and the browser uses WebCrypto. The gate runs
  against a small fake issuer started in the test process; the real provider (Entra External ID,
  Clerk or another) is the owner's one-time setup. If `node:crypto` proves insufficient, the plan
  stops and asks about a dependency (CLAUDE.md hard stop).
- **SD4 — One allowed account.** The cloud accepts a token only when its subject equals the
  configured `ALLOWED_SUBJECT`; any other signed-in identity gets 403 and sees nothing. There is
  no owner column and no accounts table (B-13 adds ownership later).
- **SD5 — What the cloud serves.** The same Node server in hosted mode: `web/dist`, `/api/health`
  and `/api/profiles` (all behind sign-in except the page shell and health), plus the sync
  endpoints below. In hosted mode the server never serves or accepts `/control`, `/send`,
  `/trust`, `/api/control/*`, and never opens the External control listener or the local CA.
- **SD6 — A reverse proxy faces the internet; Node still binds `127.0.0.1`.** Caddy on the Oracle
  VM terminates HTTPS (a free certificate for the owner's domain) and forwards to Node. The
  `127.0.0.1`-only invariant is unchanged (`docs/invariants.md:26`). Caddy is installed by the
  infrastructure script, not a dependency of the repository.
- **SD7 — A merge to `main` deploys, pushed over SSH.** A GitHub Actions workflow runs only after
  the gate is green on `main`, one deploy at a time: it builds `web/dist`, copies a release folder
  to the VM through a restricted deploy user with a key held as a GitHub secret, backs up the
  database, applies migrations, switches a `current` link and restarts the service, then checks
  `/api/health`. If that fails it switches back to the previous release and restores the backup;
  the previous release keeps running throughout a failed deploy.
- **SD8 — Deletes sync as tombstones; an edit beats a delete.** A delete leaves a record (id,
  the revision it was deleted at, a time) that syncs like any change. If the other side edited the
  profile after that revision, the profile survives on both; otherwise the delete wins everywhere.
  Tombstones are removed after 90 days.
- **SD9 — Same name, different id is a different profile.** The arrival that finds a name taken
  becomes "Name (2)" by the existing `nextFreeName` rule. Nothing is merged silently.
- **SD10 — Backups go to Oracle Object Storage.** A nightly consistent copy of the cloud's
  SQLite file (`VACUUM INTO`) is written to a bucket and the last 14 are kept; the deploy's
  pre-migration backup uses the same routine. A restore is a runbook procedure, rehearsed once.
- **SD11 — The free instance may be reclaimed; recovery is cheap.** A script rebuilds the VM
  from nothing (packages, Caddy, service, first deploy) and a runbook restores the latest backup;
  a free external uptime monitor on `/api/health` emails the owner. No keep-alive load and no
  paid upgrade (the backlog's "Not this").
- **SD12 — ADR 0003 records the move.** "Hosting on Oracle Cloud, profiles synced from local
  installs" supersedes ADR 0001 §7's Azure rows for hosting, hosted database, auth and
  observability (not its other rows), and amends Q2's "nothing at a gig needs venue internet" to
  hold for the local install. It is drafted in the plan's first task and accepted by approving
  this spec, as ADR 0002 was by B-06's.
- **SD13 — Conflicts keep both, and never ask mid-sync.** *(default, not asked — object at
  review.)* A sync has nobody at the screen to ask, and Q2's "Reload theirs / Save mine as a copy"
  needs one. When a profile was edited on a machine and on the cloud since they last matched, the
  cloud's version keeps the name and id, the machine's version is saved as a copy "Name (2)" (SD9's
  rule), and the panel and the builder list say "n conflicts kept as copies". In hosted use a save
  is a direct write, so the builder's existing stale-revision choice applies unchanged.
- **SD14 — Mode and cloud settings are configuration, read in `config.ts` only.** *(default, not
  asked.)* A required `APP_MODE` (`local` or `hosted`); for `hosted`: `OIDC_ISSUER`,
  `OIDC_CLIENT_ID`, `ALLOWED_SUBJECT` (all required together); for `local` an optional group
  `CLOUD_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID` that is present together or not at all. A local
  install with no cloud settings behaves exactly as it does today (sync off, no panel row).
  `.env.example` stays the contract. Names are the plan's to finalise within these rules.
- **SD15 — Connecting a local install.** *(default, not asked.)* The panel's "Connect to cloud"
  opens the provider's sign-in in the owner's browser, which returns to a loopback callback on
  `127.0.0.1:PORT`; the server keeps the refresh token under `DATA_DIR/cloud/`, ignored by git,
  never served or logged. "Disconnect from cloud" deletes it. A revoked or expired sign-in turns
  sync off with "Sign in again" in the panel; the local app keeps working.
- **SD16 — Hosted sign-in in the browser.** *(default, not asked.)* The page redirects to the
  provider, receives a code, exchanges it with PKCE and keeps the access token in memory (the
  provider's own session renews it silently); nothing is stored in `localStorage`. If renewal
  fails mid-set, the screen keeps drawing, profile reads fail with one reason as every API failure
  does today (B-02 SD9), and the panel shows "Sign in again".
- **SD17 — The cloud's limits.** *(default, not asked.)* Ten rejected tokens from one address in
  60 s answers 429 for 60 s; request body 128 KB (1 MB for an import) as today; sync pages of 50
  changes; sync requests time out after 10 s and retry with backoff from 5 s doubling to 5 min.
  No CORS header on any response (B-02 SD18).
- **SD18 — Logs.** *(default, not asked.)* pino JSON to stdout under systemd, kept 14 days. Sync
  and sign-in are logged by outcome, profile id and revision; never a token, a subject, an email,
  a refresh token or a profile definition.

## Users and permissions

| Role | Can | Cannot |
|---|---|---|
| Owner, signed in (the allowed subject) | Read, create, save, delete, import and export profiles on the cloud, in hosted use; connect, sync and disconnect a local install | — |
| Any other signed-in identity | Load the page shell and `/api/health` | Read or write anything (403) |
| Anyone not signed in | Load the page shell and `/api/health` | Read or write anything (401) |
| Local install, not connected | Everything it does today | Sync |
| Hosted use | Screen page and builder | External control, remote input, `/control`, `/send`, `/trust` |

## In scope

- `server/`: hosted mode (`APP_MODE`), token verification and the allowed-subject check, the sync
  endpoints, tombstones, the sync client in local mode (queue, pause, backoff, conflict copies), the
  loopback sign-in and refresh-token store, the nightly backup routine, migration `0003`.
- `shared/`: the sync request and answer shapes, the cloud status shape, `mode` on the health answer.
- `web/`: hosted-use sign-in (PKCE), sending the token, "Sign in again", the panel's cloud row
  (Connect, Sync now, status, conflicts, Disconnect), hiding External control and remote input in
  hosted use, the builder's list note for conflict copies.
- `infra/` (new): the VM rebuild script, the Caddy config, the systemd unit, the backup timer, the
  deploy and rollback script; `.github/workflows/deploy.yml`; the runbook entries (rebuild, restore,
  first-time provider setup, rotating the deploy key).
- `docs/adr/0003-…`, `docs/design/architecture.md` (hosting, sync), `docs/invariants.md` (new rows
  below), `.env.example`, the defect and backlog bookkeeping.

## Out of scope

- External control or remote input through the cloud (a phone controlling a hosted screen); the
  cloud never relays media or control.
- Offline hosted use, a service worker, an installable app.
- Other people's accounts, ownership, payments, a second allowed account (B-13); a provider SDK.
- Syncing `DATA_DIR/assets/` (empty; image assets are B-14), the browser's remembered sources, the
  picked profile id, live dial or colour changes (never saved, ADR 0001), certificates, pairings.
- Continuous or polling sync, a push channel from the cloud, real-time collaboration.
- Paid Oracle resources, keep-alive load, multiple VMs, a load balancer, a CDN, a WAF.
- Application Insights or any log shipping; metrics beyond `/api/health`.
- Server-side rendering; any media or camera frame reaching the cloud.
- Changing the `127.0.0.1` bind or adding a plain-HTTP listener; editing an existing migration.
- Buying the domain, creating the Oracle account, the provider tenant, the GitHub secrets and the
  bucket keys: the owner's human steps, never an agent's.

## Acceptance criteria

Sync and the cloud's API (SD2, SD4, SD8, SD9, SD13):

- **AC1.** When a request to `/api/profiles`, `/api/profiles/:id`, `/api/profiles/import` or a
  sync endpoint reaches a hosted server without a valid token, the system shall answer 401 and
  change nothing.
- **AC2.** When a valid token's subject is not `ALLOWED_SUBJECT`, the system shall answer 403 on
  those paths, change nothing and log the outcome without the subject.
- **AC3.** When the token is expired, signed with another key or issued by another issuer, the
  system shall answer 401.
- **AC4.** While `APP_MODE` is `hosted`, the system shall answer 404 on `/control`, `/send`,
  `/trust` and `/api/control/*`, shall never open the External control listener, and shall not
  create `DATA_DIR/tls/`.
- **AC5.** When a connected local install boots, the system shall pull the cloud's changes since
  its cursor, push its own, and finish with both sides holding the same profiles (ids, names,
  definitions) and the cursor advanced.
- **AC6.** When a profile is saved or deleted on a connected local install, the system shall push
  it within 10 s of the write when sync is not paused.
- **AC7.** While the local install is offline, the system shall keep every save and delete, shall
  show "Offline — changes will sync" in the panel, and shall push them in order when the cloud
  answers again.
- **AC8.** When the process restarts with unsynced changes, the system shall still hold them and
  push them at the next sync (the queue is in the database, not in memory).
- **AC9.** While a screen page reports `started: true`, the system shall start no sync, shall
  keep the queue, and shall make no request to the cloud; when it reports `false`, the page's
  socket closes or the process restarts, sync shall run within 10 s.
- **AC10.** While sync is paused, when "Sync now" is pressed, the system shall refuse it and show
  "A set is running — sync resumes when it stops".
- **AC11.** When a machine deletes a profile and the cloud's copy has not changed since that
  revision, the system shall remove the profile on the cloud and on every machine that syncs.
- **AC12.** When a machine deletes a profile and the cloud's copy was edited after that revision,
  the system shall refuse the delete, keep the profile on both and return the cloud's version to
  the deleting machine.
- **AC13.** When a machine edits a profile the cloud has deleted, the system shall restore it on
  the cloud with the same id and the machine's edit.
- **AC14.** When a profile was edited on a machine and on the cloud since they last matched, the
  system shall keep the cloud's version under the name and id and save the machine's as a copy
  named by `nextFreeName`, on both sides, and shall show "n conflicts kept as copies".
- **AC15.** When two machines arrive with different ids under one name, the system shall make the
  later arrival "Name (2)" (or the next free number) and lose neither.
- **AC16.** When a sync is interrupted mid-way (connection drop, process kill), the system shall
  leave every profile whole, never half-written, and the next sync shall complete it.
- **AC17.** When the cloud answers 429, 5xx or does not answer within 10 s, the system shall retry
  with backoff from 5 s doubling to 5 min and shall not block the app, the screen or the builder.
- **AC18.** Tombstones older than 90 days shall be removed by the next sync on the cloud; a
  machine that returns after more than 90 days shall pull the full set instead of the change
  feed, and shall keep its unsynced edits as conflict copies (AC14).
- **AC19.** A local install with no cloud settings shall behave as before B-12: no sync request,
  no cloud row in the panel, every earlier test unchanged and green.

Hosted use and sign-in (SD1, SD3, SD15, SD16):

- **AC20.** When the cloud's URL is opened without a sign-in, the system shall show a sign-in
  page; after signing in as the allowed subject it shall show the screen page, with profiles read
  from the cloud and the builder at `/builder` working against it.
- **AC21.** While in hosted use, the system shall not show the External control switch, the
  remote-input QR codes or the senders list, and shall show "External control needs the local
  install".
- **AC22.** When a profile is saved in hosted use on a stale revision, the system shall offer the
  builder's existing "Reload theirs / Save mine as a copy" and change nothing until chosen.
- **AC23.** If the hosted sign-in cannot be renewed while a set is running, then the screen shall
  keep drawing its current look, profile reads shall fail with one reason, and the panel shall
  show "Sign in again" (B-02 SD9 unchanged).
- **AC24.** When "Connect to cloud" is pressed on a local install, the system shall complete the
  loopback sign-in, store the refresh token under `DATA_DIR/cloud/` and start a sync; "Disconnect
  from cloud" shall delete the token and stop syncing, leaving every profile in place.
- **AC25.** If the local install's sign-in is revoked or expired, then the system shall stop
  syncing, show "Sign in again" in the panel and keep the app working.
- **AC26.** The system shall never write a token, refresh token, subject, email, authorisation
  code or profile definition to a log line, a response body or the browser console, over a whole
  scripted run of connect, sync, conflict and sign-out.

Deploy, backup and recovery (SD6, SD7, SD10, SD11):

- **AC27.** The hosted server shall bind `127.0.0.1` only (`docs/invariants.md:26` unchanged;
  `server/test/boot.int.test.ts` passes without edit).
- **AC28.** When the deploy script runs against a release whose health check fails, the system
  shall switch back to the previous release, restore the pre-deploy backup and report the failure;
  when it succeeds the previous release shall remain on disk for rollback (tested on a local
  stand-in service).
- **AC29.** When the workflow runs, it shall run only after the gate is green on `main`, never
  two deploys at once, and shall use only the GitHub secrets the runbook lists.
- **AC30.** When a migration is applied by a deploy, the system shall have written a backup first,
  and a migration that fails shall leave the previous release running (SD7).
- **AC31.** When the nightly routine runs, it shall write a consistent copy that opens and passes
  `PRAGMA integrity_check`, shall upload it to the bucket and shall delete all but the last 14.
- **AC32.** When the rebuild script and the restore procedure are followed on a fresh VM, the
  system shall serve `/api/health` and the restored profiles (human check).

## Data

Migration `server/migrations/0003_sync.sql`, additive and forward-only (the plan fixes exact
columns):

- `profiles` gains the sync state a local install needs per row (the cloud revision it last
  matched, whether it has unpushed changes) and, on the cloud, a monotonic change counter set on
  every write.
- `profile_tombstones(id, name, revision, deleted_at, change counter)`; a delete writes one in the
  same transaction as the `DELETE`.
- `app_meta` rows for the local cursor and the cloud's counter.

Hosted and local run the same migrations; a column unused in one mode stays empty there. Rows and
files written before `0003` stay valid; profile files and `formatVersion` do not change. The
refresh token is a file under `DATA_DIR/cloud/`, not a table.

## API contract

New on the main listener; in hosted mode every one needs `Authorization: Bearer <token>`.

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| GET | `/api/sync/changes?cursor=<n>&limit=50` | — | 200 `{ changes: [profile or tombstone…], cursor, more }` | 401, 403, 429 |
| PUT | `/api/sync/profiles/:id` | profile and `baseRevision` | 200 the cloud's profile (revision set by the cloud) | 400 `invalid`, 401, 403, 409 `stale_revision` (with `current`), 422 |
| DELETE | `/api/sync/profiles/:id?baseRevision=<n>` | — | 200 `{ deleted: true }` or `{ deleted: false, current }` (AC12) | 401, 403, 404 |
| GET | `/api/sync/full` | — | 200 the whole set, paged (AC18) | 401, 403 |
| GET | `/api/health` | — | existing answer plus `mode` | — (no sign-in) |

Local only, on `127.0.0.1`, for the panel (all on a user action, so the "requests a running set
makes" list in `docs/invariants.md:27` gains no automatic request): `GET /api/cloud/status`,
`POST /api/cloud/connect` (returns the provider URL), `GET /api/cloud/callback` (the loopback
return), `POST /api/cloud/sync`, `POST /api/cloud/disconnect`. Hosted mode has no `/api/cloud/*`.
Every received body is validated against `shared/` before use. `/api/profiles*` keeps its contract
and its status codes in both modes.

## UI

- **Hosted sign-in page**: one button "Sign in"; states: redirecting, error ("Sign-in failed —
  try again"), not allowed ("This account has no access").
- **Panel, cloud row (local install, cloud settings present)**: states Not connected (button
  "Connect to cloud"), Connected (last sync time, "Sync now"), Syncing, Offline ("changes will
  sync"), Paused ("A set is running"), Sign in again, "n conflicts kept as copies" with a link to
  the builder list; "Disconnect from cloud" behind a confirm. No row when no cloud settings exist.
- **Panel in hosted use**: no External control block; "External control needs the local install".
- **Builder**: a copy made by a conflict is marked in the list ("Conflict copy") until renamed or
  saved once. Everything else is unchanged.
- **Screen output**: never carries text (B-01). No change.

## Non-functional

- **Latency.** Sync does no work in the browser's frame loop and none while a set runs (AC9); the
  B-01 and B-06 budgets are unchanged. The screen page makes no new automatic request.
- **Size.** A full sync of 100 profiles of typical size completes in under 10 s on a normal
  connection; a sync with nothing to move is one request.
- **Security.** Tokens verified on every request; the cloud serves no CORS header; the only
  public surface is Caddy's HTTPS; secrets (deploy key, provider settings, bucket keys, the
  refresh token) are never committed (gitleaks, CLAUDE.md "Never").
- **Availability.** Local installs run unaffected while the cloud is down; hosted use is down
  with it. Trial measure, not a gate: `/api/health` up at least 99% of the 14 days after go-live,
  from the uptime monitor, reported to the owner.
- **Invariants to add to `docs/invariants.md`.** (1) A hosted server never serves or opens
  External control, the CA or a device socket (AC4); (2) no token, refresh token, subject or
  authorisation code in a log, response or console (AC26); (3) the refresh token lives only under
  `DATA_DIR/cloud/` and is never served (the `tls-boundary` pattern).

## Edge cases and failure modes

- **Restart mid-sync or mid-deploy.** The queue is in the database (AC8); a half-pushed batch is
  re-pushed and the cloud's `baseRevision` check makes a repeat harmless (AC16); a deploy that
  dies before the switch leaves the old release running.
- **Two machines at once.** The cloud's `UPDATE … WHERE revision = ?` rule decides; the loser
  becomes a conflict copy (AC14). Two syncs from one machine cannot overlap (one in flight).
- **No network.** At boot, mid-set and at a venue the app runs as today; sync waits (AC7, AC9,
  AC17). Hosted use without internet does not start (SD1).
- **Clock skew.** Order comes from revisions and the cloud's counter, never from machine clocks;
  only the 90-day tombstone clean-up reads a time, the cloud's.
- **A set starts during a sync.** The sync in flight finishes its current request; no further
  request is made (AC9); nothing the screen holds changes (B-02 SD9).
- **Cloud has a profile the local schema rejects** (a newer app wrote it). It is left out of the
  list with one `warn` by id, as an unusable row is today (`docs/design/architecture.md`, Data).
- **Provider down or the allowed subject changed.** Sign-in fails with one reason; local installs
  keep working; the owner changes `ALLOWED_SUBJECT` and restarts.
- **Instance reclaimed or disk lost.** SD11: rebuild, restore the last backup; profiles made
  since then exist on any local install that synced them and return on its next sync.
- **Who may do this.** Only the allowed subject (AC1, AC2). No guarded area exists
  (`docs/invariants.md`, "None yet"); the `127.0.0.1` row is kept (AC27).
- **Money.** Nothing here may cost: the plan checks every Oracle resource against the Always Free
  list, and creating one that is not on it is the owner's decision.

## Verification

In the gate (`bash scripts/check.sh`), with no network and no real provider: the test process
starts a cloud-mode server, a fake OIDC issuer and two local-mode servers, each on `127.0.0.1`
with its own `DATA_DIR`.

1. Boot the cloud; AC1–AC4 against it. Connect local A (AC24), create three profiles, sync; local B
   connects and pulls the same three (AC5).
2. Edit one on A and one on B, sync both; delete one on A; sync; check AC11, AC14, AC15 in turn.
3. Take the cloud down; edit on A (AC7); kill A, restart it (AC8); bring the cloud up; check
   AC17, AC16 with a kill during a push.
4. Report `started: true` on A's screen socket; check AC9 and AC10; report `false` and check the
   resume.
5. A Playwright run against the hosted server with the fake issuer: sign in as the allowed
   subject and another (AC20, AC2), no External control (AC21), a stale save (AC22), a failed renewal
   with a running capture (AC23); the whole run's logs and console are scanned for AC26.
6. A script test of the deploy and rollback (AC28, AC30) and the backup routine (AC31) on a local
   stand-in; a structural test of `deploy.yml` (AC29); `server/test/boot.int.test.ts` unchanged.

The owner's checks (human steps, after the build; the exact list is the plan's): create the
Oracle account and VM, the domain and DNS, the provider tenant and its redirect URIs, the GitHub
secrets and the bucket key; run the rebuild script; merge a change and watch it deploy; break a
deploy on purpose and watch it roll back; kill the service and watch the monitor email; restore a
backup on a fresh VM (AC32); connect the real local install and a second machine; play a set on
hosted use over venue-like internet and read the overlay.

## Exit condition

The owner can open the Oracle URL on a machine with no install, sign in and play a set with their
own profiles, a local install on another machine shows the same profiles after a sync, and a
merge to `main` has reached the cloud by itself.

## Open questions

None, once the owner has read the defaults marked *(default, not asked)* (SD13 to SD18) and
objected to any.
