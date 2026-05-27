# 大模型调用与结果处理流程

本文结合源码说明 app 中一次大模型调用从用户发送消息，到后端调用模型，再到结果流式回传、持久化和 UI 更新的完整过程。

## 总览

主链路如下：

```text
Renderer Chat UI
  -> RPC SEND_MESSAGE
  -> SessionManager.sendMessage()
  -> agent.chat()
  -> BaseAgent.chat()
  -> PiAgent.chatImpl()
  -> pi-agent-server 子进程
  -> Pi SDK / 模型服务
  -> 子进程事件 JSONL 回传
  -> PiAgent.handleLine()
  -> PiEventAdapter
  -> SessionManager.processEvent()
  -> RPC session event
  -> Renderer event processor
```

核心分工：

- `SessionManager`：负责会话状态、用户消息持久化、队列、中断、source、附件过滤、事件落盘和 UI 推送。
- `BaseAgent`：负责跨后端通用的消息增强，例如 skill directive、mention 解析、branch/transfer 上下文。
- `PiAgent`：负责 prompt/context/附件适配、子进程生命周期、JSONL 协议和事件队列。
- `pi-agent-server`：运行 Pi SDK，真正发起模型请求，并把 SDK 事件转发回主进程。
- Renderer event processor：把后端事件转换为前端会话状态。

## 入口：Renderer 发起 SEND_MESSAGE

用户发送消息后，renderer 通过 `RPC_CHANNELS.sessions.SEND_MESSAGE` 调用服务端。

源码位置：

- `packages/server-core/src/handlers/rpc/sessions.ts`

该 RPC handler 的关键语义是：不会等待模型完整回复，而是只等用户消息被持久化后返回。

```ts
sessionManager
  .sendMessage(sessionId, message, attachments, storedAttachments, options, undefined, undefined, onAck)
```

`onAck` 在用户消息写入内存并 flush 到磁盘后触发，RPC 返回：

```ts
{ accepted: true, messageId }
```

因此模型流式结果不是 RPC 返回值，而是后续通过 `sessions.EVENT` 推给客户端。

## SessionManager.sendMessage()

源码位置：

- `packages/server-core/src/sessions/SessionManager.ts`

`sendMessage()` 是主入口，主要做以下事情。

### 1. 处理 mid-stream 消息

如果当前 session 正在处理上一轮消息，会根据连接的 `midStreamBehavior` 决定：

- `steer`：尝试把新消息送入正在运行的 turn。
- `queue`：把消息排队，等当前 turn 完成后再处理。

排队时仍会创建 `user` 消息并推送给 UI，只是状态为 `queued`。

### 2. 创建并持久化用户消息

普通路径下会创建 `userMessage`：

```ts
const userMessage: Message = {
  id: generateMessageId(),
  role: 'user',
  content: message,
  timestamp: this.monotonic(),
  attachments: storedAttachments,
  badges: options?.badges,
  dynamicContextRef: userProfileContext?.ref,
}
```

随后：

```ts
this.persistSession(managed)
await this.flushSession(managed.id)
onAck?.(userMessage.id)
```

这个顺序保证：客户端收到 accepted 之前，用户消息已经落盘。

### 3. 准备 agent、source、附件

进入模型前，`SessionManager` 会：

- 加载用户画像动态上下文。
- 自动启用 skill 依赖的 source。
- 刷新 source OAuth token。
- `getOrCreateAgent()` 懒创建 agent。
- 加载所有 source，构建 MCP/API server。
- 调 `filterAttachmentsForModelInput()` 过滤模型不支持的图片输入。

### 4. 调用 agent.chat()

最终调用：

```ts
const chatIterator = agent.chat(effectiveMessage, modelInputAttachments.attachments)

for await (const event of chatIterator) {
  await this.processEvent(managed, event)
  if (event.type === 'complete') {
    this.onProcessingStopped(sessionId, 'complete')
    return
  }
}
```

这里 `agent.chat()` 返回的是 `AsyncGenerator<AgentEvent>`，所以主进程按事件流逐个消费模型输出。

## BaseAgent.chat()

