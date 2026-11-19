# Deploy (B-12)

A merge to `main` deploys by itself: `.github/workflows/deploy.yml` runs after the **CI**
workflow finishes green for a push to `main`, one deploy at a time. Nothing is deployed by hand.

## What happens

1. **CI** runs the gate on the pushed commit.
2. **Deploy** starts when CI completes. It ends green with a notice, and does nothing, when:
   CI failed; CI ran for a schedule or by hand (only a push deploys); `DEPLOY_HOST` is not set
   ("deploy not configured"); or the commit is no longer `main`'s tip (the newer push deploys).
3. It builds `web/dist`, packs the release (the workspace files, the five `package.json`s,
   `shared/`, `server/`, `web/dist`, `infra/`) and pipes it over SSH to the `deploy` user. The VM
   only lets that key run `/usr/local/bin/djvisuals-receive` (`infra/receive.sh`).
4. On the VM, `receive.sh` unpacks it into `/srv/djvisuals/releases/<sha>/`, installs production
   dependencies from the frozen lockfile and runs the release's `infra/deploy.ts`:
   1. **backup**: a checked copy to `backups/pre-<sha>.sqlite` and to the bucket;
   2. **migrate**: the new release's migrations, while the old release still serves;
   3. **switch**: `current` points at the new release;
   4. **restart** the service;
   5. **health**: `/api/health` must answer within 30 s.
5. It prints `deployed <sha>`, and the job is green. The last five releases stay on disk.

## Reading a failed deploy

The job's last step shows the VM's output. The line to read is `deploy failed at <step>: …`.

| Step | What it means | What runs now |
|---|---|---|
| `release` | The release folder is missing (the upload broke) | The old release, untouched |
| `backup` | The copy could not be made or checked, or the bucket refused it | The old release, untouched |
| `migrate` | A migration failed; it rolled itself back | The old release, untouched |
| `switch`, `restart`, `health` | The new release would not start or answer | Rolled back: `rolled back to <old>` follows |
| `rollback …` | The rollback itself failed | Unknown: follow [rollback.md](rollback.md) by hand now |

A `receive: refused …` line means the SSH command was not a 40-character commit id, or the env
file has no `PORT`: the workflow or the VM is misconfigured, nothing was changed.

Then: look at the logs (`journalctl -u djvisuals -n 200` on the VM), fix forward with a new
commit, and let it deploy. Re-running a failed deploy of the same commit is safe.
