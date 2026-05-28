# Response 在 Session 中的展示形式

本文结合当前源码，梳理 agent response 从事件进入 renderer 到最终在 session UI 中展示的几种主要形式。

## 总览

Session 中的 response 不是直接按一条 `assistant` message 渲染。实际链路是：

```text
AgentEvent
  -> event-processor
  -> session.messages
  -> groupMessagesByTurn
  -> ChatDisplay / SessionViewer
  -> TurnCard
```

核心文件：

- `packages/core/src/types/message.ts`
- `apps/electron/src/renderer/event-processor/handlers/text.ts`
- `apps/electron/src/renderer/event-processor/handlers/tool.ts`
- `packages/ui/src/components/chat/turn-utils.ts`
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`
- `packages/ui/src/components/chat/SessionViewer.tsx`
- `packages/ui/src/components/chat/TurnCard.tsx`
- `packages/shared/src/reasoning/extractor.ts`

关键点是：UI 会先把扁平的 `Message[]` 通过 `groupMessagesByTurn` 重组为 turn，再由 `TurnCard` 分区展示最终回答、reasoning、工具活动、中间过程文本和 plan。

## 基础数据结构

`MessageRole` 定义在 `packages/core/src/types/message.ts`：

```ts
export type MessageRole =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'error'
  | 'status'
  | 'info'
  | 'warning'
  | 'plan'
  | 'auth-request';
