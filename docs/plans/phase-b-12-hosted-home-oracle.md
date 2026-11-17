# Plan: b-12 — Hosted home on Oracle Cloud (free tier trial)

Spec: [docs/specs/phase-b-12-hosted-home-oracle.md](../specs/phase-b-12-hosted-home-oracle.md) (`Status: Approved`) ·
Status: Audited

ADRs honoured: [0001 Setup Decision Record](../adr/0001-setup-decision-record.md) — rendering
stays in the browser (decision A), SQLite stays the store on both sides (Q1), the local install
keeps "nothing at a gig needs venue internet" (Q2, as amended by ADR 0003), auth is bought, not
built: the identity provider is the owner's, the app only verifies its tokens (Q3);
[0002 Remote input over the LAN](../adr/0002-remote-input-over-the-lan.md) — unchanged; remote
input exists on the local install only (SD1). ADR 0003 is drafted in T1 and supersedes 0001 §7's
Azure rows for hosting, hosted database, auth and observability (SD12). New dependencies: none —
JWT verification on `node:crypto` (checked: `createPublicKey({ format: "jwk" })` plus
`crypto.verify` verifies RS256 and ES256 on Node 24.22), PKCE on WebCrypto, the backup upload on
`fetch` plus a SigV4 signature on `node:crypto`, the rate limit in process. Caddy, the OCI
console and an uptime monitor are installed or created on the VM and accounts, not dependencies
of the repository (SD6).

Line references are to `main` at `adf8d89`.

## Approach

One server, two modes, chosen by a required `APP_MODE`. **Hosted** is today's Node process with
the LAN-facing parts never built (hub, LAN listener, certificate store, screen socket) and an
`onRequest` guard on `/api/profiles*` and `/api/sync/*` that verifies an OIDC ID token against the
issuer's JWKS and the one allowed subject. Caddy faces the internet; Node still binds
`127.0.0.1`. **Local** is today's process unchanged, plus — only when the cloud settings are
present — a loopback sign-in that keeps a refresh token in `DATA_DIR/cloud/`, and a sync client
that pulls the cloud's change feed and pushes a queue that lives in the database. The queue is not
a table of its own: every write already lands in `profiles` or (new) `profile_tombstones`, so
migration `0003` adds a change counter stamped on every write, the cloud revision a local row last
matched and the change it last pushed; a row is unsynced when it never matched the cloud or was
written since its last push. That makes the queue survive a restart (AC8) for free and keeps every
SQL statement in `server/src/profiles/store.ts` (CLAUDE.md). A pull fetches every page first and
applies them in one transaction with the cursor, so a kill mid-sync leaves nothing half-applied
(AC16); a push is one profile per request, and the cloud's `baseRevision` check makes a repeat
harmless. The cloud decides names and wins conflicts; the machine's losing edit becomes a
"Name (2)" copy on both sides (SD9, SD13). The sync scheduler hears the hub's `started` through a
new callback and makes no request while a set runs (SD2).

The browser in hosted use signs in with authorisation code + PKCE straight against the provider,
keeps tokens in memory (SD16), sends the ID token as a bearer from the one choke point in
`web/src/profiles/api.ts`, and renews only on demand before a profile request, so a running set
makes no new automatic request. Mode, cloud presence and the sign-in settings reach the page on
the existing `/api/health` answer. Deploy is a TypeScript script (`infra/deploy.ts`) run on the
VM by a forced SSH command, so the same code is tested in the gate on Windows and Linux against a
stand-in service; the workflow runs on `workflow_run` of CI. Backups are `VACUUM INTO` plus
`PRAGMA integrity_check`, uploaded to Object Storage through its S3-compatible API. Every Oracle
resource is created by the owner in the console (Human steps); no agent touches the cloud.

Rejected:

- **A separate queue table written by triggers or the routes.** Two records of one fact; derived
  "unsynced" from the row's own columns cannot drift.
- **Verifying the provider's access token.** Its format and audience differ per provider (Entra
  issues a JWT only for an exposed API scope; others issue opaque tokens), and it would need an
  `OIDC_AUDIENCE` the spec does not list. The ID token is a JWT on every OIDC provider with
  `aud = OIDC_CLIENT_ID` (PD7).
- **A backend-for-frontend cookie session for hosted use.** Contradicts SD16 (the browser
  exchanges the code) and adds a session store.
- **The OCI CLI or `rclone` for the upload.** A Python install or a binary on the VM, untestable
  in the gate; SigV4 is about 100 lines on `node:crypto` and testable against an in-process fake
  bucket (PD25).
- **A bash deploy script.** Its atomic `current` switch is a symlink that Git Bash on the owner's
  Windows machine copies instead of linking, so the gate could not test it there; Node's
  `symlinkSync(…, "junction")` works on both (PD23).
- **Polling the cloud status from the panel.** An automatic request from the screen page
  (`docs/invariants.md:27`, spec "Latency"); the panel reads status on open and on each action
  (PD18).
- **`@fastify/rate-limit`.** A dependency for ten lines of in-memory counting (PD11).

## Decisions this plan makes

Readings of the spec the planner had to choose. **Confirm** rows are for the audit to confirm or
overrule; **Owner** rows are user-visible choices the spec left open, and each one is a stop
(CLAUDE.md hard stops).

