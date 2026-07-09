#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "SKILL.md"
FINDING_RECIPE = ROOT / "references" / "scenario-part-finding.md"
PLATFORM_SEARCH_SKILL = ROOT.parent / "procurement-platform-search" / "SKILL.md"
COMPONENT_DATA_SKILL = ROOT.parent / "component-data" / "SKILL.md"

# Phrases owned by platform-search / component-data. Finding recipe must name
# those skills, not restate their rules (fork → silent drift).
OWNED_BY_OTHER_SKILLS = [
    "不要手工截取清单",
    "不要挑“核心平台”",
    "不要分轮——直接全量跑",
    "别因为过了一分钟没返回就中断重跑",
    "本次未取到",
]


class BatchOrchestrationSkillContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.finding_recipe_text = FINDING_RECIPE.read_text(encoding="utf-8")
        cls.platform_search_text = PLATFORM_SEARCH_SKILL.read_text(encoding="utf-8")
        cls.component_data_text = COMPONENT_DATA_SKILL.read_text(encoding="utf-8")
        cls.owner_corpus = cls.platform_search_text + "\n" + cls.component_data_text

    def test_skill_body_does_not_hardcode_a_task_type(self) -> None:
        text = self.text
        self.assertIn("本 skill 只管编排机制,不认识具体任务类型", text)
        self.assertIn("父会话自己", text)
        self.assertNotIn("component-data <", text)
        self.assertNotIn("engine.py", text)

    def test_one_batch_is_one_task_type(self) -> None:
        text = self.text
        self.assertIn("一批只处理一种任务类型", text)
        self.assertIn("混合任务类型", text)

    def test_full_platform_children_throttle_only_after_observed_pressure(self) -> None:
        text = self.text
        self.assertIn("默认最多并行 5 个子会话", text)
        self.assertIn("只有已经观测到命令超时或资源压力", text)
        self.assertIn("再临时收缩到 2-3 个", text)

    def test_children_write_details_via_larkdepot_and_report_briefly(self) -> None:
        text = self.text
        self.assertIn("larkdepot", text)
        self.assertIn("批量任务结果写回", text)
        self.assertNotIn("feishu-db", text)
        self.assertNotIn("batch-upsert", text)
        self.assertIn("回传只发短状态", text)
        self.assertIn("不要把完整结果粘到回传消息里", text)
        self.assertIn("父会话最终汇总从 `larkdepot` 读取", text)

    def test_finding_recipe_points_to_owning_skills_by_name(self) -> None:
        text = self.finding_recipe_text
        self.assertIn("procurement-platform-search", text)
        self.assertIn("component-data", text)
        self.assertIn("这里不重复那些规则", text)

    def test_finding_recipe_does_not_fork_a_copy_of_other_skills_rules(self) -> None:
        text = self.finding_recipe_text
        for phrase in OWNED_BY_OTHER_SKILLS:
            self.assertIn(
                phrase,
                self.owner_corpus,
                f"sanity check failed: {phrase!r} isn't even in the owning skill anymore",
            )
            self.assertNotIn(
                phrase,
                text,
                f"finding recipe restates {phrase!r}, which belongs to platform-search/component-data",
            )

    def test_finding_recipe_only_adds_batch_specific_content(self) -> None:
        text = self.finding_recipe_text
        self.assertIn("汇总表列名", text)
        self.assertIn("batch-orchestration 独有", text)


if __name__ == "__main__":
    unittest.main()
