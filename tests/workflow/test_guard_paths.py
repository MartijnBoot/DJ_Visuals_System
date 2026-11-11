"""The guard hook: what it blocks, what it lets through, and that it is wired at all.

A guard that cannot fail is worse than no guard, so three things are tested, not one: the
decision on planted cases, the real configuration in this repository, and the registration in
`.claude/settings.json` that makes Claude Code run it. The last runs the hook through `bash`
the way the harness does -- the check that would have caught a hook registered as `python ...`
on a machine where `python` is the Microsoft Store stub.

Stdlib `unittest`, so it runs before any project tooling exists:
    python -m unittest discover -s tests/workflow -p "test_*.py"
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
GUARD = REPO_ROOT / "scripts" / "hooks" / "guard_paths.py"
GUARD_SH = REPO_ROOT / "scripts" / "hooks" / "guard.sh"
SETTINGS = REPO_ROOT / ".claude" / "settings.json"


def _load_guard():
    spec = importlib.util.spec_from_file_location("guard_paths", GUARD)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["guard_paths"] = module
    spec.loader.exec_module(module)
    return module


guard = _load_guard()


class PlantedRepo(unittest.TestCase):
    """A throwaway repository with a migrations folder and a config."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        self.write_config(
            {"protected": ["tests/fixtures/golden/*"], "append_only": ["db/migrations"]}
        )
        migrations = self.root / "db" / "migrations"
        migrations.mkdir(parents=True)
        for name in ("0001_baseline.sql", "0002_orders.sql", "0003_index.sql", "__init__.py"):
            (migrations / name).write_text("-- x\n", encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def write_config(self, config: object) -> None:
        path = self.root / ".claude" / "guard-paths.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(config), encoding="utf-8")

    def decide(self, relative: str) -> tuple[bool, str]:
        return guard.decide(self.root / relative, self.root)


class AppendOnly(PlantedRepo):
    def test_an_entry_with_a_successor_is_blocked_naming_the_newest(self) -> None:
        allowed, message = self.decide("db/migrations/0001_baseline.sql")
        self.assertFalse(allowed)
        self.assertIn("0003_index.sql", message)

    def test_the_newest_entry_may_still_change(self) -> None:
        self.assertTrue(self.decide("db/migrations/0003_index.sql")[0])

    def test_a_new_entry_may_be_added(self) -> None:
        self.assertTrue(self.decide("db/migrations/0004_more.sql")[0])

    def test_files_that_are_not_history_are_left_alone(self) -> None:
        self.assertTrue(self.decide("db/migrations/__init__.py")[0])

    def test_directory_entries_count_as_one_entry_each(self) -> None:
        folder = self.root / "prisma" / "migrations"
        for name in ("20260101_init", "20260201_orders"):
            (folder / name).mkdir(parents=True)
            (folder / name / "migration.sql").write_text("-- x\n", encoding="utf-8")
        self.write_config({"append_only": ["prisma/migrations"]})

        self.assertFalse(self.decide("prisma/migrations/20260101_init/migration.sql")[0])
        self.assertTrue(self.decide("prisma/migrations/20260201_orders/migration.sql")[0])

    @unittest.skipUnless(os.name == "nt", "case-insensitive paths are a Windows property")
    def test_case_does_not_open_a_way_round_on_windows(self) -> None:
        self.assertFalse(self.decide("DB/Migrations/0001_BASELINE.sql")[0])


class Protected(PlantedRepo):
    def test_a_protected_path_is_blocked_at_any_depth(self) -> None:
        allowed, message = self.decide("tests/fixtures/golden/scenario/one.json")
        self.assertFalse(allowed)
        self.assertIn("tests/fixtures/golden/*", message)

    def test_a_neighbouring_path_is_not(self) -> None:
        self.assertTrue(self.decide("tests/fixtures/other.json")[0])

    def test_a_path_outside_the_repository_is_not_the_guards_business(self) -> None:
        sibling = self.root.parent / (self.root.name + "-sibling") / "db" / "migrations" / "x"
        self.assertTrue(guard.decide(sibling, self.root)[0])


class Configuration(PlantedRepo):
    def test_no_configuration_means_no_rules(self) -> None:
        (self.root / ".claude" / "guard-paths.json").unlink()
        self.assertTrue(self.decide("db/migrations/0001_baseline.sql")[0])

    def test_a_broken_configuration_blocks_rather_than_guarding_nothing(self) -> None:
        (self.root / ".claude" / "guard-paths.json").write_text("{not json", encoding="utf-8")
        allowed, message = self.decide("src/app.py")
        self.assertFalse(allowed)
        self.assertIn("unreadable", message)

    def test_a_broken_configuration_can_still_be_repaired(self) -> None:
        (self.root / ".claude" / "guard-paths.json").write_text("[]", encoding="utf-8")
        self.assertTrue(self.decide(".claude/guard-paths.json")[0])


class HookProtocol(unittest.TestCase):
    """`guard_paths.py` as Claude Code calls it: JSON on stdin, the exit code is the verdict."""

    def run_hook(self, payload: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(GUARD)], input=payload, capture_output=True, text=True, check=False
        )

    def payload(self, tool: str, relative: str) -> str:
        return json.dumps(
            {"tool_name": tool, "tool_input": {"file_path": str(REPO_ROOT / relative)}}
        )

    def test_the_real_configuration_blocks_a_write_into_git(self) -> None:
        result = self.run_hook(self.payload("Edit", ".git/config"))
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("protected", result.stderr)

    def test_an_ordinary_file_is_allowed(self) -> None:
        self.assertEqual(self.run_hook(self.payload("Write", "README.md")).returncode, 0)

    def test_a_tool_that_writes_nothing_is_allowed(self) -> None:
        self.assertEqual(self.run_hook(self.payload("Read", ".git/config")).returncode, 0)

    def test_a_malformed_payload_is_allowed_and_said_out_loud(self) -> None:
        result = self.run_hook("{oops")
        self.assertEqual(result.returncode, 0)
        self.assertIn("could not parse", result.stderr)