| # | Question | Decision | Reason |
|---|---|---|---|
| PD1 · Owner — **recommended accepted** (audit 2026-11-17) | Every move between `/` and `/builder` is a full page load (`Panel.tsx:144`, `Builder.tsx:210`), so an in-memory token (SD16) is gone on each one. What does the hosted owner see? | **Recommended:** after the first sign-in in a tab, a later load in that tab goes to the provider by itself and comes straight back (the provider's own session answers without a prompt); the sign-in page with its "Sign in" button shows only on the tab's first load, after "Sign in again", or when the silent return fails. A non-secret marker in `sessionStorage` (`djv.signedIn`) says "this tab signed in"; no token is stored anywhere but memory. *Alternative:* the sign-in page and its button on every load. | One extra redirect per page change versus a click per page change; SD16 forbids storing the token, not a marker. `sessionStorage` also carries the PKCE verifier and `state` across the redirect, as any browser PKCE flow must. |
| PD2 · Owner — **recommended accepted** (audit 2026-11-17) | AC18: a machine back after more than 90 days "shall keep its unsynced edits as conflict copies". Every unsynced edit, or only those the cloud also changed or deleted? | **Recommended: literally every one.** In a full pull (reset), each unsynced local row becomes a "Name (n)" copy marked "Conflict copy", and the cloud's set replaces the rest; unsynced deletes are dropped. *Alternative:* only rows whose cloud copy changed or vanished become copies; an edit on an unchanged base is pushed as an ordinary edit. | The literal reading needs no tombstone the cloud has already purged and can never lose an edit; its cost is extra copies after a three-month absence. Two readings with different visible results, hence the stop. |
| PD3 · Owner — **recommended accepted** (audit 2026-11-17) | "n conflicts kept as copies" (SD13, AC14): what is n, and when does the line go? | **Recommended:** n is the number of profiles marked "Conflict copy" right now, on that side; the line shows in the panel's cloud row and above the builder list while n > 0, and the mark leaves a profile when it is renamed or saved once (spec UI, Builder). *Alternative:* the number made by the last sync, gone after the next one. | The recommended n is the same on every machine and in hosted use, and cannot vanish before the owner has looked. |
| PD4 · Owner — **recommended accepted** (audit 2026-11-17) | Texts the spec does not give. | **Recommended:** the loopback callback page reads "Connected to the cloud — you can close this tab" or "Sign-in failed — try again from the panel"; the panel's Connected state reads "Last synced HH:MM" (the screen machine's clock) and Syncing reads "Syncing…"; a hosted profile read refused for sign-in reads "profiles unavailable: sign in again; keeping the current look", and for a not-allowed account "profiles unavailable: this account has no access; keeping the current look" (B-02 SD9 shape); the builder's failure line for the same two reads "sign in again" and "this account has no access". *Alternative:* the owner's wording. | New user-visible text, the B-06 PD3 precedent. |
| PD5 · Confirm | `APP_MODE` and the cloud settings (SD14). | Required `APP_MODE` = `local` or `hosted`. Hosted: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `ALLOWED_SUBJECT` required; `CLOUD_URL` refused ("only for APP_MODE=local"). Local: `CLOUD_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID` all or none; `ALLOWED_SUBJECT` refused ("only for APP_MODE=hosted"). URLs must be `https:`, or `http:` on `127.0.0.1`/`localhost` only (the gate's fake issuer and cloud). A problem names the variable, never the value (`config.ts:12-20`). The order of problems puts `APP_MODE` after `LOG_LEVEL`. | SD14's rules, with the cross-mode refusals so a misplaced setting fails at boot instead of being ignored. |
| PD6 · Confirm | AC27 says `server/test/boot.int.test.ts` passes without edit, but its env comes from `baseEnv` (`server/test/spawn-server.ts:128-140`). AC19 says "every earlier test unchanged", but SD14 makes `APP_MODE` required, so every hand-built env must gain it. | `baseEnv` gains `APP_MODE: "local"`; the test file is untouched. Its exact problem list (`boot.int.test.ts:126`) and key scan (`:206-212`) still pass because `APP_MODE` is valid there. AC19's "unchanged" reads as **unchanged in behaviour**: the only edits allowed to an earlier test are the ones listed under "Existing tests and texts this change makes untrue" — an added `APP_MODE: "local"` in an env literal, and the version and file-list lines of the real migrations folder. No assertion of an earlier test changes (audit F5, 2026-11-17). | The helper is not the test; the test's assertions about `127.0.0.1` stand unchanged. SD14's required variable makes the env edits unavoidable. |
| PD7 · Confirm — **confirmed** (audit 2026-11-17, F3: the departure from SD16's "access token" accepted knowingly) | Which token is the bearer. | The OIDC **ID token**. The cloud checks: compact JWS, `alg` RS256 or ES256 (any other, `none` included, is 401), `kid` in the issuer's JWKS (fetched from `jwks_uri` of `${OIDC_ISSUER}/.well-known/openid-configuration`, cached, refetched at most once a minute on an unknown `kid`), `iss === OIDC_ISSUER`, `aud` contains `OIDC_CLIENT_ID`, `exp` in the future and `nbf` not, 60 s leeway; then `sub === ALLOWED_SUBJECT` or 403. The local install and hosted use share one public client registration, so both tokens carry the same `aud`. | Vendor-neutral (SD3); see Rejected. |
| PD8 · Confirm | Where the browser learns mode and sign-in settings. | `/api/health` gains `mode: "local" \| "hosted"`, `cloud: boolean` (local with cloud settings) and `signIn: { issuer, clientId } \| null` (hosted only; both are public values). `web/src/main.tsx` reads it once before rendering; a failed read renders the local page with no cloud row, as today. | The spec puts `mode` on health; the web has no build-time configuration (`web/src` has no `import.meta.env`). `/api/health` is already on the running-set request list. |
| PD9 · Confirm — **confirmed** (audit 2026-11-17, F3: renewal by an in-memory refresh token instead of SD16's "the provider's own session renews it silently", accepted knowingly; a silent provider renewal would leave the page mid-set or need a third-party-cookie iframe) | Hosted sign-in in the browser (SD16). | `redirect_uri` is the page itself (`https://<domain>/` or `https://<domain>/builder`; both registered). Scope `openid offline_access`. On return the page exchanges the code (PKCE S256) at the token endpoint, keeps ID and refresh tokens in memory, removes `code` and `state` from the address bar (`history.replaceState`), then reads `GET /api/profiles` once: 403 shows "This account has no access" on the sign-in page; 200 renders the page. Renewal happens only on demand: before a profile request, an ID token within 60 s of `exp` is renewed with the refresh token; a 401 is renewed once and retried once; a failed renewal sets "signed out" (the panel's "Sign in again"), and that request fails with PD4's reason. "Sign in again" starts the redirect, which leaves the page. | No timer, so a running set makes no automatic request (`docs/invariants.md:27`); AC23's renewal failure surfaces on the next profile action. |
| PD10 · Confirm | What hosted mode does not build (SD5, AC4). | `boot()` in hosted mode never creates the certificate store, the hub, the LAN listener or the screen-socket route; the server's `upgrade` event is routed with no routes, so every WebSocket upgrade, `/api/control/screen` included, gets a raw 404 (`control/upgrade.ts:43-48`). `/control`, `/send`, `/trust` already 404 on the main listener (`static.int.test.ts:81-84`); a hosted test asserts all four. The hosted page never opens the screen socket, and the panel hides External control. | Not building them is stronger than switching them off; nothing creates `DATA_DIR/tls/`. |
| PD11 · Confirm | SD17's "ten rejected tokens from one address in 60 s". | In hosted mode Fastify gets `trustProxy: "127.0.0.1"`, so `request.ip` is the client Caddy forwarded (`X-Forwarded-For`), never Caddy itself. The guard counts 401 and 403 per address in a sliding 60 s window in memory; the 11th within 60 s answers 429 `{error:"rate_limited"}` for 60 s from that moment, before verifying anything. Restart clears it. The window is not new code: the pairing throttle (`server/src/control/pairing.ts:92-93`, `:151-159`, `:186-189`) already counts per address in a sliding window and refuses for 60 s. T5 lifts it into `server/src/rate-window.ts` (`createRateWindow({ limit, windowMs, blockMs, now })`: `blocked(key)`, `record(key)`, `clear()`), and both the pairing and the guard use it; `pairing.test.ts` passes unedited (audit F4, 2026-11-17). | Without `trustProxy` every client shares Caddy's address and one stranger could lock the owner out. One window, two users, instead of a second copy. |
| PD12 · Confirm | AC26 against Fastify's request log, which carries `req.url` with its query (`log.ts`, no serializer). | `createApp` logs the path only, never the query string, in both modes (a `req` serializer). The loopback callback's `code` and `state`, and any `cursor`, therefore never reach a log line. 5xx errors keep logging `err` (`app.ts:36`), but no code path puts a token in an error message (the sync and sign-in modules throw kinds, not bodies). | One rule for every route, cheaper than remembering per route. |
| PD13 · Confirm | AC26 says a profile definition never reaches "a response body". | Read as: tokens, refresh tokens, subjects, emails and codes never in a log, a response body or the console; definitions never in a log or the console. A definition in `/api/profiles`' answer is the API itself. | The literal reading forbids the product; there is no second plausible reading. |
| PD14 · Confirm | The data model of the queue (spec Data). | See Data changes. Every write (create, update, import, delete, and the sync's own writes) bumps `app_meta.change_counter` and stamps the row's `change_seq` in the same `BEGIN IMMEDIATE` (both modes). A delete writes a tombstone in that transaction: in hosted mode always, with the row's revision; in local mode only when the row ever matched the cloud, with its `cloud_revision`. Unsynced (local) = `cloud_revision IS NULL OR change_seq > pushed_seq`; pending deletes are the local tombstones, removed when the cloud acknowledges. | The queue is the rows; order is `change_seq` (AC7 "in order"); nothing in memory (AC8). |
| PD15 · Confirm | The local revision versus the cloud's. | A local row keeps its own `revision` for the builder's stale check; `cloud_revision` is the cloud's. A pull that changes a row's content bumps its local revision (an open builder sees a stale save and gets "Reload theirs", correctly); a push acknowledgement changes only `cloud_revision` and `pushed_seq`, so the owner's next save in an open builder is not refused. | Adopting the cloud's revision locally would refuse the owner's next save after every automatic push. |
| PD16 · Confirm | One sync run. | (1) **Pull**: `GET /api/sync/changes?cursor=&limit=50` until `more` is false, all pages in memory, then applied in one transaction with the new cursor; an answer `reset: true` switches to `GET /api/sync/full` (paged by id, with the cloud's counter at the first page as the new cursor). (2) **Push** the unsynced rows and tombstones in `change_seq` order, one request each. Pull rules for a cloud profile against the local row of the same id: none → insert (unless a pending local delete names that revision: keep the delete); synced → overwrite; unsynced on the same cloud revision → keep (it will be pushed); unsynced on an older cloud revision → conflict (below). A cloud tombstone: synced row → delete; unsynced row → keep, it restores on push (AC13). A cloud name held locally by a different id: an unsynced local row is renamed by `nextFreeName` (it is the later arrival, AC15); a synced one is renamed in place first and gets its own name from its own change later in the same transaction. **Conflict** (AC14): the machine's version becomes a new id, `nextFreeName`, marked conflict copy and unsynced; the row takes the cloud's version. Push answers: 200 → `cloud_revision` and the cloud's name adopted, `pushed_seq` set to the change sent (a newer local write stays unsynced); 409 `stale_revision` → conflict as above with `current`; delete `{deleted:false, current}` → `current` inserted, tombstone dropped (AC12); delete 404 → tombstone dropped. | The cloud decides names and wins conflicts, so both sides converge on its state plus the copies. |
| PD17 · Confirm | Cloud endpoints' edge rules (spec API contract). | `PUT /api/sync/profiles/:id` with `baseRevision`: row exists and revision = base → update, revision + 1; exists and ≠ base → 409 `stale_revision` with `current`; no row and a tombstone (or base > 0 and neither, a purged tombstone) → restore with that id, revision = max(tombstone revision, base) + 1 (AC13); no row, no tombstone, base 0 → create with that id, revision 1. A name held by another id → `nextFreeName` (AC15). The body is validated against the profile schema (400 `invalid`, 422 `unsupported_version` as import does). `DELETE …?baseRevision=` : revision = base → delete + tombstone, `{deleted:true}`; revision > base → `{deleted:false, current}`; no row but a tombstone → `{deleted:true}` (a repeat, AC16); neither → 404. `GET /api/sync/changes` purges tombstones older than 90 days by the cloud's clock first, records `app_meta.purged_through` (the highest purged counter), and answers `{reset: true}` when `0 < cursor < purged_through`. | AC11–AC13, AC15, AC16, AC18; a missing tombstone after 90 days behaves like "the delete was never seen", and an edit still beats it. |
| PD18 · Confirm | How the panel's cloud row stays current without an automatic request. | `GET /api/cloud/status` on each panel open and as the answer to every panel action; no polling. `POST /api/cloud/sync` answers when that run ends (Syncing shows while it is pending) or at once with 409 `{error:"paused"}`. The panel re-reads status when the page regains focus after "Connect to cloud" opened the provider in a new tab. Status: `{ state: "not_connected" \| "connected" \| "syncing" \| "offline" \| "paused" \| "signed_out", lastSyncAt, conflicts }`. | Spec API contract: all on a user action. A focus event follows the owner's own click. |
| PD19 · Confirm | The scheduler (SD2, AC6, AC9, AC17). | One run in flight; a trigger during a run asks for one more after it. Triggers: boot (connected), 2 s after the last profile write, the end of a pause, "Sync now", and each retry. A failed run (no answer within 10 s, 429, 5xx, a refused connection) schedules a retry at 5 s, doubling to 5 min, reset by a successful run; "when the network returns" is the first retry that succeeds. The hub gets an `onRunning(running)` dependency, called when `cached?.started === true` changes: on a state message (`hub.ts:261`), on a new screen attach (`:315`, which resets to not running) and on the target's close (`:333`). While running, no run starts and the run in flight makes no further request; on the change to not running a run starts at once. | Every bound inside 10 s; no new control message (SD2). A superseded page stops counting the moment its successor attaches; the successor's first state decides. |
| PD20 · Confirm | Sign-in on the local install (SD15, AC24, AC25). | `POST /api/cloud/connect` makes a PKCE verifier, `state` and the authorise URL (redirect `http://127.0.0.1:PORT/api/cloud/callback`, scope `openid offline_access`), keeps one pending attempt for 10 minutes, and the panel opens the URL in a new tab. The callback checks `state`, exchanges the code, writes `DATA_DIR/cloud/session.json` `{ refreshToken }` (atomic temp-file rename, `0o600`, the folder `0o700`, where the OS allows: B-06 T3's Windows answer applies), keeps the ID token in memory and starts a run. Revoked or expired = the token endpoint answers 400 `invalid_grant`, or the cloud answers 401 to a token just renewed; then the file becomes `{ revoked: true }` and the state is `signed_out` across restarts. A network failure is `offline`, never `signed_out`. "Disconnect from cloud" deletes the folder's file and stops the scheduler; profiles, cursor and per-row sync columns stay. | `docs/invariants.md`'s `tls-boundary` pattern for a second secret file. Keeping the cursor lets a reconnect to the same cloud resume. |
| PD21 · Confirm | Sync responses and limits (SD17, spec Size). | Pages of 50 (`limit` above 50 answers 400). Every sync request on the local side has a 10 s `AbortSignal.timeout`. Bodies stay under the 128 KB limit (one profile). | SD17. |
| PD22 · Confirm | Where the fake issuer and the cloud stand-ins live. | `server/test/fake-issuer.ts`: `node:http` on `127.0.0.1`, a generated RSA key, discovery, JWKS, an authorise endpoint that redirects straight back with a code for a subject the test sets (no page), a token endpoint (code + PKCE check, refresh grant, switches to fail refresh, issue expired tokens, sign with a second key, claim another issuer), CORS headers on discovery and token so the browser can call them, and an `email` claim so AC26's scan has one to look for. `tests/browser/` imports it as it imports `server/` today (`tests/browser/control-server.ts`). | The gate runs with no network and no real provider (spec Verification). |
| PD23 · Confirm | Deploy mechanics (SD7). | CI builds `web/dist` and a release tarball holding the root `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `pnpm-lock.yaml`, the `package.json` of each of the five workspace members (`shared`, `engine`, `audio`, `server`, `web`) so the frozen lockfile matches the workspace, and `shared/`, `server/`, `web/dist`, `infra/` (audit F2, 2026-11-17: without the workspace file and `.npmrc`, `--frozen-lockfile` fails on the VM) and pipes it over SSH to the deploy user, whose `authorized_keys` forces `infra/receive.sh`: it takes the release id from `SSH_ORIGINAL_COMMAND` (40 hex characters or refused), unpacks into `releases/<sha>/`, installs production dependencies there (`pnpm install --prod --frozen-lockfile`), and runs `node releases/<sha>/infra/deploy.ts`. `deploy.ts`: (1) backup with the same routine as the nightly one, into `backups/pre-<sha>.sqlite` and the bucket; (2) migrate with the new release's `migrate-cli.ts` while the old release runs; (3) switch `current` atomically (a temp link renamed over it); (4) restart; (5) poll `/api/health` for 30 s. A failure before (3) leaves the old release running and changes nothing; a failure at (4)/(5) switches back, restores `pre-<sha>.sqlite` with the service stopped and restarts the old release; every failure exits non-zero with one line naming the step. The last five releases stay on disk. `deploy.ts` takes paths and commands as arguments (`--root`, `--env-file`, `--restart`, `--health-url`); its child processes read the environment through `node --env-file=` and `config.ts`, so the config boundary holds. | The deploy user can do only this one command plus `sudo systemctl restart\|stop\|start djvisuals` (sudoers); the migration runs on the release that ships it. |
| PD24 · Confirm | Which runs deploy (AC29). | `deploy.yml`: `on: workflow_run` of the workflow named `CI`, `types: [completed]`, `branches: [main]`; the job runs only when `conclusion == 'success'` and `event == 'push'` (CI also runs weekly and by hand on `main`); it checks out `workflow_run.head_sha` and skips, green, when that is no longer `main`'s tip (a newer push will deploy); `concurrency: { group: deploy, cancel-in-progress: false }`; `permissions: contents: read`. Secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` and nothing else (the runbook lists the same four). **Not yet set up:** a job-level `if` cannot read a secret, so the first step maps `secrets.DEPLOY_HOST` into its own `env` and sets an output `enabled`; when it is empty the step writes one `::notice::` ("deploy not configured: DEPLOY_HOST is empty") and every later step carries `if: steps.configured.outputs.enabled == 'true'`, so the run ends green, not red, from T18's merge until H5 (audit F1, 2026-11-17). | Without the event guard, Monday's scheduled CI would redeploy; without the tip check an older green run could land after a newer one; without the configured check every merge before H5 shows a red deploy. |
| PD25 · Confirm | The backup routine (SD10, AC31). | `server/src/backup-cli.ts backup`: `VACUUM INTO` a temp file in `DATA_DIR/backups/`, open it, `PRAGMA integrity_check` must answer `ok`, upload as `djvisuals-<UTC timestamp>.sqlite` through Object Storage's S3-compatible API (SigV4 on `node:crypto`, path-style), list the prefix and delete all but the newest 14 by name. `restore --latest` downloads the newest and checks it, then replaces the database file (and removes `-wal`/`-shm`) only when the service is stopped — the runbook stops it first. `snapshot --to <file>` is the deploy's local copy plus upload. Settings `BACKUP_ENDPOINT`, `BACKUP_REGION`, `BACKUP_BUCKET`, `BACKUP_ACCESS_KEY_ID`, `BACKUP_SECRET_ACCESS_KEY`, all or none, in `config.ts`. | One routine for nightly and deploy (SD10); the S3 "customer secret key" is the "bucket key" of the spec's human steps. |
| PD26 · Confirm | The VM and Always Free (spec "Money"). | Ubuntu 24.04 on `VM.Standard.A1.Flex` (1 OCPU, 6 GB, Always Free up to 4 OCPU / 24 GB), or `VM.Standard.E2.1.Micro` when A1 has no capacity; one boot volume (≤ 200 GB free); one Object Storage bucket (Always Free 20 GB); no load balancer, no paid IP, no block volume. The owner checks each against Oracle's Always Free list in the console when creating it. `infra/rebuild.sh` runs on the VM and creates nothing in Oracle. | Nothing an agent runs can create a billable resource. |
| PD27 · Confirm | Logs (SD18). | pino JSON to stdout as today; the unit's journal is kept 14 days (`MaxRetentionSec=14day` in a journald drop-in). Sync logs `sync finished` with counts (pulled, pushed, conflicts) and `sync failed` with a kind; profile ids and revisions per write as today. | SD18. |
| PD28 · Confirm | The conflict-copy mark. | `profiles.conflict_copy` (0/1). `storedProfileSchema` gains optional `conflictCopy: true`, emitted only when set; a profile file export never carries it (`formatVersion` unchanged). Any update through `/api/profiles` (rename or save) clears it; the sync carries it to the other side. | Spec UI, Builder: "until renamed or saved once". |

## Files

| Path | Create/Modify | Purpose |
|---|---|---|
| `docs/adr/0003-hosting-on-oracle-synced-profiles.md` | Create | SD12 (T1) |
| `docs/adr/0001-setup-decision-record.md`, `docs/adr/README.md` | Modify | "Partly superseded by 0003" note; index (T1) |
| `server/src/config.ts` | Modify | `APP_MODE` and the cloud groups (T2); the backup group (T15) |
| `.env.example` | Modify | The new variables, documented (T2, T15) |
| `shared/src/index.ts` | Modify | Health `mode`, `cloud`, `signIn` (T2); exports of the sync and cloud shapes (T6, T7) |
| `server/src/health.ts`, `server/src/boot.ts` | Modify | Health fields (T2); store mode (T3); hosted branch (T5); sync routes (T6); cloud routes (T7); scheduler (T10) |
| `server/test/spawn-server.ts`, `tests/browser/control-server.ts`, `playwright.config.ts`, `scripts/under-load.ts` | Modify | `APP_MODE: "local"` in every hand-built env (T2) |
| `server/migrations/0003_sync.sql` | Create | Data changes (T3) |
| `server/src/db.ts` | Modify | A `transaction(fn)` helper over `BEGIN IMMEDIATE` (T3) |
| `server/src/profiles/store.ts` | Modify | Change counter, tombstones, conflict flag (T3); cloud-side sync reads and writes (T6); local-side apply and queue (T8) |
| `shared/src/profile-api.ts` | Modify | Optional `conflictCopy` (T3) |
| `server/src/auth/jwt.ts`, `server/src/auth/issuer.ts` | Create | JWS verification; discovery and JWKS cache (T4) |
| `server/test/fake-issuer.ts` | Create | The fake OIDC issuer (T4) |
| `server/src/auth/guard.ts` | Create | Bearer check, allowed subject, rate limit (T5) |
| `server/src/rate-window.ts` | Create | The per-address sliding window lifted out of the pairing throttle (T5, PD11) |
| `server/src/control/pairing.ts` | Modify | Uses `rate-window.ts`; behaviour unchanged (T5) |
| `server/src/app.ts` | Modify | `trustProxy` in hosted mode; path-only request logging (T5) |
| `shared/src/sync.ts` | Create | Sync request and answer shapes (T6) |
| `server/src/sync/routes.ts` | Create | `/api/sync/*` on the cloud (T6) |
| `shared/src/cloud.ts` | Create | Cloud status shape (T7, T10) |
| `server/src/cloud/session-store.ts` | Create | `DATA_DIR/cloud/session.json`: the only reader and writer (T7) |
| `server/src/cloud/signin.ts` | Create | Loopback PKCE, code exchange, refresh, the current ID token (T7) |
| `server/src/cloud/routes.ts` | Create | `/api/cloud/*` (T7; `sync` and the full status in T10) |
| `server/src/cloud/sync.ts` | Create | One sync run (T9) |
| `server/src/cloud/scheduler.ts` | Create | Triggers, pause, backoff (T10) |
| `server/src/control/hub.ts` | Modify | `onRunning` dependency (T10) |
| `server/src/profiles/routes.ts` | Modify | `onWrite` callback after each write (T10) |
| `web/src/auth/pkce.ts`, `web/src/auth/session.ts`, `web/src/auth/SignIn.tsx` | Create | Hosted sign-in (T11) |
| `web/src/main.tsx`, `web/src/health.ts` | Modify | Read mode before rendering; the sign-in gate (T11) |
| `web/src/profiles/api.ts`, `web/src/profiles/active.ts`, `web/src/builder/failure.ts` | Modify | Bearer, `signed_out` and `not_allowed` failures and their reasons (T12) |
| `web/src/Panel.tsx`, `web/src/Screen.tsx` | Modify | Hosted: no screen socket, no External control, "Sign in again" (T12); the cloud row (T13) |
| `web/src/cloud/CloudRow.tsx`, `web/src/cloud/api.ts` | Create | The panel's cloud row (T13) |
| `web/src/builder/ProfileList.tsx`, `web/src/builder/Builder.tsx` | Modify | "Conflict copy" mark and the n line (T13) |
| `tests/browser/hosted-server.ts` | Create | In-process hosted server + fake issuer for Playwright (T13, T14) |
| `server/src/backup/snapshot.ts`, `server/src/backup/bucket.ts`, `server/src/backup-cli.ts` | Create | The backup routine (T15) |
| `infra/deploy.ts`, `infra/receive.sh` | Create | Deploy and rollback (T16) |
| `tests/tsconfig.json` | Modify | Typecheck `infra/*.ts` (T16) |
| `infra/rebuild.sh`, `infra/Caddyfile`, `infra/systemd/djvisuals.service`, `infra/systemd/djvisuals-backup.service`, `infra/systemd/djvisuals-backup.timer`, `infra/journald-djvisuals.conf`, `infra/sudoers-djvisuals-deploy` | Create | The VM (T17) |
| `.github/workflows/deploy.yml` | Create | The deploy workflow (T18) |
| `docs/runbooks/deploy.md`, `rollback.md`, `restore.md`, `hosting.md`, `docs/runbooks/README.md` | Create / Modify | Rebuild, restore, provider setup, deploy key rotation; index (T19) |
| `docs/design/architecture.md`, `docs/invariants.md`, `docs/backlog.md` | Modify | Hosting, sync, auth sections; three invariant rows plus the hosted request row; B-12 status (T19) |

New test files: `server/src/auth/jwt.test.ts`, `server/src/auth/issuer.test.ts`,
`server/src/auth/guard.test.ts`, `server/src/rate-window.test.ts`, `server/test/hosted.int.test.ts`,
`server/test/sync-api.int.test.ts`, `server/src/cloud/session-store.test.ts`,
`server/src/cloud/signin.test.ts`, `tests/meta/cloud-boundary.test.ts`,
`server/test/cloud-connect.int.test.ts`, `server/test/sync.int.test.ts`,
`server/src/cloud/scheduler.test.ts`, `server/test/sync-schedule.int.test.ts`,
`server/test/cloud-proxy.ts` (a stand-in that holds, drops or answers 429/5xx between a local
install and the cloud), `server/test/secrets.int.test.ts`, `web/src/auth/pkce.test.ts`,
`web/src/auth/session.test.ts`, `web/src/profiles/api.test.ts` (or the existing one extended),
`tests/browser/cloud-panel.spec.ts`, `tests/browser/hosted.spec.ts`,
`server/src/backup/snapshot.test.ts`, `server/src/backup/bucket.test.ts`,
`server/test/backup.int.test.ts`, `infra/deploy.int.test.ts`, `tests/workflow/test_infra.py`,
`tests/workflow/test_deploy_workflow.py`.

Existing tests and texts this change makes untrue:

- `server/src/config.test.ts:26-33` ("accepts all five variables"), `:35` (`it.each` over five
  names), `:120-126` (the exact list of five) — T2.
- `loadConfig({...})` literals: `server/test/control-device.int.test.ts:65`,
  `control-lan.int.test.ts:63`, `control-screen.int.test.ts:180`, `control-sender.int.test.ts:66`,
  `control-tls.int.test.ts:37`, `tests/browser/control-server.ts:98-104`,
  `scripts/under-load.ts:75`, `playwright.config.ts:54-60`, and `server/test/spawn-server.ts:128-140`
  (`baseEnv`) gain `APP_MODE: "local"` — T2. `server/test/boot.int.test.ts` is **not** edited (AC27).
- `.env.example:1-9` ("All five variables are required") — T2.
- `server/test/health.int.test.ts:43` (`schemaVersion` 2 → 3; `:57` uses its own migrations folder
  and stays) — T3.
- `server/test/migrate.int.test.ts:81,83,127,131,133,165` (the real folder's version and file
  list) — T3; the builder edits only the lines that name the real folder.
- `web/src/profiles/api.ts:87` maps 401/403 to `unusable` — T12 (a unit test of the new kinds).
- `docs/design/architecture.md:457-460` ("the restore plan is to delete the file"), `:482-485`
  (Auth: none) — T19.
- `docs/runbooks/README.md:9-12` lists `deploy.md`, `rollback.md`, `restore.md`, `incident.md`, none
  of which exists — T19 writes the first three and marks `incident.md` as not written.
- ADR 0001 §7 rows "Cloud hosting", "Hosted database", "Bought auth", "Application Insights" — T1
  (superseded note; the rows stay as history).

## Tasks

Each task is one vertical slice that leaves the system working, reviewable in one sitting:
about ≤400 changed source lines (tests do not count) across ≤10 files.

### T1 — ADR 0003: hosting on Oracle Cloud, profiles synced from local installs
- **Implements:** SD12
- **Expected output:** `docs/adr/0003-hosting-on-oracle-synced-profiles.md` in the ADR template
  (`docs/adr/0000-template.md`): Status "Accepted (by the approval of the B-12 spec)"; context
  (ADR 0001 §8's single point of failure, §7's Azure deferral); decision (SD1, SD6, SD7, SD10,
  SD11; supersedes 0001 §7's rows for hosting, hosted database, auth and observability; amends Q2
  so "nothing at a gig needs venue internet" holds for the local install); alternatives (Azure
  Container Apps as in 0001 §7, a hosted database instead of synced SQLite, hosted-only with no
  local install); consequences with what enforces each (the `127.0.0.1` row, the three new
  invariant rows). ADR 0001 gains "Partly superseded by 0003" beside its existing 0002 note;
  `docs/adr/README.md` lists 0003. Docs only.
- **Verification:** `python scripts/check_plans.py` (unchanged green); the owner reads the ADR at
  review (Markdown is not format-checked, `.prettierignore`).
- **Depends on:** —
- **Autonomy note:** wording is the builder's within the spec's SD list; it must not add a
  decision the spec does not make. Any change of meaning in ADR 0001 beyond the superseded note is
  an owner stop.

### T2 — Configuration: `APP_MODE`, the cloud settings, and `mode` on the health answer
- **Implements:** SD14, AC19, AC27
- **Expected output:** `loadConfig` validates PD5's rules and returns `APP_MODE` plus the optional
  groups typed (`cloud: { url, issuer, clientId } | null` in local, `signIn: { issuer, clientId,
  allowedSubject }` in hosted, or the builder's equivalent shape); every problem names a variable,
  never a value. `/api/health` answers `mode`, `cloud` and `signIn` (PD8);
  `healthResponseSchema` gains the three fields. Every hand-built env listed under Files gains
  `APP_MODE: "local"`; `.env.example` documents all new variables, saying `ALLOWED_SUBJECT` and
  the issuer settings belong in the VM's env file, never in the repository. A local install
  configured as before plus `APP_MODE=local` behaves exactly as before. About 120 source lines.
- **Verification:** `pnpm run test --project unit server/src/config.test.ts` (hosted without each
  of its three; local with one or two of the three cloud settings; `CLOUD_URL` in hosted;
  `ALLOWED_SUBJECT` in local; `http://example.com` refused, `http://127.0.0.1:9` accepted; no
  problem string contains a value) and `pnpm run test --project integration server/test/boot.int.test.ts server/test/health.int.test.ts`
  (`boot.int.test.ts` unedited; health answers `mode: "local"`, `cloud: false`, `signIn: null`).
- **Depends on:** —
- **Autonomy note:** variable names are fixed by PD5 and PD25; the typed shape is the builder's.
  AC19 is read as PD6 records: an earlier test may gain `APP_MODE: "local"` in an env literal
  and nothing else. Stop if any earlier test other than those listed under "Existing tests and
  texts this change makes untrue" needs an edit to pass, or if any earlier assertion must change.

### T3 — Migration `0003`: change counter, tombstones and the conflict flag on every write
- **Implements:** AC8, AC16, SD8
- **Expected output:** `server/migrations/0003_sync.sql` as in Data changes. `Db.transaction(fn)`
  wraps `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` (and `importAll` uses it). `createProfileStore` takes
  `{ mode }`; `create`, `update`, `remove` and `importAll` each run in one transaction that bumps
  `app_meta.change_counter` and stamps `change_seq`; `remove` writes the tombstone of PD14 in the
  same transaction; `update` clears `conflict_copy`; `fromRow` emits `conflictCopy: true` when set.
  Rows from before `0003` read and save as before; on a local install they count as unsynced
  (`cloud_revision IS NULL`). About 110 source lines.
- **Verification:** `pnpm run test --project unit server/src/profiles/store.test.ts` (every write
  raises the counter by one and stamps the row; a hosted delete writes a tombstone with the row's
  revision; a local delete writes one only when `cloud_revision` is set; a delete whose tombstone
  insert throws leaves the row in place; update clears the flag; the existing cases unchanged) and
  `pnpm run test --project integration server/test/migrate.int.test.ts server/test/health.int.test.ts`
  (version 3; a database migrated from `0002` with two rows keeps them, `change_seq` 1 and 2).
- **Depends on:** T2
- **Autonomy note:** column names are fixed by Data changes; helper names are the builder's. Never
  edit `0001` or `0002` (the guard blocks it). Stop if `node:sqlite` refuses `ALTER TABLE … ADD
  COLUMN` with a default as written.

### T4 — Token verification on `node:crypto`, and the fake issuer
- **Implements:** AC3, SD3
- **Expected output:** `verifyIdToken(token, { issuer, clientId, keys, now })` in
  `server/src/auth/jwt.ts` returns `{ ok: true, subject }` or `{ ok: false, reason }` with reason
  one of `malformed`, `alg`, `key`, `signature`, `issuer`, `audience`, `expired`, `not_yet` (PD7);
  RS256 through `createPublicKey({ key: jwk, format: "jwk" })` and `crypto.verify`, ES256 with
  `dsaEncoding: "ieee-p1363"`. `createIssuer({ url, fetch, now, log })` in
  `server/src/auth/issuer.ts` reads discovery (its `issuer` must equal the configured one), keeps
  the JWKS, refetches at most once a minute on an unknown `kid`, and exposes the token and
  authorise endpoints for T7 and T11's use. `server/test/fake-issuer.ts` as PD22. No log line
  carries a token or a subject. About 180 source lines.
- **Verification:** `pnpm run test --project unit server/src/auth/jwt.test.ts server/src/auth/issuer.test.ts`
  (a token from the fake issuer verifies; expired by 61 s, `nbf` 61 s ahead, signed with the
  second key, `iss` of another issuer, `aud` of another client, `alg: none`, `alg: HS256` with the
  public key as secret, a flipped signature byte and three-part garbage each give their reason;
  an unknown `kid` refetches once, a second unknown `kid` within a minute does not).
- **Depends on:** —
- **Autonomy note:** the claim checks are fixed by PD7. Stop if `node:crypto` cannot verify a
  token the fake issuer signs the way Entra or Clerk do (SD3: a dependency question for the owner).

### T5 — Hosted mode: the guard, the allowed subject, and nothing of External control
- **Implements:** AC1, AC2, AC3, AC4, AC27, SD4, SD5, SD6, SD17
- **Expected output:** `boot()` branches on `APP_MODE`. Hosted: PD10 (no certificate store, hub,
  LAN listener or screen socket; upgrades answer 404), `trustProxy: "127.0.0.1"`, and
  `server/src/auth/guard.ts` as an `onRequest` hook on `/api/profiles*` and `/api/sync/*`: no or a
  malformed `Authorization: Bearer` → 401 `{error:"unauthorized"}`; a token failing T4 → 401; a
  valid token of another subject → 403 `{error:"forbidden"}` and `log.info({ outcome: "forbidden" })`
  with no subject; PD11's 429, counted by `server/src/rate-window.ts`, the window lifted out of
  `pairing.ts` (PD11), which the pairing throttle now uses too with its limits unchanged
  (`PAIRING_LIMITS`). `/api/health` and the page shell stay open. Both modes: request lines log
  the path without its query (PD12). Local boot is unchanged. About 180 source lines.
- **Verification:** `pnpm run test --project unit server/src/rate-window.test.ts server/src/auth/guard.test.ts server/src/control/pairing.test.ts`
  (the window: `limit` records within `windowMs` block for `blockMs`, an older record falls out,
  the block ends on time, keys are independent; the guard: the 11th rejection within 60 s from
  one address is 429 for 60 s, another address is unaffected, a valid token during the block is
  still 429; `pairing.test.ts` unedited and green) and `pnpm run test --project integration server/test/hosted.int.test.ts server/test/boot.int.test.ts`
  (a hosted child process with the fake issuer: GET/POST/PUT/DELETE on `/api/profiles`,
  `/api/profiles/:id`, `/api/profiles/import` without a token, with an expired one, one of another
  key and one of another issuer each 401, and the profile count unchanged; another subject 403 and
  no log line holds its subject; the allowed subject 200; `/control`, `/send`, `/trust`,
  `/api/control/screen` (HTTP and upgrade) 404; `DATA_DIR/tls` absent after boot; the `listening`
  line's address `127.0.0.1`; no response carries `access-control-allow-origin`; a request with
  `?code=x` logs no `x`. `boot.int.test.ts` unedited and green).
- **Depends on:** T3, T4
- **Autonomy note:** status bodies are the builder's within the existing `{error}` shape. Stop if
  not building the hub breaks a local-mode test (the branch must leave local boot byte-for-byte
  the same in behaviour). Stop if lifting the window out of `pairing.ts` needs any edit to
  `pairing.test.ts` or changes a pairing refusal (B-06 SD19).

### T6 — The cloud's sync endpoints
- **Implements:** AC11, AC12, AC13, AC15, AC18, SD8, SD9, SD17
- **Expected output:** `shared/src/sync.ts` with the shapes of the spec's API contract (a change is
  `{ kind: "profile", profile, conflictCopy? }` or `{ kind: "tombstone", id, revision }`, each with
  its counter); `server/src/sync/routes.ts` registers `GET /api/sync/changes`, `PUT
  /api/sync/profiles/:id`, `DELETE /api/sync/profiles/:id`, `GET /api/sync/full` in hosted mode
  only, behind T5's guard, every body validated before use; the store gains `changesSince(cursor,
  limit)`, `fullPage(after, limit)`, `syncPut(id, profile, baseRevision, conflictCopy)`,
  `syncDelete(id, baseRevision)` and `purgeTombstones(olderThan)` with PD17's rules, each one
  transaction. A cloud profile the schema rejects is left out of the feed with one `warn` by id
  (spec Edge cases). About 260 source lines.
- **Verification:** `pnpm run test --project unit server/src/profiles/store.test.ts` (PD17's table
  case by case: equal base updates; stale base 409 with current; delete at the current revision
  tombstones; delete after an edit returns `current`; a repeat delete `{deleted:true}`; a put on a
  tombstoned id restores the same id with the machine's edit; another id's name gives "Name (2)";
  tombstones older than 90 days by an injected clock are purged and `purged_through` set;
  `changesSince` returns 50 and `more`) and `pnpm run test --project integration server/test/sync-api.int.test.ts`
  (each endpoint over HTTP with the fake issuer; 401 and 403 as AC1/AC2; a cursor below
  `purged_through` answers `reset: true`; `limit=51` 400; a hosted `/api/profiles` edit appears in
  the feed).
- **Depends on:** T5
- **Autonomy note:** the paging key of `/api/sync/full` is the builder's. Stop if a rule of PD17
  turns out to lose a profile in any case the test table covers.

### T7 — Connecting a local install: loopback sign-in and the session file
- **Implements:** AC24, AC25, AC26, SD15
- **Expected output:** in local mode with cloud settings only, `/api/cloud/status`, `POST
  /api/cloud/connect`, `GET /api/cloud/callback`, `POST /api/cloud/disconnect` (PD20), on
  `127.0.0.1` as everything else; without cloud settings they do not exist (404).
  `server/src/cloud/session-store.ts` is the only module that names `session.json`;
  `server/src/cloud/signin.ts` holds the pending attempt, exchanges the code, renews the ID token
  (and reports `signed_out` on `invalid_grant`), and never logs or returns a token or code. The
  callback answers PD4's two pages (plain HTML, no script). `tests/meta/cloud-boundary.test.ts`:
  `git check-ignore data/cloud/session.json` succeeds and only `session-store.ts` in `server/src`
  names `session.json`. About 260 source lines.
- **Verification:** `pnpm run test --project unit server/src/cloud/session-store.test.ts server/src/cloud/signin.test.ts tests/meta/cloud-boundary.test.ts`
  (write, read, revoke, delete; a torn temp file never replaces a good one; mode `0o600` asserted
  on POSIX only, as B-06 T3; a wrong `state`, an expired attempt and a second callback each fail)
  and `pnpm run test --project integration server/test/cloud-connect.int.test.ts` (a local server
  and the fake issuer: connect → follow the authorise redirect → callback page "Connected…",
  `session.json` exists, status `connected`; disconnect deletes it and leaves every profile; the
  fake issuer refusing refresh gives `signed_out`, still after a restart; no log line or response
  holds the code, the refresh token or the ID token).
- **Depends on:** T6
- **Autonomy note:** the callback page's markup is the builder's; its texts are PD4's. Stop if the
  loopback redirect needs anything but `127.0.0.1:PORT` (the invariant row).

### T8 — The local side of sync in the store: queue, apply, conflicts
- **Implements:** AC11, AC13, AC14, AC15, AC16, AC18
- **Expected output:** the store gains, for local mode: `pending()` (unsynced rows and local
  tombstones in `change_seq` order, AC7's order), `applyPull(changes, cursor)` and
  `applyFull(profiles, cursor)` (each one transaction, PD16's rules and PD2's reading for full),
  `acknowledgePut(id, sentSeq, cloudProfile)`, `acknowledgeDelete(id, current | null)`,
  `conflict(id, cloudProfile)` (the copy plus the overwrite, one transaction), `cursor()` and
  `conflictCount()`. Nothing here makes a request. About 230 source lines.
- **Verification:** `pnpm run test --project unit server/src/profiles/store.test.ts` (each PD16 row
  as a case; a cloud name swap of two synced rows applies with no copy and no unsynced row; an
  unsynced local "X" against a cloud "X" of another id becomes "X (2)"; an unsynced edit against a
  newer cloud revision gives the copy "X (2)" marked, unsynced, and the row equal to the cloud's;
  an unsynced edit against a cloud tombstone stays; a pull that throws half-way leaves rows and
  cursor as before; an acknowledgement after a newer local write leaves the row unsynced;
  `applyFull` turns every unsynced row into a copy and removes synced rows the cloud lacks).
- **Depends on:** T6
- **Autonomy note:** method names are the builder's; the rules are PD2 and PD16. Stop on any case
  where the rules as written lose a definition — that is a spec question.

### T9 — One sync run between a local install and the cloud
- **Implements:** AC5, AC11, AC12, AC13, AC14, AC15, AC16, AC18
- **Expected output:** `runSync({ store, signin, cloudUrl, fetch, log })` in
  `server/src/cloud/sync.ts`: pull per PD16 (pages, `reset` → full), then push `pending()` one
  request each with a 10 s timeout, handling every answer of PD16; a 401 renews once through
  `signin` and retries once, then reports `signed_out`; a timeout, refused connection, 429 or 5xx
  ends the run as `offline` with the queue intact; logs `sync finished` or `sync failed` per PD27.
  Returns `{ outcome, pulled, pushed, conflicts }`. Nothing schedules it yet: `POST
  /api/cloud/sync` (T10) is not there, the int test calls an internal hook. About 200 source lines.
- **Verification:** `pnpm run test --project integration server/test/sync.int.test.ts` (in
  process: a hosted cloud, the fake issuer and two local installs A and B, each its own
  `DATA_DIR`; spec Verification steps 1 and 2: A connects, makes three, syncs, B connects and holds
  the same three ids, names and definitions, both cursors advanced (AC5); an edit on A and on B of
  one profile gives the cloud's under the name and a "Name (2)" copy on both after both sync twice
  (AC14); a delete on A syncs to B (AC11); a delete on A after B's pushed edit is refused and A gets
  B's version back (AC12); an edit on B of a profile A deleted restores it on the cloud with the
  same id (AC13); A and B each with their own "Set" end with "Set" and "Set (2)" on all three
  (AC15); the cloud clock moved 91 days: B's cursor resets, B pulls the full set and keeps its
  unsynced edit as a copy (AC18); a run whose push is cut by `cloud-proxy` after one of three
  requests leaves no partial row, and the next run completes (AC16)).
- **Depends on:** T7, T8
- **Autonomy note:** how the int test injects the cloud's clock (a `now` in `BootPaths` or the
  store) is the builder's. Stop if a run needs more than one request with nothing to move (spec
  Size).

### T10 — When sync runs: boot, after writes, retries, the set pause and "Sync now"
- **Implements:** AC6, AC7, AC8, AC9, AC10, AC16, AC17, AC19, AC24, SD2
- **Expected output:** `server/src/cloud/scheduler.ts` (PD19) with injected timers; the hub's
  `onRunning`; `registerProfiles` takes `onWrite` and calls it after each successful write; `POST
  /api/cloud/sync` (409 `{error:"paused"}` while running, otherwise the run's status); the full
  status of PD18 (`offline` after a failed run until a good one, `paused` while running,
  `lastSyncAt`, `conflicts`); a run after connect (AC24); `close()` cancels timers and waits for a
  run in flight to end its current request. A local install without cloud settings builds no
  scheduler and has no `/api/cloud/*`. About 220 source lines.
- **Verification:** `pnpm run test --project unit server/src/cloud/scheduler.test.ts` (fake
  timers: a write runs within 2 s (AC6); three failures retry at 5, 10, 20 s and cap at 300 s, a
  success resets (AC17); `onRunning(true)` during a run lets the current request finish and makes
  no other; while running, "Sync now" is refused and no timer fires a run (AC9, AC10); false runs
  at once; a trigger during a run gives exactly one more run) and `pnpm run test --project integration server/test/sync-schedule.int.test.ts`
  (child processes: with the cloud down, A saves and deletes, status `offline`, A is killed and
  restarted, the cloud comes back, the next retry pushes both in order (AC7, AC8, AC17); a screen
  socket on A reporting `started: true` makes `cloud-proxy` see no request from A over 30 s while
  A saves, "Sync now" answers 409, `started: false` gives a run within 10 s, and so does closing
  the socket (AC9, AC10); `cloud-proxy` holding A's requests past 10 s leaves A's `/api/profiles`
  answering under 1 s (AC17); A killed mid-push and restarted completes (AC16); a local install
  with no cloud settings answers 404 on `/api/cloud/status` and `cloud-proxy`, given as its only
  route out, sees nothing (AC19)).
- **Depends on:** T9
- **Autonomy note:** the 2 s debounce and the 30 s observation are the builder's to tune within
  AC6's and AC9's 10 s. Stop if the hub's callback changes any message a device or screen receives
  (`docs/invariants.md:30`).

### T11 — Hosted sign-in in the browser
- **Implements:** AC20, SD16
- **Expected output:** `web/src/health.ts` gains `readHealth()` returning `mode`, `cloud`,
  `signIn` (the overlay's `checkHealth` unchanged). `web/src/auth/pkce.ts` (verifier, S256
  challenge on `crypto.subtle`, `state`). `web/src/auth/session.ts` (PD1, PD9: discovery, the
  redirect, the exchange, tokens in memory, `token()` with on-demand renewal, `signedOut`
  subscription; `sessionStorage` holds only the verifier, `state`, the return path and the
  `djv.signedIn` marker; nothing in `localStorage`). `web/src/auth/SignIn.tsx`: "Sign in",
  redirecting, "Sign-in failed — try again", "This account has no access", inside its own scroll
  container (`web/index.html` hides overflow). `web/src/main.tsx`: local → today's four routes;
  hosted → the gate, then `Screen` at `/` or `Builder` at `/builder`, `/control` and `/send`
  render nothing but the sign-in page's "External control needs the local install". About 280
  source lines.
- **Verification:** `pnpm run test --project unit web/src/auth/pkce.test.ts web/src/auth/session.test.ts`
  (the RFC 7636 appendix B verifier gives its challenge; a fake fetch and fake storage: a return
  with a wrong `state` fails; a good one keeps tokens in memory only (storage holds no token after
  every step); a token 30 s from `exp` renews before use; a failed renewal fires `signedOut` once;
  a tab with the marker redirects without a click).
- **Depends on:** T2
- **Autonomy note:** module split inside `web/src/auth/` is the builder's; the texts are the
  spec's and PD4's. Stop if the provider flow needs a client secret in the browser (it must not).

### T12 — Hosted use: bearer on every profile request, no External control, "Sign in again"
- **Implements:** AC21, AC22, AC23, SD1
- **Expected output:** `call()` in `web/src/profiles/api.ts` adds `Authorization` from
  `session.token()` in hosted mode on every method (`:52-54` sets headers only with a body today);
  a 401 after one renewal is `signed_out`, a 403 `not_allowed` (`Failure` union); `active.ts` and
  `builder/failure.ts` give PD4's reasons. `Screen.tsx` in hosted mode never starts the screen
  link (`:223-226`), so no `/api/control/screen` request and no remote input; `Panel.tsx` takes the
  mode and in hosted shows no External control block, the line "External control needs the local
  install", and "Sign in again" while signed out. The builder's stale-revision flow is unchanged
  and works with the bearer (AC22). Local mode sends no header and behaves as today. About 120
  source lines.
- **Verification:** `pnpm run test --project unit web/src/profiles/api.test.ts` (hosted: GET and
  DELETE carry the header; 401 renews once and retries once; then `signed_out`; 403
  `not_allowed`; local: no header on any request) and `pnpm test:browser tests/browser/panel.spec.ts tests/browser/live.spec.ts tests/browser/control-panel.spec.ts`
  (local mode unchanged, the running-set request list included).
- **Depends on:** T11
- **Autonomy note:** where the mode prop enters `Panel` is the builder's. Stop if hiding External
  control needs a change to `ExternalControl.tsx`'s behaviour in local mode.

### T13 — The panel's cloud row and the builder's conflict copies
- **Implements:** AC7, AC10, AC14, AC19, AC24, AC25, SD13
- **Expected output:** `web/src/cloud/CloudRow.tsx` (spec UI: Not connected + "Connect to
  cloud" opening the provider in a new tab; Connected + "Last synced HH:MM" + "Sync now";
  "Syncing…"; "Offline — changes will sync"; "A set is running — sync resumes when it stops" as the
  Paused line and as the refusal of "Sync now"; "Sign in again"; "n conflicts kept as copies"
  linking to `/builder`; "Disconnect from cloud" behind a confirm) with `web/src/cloud/api.ts`
  (PD18; status on panel open, on focus after connect, and as each action's answer); rendered only
  when health says `cloud: true`; nothing in it wider than the panel (D-05). `ProfileList.tsx`
  marks a row "Conflict copy" when `conflictCopy`; `Builder.tsx` shows "n conflicts kept as
  copies" above the list while n > 0 (PD3), in both modes. `tests/browser/hosted-server.ts` boots
  the in-process hosted cloud and the fake issuer for Playwright, as `control-server.ts` does.
  About 230 source lines.
- **Verification:** `pnpm test:browser tests/browser/cloud-panel.spec.ts tests/browser/builder.spec.ts`
  (an in-process local server with cloud settings against `hosted-server.ts`: connect through the
  fake issuer, status Connected; "Sync now" while a screen socket reports `started: true` shows
  the refusal text and makes no cloud request; the cloud stopped and a save gives "Offline —
  changes will sync" on the next open; a forced conflict shows "1 conflicts kept as copies" and the
  builder row "Conflict copy", gone after a rename; refresh refused gives "Sign in again";
  Disconnect after the confirm leaves every profile; the gate's own server (no cloud settings)
  shows no cloud row and makes no `/api/cloud` request; the panel never scrolls sideways).
- **Depends on:** T10, T12
- **Autonomy note:** layout inside the row is the builder's within the 400 px panel. "1 conflicts"
  is the spec's phrase; a singular form is an owner question, not the builder's.

### T14 — Hosted end to end, and the AC26 scans
- **Implements:** AC2, AC20, AC21, AC22, AC23, AC26
- **Expected output:** `tests/browser/hosted.spec.ts` against `hosted-server.ts` with pino lines
  captured in process and the console watched as `remote-e2e.spec.ts:59-109` does: the sign-in
  page, sign-in as the allowed subject, the screen with the cloud's profiles, `/builder` against
  the cloud (AC20); another subject gets "This account has no access" and its requests 403 (AC2);
  no External control switch, QR codes or senders list, and the line (AC21); a stale save offers
  "Reload theirs / Save mine as a copy" and changes nothing until chosen (AC22); with a running
  capture, the fake issuer refusing renewal and the token expired, the canvas keeps changing, a
  profile pick fails with PD4's reason and the panel shows "Sign in again" (AC23); every request of
  the run after Start is on the running-set list, the provider only on a user action.
  `server/test/secrets.int.test.ts`: a scripted local connect, sync, conflict and disconnect
  against the in-process cloud. Both scan every log line, console message and response body read
  for the ID tokens, refresh tokens, code, subject and email collected during the run, and logs
  and console for a definition's marker string (AC26, PD13). Tests only, plus fixes a failing
  scan proves.
- **Verification:** `pnpm test:browser tests/browser/hosted.spec.ts` and `pnpm run test --project integration server/test/secrets.int.test.ts`
  (each collected secret is checked to be non-empty and of its shape before the scan, as
  `remote-e2e.spec.ts:395-422` does, so an empty list cannot pass).
- **Depends on:** T13
- **Autonomy note:** test structure is the builder's. A source fix a scan forces stays within the
  module that leaked; stop if it changes what a user sees.

### T15 — The backup routine: a consistent copy, uploaded, the last 14 kept
- **Implements:** AC31, SD10
- **Expected output:** `server/src/backup/snapshot.ts` (`VACUUM INTO`, reopen, `integrity_check`),
  `server/src/backup/bucket.ts` (SigV4 `PUT`, `GET`, `DELETE` and `ListObjectsV2` with prefix,
  path-style, 10 s timeout, the secret never logged), `server/src/backup-cli.ts` (`backup`,
  `snapshot --to`, `restore --latest`, PD25), the `BACKUP_*` group in `config.ts` and
  `.env.example`. Exit 0 with one `backup written` line (object name, bytes) or exit 1 with one
  line naming the failed step. About 260 source lines.
- **Verification:** `pnpm run test --project unit server/src/backup/snapshot.test.ts server/src/backup/bucket.test.ts server/src/config.test.ts`
  (the AWS SigV4 documented example request signs to its documented signature; a copy taken while
  another connection writes opens and checks `ok`; a truncated copy fails `integrity_check`; the
  backup group all-or-none) and `pnpm run test --project integration server/test/backup.int.test.ts`
  (an in-process fake bucket that checks the signature: sixteen runs leave the newest fourteen;
  `restore --latest` brings back the profiles of the newest; an upload refused 403 exits 1 and
  deletes nothing; no line holds the secret key).
- **Depends on:** T2, T3
- **Autonomy note:** object naming beyond PD25 and the XML reading of the list answer are the
  builder's (no XML dependency; the answer's `<Key>` elements only). Stop if Oracle's S3
  compatibility needs anything SigV4 path-style does not cover — check the Oracle documentation and
  record it.

### T16 — Deploy and rollback on the VM, tested on a stand-in
- **Implements:** AC28, AC30, SD7
- **Expected output:** `infra/deploy.ts` as PD23: a `deploy(steps, paths)` function and a CLI
  over it; `infra/receive.sh` (the forced command: validates the id, unpacks stdin, installs, runs
  `deploy.ts`; `set -euo pipefail`); `tests/tsconfig.json` includes `../infra/*.ts`. The release
  root holds `releases/`, `current`, `backups/`, and the last five releases. About 220 source
  lines.
- **Verification:** `pnpm run test --project integration infra/deploy.int.test.ts` (a temp root
  with releases "old" and "new", a real SQLite file and the real `migrate-cli.ts`, and a stand-in
  service: an in-test HTTP server whose `/api/health` answers per a marker file in the release
  `current` points to, restarted by an injected function. Good new → `current` is new, old still on
  disk (AC28); new whose health fails → `current` back on old, the database byte-equal to
  `pre-<sha>.sqlite`, exit non-zero naming `health` (AC28); a new migration that fails → `current`
  never moved, the service never restarted, `pre-<sha>.sqlite` written before the migration ran
  (AC30); a sixth release prunes the oldest). `python -m unittest tests/workflow/test_infra.py`
  runs `bash -n infra/receive.sh` and checks it refuses an id that is not 40 hex characters (Git
  Bash on Windows as `test_guard_paths.py:205-216` does, skipped without it).
- **Depends on:** T15
- **Autonomy note:** the switch uses `symlinkSync(target, tmp, "junction")` then `renameSync`;
  stop if renaming over a junction is not atomic enough on Windows for the test to observe — the
  test may assert the result only, and the VM is Linux. Stop if the release needs anything not in
  `pnpm-lock.yaml` to run.

### T17 — The VM: rebuild script, Caddy, systemd units, backup timer, log retention
- **Implements:** AC32, SD6, SD11, SD18
- **Expected output:** `infra/rebuild.sh` (run as root on a fresh Ubuntu 24.04: Node 24 from
  NodeSource, pnpm through corepack, Caddy from its apt repository, users `djvisuals` (service) and
  `deploy` (forced command only), `/srv/djvisuals/{releases,backups}`, `/etc/djvisuals/env`
  (`0640`, created empty with the variable names for the owner to fill), the systemd units, the
  journald drop-in, the sudoers file validated with `visudo -c`, `ufw` allowing 22, 80, 443;
  idempotent; it prints the next manual step). `infra/Caddyfile` (the domain from one variable,
  `reverse_proxy 127.0.0.1:{PORT}`, nothing else). `djvisuals.service` (`User=djvisuals`,
  `EnvironmentFile=/etc/djvisuals/env`, `ExecStart=/usr/bin/node /srv/djvisuals/current/server/src/main.ts`,
  `Restart=on-failure`), `djvisuals-backup.service` + `.timer` (daily 03:00 UTC, `Persistent=true`),
  `journald-djvisuals.conf` (`MaxRetentionSec=14day`), `sudoers-djvisuals-deploy` (restart, stop,
  start of `djvisuals` only). About 200 lines of shell and config.
- **Verification:** `python -m unittest tests/workflow/test_infra.py` (Caddy proxies only to
  `127.0.0.1`; the unit's `ExecStart` runs `current/server/src/main.ts` and sets no `Environment=`
  value; the timer is daily; retention 14 days; sudoers names only `systemctl
  restart|stop|start djvisuals`; `bash -n` on `rebuild.sh`; no file in `infra/` matches a
  key-shaped pattern). AC32 itself is H9.
- **Depends on:** T16
- **Autonomy note:** package sources and the order of steps are the builder's. Stop if anything
  must be created in Oracle (an agent never does), or if a step needs a credential.

### T18 — The deploy workflow
- **Implements:** AC29, SD7
- **Expected output:** `.github/workflows/deploy.yml` as PD24: first the "configured" step (an
  empty `DEPLOY_HOST` ends the run green with one notice, every later step skipped); then builds
  `web/dist` on the gated commit, packs the release with PD23's exact file list, writes the key
  and known hosts from secrets into a `0600` file, pipes the tarball with
  `ssh -o StrictHostKeyChecking=yes $DEPLOY_USER@$DEPLOY_HOST <sha>`, and fails the job when the
  remote exits non-zero. Prettier-clean (it is format-checked).
- **Verification:** `python -m unittest tests/workflow/test_deploy_workflow.py` (line-based, no
  YAML library: triggered only by `workflow_run` on `CI` `completed` for `main`; the job's `if`
  needs `success` and `push`; checkout of `head_sha`; the tip check present; `concurrency` group
  `deploy` with `cancel-in-progress: false`; `permissions` only `contents: read`; the set of
  `secrets.*` names equals the four of PD24; the first step is the configured check and every
  later step carries its `if`; the pack step names `pnpm-workspace.yaml`, `.npmrc`,
  `pnpm-lock.yaml` and the five members' `package.json`; a planted file breaking each rule fails,
  as `test_gate_steps.py` self-checks) and `pnpm format:check`.
- **Depends on:** T16, T17
- **Autonomy note:** step layout is the builder's. Verify `workflow_run`'s `branches`, `event` and
  `head_sha` semantics against GitHub's current documentation and cite it in the commit; stop if
  they differ from PD24's assumptions.

### T19 — Runbooks, architecture, invariants and bookkeeping
- **Implements:** AC32, SD11, SD18
- **Expected output:** `docs/runbooks/hosting.md` (first-time provider setup with the three
  redirect URIs and refresh tokens on; the Oracle resources of PD26 and how to confirm each is
  Always Free; the VM env file; running `rebuild.sh`; the uptime monitor; rotating the deploy key);
  `deploy.md` and `rollback.md` (what the workflow does, reading a failed deploy, a manual
  rollback); `restore.md` (stop, `restore --latest`, start, check `/api/health` and the profiles;
  rebuilding a reclaimed VM); `docs/runbooks/README.md` index fixed. `docs/design/architecture.md`:
  hosting, sync, auth, the backup that replaces "delete the file", configuration's new variables.
  `docs/invariants.md`: the spec's three rows, each with its enforcing test (`hosted.int.test.ts`;
  `hosted.spec.ts` and `secrets.int.test.ts`; `cloud-boundary.test.ts`), and a B-12 row: in hosted
  use a running set makes the same requests plus the provider's token endpoint only on a user
  action (`hosted.spec.ts`); and the first **guarded area**: `server/src/auth/` (the bearer check,
  the allowed subject, the rate limit), extra check `hosted.int.test.ts` plus `guard.test.ts`,
  guardian `invariant-guardian`, why "the permission matrix of the only internet-facing server"
  (the audit's recommendation, 2026-11-17). `docs/backlog.md`: B-12 status. Docs only.
- **Verification:** `python scripts/check_plans.py` and `bash scripts/check.sh` at the stack's tip;
  the owner reads `architecture.md` and `invariants.md` (both owner stops, CLAUDE.md).
- **Depends on:** T1, T14, T18
- **Autonomy note:** the architecture and invariants edits, the guarded-area row included, are
  drafted for the owner's approval at review, not final. Filling in
  `.claude/agents/invariant-guardian.md`'s contract for `server/src/auth/` is part of that draft.

## Task graph

| Group | Tasks | Files they touch |
|---|---|---|
| 1 | T1, T2, T4 | T1: `docs/adr/*` · T2: `server/src/config.ts`, `.env.example`, `shared/src/index.ts`, `server/src/health.ts`, `server/src/boot.ts`, the hand-built envs · T4: `server/src/auth/jwt.ts`, `issuer.ts`, `server/test/fake-issuer.ts` |
| 2 | T3, T11 | T3: `server/migrations/0003_sync.sql`, `server/src/db.ts`, `server/src/profiles/store.ts`, `shared/src/profile-api.ts`, `server/src/boot.ts` · T11: `web/src/auth/*`, `web/src/main.tsx`, `web/src/health.ts` |
| 3 | T5, T12, T15 | T5: `server/src/auth/guard.ts`, `server/src/rate-window.ts`, `server/src/control/pairing.ts`, `server/src/app.ts`, `server/src/boot.ts` · T12: `web/src/profiles/api.ts`, `active.ts`, `web/src/builder/failure.ts`, `web/src/Panel.tsx`, `web/src/Screen.tsx` · T15: `server/src/backup/*`, `server/src/backup-cli.ts`, `server/src/config.ts`, `.env.example` |
| 4 | T6, T16 | T6: `shared/src/sync.ts`, `shared/src/index.ts`, `server/src/sync/routes.ts`, `server/src/profiles/store.ts`, `server/src/boot.ts` · T16: `infra/deploy.ts`, `infra/receive.sh`, `tests/tsconfig.json` |
| 5 | T7, T8, T17 | T7: `server/src/cloud/session-store.ts`, `signin.ts`, `routes.ts`, `shared/src/cloud.ts`, `shared/src/index.ts`, `server/src/boot.ts` · T8: `server/src/profiles/store.ts` · T17: `infra/rebuild.sh`, `infra/Caddyfile`, `infra/systemd/*`, `infra/journald-djvisuals.conf`, `infra/sudoers-djvisuals-deploy` |
| 6 | T9, T18 | T9: `server/src/cloud/sync.ts` · T18: `.github/workflows/deploy.yml` |
| 7 | T10 | `server/src/cloud/scheduler.ts`, `server/src/cloud/routes.ts`, `shared/src/cloud.ts`, `server/src/control/hub.ts`, `server/src/profiles/routes.ts`, `server/src/boot.ts` |
| 8 | T13 | `web/src/cloud/*`, `web/src/Panel.tsx`, `web/src/builder/ProfileList.tsx`, `web/src/builder/Builder.tsx`, `tests/browser/hosted-server.ts` |
| 9 | T14 | tests only (`tests/browser/hosted.spec.ts`, `server/test/secrets.int.test.ts`) |
| 10 | T19 | `docs/runbooks/*`, `docs/design/architecture.md`, `docs/invariants.md`, `docs/backlog.md` |

No two tasks in one group write the same file. `python scripts/check_plans.py --graph <this
file>` prints the groups the `Depends on` fields actually give. `/build` builds them one after
another in this order on stacked branches, so the groups record what could run side by side, not
what will. Test files extended by later tasks: `server/src/profiles/store.test.ts` (T3, T6, T8),
`server/src/config.test.ts` (T2, T15), `tests/workflow/test_infra.py` (T16, T17).

## Data changes

`server/migrations/0003_sync.sql`, additive and forward-only (no existing migration edited):

```sql
ALTER TABLE profiles ADD COLUMN change_seq INTEGER NOT NULL DEFAULT 0;   -- both modes: the write's counter
ALTER TABLE profiles ADD COLUMN cloud_revision INTEGER;                 -- local: the cloud revision last matched; NULL = never
ALTER TABLE profiles ADD COLUMN pushed_seq INTEGER NOT NULL DEFAULT 0;   -- local: the change_seq the cloud last accepted
ALTER TABLE profiles ADD COLUMN conflict_copy INTEGER NOT NULL DEFAULT 0;
CREATE INDEX profiles_change_seq ON profiles (change_seq);
CREATE TABLE profile_tombstones (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL,
  deleted_at TEXT NOT NULL, change_seq INTEGER NOT NULL
);
CREATE INDEX profile_tombstones_change_seq ON profile_tombstones (change_seq);
-- backfill: existing rows get counters 1..n in rowid order; the counter starts after them
UPDATE profiles SET change_seq = (SELECT COUNT(*) FROM profiles p WHERE p.rowid <= profiles.rowid);
INSERT INTO app_meta (key, value) VALUES
  ('change_counter', (SELECT CAST(COUNT(*) AS TEXT) FROM profiles)),
  ('sync_cursor', '0'), ('purged_through', '0');
```

The exact SQL is T3's; the columns, their meaning and the backfill are fixed here. Hosted and
local run the same migration; `cloud_revision` and `pushed_seq` stay unused on the cloud,
`purged_through` unused locally. Rows from before `0003` stay valid and, on a local install, count
as unsynced, so the first connect pushes them (AC5). No profile file or `formatVersion` changes.
The refresh token is `DATA_DIR/cloud/session.json`, not a table. Reversal: forward-only by
project rule (`docs/design/architecture.md:457-460`); a restore is the pre-deploy backup
(T16, AC30) or the nightly one (T15).

## Risks and unknowns

| Risk | Mitigation |
|---|---|
| The real provider differs from the fake: Entra's SPA platform refuses a token request without an `Origin` (the loopback exchange is server-side) and wants the loopback URI under "Mobile and desktop"; port rules for `127.0.0.1` vary; refresh-token lifetimes for SPAs are short (24 h on Entra) | H3 registers each redirect URI on the platform its flow needs and records what worked in `docs/runbooks/hosting.md`; the fake issuer follows the RFCs, not one vendor; a provider that cannot do both flows on one client is an owner stop (PD7 assumes one `aud`) |
| PD7's ID token as bearer is a deliberate simplification; a security reviewer may prefer access tokens | It is vendor-neutral and needs no new variable; confirmed by the owner at the audit (2026-11-17, F3) |
| Oracle's A1 shape is often out of capacity, and an idle Always Free instance can be reclaimed | PD26's E2.1.Micro fallback (1 GB is enough for one Node process); SD11's rebuild and restore, rehearsed in H9 |
| `Db` uses busy timeout 0 (`db.ts:9`): the deploy's migration while the old release runs can fail with `SQLITE_BUSY`, and a live write during it can answer 500 | The migration is one short transaction; a failed one leaves the old release running (AC30) and the deploy is re-run; changing the timeout is out of scope (it is B-08-era behaviour other tests rely on) |
| `VACUUM INTO` under WAL with a live writer on `node:sqlite` is assumed consistent | T15 tests a copy taken during writes and checks `integrity_check` |
| T9 and T10 are estimated at 200 and 220 lines, but sync code tends to grow past its estimate toward the 400-line limit | Each has a clean split (T9: pull / push; T10: scheduler / routes and status); `/build` stops above the limit and asks |
| `nextFreeName` stacks suffixes (`names.ts:12`): a conflict copy of "X (2)" is "X (2) (2)" | SD9 names the existing rule; changing it is a spec change |
| A superseded screen page that keeps running stops pausing sync the moment its successor attaches (PD19) | The successor's first state (`started` false or true) decides within a frame; noted for the audit |
| The screen never sends `started: false` (no Stop, `Screen.tsx:334`), so a set's pause lasts until the page closes or reloads | SD2 already lists the socket's close; nothing to build |
| The single-reader-of-the-environment invariant covers only `.ts/.tsx/.js` (`config-boundary.test.ts:44-46`); `infra/*.sh` and the systemd env file read the environment by design | T19 states in the invariant row that `infra/` shell and unit files are outside it; `deploy.ts` itself takes arguments, never `process.env` |
| `DATA_DIR` outside `./data` leaves `cloud/session.json` (like `tls/`) un-ignored by git | The VM's `DATA_DIR` is outside the repository; the boundary test checks the default path, as `tls-boundary` does |
| The auth guard is a permission matrix in all but name, and `docs/invariants.md` has no guarded area | The owner accepted the recommendation at the audit (2026-11-17): T19 drafts `server/src/auth/` as the first guarded area for approval at its review; until then `/review` of T4, T5 treats it as one |
| `docs/design/architecture.md` and `docs/invariants.md` changes are owner stops | Both are drafted in T19 for the owner's review; the spec's approval named them in scope |
| The owner's `.env.local` lacks `APP_MODE`, so `pnpm start` exits after T2 | H0, and `.env.example` shows it; the fatal line names `APP_MODE` |

## Human steps

All are the owner's, after the build unless noted, recorded in this plan when done. AC32 is
verified only here (H9); AC28, AC29 and AC31 are also watched live (H6–H8).

- [ ] **H0 — Local env** (after T2 is on `main`). Add `APP_MODE=local` to `.env.local`.
- [ ] **H1 — Oracle account and VM.** Create the account, the VM of PD26, a reserved public IP
  only if Always Free, ingress 22/80/443; confirm each resource is "Always Free-eligible".
- [ ] **H2 — Domain and DNS.** Buy the domain; an `A` record to the VM.
- [ ] **H3 — Provider tenant.** One public client with PKCE; redirect URIs
  `https://<domain>/`, `https://<domain>/builder`, `http://127.0.0.1:<PORT>/api/cloud/callback`;
  refresh tokens on; read the owner's subject for `ALLOWED_SUBJECT`.
- [ ] **H4 — Bucket and key.** One Object Storage bucket, an S3 customer secret key; fill
  `/etc/djvisuals/env` on the VM (PD5, PD25 variables).
- [ ] **H5 — Deploy key and first rebuild.** Make the deploy key pair; GitHub secrets
  `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`; run `infra/rebuild.sh`.
- [ ] **H6 — A merge deploys** (AC29). Merge a change; watch the workflow run after CI and the
  new release answer `/api/health`.
- [ ] **H7 — A broken deploy rolls back** (AC28, AC30). Deploy a commit whose health check fails
  on purpose; the previous release answers again and the profiles are intact.
- [ ] **H8 — Monitor and nightly backup** (AC31). Create the free uptime monitor on
  `/api/health`; stop the service and receive the email; the next morning the bucket holds that
  night's copy.
- [ ] **H9 — Restore on a fresh VM** (AC32). A second VM from nothing with `rebuild.sh`, then
  `restore.md`; `/api/health` and the restored profiles answer. A rehearsal record in
  `docs/runbooks/rehearsals/`.
- [ ] **H10 — Two machines.** Connect the real local install and a second machine; the same
  profiles on both after a sync; an edit on each makes a conflict copy.
- [ ] **H11 — A set in hosted use.** On a machine with no install, over venue-like internet: sign
  in, play a set with the owner's profiles, read the overlay (B-01 budgets unchanged).
- [ ] **H12 — Trial availability.** Fourteen days after go-live, the monitor's uptime (≥ 99%),
  reported to the owner (spec Non-functional; a measure, not a gate).
- **Pushing, the PRs and the merges** are the owner's (CLAUDE.md).

## Out of scope for this plan

- Everything under the spec's "Out of scope": control or media through the cloud, offline hosted
  use, other accounts (B-13), syncing assets (B-14), polling or push sync, paid resources, log
  shipping, server-side rendering, changing the `127.0.0.1` bind.
- A singular "1 conflict kept as a copy": the spec's phrase is used as written (T13's autonomy
  note).
- Changing `Db`'s busy timeout or `nextFreeName`'s suffix rule (Risks).
- `docs/runbooks/incident.md`: listed in the index, not written by this spec; T19 marks it so.

## Audit (PASS required before implementation starts)

`python scripts/check_plans.py`: 19 tasks, ok; `--graph` gives the Task graph's ten groups
unchanged. Owner decisions (2026-11-17): PD1–PD4 as recommended; PD7 and PD9 confirmed with
their departure from SD16's wording (F3); "1 conflicts kept as copies" stays the spec's phrase
(Out of scope); `server/src/auth/` becomes a guarded area, drafted in T19. Changes made at the
audit: F1 deploy skips green until configured (PD24, T18); F2 the release carries the workspace
file, `.npmrc` and every member's `package.json` (PD23, T18); F4 the rate window is lifted out of
the pairing throttle, not rewritten (PD11, T5); F5 AC19 read as "unchanged in behaviour" (PD6,
T2).

- [x] Every AC maps to at least one task — AC32 only through H9 (T17, T19 prepare it)
- [x] Every task maps to at least one AC (no orphans) — T1 accepted without one: it serves SD12
- [x] Each task's expected output is concrete enough to check, and is what we actually need —
  T14's "fixes a failing scan proves" and T19's architecture draft accepted as bounded by their
  autonomy notes
- [x] Existing patterns reused; nothing reinvented — after F4
- [x] No new dependency without an approval note — none in the repository; Caddy, NodeSource
  Node and the accounts are VM and owner setup (SD3, SD6, SD11)
- [x] Data changes additive and reversible — additive; reversal is the pre-deploy or nightly
  backup (forward-only by project rule)
- [x] Errors, empty states and permissions are tasks, not afterthoughts
- [x] Each task reviewable in one sitting
- [x] Verification named per task
- [x] Nothing touches prod, secrets or infra it should not — every Oracle, GitHub-secret and
  provider step is H0–H12
- [x] Every task has a Depends on and an Autonomy note
- [x] No two tasks in one parallel group write the same file

Audited by: Martijn Boot  Date: 2026-11-17
