"""The gate's project steps, by name and in order (spec AC2, SD9; plan PD18).

Reading the gate's output proves the order once; this test proves it on every run, so a step
that is reordered, renamed or dropped from `scripts/check.sh` turns the gate red.

Stdlib `unittest`, like the other workflow tests:
    python -m unittest tests/workflow/test_gate_steps.py
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECK_SH = REPO_ROOT / "scripts" / "check.sh"

EXPECTED = ["format", "lint", "types", "build", "unit", "integration", "browser"]

# A call, not the function definition: `project_step "<name>" <command...>` at line start.
STEP_CALL = re.compile(r'^\s*project_step\s+"([^"]+)"\s+\S', re.MULTILINE)


def project_steps(text: str) -> list[str]:
    return STEP_CALL.findall(text)


class GateStepsTest(unittest.TestCase):
    def test_project_steps_are_the_spec_order(self) -> None:
        self.assertEqual(project_steps(CHECK_SH.read_text(encoding="utf-8")), EXPECTED)

    def test_parser_sees_a_reordered_gate(self) -> None:
        # Self-check: the parser is not vacuously agreeing.
        planted = 'project_step "lint" pnpm lint\nproject_step "format" pnpm format:check\n'
        self.assertEqual(project_steps(planted), ["lint", "format"])

    def test_parser_ignores_the_function_definition(self) -> None:
        planted = 'project_step() {\n  step "$@"\n}\nproject_step "unit" pnpm test\n'
        self.assertEqual(project_steps(planted), ["unit"])

    def test_no_project_checks_warning_remains(self) -> None:
        self.assertNotIn("no project checks", CHECK_SH.read_text(encoding="utf-8").lower())


if __name__ == "__main__":
    unittest.main()