```

对 response 展示影响最大的字段是：

- `role`: 决定消息属于用户、助手、工具、系统信息、plan 等哪一类。
- `content`: 文本内容。
- `isStreaming`: 是否仍在流式输出。
- `isPending`: 流式 text_delta 阶段，尚不知道最终是中间过程还是最终回答。
- `isIntermediate`: 是否为中间过程文本，不作为最终回答展示。
- `turnId`: 事件关联 ID，用于辅助查找和展示。
- `toolName` / `toolInput` / `toolResult` / `toolStatus`: 工具展示字段。
- `parentToolUseId`: 工具或中间文本的父级工具 ID，用于嵌套展示。
- `annotations`: 回答和 plan 的批注数据。

持久化结构 `StoredMessage` 也保留了 `isIntermediate` 和 `turnId`，这是 reload 后仍能恢复 TurnCard 分组的关键。

## 事件到 Message

### Text Delta

`text_delta` 在 `handleTextDelta` 中处理。

如果当前 turn 没有 streaming assistant message，会创建一条临时消息：

```ts
{
  role: 'assistant',
  content: event.delta,
  isStreaming: true,
  isPending: true,
  turnId: event.turnId,
}
```

此时 UI 还不知道这段文本最终是最终回答还是中间过程，所以先标记为 `isPending`。

### Text Complete

`text_complete` 在 `handleTextComplete` 中处理。

它会把之前的 streaming message 定型：

- 设置 `isStreaming: false`
- 设置 `isPending: false`
- 写入最终 `isIntermediate`
- 使用 main process 传来的 `messageId` 和 `timestamp` 覆盖临时值

如果 complete 事件先于 delta 事件到达，代码会直接创建完整 assistant message，避免竞态导致消息丢失。

### Tool Start / Tool Result

`tool_start` 创建 `role: 'tool'` 的消息：

```ts
{
  role: 'tool',
  content: '',
  toolUseId,
  toolName,
  toolInput,
  toolStatus: 'executing',
}
```

`tool_result` 再把同一条 tool message 更新为：

- `toolResult`
- `toolStatus: 'completed' | 'error' | 'backgrounded'`
- `isError`
- `errorCode`

工具消息不会直接作为回答正文展示，而是被转成 TurnCard 中的 activity。

## Turn 分组规则

`groupMessagesByTurn` 是展示形式的核心。

源码注释中的规则是：

- user message 会 flush 当前 turn，并作为独立 user turn 展示。
- tool message 和 intermediate assistant message 属于当前 assistant turn。
- final assistant message，也就是非 streaming、非 intermediate 的 assistant message，会成为最终 response 并 flush 当前 turn。
- error / status / info / warning 根据类型进入 system turn 或 activity。

一个重要设计是：分组时有意忽略不同 message 的 `turnId`，从用户视角看，用户发送一次消息后，直到最终回答前的工具调用和中间文本都属于同一个 assistant turn。真正决定“中间过程 vs 最终回答”的信号是 `isIntermediate`。

### 轮次具体按什么划分

UI 里的 turn 是“视觉轮次”，不是 backend/API 的 raw `turnId`。

划分规则可以概括为：

1. `user` message 是一个独立 user turn，并且会结束前一个 assistant turn。
2. 一个 assistant turn 从用户消息之后的第一个 agent 活动开始，可能是：
   - `tool`
   - `status`
   - `assistant + isIntermediate`
   - `assistant + isPending`
   - `assistant` final response
   - `plan`
3. `tool` message 永远归入当前 assistant turn。
4. `assistant + isIntermediate` 归入当前 assistant turn 的 activities，不结束轮次。
5. `assistant + isPending` 是 streaming 未定型阶段，暂时归入当前 assistant turn。
6. `assistant` final response，也就是非 pending、非 intermediate 的 assistant message，会写入 `turn.response`，并在非 streaming 时 flush 当前 assistant turn。
7. `plan` 会作为 plan activity 进入当前 assistant turn，然后立即把 turn 标记 complete 并 flush。
8. 普通 `error` / `info` / `warning` 会先 flush 当前 assistant turn，再作为 system turn 单独展示。
9. `status` 不会单独开 system turn，而是进入当前 assistant turn 的 activity。

因此，虽然 `AssistantTurn` 结构里仍有 `turnId`，但 `groupMessagesByTurn` 的源码注释明确说明：分组时有意忽略 `turnId` 差异，因为 SDK 可能为每个 API message 生成新 `turnId`。UI 关注的是用户视角：一次用户输入之后、最终回答之前的所有工作应该聚合为同一个 assistant turn。

`turnId` 在 UI 中主要用于：

- 生成 turn identity 的一部分。
- 打开 turn details。
- diff / branch / feedback 等操作的上下文。

但它不是视觉轮次的硬边界。

### 轮次结束条件

assistant turn 会在以下情况结束：

- 下一个 `user` message 到来。
- 收到非 streaming 的 final assistant response。
- 收到 `plan` message。
- 收到普通 `error` / `info` / `warning`，其中 `info` 会按 interruption 处理。
- readonly / session stopped 时，若还有 open turn，最后会 flush。

如果 session 已停止但当前 turn 只有 activities、没有 final response，代码会把最后一条 intermediate 文本提升为 response，作为兜底最终回答。

## Activity 正文与详情

Activity 是 TurnCard 顶部折叠区里的“过程项”。它不是单独的 message bubble，而是由 `Message` 转换来的 `ActivityItem`。

### ActivityItem 的来源

工具 activity 来自 `role === 'tool'`：

```ts
{
  type: 'tool',
  status: getToolStatus(message),
  toolName: message.toolName,
  toolUseId: message.toolUseId,
  toolInput: message.toolInput,
  content: message.toolResult || message.content,
  intent: message.toolIntent,
  displayName: message.toolDisplayName,
  toolDisplayMeta: message.toolDisplayMeta,
  parentId: message.parentToolUseId,
}
```

也就是说，工具 activity 的“正文”主要是：

- `activity.content`: 工具输出，来自 `message.toolResult || message.content`
- `activity.toolInput`: 工具输入
- `activity.error`: 错误内容
- `activity.intent`: 模型或拦截器给出的工具目的

中间过程 activity 来自 `assistant + isIntermediate`：

```ts
{
  type: 'intermediate',
  status: 'completed',
  content: message.content,
  parentId: message.parentToolUseId,
}
```

status activity 来自 `role === 'status'`：

```ts
{
  type: 'status',
  status: 'running',
  content: message.content,
  statusType: message.statusType,
}
```

plan activity 来自 `role === 'plan'`，但它不会留在普通 activity list 中显示，而是被 `TurnCard` 单独拿出来渲染成 plan 版 `ResponseCard`。

### 折叠区里显示的不是完整正文

TurnCard 的 activities 区域默认是 summary UI。

Collapsed 状态显示：

- activity 数量
- preview text
- 操作菜单

Expanded 状态每行仍然是摘要，不是完整正文：

- intermediate：显示 strip markdown 后的单行内容；如果包含 reasoning，会在下方显示 `ThinkingBlock`
- status：显示 `activity.content` 的单行 truncate
- tool：显示工具名、intent/description、参数摘要、文件名、diff 统计、错误 badge、background task 信息等

工具行的完整 `activity.content` 通常不会直接铺在聊天流里，避免大输出把 session 撑爆。

### 点击 Activity 详情后的正文

点击 completed/error activity 的详情按钮后，Electron 的 `ChatDisplay` 会根据工具类型打开不同 overlay。

主要路径：

- `Edit` / `Write`：多数进入 multi-file diff overlay。
- `Write` 写入 `.md` / `.txt`：进入 document overlay，渲染写入内容。
- `Bash` / MCP tool / browser tool：进入 stacked activity overlay，展示 Input / Output 两张卡片。
- 其他工具：进入 legacy typed output overlay，例如 code / terminal / json / document / generic。

详情正文的抽取在 `packages/ui/src/lib/tool-parsers.ts`：

- `extractOverlayCards(activity)` 会构造 Input / Output 卡片。
- Input 卡片来自 `activity.toolInput`，通常格式化为 JSON。
- Output 卡片来自 `extractOverlayData(activity)`。
- 如果没有输出，会显示 `No output captured for this tool call.`

`extractOverlayData(activity)` 会按工具类型解析正文：

- `Read`: 把 `activity.content` 解析为 code overlay。
- `Write`: 优先用 `toolInput.content`，否则用 `activity.content`。
- `Bash`: 把 `activity.content` 解析为 terminal output。
- `Grep` / `Glob` 等：转成 terminal/code 风格 overlay。
- JSON-like 输出：可能进入 JSON preview。
- 无法识别时：generic overlay。

### Turn Details 与 Activity Details 的 markdown 正文

除了 overlay，源码还提供了 markdown 格式化函数：

- `formatTurnAsMarkdown(turn)`
- `formatActivityAsMarkdown(activity)`

`formatActivityAsMarkdown` 的结构是：

- intermediate：`# Commentary` + `activity.content`
- tool：
  - 标题：工具名和状态 emoji
  - intent blockquote
  - `## Input`，内容是 `activity.toolInput` 的 JSON
  - `## Result`，内容是 `activity.content`
  - `## Error`，内容是 `activity.error`

