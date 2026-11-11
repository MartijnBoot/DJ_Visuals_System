"""The mechanical half of the plan audit, as a gate step.

A plan in `docs/plans/` is also `/build`'s work queue, so its structure is not decoration. A
task without `Depends on` cannot be scheduled; a `Depends on` naming a task that does not
exist, or a cycle, turns the build order into a guess; an acceptance criterion that no task
implements means the plan is incomplete (way-of-working 4.2, step 4). This script checks what
can be checked without judgement. Whether each expected output is what the product needs
stays with `/audit` or `plan-auditor`.

Checked, for every `docs/plans/phase-*.md` except `*-human-steps.md`:

- a `Spec:` line naming a spec file that exists;
- at least one task (`### T<n> -- <name>`), each with Implements, Expected output,
  Verification, Depends on and Autonomy note;
- every `Depends on` names tasks of the same plan (or says none), and the graph has no cycle.
  Notes in parentheses are not read as dependencies;
- traceability both ways: every AC the spec defines is implemented by a task, or named under a
  heading that accounts for it without one ("Out of scope", "Human steps", "Owner steps"); and
  every task implements at least one AC or spec decision (`SD<n>`).

Proven on 13 audited plans of the project it was extracted from: 12 passed, and the 13th had
a real slip (its own traceability table credited two tasks with an AC their Implements lines
did not name).

Usage:

    python scripts/check_plans.py                     every plan (the gate step)
    python scripts/check_plans.py <plan.md> ...       just these
    python scripts/check_plans.py --graph <plan.md>   the build order and parallel groups

Exit 0 when clean, 1 on any finding. Stdlib only.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PLANS_DIR = REPO_ROOT / "docs" / "plans"

REQUIRED_FIELDS = ("Implements", "Expected output", "Verification", "Depends on", "Autonomy note")

NONE = "\u2014"  # em dash: how a plan writes "no dependency"
DASHES = "\u2014\u2013-"  # em dash, en dash, hyphen
TASK_HEADING = re.compile(r"^#{3,4}\s+(T\d+[a-z]?)\b")
HEADING = re.compile(r"^(#{1,6})\s")
# `- **Implements:** AC1`, `- Implements: AC1`, `- **Expected output**, after T3: ...`
FIELD_LINE = re.compile(
    r"^(?P<indent>\s*)[-*]\s+\**\s*(?P<name>" + "|".join(REQUIRED_FIELDS) + r")\s*\**"
    r"\s*(?:,[^:]*)?:\s*\**\s*(?P<value>.*)$",
    re.IGNORECASE,
)
# Headings whose section may account for an AC without a task: Out of scope, and the steps
# only a person can do (`## Human steps`, `### Owner steps after T14`).
ACCOUNTED_SECTION = re.compile(r"out of scope|human step|owner step", re.IGNORECASE)
PARENTHETICAL = re.compile(r"\([^()]*\)")
SD_TOKEN = re.compile(r"\bSD\d+\b")
SPEC_LINE = re.compile(r"^\s*\**Spec\**\s*:", re.IGNORECASE)
LINK_TARGET = re.compile(r"\]\(([^)\s]+)\)")
SPEC_PATH = re.compile(r"[\w./-]*specs/[\w.-]+\.md")
AC_DEFINITION = re.compile(r"^\s*(?:#{1,6}\s+)?(?:[-*]\s+)?(?:\|\s*)?\**\s*AC(\d+)\b")
AC_RANGE = re.compile(r"AC(\d+)\s*[" + DASHES + r"]\s*(?:AC)?(\d+)")
AC_TOKEN = re.compile(r"\bAC(\d+)\b")
TASK_TOKEN = re.compile(r"\bT\d+[a-z]?\b")
NONE_MARKER = re.compile(r"^\W*(?:[" + DASHES + r"]|none|nothing|n/a)\W*$", re.IGNORECASE)


@dataclass
class Task:
    task_id: str
    line: int
    fields: dict[str, str] = field(default_factory=dict)


@dataclass
class Plan:
    path: Path
    spec_ref: str | None
    tasks: list[Task]
    accounted_acs: set[int]  # named under Out of scope or the human/owner steps


def ac_numbers(text: str) -> set[int]:
    """Every AC a piece of text names, with ranges such as `AC3-AC5` expanded."""
    numbers = {int(n) for n in AC_TOKEN.findall(text)}
    for start, end in AC_RANGE.findall(text):
        low, high = sorted((int(start), int(end)))
        numbers.update(range(low, high + 1))
    return numbers


def defined_acs(spec_text: str) -> set[int]:
    """The ACs a spec defines: lines that start with `AC<n>`, as a bullet, row or heading."""
    matches = (AC_DEFINITION.match(line) for line in spec_text.splitlines())
    return {int(match.group(1)) for match in matches if match}


def parse_plan(text: str, path: Path) -> Plan:
    lines = text.splitlines()
    spec_ref = next((line for line in lines if SPEC_LINE.match(line)), None)

    tasks: list[Task] = []
    accounted: set[int] = set()
    current: Task | None = None
    accounted_level = 0  # the level of the heading that opened an accounted section; 0 = none
    open_field: str | None = None
    open_indent = 0

    for number, line in enumerate(lines, start=1):
        heading = HEADING.match(line)
        if heading:
            level = len(heading.group(1))
            open_field = None
            if accounted_level and level <= accounted_level:
                accounted_level = 0
            task_match = TASK_HEADING.match(line)
            if task_match:
                current = Task(task_match.group(1), number)
                tasks.append(current)
                continue
            if level <= 3:
                current = None
            if ACCOUNTED_SECTION.search(line):
                accounted_level = level
                accounted.update(ac_numbers(line))
            continue

        if accounted_level:
            accounted.update(ac_numbers(line))

        if current is None:
            continue
        field_match = FIELD_LINE.match(line)
        if field_match:
            name = next(f for f in REQUIRED_FIELDS if f.lower() == field_match["name"].lower())
            current.fields[name] = field_match["value"].strip()
            open_field = name
            open_indent = len(field_match["indent"])
        elif open_field and line.strip():
            indent = len(line) - len(line.lstrip())
            if indent > open_indent:
                joined = f"{current.fields[open_field]} {line.strip()}"
                current.fields[open_field] = joined.strip()
            else:
                open_field = None

    return Plan(path, spec_ref, tasks, accounted)


def resolve_spec(plan: Plan, root: Path) -> Path | None:
    if plan.spec_ref is None:
        return None
    candidates = LINK_TARGET.findall(plan.spec_ref) + SPEC_PATH.findall(plan.spec_ref)
    for candidate in candidates:
        for base in (plan.path.parent, root):
            resolved = (base / candidate).resolve()
            if resolved.is_file():
                return resolved
    return None


def dependencies(task: Task) -> set[str] | None:
    """The tasks `task` depends on, an empty set for none, `None` if the field is unreadable.

    Parenthesised notes are not dependencies: in `T5, T6 (both T6 and T7 write x.ts)` the
    note explains the edge, and `T11a (T11b if built)` names a condition, not a task.
    """
    value = task.fields.get("Depends on", "")
    while PARENTHETICAL.search(value):
        value = PARENTHETICAL.sub(" ", value)
    named = set(TASK_TOKEN.findall(value))
    if named:
        return named
    return set() if NONE_MARKER.match(value) else None


def parallel_groups(plan: Plan) -> list[list[str]] | None:
    """Tasks grouped by depth in the dependency graph; `None` if there is a cycle."""
    deps = {task.task_id: (dependencies(task) or set()) for task in plan.tasks}
    depth: dict[str, int] = {}
    remaining = dict(deps)
    while remaining:
        ready = [t for t, d in remaining.items() if all(x in depth for x in d if x in deps)]
        if not ready:
            return None
        for task_id in ready:
            depth[task_id] = 1 + max((depth[x] for x in deps[task_id] if x in deps), default=-1)
            del remaining[task_id]
    groups: list[list[str]] = [[] for _ in range(max(depth.values(), default=-1) + 1)]
    for task in plan.tasks:
        groups[depth[task.task_id]].append(task.task_id)
    return groups


def check_plan(plan: Plan, root: Path) -> list[str]:
    findings: list[str] = []

    spec_path = resolve_spec(plan, root)
    if plan.spec_ref is None:
        findings.append("no `Spec:` line naming the spec this plan implements")
    elif spec_path is None:
        findings.append(f"the `Spec:` line names no spec file that exists: {plan.spec_ref.strip()}")

    if not plan.tasks:
        findings.append("no tasks: expected headings like `### T1 -- <name>`")
        return findings

    ids = [task.task_id for task in plan.tasks]
    for task_id in sorted({t for t in ids if ids.count(t) > 1}):
        findings.append(f"{task_id} is defined more than once")

    known = set(ids)
    for task in plan.tasks:
        where = f"{task.task_id} (line {task.line})"
        for name in REQUIRED_FIELDS:
            if name not in task.fields:
                findings.append(f"{where}: missing `{name}`")
        if "Depends on" in task.fields:
            deps = dependencies(task)
            if deps is None:
                findings.append(f"{where}: `Depends on` names no task; write `{NONE}` for none")
            else:
                for missing in sorted(deps - known):
                    findings.append(
                        f"{where}: depends on {missing}, which this plan does not define"
                    )
                if task.task_id in deps:
                    findings.append(f"{where}: depends on itself")
        implements = task.fields.get("Implements")
        if implements is not None and not (ac_numbers(implements) or SD_TOKEN.search(implements)):
            findings.append(f"{where}: implements no AC or spec decision (an orphan task)")

    if parallel_groups(plan) is None:
        findings.append("the `Depends on` graph has a cycle")

    if spec_path is not None:
        spec_acs = defined_acs(spec_path.read_text(encoding="utf-8"))
        if not spec_acs:
            findings.append(f"{spec_path.name} defines no acceptance criteria (`AC1. When ...`)")
        implemented: set[int] = set()
        for task in plan.tasks:
            implemented |= ac_numbers(task.fields.get("Implements", ""))
        for number in sorted(spec_acs - implemented - plan.accounted_acs):
            findings.append(
                f"AC{number} is implemented by no task, and not named under Out of scope or "
                f"the human steps"
            )
        for number in sorted(implemented - spec_acs):
            findings.append(f"a task implements AC{number}, which {spec_path.name} does not define")

    return findings


def plan_files(root: Path) -> list[Path]:
    plans = root / "docs" / "plans"
    if not plans.is_dir():
        return []
    return [
        path
        for path in sorted(plans.glob("phase-*.md"))
        if not path.name.endswith("-human-steps.md")
    ]


def display(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def run_checks(paths: list[Path], root: Path) -> int:
    if not paths:
        print("check_plans: no plans yet (docs/plans/phase-*.md); nothing to check")
        return 0
    total = 0
    for path in paths:
        plan = parse_plan(path.read_text(encoding="utf-8"), path)
        findings = check_plan(plan, root)
        total += len(findings)
        status = "ok" if not findings else f"{len(findings)} finding(s)"
        print(f"check_plans: {display(path, root)}: {len(plan.tasks)} task(s), {status}")
        for finding in findings:
            print(f"  - {finding}")
    return 0 if total == 0 else 1


def print_graph(path: Path, root: Path) -> int:
    plan = parse_plan(path.read_text(encoding="utf-8"), path)
    groups = parallel_groups(plan)
    if groups is None:
        print(f"check_plans: {display(path, root)}: the `Depends on` graph has a cycle")
        return 1
    print(f"Build order for {display(path, root)} (a group needs only the groups above it):")
    for index, group in enumerate(groups, start=1):
        print(f"  group {index}: {', '.join(group)}")
    for task in plan.tasks:
        deps = ", ".join(sorted(dependencies(task) or set(), key=task_order)) or NONE
        print(f"  {task.task_id} depends on: {deps}")
    return 0


def task_order(task_id: str) -> tuple[int, str]:
    """`T4` before `T10`, `T11a` before `T11b`."""
    match = re.match(r"T(\d+)(.*)", task_id)
    return (int(match.group(1)), match.group(2)) if match else (0, task_id)


def main(argv: list[str] | None = None, root: Path = REPO_ROOT) -> int:
    # A Windows console or pipe is often cp1252; a plan quoting a character it lacks must not
    # crash the gate step that reports on it.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    parser = argparse.ArgumentParser(description="Check plan structure and traceability.")
    parser.add_argument("--graph", action="store_true", help="print the build order of one plan")
    parser.add_argument("plans", nargs="*", type=Path, help="plan files (default: every plan)")
    args = parser.parse_args(argv)

    if args.graph:
        if len(args.plans) != 1:
            parser.error("--graph takes exactly one plan")
        return print_graph(args.plans[0], root)
    return run_checks(args.plans or plan_files(root), root)


if __name__ == "__main__":
    sys.exit(main())
