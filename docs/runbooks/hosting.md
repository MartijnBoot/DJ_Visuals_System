# Hosting: setting up the cloud (B-12)

The cloud is one Oracle Cloud Always Free VM running the app in hosted mode behind Caddy
([ADR 0003](../adr/0003-hosting-on-oracle-synced-profiles.md)). Everything below is the owner's:
no agent creates a cloud resource, holds a credential or touches the VM. Steps are in the order
of the plan's human steps H1–H5 ([plan](../plans/phase-b-12-hosted-home-oracle.md#human-steps)).

## 1. The Oracle account and the VM (H1)

1. Create the Oracle Cloud account. Pick a home region close to where you play; it cannot change.
2. Create a compute instance: **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** with 1 OCPU and
   6 GB (Always Free covers up to 4 OCPU and 24 GB in total). When A1 says "out of capacity",
   use **VM.Standard.E2.1.Micro** instead; 1 GB is enough for one Node process.
3. Boot volume: the default size (at most 200 GB is free across all volumes). No extra block
   volume, no load balancer.
4. Networking: the default VCN; the subnet's security list allows ingress TCP **22, 80 and
   443** only. A reserved public IP only when the console marks it Always Free-eligible;
   otherwise keep the ephemeral one and update DNS if it ever changes.
5. Upload your own SSH public key for your login (not the deploy key).
6. **Check every resource says "Always Free-eligible"** in the console before you create it.
   Anything that does not is a paid resource: do not create it.

## 2. Domain and DNS (H2)

1. Buy the domain with any registrar.
2. Add an `A` record for the name you will use (for example `visuals.example.com`) pointing at
   the VM's public IP. Caddy fetches a free certificate for it on first start; it needs ports 80
   and 443 open and the record in place.

## 3. The sign-in provider (H3)

Any OpenID Connect provider works (Microsoft Entra External ID, Clerk, or another). One public
client (PKCE, no secret) serves both the hosted page and the local installs.

1. Create the tenant and one application registration with **authorisation code + PKCE**, no
   client secret.
2. Redirect URIs, all three:
   - `https://<domain>/` and `https://<domain>/builder` (hosted use; on Entra under
     "Single-page application")
   - `http://127.0.0.1:<PORT>/api/cloud/callback` (each local install's `PORT`; on Entra under
     "Mobile and desktop applications")
3. Turn on refresh tokens (`offline_access` scope allowed).
4. Sign in once with your own account and read its **subject** (`sub` claim): that is
   `ALLOWED_SUBJECT`. Only this account will see any profile.
5. Note the **issuer URL** (the `issuer` in `<issuer>/.well-known/openid-configuration`) and the
   **client id**.
6. Record here what worked on your provider, for the next rebuild:
   - Provider: _
   - Redirect URI platforms used: _

## 4. The backup bucket and its key (H4)

1. Object Storage → create one bucket (private), for example `djvisuals-backups`. Always Free
   covers 20 GB.
2. Your user → **Customer secret keys** → generate one. Copy the secret at once: it is shown
   only once. The access key id and the secret are `BACKUP_ACCESS_KEY_ID` and
   `BACKUP_SECRET_ACCESS_KEY`.
3. `BACKUP_ENDPOINT` is `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`
   (the namespace is on the tenancy page); `BACKUP_REGION` is the region identifier, for
   example `eu-amsterdam-1`.

## 5. The deploy key and the first rebuild (H5)

1. On your own machine, make the deploy key pair (no passphrase; it is used by CI only):
   `ssh-keygen -t ed25519 -f djvisuals-deploy -C djvisuals-deploy`.
2. Copy the repository to the VM (`git clone`), and the **public** half `djvisuals-deploy.pub`.
3. On the VM: `sudo bash infra/rebuild.sh <domain> djvisuals-deploy.pub`. It installs Node 24,
   pnpm, Caddy, the users, the folders, the units, the firewall, and an env file with the names
   only. It is safe to run again.
4. Fill in `/etc/djvisuals/env` (`sudo nano /etc/djvisuals/env`): `OIDC_ISSUER`,
   `OIDC_CLIENT_ID`, `ALLOWED_SUBJECT`, and the five `BACKUP_` values. Never commit them.
5. Read the VM's host key line for GitHub: `ssh-keyscan -t ed25519 <domain>` (check its
   fingerprint against `sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VM).
6. GitHub → the repository → Settings → Secrets and variables → Actions, four secrets and no
   others:
   - `DEPLOY_HOST`: the domain or IP
   - `DEPLOY_USER`: `deploy`
   - `DEPLOY_SSH_KEY`: the **private** half `djvisuals-deploy`, whole
   - `DEPLOY_KNOWN_HOSTS`: the `ssh-keyscan` line
7. Delete the private key from your machine once it is in GitHub, or keep it in your password
   manager; it is only for CI.
8. Re-run the latest **Deploy** workflow on `main` (Actions → Deploy → Re-run), or merge a
   change. The first deploy starts the app. Check `https://<domain>/api/health` answers
   `"mode":"hosted"`.

## 6. The uptime monitor (H8)

1. Any free external monitor (UptimeRobot, Better Stack, or similar): an HTTPS check on
   `https://<domain>/api/health` every 5 minutes, expecting status 200 and the text
   `"status":"ok"`, alerting your email.
2. Test it: `sudo systemctl stop djvisuals`, wait for the email, `sudo systemctl start djvisuals`.

## Connecting a local install

On the screen machine, add to `.env.local` and restart:

```
CLOUD_URL=https://<domain>
OIDC_ISSUER=<the issuer URL>
OIDC_CLIENT_ID=<the client id>
```

Then the panel (`s`) shows a cloud row: **Connect to cloud** signs in through the provider in a
new tab and syncs. **Disconnect from cloud** forgets the sign-in and keeps every profile.

## Rotating the deploy key

1. Make a new pair (step 5.1).
2. On the VM, as root: put the new public key in place of the old one in
   `/home/deploy/.ssh/authorized_keys`, keeping the `command="/usr/local/bin/djvisuals-receive",…`
   options in front of it exactly as `infra/rebuild.sh` writes them (or re-run `rebuild.sh` with
   the new public key file).
3. Replace the `DEPLOY_SSH_KEY` secret in GitHub.
4. Re-run the latest Deploy workflow to prove the new key works.

## What the VM holds

| Path | What |
|---|---|
| `/srv/djvisuals/releases/<sha>/` | The last five releases |
| `/srv/djvisuals/current` | The running release (a link) |
| `/srv/djvisuals/backups/pre-<sha>.sqlite` | Each deploy's pre-migration copy |
| `/var/lib/djvisuals/` | `DATA_DIR`: the database |
| `/etc/djvisuals/env` | The settings (`0640`, root:djvisuals); never in the repository |
| `journalctl -u djvisuals` | The app's logs, kept 14 days |
