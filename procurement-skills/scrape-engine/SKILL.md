---
name: scrape-engine
description: 采购平台采集/爬取技术层。统一用 scrape-engine 访问已接入平台、API、XHR、DOM 页面和反爬站，维护平台接入状态、爬取限制、聚合关系和替代采集源；当需要外部平台库存、价格、产品页、datasheet、替代候选等原始证据时使用。只产出结构化证据，不做采购推荐、供应商判断或可替代结论。
metadata:
  short-description: 平台采集引擎
  lang: zh
---

# 采购平台采集引擎

本 skill 是**技术取数层**，不是采购业务判断层。它负责维护平台爬取状态、选择采集 adapter、运行 `engine.py`，并把外部平台返回的数据统一成 JSON 证据。

## 职责边界

本 skill 负责：

- 维护平台接入和爬取状态：`source_catalog.yaml` 是平台状态的单一事实来源。
- 选择并调用 `engine.py --source <ids>`，或在必要时用 `scripts/cloak_fetch.py` 做单页渲染取证。
- 维护 API / XHR / DOM / script adapter 的可用性、反爬 profile、代理、并发和失败分类。
- 返回 `rows` / `errors` JSON 证据。

本 skill 不负责：

- 不判断供应商真假、价格优劣、是否下单、是否可替代。
- 不决定库存优先级、找料流程、供应商分类或采购下一步。
- 不输出面向采购人员的最终业务话术。

## 反合理化表格

| 常见借口 | 反驳 |
|---|---|
| “我直接用 WebFetch / curl / 临时浏览器脚本抓一下更快。” | 走 `engine.py` 或已有 adapter；反爬、代理、warmup、并发和 host lock 是采集正确性的一部分。 |
| “静态状态是 enabled，就可以当作这个平台有结果。” | 静态状态只说明 adapter 应尝试；命中、无命中、访问受限和错误必须以当次 JSON 为准。 |
| “DOM 文本里出现了型号，我就填库存和价格字段。” | body dump 只能进 `note`；没有结构化 API/XHR 解析就不要伪造 `stock` / `price_breaks`。 |
| “blocked / error 就说明平台没有这个料。” | 采集阻碍不是无货结论；只能返回阻碍状态，让后续语境解释。 |

## 平台状态维护

`source_catalog.yaml` 维护每个平台/source 的静态状态：

- `display_name`：平台展示名。
- `tier`：采集层分组，例如 core / more / reference / deprecated。
- `channel_type` / `categories`：平台能力元数据，只用于选择和解释证据，不能直接推出采购结论。
- `status`：静态接入状态。
  - `enabled`：adapter 已接入，选中时应尝试采集。
  - `limited`：有 adapter，但站点访问敏感或经常受限。
  - `reference_only`：只适合作原厂/资料参考，不作为库存价格源。
  - `deprecated`：不是有效库存源，保留迁移或替代关系。
- `covers` / `covered_by` / `related_to` / `replacements`：聚合器覆盖、关联站点或迁移替代关系。
- `note` / `user_status`：采集限制或解释提示。

每次查询的真实状态以 `engine.py` 当次返回为准。静态 `status=enabled` 不等于当次一定命中；当次 `blocked=true` / `errors` 也不等于平台永久不可用。

## 调用方式

标准型号查询：

```bash
cloakbrowser-python .agents/skills/scrape-engine/engine.py --part "<型号>" --source "<source-id[,source-id...]>" 2>/dev/null
```

多型号查询：

```bash
cloakbrowser-python .agents/skills/scrape-engine/engine.py --parts "<型号1>,<型号2>" --source "<source-id[,source-id...]>" 2>/dev/null
```

没有明确 source 时，先读 `source_catalog.yaml` 和 `registry.py`，按数据需求选择 source。
`--source` 必须使用 `source_catalog.yaml` / `registry.py` 中的 source id 原文；不要把连字符改成下划线，例如 `rs-uk`、`rs-jp`、`element14-cn`、`misumi-jp` 不能写成 `rs_uk`、`element14_cn`、`misumi_jp`。
全平台或多平台查询也要显式传入 `--source "<source-id[,source-id...]>"`；不要省略 `--source` 触发 registry 的隐式 all_ids，因为 registry 可能包含替代、迁移或诊断 adapter，既会拉长运行时间，也会污染平台覆盖口径。

整页渲染取证只在 `engine.py` 没有合适 adapter、且确实需要打开目标页时使用：

```bash
cloakbrowser-python .agents/skills/scrape-engine/scripts/cloak_fetch.py "<URL>" 2>/dev/null
```

不要手写临时 CloakBrowser / Playwright 脚本。反爬、代理、warmup、重试、并发和 host lock 都应固化在本引擎。

## 输出契约

`engine.py` 输出 JSON：

```json
{
  "rows": [
    {
      "part": "查询型号",
      "platform": "source-id 或聚合器内的真实来源",
      "mpn": "平台返回型号",
      "brand": "品牌",
      "package": "封装",
      "stock": 0,
      "in_stock": false,
      "price_breaks": [{"qty": 1, "rmb": null, "usd": 0.0}],
      "lead_time": "原始交期文本",
      "datasheet": "datasheet URL",
      "product_url": "产品页 URL",
      "description": "平台描述",
      "category": "平台分类",
      "blocked": false,
      "availability_status": "maintenance | no_result | null",
      "note": "原始备注或 body dump"
    }
  ],
  "errors": [
    {"platform": "source-id", "part": "查询型号", "error": "技术错误"}
  ]
}
```

字段语义：

- `stock=null` 是未知，`stock=0` 是已知无库存，不要混用。
- `in_stock=null` 是未知，不能当作无货。
- `blocked=true` 或 `errors` 是本次采集阻碍，不是平台无货。
- `availability_status=maintenance` 是站点维护/临时离线，不是反爬阻断，也不是无货。
- `availability_status=no_result` 是 adapter 正常执行但本次没有返回产品行。
- DOM/body dump adapter 只能把原始文本放在 `note`；不要伪装成结构化库存/价格。
- API/XHR adapter 才能填充结构化 `stock` / `price_breaks` / `lead_time`。

## 更新规则

新增或修复平台时：

1. 在 `adapters/` 增加或修复 adapter。
2. 在 `registry.py` 注册 source id。
3. 在 `source_catalog.yaml` 更新静态状态、限制、聚合关系和说明。
4. 运行 `engine.py --part "<已知型号>" --source "<source-id>"` 验证返回 JSON。
5. 在本 skill / `source_catalog.yaml` 记录爬取状态。
