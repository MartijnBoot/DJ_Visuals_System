# shellcheck shell=bash
# Sourced, not run: defines `workflow_python`, which prints the command of a Python 3.9+ that
# actually runs, or returns 1.
#
# Why probe instead of calling `python`: on Windows, `python` and `python3` are often the
# Microsoft Store stub, which prints "Python was not found" and exits 49. A hook registered as
# `python guard.py` then fails with a non-blocking error on every call, and the guard it was
# meant to run never runs. Each candidate is therefore asked to run, not just looked up.
#
# WORKFLOW_PYTHON overrides the search, e.g. WORKFLOW_PYTHON="uv run --no-project python".
# The result is used unquoted on purpose (`py -3` is two words), so it must not hold a path
# with spaces.

workflow_python() {
  local candidate
  if [ -n "${WORKFLOW_PYTHON:-}" ]; then
    printf '%s\n' "$WORKFLOW_PYTHON"
    return 0
  fi
  for candidate in "python3" "python" "py -3"; do
    # shellcheck disable=SC2086  # word splitting wanted: "py -3"
    if $candidate -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' \
      </dev/null >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}
