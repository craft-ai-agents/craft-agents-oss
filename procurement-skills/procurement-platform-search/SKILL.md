---
name: procurement-platform-search
description: 在采购平台和授权分销商（Digikey、Mouser、云汉、master 等）上查型号的实时报价、可购库存、产品页、datasheet。当用户需要外部市场价格与货源线索时使用。
metadata:
  short-description: 采购平台报价线索查找
  lang: zh
---

# 采购平台报价线索查找

**默认四家平台全部一起搜，合并结果给采购**：① Digikey（得捷）② Mouser（贸泽）③ 云汉（ickey.cn）④ master（masterelectronics.com）。

不做供应商真假、价格优劣、是否下单、是否可替代判断。

## 默认就这么做（四家都查，两个脚本都跑，可并发）

**Digikey + Mouser —— 官方 API：**

    python3 .agents/skills/procurement-platform-search/scripts/api_search.py --part "<型号>"

**云汉(ickey) + master + octopart —— CloakBrowser（有反爬/需真浏览器）：**

    cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_search.py --part "<型号>" 2>/dev/null

默认就跑 master + 云汉 + **octopart**（octopart 聚合 Avnet/Newark/Arrow/DigiKey/Mouser/LCSC 等多分销商库存报价，货源比 Digikey/Mouser API 广）。三个串行、每个十几秒，较慢但货源全；只要其中某个加 `--source master` / `ickey` / `octopart`。

两个脚本都要跑（独立，可并发起两个 Bash），把结果**合并**给采购。`2>/dev/null` 必加，否则日志污染 JSON。

## 原始站新增货源（cloak_search 内置 --source，渲染成文本交你自己读）

四家之外的「原始分销商站」已按配置表接进 cloak_search，抽取方式是**渲染搜索页成可见文本、不写选择器、由你直接读出型号/库存/价格/交期**。加新站只在脚本 `GENERIC` 表加一行 URL。当前状态：

- **可靠（无需代理，已验证 hit）**——14 个原始站：
  - 西方分销：`future` `newark` `xonelec`(X-ON) `componentonline`(Component Electronics)
  - 欧洲：`tme`(波兰/欧) `darisus`(德，连接器)
  - RS 分区：`rs-uk` `rs-jp` `rs-hk`(=hken)
  - 日本：`monotaro`(MRO) `corestaff`(=ZaikoStore)
  - 中国：`lcsc`(立创国际) `szlcsc`(立创国内商城)
  - 连接器专家：`peigenesis`

        cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_search.py --part "<型号>" --source future,newark,xonelec,tme,rs-uk,rs-jp,corestaff,szlcsc 2>/dev/null

  （想全查就把 `--source` 列全；每站串行十几秒，按需选。）
- **`rs-us`（RS 美区=原 Allied，专用 scraper，仅生产带住宅代理可用）**：Magento + GroupBy 搜索 API + DataDome 反爬。`scrape_rs_us` 拦 `groupby/search/endpoint`、goto 重试至 3 次扛 DataDome 间歇拦截。输出：MPN｜品牌｜描述｜库存｜价｜链接。生产实测 5 条命中。`needs_proxy` 走 `MIHOMO`，本地代理未开时不可用。
- **🔒 生产住宅代理实测仍被反爬挡，未接（2026-06-16 在带 mihomo 7899 的生产逐个验过）**：
  - `arrow`：Akamai Access Denied，住宅 IP 也拒（比 master 的 Akamai 更严）。
  - `tti`：PerimeterX **Press&Hold** 行为验证，鼠标按住 11s 未破（查鼠标轨迹熵）。
  - `element14`：403，住宅 IP 也挡。
  - `avnet`：非反爬问题——`/shop/us/search/?term=` 对真实料号也跳 "Part Not Found"，产品搜索入口在 WebSphere 门户里没摸到。
  - 这四个 **Octopart 均覆盖**，ROI 低，先搁置；要硬啃需 captcha 求解服务/多地住宅 IP/浏览器农场，是另一个量级的工程。
- **专用 XHR scraper（已实现，拦接口取结构化数据，无需代理，可直接 `--source`）**：
  - `verical`（Arrow marketplace，拦 parametric POST）：型号｜品牌｜描述｜库存｜价格｜链接，货源广、数据干净。
  - `rochester`（停产/EOL 半导体授权源，Salesforce B2B 三段 POST）：型号｜厂商｜描述｜库存(In/Out)｜价｜datasheet——**找停产料专用**。
  - `sager`（电源/连接器/机电，Oracle Commerce）：型号｜厂商｜价｜库存(现货/在途/工厂)｜交期。**非核心品类(如通用IC)会判「无此料」**（已加相关性校验防误报），主用连接器/电源料号。
  - `heilind`（赫联，连接器/机电，Coveo API）：型号｜品牌｜品类｜链接（索引无库存价）。**按连接器料号搜**。
  - `jbchip`（京北通宇,中国,Vue SPA 拦 goods API）：型号｜品牌｜库存｜价(¥)｜封装｜链接。
  - `ocpneumatics`（Orange Coast,美国 SMC 气动经销,Meilisearch）：型号｜描述｜价($)｜库存｜链接。**按 SMC 气动型号搜**。
  - `misumi-jp`（米思米日本 FA 件，/api/v1/series/search）：系列名｜品牌｜品类｜交期｜现货｜链接。同 `misumi` 是 FA 件不是 MPN 报价。

        cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_search.py --part "<型号>" --source verical,rochester 2>/dev/null
