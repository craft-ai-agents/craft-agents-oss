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

## 默认就这么做（四家都查，两个脚本都跑，可并发）

**Digikey + Mouser —— 官方 API：**

    python3 .agents/skills/procurement-platform-search/scripts/api_search.py --part "<型号>"

**云汉(ickey) + master —— CloakBrowser（有反爬/需真浏览器）：**

    cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_search.py --part "<型号>" 2>/dev/null

两个脚本都要跑（独立，可并发起两个 Bash），把结果**合并**给采购。`2>/dev/null` 必加，否则日志污染 JSON。CloakBrowser 串行、每平台十几秒。

## 这些已固化在脚本里（你不用重新摸）

- **Digikey/Mouser** 有官方 API，api_search.py 直接调，凭证在 /etc/craft-agent.env，走代理。**别用浏览器**。
- **master + 云汉(ickey)** 有反爬（master=Akamai Bot Manager、云汉=点击验证码），普通 curl/WebFetch 一律失败，脚本用 CloakBrowser 真 Chromium 过，怎么过已固化。**别试 curl**。
- **找替代料**：`--source ickey-replace`（云汉替代接口，给型号返回替代/相似料候选）。

→ **反爬怎么绕已固化在脚本里，别重新摸、别试 curl。** 但**查不到货不等于没货，你要为"尽量查到"负责**：
- 脚本对**单平台 0 命中已自动回退型号变体**一档（原始 → 去连字符 → 去末位封装字母，如 Tape&Reel 的尾缀 `S`）；命中时结果里带 `matched_query`，说明命中的是变体而非原串，输出时要点明"封装/包装可能不同"。
- 回退后**仍为空或结果可疑**时，**该自己再试**：换更激进的型号变体、调 `--limit`，或叠加 `procurement-platform-search-more` 扩货源。别一 miss 就报"无此料"。
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
- CloakBrowser 较慢（每平台十几秒），脚本已串行+用完即关防 OOM，**别在脚本内并发多开**。