源码位置：

- `packages/shared/src/agent/base-agent.ts`

`BaseAgent.chat()` 是所有后端共享的模板方法。它不会直接请求模型，而是先做通用消息增强。

关键步骤：

1. 解析 skill mention。
2. 如果 skill 不存在，直接产出 `error` 和 `complete`。
3. 注册 skill prerequisite，要求模型先读取 `SKILL.md`。
4. 注入 branch seed context。
5. 注入 transferred session summary。
6. 生成 skill read directive。
7. 拼出 `effectiveMessage`。
8. 调用 provider-specific 的 `chatImpl()`。

```ts
yield* this.chatImpl(effectiveMessage, attachments, options)
```

## PiAgent.chatImpl()

源码位置：

- `packages/shared/src/agent/pi-agent.ts`

当前主要后端是 PiAgent。它通过 JSONL 和 `pi-agent-server` 子进程通信。

### 1. 启动子进程

`ensureSubprocess()` 会启动 `pi-agent-server`，并发送 `init`：

```ts
this.send({
  type: 'init',
  apiKey,
  model: this._model,
  cwd,
  thinkingLevel: this._thinkingLevel,
  workspaceRootPath,
  sessionId,
  sessionPath,
  workingDirectory,
  plansFolderPath,
  miniModel,
  providerType,
  authType,
  piAuth,
  baseUrl,
  customEndpoint,
  customModels,
})
```

子进程 ready 后，主进程还会注册 session-scoped proxy tools，例如 `call_llm`、`spawn_session`、`browser_tool` 以及 source tools。

### 2. 构建 system prompt 和动态上下文

`PiAgent.chatImpl()` 会调用：

```ts
const systemPrompt = getSystemPrompt(...)
const contextParts = this.promptBuilder.buildContextParts(...)
```

Pi 后端的策略是：动态上下文进入 `systemPrompt`，而不是拼进 user message。

原因是 Pi 后面可能接不同模型，不一定都能稳定忽略 user prompt 中的内部 XML 块；把 `<session_state>`、`<sources>` 等动态上下文放进 system prompt，可以降低模型把内部上下文回显给用户的概率。

最终：

```ts
const fullSystemPrompt = [
  systemPrompt,
  ...contextParts,
].filter(Boolean).join('\n\n')
```

### 3. 处理附件

附件分为两类：

- 图片且有 base64：放入 `images`，走多模态输入。
- 普通文件、PDF、无 base64 图片：只把路径提示放入 user message。

```ts
const userParts = [
  ...attachmentParts,
  message,
].filter(Boolean)

const userMessage = userParts.join('\n\n')
```

### 4. 发送 prompt 给子进程

```ts
this.send({
  type: 'prompt',
  id: turnId,
  message: userMessage,
  systemPrompt: fullSystemPrompt,
  images: images.length > 0 ? images : undefined,
})
```

随后 `PiAgent` 从 `eventQueue.drain()` 中持续 yield 事件给 `SessionManager`。

## pi-agent-server：真正调用模型

源码位置：

- `packages/pi-agent-server/src/index.ts`

子进程收到 `prompt` 后进入 `handlePrompt()`。

关键流程：

1. `ensureSession()` 创建或复用 Pi SDK session。
2. 如果 tools 有变化，dispose 旧 session 并重新创建。
3. 用 `applySystemPromptOverride(session, msg.systemPrompt)` 强制注入 system prompt。
4. `session.subscribe(handleSessionEvent)` 订阅 SDK 事件。
5. 调用 Pi SDK：

```ts
await session.prompt(msg.message, {
  images: msg.images && msg.images.length > 0 ? msg.images : undefined,
  streamingBehavior: 'followUp',
})
```

这里才是真正进入 Pi SDK，再由 Pi SDK 根据当前模型、连接、auth、custom endpoint 等请求大模型服务。

## 子进程事件回传

Pi SDK 产生的事件先进入子进程的 `handleSessionEvent()`，再通过 JSONL 发回主进程：

```ts
send({
  type: 'event',
  event,
})
```