- **`vanlinkon`（连可连,中国连接器商城）在 `api_search.py`**：它有干净 JSON API（`api.vanlinkon.com`，无需浏览器），归一化同 digikey/mouser。用 `python3 api_search.py --part "<型号>" --source vanlinkon`。多仓报盘（自营/代销/RS），含库存/¥价/交期。
- **`misumi`（FA 机械件专用，独立用法）**：米思米中国，**关键词→可配置系列**，跟 MPN→报价是两套模型，单独用，别混进上面默认/多源里。专用 XHR scraper（拦 `app_search`），输出每个系列：系列名｜品牌(米思米/HIWIN/THK)｜品类｜交期｜现货｜起订｜链接。**米思米配置到订，系列级无单价**，价格要进详情页按规格配置后才有——这是 FA 货源线索，不是报价。非机械件关键词通常 0 命中。用法：

      cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_search.py --part "直线导轨" --source misumi 2>/dev/null

- **不接（已查实，非架构问题）**：`rs-cn`（RS 无可搜中国 storefront）；`chip1stop`（整站 502，被 Arrow 吞并迁移中，货源≈arrow，恢复后再评估）；`kirikaeki`（2025/7/31 已关站，原本切换器店非元器件）；`有货商城`（未找到该元器件商城，疑不存在/改名）；`TI`（无通用关键词搜索页，只有参数/交叉检索，作原厂用产品页 `ti.com/product/<MPN>`）；`distrelec`（=RS 集团，跳转）。

**不进默认源**：默认仍是 master,ickey,octopart（每站十几秒，串行，全开会很慢）。用户明确要某原始站货源时才 `--source` 单点。

## 四家之外（仅当用户还想要更多货源时，用 CloakBrowser）

四家查完合并给用户后，如果用户还要别的渠道（如立创/LCSC、其它分销商或代理），**也用 CloakBrowser 补，别用普通 WebFetch**（这些站多半也有反爬）：先用 WebSearch 找到该分销商的搜索/产品页 URL，再用 cloak_fetch.py 渲染取文本——

    cloakbrowser-python .agents/skills/procurement-platform-search/scripts/cloak_fetch.py "<分销商搜索页URL>" 2>/dev/null

海外站加 `--proxy`（走住宅代理），境内站（立创等）不加；找到商品行选择器可加 `--selector ".xxx"` 让输出更干净。**不要默认就查这些**，只在用户明确还要更多货源时才补。

## 这些已固化在脚本里（你不用重新摸）

- **Digikey/Mouser** 有官方 API，api_search.py 直接调，别用浏览器。
- **master = Akamai Bot Manager**：普通 curl / WebFetch / 轻量无头浏览器一律 403，**别试**；数据是 SSR HTML，只有 CloakBrowser 真 Chromium 能过，走住宅代理（脚本内置）。
- **云汉（ickey.cn，即 ICKey/云汉芯城）= 点击验证码**：数据走 AJAX 接口 `ajax-get-res-v002`，CloakBrowser 过验证码后抓接口响应（无需登录、境内直连，脚本内置）。

→ **反爬怎么绕（Akamai、点击验证码、搜索 URL、住宅代理）已固化在脚本里，这部分别重新摸、别试 curl。** 但**查不到货不等于没货，你要为"尽量查到"负责**：
- 脚本对**单平台 0 命中已自动回退型号变体**一档（原始 → 去连字符 → 去末位封装字母，如 Tape&Reel 的尾缀 `S`）；命中时结果里带 `matched_query`/`mpn`，说明命中的是变体而非原串，输出时要点明"封装/包装可能不同"。
- 自动回退后**仍为空或结果可疑**时，**该自己再试**：换更激进的型号变体、调 `--limit`、单独补 `--source`（如 `ickey-replace` 找替代、`octopart` 扩货源）。别一 miss 就报"无此料"。
- 例外：`master` 目录偏继电器/保护/被动件，LED/MCU 这类**确实可能没收录**，回退后仍空就如实写"该平台无此料"，不用硬凑。

## 输出

把四家结果合并给采购（保留可合并字段）：平台、型号是否命中、品牌/品类、库存、价格/MOQ、**交期（现货/期货/交期天数）**、链接、备注；以及阻碍项（哪些平台没查到/被拦）。

**交期必须标清**：每条结果注明是「现货」还是「交期 X 天/周」。平台数据里没明确写的标注"交期待确认"。采购需要这个信息判断能不能满足客户时效。

**品类渠道补充**：四家查完后，根据型号/品牌推断品类，在结果末尾加一句渠道建议（见 AGENTS.md 品类表）。例如连接器类提示"代理/经销商通常更有优势"，工控类提示"线上平台覆盖有限，建议联系代理"。

## 边界

- 平台有结果 ≠ 本地可采购。
- 页面写 alternate/similar ≠ 替代成立。
- 价格/库存数字结合上下文（可能混 MOQ、倍数等），不要直接当报价。
- master 目录偏继电器/保护/被动件，未必有 MCU；无结果如实写“该平台无此料”。
- CloakBrowser 较慢（每平台十几秒），脚本已串行+用完即关防 OOM，**别在 cloak_search 内并发多开**。
