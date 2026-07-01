#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path


SKILL = Path(__file__).resolve().parents[1] / "SKILL.md"


class PlatformSearchSkillOutputContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = SKILL.read_text(encoding="utf-8")

    def test_overview_table_is_the_first_platform_output(self) -> None:
        text = self.text
        self.assertIn("平台总览表", text)
        self.assertIn("| 平台 | 状态 | 返回型号 | 库存 | 最低价/MOQ | 交期 | 证据 | 备注 |", text)
        self.assertLess(text.index("平台总览表"), text.index("详细结果"))

    def test_overview_table_has_one_row_per_direct_platform(self) -> None:
        text = self.text
        self.assertIn("每个 `--source-set direct` 平台必须一行", text)
        self.assertIn("表格平台数必须等于 `--list-source-set direct` 展开的平台数", text)

    def test_aggregator_stays_after_user_confirmation(self) -> None:
        text = self.text
        self.assertIn("二轮聚合：未使用，待用户确认", text)
        self.assertIn("是否继续跑聚合平台补充/交叉验证？ `--source-set aggregator`", text)

    def test_platform_skill_does_not_rank_purchase_recommendations(self) -> None:
        text = self.text
        self.assertIn("不做采购推荐排序", text)


if __name__ == "__main__":
    unittest.main()