这说明从数据模型角度看，activity 的完整正文不是单字段，而是由 input、result、error 和 intent 共同组成；聊天主界面只显示摘要，详情层才展示完整正文。

## 展示形式

### 1. 普通最终回答

条件：

- `role === 'assistant'`
- `isIntermediate` 不为 true
- `isPending` 不为 true

处理：

- `groupMessagesByTurn` 把它写入 `currentTurn.response`
- `TurnCard` 渲染为 `ResponseCard`

这是最常见的 markdown 正文回答。

关键代码：

- `packages/ui/src/components/chat/turn-utils.ts`: assistant final response 分支
- `packages/ui/src/components/chat/TurnCard.tsx`: Response Section

### 2. 流式回答

条件：

- `role === 'assistant'`
- `isStreaming === true`
- 通常初始还有 `isPending === true`

处理：

- `text_delta` 持续追加 content
- pending 阶段先作为 streaming response 展示
- `text_complete` 到达后再根据 `isIntermediate` 决定最终归类

如果 pending 内容中已经有可见正文或 reasoning，`groupMessagesByTurn` 会直接设置 `currentTurn.response`，避免同时展示 spinner 和 response。

### 3. Reasoning / Thinking

条件：

assistant content 中存在以下任一形式：

- Anthropic-style `type: 'thinking'` content block
- 顶层 `reasoning_content`
- `<think>...</think>` 标签

处理：

- `extractReasoningContent` 拆出 `reasoningText` 和 `cleanContent`
- `reasoningText` 进入 `ThinkingBlock`
- `cleanContent` 进入 `ResponseCard`

因此 reasoning 不直接混在正文里，而是作为可折叠的 `Reasoning` 区块展示。

关键代码：

- `packages/shared/src/reasoning/extractor.ts`
- `packages/ui/src/components/chat/TurnCard.tsx` 中的 `ThinkingBlock`

