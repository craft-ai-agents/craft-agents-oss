# Craft 设计提案交付契约

默认生成：

- `data/03-设计提案预览.md`：给用户直接评审的完整方案。
- `data/03-设计提案状态.json`：供后续对话继续修改。
- `data/00-业务闭环预览.md`：汇总用户洞察、竞品洞察与设计提案的追溯关系。

设计提案预览包含：结论速览、输入依据、定位、目标用户与场景、需求—机会—决策追溯、推荐概念、必要备选、功能、形态、CMF、人机、结构材料、合规、成本、风险、验证计划和开放问题。

状态 JSON 必须保存界面字段（`proposalTitle`、`audience`、`reviewStage`、`focus`、附件与链接）、`positioning`、`targetUsers`、`scenarios`、`functions`、`formLanguage`、`cmf`、`ergonomics`、`structureMaterials`、`compliance`、`costConstraints`、`risks`、`validationPlan`，以及概念、引用关系、假设、本轮变化、`conversationDepth`、`answeredQuestions`、`assumedDefaults` 和 `nextBestQuestion`。

推荐概念覆盖 P0 需求和主要竞品机会；具体数值区分已知约束与目标假设；每个高风险项都有验证任务。后续对话同时更新状态、提案预览和闭环预览。

文件写入后立即用真实绝对路径渲染 `03-设计提案预览.md`；用户要求查看闭环时再渲染 `00-业务闭环预览.md`。禁止输出 `{{SESSION_PATH}}` 或相对路径链接，预览组件不可用时直接内联正文。

若仍有会改变推荐概念或工程路径的关键取舍，预览后只提出一个“专业深化（可选）”问题，给出最多 3 个选项和推荐默认值；不得重复已回答事项。
