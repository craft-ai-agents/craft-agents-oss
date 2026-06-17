---
name: procurement-feishu-table-fill
description: 把采购线索或分析结果写入飞书 Base 的 AI 专用表，含建表、字段校验、dry-run 预览和用户确认。当用户说“把结果填进表/写到飞书表格/录入这些数据”，需要把前面查到的型号、报价、库存、供应商结果落库时使用。只负责写入；查询类用对应的 procurement-* 查询 skill。
metadata:
  short-description: 飞书表格写入
  lang: zh
---

# 飞书表格写入

把其他 skill 或人工整理好的结构化记录，用 `lark-cli base` 写入**专用 AI Base**。只写，不读业务表、不生成线索、不判断业务。

## 写入目标（专用 AI Base，可写）

- **AI 写入 Base：`AI-采购数据`，base-token `FrzDbGwmVa0YkAsd7g6c5pDHnlg`**（陈昊楠所有、可写；和只读的「供应商管理」业务 Base 分开）。
- 所有 AI 写入都进这个 Base 的 `AI-` 前缀表。**绝不写业务 Base**（`Mjlkb49B9aoptssVw8Jc0wGwnhh`，那是只读的，写会 403）。

## 写入安全（硬规则）

- 只写本 AI Base 里 `AI-` 前缀的表。
- 表名不得是业务表名：供应商档案、查找库存、客户库存、A/B/C级供应商库存、自家库存、数据字典、采购询价表、客户订单审批、订单记录。
- 流程：表名校验（`AI-` 前缀）→ 表不存在先建 → **dry-run 预览给用户确认** → 确认后才正式写 → append-only（不去重、不合并）。

## 怎么写（lark-cli base，子命令必须带 `+` 前缀）

1. **建表**（仅当该 `AI-` 表不存在；字段 `type` 用字符串 `"text"`/`"number"` 等，不是数字）：

       lark-cli base +table-create --base-token FrzDbGwmVa0YkAsd7g6c5pDHnlg --name "AI-采购线索明细" --fields '[{"field_name":"型号","type":"text"},{"field_name":"品牌","type":"text"},{"field_name":"来源","type":"text"},{"field_name":"备注","type":"text"}]'

2. **dry-run 预览**（务必先做，把目标表/字段/行数/内容给用户看，等确认）：

       lark-cli base +record-batch-create --base-token FrzDbGwmVa0YkAsd7g6c5pDHnlg --table-id "AI-采购线索明细" --json '{"fields":["型号","品牌","来源","备注"],"rows":[["STM32F103C8T6","ST","Mouser","有库存"]]}' --dry-run

3. **用户确认后正式写**（去掉 `--dry-run`）。

`--table-id` 可直接用表名。`--json` 形状：`{"fields":[字段名...],"rows":[[与字段同序的值...]...]}`。

## 边界

- 只写 AI Base 的 `AI-` 表，不碰业务 Base。
- 不跳 dry-run，未确认不写；append-only 不去重；只校验字段名不校验业务逻辑；建表字段默认文本。
- 权限/登录失效错误**如实报告**，不要假装写成功。
