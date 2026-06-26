---
name: procurement-platform-search-more
description: 核心四家（Digikey/Mouser/云汉/master）之外的更多货源——一批原始分销站（按区域/品类）+ 聚合站。当核心四家查不够、需要更广货源或特定品类（连接器/电源/FA机械件/停产料/气动件等）线索时叠加使用。按型号品类选源，不默认全查。
metadata:
  short-description: 扩展货源（更多原始站+聚合站）
  lang: zh
---

# 扩展货源查找（核心四家之外，按需选源）

本 skill 查核心四家（Digikey/Mouser/云汉/master）之外的更多货源：一批原始分销站 + 聚合站。核心四家不够、或要特定品类货源时用它补。

**选源有成本之分——先读下面「选源原则」再挑 `--source`,别一次全开**（几十站很慢）。

## 用引擎查（一条命令，按需选源）

统一走 **scrape-engine 引擎**，`--source` 必填(逗号分隔)选源，批量 `--parts "A,B"`，`--gate 2` 控并发:

    cloakbrowser-python .agents/skills/scrape-engine/engine.py --part "<型号>" --source future,newark 2>/dev/null

`2>/dev/null` 必加(日志污染 JSON)。**只选相关的几个源**(几十站全开会慢)；引擎自动按 proxy 分桶复用浏览器、gate 控并发防 OOM、站内串行/站间并行。输出 `{"rows":[...],"errors":[...]}`，结构化行(库存:int/阶梯价/datasheet)。

- `vanlinkon`(连可连)：连接器商城,api 模式,**境内直连、无 key**,多仓报盘(自营/代销/RS,含库存/¥价/交期)。
- ~~`element14` 官方 API 废~~ → 用 `--source element14-cn`(e络盟中国店,见下,无需 key)。

## 选源原则：直连聚合器优先，住宅代理源兜底（重要，先读这条）

源分两类,**默认只用第一类**:

**① ✅ 直连结构化源(不耗住宅代理、快、默认用):**
- **聚合器(跨分销商首选)**:`octopart`(实时报盘:**avnet/future/arrow/digikey/mouser/rs/element14/tme** 一把抓,带刷新时间戳)、`szlcsc-overseas`(立创海外比价:mouser/digikey/rs/element14/verical/tme)、`octopart-alt`(跨品牌替代料)
- 境内/机房直连:`vanlinkon` `element14-cn` `verical` `ickey` `ickey-replace` `lcsc` `szlcsc` `jbchip` `misumi` `misumi-jp` `monotaro` `corestaff` `heilind` `sager` `rochester` `ocpneumatics` `future`

**② 🏠 住宅代理源(慢、占代理流量、仅 prod 可用,默认不碰):**
`avnet` `master` `rs-us` `rs-uk` `rs-jp` `rs-hk` `newark` `tme` `arrow` `xonelec` `peigenesis` `componentonline`

**铁律:要 avnet / future / rs / arrow 的库存价,默认走 `octopart`(直连),别去单查它们的 🏠 本站爬虫**——本站慢(十几秒~1分钟)、占住宅代理流量,而 octopart 已直连给了同一份数据(实测 avnet 库存数一致)。**只有**聚合器对某料覆盖太薄、又确实要更深/更权威时,才单点 🏠 源,并明知它慢。

## 货源清单（直连源默认用；标 🏠 的是住宅代理兜底）

**通用电子料 / 西方·欧洲分销：**
- `future`（Future）`newark`（Newark）`tme`（波兰/欧）`xonelec`（X-ON）`componentonline`（Component Electronics）
- RS 分区：`rs-uk` `rs-jp` `rs-hk`；`rs-us`（=Allied 美区，**需住宅代理**，仅生产可用）
- `verical`（**Verical = Arrow 自营商城，机房直连可达、实时报盘**）：型号|品牌|描述|库存|价格|链接 一应俱全。**arrow 本站被反爬封死，要 arrow 货源就用它**（比聚合站 octopart 数据更实时）。
- `element14-cn`（**e络盟中国店 cn.element14.com，机房直连可达、RMB 阶梯价**）：型号|品牌|规格|库存|阶梯价|交期|datasheet 全有，中文页。**element14/Farnell/Newark 国际站被反爬封、官方 API 门户长期 500——要 element14 货源就用这个中国店**。
- 🏠 `avnet`（Avnet 本站,PerimeterX,**住宅代理、慢**）：**默认别单查——avnet 的库存/价 `octopart` 已直连给了**(同一份数据,实测 stock 一致)。只在要 avnet 更权威/更深时才单点本站,明知慢(十几秒~1分钟)、占代理流量;被挡标"被拦未取到"。

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

