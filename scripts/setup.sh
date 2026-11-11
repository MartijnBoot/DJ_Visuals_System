#!/usr/bin/env bash
# From a fresh clone to a working stack, in one command (way-of-working 5.5). Idempotent: safe
# to run again at any time, and the first thing to try when something local is odd.
#
#   bash scripts/setup.sh
#
# Fill in the project section as the stack appears (Phase 0). Keep it to steps a new developer
# would otherwise have to discover; anything the README has to explain is a step missing here.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "scripts/setup.sh: '$1' is required but not installed. $2" >&2
    exit 1
  fi
}

require git "https://git-scm.com/downloads"

# shellcheck source=find-python.sh
. scripts/find-python.sh
if ! workflow_python >/dev/null; then
  echo "scripts/setup.sh: no working Python 3.9+ found. The workflow's guard hook and gate" \
    "need one: https://www.python.org/downloads/ (or set WORKFLOW_PYTHON)." >&2
  exit 1
fi

# The environment contract (way-of-working 3.3): .env.example is committed and lists every
# variable; .env.local holds the real local values and is never committed.
if [ -f .env.example ] && [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "scripts/setup.sh: created .env.local from .env.example -- fill in the local values"
fi

# --- project -----------------------------------------------------------------------------
# Examples; keep what applies:
#   require uv "https://docs.astral.sh/uv/"         && uv sync --frozen
#   require pnpm "https://pnpm.io/installation"     && pnpm install --frozen-lockfile
#   require docker "https://docs.docker.com/get-docker/" && docker compose up -d db
#   uv run alembic upgrade head                      # migrate
#   uv run python -m app.seed                        # dev seed data only

echo "scripts/setup.sh: done. Next: bash scripts/check.sh"
