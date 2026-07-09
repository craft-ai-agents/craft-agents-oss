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

    def test_inventory_lookup_status_is_fixed_before_platform_overview(self) -> None:
        text = self.text
        self.assertIn("库存查找情况", text)
        self.assertIn("本地库存：已查询 / 未查询", text)
        self.assertIn("结果：无记录 / 有记录 / 用户直接要求外部平台", text)
        self.assertLess(text.index("库存查找情况"), text.index("平台总览表"))

    def test_overview_table_covers_component_data_envelope_sources(self) -> None:
        text = self.text
        self.assertIn("component-data", text)
        self.assertIn("sources[]", text)
        self.assertIn("sources_total", text)
        self.assertIn("每个源必须一行", text)

    def test_status_vocabulary_separates_no_match_from_fetch_failure(self) -> None:
        text = self.text
        self.assertIn("无匹配", text)
        self.assertIn("本次未取到", text)
        self.assertIn("不做采购推荐排序", text)

    def test_full_pass_not_core_platform_sample(self) -> None:
        text = self.text
        self.assertIn("直接全量跑", text)
        self.assertNotIn("二轮聚合", text)


if __name__ == "__main__":
    unittest.main()
