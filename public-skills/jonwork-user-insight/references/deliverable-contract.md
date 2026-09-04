# Craft 用户洞察交付契约

默认生成：

- `data/01-用户洞察预览.md`：给用户直接查看的主交付物。
- `data/01-用户洞察状态.json`：供同一任务后续修改使用，不要求用户阅读。

Markdown 预览依次包含：结论与证据状态、用户画像、场景地图、体验地图、痛点、P0/P1/P2 需求、产品机会、概念方向、待验证假设和验证计划。适合时用表格或 Mermaid 提升可读性。

状态 JSON 保存当前 Brief、界面字段（`researchTask`、`targetMarket`、`targetUser`、`coreScenario`、`focus`、附件与链接）、材料引用、稳定 ID、各章节结构、假设、本轮变更、`conversationDepth`、`answeredQuestions`、`assumedDefaults` 和 `nextBestQuestion`。后续对话优先读取它，修改后同时覆盖预览与状态文件。ID 引用必须存在；0–100 分数注明是判断分而非调研统计；无一手证据时，画像、频次、严重度和优先级均标为待验证假设。

写入两份文件后，立即用预览文件的真实绝对路径输出 `markdown-preview`。不要再附带 `{{SESSION_PATH}}` 或相对路径形式的备用链接；预览组件不可用时直接内联报告正文。

若存在下一项高价值问题，将它放在预览之后，格式为“专业深化（可选）＋一个问题＋推荐默认值”。不得一次询问多个字段，也不得重复 `answeredQuestions` 中已有内容。
