"""The Node range refuses the release that crashes the gate (D-03).

Node 24.15.0 on Windows has a stack buffer overrun in libuv's TCP code (nodejs/node#62991,
fixed in 24.16.0): a process that makes TCP connections dies at random with 0xC0000409. In
the gate that is a vitest integration worker dying mid-`fetch`, about one run in eight. The
root `package.json` `engines.node` range must exclude it and stay on Node 24, and `.npmrc`
`engine-strict` must make pnpm refuse it (otherwise the range is only a warning).

Stdlib `unittest`, like the other workflow tests:
    python -m unittest tests/workflow/test_node_range.py
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_JSON = REPO_ROOT / "package.json"
NPMRC = REPO_ROOT / ".npmrc"

COMPARATOR = re.compile(r"^(>=|<)(\d+)(?:\.(\d+))?(?:\.(\d+))?$")

Version = tuple[int, int, int]


def parse_range(text: str) -> list[tuple[str, Version]]:
    """`>=a.b.c <d` style ranges only: space-separated `>=` and `<` comparators, all ANDed.

    Anything else raises, so an unexpected range fails the test instead of passing it.
    """
    comparators = []
    for part in text.split():
        match = COMPARATOR.match(part)
        if not match:
            raise ValueError(f"engines.node part not understood: {part!r} in {text!r}")
        op, major, minor, patch = match.groups()
        comparators.append((op, (int(major), int(minor or 0), int(patch or 0))))
    if not comparators:
        raise ValueError(f"engines.node is empty: {text!r}")
    return comparators


def allows(text: str, version: Version) -> bool:
    for op, bound in parse_range(text):
        if op == ">=" and not version >= bound:
            return False
        if op == "<" and not version < bound:
            return False
    return True


def engines_node() -> str:
    return json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["engines"]["node"]


class NodeRangeTest(unittest.TestCase):
    def test_refuses_the_release_that_crashes_on_windows(self) -> None:
        self.assertFalse(allows(engines_node(), (24, 15, 0)), engines_node())

    def test_allows_the_fixed_release_and_stays_on_node_24(self) -> None:
        node = engines_node()
        self.assertTrue(allows(node, (24, 16, 0)), node)
        self.assertTrue(allows(node, (24, 22, 3)), node)
        self.assertFalse(allows(node, (23, 99, 0)), node)
        self.assertFalse(allows(node, (25, 0, 0)), node)

    def test_pnpm_refuses_a_node_outside_the_range(self) -> None:
        lines = [line.strip() for line in NPMRC.read_text(encoding="utf-8").splitlines()]
        self.assertIn("engine-strict=true", lines)

    def test_parser_sees_the_old_range_allowing_the_bad_release(self) -> None:
        self.assertTrue(allows(">=24 <25", (24, 15, 0)))
        self.assertFalse(allows(">=24.16.0 <25", (24, 15, 0)))

    def test_parser_refuses_a_range_it_does_not_understand(self) -> None:
        for text in ("^24.16.0", ">=24 || >=26", "", "24.x"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_range(text)


if __name__ == "__main__":
    unittest.main()