对于 assistant 消息，子进程还会在 `message_end` 后补一个 `pi_turn_anchor` 事件，用于分支会话时定位 SDK turn。

## PiAgent.handleLine() 与 PiEventAdapter

主进程的 `PiAgent` 通过 stdout readline 读取 JSONL。

源码位置：

- `packages/shared/src/agent/pi-agent.ts`
- `packages/shared/src/agent/backend/pi/event-adapter.ts`

`handleLine()` 按 message type 分发：

- `ready`：子进程初始化完成。
- `event`：Pi SDK 事件，交给 `PiEventAdapter`。
- `pre_tool_use_request`：工具执行前权限检查。
- `tool_execute_request`：子进程请求主进程执行 proxy tool。
- `mini_completion_result`：标题/小模型补全结果。
- `llm_query_result`：`call_llm` 二级 LLM 调用结果。
- `error`：错误处理和 pending promise reject。

`PiEventAdapter` 把 Pi SDK 事件转换成 app 内统一的 `AgentEvent`：

| Pi SDK 事件 | app 事件 |
| --- | --- |
| `message_update` / `text_delta` | `text_delta` |
| `message_end` | `text_complete` |
| `tool_execution_start` | `tool_start` |
| `tool_execution_end` | `tool_result` |
| `agent_end` | `complete` |
| `compaction_start` | `status` |
| `compaction_end` | `info` / `error` |
| usage | `usage_update` |

## SessionManager.processEvent()

源码位置：

- `packages/server-core/src/sessions/SessionManager.ts`

`processEvent()` 是结果落盘和 UI 推送的核心。

### text_delta

```ts
managed.streamingText += event.text
this.queueDelta(sessionId, workspaceId, event.text, event.turnId)
```

delta 会被 50ms batch 后推给 UI，避免过高频 IPC。

### text_complete

创建正式 assistant 消息：

```ts
const assistantMessage: Message = {
  id: generateMessageId(),
  role: 'assistant',
  content: event.text,
  timestamp: this.monotonic(),
  isIntermediate: event.isIntermediate,
  turnId: event.turnId,
  parentToolUseId: event.parentToolUseId,
}
```

然后：

- 写入 `managed.messages`。
- 更新 `lastMessageRole`、`lastFinalMessageId`。
- 推送 `text_complete` 给 UI。
- `persistSession(managed)`。

### tool_start

创建或更新 tool 消息：

```ts
const toolStartMessage: Message = {
  role: 'tool',
  content: `Running ${event.toolName}...`,
  toolName: event.toolName,
  toolUseId: event.toolUseId,
  toolInput,
  toolStatus: 'executing',
}
```

同时会解析 tool display metadata、browser overlay、parent tool 关系。

### tool_result

根据 `toolUseId` 找到对应 tool 消息并更新：

- `toolResult`
- `toolStatus: completed | error`
- `isError`
- `parentToolUseId`

超大的 tool result 会被截断后再持久化，避免 session JSONL 膨胀。

### error / typed_error

错误会被写入 `managed.messages`，并推送给 UI。

对于认证过期类错误，`SessionManager` 会尝试：

1. 刷新 token。
2. 销毁旧 agent。
3. 移除失败 user message。
4. 重发上一次消息。

### complete

`complete` 事件本身主要用于累计 usage：

```ts
managed.tokenUsage.inputTokens = event.usage.inputTokens
managed.tokenUsage.outputTokens += event.usage.outputTokens
managed.tokenUsage.costUsd += event.usage.costUsd ?? 0
```

真正的 UI complete 由 `onProcessingStopped()` 统一发送。

## onProcessingStopped()

源码位置：

- `packages/server-core/src/sessions/SessionManager.ts`

这是 turn 收尾的单一入口。

主要职责：

1. `setProcessing(managed, false)`。
2. 清理 browser overlay。
3. 根据用户是否正在查看 session 更新 unread 状态。
4. mini agent 自动标记完成。
5. 应用 processing 期间延迟的外部 metadata 更新。
6. 如果有 queued message，调用 `processNextQueuedMessage()`。
7. 如果无队列，推送最终：

