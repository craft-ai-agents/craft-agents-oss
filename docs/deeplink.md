# bunnyagents:// Deep Link 使用文档

`bunnyagents://` 是 Craft Agents 应用的自定义 URL 协议，允许外部应用或脚本通过 URL 控制和导航应用。

## 概述

URL 格式分为两大类：
1. **视图导航（Compound Routes）** - 导航到应用的不同视图
2. **操作执行（Action Routes）** - 执行特定的操作

## 通用参数

所有 URL 都支持以下查询参数：

| 参数 | 值 | 说明 |
|------|-----|------|
| `window` | `focused` / `full` | 在新窗口中打开（`focused` = 900x700 小窗口，`full` = 全尺寸窗口） |
| `sidebar` | 字符串 | 右侧边栏显示内容（如 `sessionMetadata`、`files/path/to/file`） |

---

## 视图导航

### 聊天列表视图

#### 所有聊天
```
bunnyagents://allChats
bunnyagents://allChats/chat/{sessionId}
```

| 格式 | 说明 |
|------|------|
| `bunnyagents://allChats` | 显示所有聊天列表 |
| `bunnyagents://allChats/chat/abc123` | 显示所有聊天列表，并选中指定会话 |

#### 标记的聊天
```
bunnyagents://flagged
bunnyagents://flagged/chat/{sessionId}
```

| 格式 | 说明 |
|------|------|
| `bunnyagents://flagged` | 显示已标记的聊天列表 |
| `bunnyagents://flagged/chat/abc123` | 显示已标记的聊天，并选中指定会话 |

#### 按状态筛选
```
bunnyagents://state/{stateId}
bunnyagents://state/{stateId}/chat/{sessionId}
```

| 格式 | 说明 |
|------|------|
| `bunnyagents://state/todo` | 显示特定状态的聊天列表 |
| `bunnyagents://state/done/chat/abc123` | 显示特定状态的聊天，并选中指定会话 |

---

### 数据源视图

```
bunnyagents://sources
bunnyagents://sources/source/{sourceSlug}
```

| 格式 | 说明 |
|------|------|
| `bunnyagents://sources` | 显示所有数据源列表 |
| `bunnyagents://sources/source/github` | 显示数据源列表，并选中 GitHub 源 |
| `bunnyagents://sources/source/gmail` | 显示数据源列表，并选中 Gmail 源 |

---

### 技能视图

```
bunnyagents://skills
bunnyagents://skills/skill/{skillSlug}
```

| 格式 | 说明 |
|------|------|
| `bunnyagents://skills` | 显示所有技能列表 |
| `bunnyagents://skills/skill/code-review` | 显示技能列表，并选中指定技能 |

---

### 设置视图

```
bunnyagents://settings
bunnyagents://settings/{subpage}
```

| 格式 | 说明 |
|------|------|
| `bunnyagents://settings` | 打开设置页面 |
| `bunnyagents://settings/general` | 打开通用设置 |
| `bunnyagents://settings/shortcuts` | 打开快捷键设置 |
| `bunnyagents://settings/preferences` | 打开偏好设置 |

---

## 操作执行

操作 URL 格式：
```
bunnyagents://action/{actionName}[/{id}][?params]
bunnyagents://workspace/{workspaceId}/action/{actionName}[?params]
```

### new-chat - 创建新聊天

创建新的聊天会话，支持预填内容和自动发送。

```
bunnyagents://action/new-chat[?params]
```

**支持的参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `input` | 字符串（URL 编码） | 预填的消息内容，支持 `{{clipboard}}` 占位符 |
| `send` | `true` | 自动发送消息（需配合 `input` 使用） |
| `name` | 字符串（URL 编码） | 会话名称 |
| `mode` | `safe` / `ask` / `allow-all` | 权限模式 |
| `status` | 字符串 | 设置会话的 todo 状态 |
| `label` | 字符串 | 设置会话标签 |
| `workdir` | `user_default` / `none` / 绝对路径 | 工作目录 |
| `badges` | JSON 字符串（URL 编码） | 内容标记（用于隐藏 XML 上下文） |
| `window` | `focused` / `full` | 在新窗口中打开 |

**示例：**

```bash
# 创建空白聊天
bunnyagents://action/new-chat

# 创建聊天并预填内容
bunnyagents://action/new-chat?input=Hello%20World

# 创建聊天并使用剪贴板内容预填
bunnyagents://action/new-chat?input={{clipboard}}

# 创建聊天并发送剪贴板内容
bunnyagents://action/new-chat?input={{clipboard}}&send=true

# 创建聊天并立即发送消息
bunnyagents://action/new-chat?input=Hello%20World&send=true

# 创建带名称的聊天
bunnyagents://action/new-chat?name=My%20Project

# 创建聊天并设置权限模式
bunnyagents://action/new-chat?mode=ask

# 创建聊天并设置工作目录
bunnyagents://action/new-chat?workdir=/Users/me/project

# 在新的聚焦窗口中创建聊天
bunnyagents://action/new-chat?window=focused

# 完整示例：新窗口 + 自动发送 + 权限模式 + 工作目录
bunnyagents://action/new-chat?window=focused&input=Review%20this%20code&send=true&mode=ask&workdir=/Users/me/project
```

