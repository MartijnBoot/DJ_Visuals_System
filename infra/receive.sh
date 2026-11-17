#!/usr/bin/env bash
# The deploy user's forced command (B-12 SD7, PD23): `authorized_keys` runs this for every SSH
# login with the deploy key, whatever the client asked for. The client's command line is the
# release id only (the commit, 40 hex characters); the release tarball arrives on stdin.
#
#   unpack into releases/.incoming-<sha>-<pid>, install production dependencies from the frozen
#   lockfile, move it to releases/<sha>, then run that release's infra/deploy.ts.
#
# It reads two settings from its own environment, with the VM's paths as defaults (tests point
# them at a temp folder), and the service's PORT from the env file, to build the health URL.
set -euo pipefail
# Group-writable files: the service (group djvisuals) must read the release and write what the
# migration and the backup create in DATA_DIR. pnpm through corepack must never stop to ask.
umask 0007
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

ROOT="${DJV_ROOT:-/srv/djvisuals}"
ENV_FILE="${DJV_ENV_FILE:-/etc/djvisuals/env}"
SHA="${SSH_ORIGINAL_COMMAND:-}"

if ! [[ "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "receive: refused: the release id must be 40 lower-case hex characters" >&2
  exit 2
fi

RELEASE="$ROOT/releases/$SHA"
if [ -L "$ROOT/current" ] && [ "$(readlink -f "$ROOT/current")" = "$(readlink -f "$RELEASE")" ]; then
  echo "receive: $SHA is already the current release; nothing to do"
  exit 0
fi

PORT="$(sed -n 's/^PORT=\([0-9]\{1,5\}\)[[:space:]]*$/\1/p' "$ENV_FILE" | tail -n 1)"
if [ -z "$PORT" ]; then
  echo "receive: refused: no PORT in $ENV_FILE" >&2
  exit 2
fi

INCOMING="$ROOT/releases/.incoming-$SHA-$$"
cleanup() { rm -rf "$INCOMING"; }
trap cleanup EXIT

mkdir -p "$INCOMING"
tar -xzf - -C "$INCOMING"
(cd "$INCOMING" && pnpm install --prod --frozen-lockfile)
rm -rf "$RELEASE"
mv "$INCOMING" "$RELEASE"

exec node "$RELEASE/infra/deploy.ts" \
  --root "$ROOT" \
  --release "$SHA" \
  --env-file "$ENV_FILE" \
  --health-url "http://127.0.0.1:$PORT/api/health" \
  --restart "sudo /usr/bin/systemctl restart djvisuals" \
  --stop "sudo /usr/bin/systemctl stop djvisuals" \
  --start "sudo /usr/bin/systemctl start djvisuals"