### 4. 中间过程文本 / Commentary

条件：

- `role === 'assistant'`
- `isIntermediate === true`

处理：

- 不作为最终 response
- 被转成 `ActivityItem`
- 展示在 TurnCard 顶部的可折叠 activities 区域

展开后，中间文本显示为一行带虚线消息图标的 activity。如果中间文本里也包含 `<think>`，会在 activity 下方内联显示一个 `ThinkingBlock`。

### 5. 工具调用活动

条件：

- `role === 'tool'`

处理：

- `groupMessagesByTurn` 调用 `messageToActivity`
- tool message 被转成 `ActivityItem`
- 展示在 TurnCard 顶部的可折叠 activities 区域

Collapsed 状态显示：

- 步骤数
- 当前或最近活动摘要
- 操作菜单

Expanded 状态显示：

- 工具名称或 display name
- intent / description
- 参数摘要
- 执行状态
- 错误状态
- 嵌套工具层级
- TodoWrite 提取出的 todo 状态

工具状态来自：

- `toolStatus`
- `toolResult`
- `isError`
- `errorCode`

`response_too_large` 是一个特殊情况：虽然原始结果可能被 SDK 标为 error，但如果输出已经保存到文件，UI 会按 completed 展示。

### 6. Plan

条件：

- `role === 'plan'`

处理：

- 先作为 `type: 'plan'` 的 activity 进入 turn
- `TurnCard` 中再从普通 activities 里分离出来
- 用 `ResponseCard` 渲染，`variant="plan"`

Plan 因此视觉上更像正式输出，而不是普通工具行。它还会挂接 plan 接受、compact 接受、批注和 branch 等交互。

### 7. Status / Info / Warning / Error

`status` message 通常作为当前 assistant turn 的 activity 展示，例如 compacting 状态。

`info` 如果是 `compaction_complete`，会更新前面的 compacting status activity，而不是单独创建 system turn。

普通 `error` / `info` / `warning` 会 flush 当前 turn 后，作为 system turn 展示。

其中 `info` 还会被视为 interruption，用来中断当前 turn：正在 running 的 activity 会被标记为 error，内容为 `Interrupted`。

### 8. 兜底最终回答

有一种边界情况：turn 中只有工具调用和 intermediate 文本，但没有最终 non-intermediate assistant message。

当 session 已经停止处理时：

```ts
groupMessagesByTurn(messages, { isSessionProcessing: false })
```

会把当前 turn 标记为 complete，然后把最后一条 intermediate 文本提升为 `response`。这样可以避免 UI 永远停在 `Thinking...`。

Electron 的 `ChatDisplay` 会传入真实的 `session.isProcessing`。

Readonly 的 `SessionViewer` 固定传 `isSessionProcessing: false`，因为它展示的是完成后的 session 快照。

## ChatDisplay 与 SessionViewer

Electron 内的交互式聊天页面使用 `ChatDisplay`：

```ts
const turns = groupMessagesByTurn(session.messages, {
  isSessionProcessing: session.isProcessing,
})
```

它会把 assistant turn 渲染为 `TurnCard`，并传入：

- `activities`
- `response`
- `intent`
- `isStreaming`
- `isComplete`
- `todos`
- feedback
- branch
- annotations
- file / url open handlers

Readonly viewer 使用 `SessionViewer`：

```ts
groupMessagesByTurn(session.messages.map(storedToMessage), {
  isSessionProcessing: false,
})
```

它同样使用 `TurnCard`，但批注模式会变成 tooltip-only，并且依赖 `PlatformActions` 来打开文件、URL、diff 或 markdown preview。

## 总结

Session UI 中 response 的主要展示形式有：

- `ResponseCard`: 普通最终回答或流式回答。
- `ThinkingBlock`: reasoning / thinking 内容。
- activity row: 工具调用、中间过程文本、status。
- plan `ResponseCard`: plan 类型输出。
- system message: error / info / warning。
- promoted fallback response: session 结束但没有最终回答时，把最后的 intermediate 文本提升为 response。

决定展示形式的核心不是单纯看 `role === 'assistant'`，而是联合判断：

- `role`
- `isPending`
- `isIntermediate`
- `isStreaming`
- `toolStatus`
- `isProcessing`
