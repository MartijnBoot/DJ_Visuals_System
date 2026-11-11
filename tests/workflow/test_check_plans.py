"""The plan checker: each finding it exists to raise, on a planted plan, plus the templates.

The checker is the mechanical half of the plan audit, so a regression here is a plan audit
that silently got weaker. Every rule therefore has a planted plan that breaks it, and the plan
and spec templates in docs/ are checked against each other so that the format the commands
teach and the format the gate enforces cannot drift apart.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CHECKER = REPO_ROOT / "scripts" / "check_plans.py"


def _load_checker():
    spec = importlib.util.spec_from_file_location("check_plans", CHECKER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["check_plans"] = module
    spec.loader.exec_module(module)
    return module


cp = _load_checker()

SPEC = """\
# Spec: phase 3 -- orders

Status: Approved

## Acceptance criteria

- **AC1.** When an order is placed, the system shall store it.
- **AC2.** If the store is down, then the system shall answer 503.
- **AC3.** While closed, the system shall refuse orders.
"""

PLAN = """\
# Plan: phase 3 -- orders

Spec: [docs/specs/phase-3-orders.md](../specs/phase-3-orders.md)

## Tasks

### T1 — Store an order
- **Implements:** AC1, AC2
- **Expected output:** `OrderRepository.create()` writes one row, proven by `test_create`.
- **Verification:** `pytest tests/test_orders.py`
- **Depends on:** —
- **Autonomy note:** names are the builder's; a schema change is a stop-and-ask.

### T2 — Refuse while closed
- **Implements:** AC3
- **Expected output**, after T1 lands:
  - `place()` raises `Closed` while the shop is closed.
- **Verification:** `pytest tests/test_closed.py`
- **Depends on:** T1 (the repository it calls)
- **Autonomy note:** none beyond the task.

## Out of scope for this plan

