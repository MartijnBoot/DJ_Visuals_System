#!/usr/bin/env bash
# Claude Code `PreToolUse` hook entry point, registered in .claude/settings.json for
# Write|Edit|MultiEdit|NotebookEdit. Finds a Python that runs, then hands it the payload on
# stdin; guard_paths.py decides. Exit 2 blocks the tool call.
#
# Fails CLOSED when no Python is found: every write is blocked, with a message saying why.
# The alternative -- a guard that quietly does not run -- is the failure this file exists to
# prevent (see scripts/find-python.sh).

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../find-python.sh
. "$HERE/../find-python.sh"

if ! PY="$(workflow_python)"; then
  echo "guard: no working Python 3.9+ found (tried python3, python, 'py -3'; set" \
    "WORKFLOW_PYTHON to override). Writes are blocked until the guard can run." >&2
  exit 2
fi

# shellcheck disable=SC2086  # word splitting wanted: "py -3"
exec $PY "$HERE/guard_paths.py"