```ts
{
  type: 'complete',
  sessionId,
  tokenUsage: managed.tokenUsage,
  hasUnread: managed.hasUnread,
}
```

8. 持久化 session。

## Renderer 结果处理

源码位置：

- `apps/electron/src/renderer/App.tsx`
- `apps/electron/src/renderer/event-processor/processor.ts`

Renderer 通过 `window.electronAPI.onSessionEvent()` 接收 session event。

前端状态有一个重要规则：

- streaming 期间：Jotai atom 是 source of truth。
- 非 streaming：React state / metadata 正常同步。
- handoff 事件，例如 `complete`、`error`、`typed_error`、`interrupted`，会把 atom 状态同步回 metadata/sidebar。

事件进入纯函数：

```ts
processAgentEvent(agentEvent, currentSession, workspaceId)
```

再按事件类型分发：

- `text_delta`：追加到正在 streaming 的 assistant message。
- `text_complete`：固化 assistant message。
- `tool_start`：展示工具执行中。
- `tool_result`：更新工具结果。
- `complete`：结束 streaming，更新 token usage、unread 等状态。
- `typed_error/error`：展示错误卡片或 toast。

## call_llm：工具级二级大模型调用

除主会话调用外，项目还有一个模型内部可调用的二级 LLM 工具：`call_llm`。

源码位置：

- `packages/shared/src/agent/llm-tool.ts`
- `packages/shared/src/agent/base-agent.ts`
- `packages/shared/src/agent/pi-agent.ts`
- `packages/pi-agent-server/src/index.ts`

流程：

```text
模型调用 mcp__session__call_llm
  -> proxy tool request
  -> BaseAgent.preExecuteCallLlm()
  -> buildCallLlmRequest()
  -> PiAgent.queryLlm()
  -> JSONL llm_query
  -> pi-agent-server handleLlmQuery()
  -> queryLlm()
  -> ephemeral Pi session
  -> 返回 llm_query_result
  -> 作为 tool_result 回到主模型上下文
```

`buildCallLlmRequest()` 会：

- 校验 prompt。
- 加载 text attachments。
- 拒绝 image attachments。
- 解析 model short name。
- 处理 `outputFormat` / `outputSchema`。
- 将 schema 注入 system prompt，要求模型只返回 JSON。

子进程里的 `queryLlm()` 会创建一个临时 in-memory Pi session，不带工具，只跑一次 prompt，并收集 assistant 文本作为工具结果返回。

## 异常与恢复

这条链路包含几类恢复机制：

- 用户中断：`cancelProcessing()` 调 `agent.forceAbort()`，并发送 `interrupted`。
- mid-stream 新消息：根据连接配置 steer 或 queue。
- source 激活：收到 `source_activated` 后，服务端自动重发原始消息并追加 `[source activated]`。
- token 过期：检测 auth error 后刷新 token、重建 agent、重试消息。
- context overflow：Pi SDK 自动 compaction，`PiEventAdapter` 会保持队列打开，等待恢复后的 turn。
- 子进程错误：`PiAgent` 将错误转为 `error` 或 `typed_error`，并 reject pending mini/query promise。

## 总结

大模型调用并不是单个函数直接请求接口，而是一条分层事件流水线：

1. RPC 层只负责接收用户消息，并在消息落盘后 ack。
2. `SessionManager` 准备运行时上下文、source、附件和 agent。
3. `BaseAgent` 做通用消息增强。
4. `PiAgent` 把 prompt/context/附件适配为 Pi 子进程协议。
5. `pi-agent-server` 通过 Pi SDK 真正请求模型。
6. Pi SDK 事件被 adapter 转换为统一 `AgentEvent`。
7. `SessionManager.processEvent()` 持久化 assistant/tool/error 消息并推送 UI。
8. Renderer event processor 用统一状态机更新聊天界面。

这个设计的核心目标是：让模型调用、工具执行、持久化、错误恢复和 UI streaming 解耦，同时保证用户消息先落盘、结果事件可持续流式处理。

## Response 展示细节：thinking、随机提示词、summary 灯带

