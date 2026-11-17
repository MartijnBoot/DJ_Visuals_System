#!/usr/bin/env bash
# Rebuilds the cloud's VM from nothing (B-12 SD6, SD11, AC32; plan T17). Run as root on a fresh
# Ubuntu 24.04, from a checkout of this repository:
#
#   sudo bash infra/rebuild.sh <domain> <deploy-public-key-file> [port]
#
# Idempotent: every step checks before it changes, and the env file is never overwritten. It
# creates nothing in Oracle Cloud and needs no credential: the deploy key's PUBLIC half is all
# it reads. It ends by printing the next manual step (docs/runbooks/hosting.md).
#
#   Node 24 from NodeSource, pnpm through corepack, Caddy from its apt repository; the users
#   `djvisuals` (the service) and `deploy` (the forced command only); /srv/djvisuals/{releases,
#   backups}; /var/lib/djvisuals (DATA_DIR); /etc/djvisuals/env (0640, names only); the systemd
#   units, the journald drop-in and the sudoers file (checked with visudo -c); ufw on 22, 80, 443.
set -euo pipefail

usage() {
  echo "usage: sudo bash infra/rebuild.sh <domain> <deploy-public-key-file> [port]" >&2
  exit 2
}

[ "$#" -ge 2 ] || usage
DOMAIN="$1"
DEPLOY_KEY_FILE="$2"
PORT="${3:-8000}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA="$REPO/infra"

[ "$(id -u)" -eq 0 ] || { echo "rebuild: run as root (sudo)" >&2; exit 2; }
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "rebuild: the domain looks wrong" >&2; exit 2; }
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] || { echo "rebuild: the port must be a number" >&2; exit 2; }
grep -qE '^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) ' "$DEPLOY_KEY_FILE" ||
  { echo "rebuild: $DEPLOY_KEY_FILE is not an SSH public key" >&2; exit 2; }

step() { printf '\n==> %s\n' "$*"; }

step "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg ufw debian-keyring debian-archive-keyring apt-transport-https
install -d -m 0755 /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/nodesource.gpg ]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
fi
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
  >/etc/apt/sources.list.d/nodesource.list
if [ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
fi
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  >/etc/apt/sources.list.d/caddy-stable.list
apt-get update -q
apt-get install -y -q nodejs caddy
node --version
corepack enable

step "users"
id -u djvisuals >/dev/null 2>&1 ||
  useradd --system --home-dir /var/lib/djvisuals --no-create-home --shell /usr/sbin/nologin djvisuals
id -u deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
usermod -aG djvisuals deploy

step "folders"
install -d -o deploy -g djvisuals -m 2770 /srv/djvisuals /srv/djvisuals/releases /srv/djvisuals/backups
install -d -o djvisuals -g djvisuals -m 2770 /var/lib/djvisuals
install -d -o root -g djvisuals -m 0750 /etc/djvisuals

step "the env file (names only; never overwritten)"
if [ ! -f /etc/djvisuals/env ]; then
  cat >/etc/djvisuals/env <<EOF
# Filled in by the owner (docs/runbooks/hosting.md). Read by the service and the deploy only.
APP_ENV=production
LOG_LEVEL=info
APP_MODE=hosted
PORT=$PORT
CONTROL_PORT=$((PORT + 1))
DATA_DIR=/var/lib/djvisuals
OIDC_ISSUER=
OIDC_CLIENT_ID=
ALLOWED_SUBJECT=
BACKUP_ENDPOINT=
BACKUP_REGION=
BACKUP_BUCKET=
BACKUP_ACCESS_KEY_ID=
BACKUP_SECRET_ACCESS_KEY=
EOF
fi
chown root:djvisuals /etc/djvisuals/env
chmod 0640 /etc/djvisuals/env

step "the deploy user's forced command"
install -o root -g root -m 0755 "$INFRA/receive.sh" /usr/local/bin/djvisuals-receive
install -d -o deploy -g deploy -m 0700 /home/deploy/.ssh
KEY="$(grep -E '^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) ' "$DEPLOY_KEY_FILE" | head -n 1)"
echo "command=\"/usr/local/bin/djvisuals-receive\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $KEY" \
  >/home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 0600 /home/deploy/.ssh/authorized_keys
# pnpm's first run fetches the version package.json names; do it now, not mid-deploy.
sudo -u deploy -H env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 bash -c "cd '$REPO' && pnpm --version"

step "sudoers (checked before it is installed)"
visudo -cf "$INFRA/sudoers-djvisuals-deploy"
install -o root -g root -m 0440 "$INFRA/sudoers-djvisuals-deploy" /etc/sudoers.d/djvisuals-deploy

step "systemd units and log retention"
install -o root -g root -m 0644 "$INFRA/systemd/djvisuals.service" /etc/systemd/system/djvisuals.service
install -o root -g root -m 0644 "$INFRA/systemd/djvisuals-backup.service" /etc/systemd/system/djvisuals-backup.service
install -o root -g root -m 0644 "$INFRA/systemd/djvisuals-backup.timer" /etc/systemd/system/djvisuals-backup.timer
install -d -m 0755 /etc/systemd/journald.conf.d
install -o root -g root -m 0644 "$INFRA/journald-djvisuals.conf" /etc/systemd/journald.conf.d/djvisuals.conf
systemctl daemon-reload
systemctl restart systemd-journald
# The app starts with the first deploy, once `current` exists.
systemctl enable djvisuals.service
systemctl enable --now djvisuals-backup.timer

step "Caddy"
install -o root -g root -m 0644 "$INFRA/Caddyfile" /etc/caddy/Caddyfile
install -d -m 0755 /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=DJV_DOMAIN=%s\nEnvironment=DJV_PORT=%s\n' "$DOMAIN" "$PORT" \
  >/etc/systemd/system/caddy.service.d/djvisuals.conf
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

step "firewall"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

cat <<EOF

rebuild: done. Next (docs/runbooks/hosting.md):
  1. Fill in /etc/djvisuals/env (the OIDC and BACKUP_ values).
  2. Check the GitHub secrets DEPLOY_HOST, DEPLOY_USER (deploy), DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS.
  3. Re-run the latest "Deploy" workflow on main (or merge a change): the first deploy starts the app.
  4. Restoring a backup instead? docs/runbooks/restore.md.
EOF
