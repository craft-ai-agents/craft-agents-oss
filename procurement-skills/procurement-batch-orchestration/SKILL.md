---
name: procurement-batch-orchestration
description: 一次性处理多个型号(用户粘贴一张表 / 列了一串料 / "这一批都帮我查")时,用 spawn_session 给每个型号起一个子会话并行找料,子会话用 send_agent_message 把结论回传父会话,父会话攒齐后汇总成一张对比给采购。单个型号不要用这个。
metadata:
  short-description: 批量找料·多 agent 编排
  lang: zh
---

# 批量找料 · 多 agent 编排

用户一次给**多个型号**(粘贴一张表 / 列了一串料 / "这一批帮我都查下")时,别一个一个串着查——给每个型号起一个**子会话**并行跑标准找料流程,各子会话把结论回传你(父会话),你收齐后汇总成一张对比给采购。

> **只在多型号时用。** 单个型号走顶部标准找料流程,别 spawn。同一个型号内部"平台 vs 供应商"那种并行是单会话内的并行,也不在这里。
> **完整度要求。** 子会话的查找效果必须和单型号主流程同等完整:先本地库存,需要查外部平台时首轮跑全量直接平台,不能因为是批量任务就只查少数常见平台。

## 编排步骤

### 1. 先拿自己的 sessionId
调 `get_session_info`(不带参数 = 当前会话)拿到你的 `sessionId`,记作 `<父ID>`——子会话要靠它回传。

### 2. 使用 feishu-db 本地结果表
父会话生成一个批次 ID,例如 `proc-20260702-001`。批量结果写到 `feishu-db` 的本地 SQLite 表 `batch_results`,不要另建 JSONL 文件。

子会话把完整细节写入 feishu-db:

```bash
.agents/skills/feishu-db/bin/feishu-db batch-upsert --batch-id "<批次ID>" --json '<行JSON>'
```

行 JSON 字段至少包含: `model`、`status`、`local_inventory`、`platform_coverage`、`stock_or_quote`、`price_moq`、`lead_time`、`needs_confirmation`、`detail`、`missing_platforms`。回传只发短状态,不要把平台总览表或详细结果粘到回传消息里。

父会话最终汇总从 feishu-db 读取:

```bash
.agents/skills/feishu-db/bin/feishu-db batch-list --batch-id "<批次ID>"
```

### 3. 每个型号 spawn 一个子会话
对每个型号 `X` 调 `spawn_session`:
- `prompt` 圈定型号 + 要求干完回传,例如:
  > 你是一次批量找料里的一个子任务,**只负责型号 `X`**。查找必须和单型号主流程同等完整:先本地库存；本地无记录或用户要求外部平台时,首轮用 `--source-set direct` 覆盖全部直接库存/报价平台,每个直接平台都有状态后才收口。输出必须包含 `库存查找情况` 和平台总览。命令超时不是降级理由；先用 `--list-source-set direct` 取得 source 清单,按 source 分块补跑,缺平台就继续补跑,不要改成只查常见平台。完成后先用 `.agents/skills/feishu-db/bin/feishu-db batch-upsert --batch-id "<批次ID>" --json '<行JSON>'` 把完整细节写入 feishu-db；行 JSON 包含 model/status/local_inventory/platform_coverage/stock_or_quote/price_moq/lead_time/needs_confirmation/detail/missing_platforms。**然后用 `send_agent_message` 把短状态发回 session `<父ID>`:型号、完成/未完成、外部平台覆盖是否完成、有货/可订平台数、批次 ID;不要把平台总览表或详细结果粘到回传消息里。**
- `name` 用 `找料-X`、`labels` 用 `["批量找料"]`,方便后面 `list_sessions` 过滤。
- 连接 / 模型 / 权限都省略,继承工作区默认(子会话自带本工作区的技能和总则,会自己按标准流程查,你不用在 prompt 里重教流程)。

### 4. 并发上限（生产机资源有限）
**默认最多并行 5 个子会话**。型号超过 5 个就**分批滚动**:先 spawn 前 5 个,之后每收到一个回传、就补 spawn 下一个,始终保持当前并发上限。

只有已经观测到命令超时或资源压力,例如多个子会话同时跑 `--source-set direct` 后出现 shell/agent 工具超时、浏览器崩溃或明显排队,才再临时收缩到 2-3 个活跃子会话。收缩并发是保护全平台覆盖的恢复动作,不是默认规则。

### 5. spawn 完就结束这一轮,等回传
子会话是**异步**跑的。spawn 完当前批次后**结束你这一轮**,等它们回传——每条 `send_agent_message` 会重新唤醒你。**不要在一轮里空轮询硬等。**

### 6. 收齐 → 汇总
你会被各子会话的回传逐条唤醒(每条带 sender 信封 `[Message from session … (找料-X)]`,据子会话名 `找料-X` 就能对上是哪个型号)。**记牢你在等哪几个型号、已经收到哪几个。** 每次被唤醒:
1. 收下短状态,用 `feishu-db batch-list --batch-id "<批次ID>"` 检查 `batch_results` 里是否已有该型号行；没有写表就让子会话补写,不要把长结果塞回对话。
2. 还有没 spawn 的型号,补 spawn 下一个(保持当前并发上限)。
3. **全部回齐了**,父会话最终汇总从 feishu-db 读取,再给采购一张简短对比表(每行一个型号:有无货 / 哪家 / 价格 / 货期 / 提示)。别每回来一条就零散地丢给采购。

### 7. 超时处理
某个子会话迟迟不回(明显超时),用 `list_sessions`(按 label `批量找料` 过滤)或 `get_session_info` 看它状态。汇总时把"还没出结果 / 失败"的型号**如实列出**,不要空等,也别假装查过。

如果子会话回报的是 `engine.py` / shell 命令超时,父会话不要把该型号视为已查完。让子会话继续按 `--list-source-set direct` 拿到 source 清单后分块补跑,直到每个直接平台都有状态；确实无法继续时,汇总里必须写明“外部平台覆盖未完成”和缺失的平台。

## 边界
- **父会话只编排,不自己查料**:负责拆分型号、滚动 spawn、收口、汇总;实际查料都在子会话里。
- 一条 `send_agent_message` 回传 = 一个型号的短状态,不是详细结果；详细结果以 feishu-db 的 `batch_results` 为准。
- 汇总给采购时用业务语言、一张对比表;子会话里的技术细节别外漏(同总则)。

## Rationalization Table

| Excuse | Reality |
|---|---|
| “型号不算多，我串行查完更省事。” | 多型号任务用子会话并行；父会话负责拆分、收口和汇总。 |
| “一次把所有型号都 spawn 出去最快。” | 默认最多并行 5 个子会话，超过就滚动补位；只有已经观测到命令超时或资源压力，才再临时收缩到 2-3 个。 |
| “批量任务只要每个型号查几个大平台就够了。” | 子会话必须和单型号主流程同等完整；需要外部平台时首轮仍是 `--source-set direct` 全量覆盖。 |
| “全量命令超时了，就先按已返回的平台总结。” | 命令超时不是降级理由；先按 direct source 清单分块补跑，缺平台就继续补跑。 |
| “回一个型号就先发一个结果给采购。” | 收齐后再汇总成一张对比；中间结果只用于记录状态。 |
| “子会话把详细平台表回传给父会话更方便。” | 子会话把完整细节写入 feishu-db；回传只发短状态和批次 ID。 |
| “子会话很久没回，我就编个无货。” | 用会话状态兜底；失败或未完成要如实列出。 |
