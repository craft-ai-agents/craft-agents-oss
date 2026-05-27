# Full Prompt 精简分析

## 背景

当前 Pi 对话链路中的 full prompt 不是单一静态 prompt，而是由多层内容拼接而成。它既包含长期稳定的系统规则，也包含每轮变化的上下文、source 状态、skill 列表、team knowledge、工作目录信息等。

随着功能增多，full prompt 容易变长，带来几个问题：

- 首 token 延迟增加。
- 模型处理成本增加。
- 低频能力说明长期占用上下文窗口。
- 重要规则被大量说明性文本稀释。
- 不同任务共用同一套大 prompt，缺少按需注入。

本文基于当前源码分析 full prompt 的组成，并给出可精简、可删除、应保留的建议。

## 当前 Full Prompt 组装方式

Pi agent 的 full prompt 主要由三部分组成。

### 1. 静态 system prompt

来源：

- `packages/shared/src/prompts/system.ts`
- `getSystemPrompt()`
- `getCraftAssistantPrompt()`

主要内容包括：

- MDP / Craft agent 身份说明。
- 核心能力说明。
- External Sources 使用说明。
- Skills 使用说明。
- Project Context 使用说明。
- Configuration Documentation 文档索引。
- Browser Tools 使用说明。
- User Preferences 说明。
- Interaction Guidelines。
- debug context，可选。
- project context files 列表。

### 2. 每轮动态 context parts

来源：

- `packages/shared/src/agent/core/prompt-builder.ts`
- `PromptBuilder.buildContextParts()`

主要内容包括：

- 当前日期时间。
- session state。
- source state。
- available skills。
- team knowledge policy。
- team knowledge prefetch block。
- workspace capabilities。
- working directory context。

### 3. Pi 专属拼接

来源：

- `packages/shared/src/agent/pi-agent.ts`
- `PiAgent.chatImpl()`

核心形态：

```ts
fullSystemPrompt = [systemPrompt, ...contextParts].join('\n\n')
userMessage = attachmentHints + message
```

因此，Pi 最终收到的结构大致是：

```text
[MDP/Craft 静态 system prompt]
[用户偏好]
[debug context 可选]
[project_context_files]
[date/time]
[session state]
[source state]
[available skills]
[team knowledge]
[workspace capabilities]
[working directory]
[attachment hints]
[user message]
```

## Prompt 块级分析

| 模块 | 当前作用 | 主要问题 | 建议 |
| --- | --- | --- | --- |
| Identity / Role | 定义 MDP 身份和工作范围 | 有必要，但可更短 | 保留并压缩 |
| Core Capabilities | 说明 coding、automation、sources 等能力 | 与后续 source/skill 文档有重复 | 压缩成一句能力边界 |
| External Sources | 解释 source 系统和创建流程 | 普通对话多数不需要 source 创建细节 | 按需注入，常驻只保留最小规则 |
| Skills | 解释 skill 发现、路径和使用流程 | 与动态 available skills 重复 | 常驻只保留“先读 SKILL.md” |
| Project Context | 解释 AGENTS.md / CLAUDE.md | 说明偏长 | 保留规则，删除解释性文字 |
| Configuration Documentation | 列出大量配置文档路径 | 低频内容每轮常驻，成本高 | 改成 intent-based 注入 |
| Browser Tools | 说明 browser_tool 工作流和命令 | 文本很长，常驻成本高 | 强压缩，命令细节交给 guide / --help |
| User Preferences | 说明如何更新用户偏好 | 低频能力 | 压缩或按需注入 |
| Interaction Guidelines | 交互风格和工具使用规则 | 有必要，但部分可合并 | 保留核心规则 |
| Debug Context | debug / dev 信息 | 正常对话不需要 | 仅 debug mode 注入 |
| Project Context Files | 列出最多 30 个上下文文件 | 大仓库中可能膨胀 | 限制为 root + 最近相关文件 |
| Date / Time | 提供当前时间 | 有必要 | 保留一行 |
| Session State | 当前 session、计划、数据路径 | 有必要，但可短 | 保留关键字段 |
| Source State | 当前 source 状态 | 对 source 任务有用 | 仅 active / relevant source 注入 |
| Available Skills | 列出所有 skill 名称、描述、路径 | skill 多时很长 | 改为 top-k 或只列相关 skill |
| Team Knowledge | 团队知识策略和预取内容 | 可能较长 | top-k + 字符数上限 |
| Workspace Capabilities | 当前主要描述 local-mcp | 信息密度低 | 删除或按需注入 |
| Working Directory | 当前工作目录和 session root | 有必要 | 保留路径，删除长解释 |

