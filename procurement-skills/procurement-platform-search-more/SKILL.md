---
name: procurement-platform-search-more
description: 核心四家（Digikey/Mouser/云汉/master，见 procurement-platform-search）之外的更多货源——一批原始分销站（按区域/品类）+ 聚合站。当核心四家查不够、需要更广货源或特定品类（连接器/电源/FA机械件/停产料/气动件等）线索时叠加使用。按型号品类选源，不默认全查。
metadata:
  short-description: 扩展货源（更多原始站+聚合站）
  lang: zh
---

# 扩展货源查找（核心四家之外，按需选源）

先用 `procurement-platform-search` 查核心四家（Digikey/Mouser/云汉/master）。**不够、或要特定品类货源时**用本 skill 补。

**按型号品类选 `--source`，不要一次全开**（几十个站串行会很慢）。下面按品类列了该选哪些。聚合站 octopart **默认不查**（聚合数据可能滞后，原始站优先），只在确实要扩货源时按需加。

## 两个脚本

**API 源（无需浏览器，快）—— `api_search.py`：**

    python3 .agents/skills/procurement-platform-search-more/scripts/api_search.py --part "<型号>" --source vanlinkon
    # element14 需先配 ELEMENT14_API_KEY（partner.element14.com 免费注册），否则报缺 key

- `vanlinkon`（连可连，中国连接器商城）：多仓报盘（自营/代销/RS），库存/¥价/交期。
- `element14`（element14/Farnell/Newark 官方 API）：需 API key；拿到 key 即返干净 JSON，绕开网页反爬。

**渲染/专用源（CloakBrowser，有反爬）—— `cloak_search.py`，必须 `--source`：**

    cloakbrowser-python .agents/skills/procurement-platform-search-more/scripts/cloak_search.py --part "<型号>" --source future,newark 2>/dev/null

`2>/dev/null` 必加（日志污染 JSON）。串行、每站十几秒，**只选相关的几个**。

## 货源清单（按品类选 `--source`）

**通用电子料 / 西方·欧洲分销：**
- `future`（Future）`newark`（Newark）`tme`（波兰/欧）`xonelec`（X-ON）`componentonline`（Component Electronics）
- RS 分区：`rs-uk` `rs-jp` `rs-hk`；`rs-us`（=Allied 美区，**需住宅代理**，仅生产可用）

**连接器 / 机电互连：**
- `peigenesis`（PEI-Genesis 连接器专家）`darisus`（德，连接器）`heilind`（赫联，连接器/机电）`sager`（电源/连接器/机电）

**被动 / 连接器 / 机电（TTI 系）：**
- `tti`（被动/连接器/机电，sager 源头，**需住宅代理**）

**停产 / EOL 半导体：**
- `rochester`（停产/EOL 半导体官方授权源，找停产料专用）

**中国境内现货：**
- `lcsc`（立创国际站）`szlcsc`（立创国内商城，RMB/现货）`jbchip`（京北通宇）

**FA 机械件（注意：关键词→可配置系列，非 MPN 报价，系列级无单价，单独用）：**
- `misumi`（米思米中国）`misumi-jp`（米思米日本）

**MRO / 工业：**
- `monotaro`（日本 MRO，带部分电子/IC 料）`corestaff`（CoreStaff 日本/ZaikoStore）`ocpneumatics`（SMC 气动元件经销）

**聚合站（默认不查，确需扩货源才按需加）：**
- `octopart`（多分销商报价聚合：Avnet/Newark/Arrow/DigiKey/Mouser/LCSC 等）
- `octopart-alt`（octopart 部件详情页的跨品牌替代料对比表）

## 反爬挡住/未接（如实告知，别硬试）

- `arrow`、`element14`（网页）、`avnet`：Akamai/门户反爬把住宅 IP 信誉拉黑，网页路径攻不下。**element14 改走官方 API**（上面 `--source element14`，配 key 即可）。arrow/avnet 的货源 octopart 有覆盖。
- 不接：`rs-cn`（无可搜中国 storefront）、`chip1stop`（整站 502，被 Arrow 吞并迁移中，货源≈arrow）、`kirikaeki`（已关站）、`distrelec`（=RS 集团跳转）、`TI`（无通用关键词搜索，按 `ti.com/product/<MPN>` 作原厂产品页）。

## 取数与重试（已固化在脚本里）

- 抽取策略：渲染站把搜索页**渲染成可见文本交你直接读**（型号/库存/价格自己解析，不写选择器）；SPA/有接口的站**拦数据接口取结构化字段**——技术细节在各 scraper 函数注释里，你不用管。
- 单站 0 命中**自动回退型号变体**一档（去连字符 / 去末位封装字母）；命中变体时带 `matched_query`，输出要点明"封装/包装可能不同"。
- 结果里 `blocked=true` = 被反爬拦（不是无货），如实标"被拦未取到"，别当"无此料"。

## 输出与边界

- 合并进核心四家结果一起给采购：平台、是否命中、品牌/品类、库存、价格/MOQ、**交期（现货/期货/天数）**、链接、备注、阻碍项。
- 平台有结果 ≠ 本地可采购；alternate/similar ≠ 替代成立；价格/库存数字结合上下文（可能混 MOQ/倍数）。
- FA 机械件（misumi）是货源线索不是报价，系列级无单价，价格要进详情页配置后才有。
- CloakBrowser 串行+用完即关防 OOM，**别在脚本内并发多开**。
