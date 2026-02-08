# Session Sharing API 技术规范

本文档描述了 Craft Agent "Share Online" 功能的后端 API 规范，用于在新服务上复刻该功能。

## 概览

Session Sharing API 是一个简单的 RESTful API，用于：
1. 上传会话 JSON 数据并生成可分享链接
2. 更新已分享的会话内容
3. 撤销（删除）分享
4. 获取已分享的会话数据供 Web Viewer 展示

**当前生产环境**: `https://agents.craft.do`

---

## API 端点

### 1. 创建分享

**请求**

```http
POST /s/api
Content-Type: application/json

{session JSON payload}
```

**响应**

```json
{
  "id": "tz5-13I84pwK_he",
  "url": "https://agents.craft.do/s/tz5-13I84pwK_he"
}
```

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | string | 唯一标识符，用于后续更新/删除操作。格式: URL-safe 字符串 (a-zA-Z0-9_-) |
| `url` | string | 完整的可分享 URL |

**状态码**

| 状态码 | 描述 |
|--------|------|
| 200 | 成功创建分享 |
| 413 | 请求体过大 (Payload Too Large) |
| 500 | 服务器内部错误 |

---

### 2. 更新分享

**请求**

```http
PUT /s/api/{id}
Content-Type: application/json

{updated session JSON payload}
```

**响应**

```
200 OK
```

**状态码**

| 状态码 | 描述 |
|--------|------|
| 200 | 成功更新 |
| 404 | 分享不存在 |
| 413 | 请求体过大 |
| 500 | 服务器内部错误 |

---

### 3. 删除分享

**请求**

```http
DELETE /s/api/{id}
```

**响应**

```
200 OK
```

**状态码**

| 状态码 | 描述 |
|--------|------|
| 200 | 成功删除 |
| 404 | 分享不存在 |
| 500 | 服务器内部错误 |

---

### 4. 获取分享内容

**请求**

```http
GET /s/api/{id}
```

**响应**

```json
{完整的 session JSON}
```

**状态码**

| 状态码 | 描述 |
|--------|------|
| 200 | 成功获取 |
| 404 | 分享不存在或已撤销 |

---

## 数据结构

### StoredSession (请求/响应 Payload)

这是上传和获取时使用的完整 Session 数据结构：

```typescript
interface StoredSession {
  // === 核心标识 ===
  id: string;                      // Session 唯一标识 (UUID)
  sdkSessionId?: string;           // SDK session ID
  workspaceRootPath: string;       // 工作区路径 (可为相对路径)
  
  // === 元数据 ===
  name?: string;                   // 用户定义的名称
  createdAt: number;               // 创建时间戳 (ms)
  lastUsedAt: number;              // 最后使用时间戳 (ms)
  lastMessageAt?: number;          // 最后消息时间戳
  
  // === 状态标记 ===
  isFlagged?: boolean;             // 是否标记
  todoState?: string;              // 待办状态 ('todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled')
  labels?: string[];               // 标签列表
  
  // === 分享状态 (客户端维护，API 不依赖) ===
  sharedUrl?: string;              // 分享 URL
  sharedId?: string;               // 分享 ID
  
  // === 配置 ===
  model?: string;                  // 使用的模型
  thinkingLevel?: 'off' | 'think' | 'max';
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  workingDirectory?: string;       // 工作目录
  
  // === 核心内容 ===
  messages: StoredMessage[];       // 消息列表
  tokenUsage: SessionTokenUsage;   // Token 使用统计
}
```

### StoredMessage