## 可以优先删除或移出常驻 Prompt 的内容

### 1. Browser Tools 的完整命令目录

当前 browser tools 说明偏长，包含较多命令和操作细节。普通聊天、代码分析、文档分析并不需要这些内容。

建议常驻内容只保留：

```text
For browser automation, read the browser tools guide before first use and use browser_tool --help for command details.
```

详细命令通过以下方式获取：

- browser tools guide。
- `browser_tool --help`。
- 用户明确要求打开、点击、截图、测试网页时再注入。

### 2. Configuration Documentation 大表

当前静态 prompt 中列出大量配置文档，例如：

- Sources。
- Permissions。
- Skills。
- Automations。
- Themes。
- Statuses。
- Labels。
- Tool Icons。
- Mermaid。
- Data Tables。
- HTML / PDF / Image / Markdown Preview。
- Browser Tools。
- LLM Tool。

这些大多是低频能力，不应每轮常驻。

建议改为：

```text
Before changing configuration schemas or behavior, read the relevant documentation.
```

然后按用户意图注入对应文档路径。

### 3. External Sources 的创建流程细节

普通用户消息不一定涉及 source 创建、source schema、connector 维护。

建议常驻只保留：

```text
Use configured external sources when relevant. For source creation or schema changes, read the source documentation first.
```

创建 source 的完整流程只在以下场景注入：

- 用户明确提到 source / connector。
- 用户要求接入外部系统。
- agent 需要修改 source schema。
- source 工具调用失败，需要诊断配置。

### 4. Skills 的路径层级说明

当前 system prompt 解释了 global / workspace / project skills 的路径和优先级。实际每轮还会注入 available skills，因此存在重复。

建议常驻只保留：

```text
When a skill is relevant or explicitly requested, read its SKILL.md before using it.
```

skill 的名称、描述、路径由动态块提供。

### 5. Workspace Capabilities

如果该块只表达 local-mcp 是否启用，信息密度较低。

建议：

- 默认删除。
- 仅在用户涉及 MCP、source、tool server、本地服务能力时注入。

## 应该强压缩但不建议完全删除的内容

### 1. Identity / Role

需要保留模型身份和能力边界，但可以压缩。

建议形态：

```text
You are MDP, an AI agent in a desktop app. Help with coding, automation, local files, external sources, and workflows.
```

### 2. Interaction Guidelines

这些规则影响输出质量和安全性，不建议删除。

建议压缩为：

```text
Be concise and direct. Explain actions while working. Ask before destructive actions. Use tools when needed. Use clickable local file links.
```

### 3. Project Context

AGENTS.md / CLAUDE.md 是 repo 级约束，不建议删除。

但可以删除长解释，只保留规则：

```text
Relevant project context files may exist. Read them before modifying code in their scope.
```

### 4. Date / Time

日期时间应该保留。用户经常使用“今天”“明天”“最新”等相对表达，没有当前时间容易出错。

建议保持一行：

```text
Current date: 2026-05-26. Timezone: Asia/Shanghai.
```

### 5. Session State

session state 对计划、数据目录、模式切换有用，但应避免长说明。

建议只保留：

- session id。
- plan folder path。
- data folder path。
- 当前 mode。
- 最近 mode change signal，如果存在。

### 6. Working Directory

工作目录对代码任务非常关键，不建议删除。

建议保留：

- workspace root。
- selected working directory。
- shell cwd。

删除长解释性段落。

## 不建议删除的底线规则

以下规则删除后容易造成行为退化：

- destructive action 前需要确认。
- 修改配置 schema 或行为前读取相关文档。
- 使用 skill 前读取 `SKILL.md`。
- 保留当前日期时间。
- 保留工作目录和 repo root。
- 保留 relevant project context files 的入口。
- 保留 active source 的最小状态。
- 保留用户明确设置过的高优先级偏好。
- 保留本轮真正相关的 team knowledge。

