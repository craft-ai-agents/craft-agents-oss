---
name: procurement-alternative-search
description: 给一个电子元器件型号（停产/缺货/想找替代），查找候选替代料并判断能不能真替。当用户问”X 有没有替代料/找个能替 X 的/X 停产了用什么/pin to pin 替代/有没有兼容料”时使用。
metadata:
  short-description: 查找替代料
  lang: zh
---

# 查找替代料

给一个型号：先拿原型号的规格基线，再找候选替代料，逐个把规格跟基线对比、判断能不能真替，给采购一份可用的替代清单。

## 第零步：先拿原型号的规格基线（对比的标尺）

找替代的本质是“候选规格 vs 原型号规格”，先把原型号关键规格搞清，作为后面判断的标尺。怎么拿：

- 用 `procurement-model-info-search`（查清品牌/品类/封装/核心规格/生命周期），或
- 直接 `python3 .agents/skills/procurement-platform-search/scripts/api_search.py --part "<原型号>"`（拿厂牌/品类/封装/datasheet/描述），或
- 从第一步 octopart-alt 对比表的左列（This Part）直接读。

记下关键项作标尺：**封装/引脚、核心参数（电压/精度/容值/频率/Memory/接口等）、温度/认证、生命周期**。

## 第一步：找候选（多个源，cloak 源可分别起 Bash）

1. **Octopart 替代料（最强：跨品牌 + 规格逐项对比，优先用）**：

       cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_search.py --part "<型号>" --source octopart-alt 2>/dev/null

   返回 Octopart 详情页 Alternate Parts 对比表：原型号 vs 替代型号（含**跨品牌**，如 STM32 ↔ Microchip ATSAM），逐列对比封装/引脚/内核/主频/Memory/电压/接口/外设 + Price@1000/库存。**这张表同时给了候选和第二步判断要的规格对比。**

2. **云汉原生替代料接口（国内料，带规格摘要）**：

       cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_search.py --part "<型号>" --source ickey-replace 2>/dev/null

   返回每个替代料：`型号 | 规格摘要 | 品类 | 库存 | 交期 | 阶梯价 | datasheet`。

3. **网查 cross-reference**：WebSearch `"<型号>" cross reference / replacement / equivalent / 替代型号`，找原厂或第三方替换表、停产替代通知（PCN）。

4. **同品类同规格换品牌**：用上面拿到的规格（封装+核心参数），在平台搜其它品牌的同规格料作候选。

把候选去重，每个记：替代型号、品牌、规格、来源、库存/价（有就带）。

## 第二步：逐项对比 + 判断每个候选能不能真替

对每个候选，把它的规格跟第零步的**原型号基线逐项对比**（封装/引脚、核心参数、温度、认证、pin 兼容性），再按 `procurement-part-mismatch-review` 的规则收敛结论：

- **octopart-alt 的对比表**已经把原型号和替代并排列好，直接读差异最快。
- 其它来源（云汉 replace / 网查 / 同规格换品牌）的候选：用候选的 datasheet/平台规格 vs 基线对比；规格不全就去查候选的资料补上。
- 收敛：**关键项全兼容 = 能替；任一关键项冲突 = 不能替；规格缺项 = 需补料**。别只凭型号相近或规格摘要像就说能替。

## 输出

替代清单，按可用度排：

- 替代型号 | 品牌 | 规格 | 来源 | 库存/价 | **判断结论（能替/不能替/需补料）| 理由**
- 没找到能替的就如实说，并列出查过哪些源、缺什么资料。

## 边界

- 规格摘要相近 ≠ 能替；结论以差异判断为准。
- 最终可用性要采购/工程确认（pin compatible、认证、客户是否接受）。
- 本 skill 负责找候选 + 判断能不能替。
