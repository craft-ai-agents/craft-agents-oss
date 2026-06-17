# Runtime Turn Telemetry

日期: 2026-06-10

## 目标

把现有离线 Phoenix 回灌方案升级为运行时观测:

- 一个用户消息 turn 对应一条 trace。
- trace 必须带稳定的用户、workspace、session、turn 维度。
- 业务流程只暴露现有 `AgentEvent` 流，观测逻辑集中在旁路 observer。
- 应用层只依赖 OpenTelemetry / OpenInference 风格语义，不绑定 Phoenix 或 LangSmith。

## 和 Claude 方案的差异

Claude 方案的方向是对的:runtime OTel、`one turn = one trace`、记录 tool / usage / error。

本实现收敛了接入方式:

```ts
const turnTracer = TurnTracer.start(context)

try {
  for await (const event of chatIterator) {
    turnTracer.observe(event)
    await this.processEvent(managed, event)
  }
  turnTracer.complete()
} catch (error) {
  turnTracer.fail(error)
  throw error
} finally {
  await turnTracer.end()
}
```

实际代码里 `SessionManager` 只做三件事:

- 创建 `TurnTracer`。
- 在 `chatIterator` 事件循环里调用 `observe(event)`。
- 在完成、中断、错误路径标记 outcome 并结束 span。

`processEvent()` 不增加 telemetry 分支。Phoenix、LangSmith、OTLP header、OpenInference key 都不进入业务 switch。

## Trace 粒度

第一版 runtime trace 的粒度是用户消息:

```text
trace: agent.turn
  span: tool.<toolName>
  event: llm.usage
  event: error
```

根 span 是 `agent.turn`，包含:

- agent chat 事件流阶段耗时。source/server setup 目前仍由现有 `perf.span('session.sendMessage')` 覆盖；后续要把 root span 前移时，`TurnTracer.observe(event)` 的结构不需要变化。
- 用户归因。
- workspace / session / turn 维度。
- usage token/cost 属性。
- 错误 outcome。

工具调用是 child span:

- `tool_start` 创建 span。
- `tool_result` 结束 span。
- `isError=true` 时 tool span 标为 error。

## 用户归因

Phoenix 不能凭空知道多用户。应用层必须把用户维度写入 trace attributes。

当前实现先走最小路径:

- 通过 `workspaceId` 反查 `~/.craft-agent/user-workspaces.json`。
- 命中 Feishu workspace 时写入 `user.id = feishu:<open_id_hash>`。
- 未命中时降级为 `user.id = workspace:<workspace_id_hash>`。

默认不上报 raw `open_id`。

核心字段:

```text
user.id
enduser.id
workspace.id
session.id
craft.turn.id
craft.user_message.id
craft.user.identity_source
craft.feishu.open_id_hash
craft.workspace.root_hash
craft.telemetry.schema_version
```

这样两个不同 Feishu 用户各发一条消息后，可以在 Phoenix 里按 `user.id` 或 `craft.feishu.open_id_hash` 过滤 trace。

## 环境变量

默认关闭:

```bash
CRAFT_OTEL_ENABLED=true
CRAFT_OTEL_ENDPOINT=http://localhost:6006/v1/traces
CRAFT_OTEL_PROJECT=craft-prod
```

Phoenix 开启 API key 时:

```bash
PHOENIX_API_KEY=...
```

或使用通用 header:

```bash
CRAFT_OTEL_HEADERS='authorization=Bearer xxx'
```

也兼容标准 OTLP 变量:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_EXPORTER_OTLP_HEADERS='authorization=Bearer xxx'
```

内容采集默认关闭。需要在 Phoenix 中查看 prompt、final output、tool input/output 时再打开:

```bash
CRAFT_OTEL_CAPTURE_CONTENT=true
CRAFT_OTEL_CONTENT_MAX_CHARS=2000
```

默认只上报 hash 用户标识。需要本地调试 raw `open_id` 时显式打开:

```bash
CRAFT_OTEL_INCLUDE_RAW_USER_ID=true
```

需要每个 turn 结束后立即 flush 时:

```bash
CRAFT_OTEL_FORCE_FLUSH_PER_TURN=true
```

## Phoenix 验收

1. 启动 Phoenix，监听 OTLP HTTP traces endpoint。
2. 启动服务端时设置:

```bash
CRAFT_OTEL_ENABLED=true
CRAFT_OTEL_ENDPOINT=http://localhost:6006/v1/traces
CRAFT_OTEL_PROJECT=craft-prod
```

3. 用两个不同 Feishu 用户各发一条消息。
4. 在 Phoenix 的 `craft-prod` project 中检查:

```text
trace name = agent.turn
openinference.span.kind = CHAIN
user.id = feishu:<hash>
workspace.id = <workspace id>
session.id = <session id>
craft.turn.id = <user message id>
```

5. 如果消息触发工具调用，应看到 child span:

```text
span name = tool.<toolName>
openinference.span.kind = TOOL
tool.name = <toolName>
tool.call.id = <toolUseId>
```

## LangSmith

LangSmith 不进入应用代码。应用只发 OTLP traces。

如果要验证 LangSmith，只需要把 exporter endpoint/header 指向 LangSmith 支持的 OTLP 接收端；`SessionManager` 和 `TurnTracer` 不需要出现 LangSmith 专属逻辑。

## 第一版边界

- LLM 精确 start/end 目前没有来自 Pi event 的稳定信号，所以第一版不承诺精确 LLM latency。
- `usage_update` 和 `complete.usage` 会记录到 root span；如果底层 adapter 只给最后一次 usage，总量仍受事件源限制。
- in-flight steer 消息暂不单独建 trace；被 queue replay 的消息会在 replay turn 中建 trace。
- 历史 backfill 仍由 `tools/trace-ingest/ingest_sessions.py` 负责，后续应逐步对齐同一套 attributes。
