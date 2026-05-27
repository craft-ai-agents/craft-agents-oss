# MCP 加载、Tool 获取与对话注入架构

本文档详细描述 MCP source 的连接生命周期、工具列表获取，以及工具如何注入到 Claude 和 Pi 两个 Agent 的对话上下文中。

## 目录

1. [核心概念](#核心概念)
2. [MCP 连接层：McpClientPool](#mcp-连接层mcpclientpool)
3. [Claude Agent 流程](#claude-agent-流程)
4. [Pi Agent 流程](#pi-agent-流程)
5. [两者对比](#两者对比)
6. [工具执行回路](#工具执行回路)
7. [Tool Cache 机制](#tool-cache-机制)
8. [guide.md 前置读取机制](#guidemd-前置读取机制)
9. [认证机制](#认证机制)
10. [数据流总图](#数据流总图)

---

## 核心概念

### Source 与 Tool 的关系

每个 **Source** 是一个外部数据服务（如 Linear、GitHub、Gmail），通过 MCP 协议或内部 API 暴露一组 **Tool**。用户启用的 Source 决定了模型可以调用哪些工具。

### Tool 命名约定

所有 MCP 工具统一使用 `mcp__{slug}__{toolName}` 格式：

```
mcp__linear__createIssue
mcp__github__createPullRequest
mcp__session__SubmitPlan      ← session 是一个内置 source
```

### 两种 Agent 后端

| 维度 | Claude Agent | Pi Agent |
|------|-------------|----------|
| 模型供应商 | Anthropic Claude | 多供应商（OpenAI、Gemini、Bedrock 等） |
| 工具注册方式 | SDK 内存注入 | JSONL RPC 消息 |
| 上下文注入位置 | 用户消息前缀 | 系统提示词追加 |
| 子进程 | SDK 内部托管 | `pi-agent-server` 显式子进程 |
| 权限检查 | SDK PreToolUse 钩子 | RPC 往返（`pre_tool_use_request`） |

---

## MCP 连接层：McpClientPool

**文件：** `packages/shared/src/mcp/mcp-pool.ts`

Pool 是整个 Source 连接体系的中心枢纽，被所有 Agent 共享。

### 内部状态

```typescript
class McpClientPool {
  clients:     Map<slug, PoolClient>                          // 活跃连接
  toolCache:   Map<slug, Tool[]>                              // 工具列表缓存
  proxyTools:  Map<proxyName, {slug, originalName}>           // 代理名 → 原始名映射
  activeConfigs: Map<slug, SdkMcpServerConfig>                // 用于变更检测（如 token 刷新）
}
```

### 连接类型

**文件：** `packages/shared/src/mcp/client.ts`

```
streamable_http → StreamableHTTPClientTransport  （远程 HTTP/SSE 服务器）
stdio           → StdioClientTransport            （本地子进程，过滤敏感 env vars）
in-process      → ApiSourcePoolClient             （内存 transport，用于 API Source）
```

stdio 传输会过滤以下敏感环境变量，防止泄露给 MCP 子进程：
`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `AWS_*`, `GITHUB_TOKEN`, `OPENAI_API_KEY` 等。

### `sync()` 协调逻辑

`sync(mcpServers, apiServers)` 是 Source 启用/禁用的统一入口：

1. 若工作区禁用 local MCP，过滤掉所有 stdio 类型的 source
2. 计算 desired - current 差集，断开不再需要的 source
3. 新 source 建立连接；已有 source 若 OAuth token 刷新（auth header 变化）则重连
4. 连接 API source（in-process 内存传输）
5. 调用 `onToolsChanged?.()` 通知上层刷新

### Tool 注册流程

每次 `connect()` / `connectInProcess()` 都会执行 `registerClient(slug, client)`：

```
registerClient(slug, client)
  1. client.listTools()          ← 触发 MCP 协议 listTools RPC，同时完成 connect()
  2. toolCache.set(slug, tools)  ← 缓存工具列表
  3. for each tool:
       proxyTools.set(`mcp__${slug}__${tool.name}`, { slug, originalName: tool.name })
```

连接健康检查：`CraftMcpClient.connect()` 在握手成功后再执行一次 `listTools`，若失败则关闭连接并抛出异常，确保只有真正可用的 source 才进入 pool。

---

## Claude Agent 流程

**文件：** `packages/shared/src/agent/claude-agent.ts`

### 1. 工具注入：`createSourceProxyServers`

Claude 使用 `@anthropic-ai/claude-agent-sdk` 的 `mcpServers` 机制。每次 `chatImpl()` 调用时，为 pool 中每个已连接的 source 创建一个**内存 MCP 服务器**：

```typescript
// claude-agent.ts:431
function createSourceProxyServers(pool: McpClientPool) {
  for (const slug of pool.getConnectedSlugs()) {
    const proxyTools = pool.getTools(slug).map(mcpTool =>
      tool(
        mcpTool.name,           // 原始工具名（SDK 会自动加 mcp__{serverKey}__ 前缀）
        mcpTool.description,
        jsonSchemaToZodShape(mcpTool.inputSchema),  // JSON Schema → Zod 类型
        async (args) => pool.callTool(`mcp__${slug}__${mcpTool.name}`, args)
      )
    );
    servers[slug] = createSdkMcpServer({ name: `source-proxy-${slug}`, tools: proxyTools });
  }
  return servers;  // { 'linear': SdkServer, 'github': SdkServer, ... }
}
```

> **命名机制：** SDK server key = `slug`，tool name = 原始名 → SDK 自动生成 `mcp__{slug}__{toolName}`

### 2. 完整 `mcpServers` 配置

```typescript
const fullMcpServers = {
  // 内置 session 工具（SubmitPlan、source_test、source_oauth_trigger 等）
  session: getSessionScopedTools(sessionId, workspaceRootPath),

  // MDP 文档 MCP 服务器（公开，无鉴权）
  'craft-agents-docs': { type: 'http', url: 'https://agents.craft.do/docs/mcp' },

  // 每个用户启用的 source 对应一个代理服务器
  ...sourceProxies,   // { 'linear': SdkServer, 'github': SdkServer, ... }
};
```

Mini agent 模式下使用 `filterMcpServersForMiniAgent()` 只保留 `MINI_AGENT_MCP_KEYS` 中的 server，减少 token 消耗约 70%。

### 3. SDK `query()` 调用

```typescript
const options: Options = {
  model: effectiveModel,
  systemPrompt: { type: 'preset', preset: 'claude_code', append: getSystemPrompt(...) },
  tools: { type: 'preset', preset: 'claude_code' },   // 完整 Claude Code 工具集
  mcpServers,                                           // ← Source 工具通过这里注入
  permissionMode: 'bypassPermissions',                  // 权限由 PreToolUse 钩子接管
  hooks: { PreToolUse: [...] },                         // 权限检查 + RTK 路径改写
  disallowedTools: ['EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion', 'Skill'],
  ...resumeOptions,                                     // SDK 会话恢复
};
query({ prompt: buildTextPrompt(userMessage), options });
```

### 4. 上下文注入：`buildTextPrompt()`

**关键设计：上下文注入在用户消息里，而非 system prompt。**

原因：Claude SDK 使用 `resume` 机制恢复会话，system prompt 在 session 内必须保持一致。将可变的 source 状态放进 user message，可以让 system prompt 静态化，从而充分利用 Anthropic 的 **prompt cache**（5 分钟 TTL）。

```
用户消息最终结构（各部分以 \n\n 连接）：

[<current_time>]                  ← 当前时间戳，固定格式，为 prompt cache 提供锚点
[<session_state>]                 ← 权限模式、plans/data 文件夹路径
[<sources>]                       ← Active/Inactive source 列表，guide.md 路径提示
[<available_skills>]              ← 已安装技能列表（slug、描述、SKILL.md 路径）
[team knowledge policy]           ← 团队公共知识策略（可选）
[team knowledge prefetch]         ← 关键词匹配到的团队知识内容（可选）
[<workspace_capabilities>]        ← local-mcp 是否启用等
[working directory context]       ← 当前工作目录
[file attachment hints]           ← 附件存储路径（不内联，避免 context overflow）
[user message]                    ← 用户原始输入
```

`<sources>` 块由 `SourceManager.formatSourceState()` 生成，包含：
- 已激活的 source（若有构建失败则标注 `(no tools)`）
- 未激活的 source 及原因（`disabled` / `needs auth` / `inactive`）
- 首次出现的 source：注入 `guide.md` 路径 + 强制阅读指令
- `needs_auth` / `failed` 状态的 source：注入 `<source_issue>` 修复建议

### 5. 权限检查：PreToolUse 钩子

每次模型调用工具前，SDK 触发 PreToolUse 钩子（`claude-agent.ts:1042`），在主进程内同步执行：

```
runPreToolUseChecks(toolName, input, permissionMode, ...)
  → allow          ← 放行（可选注入 steer 消息）
  → modify         ← 修改输入（如 RTK 路径改写）
  → block          ← 拒绝，返回错误消息给模型
  → prompt         ← 弹出权限确认弹窗，等待用户响应
  → source_activation_needed  ← 尝试自动激活 source，成功后重试
```

---

## Pi Agent 流程

**文件：** `packages/shared/src/agent/pi-agent.ts`  
**文件：** `packages/pi-agent-server/src/index.ts`

### 架构概览

Pi Agent 采用**主进程 + 子进程**分离架构，通过 JSONL（每行一个 JSON）进行双向 RPC 通信：

```
主进程 (PiAgent)              子进程 (pi-agent-server)
      │                              │
      │── init ──────────────────────▶  配置 Pi SDK、创建 session
      │── register_tools ────────────▶  注册 session 工具 + MCP source 工具
      │                              │  ready ← 报告端口和 sessionId
      │                              │
      │── prompt ───────────────────▶  pi-coding-agent session.prompt()
      │                              │  ↕ 与 LLM API 通信
      │◀── event(tool_execution_start)  转发 Pi SDK 事件
      │◀── pre_tool_use_request ─────   权限请求
      │── pre_tool_use_response ──────▶  允许/拒绝/修改输入
      │◀── tool_execute_request ─────   代理工具执行请求
      │── tool_execute_response ──────▶  执行结果
      │◀── event(agent_end) ──────────  轮次结束
```

### 1. 子进程启动：`spawnSubprocess()`

```typescript
// pi-agent.ts:365
const child = spawn(nodePath, [piServerPath, '--require', interceptorPath], {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: buildSubprocessEnv(piAuth, runtime, sessionDir),
});

// JSONL 通信
readline.on('line', (line) => this.handleLine(line));  // stdout 解析
child.stderr?.on('data', (data) => this.recordStderr(data));  // stderr 8KB 环形缓冲
```

子进程的 `env` 中包含：API key / OAuth token / AWS IAM 凭据、会话路径、网络拦截器配置等。

`--require interceptorPath` 预加载**网络拦截器**（`unified-network-interceptor.ts`），用于在 OpenAI Chat Completions 格式的请求中注入工具元数据（tool intent、displayName）。

### 2. Init 消息

子进程启动后立即发送 `init` 消息：

```typescript
this.send({
  type: 'init',
  model, cwd, thinkingLevel,
  workspaceRootPath, sessionId, sessionPath, workingDirectory, plansFolderPath,
  providerType, authType, piAuth, baseUrl, customEndpoint,
  branchFromSdkSessionId, branchFromSessionPath, branchFromSdkTurnId,
  ...
});
```

子进程收到 `init` 后配置 Pi SDK，创建（或恢复）会话，然后发送 `ready` 消息：

```typescript
{ type: 'ready', sessionId: '...', callbackPort: 3456 }
```

### 3. 工具注册：两阶段 `register_tools`

主进程在收到 `ready` 后分两批注册工具：

**第一批：Session 工具**（`pi-agent.ts:515`）

```typescript
const sessionToolDefs = getSessionToolProxyDefs();
// → getToolDefsAsJsonSchema({ prefix: 'mcp__session__' })
// 输出: [{ name: 'mcp__session__SubmitPlan', description: '...', inputSchema: {...} }, ...]

this.send({ type: 'register_tools', tools: sessionToolDefs });
```

**第二批：MCP Source 工具**（`pi-agent.ts:538`）

```typescript
// getProxyToolDefs() 返回 flat JSON schema 格式（不是 Zod，Pi 子进程用不了）
const proxyDefs = this.mcpPool.getProxyToolDefs();
// → [{ name: 'mcp__linear__createIssue', description: '...', inputSchema: {...} }, ...]

this.send({ type: 'register_tools', tools: proxyDefs });
```

> **与 Claude 的关键区别：** Claude 注册 Zod schema 的 SDK 内存对象，Pi 注册 flat JSON schema 的纯数据描述。

子进程收到 `register_tools` 后调用 `buildProxyTools()`（`pi-agent-server:841`），为每个 def 创建 `ToolDefinition`：

```typescript
{
  name: def.name,
  promptSnippet: def.description.slice(0, 200),  // Pi SDK 需要此字段才能在系统提示词中列出工具
  parameters: def.inputSchema,
  execute: async (toolCallId, params) => {
    const approvedInput = await requestPreToolUseApproval(def.name, params, toolCallId);
    send({ type: 'tool_execute_request', requestId, toolName: def.name, args: approvedInput });
    const result = await pendingToolExecutions.get(requestId);
    return { content: [{ type: 'text', text: result.content }] };
  }
}
```

### 4. 上下文注入：注入到系统提示词

**关键设计：Pi Agent 将上下文块追加到 system prompt，而非 user message。**

原因：OpenAI、Gemini 等模型不了解 Claude 的上下文注入约定，会将 `<session_state>`、`<sources>` 等 XML 块**回显**在回复中，造成格式混乱。注入到 system prompt 可以避免这个问题。

```typescript
// pi-agent.ts:1998
const contextParts = this.promptBuilder.buildContextParts(
  { plansFolderPath, teamKnowledgePolicy, teamKnowledgePrefetchBlock },
  this.sourceManager.formatSourceState()
);

// context 追加到 system prompt（而非 user message）
const fullSystemPrompt = [systemPrompt, ...contextParts].join('\n\n');

// user message 只包含附件路径 + 用户原始输入
const userMessage = [...attachmentParts, message].join('\n\n');

this.send({
  type: 'prompt',
  id: turnId,
  message: userMessage,
  systemPrompt: fullSystemPrompt,   // ← 上下文在这里
  images,
});
```

`contextParts` 的内容与 Claude Agent 完全相同（由共享的 `PromptBuilder` 生成），差别仅在于注入位置。

### 5. 权限检查：RPC 往返

子进程调用工具前，先向主进程请求权限（`pi-agent-server:879`）：

```
子进程 → { type: 'pre_tool_use_request', requestId, toolName, input }
主进程执行 runPreToolUseChecks(toolName, input, permissionMode, ...)
主进程 → { type: 'pre_tool_use_response', requestId, action: 'allow'/'block'/'modify', input? }
```

这是 Pi 权限检查与 Claude 的主要架构差异：Claude 通过 SDK 钩子在主进程内同步执行，Pi 通过 JSONL RPC 跨进程异步执行。两者使用完全相同的 `runPreToolUseChecks` 函数，确保行为一致。

### 6. 工具执行：RPC 往返

子进程执行代理工具时（`pi-agent-server:882`）：

```
子进程 → { type: 'tool_execute_request', requestId, toolName: 'mcp__linear__createIssue', args }
主进程 handleToolExecuteRequest(requestId, toolName, args)
  → routeToolCall(toolName, args)
    → if SESSION_TOOL_NAMES.has(strippedName)  → executeSessionTool()
    → if mcpPool.isProxyTool(toolName)         → mcpPool.callTool(toolName, args)
    → else                                     → unknown tool error
主进程 → { type: 'tool_execute_response', requestId, result: { content, isError } }
```

---

## 两者对比

### 工具注册对比

| 维度 | Claude Agent | Pi Agent |
|------|-------------|----------|
| 注册时机 | 每次 `chatImpl()` 调用时（每轮次） | 子进程启动后一次性注册；pool 变化时重新注册 |
| 注册格式 | Zod schema 对象 + 内存回调函数 | JSON schema + `register_tools` 消息 |
| Session 工具 | `getSessionScopedTools()` → SDK `mcpServers.session` | `getSessionToolProxyDefs()` → `register_tools` 消息 |
| Source 工具 | `createSourceProxyServers()` → SDK 内存代理服务器 | `getProxyToolDefs()` → `register_tools` 消息 |
| 工具更新 | 每轮次重建，自动生效 | 需要重新发送 `register_tools`（`setSourceServers()` 触发） |

### 上下文注入对比

| 维度 | Claude Agent | Pi Agent |
|------|-------------|----------|
| 注入位置 | 用户消息前缀 | 系统提示词追加 |
| 原因 | 保持 system prompt 静态，利用 prompt cache | 其他 LLM 会回显内联 XML 块 |
| System prompt | 静态（`claude_code` preset + append） | 每轮次重建（包含全量上下文） |
| 内容来源 | 共享 `PromptBuilder` | 共享 `PromptBuilder`（内容完全相同） |

### 权限检查对比

| 维度 | Claude Agent | Pi Agent |
|------|-------------|----------|
| 检查位置 | 主进程（SDK PreToolUse 钩子） | 主进程（RPC 响应回调） |
| 通信方式 | 同步函数调用 | 异步 JSONL RPC |
| 检查函数 | `runPreToolUseChecks()` | `runPreToolUseChecks()`（相同） |
| 结果格式 | SDK hook return value | `pre_tool_use_response` 消息 |

### Source 激活时机

两个 agent 都支持运行时 source 热插拔：

- **Claude Agent：** pool 在 `setSourceServers()` 后触发 `onToolsChanged()`，下一轮次 `chatImpl()` 重建 `sourceProxies`，新工具自动可用。
- **Pi Agent：** 调用 `registerPoolToolsWithSubprocess()` 向已运行的子进程发送新的 `register_tools` 消息，无需重启子进程。

---

## 工具执行回路

以调用 `mcp__linear__createIssue` 为例：

### Claude Agent

```
LLM 生成工具调用 mcp__linear__createIssue
  ↓ SDK PreToolUse 钩子
  runPreToolUseChecks(...)  → allow（或 prompt/block）
  ↓ SDK 路由到 source-proxy-linear 服务器
  tool handler: pool.callTool("mcp__linear__createIssue", args)
  ↓
McpClientPool.callTool("mcp__linear__createIssue")
  proxyTools.get("mcp__linear__createIssue") → { slug: "linear", originalName: "createIssue" }
  clients.get("linear").callTool("createIssue", args)
  ↓ 实际 Linear MCP 服务器（HTTP 或 stdio）
  guardLargeResult(text, ...)  → 超大响应保存到磁盘或摘要
  return { content: string, isError: boolean }
  ↓ SDK tool_result 追加到会话历史
```

### Pi Agent

```
LLM 生成工具调用 mcp__linear__createIssue（由 Pi SDK 解析）
  ↓ ToolDefinition.execute(toolCallId, params)
  requestPreToolUseApproval() → 发送 pre_tool_use_request 到主进程
  ↓ 主进程 runPreToolUseChecks(...)
  主进程发送 pre_tool_use_response { action: 'allow' }
  ↓ 子进程收到许可，发送 tool_execute_request 到主进程
  主进程 routeToolCall("mcp__linear__createIssue", args)
  → mcpPool.isProxyTool("mcp__linear__createIssue") → true
  → mcpPool.callTool("mcp__linear__createIssue", args)（同上）
  主进程发送 tool_execute_response { content, isError }
  ↓ 子进程将结果返回给 Pi SDK
  子进程发送 event(tool_execution_end) 到主进程
```

---

## 数据流总图

```
                     ┌─────────────────────────────────────────────┐
                     │               McpClientPool                  │
                     │                                              │
                     │  connect(slug, config)                       │
                     │    CraftMcpClient / ApiSourcePoolClient       │
                     │    → listTools() → toolCache[slug]           │
                     │    → proxyTools["mcp__slug__name"] = ...     │
                     │                                              │
                     │  getProxyToolDefs()   callTool(proxyName)    │
                     └──────────────┬───────────────┬──────────────┘
                                    │               │
              ┌─────────────────────┘               └───────────────────────┐
              │ Claude Agent                                                 │ Pi Agent
              │                                                              │
┌─────────────▼──────────────────────────────┐   ┌──────────────────────────▼────────────────────────────┐
│             ClaudeAgent.chatImpl()          │   │               PiAgent.chatImpl()                      │
│                                            │   │                                                        │
│  createSourceProxyServers(pool)            │   │  ensureSubprocess()                                    │
│    → SDK 内存 MCP server (per slug)        │   │    → spawnSubprocess() [首次]                          │
│                                            │   │      → send({ type: 'init', ... })                     │
│  options.mcpServers = {                    │   │      → send({ type: 'register_tools', session tools }) │
│    session: getSessionScopedTools(),       │   │      → send({ type: 'register_tools', mcp tools })     │
│    'craft-agents-docs': { http },          │   │                                                        │
│    ...sourceProxies,                       │   │  fullSystemPrompt = systemPrompt + contextParts        │
│  }                                         │   │  userMessage = attachments + message                   │
│                                            │   │                                                        │
│  userMessage = contextParts + message      │   │  send({ type: 'prompt',                               │
│  (context prepended to user msg)           │   │    systemPrompt: fullSystemPrompt,  ← context here    │
│                                            │   │    message: userMessage })                             │
│  query({ prompt: userMessage, options })   │   │                                                        │
│    SDK PreToolUse hook ← permission check  │   │  JSONL events ← subprocess                            │
│    SDK routes mcp__ tools → proxy servers  │   │    pre_tool_use_request → runPreToolUseChecks()        │
│    pool.callTool(proxyName, args)          │   │    tool_execute_request → routeToolCall()              │
└────────────────────────────────────────────┘   │      → mcpPool.callTool() / executeSessionTool()      │
                                                 └────────────────────────────────────────────────────────┘
```

---

## Tool Cache 机制

**文件：** `packages/shared/src/mcp/mcp-pool.ts`

### 缓存结构

`toolCache` 是 pool 内唯一的工具数据权威来源：

```typescript
private toolCache = new Map<string, Tool[]>();
// key: source slug ("linear")
// value: 该 source 暴露的 MCP Tool 对象数组（含 name、description、inputSchema）
```

`proxyTools` 是从 `toolCache` 衍生出的快速路由索引：

```typescript
private proxyTools = new Map<string, { slug: string; originalName: string }>();
// key: 代理工具名 ("mcp__linear__createIssue")
// value: 路由信息，用于 callTool() 反向解析
```

### 缓存生命周期

**写入（连接时，一次性拉取）：**

```
connect(slug, config) / connectInProcess(slug, server)
  → registerClient(slug, client)
    → client.listTools()           ← 实时查询 MCP 服务器
    → toolCache.set(slug, tools)   ← 写入缓存
    → proxyTools.set("mcp__{slug}__{name}", ...)  ← 写入路由索引
```

**删除（断开时）：**

```
disconnect(slug)
  → toolCache.delete(slug)
  → proxyTools 中所有 slug 对应的条目删除
  → activeConfigs.delete(slug)

disconnectAll()
  → toolCache.clear()
  → proxyTools.clear()
  → clients.clear()
  → activeConfigs.clear()
```

### 缓存何时刷新

**缓存本身无 TTL，无周期刷新。** 刷新唯一路径是「断开 + 重新连接」：

| 触发事件 | 代码路径 | 刷新范围 |
|---------|---------|---------|
| Source 首次激活 | `setSourceServers()` → `pool.sync()` → `connect()` | 该 source 全量 listTools |
| OAuth Token 刷新（auth header 变化） | `sync()` 内 `mcpConfigChanged()` 检测 → `disconnect()` + `connect()` | 该 source 重连 + 全量 listTools |
| Source 停用再启用 | `setSourceServers()` → `pool.sync()` → `disconnect()` + `connect()` | 该 source 全量 listTools |
| Session 销毁 | `pool.disconnectAll()` | 全量清除 |

**`sync()` 的变更检测逻辑**（`mcp-pool.ts:85`）：

```typescript
function mcpConfigChanged(oldConfig, newConfig): boolean {
  if (oldConfig.type !== newConfig.type) return true;
  if (oldConfig.type === 'streamable_http') {
    if (oldConfig.url !== newConfig.url) return true;
    // 只比较 Authorization header（OAuth token refresh）
    if (oldConfig.headers?.['Authorization'] !== newConfig.headers?.['Authorization']) return true;
  }
  return false; // stdio 类型不检测（无 token）
}
```

### 缓存如何暴露给 Agent

两个 Agent 后端读取 `toolCache` 的时机不同：

**Claude Agent（每轮次读取）：**

```
chatImpl()
  → createSourceProxyServers(pool)
    → pool.getConnectedSlugs()
    → pool.getTools(slug)   ← toolCache.get(slug)
    → 构建 SDK 内存服务器（每轮次重建）
```

因为每轮次都重建，source 的工具变化在下一轮次自动生效，无需额外通知。

**Pi Agent（事件驱动推送）：**

```
setSourceServers()
  → super.setSourceServers()
    → pool.sync()          ← 更新 toolCache
  → registerPoolToolsWithSubprocess()
    → pool.getProxyToolDefs()  ← 读取全量 toolCache
    → send({ type: 'register_tools', tools: [...] })  ← 推送给子进程
```

子进程接收 `register_tools` 后，调用 `buildProxyTools()` 重建工具列表，新工具立即对模型可见。

### 读取缓存的两种接口

```typescript
// 返回原始 MCP Tool 对象（Claude 用，构建 Zod schema）
pool.getTools(slug): Tool[]

// 返回扁平化 JSON schema 格式（Pi 用，发送给子进程）
pool.getProxyToolDefs(slugs?): ProxyToolDef[]
// → [{ name: 'mcp__linear__createIssue', description, inputSchema }]
// 注：会剥离 $schema 字段（AJV 不认识未注册的 meta-schema URI）
```

---

## guide.md 前置读取机制

**文件：** `packages/shared/src/agent/core/prerequisite-manager.ts`

### 设计意图

每个 source 可以在 `{workspaceRootPath}/sources/{slug}/guide.md` 放置使用说明，描述 API 限制、分页约定、认证注意事项等。机制强制模型在调用该 source 的任何工具之前先读取这份文档，防止因不了解 API 细节而产生错误调用。

### 前置条件规则表

`PrerequisiteManager` 内置三条静态规则（`prerequisite-manager.ts:80`）：

| 匹配模式 | 前置文件路径 | 严格模式 |
|---------|------------|---------|
| `mcp__{slug}__*`（非内置） | `{workspaceRoot}/sources/{slug}/guide.md` | 否（宽松） |
| `api_{slug}` | `{workspaceRoot}/sources/{slug}/guide.md` | 否（宽松） |
| `browser_*` / `browser_tool` / `mcp__session__browser_tool` | `~/.mdp-agent/docs/browser-tools.md` | 是（严格） |

豁免列表：`session`、`craft-agents-docs`（内置服务，无需 guide）。

### 执行流程

**检查入口：** `runPreToolUseChecks()` 第 3 步（`pre-tool-use.ts:775`）

```
每次 PreToolUse：
  1. toolName 匹配规则
  2. resolveRequiredPath() 检查文件是否存在
     → 不存在 → 放行（无 guide.md 即无要求）
  3. readFiles.has(guidePath)?
     → 是 → 放行
     → 否 → 计数 +1
         count <= MAX_REJECTIONS(1) → 返回 block（带文件路径提示）
         count > MAX_REJECTIONS    → 宽松放行（避免模型被永久卡住）
         strict=true              → 永远 block，直到文件被读取
```

**宽松 vs 严格：**
- **宽松（source guide）：** 阻止 1 次后放行，给模型一次学习机会，不会永久卡住
- **严格（browser guide）：** 永远阻止，直到真正读取，因为浏览器工具风险较高

### 读取追踪

**Read 工具追踪**（Claude PreToolUse 钩子 / Pi `handleSubprocessEvent`）：

```typescript
// PreToolUse 拦截 Read 工具调用
if (toolName === 'Read') {
  prerequisiteManager.trackReadTool(input);
  // → readFiles.add(expandPath(input.file_path))
  // → 若路径是 pendingSkillPath → 清除该 skill 前置条件
}
```

**Bash 工具追踪**（`pre-tool-use.ts:779`）：

```typescript
if (toolName === 'Bash' && prerequisiteManager.trackBashSkillRead(input)) {
  // 命令中包含某 skill 路径 → 清除对应前置条件，直接放行
}
```

路径规范化：`expandPath()` 将 `~/...` 展开为绝对路径，保证 `readFiles` 集合的 key 一致性。

### Skill 前置条件（动态规则）

source guide 是静态规则（硬编码），skill 是动态规则（按需注册）：

```typescript
// BaseAgent.chat() 中，解析用户消息里的 @skill 引用
// 找到 skill 后，注册其 SKILL.md 为前置条件
prerequisiteManager.registerSkillPrerequisites([skillMdPath]);

// 此后所有非 Read 工具调用都被阻止，直到 SKILL.md 被读取
// 读取后自动解除，Session 继续
```

### 上下文感知提示

`SourceManager.formatSourceState()` 与前置机制协同工作：

```
首次出现的 source（未在 knownSlugs 中）会在 <sources> 块里注入：
  - Guide: /path/to/sources/{slug}/guide.md
  - 强制提示语："IMPORTANT: You MUST read a source's guide with the Read tool
    BEFORE using any of its tools. Tool calls WILL BE REJECTED if the guide
    has not been read first."

已有 active source（每轮次都提示）：
  - "Read each source's guide.md before first tool use — calls are blocked
    until guide is read."
```

即：系统提示（soft hint）+ 工具拦截（hard enforcement）双重保障。

### 压缩重置

上下文压缩（compaction）后，模型丢失了 guide 内容，必须重新读取：

```
Claude: event.type === 'info' && event.message === 'Compacted Conversation'
Pi:     event.type === 'info' && message.startsWith('Compacted')

两者触发相同逻辑：
  resetPrerequisiteState()         ← base-agent.ts:561
    → prerequisiteManager.resetReadState()
      → readFiles.clear()
      → rejectionCounts.clear()    ← 重置计数，下次再遇到 guide 仍会先拦一次
      → pendingSkillPaths.clear()
    → sourceManager.resetSeenSources()
      → knownSlugs.clear()         ← 下次消息重新注入 guide 路径提示
```

手动 `clearHistory()`（换新 session）也会触发 `prerequisiteManager.resetReadState()`。

### 完整状态机

```
guide.md 存在？
  ├─ 否 → 放行（无条件）
  └─ 是 → readFiles.has(guidePath)？
           ├─ 是 → 放行（已满足）
           └─ 否 → rejectionCount++
                   ├─ count == 1, 非 strict → BLOCK（返回 guide 路径提示）
                   │   模型读取 guide.md
                   │   → trackReadTool() → readFiles.add(guidePath)
                   │   → 下次调用 → 放行
                   ├─ count > 1, 非 strict → 宽松放行（避免死循环）
                   └─ strict → BLOCK（永远，直到 readFiles.has(guidePath)）

compaction 触发 →
  readFiles.clear(), rejectionCounts.clear()
  → 回到初始状态，下次调用 guide 存在的工具时重新从 count=0 开始
```

---

## 认证机制

本节描述两个独立但相互关联的认证维度：

- **Source 认证**：外部服务（MCP/API）的凭据存储、OAuth 流程与 token 刷新
- **LLM 认证**：Claude / Pi 后端与 AI 服务商的身份验证

---

### 9.1 凭据存储层

#### CredentialManager（LLM 凭据）

`packages/shared/src/credentials/manager.ts`

单例，通过 `getCredentialManager()` 获取，底层使用 `SecureStorageBackend`（加密文件，跨平台）。

| CredentialId.type | 用途 |
|---|---|
| `anthropic_api_key` | Anthropic API Key |
| `claude_oauth` | Claude OAuth token（含 refresh_token、expiresAt） |
| `workspace_oauth` | Workspace 级别 OAuth |
| `llm_api_key` | 其它 LLM 服务 API Key（OpenAI、Pi 等） |
| `llm_oauth` | 其它 LLM 服务 OAuth token |
| `llm_iam` | AWS IAM Credentials（Bedrock） |
| `llm_service_account` | 服务账号凭据 |

过期检查：`isExpired()` 使用 5 分钟提前量（`expiresAt - 5min`）；无 `expiresAt` 的 OAuth token 视为过期。

#### SourceCredentialManager（Source 凭据）

`packages/shared/src/sources/credential-manager.ts`

单例，通过 `getSourceCredentialManager()` 获取，负责 Source 的凭据 CRUD、OAuth 流程和 token 刷新。

凭据 ID 路由规则（`getCredentialId()`）：

```
source.type === 'mcp'
  mcp.authType === 'bearer' → source_bearer::{workspaceId}::{slug}
  其他（oauth）             → source_oauth::{workspaceId}::{slug}

source.type === 'api'
  provider in [google, microsoft, slack] → source_oauth
  api.authType === 'oauth'               → source_oauth
  api.authType === 'bearer'              → source_bearer
  api.authType === 'basic'               → source_basic
  header / query / 其他                  → source_apikey
```

MCP source 加载凭据时做双重 fallback：先尝试 `source_oauth`，再 fallback 到 `source_bearer`。

#### Source authType 变体

**MCP Source（`SourceMcpAuthType`）**

| authType | 行为 |
|---|---|
| `oauth` | OAuth 2.0 + PKCE 流程；token 存于 `source_oauth` |
| `bearer` | 静态 Bearer Token；token 存于 `source_bearer` |
| `none` | 无认证；stdio transport 默认此项 |

**API Source（`ApiAuthType`）**

| authType | 行为 |
|---|---|
| `bearer` | Authorization: Bearer {token}；支持 `authScheme` 自定义前缀 |
| `header` | 自定义 Header 名（默认 `x-api-key`） |
| `query` | URL Query 参数（默认 `api_key`） |
| `basic` | HTTP Basic Auth；凭据以 `{username, password}` JSON 存储 |
| `oauth` | OAuth 2.0；Google/Slack/Microsoft 走专属流程，其他走 generic |
| `none` | 无认证，公开 API |

多 Header 凭据：`headerNames: ["DD-API-KEY", "DD-APPLICATION-KEY"]` → 凭据以 JSON 对象存储，`getApiCredential()` 解析后返回 `MultiHeaderCredential`。

---

### 9.2 Token 刷新流程

#### 可刷新 Source 的判断

`isRefreshableSource(source)` = `isOAuthSource(source) || hasRenewEndpoint(source)`

```
isOAuthSource:
  MCP source → mcp.authType === 'oauth'
  API source → provider in [google, slack, microsoft] 或 api.authType === 'oauth'

hasRenewEndpoint:
  api.type === 'api' && api.renewEndpoint.path 存在
```

#### TokenRefreshManager（per-session 刷新协调器）

`packages/shared/src/sources/token-refresh-manager.ts`

- 每个 session 一个实例，维护 5 分钟失败冷却（`failureCooldowns`）
- 主入口 `ensureFreshToken(source)`:
  1. 非 refreshable source → 直接返回现有 token
  2. 在冷却期内 → 跳过刷新，返回现有 token
  3. `needsRefresh(source)` 为 true → 调用 `credManager.refresh(source)` → 更新 config
  4. 刷新失败 → 设 5min 冷却，调 `markSourceNeedsReauth()` → `connectionStatus: 'needs_auth'`
- `createTokenGetter(manager, source)` 返回 `() => Promise<string>` thunk，传给 `SourceServerBuilder` 做每次调用前的按需刷新

#### SourceCredentialManager.refresh() 路由

`refresh(source)` 使用 Promise 去重（`pendingRefreshes` Map）避免并发重复刷新（Microsoft 会轮换 refresh_token，并发会导致 token 失效）：

```
hasRenewEndpoint → refreshApiRenew()
  └─ 发起 HTTP 请求到 renewEndpoint.path
  └─ 支持 {{token}} 占位符替换（body/headers）
  └─ 从响应提取 tokenField（默认 access_token）和 expiresInField

provider === 'google'    → refreshGoogle()    (refreshGoogleToken)
provider === 'slack'     → refreshSlack()     (refreshSlackToken)
provider === 'microsoft' → refreshMicrosoft() (refreshMicrosoftToken, 可能轮换 refresh_token)
api.authType === 'oauth' → refreshGeneric()   (static tokenUrl) 或 refreshMcp()（auto-discovery）
mcp.url 存在             → refreshMcp()       (CraftOAuth.refreshAccessToken)
```

所有刷新路径成功后调用 `save()` 更新加密存储中的 token 和 expiresAt。

---

### 9.3 凭据注入到 MCP Server Config

#### buildServersFromSources → SourceServerBuilder

每次 `setSourceServers()` 触发 `buildAll()`，将凭据"物化"为连接配置：

```
SessionManager
  → buildServersFromSources(sources)
    per source:
      credManager.load(source)                   → StoredCredential
      tokenRefreshManager.ensureFreshToken()      → 按需刷新
      ssoIdToken = getSsoIdToken()                → SSO 身份令牌（可选）

    SourceServerBuilder.buildAll(sourcesWithCredentials,
      getTokenForSource,     ← tokenRefreshManager.createTokenGetter()
      getCredentialForSource ← 每次请求从 vault 读最新 credential
    )
```

**MCP Server Config 的 Header 层叠优先级**（`buildMcpServer()`）：

```
优先级从低到高：
1. mcp.headers（静态，非 secret）
2. credential 中的 MultiHeaderCredential（X-API-Key 等）
3. Authorization Bearer token（最高优先级）

特殊规则：
  authType === 'bearer' + ssoIdToken → Authorization: Bearer {ssoIdToken}
  token 存在 + 无 Authorization + 非 JSON bundle → Authorization: Bearer {token}
  isAuthenticated=true 但 token 缺失 → 返回 null（触发 needs_auth 错误）
  authType === 'none' → 不添加 Authorization
```

API Server 的凭据传递（`buildApiServer()`）：

```
Google / Slack / generic OAuth → createApiServer(config, getToken)   ← token getter（按需刷新）
renewEndpoint 存在              → createApiServer(config, getToken)   ← token getter
getCredential 存在              → createApiServer(config, getCredential) ← per-request 读 vault
fallback                        → createApiServer(config, credential) ← 静态快照（legacy）
```

per-request credential getter 解决了旧实现的痛点：原来静态快照在 session 存续期间不更新，用户粘贴新 JWT 后必须重启 session；现在每次工具调用前重新从 vault 读取最新值。

---

### 9.4 MCP Pool 的 Token 变更检测

`McpClientPool.sync()` 调用 `mcpConfigChanged(current, next)` 检测是否需要重连：

```typescript
// mcp-pool.ts
function mcpConfigChanged(current: McpServerConfig, next: McpServerConfig): boolean {
  // 比较 Authorization header（OAuth token 变更会体现在此）
  const currentAuth = current.headers?.Authorization;
  const nextAuth = next.headers?.Authorization;
  if (currentAuth !== nextAuth) return true;
  // 其余字段（url、type、command 等）深度比较
  ...
}
```

OAuth token 刷新后，`buildMcpServer()` 产出新的 `Authorization: Bearer {newToken}` header，`mcpConfigChanged()` 检测到差异，`sync()` 断开旧连接并重建，顺便更新 `toolCache`。

---

### 9.5 LLM 认证：Claude Agent

`postInit()` → `resolveAuthEnvVars()` → 写入 `process.env`

`resolveAuthEnvVars()` 只处理 Anthropic SDK 系的 provider（`isAnthropicProvider()`），其余 provider 返回空 envVars 自行处理：

```
authType === 'api_key' | 'api_key_with_endpoint' | 'bearer_token'
  credManager.getLlmApiKey(slug) → ANTHROPIC_API_KEY
  无 key 且有 baseUrl（Ollama 等）→ ANTHROPIC_API_KEY = 'not-needed'

authType === 'oauth' + providerType === 'anthropic'
  getValidOAuthToken(slug) → CLAUDE_CODE_OAUTH_TOKEN

authType === 'environment'
  不注入（从 process.env 继承）
```

管理的环境变量集（`MANAGED_ANTHROPIC_AUTH_ENV_KEYS`）：

```
ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_BASE_URL,
CLAUDE_CODE_USE_BEDROCK, AWS_BEARER_TOKEN_BEDROCK, ANTHROPIC_BEDROCK_BASE_URL,
AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
```

`clearClaudeBedrockRoutingEnvVars()` 在 Pi 子进程 env 清理时调用，防止 Bedrock 路由变量泄漏到 Pi 子进程。

`resetManagedAnthropicAuthEnvVars()` 在连接切换时将这些变量还原到进程启动时的基线值。

---

### 9.6 LLM 认证：Pi Agent

Pi Agent 通过 JSONL `init` 消息传递凭据给子进程，而非 `process.env`：

```typescript
// pi-agent.ts getPiAuth()
{
  provider: 'anthropic' | 'openai' | ...,
  credential: {
    apiKey?: string,         // API Key
    accessToken?: string,    // OAuth access token
    refreshToken?: string,   // refresh token
    expiresAt?: number,
  }
}

// init 消息结构
{
  type: 'init',
  model,
  systemPrompt,
  auth: getPiAuth(),
  ...
}
```

Token 刷新时主进程通过 `token_update` 消息推送新 token 给子进程：

```
SessionManager.reinitializeAuth()
  → getPiAuth() → 获取最新 token
  → subprocess.send({ type: 'token_update', auth: newAuth })
```

子进程收到 `token_update` 后更新内部 credential，下次请求使用新 token，**无需重启子进程**。

---

### 9.7 Source OAuth 完整流程

以 MCP OAuth 和 Google OAuth 为例，流程在两种场景下略有不同：

#### Electron（桌面）OAuth 流程

```
① 模型调用 source_oauth_trigger { sourceSlug }
   └─ handleSourceOAuthTrigger()
        isAuthenticated + credManager.refresh() → token 有效 → 直接返回成功
        否则 → callbacks.onAuthRequest(authRequest) → forceAbort 中断当前 turn

② UI 收到 AuthRequest 事件
   → 调用 SourceCredentialManager.prepareOAuth(source, { callbackPort })
     provider === 'mcp'       → prepareMcpOAuth(url, { callbackPort })
     provider === 'google'    → prepareGoogleOAuth({ service, callbackPort })
     provider === 'slack'     → prepareSlackOAuth({ service, callbackPort })
     provider === 'microsoft' → prepareMicrosoftOAuth({ service, callbackPort })
     provider === 'generic'   → prepareGenericOAuth(oauthConfig) 或 prepareMcpOAuth（auto-discovery）
   → 返回 PreparedOAuthFlow { authUrl, state, flowId, codeVerifier, ... }

③ UI 打开 authUrl（浏览器）→ 用户授权 → 回调到 localhost:{callbackPort}?code=...

④ UI 提取 code，调用 exchangeAndStore(source, provider, { code, state, ... })
   → exchangeGoogleOAuth / exchangeMcpOAuth / ...
   → save(source, { value: accessToken, refreshToken, expiresAt })
   → markSourceAuthenticated(workspaceRootPath, slug)
     → config.json: isAuthenticated=true, connectionStatus='connected'

⑤ SessionManager 检测到 config 变更
   → 重新 buildServersFromSources()
   → McpClientPool.sync() → 新 token 体现在 Authorization header
   → 旧连接断开，新连接建立，toolCache 刷新
```

#### WebUI OAuth 流程（Relay 模式）

WebUI 无法直接监听 localhost 回调，使用稳定的 relay redirect URI：

```
prepareOAuth(source, { callbackUrl: serverEndpointUrl })
  → providerCallbackUrl = OAUTH_RELAY_CALLBACK_URL   // 固定 https://agents.craft.do/auth/callback
  → wrapPreparedOAuthFlowForRelay(prepared, serverEndpointUrl)
    → 将真实回调目标封装进 state 的外层 relay envelope

OAuth provider → relay worker → 解包 state → 转发到 serverEndpointUrl
serverEndpointUrl → exchangeAndStore() → 同 Electron 流程 ④
```

#### 静默刷新（source_oauth_trigger 快速路径）

```
source.isAuthenticated === true
  → credManager.refresh(loadedSource)
  → doRefresh() → 根据 provider 调用对应 refresh 函数
  → 成功 → 返回新 token，tool 返回 "refreshed successfully"
  → 失败 → 继续走 onAuthRequest 弹出浏览器授权
```

#### 各 OAuth trigger 工具

| 工具名 | 触发条件 | Handler |
|---|---|---|
| `source_oauth_trigger` | MCP source（authType=oauth）或 API source（authType=oauth） | `handleSourceOAuthTrigger` |
| `source_google_oauth_trigger` | `provider === 'google'` | `handleGoogleOAuthTrigger` |
| `source_slack_oauth_trigger` | `provider === 'slack'`，type 必须是 api | `handleSlackOAuthTrigger` |
| `source_microsoft_oauth_trigger` | `provider === 'microsoft'` | `handleMicrosoftOAuthTrigger` |

---

### 9.8 认证全链路总图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        LLM 认证层                                       │
│                                                                          │
│  Claude Agent                        Pi Agent                           │
│  postInit()                          init 消息                          │
│    └─ resolveAuthEnvVars()             └─ getPiAuth()                   │
│         └─ getLlmApiKey()                  └─ getLlmApiKey()            │
│           / getLlmOAuth()                    / getLlmOAuth()            │
│         → process.env.ANTHROPIC_API_KEY    → { credential: {...} }      │
│           process.env.CLAUDE_CODE_OAUTH_TOKEN  (via JSONL)              │
│                                          token_update → 无需重启        │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        Source 认证层                                    │
│                                                                          │
│  CredentialManager（加密文件）                                           │
│    source_oauth / source_bearer / source_apikey / source_basic          │
│           ↑ save()            ↑ load()                                  │
│                                                                          │
│  SourceCredentialManager                                                │
│    refresh()                    exchangeAndStore()                       │
│      ├─ refreshApiRenew()        ├─ exchangeGoogleOAuth()               │
│      ├─ refreshGoogle()          ├─ exchangeSlackOAuth()                │
│      ├─ refreshSlack()           ├─ exchangeMicrosoftOAuth()            │
│      ├─ refreshMicrosoft()       └─ exchangeMcpOAuth()                  │
│      ├─ refreshGeneric()                                                │
│      └─ refreshMcp()                                                    │
│           ↑                                                             │
│  TokenRefreshManager（per-session，5min 冷却）                          │
│    ensureFreshToken() → createTokenGetter()                             │
│           ↑                                                             │
│  SourceServerBuilder.buildAll()                                         │
│    buildMcpServer() → headers 层叠 → McpServerConfig                   │
│    buildApiServer() → getToken/getCredential thunk                      │
│           ↓                                                             │
│  McpClientPool.sync()                                                   │
│    mcpConfigChanged() → Authorization header 变化 → 重连 + 刷新 cache  │
│           ↓                                                             │
│  CraftMcpClient → MCP 服务端（工具调用携带 fresh token）                │
│                                                                          │
│  OAuth 触发（agent 侧）:                                                │
│    source_oauth_trigger → onAuthRequest → UI 打开浏览器                 │
│    prepareOAuth() → authUrl + PKCE → exchangeAndStore() → save()        │
│    → markSourceAuthenticated() → 触发 buildServersFromSources 重建      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 相关文件索引

| 文件 | 职责 |
|------|------|
| `packages/shared/src/mcp/mcp-pool.ts` | Source 连接池，toolCache，代理调用，sync 协调 |
| `packages/shared/src/mcp/client.ts` | MCP 协议客户端（HTTP/stdio），敏感 env 过滤 |
| `packages/shared/src/agent/claude-agent.ts` | Claude 后端：SDK 内存注入，每轮次重建代理服务器 |
| `packages/shared/src/agent/pi-agent.ts` | Pi 后端：子进程 JSONL 协议，register_tools 推送 |
| `packages/pi-agent-server/src/index.ts` | Pi 子进程服务器：接收消息、代理工具、转发事件 |
| `packages/shared/src/agent/core/source-manager.ts` | Source 状态跟踪，`<sources>` XML 块生成 |
| `packages/shared/src/agent/core/prompt-builder.ts` | 上下文块组装（两个 agent 共享） |
| `packages/shared/src/agent/core/prerequisite-manager.ts` | guide.md 前置读取状态机，skill 前置注册 |
| `packages/shared/src/agent/core/pre-tool-use.ts` | 统一 PreToolUse 管道（权限 + source blocking + 前置检查） |
| `packages/shared/src/agent/base-agent.ts` | 公共基类：setSourceServers、resetPrerequisiteState、clearHistory |
| `packages/shared/src/agent/backend/pi/session-tool-defs.ts` | Pi 格式的 session 工具定义（带 `mcp__session__` 前缀） |
| `packages/session-tools-core/src/tool-defs.ts` | Session 工具规范定义（共享，两个 agent 共用） |
| `packages/shared/src/credentials/manager.ts` | LLM 凭据加密存储单例（API Key、OAuth、IAM、Service Account） |
| `packages/shared/src/sources/credential-manager.ts` | Source 凭据 CRUD、OAuth 流程、token 刷新（含各 provider 路由） |
| `packages/shared/src/sources/token-refresh-manager.ts` | per-session token 刷新协调（5min 冷却、失败 needs_auth 标记） |
| `packages/shared/src/sources/server-builder.ts` | 凭据 → McpServerConfig / ApiServer 物化（Header 层叠、per-request getter） |
| `packages/shared/src/sources/types.ts` | SourceMcpAuthType、ApiAuthType、isRefreshableSource、hasRenewEndpoint |
| `packages/shared/src/config/llm-connections.ts` | resolveAuthEnvVars（Claude env 注入）、clearClaudeBedrockRoutingEnvVars |
| `packages/session-tools-core/src/handlers/source-oauth.ts` | OAuth trigger 工具 Handler（MCP、Google、Slack、Microsoft） |