---

### rename-session - 重命名会话

```
bunnyagents://action/rename-session/{sessionId}?name={newName}
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | 字符串（URL 编码） | 新的会话名称（必需） |

**示例：**

```bash
bunnyagents://action/rename-session/abc123?name=New%20Name
```

---

### delete-session - 删除会话

```
bunnyagents://action/delete-session/{sessionId}
```

**示例：**

```bash
bunnyagents://action/delete-session/abc123
```

---

### flag-session - 标记会话

将会话添加到标记列表。

```
bunnyagents://action/flag-session/{sessionId}
```

**示例：**

```bash
bunnyagents://action/flag-session/abc123
```

---

### unflag-session - 取消标记会话

从标记列表中移除会话。

```
bunnyagents://action/unflag-session/{sessionId}
```

**示例：**

```bash
bunnyagents://action/unflag-session/abc123
```

---

### set-mode - 设置权限模式

设置会话的权限模式。

```
bunnyagents://action/set-mode/{sessionId}?mode={mode}
```

**参数：**

| 参数 | 值 | 说明 |
|------|-----|------|
| `mode` | `safe` | 安全模式 - 只读操作 |
| `mode` | `ask` | 询问模式 - 编辑前询问 |
| `mode` | `allow-all` | 自动模式 - 自动执行 |

**示例：**

```bash
bunnyagents://action/set-mode/abc123?mode=ask
```

---

### oauth - 启动 OAuth 认证

为指定数据源启动 OAuth 认证流程。

```
bunnyagents://action/oauth/{sourceId}
```

**示例：**

```bash
bunnyagents://action/oauth/github
bunnyagents://action/oauth/gmail
```

---

### delete-source - 删除数据源

删除指定的数据源配置。

```
bunnyagents://action/delete-source/{sourceId}
```

**示例：**

```bash
bunnyagents://action/delete-source/github
```

---

### copy - 复制文本

将文本复制到剪贴板。

```
bunnyagents://action/copy?text={text}
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `text` | 字符串（URL 编码） | 要复制的文本（必需） |

**示例：**

```bash
bunnyagents://action/copy?text=Hello%20World
```

---

## 工作区定向

可以在 URL 中指定工作区 ID，使操作在特定工作区中执行：

```
bunnyagents://workspace/{workspaceId}/...
```

**示例：**

```bash
# 在指定工作区中打开聊天
bunnyagents://workspace/ws123/allChats/chat/abc123

# 在指定工作区中创建新聊天
bunnyagents://workspace/ws123/action/new-chat

# 在指定工作区中查看设置
bunnyagents://workspace/ws123/settings
```

如果不指定工作区，操作将在当前活动窗口的工作区中执行。

---

## 使用场景示例

### 从终端快速创建聊天

```bash
# macOS
open "bunnyagents://action/new-chat?input=Help%20me%20review%20this%20code&send=true"

# 或使用 xdg-open (Linux)
xdg-open "bunnyagents://action/new-chat?input=Help%20me%20review%20this%20code&send=true"
```

### 从目录打开应用

可以直接在项目目录中使用 `open -a` 命令打开 Bunny 并设置 working directory：

```bash
# 在当前目录打开 Bunny
open -a Bunny .

# 打开指定目录
open -a Bunny /Users/me/project
```

也可以将文件夹拖拽到 Dock 上的 Bunny 图标来打开。

### 从脚本打开特定会话

```bash
#!/bin/bash
SESSION_ID="abc123"
open "bunnyagents://allChats/chat/${SESSION_ID}?window=focused"
```

### Alfred/Raycast 集成

可以创建工作流，快速：
- 创建新聊天并预填问题
- 打开最近的会话
- 切换到设置页面

### 在新窗口中打开

```bash
# 在聚焦小窗口中打开设置
open "bunnyagents://settings?window=focused"

# 在新全尺寸窗口中打开聊天
open "bunnyagents://allChats/chat/abc123?window=full"
```

---

## 注意事项

1. **URL 编码**：所有参数值需要进行 URL 编码，特别是包含空格和特殊字符的内容
2. **会话 ID**：会话 ID 可以在应用中复制或通过 API 获取
3. **工作区**：如果应用中有多个工作区，建议指定工作区 ID 以确保操作在正确的工作区中执行
4. **窗口模式**：`window=focused` 创建 900x700 的小窗口，适合快速任务；`window=full` 创建全尺寸窗口
5. **权限模式**：
   - `safe` - 只执行只读操作，不修改文件
   - `ask` - 编辑操作前会询问用户确认
   - `allow-all` - 自动执行所有操作（谨慎使用）
