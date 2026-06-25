---
name: procurement-platform-search-more
description: 核心四家（Digikey/Mouser/云汉/master）之外的更多货源——一批原始分销站（按区域/品类）+ 聚合站。当核心四家查不够、需要更广货源或特定品类（连接器/电源/FA机械件/停产料/气动件等）线索时叠加使用。按型号品类选源，不默认全查。
metadata:
  short-description: 扩展货源（更多原始站+聚合站）
  lang: zh
---

# 扩展货源查找（核心四家之外，按需选源）

> **DRAFT — 演示如何切到 scrape-engine。未生效，勿覆盖线上 SKILL.md。**
> 反爬/住宅代理路径**尚未在 4C4G 生产机验证**；切换门槛见
> `scrape-engine/CUTOVER.md`。在门槛通过前，**走代理/反爬的源仍用旧脚本兜底，
> 旧脚本不删**。

本 skill 查核心四家之外的更多货源：一批原始分销站 + 聚合站。核心四家不够、或要特定品类货源时用它补。

**按型号品类选 `--source`，不要一次全开**（几十个站串行慢；引擎并发也按需选源更快）。聚合站 octopart **默认不查**（聚合数据可能滞后，原始站优先），只在确实要扩货源时按需加。

## 引擎调用（新路径，单脚本统一入口）

一个引擎，按 `--source` 选源，源 id 与旧脚本完全一致：

    cloakbrowser-python /home/cunningham/Projects/craft-agents-oss/procurement-skills/scrape-engine/engine.py \
        --parts "<型号1,型号2>" --source future,newark --gate 2 2>/dev/null

- `--parts "A,B"` 批量；单型号用 `--part "A"`（向后兼容）。
- `--gate 2`：全局 OOM 上限（4C4G 保持小，默认 2）。引擎按主机串行/跨站并行，无需自己起多个 Bash。
- `2>/dev/null` 必加（日志污染 JSON）。

**选源分层 —— 先 API/xhr/聚合，浏览器渲染源放最后**（越靠前越快越稳，越靠后越慢越易被反爬）：

1. **API / xhr 直连源（最快，无浏览器或仅拦接口）**：`vanlinkon`(连可连，多仓¥报盘)、`verical`(Arrow 自营商城，实时报盘)、`element14-cn`(e络盟中国店，RMB 阶梯价)、`szlcsc-overseas`/`szlcsc`/`lcsc`(立创系)、`ickey-replace`(替代料)。
2. **聚合源（按需，不默认）**：`octopart`(多分销商比价)、`octopart-alt`(跨品牌替代料对比表)。聚合数据可能滞后，原始站优先。
3. **浏览器渲染源（最后、最慢、最易被反爬）**：通用 SSR-dump 站（`future`/`newark`/`tme`/`xonelec`/`componentonline`/`peigenesis`/`darisus`/`corestaff`/`monotaro`/`misumi`/`misumi-jp`/`heilind`/`sager`/`rochester`/`jbchip`），以及**走反爬/住宅代理的**`avnet`/`master`/`tti`/`rs-us`/`rs-uk`/`rs-jp`/`rs-hk`/`arrow`。

> ⚠ 第 3 层里**带反爬/住宅代理的源（`avnet`/`master`/`tti`/`rs-us`/`arrow`/`newark` 等 needs_proxy 站）目前 PROD-GATED**——引擎里尚未在生产机验证。这些源**暂仍走旧脚本兜底**（见下「旧脚本兜底」），别从引擎信任其结果，直到 CUTOVER 门槛通过。

## 货源清单（按品类选 `--source`，id 同旧脚本）

**通用电子料 / 西方·欧洲分销：**
- `future` `newark` `tme` `xonelec` `componentonline`
- RS 分区：`rs-uk` `rs-jp` `rs-hk`；`rs-us`（=Allied 美区，**需住宅代理**，PROD-GATED）
- `verical`（**Verical = Arrow 自营商城，机房直连可达、实时报盘**）：arrow 本站被反爬封死，要 arrow 货源就用它（比聚合站 octopart 更实时）。
- `element14-cn`（**e络盟中国店 cn.element14.com，机房直连、RMB 阶梯价**）：要 element14 货源就用这个，国际站被封、官方 API 门户长期 500。
- `avnet`（**Avnet 本站，主业分销真库存 + USD 阶梯价 + 交期**）：PerimeterX 间歇放行，引擎用 warmup+多轮重试打穿，**能出真数据但较慢且 PROD-GATED**；多轮仍被挡时如实标"被拦未取到"，octopart 兜底。

