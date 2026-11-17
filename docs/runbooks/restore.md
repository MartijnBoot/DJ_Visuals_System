# Restore (B-12)

The cloud's database is copied to the Object Storage bucket every night at 03:00 UTC, and before
every deploy; the newest 14 nightly copies are kept (`djvisuals-backup.timer`).

## Restore the newest backup on the running VM

1. SSH to the VM. Stop the service: `sudo systemctl stop djvisuals`.
2. Restore:
   ```
   sudo -u djvisuals node --env-file=/etc/djvisuals/env \
     /srv/djvisuals/current/server/src/backup-cli.ts restore --latest
   ```
   It downloads the newest copy, checks it with `PRAGMA integrity_check`, and only then puts it in
   place of the database. It prints `restore done`, or `backup failed` with the step (`list`: no
   copy in the bucket; `check`: the newest is damaged; stop and pick an older one by hand from
   the bucket in the console).
3. Start: `sudo systemctl start djvisuals`.
4. Check `https://<domain>/api/health` answers `"status":"ok"`; sign in and the profiles are
   there.
5. Connected local installs push what they hold that the cloud lost on their next sync.

## Rebuild a reclaimed or lost VM (AC32, H9)

Oracle may reclaim an idle Always Free instance. The data is in the bucket and on the local
installs; the VM is rebuilt from nothing.

1. Create a new VM as in [hosting.md](hosting.md) step 1, and point the DNS `A` record at its IP.
2. On it: clone the repository, `sudo bash infra/rebuild.sh <domain> <deploy public key file>`.
3. Fill in `/etc/djvisuals/env` again (hosting.md step 5.4). The values live in your password
   manager, not in the repository.
4. Update the `DEPLOY_HOST` (if the address changed) and `DEPLOY_KNOWN_HOSTS` secrets: the new
   VM has a new host key.
5. Re-run the latest Deploy workflow on `main`. It deploys the release and starts the app on an
   empty database.
6. Restore the newest backup (above, steps 1–4).
7. Record the rehearsal in [rehearsals/](rehearsals/) with the times of each step.
