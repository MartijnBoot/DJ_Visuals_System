"""`PreToolUse` hook: refuse the writes the workflow says an agent must never make.

Two rules, both configured in `.claude/guard-paths.json`:

- **protected** -- glob patterns, repository-relative with `/` separators, that no agent may
  write: golden fixtures, vendored files, `.git/`, real `.env` files. `*` crosses directories.
- **append_only** -- directories whose entries form an ordered history, migrations above all.
  A new entry may be added and the newest may still be edited; an entry that already has a
  successor may not ("never edit an applied migration -- add a new one", way-of-working 5.6).
  "Newest" is the last entry by name, so this suits sequence- or timestamp-prefixed names
  (`0007_x.sql`, `20260105_x/`). An entry is a file or a directory directly under the folder.

**Deliberately stdlib only.** It runs as a subprocess on every Write and Edit, so it must start
in milliseconds and must not depend on the project's own environment.

Protocol: one JSON object on stdin, Claude Code's `PreToolUse` contract. Exit 0 to allow;
exit 2 with a message on stderr to block. That message is what the blocked agent, and a human
reading the transcript, both see.

Limits, stated so nobody relies on more: it sees Write, Edit, MultiEdit and NotebookEdit. A
`sed -i` through Bash is not stopped by anything here.
"""

from __future__ import annotations

import fnmatch
import json
import os
import sys
from pathlib import Path, PurePosixPath
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_RELATIVE = ".claude/guard-paths.json"

MUTATING_TOOLS = frozenset({"Write", "Edit", "MultiEdit", "NotebookEdit"})

# Entries in an append-only folder that are not part of its history.
NOT_HISTORY = frozenset({"__init__.py", "__pycache__", "README.md", ".gitkeep"})

ALLOW = 0
BLOCK = 2


class ConfigError(ValueError):
    """`.claude/guard-paths.json` exists but cannot be used."""


def load_config(root: Path) -> dict[str, list[str]]:
    """The two rule lists. A missing file means no rules; a broken one is an error."""
    path = root / CONFIG_RELATIVE
    if not path.exists():
        return {"protected": [], "append_only": []}
    try:
        raw: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ConfigError(f"{CONFIG_RELATIVE} is unreadable: {error}") from error
    if not isinstance(raw, dict):
        raise ConfigError(f"{CONFIG_RELATIVE} must hold a JSON object")

    config: dict[str, list[str]] = {}
    for key in ("protected", "append_only"):
        value = raw.get(key, [])
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ConfigError(f'{CONFIG_RELATIVE}: "{key}" must be a list of strings')
        config[key] = [item.strip().strip("/") for item in value if item.strip().strip("/")]
    return config


def relative_to_root(file_path: Path, root: Path) -> PurePosixPath | None:
    """`file_path` relative to `root`, or `None` if it lies outside the repository.

    Compared with `os.path.normcase` so that `c:\\repo` and `C:\\repo` are the same folder on
    Windows, while the relative part keeps the case it was given.
    """
    target = str(file_path.resolve())
    base = str(root.resolve())
    if os.path.normcase(target) == os.path.normcase(base):
        return None
    prefix = base.rstrip(os.sep) + os.sep
    if not os.path.normcase(target).startswith(os.path.normcase(prefix)):
        return None
    return PurePosixPath(target[len(prefix) :].replace(os.sep, "/"))


def _same(a: str, b: str) -> bool:
    return os.path.normcase(a) == os.path.normcase(b)


def protected_pattern(relative: PurePosixPath, patterns: list[str]) -> str | None:
    """The first pattern `relative` matches. Case-insensitive on Windows, as the disk is."""
    text = relative.as_posix()
    for pattern in patterns:
        if fnmatch.fnmatch(text, pattern) or fnmatch.fnmatch(text, pattern + "/*"):
            return pattern
    return None


def history_entries(folder: Path) -> list[str]:
    """The entries of an append-only folder that count as its history, oldest first."""
    if not folder.is_dir():
        return []
    return sorted(
        entry.name
        for entry in folder.iterdir()
        if entry.name not in NOT_HISTORY and not entry.name.startswith(".")
    )


def superseded_entry(relative: PurePosixPath, root: Path, folders: list[str]) -> str | None:
    """A block message if `relative` is inside an append-only entry that has a successor."""
    parts = relative.parts
    for folder in folders:
        folder_parts = PurePosixPath(folder).parts
        depth = len(folder_parts)
        if len(parts) <= depth or not _same("/".join(parts[:depth]), "/".join(folder_parts)):
            continue

        entry = parts[depth]
        if entry in NOT_HISTORY or entry.startswith("."):
            return None
        folder_path = root.joinpath(*folder_parts)
        if not (folder_path / entry).exists():
            return None  # a new entry supersedes nothing

        entries = history_entries(folder_path)
        if not entries or _same(entry, entries[-1]):
            return None
        return (
            f"guard: refusing to write {relative.as_posix()} -- {entry} already has a "
            f"successor in {folder}/ (newest: {entries[-1]}). Never edit history that "
            f"others may have applied; add a new entry instead (way-of-working 5.6)."
        )
    return None


def decide(file_path: Path, root: Path = REPO_ROOT) -> tuple[bool, str]:
    """Whether `file_path` may be written, and why."""
    relative = relative_to_root(file_path, root)
    if relative is None:
        return True, "outside the repository"

    try:
        config = load_config(root)
    except ConfigError as error:
        if _same(relative.as_posix(), CONFIG_RELATIVE):
            return True, "repairing the guard's own configuration"
        return False, (
            f"guard: {error}. Blocking writes until it is fixed -- a guard that silently "
            f"stops guarding is worse than none."
        )

    pattern = protected_pattern(relative, config["protected"])
    if pattern is not None:
        return False, (
            f"guard: refusing to write {relative.as_posix()} -- it matches the protected "
            f"pattern {pattern!r} in {CONFIG_RELATIVE}. If this file must change, the human "
            f"changes it, or regenerates it with the script that owns it."
        )

    message = superseded_entry(relative, root, config["append_only"])
    if message is not None:
        return False, message

    return True, "no rule applies"


def main(root: Path = REPO_ROOT) -> int:
    # The block message quotes a path; on a cp1252 console an unencodable character in it
    # would crash the hook with exit 1 -- a non-blocking error -- instead of blocking.
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(errors="replace")
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        # The harness's input, not the tool call, is broken. Blocking every edit in the session
        # over it would cost more than the gap it closes, so this one case fails open, visibly.
        print(f"guard: could not parse the hook payload ({error}); allowing", file=sys.stderr)
        return ALLOW

    if not isinstance(payload, dict) or payload.get("tool_name") not in MUTATING_TOOLS:
        return ALLOW
    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("notebook_path")
    if not file_path:
        return ALLOW

    allowed, message = decide(Path(file_path), root)
    if allowed:
        return ALLOW
    print(message, file=sys.stderr)
    return BLOCK


if __name__ == "__main__":
    raise SystemExit(main())
