# 全局记忆功能设计（参考 Proma）

## 1. Proma 方案回顾

### 1.1 架构
- **配置**：`~/.proma/memory.json`，字段 `enabled`, `apiKey`, `userId`, `baseUrl`（MemoryConfig）
- **后端**：MemOS Cloud API（[OpenMem](https://memos.openmem.net)）
  - `POST /search/memory`：按 query 搜索，返回 facts + preferences
  - `POST /add/message`：提交 user/assistant 消息对，云端异步提取记忆
- **Chat 流程**：
  - 记忆开启时，为模型注入**记忆工具** `recall_memory`、`add_memory`，并追加 MEMORY_SYSTEM_PROMPT
  - 模型通过 **function calling** 主动调用 `recall_memory(query)` 或 `add_memory(userMessage, assistantMessage)`
  - 主进程执行工具：`searchMemory` / `addMemory` 调 MemOS API，结果返回模型继续生成
  - 最多 MAX_TOOL_ROUNDS 轮工具续接

### 1.2 关键文件（Proma）
- `apps/electron/src/main/lib/memory-service.ts`：读写 memory 配置
- `apps/electron/src/main/lib/memos-client.ts`：`searchMemory`、`addMemory`、`formatSearchResult`
- `apps/electron/src/main/lib/chat-service.ts`：记忆工具定义、工具执行循环、系统提示追加

## 2. Craft Agents 现状

- **无全局记忆**；有 **preferences**（`~/.craft-agent/preferences.json`）进 system prompt，agent 有 `update_user_preferences` 工具
- **请求构建**：`ClaudeAgent.buildSDKUserMessage` → `promptBuilder.buildContextParts`（date, session state, sources, workspace, working dir），无“记忆”块
- **发送入口**：`SessionManager.sendMessage()` → `agent.chat(effectiveMessage, attachments)`，消息在 agent 内部构建

## 3. 设计方案（Craft Agents）

### 3.1 目标
- Chat/Agent 共享**跨会话**记忆：发消息前按当前用户输入检索相关记忆并注入上下文；可选在回合结束后将本轮对话写入 MemOS
- 与 Proma 一致：使用 MemOS Cloud API，配置方式一致（API Key + User ID + 可选 Base URL）

### 3.2 注入策略（与 Proma 的差异）
- **Proma**：通过工具 `recall_memory` / `add_memory` 由模型主动调，主进程执行工具并续接多轮
- **Craft Agents**：采用**预注入**，避免改动 Codex/Claude SDK 的工具续接逻辑：
  - **读**：每次发消息前，主进程调用 `searchMemory(userMessage)`，将 `formatSearchResult(result)` 作为一段 context 注入到 `buildContextParts` 的首部（或紧跟 date/time 之后）
  - **写**（可选）：
    - 方案 A：提供 `add_memory` 工具，由模型在合适时机调用（需在主进程/agent 侧实现工具分发）
    - 方案 B：每轮对话结束后主进程自动 `addMemory(lastUserMessage, lastAssistantMessage)`，无需模型参与

优先实现**读（预注入）**；**写**先采用方案 B（自动写入），后续可再增加工具式写入。

### 3.3 配置与存储
- **路径**：`~/.craft-agent/memory.json`（与 CONFIG_DIR 一致）
- **结构**：`{ enabled: boolean, apiKey: string, userId: string, baseUrl?: string }`
- **读取/写入**：仅主进程（`apps/electron/src/main/lib/memory-service.ts`），类型与常量放在 `@craft-agent/shared` 或 `apps/electron/src/shared/types.ts`

### 3.4 数据流
1. 设置页：用户配置 MemOS API Key、User ID、Base URL（可选），开关启用；测试连接调用 `searchMemory(..., 'test connection', 1)`。
2. 发消息时（`SessionManager.sendMessage`）：
   - 若 `getMemoryConfig().enabled && apiKey`：`await searchMemory(credentials, message, 6)`，`formatted = formatSearchResult(result)`，`agent.setMemoryContextForTurn(formatted)`；
   - 然后 `agent.chat(message, attachments)`；
   - 在 `buildSDKUserMessage` / `buildContextParts` 中把 `turnMemoryContext` 作为第一个（或紧跟 date 的）context 块插入，用后清空。
3. 回合结束后（可选）：若记忆开启，`addMemory(credentials, { userMessage, assistantMessage, conversationId: sessionId })`，异步写入不阻塞 UI。

### 3.5 代码改动点
| 位置 | 改动 |
|------|------|
| `packages/shared` 或 `apps/electron/src/shared` | 定义 `MemoryConfig` 类型、IPC channel 常量 |
| `apps/electron/src/main/lib/memory-service.ts` | 新建：读写 `memory.json` |
| `apps/electron/src/main/lib/memos-client.ts` | 新建：`searchMemory`、`addMemory`、`formatSearchResult`（与 Proma 一致） |
| `apps/electron/src/main/ipc.ts` | 注册 `memory:getConfig`、`memory:setConfig`、`memory:testConnection` |
| `packages/shared/src/agent/core/types.ts` | `ContextBlockOptions` 增加 `memoryContext?: string` |
| `packages/shared/src/agent/core/prompt-builder.ts` | `buildContextParts` 中若 `options.memoryContext` 则 push 到 parts |
| `packages/shared/src/agent/base-agent.ts` | `turnMemoryContext`、`setMemoryContextForTurn()`；构造 PromptBuilder 时传入或通过 setter 提供 memoryContext |
| `packages/shared/src/agent/claude-agent.ts` | `buildSDKUserMessage` 调用 `buildContextParts` 时传入 `memoryContext: this.turnMemoryContext ?? undefined`，用后清空 |
| `packages/shared/src/agent/codex-agent.ts` | 同上，在构建 user message 的 context 时传入 `turnMemoryContext` |
| `apps/electron/src/main/sessions.ts` | 在 `agent.chat()` 前：若记忆开启则 `searchMemory` → `setMemoryContextForTurn`；在 `complete` 分支可选调用 `addMemory` |
| 设置 UI | 新增「全局记忆」设置页或 Ai 设置内区块：开关、API Key、User ID、Base URL、测试连接 |

### 3.6 系统提示（可选）
- 若启用记忆，可在 system prompt 末尾追加简短说明，例如：“You have access to a global memory context above (facts and preferences). Use it to personalize responses and recall past context when relevant.”

## 4. 参考
- Proma 记忆实现：[ErlichLiu/Proma](https://github.com/ErlichLiu/Proma)（memory-service.ts, memos-client.ts, chat-service.ts）
- MemOS OpenMem API：[Add Message](https://docs-pre.openmem.net/memos_cloud/mem_operations/add_message)、[Search Memories](https://memos-docs.openmem.net/api-reference/search-memories)