class Wiring(unittest.TestCase):
    """The guard only exists if Claude Code runs it."""

    def test_the_real_configuration_loads(self) -> None:
        config = guard.load_config(REPO_ROOT)
        self.assertIn(".git/*", config["protected"])

    def test_settings_register_the_hook_for_every_writing_tool(self) -> None:
        settings = json.loads(SETTINGS.read_text(encoding="utf-8"))
        entries = settings.get("hooks", {}).get("PreToolUse", [])
        commands = {
            hook.get("command", ""): entry.get("matcher", "")
            for entry in entries
            for hook in entry.get("hooks", [])
        }
        wired = {
            cmd: matcher for cmd, matcher in commands.items() if "scripts/hooks/guard.sh" in cmd
        }
        self.assertTrue(wired, f"no PreToolUse hook runs scripts/hooks/guard.sh: {commands}")
        matcher = next(iter(wired.values()))
        for tool in ("Write", "Edit", "MultiEdit"):
            self.assertIn(tool, matcher.split("|"))

    def test_the_entry_point_finds_a_python_and_blocks_through_bash(self) -> None:
        bash = shutil.which("bash")
        if bash is None or "system32" in bash.lower():  # WSL's bash would see other paths
            self.skipTest("no Git Bash / POSIX bash on PATH")
        payload = json.dumps(
            {"tool_name": "Edit", "tool_input": {"file_path": str(REPO_ROOT / ".git" / "config")}}
        )
        result = subprocess.run(
            [bash, str(GUARD_SH)], input=payload, capture_output=True, text=True, check=False
        )
        self.assertEqual(result.returncode, 2, f"stdout={result.stdout!r} stderr={result.stderr!r}")
        self.assertIn("protected", result.stderr)


if __name__ == "__main__":
    unittest.main()
