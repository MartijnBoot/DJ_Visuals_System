#!/usr/bin/env bash
# The gate: every check this repository has, in one place, stopping at the first failure.
#
# One definition of green (way-of-working 5.5, 7.3). An agent runs this before calling a task
# done and pastes the output; CI runs this same script, never a restatement of its steps in
# YAML; so "green locally" and "green in CI" are one claim, not two promises.
#
#   bash scripts/check.sh
#
# Adding a check: one `step "<name>" <command...>` line in the project section below. The
# commands it runs must already be in the project (no new tool without approval).
# Removing or weakening a check: its own PR, saying why. A failing gate is fixed, never
# bypassed -- if a check is wrong, fix the check (7.3).
#
# The environment comes from .env.local when it exists (local runs) and from the process
# otherwise (CI sets it).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=find-python.sh
. scripts/find-python.sh
if ! PY="$(workflow_python)"; then
  echo "scripts/check.sh: no working Python 3.9+ (tried python3, python, 'py -3')." \
    "The workflow checks need one; set WORKFLOW_PYTHON to point at it." >&2
  exit 1
fi

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091  # local only, gitignored
  . ./.env.local
  set +a
fi

STEP=0
PROJECT_STEPS=0

step() {
  local name="$1"
  shift
  STEP=$((STEP + 1))
  printf '\n==> [%d] %s\n' "$STEP" "$name"
  if ! "$@"; then
    printf '\nscripts/check.sh: FAILED at step %d (%s)\n' "$STEP" "$name" >&2
    exit 1
  fi
}

project_step() {
  PROJECT_STEPS=$((PROJECT_STEPS + 1))
  step "$@"
}

# B-08 SD5: say why the browser step is about to fail when its port is held, then run it
# anyway. Never refuses and never stops a process. A probe that cannot run counts as "cannot
# tell" and prints nothing. The port is GATE_PORT in tests/browser/fixtures/launch.ts.
warn_if_gate_port_held() {
  local status=0
  node scripts/port-check.ts 8123 >/dev/null 2>&1 || status=$?
  if [ "$status" -eq 1 ]; then
    {
      printf '\nscripts/check.sh: WARNING: 127.0.0.1:8123 is already in use, so the browser step\n'
      printf '  will fail to start its server. Likely cause: an orphaned node process left by a\n'
      printf '  stopped `pnpm start` or a crashed Playwright run. Find it with\n'
      printf "  netstat -ano | grep ':8123 '  (Windows, Git Bash; the last column is the PID)\n"
      printf '  lsof -i :8123                 (Linux, macOS)\n'
      printf '  Running the browser step anyway.\n'
    } >&2
  fi
  return 0
}

# --- the workflow's own checks (always) -----------------------------------------------------
# The plans are /build's work queue; the guard is what stops an agent editing history. Both are
# tested here so that a broken checker or an unwired guard turns the gate red, not silent.

# shellcheck disable=SC2086  # word splitting wanted: "py -3"
step "plans: structure and traceability" $PY scripts/check_plans.py
# shellcheck disable=SC2086
step "workflow tests (guard, plan checker)" $PY -m unittest discover -s tests/workflow -p "test_*.py"

# --- the project's checks -------------------------------------------------------------------
# Fast and static first, so most failures surface in seconds. Order per the Phase 0 spec (AC2):
# format, lint, types, build, unit, integration, browser.
project_step "format" pnpm format:check
project_step "lint" pnpm lint
project_step "types" pnpm typecheck
project_step "build" pnpm build
project_step "unit" pnpm run test --project unit
project_step "integration" pnpm run test --project integration
warn_if_gate_port_held
project_step "browser" pnpm test:browser

# --- done -----------------------------------------------------------------------------------

printf '\nscripts/check.sh: all %d step(s) passed\n' "$STEP"
