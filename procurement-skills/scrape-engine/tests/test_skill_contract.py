#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path


SKILL = Path(__file__).resolve().parents[1] / "SKILL.md"


class ScrapeEngineSkillContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = SKILL.read_text(encoding="utf-8")

    def test_full_direct_timeout_recovery_preserves_coverage(self) -> None:
        text = self.text
        self.assertIn("整条命令超时", text)
        self.assertIn("`--list-source-set direct`", text)
        self.assertIn("分块", text)
        self.assertIn("不能因为超时改成少量平台", text)
        self.assertIn("合并所有分块的 `rows` / `errors`", text)


if __name__ == "__main__":
    unittest.main()
