# Rollback (B-12)

**Target: the previous release answering `/api/health` within 5 minutes.**

A failed deploy rolls back by itself (deploy.md). Use this when a release that deployed green
turns out to be wrong, or when the automatic rollback failed. Never push a revert of a
migration: migrations are forward-only; the database goes back with the pre-deploy copy.

1. SSH to the VM with your own login.
2. See which releases are there and which runs:
   ```
   ls -lt /srv/djvisuals/releases/
   readlink -f /srv/djvisuals/current
   ```
3. Stop the service: `sudo systemctl stop djvisuals`.
4. Point `current` at the previous release (`<old>` is its 40-character folder name):
   ```
   sudo -u deploy ln -sfn /srv/djvisuals/releases/<old> /srv/djvisuals/current
   ```
5. If the bad release migrated the database, put back that deploy's copy (`<bad>` is the bad
   release's id; the file exists only when a database existed before it):
   ```
   sudo -u djvisuals node --env-file=/etc/djvisuals/env \
     /srv/djvisuals/current/server/src/backup-cli.ts restore --from /srv/djvisuals/backups/pre-<bad>.sqlite
   ```
   It prints `restore done`, or `backup failed` with the step (`check`: the copy is damaged;
   use [restore.md](restore.md) instead).
6. Start it: `sudo systemctl start djvisuals`.
7. Check: `curl -s https://<domain>/api/health` answers `"status":"ok"` and the old
   `schemaVersion`; sign in and the profiles are there.
8. Revert the bad change on `main` with a normal PR, so the next deploy does not bring it back.
9. Write the rehearsal or incident record in [rehearsals/](rehearsals/).

Profile edits made on the cloud between the bad deploy and the rollback are lost with the
restore; a local install that synced them pushes them again on its next sync.