- Refunds.
"""


class PlantedPlan(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name).resolve()
        (self.root / "docs" / "specs").mkdir(parents=True)
        (self.root / "docs" / "plans").mkdir(parents=True)
        self.spec_path = self.root / "docs" / "specs" / "phase-3-orders.md"
        self.spec_path.write_text(SPEC, encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def findings(self, plan_text: str) -> list[str]:
        path = self.root / "docs" / "plans" / "phase-3-orders.md"
        path.write_text(plan_text, encoding="utf-8")
        return cp.check_plan(cp.parse_plan(plan_text, path), self.root)

    def assertFinding(self, plan_text: str, fragment: str) -> None:
        found = self.findings(plan_text)
        self.assertTrue(any(fragment in f for f in found), f"no finding with {fragment!r}: {found}")


class WellFormed(PlantedPlan):
    def test_a_well_formed_plan_has_no_findings(self) -> None:
        self.assertEqual(self.findings(PLAN), [])

    def test_a_note_in_parentheses_is_not_a_dependency(self) -> None:
        plan = cp.parse_plan(PLAN.replace("T1 (the repository", "T1 (T2 reads what"), Path("p"))
        self.assertEqual(cp.dependencies(plan.tasks[1]), {"T1"})

    def test_an_ac_range_counts_every_ac_in_it(self) -> None:
        self.assertEqual(cp.ac_numbers("AC2\u2013AC4 and AC7"), {2, 3, 4, 7})

    def test_the_graph_gives_the_build_order(self) -> None:
        plan = cp.parse_plan(PLAN, Path("p"))
        self.assertEqual(cp.parallel_groups(plan), [["T1"], ["T2"]])


class Structure(PlantedPlan):
    def test_a_missing_field(self) -> None:
        self.assertFinding(
            PLAN.replace("- **Autonomy note:** none beyond the task.\n", ""),
            "T2 (line 14): missing `Autonomy note`",
        )

    def test_a_dependency_on_a_task_that_does_not_exist(self) -> None:
        self.assertFinding(PLAN.replace("T1 (the repository it calls)", "T9"), "depends on T9")

    def test_a_dependency_field_that_names_nothing(self) -> None:
        self.assertFinding(
            PLAN.replace("T1 (the repository it calls)", "the first one"), "names no task"
        )

    def test_a_cycle(self) -> None:
        self.assertFinding(PLAN.replace("- **Depends on:** —", "- **Depends on:** T2"), "cycle")

    def test_a_plan_without_tasks(self) -> None:
        self.assertFinding("# Plan\n\nSpec: docs/specs/phase-3-orders.md\n", "no tasks")

    def test_a_spec_that_does_not_exist(self) -> None:
        self.assertFinding(
            PLAN.replace("phase-3-orders.md", "phase-9-nothing.md"),
            "names no spec file that exists",
        )


class Traceability(PlantedPlan):
    def test_an_ac_no_task_implements(self) -> None:
        self.assertFinding(PLAN.replace("AC1, AC2", "AC1"), "AC2 is implemented by no task")

    def test_an_ac_named_under_out_of_scope_is_accounted_for(self) -> None:
        plan = PLAN.replace("AC1, AC2", "AC1").replace("- Refunds.", "- AC2: moved to phase 4.")
        self.assertEqual(self.findings(plan), [])

    def test_an_ac_left_to_a_human_step_is_accounted_for(self) -> None:
        plan = PLAN.replace("AC1, AC2", "AC1") + "\n## Human steps\n\n- H1 proves AC2 on dev.\n"
        self.assertEqual(self.findings(plan), [])

    def test_an_orphan_task(self) -> None:
        self.assertFinding(
            PLAN.replace("- **Implements:** AC3", "- **Implements:** tidy-up"), "orphan"
        )

    def test_a_task_that_serves_a_spec_decision_is_not_an_orphan(self) -> None:
        plan = PLAN.replace("- **Implements:** AC3", "- **Implements:** SD4 (docs)")
        plan = plan.replace("- Refunds.", "- AC3: later.")
        self.assertEqual(self.findings(plan), [])

    def test_an_ac_the_spec_does_not_define(self) -> None:
        self.assertFinding(PLAN.replace("AC1, AC2", "AC1, AC2, AC9"), "AC9, which")


class CommandLine(PlantedPlan):
    def test_the_gate_step_is_red_on_a_finding_and_green_on_none(self) -> None:
        bad = self.root / "docs" / "plans" / "phase-3-orders.md"
        bad.write_text(PLAN.replace("AC1, AC2", "AC1"), encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(cp.main([], root=self.root), 1)
        self.assertIn("AC2", out.getvalue())

        bad.write_text(PLAN, encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cp.main([], root=self.root), 0)

    def test_human_steps_files_are_not_plans(self) -> None:
        (self.root / "docs" / "plans" / "phase-3-human-steps.md").write_text("# H\n", "utf-8")
        self.assertEqual(cp.plan_files(self.root), [])


class Templates(unittest.TestCase):
    """The format the commands teach is the format the gate enforces."""

    def test_the_plan_template_satisfies_the_checker_against_the_spec_template(self) -> None:
        spec_text = (REPO_ROOT / "docs" / "specs" / "_template.md").read_text(encoding="utf-8")
        plan_path = REPO_ROOT / "docs" / "plans" / "_template.md"
        plan = cp.parse_plan(plan_path.read_text(encoding="utf-8"), plan_path)

        self.assertGreaterEqual(len(plan.tasks), 2)
        for task in plan.tasks:
            missing = [f for f in cp.REQUIRED_FIELDS if f not in task.fields]
            self.assertEqual(missing, [], f"{task.task_id} in the plan template lacks {missing}")
            self.assertIsNotNone(cp.dependencies(task), task.task_id)
        self.assertIsNotNone(cp.parallel_groups(plan))

        spec_acs = cp.defined_acs(spec_text)
        self.assertTrue(spec_acs, "the spec template defines no AC")
        implemented = set().union(*(cp.ac_numbers(t.fields["Implements"]) for t in plan.tasks))
        self.assertEqual(spec_acs - implemented - plan.accounted_acs, set())

    def test_this_repositorys_own_plans_pass(self) -> None:
        self.assertTrue((REPO_ROOT / "docs" / "plans").is_dir(), "docs/plans/ is missing")
        with contextlib.redirect_stdout(io.StringIO()) as out:
            status = cp.run_checks(cp.plan_files(REPO_ROOT), REPO_ROOT)
        self.assertEqual(status, 0, out.getvalue())


if __name__ == "__main__":
    unittest.main()