前面说明的是后端事件如何流转。本节继续说明前端如何把大模型 response 展示成用户看到的“思考中”“随机提示词”“summary/压缩状态”等 UI。

这里要先区分三个概念：

- **thinking level**：模型请求参数，控制模型推理强度。
- **thinking indicator**：前端 UI 状态，显示 `Thinking...`、`Preparing response...` 或随机 processing 文案。
- **thinking content**：模型真实输出的中间文本。当前链路只把可见 assistant 文本作为 `text_delta` / `text_complete` 处理，没有单独持久化 provider 的隐藏 reasoning trace。

### thinking level：请求配置，不等于可见思考内容

源码位置：

- `packages/shared/src/agent/thinking-levels.ts`
- `packages/shared/src/agent/pi-agent.ts`
- `packages/shared/src/agent/claude-agent.ts`
- `packages/server-core/src/sessions/SessionManager.ts`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`
- `apps/electron/src/renderer/components/app-shell/input/CompactModelSelector.tsx`

`thinkingLevel` 是 session-level 设置，合法值为：

```ts
off | low | medium | high | xhigh | max
```

默认值是：

```ts
DEFAULT_THINKING_LEVEL = 'medium'
```

在 UI 中，`FreeFormInput` / `CompactModelSelector` 展示 thinking selector。用户切换后，renderer 调：

```ts
window.electronAPI.sessionCommand(sessionId, {
  type: 'setThinkingLevel',
  level: updates.thinkingLevel,
})
```

后端在 `SessionManager.setThinkingLevel()` 中更新 managed session 和已存在的 agent。Pi 后端会继续把变化转发给子进程：

```ts
this.send({ type: 'set_thinking_level', level })
```

对 Claude 后端，`thinkingLevel` 会映射为 Anthropic SDK 的 adaptive thinking / effort 或 token budget。对 Pi/OpenAI 路由，`max` 会按 Pi 能力上限饱和到 `xhigh`。

注意：这只是请求参数。UI 中看到的 `Thinking...` 不代表后端收到了模型隐藏 reasoning 内容。

### 模型 response 的文本内容如何进入 UI

后端统一只把 assistant 可见文本转成：

- `text_delta`
- `text_complete`

Pi 事件适配逻辑在 `packages/shared/src/agent/backend/pi/event-adapter.ts`：

```ts
message_update / text_delta -> text_delta
message_end -> text_complete
```

`text_delta` 会先在前端创建一个临时 assistant message：

```ts
{
  role: 'assistant',
  content: event.delta,
  isStreaming: true,
  isPending: true,
  turnId: event.turnId,
}
```

源码位置：

- `apps/electron/src/renderer/event-processor/handlers/text.ts`

`text_complete` 到达后，这个 message 会被最终内容覆盖并固化：

```ts
{
  content: event.text || streaming?.content || existingMsg?.content || '',
  isStreaming: false,
  isPending: false,
  isIntermediate: event.isIntermediate,
}
```

这里有一个关键字段：`isIntermediate`。

- `isIntermediate: true`：模型在工具调用前后输出的中间 commentary，不作为最终回答。
- `isIntermediate: false`：最终 assistant response。
- `isPending: true`：流式文本刚开始，还不知道最终是不是 intermediate，所以先当作活动处理。

### TurnCard 如何把 response 拆成 activities 和 final response

源码位置：

- `packages/ui/src/components/chat/turn-utils.ts`
- `packages/ui/src/components/chat/TurnCard.tsx`

前端不是直接按 flat messages 渲染，而是用 `turn-utils.ts` 把 `Message[]` 转成 turn：

```text
user message
assistant turn
  activities:
    - tool
    - intermediate
    - status
    - plan
  response:
    - final assistant text
