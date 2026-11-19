"""The VM's scripts and configuration (B-12 T16, T17): structure checks, no network, no VM.

Stdlib `unittest`, as the other workflow checks:
    python -m unittest discover -s tests/workflow -p "test_*.py"

The shell scripts run through Git Bash on Windows, as `test_guard_paths.py` does, and are
skipped without a POSIX bash. Each rule on a file is a function over its text, so a planted
file proves the rule can fail (as `test_gate_steps.py` self-checks).
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INFRA = REPO_ROOT / "infra"
RECEIVE = INFRA / "receive.sh"
REBUILD = INFRA / "rebuild.sh"
CADDYFILE = INFRA / "Caddyfile"
UNIT = INFRA / "systemd" / "djvisuals.service"
BACKUP_UNIT = INFRA / "systemd" / "djvisuals-backup.service"
TIMER = INFRA / "systemd" / "djvisuals-backup.timer"
JOURNALD = INFRA / "journald-djvisuals.conf"
SUDOERS = INFRA / "sudoers-djvisuals-deploy"


def posix_bash() -> str | None:
    bash = shutil.which("bash")
    if bash is None or "system32" in bash.lower():  # WSL's bash would see other paths
        return None
    return bash


def lines_of(text: str) -> list[str]:
    """The lines that are neither blank nor a comment, stripped."""
    stripped = (line.strip() for line in text.splitlines())
    return [line for line in stripped if line and not line.startswith("#")]


# --- T16: the deploy user's forced command -------------------------------------------------


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


# --- T17: the VM's files -------------------------------------------------------------------


def caddy_problems(text: str) -> list[str]:
    targets = [line for line in lines_of(text) if line.startswith("reverse_proxy")]
    if not targets:
        return ["no reverse_proxy"]
    return [line for line in targets if not re.fullmatch(r"reverse_proxy 127\.0\.0\.1:\S+", line)]


def unit_problems(text: str) -> list[str]:
    lines = lines_of(text)
    problems = []
    exec_start = [line for line in lines if line.startswith("ExecStart=")]
    if exec_start != ["ExecStart=/usr/bin/node /srv/djvisuals/current/server/src/main.ts"]:
        problems.append(f"ExecStart: {exec_start}")
    problems += [line for line in lines if line.startswith("Environment=")]
    if "EnvironmentFile=/etc/djvisuals/env" not in lines:
        problems.append("no EnvironmentFile=/etc/djvisuals/env")
    if "User=djvisuals" not in lines:
        problems.append("not User=djvisuals")
    return problems


def timer_problems(text: str) -> list[str]:
    lines = lines_of(text)
    problems = []
    calendars = [line for line in lines if line.startswith("OnCalendar=")]
    if calendars != ["OnCalendar=*-*-* 03:00:00 UTC"]:
        problems.append(f"OnCalendar: {calendars}")
    if "Persistent=true" not in lines:
        problems.append("not Persistent=true")
    return problems


def journald_problems(text: str) -> list[str]:
    return [] if "MaxRetentionSec=14day" in lines_of(text) else ["retention is not 14 days"]


SUDO_RULE = re.compile(
    r"deploy ALL=\(root\) NOPASSWD: "
    r"/usr/bin/systemctl (restart|stop|start) djvisuals"
    r"(, /usr/bin/systemctl (restart|stop|start) djvisuals)*"
)


def sudoers_problems(text: str) -> list[str]:
    lines = lines_of(text)
    if not lines:
        return ["no rule"]
    return [line for line in lines if not SUDO_RULE.fullmatch(line)]


KEY_SHAPED = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----"
    r"|(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) AAAA[0-9A-Za-z+/]{20,}"
    r"|AKIA[0-9A-Z]{16}"
    r"|ocid1\.[a-z]+\.oc1\.[a-z0-9.-]*\.[a-z0-9]{20,}"
)


def key_problems(text: str) -> list[str]:
    return [match.group(0)[:20] for match in KEY_SHAPED.finditer(text)]


class VmFiles(unittest.TestCase):
    def test_caddy_proxies_only_to_loopback(self) -> None:
        self.assertEqual(caddy_problems(CADDYFILE.read_text(encoding="utf8")), [])
        self.assertTrue(caddy_problems("x {\n\treverse_proxy 10.0.0.5:8000\n}\n"))
        self.assertTrue(caddy_problems("x {\n\treverse_proxy 127.0.0.1:8000 0.0.0.0:9\n}\n"))
        self.assertTrue(caddy_problems("x {\n\tfile_server\n}\n"))

    def test_the_unit_runs_current_and_sets_no_environment_value(self) -> None:
        good = UNIT.read_text(encoding="utf8")
        self.assertEqual(unit_problems(good), [])
        self.assertTrue(unit_problems(good + "Environment=OIDC_ISSUER=x\n"))
        self.assertTrue(unit_problems(good.replace("current/server", "releases/x/server")))

    def test_the_backup_unit_uses_the_env_file_and_sets_no_value(self) -> None:
        lines = lines_of(BACKUP_UNIT.read_text(encoding="utf8"))
        self.assertIn("EnvironmentFile=/etc/djvisuals/env", lines)
        self.assertEqual([line for line in lines if line.startswith("Environment=")], [])
        self.assertIn(
            "ExecStart=/usr/bin/node /srv/djvisuals/current/server/src/backup-cli.ts backup", lines
        )

    def test_the_timer_is_daily(self) -> None:
        self.assertEqual(timer_problems(TIMER.read_text(encoding="utf8")), [])
        self.assertTrue(timer_problems("[Timer]\nOnCalendar=weekly\nPersistent=true\n"))
        self.assertTrue(timer_problems("[Timer]\nOnCalendar=*-*-* 03:00:00 UTC\n"))

    def test_logs_are_kept_14_days(self) -> None:
        self.assertEqual(journald_problems(JOURNALD.read_text(encoding="utf8")), [])
        self.assertTrue(journald_problems("[Journal]\nMaxRetentionSec=30day\n"))

    def test_sudoers_names_only_restart_stop_start_of_the_service(self) -> None:
        self.assertEqual(sudoers_problems(SUDOERS.read_text(encoding="utf8")), [])
        self.assertTrue(sudoers_problems("deploy ALL=(root) NOPASSWD: ALL\n"))
        self.assertTrue(
            sudoers_problems(
                "deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart djvisuals, /usr/bin/bash\n"
            )
        )
        self.assertTrue(
            sudoers_problems("deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart caddy\n")
        )

    def test_no_file_in_infra_holds_a_key(self) -> None:
        for path in sorted(INFRA.rglob("*")):
            if path.is_file():
                with self.subTest(path=path.name):
                    self.assertEqual(key_problems(path.read_text(encoding="utf8")), [])
        self.assertTrue(key_problems("-----BEGIN OPENSSH PRIVATE KEY-----"))
        self.assertTrue(key_problems("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample"))
        self.assertTrue(key_problems("AKIAIOSFODNN7EXAMPLE"))

    def test_rebuild_parses_and_is_strict(self) -> None:
        bash = posix_bash()
        if bash is None:
            self.skipTest("no Git Bash / POSIX bash on PATH")
        result = subprocess.run([bash, "-n", str(REBUILD)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("set -euo pipefail", REBUILD.read_text(encoding="utf8"))

    def test_rebuild_checks_sudoers_before_installing_it(self) -> None:
        text = REBUILD.read_text(encoding="utf8")
        self.assertLess(text.index("visudo -cf"), text.index("/etc/sudoers.d/djvisuals-deploy"))


if __name__ == "__main__":
    unittest.main()
