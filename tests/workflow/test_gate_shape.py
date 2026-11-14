"""The gate's shape beyond its step list (B-08 SD5, AC8, AC9; plan PD12, PD13, T6).

- `scripts/check.sh` warns, once, right before the browser step, when 127.0.0.1:8123 cannot be
  bound, and the warning says why and how to find the process. It never refuses or kills.
- The port it checks is the gate's port in `tests/browser/fixtures/launch.ts`.
- No retry is configured anywhere: vitest `retry`, Playwright `retries`, or a retry flag in a
  root script or the gate. A retry is the cheapest way to make a flake look fixed.

Stdlib `unittest`, like the other workflow tests:
    python -m unittest tests/workflow/test_gate_shape.py
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECK_SH = REPO_ROOT / "scripts" / "check.sh"
LAUNCH_TS = REPO_ROOT / "tests" / "browser" / "fixtures" / "launch.ts"
VITEST_CONFIG = REPO_ROOT / "vitest.config.ts"
PLAYWRIGHT_CONFIG = REPO_ROOT / "playwright.config.ts"
PACKAGE_JSON = REPO_ROOT / "package.json"

WARN_FN = "warn_if_gate_port_held"

STEP_LINE = re.compile(r'^\s*project_step\s+"([^"]+)"\s+\S')
CALL_LINE = re.compile(r"^\s*" + WARN_FN + r"\s*$")
FN_BODY = re.compile(r"^" + WARN_FN + r"\(\)\s*\{\n(.*?)^\}", re.MULTILINE | re.DOTALL)
GATE_PORT_TS = re.compile(r"export const GATE_PORT = (\d+);")
PORT_NUMBER = re.compile(r"\b(8\d{3})\b")

VITEST_RETRY = re.compile(r"\bretry\s*:\s*([^,\n}]+)")
PLAYWRIGHT_RETRIES = re.compile(r"\bretries\s*:\s*([^,\n}]+)")
RETRY_FLAG = re.compile(r"--retr(?:y|ies)(?:[= ](\S+))?")


def call_position(text: str) -> tuple[list[int], int, int]:
    """Line indexes of the warning calls, the integration step and the browser step."""
    lines = text.splitlines()
    calls = [i for i, line in enumerate(lines) if CALL_LINE.match(line)]
    steps = {m.group(1): i for i, line in enumerate(lines) if (m := STEP_LINE.match(line))}
    return calls, steps.get("integration", -1), steps.get("browser", -1)


def warning_body(text: str) -> str:
    match = FN_BODY.search(text)
    return match.group(1) if match else ""


def retry_settings(vitest: str, playwright: str, scripts: dict[str, str], gate: str) -> list[str]:
    """Every retry setting or flag whose value is not 0, as `<where>: <value>`."""
    found: list[str] = []
    found += [f"vitest retry: {v.strip()}" for v in VITEST_RETRY.findall(vitest) if v.strip() != "0"]
    found += [
        f"playwright retries: {v.strip()}"
        for v in PLAYWRIGHT_RETRIES.findall(playwright)
        if v.strip() != "0"
    ]
    for name, command in scripts.items():
        found += [f"script {name}: --retry {v or '(no value)'}" for v in RETRY_FLAG.findall(command) if v != "0"]
    found += [f"check.sh: --retry {v or '(no value)'}" for v in RETRY_FLAG.findall(gate) if v != "0"]
    return found


class PortWarningTest(unittest.TestCase):
    def setUp(self) -> None:
        self.gate = CHECK_SH.read_text(encoding="utf-8")

    def test_called_once_right_before_the_browser_step(self) -> None:
        calls, integration, browser = call_position(self.gate)
        self.assertEqual(len(calls), 1, f"{WARN_FN} must be called exactly once")
        self.assertLess(integration, calls[0])
        self.assertEqual(calls[0] + 1, browser, "the call must sit on the line before the browser step")

    def test_warning_names_the_port_the_cause_and_how_to_find_it(self) -> None:
        body = warning_body(self.gate)
        self.assertNotEqual(body, "", f"no {WARN_FN}() definition in check.sh")
        for needle in ("8123", "node", "pnpm start", "Playwright", "netstat -ano", "lsof -i :8123", ">&2"):
            self.assertIn(needle, body)

    def test_warning_never_refuses_or_kills(self) -> None:
        body = warning_body(self.gate)
        for forbidden in ("exit", "kill", "taskkill", "sleep", "wait"):
            self.assertNotRegex(body, r"\b" + forbidden + r"\b")
        self.assertRegex(body, r"\breturn 0\b")

    def test_checks_the_gate_port_from_the_launch_module(self) -> None:
        gate_port = GATE_PORT_TS.search(LAUNCH_TS.read_text(encoding="utf-8"))
        self.assertIsNotNone(gate_port, "no GATE_PORT in launch.ts")
        ports = set(PORT_NUMBER.findall(warning_body(self.gate)))
        self.assertEqual(ports, {gate_port.group(1)})

    def test_parsers_see_a_planted_gate(self) -> None:
        planted = (
            f'{WARN_FN}() {{\n  echo "8000 node pnpm start" >&2\n  exit 1\n}}\n'
            'project_step "integration" x\n'
            f"{WARN_FN}\n"
            'project_step "lint" y\n'
            'project_step "browser" z\n'
        )
        calls, integration, browser = call_position(planted)
        self.assertEqual((calls, integration, browser), ([5], 4, 7))
        self.assertIn("exit 1", warning_body(planted))
        self.assertEqual(set(PORT_NUMBER.findall(warning_body(planted))), {"8000"})


class NoRetryTest(unittest.TestCase):
    def test_no_retry_is_configured_anywhere(self) -> None:
        scripts = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["scripts"]
        found = retry_settings(
            VITEST_CONFIG.read_text(encoding="utf-8"),
            PLAYWRIGHT_CONFIG.read_text(encoding="utf-8"),
            scripts,
            CHECK_SH.read_text(encoding="utf-8"),
        )
        self.assertEqual(found, [])

    def test_parser_sees_each_planted_retry(self) -> None:
        found = retry_settings(
            "test: { retry: 2, name: 'unit' }",
            "export default defineConfig({ retries: process.env.CI ? 2 : 0 })",
            {"test": "vitest run --retry=3", "ok": "vitest run --retry 0"},
            "pnpm test:browser --retries 1\n",
        )
        self.assertEqual(
            found,
            [
                "vitest retry: 2",
                "playwright retries: process.env.CI ? 2 : 0",
                "script test: --retry 3",
                "check.sh: --retry 1",
            ],
        )

    def test_zero_is_not_a_retry(self) -> None:
        self.assertEqual(retry_settings("retry: 0,", "retries: 0,", {}, ""), [])


if __name__ == "__main__":
    unittest.main()