```

assistant message 的处理规则：

- `isIntermediate || isPending`：转成 `ActivityItem(type: 'intermediate')`。
- final assistant message：转成 `ResponseContent`。

因此流式开始时，前端通常先把 assistant delta 当作 intermediate activity；等 `text_complete` 带着权威 `isIntermediate` 到达，再决定它是中间活动还是最终回答。

### TurnCard 的 thinking indicator

源码位置：

- `packages/ui/src/components/chat/turn-utils.ts`
- `packages/ui/src/components/chat/TurnCard.tsx`

TurnCard 用 `deriveTurnPhase()` 推导当前 turn 阶段：

```ts
pending      // turn 创建，尚无活动
tool_active  // 有工具正在运行
awaiting     // 工具都结束了，等待模型下一步
streaming    // 最终 response 正在流式输出
complete     // turn 完成
```

再用 `shouldShowThinkingIndicator()` 决定是否显示 thinking：

```ts
phase === 'pending'
|| phase === 'awaiting'
|| (phase === 'streaming' && isBuffering)
```

这解释了几个 UI 现象：

- 还没工具、还没文本时：显示 `Thinking...`。
- 工具执行完但模型还没继续输出时：仍显示 `Thinking...`，避免 turn card 消失。
- 最终 response 已开始流式输出但还在缓冲期：显示 `Preparing response...`。

这部分是前端状态机，不是模型真实 reasoning 内容。

### Response buffering：为什么有时先显示 Preparing response

源码位置：

- `packages/ui/src/components/chat/TurnCard.tsx`

`ResponseCard` 对 streaming response 做了 aggressive buffering。目的不是改变模型输出，而是避免一两个 token 就撑开大块 markdown 卡片，造成视觉抖动。

关键配置：

```ts
MIN_BUFFER_MS: 500
MAX_BUFFER_MS: 2500
MIN_WORDS_STANDARD: 40
MIN_WORDS_CODE: 15
MIN_WORDS_LIST: 20
MIN_WORDS_QUESTION: 8
CONTENT_THROTTLE_MS: 300
```

`shouldShowContent()` 会根据内容结构判断是否展示：

- 完成后立即展示。
- 代码块达到 15 词更早展示。
- 列表达到 20 词更早展示。
- 问句达到 8 词更早展示。
- 普通内容要 40 词且有结构。
- 最多缓冲 2.5 秒，超过后有 5 词就展示。

如果还不满足展示条件，`ResponseCard` 返回 `null`，TurnCard 显示：

```text
Preparing response...
```

所以 `Preparing response...` 是 UI buffering 状态，不是后端事件类型。

### 随机提示词：处理中 processing 文案

源码位置：

- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`

聊天底部的处理中提示由 `ProcessingIndicator` 控制。它维护一个随机 `messageIndex`，从 `PROCESSING_MESSAGE_KEYS` 里取翻译文案：

```ts
const PROCESSING_MESSAGE_KEYS = [
  'chat.processing.thinking',
  'chat.processing.pondering',
  'chat.processing.contemplating',
  'chat.processing.reasoning',
  ...
]
```

初始化时随机选一个：

```ts
Math.floor(Math.random() * PROCESSING_MESSAGE_KEYS.length)
```

之后每 10 秒随机换一个不同文案：

```ts
setInterval(() => {
  setMessageIndex(prev => {
    let next = Math.floor(Math.random() * PROCESSING_MESSAGE_KEYS.length)
    while (next === prev) {
      next = Math.floor(Math.random() * PROCESSING_MESSAGE_KEYS.length)
    }
    return next
  })
}, 10000)
```

如果后端发了明确 status，例如 `Compacting context...`，则优先显示 status，不再轮换随机文案：

```ts
const displayMessage = statusMessage || t(PROCESSING_MESSAGE_KEYS[messageIndex])
```

### 随机提示词：空会话 hint

源码位置：

- `apps/electron/src/renderer/components/chat/EmptyStateHint.tsx`

空会话页的示例提示来自 `HINT_TEMPLATE_KEYS`：

```ts
const HINT_TEMPLATE_KEYS = [
  'hints.summarizeGmail',
  'hints.screenshotToWebsite',
  'hints.pullIssuesLinear',
  ...
]
```

组件 mount 时随机选择一个：

```ts
return Math.floor(Math.random() * allHints.length)
```

模板里支持实体占位符：

```text
{source:Gmail}
{file:screenshot}
{folder}
{skill}
```

