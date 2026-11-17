"""The deploy workflow's shape (B-12 T18, AC29, PD23, PD24): line-based, no YAML library.

Stdlib `unittest`, as the other workflow checks:
    python -m unittest discover -s tests/workflow -p "test_*.py"

Every rule is in `problems(text)`, and each one is proved able to fail on a planted copy of the
real file with that rule broken (as `test_gate_steps.py` self-checks).
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY = REPO_ROOT / ".github" / "workflows" / "deploy.yml"
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"

SECRETS = {"DEPLOY_HOST", "DEPLOY_USER", "DEPLOY_SSH_KEY", "DEPLOY_KNOWN_HOSTS"}
CONFIGURED = "steps.configured.outputs.enabled == 'true'"
PACKED = [
    "pnpm-workspace.yaml",
    ".npmrc",
    "pnpm-lock.yaml",
    "shared/package.json",
    "engine/package.json",
    "audio/package.json",
    "server/package.json",
    "web/package.json",
]


def code_lines(text: str) -> list[str]:
    """Lines without comments (a `#` at the start of the stripped line)."""
    return [line for line in text.splitlines() if not line.strip().startswith("#")]


def block(lines: list[str], key: str, indent: int) -> list[str]:
    """The lines under `key:` at `indent`, up to the next key at that indent or less."""
    start = next((i for i, l in enumerate(lines) if l == " " * indent + key + ":"), None)
    if start is None:
        return []
    out = []
    for line in lines[start + 1 :]:
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
            break
        out.append(line)
    return out


def steps_of(lines: list[str]) -> list[list[str]]:
    steps: list[list[str]] = []
    for line in block(lines, "steps", 4):
        if line.startswith("      - "):
            steps.append([line])
        elif steps:
            steps[-1].append(line)
    return steps


def problems(text: str) -> list[str]:
    lines = code_lines(text)
    found: list[str] = []

    on = [l.strip() for l in block(lines, "on", 0) if l.strip()]
    if on != ["workflow_run:", "workflows: [CI]", "types: [completed]", "branches: [main]"]:
        found.append(f"trigger: {on}")

    job_if = [l.strip() for l in lines if l.startswith("    if: ")]
    if len(job_if) != 1 or not (
        "github.event.workflow_run.conclusion == 'success'" in job_if[0]
        and "github.event.workflow_run.event == 'push'" in job_if[0]
        and "||" not in job_if[0]
    ):
        found.append(f"job if: {job_if}")

    if not any("ref: ${{ github.event.workflow_run.head_sha }}" in l for l in lines):
        found.append("no checkout of head_sha")
    if not any("git ls-remote origin refs/heads/main" in l for l in lines):
        found.append("no tip check")

    if [l.strip() for l in block(lines, "concurrency", 0) if l.strip()] != [
        "group: deploy",
        "cancel-in-progress: false",
    ]:
        found.append("concurrency")
    if [l.strip() for l in block(lines, "permissions", 0) if l.strip()] != ["contents: read"]:
        found.append("permissions")

    named = set(re.findall(r"secrets\.([A-Za-z0-9_]+)", "\n".join(lines)))
    if named != SECRETS:
        found.append(f"secrets: {sorted(named)}")

    steps = steps_of(lines)
    if not steps or not any(l.strip() == "id: configured" for l in steps[0]):
        found.append("the first step is not the configured check")
    for step in steps[1:]:
        conditions = [l.strip() for l in step if l.strip().startswith("if:")]
        if not conditions or CONFIGURED not in conditions[0]:
            found.append(f"a step without the configured check: {step[0].strip()}")

    pack = next((s for s in steps if any("tar " in l for l in s)), None)
    if pack is None:
        found.append("no pack step")
    else:
        packed = "\n".join(pack)
        found += [f"not packed: {name}" for name in PACKED if name not in packed]

    if not any("StrictHostKeyChecking=yes" in l for l in lines):
        found.append("host key not checked")
    return found


class DeployWorkflow(unittest.TestCase):
    def setUp(self) -> None:
        self.text = DEPLOY.read_text(encoding="utf8")

    def test_the_real_workflow_has_no_problem(self) -> None:
        self.assertEqual(problems(self.text), [])

    def test_it_follows_the_workflow_named_ci(self) -> None:
        self.assertIn("name: CI", CI.read_text(encoding="utf8").splitlines())

    def planted(self, old: str, new: str) -> list[str]:
        self.assertIn(old, self.text)
        return problems(self.text.replace(old, new, 1))

    def test_each_rule_can_fail(self) -> None:
        cases = {
            "push trigger": ("on:\n  workflow_run:", "on:\n  push:\n  workflow_run:"),
            "other workflow": ("workflows: [CI]", "workflows: [Other]"),
            "other branch": ("branches: [main]", "branches: [main, dev]"),
            "no success check": ("conclusion == 'success' && ", ""),
            "any event": (" && github.event.workflow_run.event == 'push'", ""),
            "checkout of the tip": (
                "ref: ${{ github.event.workflow_run.head_sha }}",
                "ref: main",
            ),
            "no tip check": ("git ls-remote origin refs/heads/main", "echo main"),
            "cancelling": ("cancel-in-progress: false", "cancel-in-progress: true"),
            "other group": ("group: deploy", "group: deploy-${{ github.ref }}"),
            "write permission": ("contents: read", "contents: write"),
            "another secret": (
                "SHA: ${{ github.event.workflow_run.head_sha }}\n        run: |\n          install",
                "SHA: ${{ secrets.OTHER }}\n        run: |\n          install",
            ),
            "configured not first": ("id: configured", "id: first"),
            "a step without if": (
                "      - name: Set up pnpm\n        if: steps.configured.outputs.enabled == 'true' && steps.tip.outputs.current == 'true'\n",
                "      - name: Set up pnpm\n",
            ),
            "workspace file not packed": ("pnpm-workspace.yaml .npmrc", ".npmrc"),
            "a member not packed": ("engine/package.json ", ""),
            "host key unchecked": ("StrictHostKeyChecking=yes", "StrictHostKeyChecking=no"),
        }
        for name, (old, new) in cases.items():
            with self.subTest(rule=name):
                self.assertNotEqual(self.planted(old, new), [], name)


if __name__ == "__main__":
    unittest.main()
