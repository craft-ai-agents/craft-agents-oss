---
name: procurement-platform-search
description: 在核心采购平台（Digikey、Mouser、云汉、master）上查型号的实时报价、可购库存、产品页、datasheet。当用户需要外部市场价格与货源线索时默认用这个。需要更多原始分销站/聚合站货源时再叠加 procurement-platform-search-more。
metadata:
  short-description: 核心四家平台报价查找
  lang: zh
---

# 核心平台报价查找（默认四家一起搜）

**默认四家平台全部一起搜，合并结果给采购**：① Digikey（得捷）② Mouser（贸泽）③ 云汉（ickey.cn）④ master（masterelectronics.com）。

这四家是日常首选货源，覆盖快、数据干净。**不够时**再用 `procurement-platform-search-more`（更多原始分销站 + 聚合站，按需查）。

不做供应商真假、价格优劣、是否下单、是否可替代判断。

## 默认就这么做（四家一起查，一条命令）

四家统一走 **scrape-engine 引擎**，一条命令并发查完:

    cloakbrowser-python .agents/skills/scrape-engine/engine.py --part "<型号>" --source digikey,mouser,ickey,master 2>/dev/null

`--source` 逗号分隔源 id；批量多个型号用 `--parts "A,B,C"`；`--gate 2` 控并发(4C4G 上保持小)。`2>/dev/null` 必加(否则日志污染 JSON)。输出 `{"rows":[...],"errors":[...]}`，rows 已是**结构化行**(平台/型号是否命中/库存:int/阶梯价/datasheet/链接)，不用再 parse 文本。

## 这些已固化在引擎里（你不用重新摸）

- **Digikey/Mouser** 走官方 API(引擎 api 模式)，凭证在 /etc/craft-agent.env，走代理。
- **master + 云汉(ickey)** 有反爬(master=Akamai、云汉=点击验证码)，引擎用 CloakBrowser 真 Chromium 过，已固化。**别试 curl**。
- **找替代料**：`--source ickey-replace`(云汉替代接口)。
- 引擎按 proxy 分桶复用浏览器、gate 控并发防 OOM、站内串行/站间并行——你只管给 `--source`，别自己写浏览器代码。

→ **反爬怎么绕已固化在引擎里，别重新摸、别试 curl。** 但**查不到货不等于没货，你要为"尽量查到"负责**：
- 引擎默认只查用户给定的原始型号，不自动回退型号变体，避免 0 命中时反复开浏览器拖慢。
- 结果为空或可疑时，再由你按业务需要手动改搜索词、调 `--limit`，或叠加 `procurement-platform-search-more` 扩货源。别一 miss 就报"无此料"。
- 例外：`master` 目录偏继电器/保护/被动件，LED/MCU 这类**确实可能没收录**，回退后仍空就如实写"该平台无此料"，不用硬凑。

## 输出

把四家结果合并给采购（保留可合并字段）：平台、型号是否命中、品牌/品类、库存、价格/MOQ、**交期（现货/期货/交期天数）**、链接、备注；以及阻碍项（哪些平台没查到/被拦）。

**交期必须标清**：每条结果注明是「现货」还是「交期 X 天/周」。平台数据里没明确写的标注"交期待确认"。采购需要这个信息判断能不能满足客户时效。

**品类渠道补充**：四家查完后，根据型号/品牌推断品类，在结果末尾加一句渠道建议（见 AGENTS.md 品类表）。例如连接器类提示"代理/经销商通常更有优势"，工控类提示"线上平台覆盖有限，建议联系代理"。

## 边界

- 平台有结果 ≠ 本地可采购。
- 页面写 alternate/similar ≠ 替代成立。
- 价格/库存数字结合上下文（可能混 MOQ、倍数等），不要直接当报价。
- master 目录偏继电器/保护/被动件，未必有 MCU；无结果如实写"该平台无此料"。
- 浏览器源较慢（每站十几秒）；引擎已用 `--gate` + 按 proxy 分桶复用浏览器防 OOM(4C4G 保持小)，你不用管并发。