`parseHintTemplate()` 会把这些 token 拆成 text segment 和 entity segment，entity segment 用 `EntityBadge` 渲染成 inline badge。

所以空状态提示和处理中的 processing 文案是两套独立随机系统：

- `EmptyStateHint`：会话为空时随机展示工作流建议。
- `ProcessingIndicator`：session processing 时随机展示等待文案。

### summary / compaction 灯带与状态

这里的 “summary” 主要有两类。

第一类是模型上下文压缩 summary，也就是 `/compact` 或自动 compaction。链路是：

```text
Pi SDK compaction_start
  -> PiEventAdapter: status("Compacting context...")
  -> SessionManager.processEvent(status)
  -> Renderer handleStatus()
  -> TurnCard status activity + ProcessingIndicator statusMessage

Pi SDK compaction_end
  -> PiEventAdapter: info("Compacted context to fit within limits")
  -> SessionManager.processEvent(info with compaction_complete)
  -> Renderer handleInfo()
  -> status activity 更新为 completed
```

后端处理位置：

- `packages/shared/src/agent/backend/pi/event-adapter.ts`
- `packages/server-core/src/sessions/SessionManager.ts`

前端处理位置：

- `apps/electron/src/renderer/event-processor/handlers/session.ts`
- `packages/ui/src/components/chat/turn-utils.ts`

前端状态变化：

1. `handleStatus()` 追加一条 `role: 'status'` message，并设置：

```ts
session.currentStatus = {
  message: event.message,
  statusType: event.statusType,
}
```

2. `ChatDisplay` 把 `session.currentStatus?.message` 传给 `ProcessingIndicator`。
3. `turn-utils.ts` 把 `role: 'status'` 转成 `ActivityItem(type: 'status')`，出现在 TurnCard 活动区。
4. `handleInfo()` 收到 `statusType: 'compaction_complete'` 后，把已有 compacting status activity 更新成 completed，并清掉 `currentStatus`。

第二类是 context usage warning，也就是输入框附近的百分比小 badge。

源码位置：

- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`

它用 `contextStatus.inputTokens` 和模型 context window 计算压缩阈值：

```ts
const compactionThreshold = Math.round(effectiveContextWindow * 0.775)
const usagePercent = Math.round(inputTokens / compactionThreshold * 100)
```

当达到压缩阈值的 80% 且当前没有 compacting 时显示。点击它会发送：

```ts
/compact
```

这也不是模型 response 内容，而是 usage/status 驱动的上下文容量提示。

### title shimmer / summary 类灯带

还有一类“灯带”效果是标题 shimmer，不属于模型 response 本体。

源码位置：

- `packages/server-core/src/sessions/SessionManager.ts`
- `apps/electron/src/renderer/event-processor/handlers/session.ts`
- `apps/electron/src/renderer/components/app-shell/SessionItem.tsx`
- `apps/electron/src/renderer/components/app-shell/PanelHeader.tsx`

后端在分享、更新分享、撤销分享、标题重生成等异步操作前后发送：

```ts
async_operation
```

前端 `handleAsyncOperation()` 设置：

```ts
session.isAsyncOperationOngoing = event.isOngoing
```

Session list 和 panel header 用这个状态加：

```ts
animate-shimmer-text
```

所以 shimmer 是异步操作的 loading feedback，不表示模型正在输出 summary。

### 小结

response 展示侧的核心是“事件内容”和“UI 状态”分离：

1. 后端只把可见 assistant 文本流转为 `text_delta` / `text_complete`，没有单独展示隐藏 reasoning trace。
2. `thinkingLevel` 只控制模型请求的推理强度。
3. `Thinking...` / `Preparing response...` 是 TurnCard 根据 turn phase 和 buffering 推导出的 UI 状态。
4. 处理中随机词来自 `ProcessingIndicator`，每 10 秒轮换。
5. 空会话随机 hint 来自 `EmptyStateHint`，mount 时随机选择。
6. summary/compaction 状态通过 `status` / `info` 事件进入 TurnCard 活动区和底部 ProcessingIndicator。
7. context usage badge 和 title shimmer 是额外 UI feedback，不属于模型 response 内容。
