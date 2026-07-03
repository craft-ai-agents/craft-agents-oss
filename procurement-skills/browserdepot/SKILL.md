---
name: browserdepot
description: 采购平台采集/取证技术层。当需要外部平台的库存/价格/交期/产品页/datasheet/替代候选等原始证据时使用——查已接入的直连平台、官方 API、反爬站,维护平台接入状态与采集覆盖。只产出结构化证据,不做采购推荐、供应商判断或可替代结论。取代旧 scrape-engine。
metadata:
  short-description: 平台采集服务(取代 scrape-engine)
  lang: zh
---

# browserdepot（采购平台采集服务）

自持 cloak 浏览器进程池 + agent-browser CDP 驱动的采集服务:每源一份 catalog recipe,跑 batch 取全量证据,确定性映射成 typed 行(判断留给上层)。**本 skill 是 browserdepot 的唯一操作手册,业务 skill 只引用、不内嵌任何工具细节(命令/字段/状态判定)。** 取代旧 `scrape-engine`——职责相同,接口换成 daemon + CLI,反爬 warmup / 多源 join / 代理 / 重试 / 进程池全固化在引擎里。

源码/发版:私有 repo `cunninghamcard-bit/browserdepot`,binary 名 `browserdepot`。⚠ **待部署到 prod PATH 后本 skill 才生效**;在此之前 prod 仍走旧采集路径(cutover 未完成)。

## 取数是取数,不是业务判断

本 skill 只负责:选源 → 采集 → 返回结构化证据(rows + 每源终态)。**不判断**供应商真假 / 价格优劣 / 是否下单 / 是否可替代 / 库存优先级 / 找料下一步 / 最终采购话术——那些是消费 skill 的事。

## 调用（异步:submit → 分批取 → 补全）

**不要一把 `wait` 等到全部完成再看**——首轮全量 ~8 分钟,用户干等、什么都看不到。引擎是**每个源一完成就落库**,`results` 返回的是**当前快照**(未完成的 job 也能取到已完成那批,`totals.pending` 告诉你还剩几个)。所以走**两段式:先拿快的、立刻给用户,再补慢尾**。

```bash
browserdepot submit --parts "<型号>[,<型号2>...]"          # 默认 source_set=direct = 首轮全量直连平台,返回 {job_id}
browserdepot wait <job_id> --timeout 40                   # 只等 40s:国内直连 + HTTP/API 源这时基本都到
browserdepot results <job_id> [--fields a,b] [--limit N]  # ← 先取这批,立刻回话:"已到 N 个源(如下),西方慢源还在跑"
browserdepot wait <job_id> --timeout 300                  # 仍未 complete 时,后台继续等西方慢尾
browserdepot results <job_id>                             # 补全,再更新一次(这次才是覆盖口径之准)
```

- **先展示、别干等**:第一次 `results` 拿到部分就先呈现给用户(标明"部分结果,尾部仍在采集");`browserdepot status <job_id>`(廉价,只返 done/pending 计数)用来判断是否已 `complete`——complete 了就不必再 `wait`。
- `wait --timeout N` 是**有界阻塞**(到 N 秒或全终态就返回,不是必须等到底)。西方反爬慢源可给更长 timeout;确需尽快交付时,部分覆盖也能先交(按下方"覆盖口径"注明"仍有源未完成")。

- **首轮必须全量 direct**:`submit` 默认就是 `direct` = 当前全部 enabled/limited 的直连库存/报价平台(不含聚合器 / 替代候选 / reference / dead)。不要手挑"核心平台",不要截取清单。
- **二轮聚合**:`submit --parts "<型号>" --source-set aggregator`(只 `channel_type=aggregator`)。聚合器重复覆盖多个真实平台,只作二轮补缺 / 交叉验证,**不能替代首轮直连覆盖**。
- **替代料候选**:`submit --parts "<型号>" --source-set alternative`(只 `channel_type=alternative_candidates`,如云汉替代料)。返回跨厂牌替代/相似料候选,**只在替代料任务里用**,不混入普通报价、不算 direct 覆盖。
- 看有哪些源 / 集合:`browserdepot sources`。机器可读契约:`browserdepot schema`。
- 幂等:同 parts + source_set 在 TTL 内复用同一 job,不重复采集。

## 输出契约（results）

```json
{ "coverage": { "per_source": {"源id": 行数}, "per_seller": {}, "totals": {} },
  "rows": { "<源id>": [ { "mpn": "", "brand": "", "package": "", "stock": 0, "in_stock": false,
    "price_breaks": [{"qty": 1, "price": 0.0, "currency": "CNY"}], "lead_time": "", "datasheet": "",
    "product_url": "", "description": "", "category": "", "seller": null,
    "availability_status": null, "structured": true, "note": null } ] } }
```

每源在 job 里落一个**终态**(消费方按此归类业务状态):

- `ok` = 采集成功、有结构化行 → 业务"有结果"
- `no_result` = adapter 正常执行、本次 0 行 → 业务"正常无匹配"
- `blocked` = 反爬拦截 → 业务"本次未取到",**不是无货**
- `error` = 技术错误(超时 / 无 body / …)→ 业务"本次未取到",**不是无货**

字段语义(工具级事实,消费方不得改判):

- `stock=null` 未知;`stock=0` 已知无货——别混用。`in_stock=null` 未知,不能当无货。
- `structured=true` 才有可信 typed 字段;`structured=false` 时原始文本落在 `note`,别把它伪装成库存 / 价格。
- `seller`:聚合器/转售源里的下游真实卖家(mouser/digikey/…);直连源为 null(平台即卖家)。
- `blocked` / `error` 是采集阻碍,不是平台无货结论。

## 业务场景配方（references/）

| 业务 | 配方 |
|---|---|
| 平台报价 / 找料(首轮 direct + 二轮聚合) | [references/platform-search.md](references/platform-search.md) |
| 替代料候选采集 | [references/alternative-search.md](references/alternative-search.md) |
| 型号一致性 / 编号核对取证 | [references/part-mismatch.md](references/part-mismatch.md) |
| 批量多型号编排 | [references/batch-orchestration.md](references/batch-orchestration.md) |

## 覆盖口径（消费方验收用）

首轮完成 = `results` 里**每个 direct 源都落到 ok / no_result / blocked / error 之一**。有源缺状态 = "仍有平台状态未确认",不能写"全平台完成"。覆盖清单以本次 `results` 的实际源为准,不凭印象补。

## 故障

退出码:0 成功(含查空)/ 1 用法 / 2 环境(daemon 未起、catalog/db 路径、cloak 未装)/ 3 任务失败。错误 JSON 自带 `hint`,照 hint 办。反爬源并发下偶发 `error`(如 avnet 的 PerimeterX 间歇)——是抖动、可重试,**不是无货**。

## Rationalization Table

| Excuse | Reality |
|---|---|
| "直接 curl / WebFetch / 临时浏览器脚本更快。" | 走 browserdepot;反爬 / 代理 / warmup / join 是采集正确性的一部分,已固化在引擎。 |
| "某源静态 enabled,就当它有结果。" | 命中与否以本次 `results` 的每源终态为准;enabled 只说明会尝试。 |
| "note 文本里出现了型号,就填库存和价格。" | `structured=false` 的 note 只是原始文本;没有 typed 字段就不伪造 stock / price。 |
| "blocked / error 就是这个料没货。" | 采集阻碍≠无货;只能返回"本次未取到",让上层语境解释。 |
| "首轮挑几个核心平台就够。" | 首轮是 `--source-set direct` 全量;跑不完写未完成,不总结成全平台。 |