**聚合站（✅ 直连、跨分销商首选——要西方分销商数据默认用它，见上「选源原则」）：**
- `octopart`（多分销商实时报盘:Avnet/Future/Arrow/DigiKey/Mouser/RS/element14/TME 一把抓,带刷新时间戳。**替代 🏠 个体爬虫的首选**）
- `octopart-alt`（octopart 跨品牌替代料,替代料 eval 用）
- `szlcsc-overseas`（立创海外比价,另一个直连聚合器）

## 反爬挡住/未接（如实告知，别硬试）

- `arrow`、`element14` 国际站：Akamai/门户反爬把 IP 信誉拉黑（中国机房 + 住宅代理两个 IP 都被封，2026-06-18 实测仍 403 Access Denied），本站网页攻不下。**别硬撞，按出路走**：
  - **arrow 货源 → `--source verical`**（Arrow 自营商城，机房直连可达、实时报盘，**优先**）+ `octopart` 兜底。
  - **element14 货源 → `--source element14-cn`**（e络盟中国店，机房直连可达、RMB 阶梯价+库存+交期，2026-06-18 实测出料，**无需 key**）。Newark/国际站被封、官方 API 注册门户长期 HTTP 500——都别用。
  - **avnet 货源 → 默认 `--source octopart`**（直连聚合器,已含 avnet 实时报盘,见「选源原则」）；要 avnet 本站更权威数据再 `--source avnet`(🏠 住宅代理、PerimeterX、慢,引擎预热重试打穿,被挡标"被拦未取到")。
- 不接 / 受限：
  - `TI`（德州仪器）：**`ti.com.cn/product/cn/<MPN>` 中国产品页机房直连可达**（2026-06-18 实测未被挡），给 datasheet + 该 GPN 的全部可订变体 OPN（封装/卷带后缀），作**原厂参考/变体枚举**用；但**库存/价格在 store 接口 `productmodel/gpn/<GPN>/tistoresegmented`、401 受 PerimeterX 会话门控**——拿不到价/库存。TI 料 Digikey/Mouser/element14-cn 已覆盖，不强求其报价。
  - `chip1stop`：整站 502（被 Arrow 吞并、迁移中），货源≈arrow，已被 `verical` 覆盖，等站恢复再评估。
  - `rs-cn`：RS 无可搜中国 storefront（cn 域 Akamai Invalid URL）。
  - ~~`distrelec`（=RS 集团跳转，与 rs-* 重复）、`kirikaeki`（已关站）~~：死站/重复，已从关注清单删除。

## 取数与并发（已固化在引擎里，你不用管）

- **输出已是结构化行**：每行带 平台/型号/品牌/库存(int)/阶梯价/datasheet/链接/`blocked`——不用解析文本、不写选择器。引擎按源类型自动选模式(API / 拦 JSON 接口 / 渲染页取文本)，你只管 `--source`。
- 引擎按 proxy 分桶**复用浏览器**(不是每次重开冷启)、`--gate` 控并发防 OOM、站内串行/站间并行、反爬站自动预热重试——全固化。
- 单源默认只查原始型号，不自动回退变体；要扩大搜索由你手动换词。
- 结果里 `blocked=true` = 被反爬拦(不是无货)，如实标"被拦未取到"，别当"无此料"。

## 输出与边界

- 合并进核心四家结果一起给采购：平台、是否命中、品牌/品类、库存、价格/MOQ、**交期（现货/期货/天数）**、链接、备注、阻碍项。
- 平台有结果 ≠ 本地可采购；alternate/similar ≠ 替代成立；价格/库存数字结合上下文（可能混 MOQ/倍数）。
- FA 机械件（misumi）是货源线索不是报价，系列级无单价，价格要进详情页配置后才有。
- 并发/防 OOM 已固化在引擎(gate + 按 proxy 分桶复用浏览器,4C4G 上 `--gate` 默认 2)，你不用管。
