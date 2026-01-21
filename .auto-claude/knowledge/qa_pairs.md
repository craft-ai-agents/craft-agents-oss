# Craft Agents - 源码问答 (QA Pairs)

本文档基于源码分析生成，旨在通过问答形式帮助开发者快速理解项目核心逻辑。

## 1. 核心类型与数据结构 (Core Types)

### Q: Session (会话) 和 Workspace (工作区) 的关系是什么？
**A:** `Session` 是会话的主要隔离边界。每个 Session 属于且仅属于一个 `Workspace` (通过 `workspaceId` 关联)。
- **源码位置**: `packages/core/src/types/session.ts`
- **关键点**: Session ID 是全局唯一的 UUID，同时映射到一个 SDK Session ID。

### Q: Message ID 是如何生成的？有什么格式要求？
**A:** 必须使用 `generateMessageId()` 工具函数生成，不能手动创建字符串。
- **格式**: `msg-{timestamp}-{random}` (例如 `msg-1702736400000-a1b2c3`)
- **源码位置**: `packages/core/src/types/message.ts`

### Q: StoredSession 和 Session 接口有什么区别？
**A:**
- `Session`: 仅包含元数据（ID, 名称, 状态, 时间戳），用于列表展示。
- `StoredSession`: 继承自 `Session`，额外包含完整消息列表 (`messages`) 和 Token 使用统计 (`tokenUsage`)，用于磁盘持久化。

### Q: MessageRole 有哪些类型，分别代表什么？
**A:**
- `user`/`assistant`: 标准对话角色。
- `tool`: 工具执行结果。
- `system`: 系统提示。
- `error`: 错误信息。
- `status`: 状态更新（如 "Compacting memory..."）。
- `plan`: 规划模式产生的消息。
- `auth-request`: 专门用于请求用户授权的消息类型。

---

## 2. 架构与设计模式 (Architecture)

### Q: 项目是如何处理认证 (Authentication) 的？
**A:** 采用了严格分离的认证策略：
1. **Craft Auth** (`craft_oauth::global`): 仅用于 Craft API（如管理 Space、同步设置）。
2. **MCP Auth** (`workspace_oauth::{workspaceId}`): 每个 MCP Server 拥有独立的 OAuth 流程。
**注意**: 严禁混用这两种 Token。

### Q: 为什么 `packages/core` 只包含类型定义？
**A:** 这是一个设计决策，旨在避免循环依赖并保持类型契约的纯净。
- **Core**: 仅包含 Types 和纯 Utils。
- **Shared**: 包含实际的业务逻辑（Agent, Auth, Config）。
- **App**: 具体的应用实现（Electron, Viewer）。

### Q: 如何处理超大的工具响应 (Large Tool Responses)？
**A:** 系统内置了自动摘要机制。
- 当工具返回内容超过 ~60KB 时，会自动调用小模型 (Haiku) 进行摘要。
- 摘要会保留 `_intent` 字段以维持上下文连贯性。

### Q: 什么是 "Permission Modes" (权限模式)？
**A:** 这是一个三级安全控制系统：
1. **Safe (Explore)**: 只读模式，拦截所有写操作和命令执行。
2. **Ask (Ask to Edit)**: 默认模式，执行敏感操作（如 Bash, 写文件）前需用户确认。
3. **Auto (Allow All)**: 自动批准所有操作。
- **源码位置**: `packages/shared/src/agent/mode-manager.ts`

---

## 3. 核心逻辑 (Core Logic)

### Q: 凭证 (Credentials) 是如何安全存储的？
**A:** 所有敏感信息（API Key, OAuth Token）都不直接存储在 `config.json` 中。
- 它们被保存在 `~/.craft-agent/credentials.enc`。
- 使用 AES-256-GCM 算法进行加密。
- 通过 `CredentialManager` 类进行存取。

### Q: Session 是如何持久化的？
**A:** 使用了防抖 (Debounced) 的写入策略。
- **机制**: `persistence-queue.ts` 负责管理写入队列，默认有 500ms 延迟。
- **格式**: 数据以 JSONL (JSON Lines) 格式存储在 `~/.craft-agent/workspaces/{id}/sessions/` 目录下。

### Q: 如何在运行时动态修改配置？
**A:** 系统实现了一个 `Config Watcher`。
- **源码位置**: `packages/shared/src/config/watcher.ts`
- **行为**: 监听 `config.json`, `theme.json`, `permissions.json` 的文件变化，并触发相应的回调（如 `onThemeChange`），实现配置的热更新。

---

## 4. 常见陷阱 (Gotchas)

### Q: 在开发 UI 时需要注意什么数据展示问题？
**A:** 不要假设 `toolResult` 永远是完整的原始文本。如果是大文件读取，你拿到的可能是 AI 生成的摘要。UI 应当能优雅地展示摘要内容。

### Q: 可以使用 npm 或 yarn 吗？
**A:** **不可以**。项目强制使用 **Bun** 作为运行时和包管理器。使用其他工具可能会导致锁文件冲突或脚本执行失败。
