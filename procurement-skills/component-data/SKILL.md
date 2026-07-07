---
name: component-data
description: 采购平台采集/取证技术层。当需要外部平台的库存/价格/交期/产品页/替代候选等原始证据时使用——按型号(MPN)一条命令并发查全部已接入分销商,返回结构化报价证据。只产出结构化证据,不做采购推荐、供应商判断或可替代结论。取代 browserdepot / scrape-engine。
metadata:
  short-description: 元器件平台采集(取代 browserdepot)
  lang: zh
---

# component-data（元器件平台采集）

按型号一条命令并发查全部已接入分销商,每源一份 adapter,统一返回 `Offer` 结构化行。**核心思路:数据几乎从不在你看到的反爬墙后面**——分销商的价格/库存数据通常由storefront之外的另一台后端主机(API 网关/搜索服务/第三方)供给,直接打那台主机,墙就不相关。所以每源按"数据主机怎么鉴权"分层,用最便宜能通的方式调(官方 API → 开放网关 → 暖会话 → 浏览器)。**本 skill 是 component-data 的唯一操作手册,业务 skill 只引用、不内嵌任何工具细节。** 取代 `browserdepot`——同步一条命令,反爬 warmup / 多层降级 / 代理 / 超时隔离全固化在引擎里。

源码/发版:私有 repo `cunninghamcard-bit/component-data-app`;prod 已在 PATH,binary 名 `component-data`。

## 取数是取数,不是业务判断

本 skill 只负责:选源 → 采集 → 返回结构化证据(每源 offers + 终态)。**不判断**供应商真假 / 价格优劣 / 是否下单 / 是否可替代 / 库存优先级 / 找料下一步 / 最终话术——那些是消费 skill 的事。

## 调用（同步,一条命令跑全部）

**不像旧 browserdepot 要 submit/wait/results 三步——这里一条命令并发跑完全部源、直接返回。** 每源独立超时隔离,一个死源不拖累整批;全量一轮约 30-60 秒。生产上批次实际由常驻 daemon(`component-data.service`,共享暖浏览器池)执行,多人同时调用会排队而不是挤爆内存;调用方式不变,并发高峰时等待稍长是正常的。

```bash
component-data <型号> --json            # 默认 = 全部源一轮并发(官方 API + 直连平台 + 国内聚合)
component-data <型号> mouser digikey    # 只跑点名的源
component-data <型号>                   # 人类表格(不加 --json)
```

- **默认不带源名 = 跑全部**:官方 API(mouser/digikey/element14…)、直连分销商、国内聚合(ickey/jbchip)一起并发。**不要手挑"核心平台",不要截取清单——直接全量跑。**
- `<源 ...>`:只在需要复跑单个源(如某源超时想单独重试)时点名。看全部源名跑 `component-data`(无参数打印用法 + 源清单)。
- `--json`:机器可读 envelope(agent 取数一律加)。

覆盖以本次 envelope 的 `sources[]` 为准。某型号是替代料任务时,替代候选另走替代料 skill,不在这里。

## 输出契约（--json envelope）

```json
{ "ok": true, "schema_version": 1, "mpn": "STM32F103C8T6", "elapsed_s": 33.0,
  "sources_ok": 13, "sources_total": 17, "total_offers": 27,
  "sources": [
    { "source": "mouser", "ok": true, "offer_count": 3, "best_price": 3.66, "currency": "USD",
      "offers": [ { "mpn": "STM32F103C8T6", "manufacturer": "STMicroelectronics",
        "currency": "USD", "stock": 12345, "lead_time_days": null,
        "price_breaks": [[1, 7.03], [10, 5.64], [25, 5.28]],
        "url": "https://...", "extra": {"package": "LQFP-48"} } ] },
    { "source": "avnet", "ok": false, "offer_count": 0,
      "error": "RuntimeError: no Avnet bearer …", "hint": "credential missing/expired …" } ] }
```

`ok`(顶层)只反映批次是否跑完,**不代表**任何源的成败——那在 `sources[]` 里。每源三种终态,消费方按此归类业务状态:

- **`ok=true` 且 `offer_count>0`** = 采集成功、有报价行 → 业务"有结果"
- **`ok=true` 且 `offer_count=0`** = adapter 正常执行、本次 0 行 → 业务"正常无匹配"(**权威答案,不是没查到**)
- **`ok=false`** = 技术错误(超时 / 反爬 403 / 缺 creds)→ 业务"本次未取到",**不是无货**;`error` + `hint` 说明原因,照 hint 办

字段语义(工具级事实,消费方不得改判):

- `stock`:整数 = 已知库存;`0` = 已知无货;`null` = 未知(网站只显示 in/out、不给数)——三者别混。
- `price_breaks`:`[[数量, 单价], ...]`,按数量升序。空数组 = 该源无价(如"询价"件),不能编价。
- `currency`:每源自己的币种(USD/CNY/GBP/EUR/JPY…),不要跨源直接比数字,先换算。
- `url`:产品页链接(证据),从 adapter 的 extra 抬出;`null` 时该源未给链接。
- `lead_time_days`:整数天;`null` = 未返回。有些源把日期字符串留在 `extra`。

## 覆盖口径（消费方验收用）

一轮完成 = envelope 里**每个源都落到 ok(有行)/ ok(0 行)/ error 之一**(envelope 天然每源都有终态,不会缺)。`sources_ok / sources_total` 给覆盖比;error 的源列出 + 各自 hint,不写成"无货"。覆盖清单以本次 envelope 的实际 `sources[]` 为准,不凭印象补。

## 故障

退出码:`0` = 批次跑完(**单源失败/空不算错**,都在 envelope 里)/ `1` = daemon 侧终态错误(排队超时 / daemon 重启中,stderr 有 `component-data daemon ...` 说明;稍后重试同一条命令即可,**不是**料的问题)/ `2` = 用法错(缺型号 / 未知源集 / 未知源名)。批次层不因单源失败返非零。

常见 error → hint 已内建(超时 / 缺 ZYTE_API_KEY / 401 credential / 反爬 IP / 代理不可达)。反爬源并发下偶发 error(如 avnet 的 reCAPTCHA-v3 间歇)——是抖动、可重试,**不是无货**。

## Rationalization Table

| Excuse | Reality |
|---|---|
| "直接 curl / WebFetch / 临时浏览器脚本更快。" | 走 component-data;反爬 / 代理 / warmup / 多层降级是采集正确性的一部分,已固化在引擎。 |
| "某源在源清单里,就当它有结果。" | 命中与否以本次 envelope 的每源终态为准;在清单只说明会尝试。 |
| "error / 403 就是这个料没货。" | 采集阻碍≠无货;只能返回"本次未取到",hint 说明是反爬/缺 creds,让上层语境解释。 |
| "offers 为空但 ok,那就是没数据、我补个市场价。" | ok+空 = 该源正常无匹配,是权威答案;没有 price_breaks 就不编价。 |
| “挑几个核心平台就够。” | 默认就是全部源一轮并发;别手挑、别截取清单。 |
| "把不同源的价格数字直接排序取最低。" | 每源币种不同,先看 currency 再换算,别拿 CNY 和 USD 比大小。 |
