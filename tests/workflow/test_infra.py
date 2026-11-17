"""The VM's scripts and configuration (B-12 T16, T17): structure checks, no network, no VM.

Stdlib `unittest`, as the other workflow checks:
    python -m unittest discover -s tests/workflow -p "test_*.py"

The shell scripts run through Git Bash on Windows, as `test_guard_paths.py` does, and are
skipped without a POSIX bash.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INFRA = REPO_ROOT / "infra"
RECEIVE = INFRA / "receive.sh"


def posix_bash() -> str | None:
    bash = shutil.which("bash")
    if bash is None or "system32" in bash.lower():  # WSL's bash would see other paths
        return None
    return bash


class ReceiveScript(unittest.TestCase):
    def setUp(self) -> None:
        self.bash = posix_bash()
        if self.bash is None:
            self.skipTest("no Git Bash / POSIX bash on PATH")

    def run_receive(self, release_id: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as root:
            env_file = Path(root) / "env"
            env_file.write_text("PORT=8000\n", encoding="utf8")
            environment = {
                "PATH": os.environ.get("PATH", ""),
                "DJV_ROOT": root,
                "DJV_ENV_FILE": str(env_file),
                "SSH_ORIGINAL_COMMAND": release_id,
            }
            result = subprocess.run(
                [self.bash, str(RECEIVE)],
                input="",
                capture_output=True,
                text=True,
                env=environment,
                check=False,
            )
            # Nothing was unpacked or created for a refused id.
            self.assertEqual(sorted(p.name for p in Path(root).iterdir()), ["env"])
            return result

    def test_parses(self) -> None:
        result = subprocess.run([self.bash, "-n", str(RECEIVE)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_strict_mode(self) -> None:
        self.assertIn("set -euo pipefail", RECEIVE.read_text(encoding="utf8"))

    def test_refuses_an_id_that_is_not_40_hex_characters(self) -> None:
        for release_id in [
            "",
            "abc",
            "g" * 40,
            "A" * 40,
            "a" * 39,
            "a" * 41,
            "a" * 40 + "; rm -rf /",
            "../" + "a" * 37,
            "a" * 40 + "\n",
        ]:
            with self.subTest(release_id=release_id):
                result = self.run_receive(release_id)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn("40 lower-case hex characters", result.stderr)


if __name__ == "__main__":
    unittest.main()