## 推荐的精简方向

### 方向一：静态 System Prompt 缩短到 30%-40%

静态 prompt 应只承载长期稳定的核心规则：

```text
<identity>
You are MDP, an AI agent in a desktop app for coding, automation, files, tools, and external sources.
</identity>

<rules>
Be concise and direct.
Use tools when needed.
Ask before destructive actions.
Read relevant project context before editing.
Read SKILL.md before using a skill.
Read relevant config docs before changing schemas.
Use clickable local file links.
</rules>
```

### 方向二：动态上下文按需注入

建议把大量低频能力从常驻 prompt 移到 intent-based injection。

| 用户意图 | 注入内容 |
| --- | --- |
| browser / localhost / screenshot / click | Browser tools guide 摘要 |
| source / connector / external data | Source docs 摘要 |
| skill mention / skill match | 相关 skills + SKILL.md directive |
| theme / status / label / tool icon | 对应配置文档路径 |
| preview / mermaid / table / html / pdf / image | 对应 preview docs |
| general coding | project context + cwd + minimal rules |
| team knowledge 命中 | top-k team knowledge |

### 方向三：给每个 Prompt Block 加体积观测

在真正删除前，建议先记录每个 block 的字符数或 token 估算：

```text
basePrompt chars
preferences chars
debugContext chars
projectContextFiles chars
dateTime chars
sessionState chars
sourceState chars
skillsState chars
teamKnowledgePolicy chars
teamKnowledgePrefetch chars
workspaceCapabilities chars
workingDirectory chars
finalSystemPrompt chars
userMessage chars
```

这样可以确认每轮最大块是谁，避免凭感觉优化。

### 方向四：引入 compact prompt preset

可以保留当前 full prompt 作为 legacy / verbose preset，同时新增 compact preset：

- `full`：现有行为，兼容性最好。
- `compact`：默认精简版，适合日常任务。
- `minimal`：仅核心规则 + 当前上下文，适合低延迟模式。

推荐先实现 compact，并通过 feature flag 灰度。

## 建议的 Compact Full Prompt 结构

```text
<identity>
You are MDP, an AI agent in a desktop app for coding, automation, files, tools, and external sources.
</identity>

<rules>
Be concise and direct.
Use tools when needed.
Ask before destructive actions.
Read relevant project context before editing.
Read SKILL.md before using a skill.
Read relevant config docs before changing schemas.
Use clickable local file links.
</rules>

<context>
Current date/time...
Workspace root...
Working directory...
Session state...
Relevant project context files...
Active sources...
Relevant skills only...
Relevant team knowledge only...
</context>
```

详细说明、命令列表、配置文档索引、source 创建流程、browser 命令等都不应常驻，而应在相关任务触发时再注入。

## 风险与验证

### 可能风险

- 删掉过多 source 说明后，agent 创建 source 的成功率下降。
- 删掉 browser tools 细节后，首次使用 browser_tool 的命令准确率下降。
- skill 描述压缩过度后，skill 命中率下降。
- 配置文档按需注入不准时，agent 可能漏读必要文档。

### 验证指标

建议对比 full / compact 两种模式：

- full prompt token 数。
- time to first event。
- time to first visible delta。
- tool call 错误率。
- source 使用成功率。
- browser_tool 使用成功率。
- skill 命中率。
- 配置变更是否读取正确文档。
- 用户中断率。

## 结论

当前 full prompt 的主要问题不是单个句子过长，而是大量低频能力说明常驻在每一轮请求中。

最应该优先处理的是：

1. Browser Tools 长说明。
2. Configuration Documentation 大表。
3. External Sources 创建流程。
4. Skills 路径和机制说明。
5. 全量 available skills。
6. project context files 上限过高。
7. workspace capabilities 低信息密度块。

推荐策略是：

- 静态 system prompt 只保留核心身份和底线规则。
- 低频能力全部改为按需注入。
- 动态上下文只注入 active / relevant 信息。
- 先加 block 级体积观测，再逐步灰度 compact prompt。