**连接器 / 机电互连：** `peigenesis` `darisus` `heilind` `sager`
**被动 / 连接器 / 机电（TTI 系）：** `tti`（**需住宅代理**，PROD-GATED）
**停产 / EOL 半导体：** `rochester`
**中国境内现货：** `lcsc`（立创国际站）`szlcsc`/`szlcsc-overseas`（立创商城，RMB/现货，境内直连）`jbchip`（京北通宇）
**FA 机械件（关键词→可配置系列，系列级无单价，单独用）：** `misumi` `misumi-jp`
**MRO / 工业：** `monotaro` `corestaff` `ocpneumatics`（SMC 气动）
**聚合站（默认不查）：** `octopart` `octopart-alt`

## 旧脚本兜底（PROD-GATED 路径未验证前，必须保留）

反爬/住宅代理/API 路径在生产机验证通过前，这些源**仍走旧脚本**，旧脚本**不删**：

    # 反爬/代理源 兜底（avnet/master/tti/rs-us/arrow/newark 等）
    cloakbrowser-python .agents/skills/procurement-platform-search-more/scripts/cloak_search.py \
        --part "<型号>" --source avnet 2>/dev/null

    # API 直连源 兜底（vanlinkon；element14 官方 API 已废→改 element14-cn 渲染源）
    python3 .agents/skills/procurement-platform-search-more/scripts/api_search.py \
        --part "<型号>" --source vanlinkon

引擎只对**已验证的直连源**（`szlcsc-overseas`/`octopart` 直连/`element14-cn`/`verical`/`ickey-replace` 及其余 `needs_proxy=False` 源）启用；反爬/代理源用引擎跑出的结果不作准，以旧脚本为准。回滚 = 对受门控的 `--source` 改回旧脚本调用，旧脚本随时可用。

## 反爬挡住/未接（如实告知，别硬试）

- `arrow`、`element14` 国际站：Akamai/门户反爬把 IP 信誉拉黑（机房+住宅两个 IP 都被封）。**别硬撞**：arrow 货源 → `--source verical`（优先）+ `octopart` 兜底；element14 货源 → `--source element14-cn`（机房直连、RMB 阶梯价+库存+交期、无需 key）。
- 不接/受限：`TI`（中国产品页可达给 datasheet+变体 OPN，价/库存受 PerimeterX 门控拿不到，料已被 Digikey/Mouser/element14-cn 覆盖）；`chip1stop`（整站 502，货源≈arrow，已被 verical 覆盖）；`rs-cn`（无可搜中国 storefront）；~~`distrelec`/`kirikaeki`~~（死站/重复，已删）。

## 取数与重试（已固化在引擎/适配器里）

- 抽取策略：渲染站把搜索页**渲染成可见文本交你直接读**；SPA/有接口的站**拦数据接口取结构化字段**——技术细节在各 adapter 里，你不用管。
- `blocked=true` = 被反爬拦（不是无货），如实标"被拦未取到"，别当"无此料"。
- 单站默认只查给定原始型号，不自动回退变体；需扩大搜索由你手动换词。

## 输出与边界

- 合并进核心四家结果一起给采购：平台、是否命中、品牌/品类、库存、价格/MOQ、**交期（现货/期货/天数）**、链接、备注、阻碍项。
- 平台有结果 ≠ 本地可采购；alternate/similar ≠ 替代成立；价格/库存数字结合上下文（可能混 MOQ/倍数）。
- FA 机械件（misumi）是货源线索不是报价，系列级无单价。
- 引擎已用 OOM 上限的 `--gate` + 主机串行防 OOM，**别在脚本内再并发多开**。