```typescript
interface StoredMessage {
  id: string;
  type: MessageRole;               // 'user' | 'assistant' | 'tool' | 'error' | 'status' | 'info' | 'warning' | 'plan' | 'auth-request'
  content: string;
  timestamp?: number;
  
  // === Tool 相关字段 ===
  toolName?: string;               // 工具名称 (如 'Read', 'Edit', 'Bash')
  toolUseId?: string;              // 工具调用 ID
  toolInput?: Record<string, unknown>;  // 工具输入参数
  toolResult?: string;             // 工具执行结果
  toolStatus?: ToolStatus;         // 'pending' | 'executing' | 'completed' | 'error' | 'backgrounded'
  toolDuration?: number;           // 执行时长 (ms)
  toolIntent?: string;             // 工具意图描述
  toolDisplayName?: string;        // 显示名称
  toolDisplayMeta?: ToolDisplayMeta;  // 显示元数据
  
  // === 嵌套工具调用 ===
  parentToolUseId?: string;        // 父工具 ID (用于 Task 子代理)
  
  // === 后台任务 ===
  taskId?: string;                 // Task 后台任务 ID
  shellId?: string;                // Bash 后台 shell ID
  elapsedSeconds?: number;
  isBackground?: boolean;
  
  // === 错误信息 ===
  isError?: boolean;
  errorCode?: string;
  errorTitle?: string;
  errorDetails?: string[];
  errorOriginal?: string;
  errorCanRetry?: boolean;
  
  // === 附件 ===
  attachments?: StoredAttachment[];
  badges?: ContentBadge[];
  
  // === Turn 分组 ===
  isIntermediate?: boolean;        // 中间文本 (工具调用间的注释)
  turnId?: string;                 // Turn 关联 ID
  
  // === 特殊消息类型 ===
  statusType?: 'compacting' | 'compaction_complete';
  ultrathink?: boolean;
  planPath?: string;               // Plan 文件路径
  
  // === 认证请求相关 ===
  authRequestId?: string;
  authRequestType?: 'credential' | 'oauth' | 'oauth-google' | 'oauth-slack' | 'oauth-microsoft';
  authSourceSlug?: string;
  authSourceName?: string;
  authStatus?: 'pending' | 'completed' | 'cancelled' | 'failed';
  // ... 其他 auth 字段
}
```

### SessionTokenUsage

```typescript
interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  costUsd: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  contextWindow?: number;
}
```

### ToolDisplayMeta

```typescript
interface ToolDisplayMeta {
  displayName: string;             // 显示名称
  iconDataUrl?: string;            // Base64 图标 (data:image/png;base64,...)
  description?: string;
  category?: 'skill' | 'source' | 'native' | 'mcp';
}
```

### StoredAttachment

```typescript
interface StoredAttachment {
  id: string;
  type: 'image' | 'text' | 'pdf' | 'office' | 'unknown';
  name: string;                    // 原始文件名
  mimeType: string;
  size: number;
  originalSize?: number;
  storedPath: string;              // 文件存储路径
  thumbnailPath?: string;
  thumbnailBase64?: string;        // Base64 缩略图
  markdownPath?: string;
  wasResized?: boolean;
  resizedBase64?: string;
}
```

### ContentBadge

```typescript
interface ContentBadge {
  type: 'source' | 'skill' | 'context' | 'command' | 'file' | 'folder';
  label: string;
  rawText: string;
  iconDataUrl?: string;
  start: number;
  end: number;
  collapsedLabel?: string;
  filePath?: string;
}
```

---

## 实现建议

### ID 生成

分享 ID 应该：
- URL-safe: 只包含 `a-zA-Z0-9_-`
- 唯一: 建议使用 NanoID 或类似库
- 简短: 约 15-20 字符

```javascript
// 示例: 使用 nanoid
import { nanoid } from 'nanoid';
const shareId = nanoid(15); // "tz5-13I84pwK_he"
```

### 存储

建议使用对象存储 (如 Cloudflare R2, AWS S3):
- Key: `shares/{id}.json`
- Value: 完整的 Session JSON

### 大小限制

- 建议限制: 10MB
- 返回 413 状态码当超出限制

### CORS 配置

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### 安全考虑

1. **无认证**: 当前 API 无需认证，任何人可以创建/访问分享
2. **敏感信息**: Session 可能包含敏感信息，用户需自行决定是否分享
3. **过期策略**: 可考虑添加自动过期机制 (如 30 天)
4. **速率限制**: 建议添加 IP 级别的速率限制

---

## Web Viewer 路由

Viewer 应用需要处理的路由：

| 路由 | 功能 |
|------|------|
| `/` | 上传界面 (手动上传 JSON 文件) |
| `/s/{id}` | 查看分享的 Session |

---

## 示例：完整请求流程

### 创建分享

```bash
curl -X POST https://your-api.com/s/api \
  -H "Content-Type: application/json" \
  -d @session.json

# Response:
# {"id":"abc123xyz","url":"https://your-api.com/s/abc123xyz"}
```

### 更新分享

```bash
curl -X PUT https://your-api.com/s/api/abc123xyz \
  -H "Content-Type: application/json" \
  -d @session-updated.json
```

### 删除分享

```bash
curl -X DELETE https://your-api.com/s/api/abc123xyz
```

### 获取分享

```bash
curl https://your-api.com/s/api/abc123xyz

# Response: {完整 session JSON}
```

---

## 客户端集成

在客户端代码中替换 `VIEWER_URL`:

```typescript
// packages/shared/src/branding.ts
export const VIEWER_URL = 'https://your-new-service.com';
```

API 调用代码位于 `apps/electron/src/main/sessions.ts`:
- `shareToViewer()` - L1927-1982
- `updateShare()` - L1988-2033
- `revokeShare()` - L2039-2086
