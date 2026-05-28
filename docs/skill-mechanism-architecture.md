# Skill 机制设计与使用流程

本文结合源码说明 app 中 skill 机制的设计、存储、管理、mention 使用、agent 注入、source 联动和 Marketplace 安装流程。

## 整体定位

这个 app 里的 skill 机制，本质不是“运行一段插件代码”，而是“把一组可复用的指令文件注册成可被用户点选、提及、强制读取的上下文能力”。

核心载体是 `SKILL.md`，配套机制包括：

- UI 管理
- 文件存储
- mention 解析
- agent 注入
- 读前置约束
- `requiredSources` 自动启用
- Marketplace 安装和发布

主链路如下：

```text
本地/市场/远程/zip 创建 skill
  -> 写入 skills/{slug}/SKILL.md
  -> UI 加载 LoadedSkill 列表
  -> 用户在输入框 @ 选择 skill，插入 [skill:plugin:slug]
  -> 提交时 parseMentions 得到 skillSlugs
  -> SessionManager 预启用 requiredSources
  -> BaseAgent 解析 skill mention，定位 SKILL.md
  -> PrerequisiteManager 阻止其他工具，直到模型读取 SKILL.md
  -> 模型按 SKILL.md 指令执行任务
```

## 数据模型

skill 的核心类型在：

- `packages/shared/src/skills/types.ts`

`SkillMetadata` 对应 `SKILL.md` frontmatter：

```ts
export interface SkillMetadata {
  name: string
  description: string
  globs?: string[]
  alwaysAllow?: string[]
  icon?: string
  requiredSources?: string[]
  metadata?: Record<string, unknown>
  author?: string
  extraMetadata?: Record<string, unknown>
}
```

关键字段：

- `name` / `description`：UI 展示和基础校验必需。
- `globs`：声明适用文件模式，兼容 Claude Code SDK 格式，也为自动触发预留。
- `alwaysAllow`：声明 skill 激活时可预批准的工具，兼容 SDK。
- `icon`：UI 图标，支持 emoji 或 URL。
- `requiredSources`：app 自己重点使用的字段，skill 被调用时自动启用相关 Source。
- `metadata`：扩展块，可声明 skill-provided MCP source。

加载后的结构是 `LoadedSkill`：

```ts
export interface LoadedSkill {
  slug: string
  metadata: SkillMetadata
  content: string
  iconPath?: string
  path: string
  source: SkillSource
  marketplaceOrigin?: MarketplaceOriginMetadata
}
```

其中 `source` 有三层：

```ts
export type SkillSource = 'global' | 'workspace' | 'project'
```

## 存储设计

skill 是文件系统对象，不是数据库记录。存储逻辑在：

- `packages/shared/src/skills/storage.ts`

三层路径：

```text
Global:    ~/.agents/skills/{slug}/SKILL.md
Workspace: {workspaceRoot}/skills/{slug}/SKILL.md
Project:   {workingDirectory}/.agents/skills/{slug}/SKILL.md
```

代码中定义：

```ts
export const GLOBAL_AGENT_SKILLS_DIR = join(homedir(), '.agents', 'skills')
export const PROJECT_AGENT_SKILLS_DIR = '.agents/skills'
```

加载优先级：

```text
global < workspace < project
```

同 slug 时：

- project 覆盖 workspace
- workspace 覆盖 global

`loadAllSkills` 用 `Map` 按顺序覆盖实现这个优先级：

```ts
// 1. Global skills (lowest priority)
// 2. Workspace skills (medium priority)
// 3. Project skills (highest priority)
```

单个 skill 查找用 `loadSkillBySlug`，从高优先级往低优先级查：

```text
project -> workspace -> global
```

## SKILL.md 解析

`SKILL.md` 用 `gray-matter` 解析。要求 frontmatter 至少包含：

```yaml
---
name: "Skill Name"
description: "What this skill does"
---
```

解析逻辑：

```ts
const parsed = matter(content)
if (!parsed.data.name || !parsed.data.description) {
  return null
}
```

解析结果：

- frontmatter -> `metadata`
- markdown body -> `content`

`display_name` 会覆盖 `name` 作为展示名：

```ts
name: (parsed.data.display_name || parsed.data.name) as string
```

## 创建、覆盖、删除

创建和覆盖仍然只是写文件：

```ts
writeFileSync(join(skillDir, 'SKILL.md'), matter.stringify(content, metadata))
```

主要 API：

- `createSkill(...)`：如果已有同 slug skill，返回 conflict。
- `forceWriteSkill(...)`：直接覆盖。
- `deleteSkill(...)`：删除 skill 目录。

写入后会调用：

```ts
invalidateSkillsCache()
```

避免 UI 和 agent 读到旧列表。

## UI 和 RPC 管理流程

Electron renderer 不直接读写 skill 文件，而是走 RPC。

主要入口：

- `packages/server-core/src/handlers/rpc/skills.ts`

主要 channel：

- `skills.GET`：读取所有 skill，支持传入 `workingDirectory` 以加载 project skills。
- `skills.GET_FILES`：读取 skill 目录文件树。
- `skills.CREATE`：创建 skill。
- `skills.FORCE_WRITE`：覆盖写 skill。
- `skills.DELETE`：按 source 路由删除 global/workspace/project skill。
- `skills.OPEN_EDITOR`：打开 `SKILL.md`。
- `skills.OPEN_FINDER`：打开 skill 目录。
- `skills.EXTRACT_ZIP`：从 zip 发现 skill。
- `skills.RESOLVE_REMOTE`：从远程 repo 发现 skill。
- `skills.INSTALL_MARKETPLACE`：安装 Marketplace Skill。
- `skills.UPDATE_MARKETPLACE`：更新 Marketplace Skill。
- `skills.PUBLISH_MARKETPLACE`：发布本地 skill 到 Marketplace。

`skills.GET` 流程：

```text
workspaceId
  -> getWorkspaceByNameOrId
  -> validate workingDirectory exists
  -> invalidateSkillsCache
  -> loadAllSkills(workspace.rootPath, effectiveWorkingDir)
  -> return LoadedSkill[]
```

创建和覆盖后会做两件事：

```text
installSkillMcpSources(...)
pushSkillsChanged(...)
```

这说明 skill 不只是 UI 列表项；它创建后可能顺带声明并安装 MCP Sources。

## Skill-provided MCP Source

skill 的 metadata 可以声明 MCP source。提取逻辑在：

- `packages/shared/src/skills/mcp-sources.ts`

它从 frontmatter 的 vendor metadata 中找：

```text
metadata.mdp.mcp.clients
```

然后把它转成普通 MCP source candidate：

```ts
parseMcpJsonImportCandidates(JSON.stringify({ mcpServers: clients }))
```

RPC handler 里的 `installSkillMcpSources` 会：

1. 解析 candidates。
2. 检查重复 source。
3. 创建缺失 source。
4. 把 source slug 加入 workspace defaults。
5. 广播 `sources.CHANGED`。

设计含义：

- skill 可以“附带声明需要的工具连接”。
- source 最终仍然落地为普通 workspace Source。
- skill 不隐藏运行时能力，也不从自己目录里直接运行 MCP server。

## UI 使用入口：Mention

用户使用 skill 的主要方式是输入框 `@` mention。

相关代码：

- `apps/electron/src/renderer/components/ui/mention-menu.tsx`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`
- `packages/shared/src/mentions/index.ts`

`useInlineMention` 会把 skill/source/file/folder 合并成一个 mention 菜单。skills section 来自当前加载的 `LoadedSkill[]`：

```ts
items: skills.map(skill => ({
  id: skill.slug,
  type: 'skill',
  label: skill.metadata.name,
  description: skill.metadata.description,
  skill,
}))
```

选择 skill 后插入 bracket syntax：

```text
[skill:{pluginName}:{slug}]
```

pluginName 取决于 skill 来源：

```text
workspace skill -> workspaceId / workspace slug
project/global skill -> .agents
```

这是为了兼容 Claude SDK 的 plugin skill 解析方式。

`.agents` 常量定义为：

```ts
export const AGENTS_PLUGIN_NAME = '.agents'
```

## 消息提交时的解析

提交消息时，输入框会调用 `parseMentions`：

```ts
const skillSlugs = skills.map(s => s.slug)
const sourceSlugs = sources.map(s => s.config.slug)
const mentions = parseMentions(input, skillSlugs, sourceSlugs)
```

然后把 `mentions.skills` 传给 `onSubmit`：

```ts
onSubmit(
  finalText,
  attachments,
  mentions.skills.length > 0 ? mentions.skills : undefined
)
```

parser 支持：

```text
[skill:slug]
[skill:workspaceId:slug]
```

并只取最后的 slug：

```ts
const skillPattern = new RegExp(`\\[skill:(?:${WS_ID_CHARS}+:)?([\\w-]+)\\]`, 'g')
```

如果 skill slug 不在当前可用 skill 列表中，会进入 `invalidSkills`。

## Agent 执行流程

真正让 skill 生效的是 `BaseAgent.chat()`，不是 UI。

相关代码：

- `packages/shared/src/agent/base-agent.ts`

`BaseAgent.extractSkillPaths` 会：

1. `loadAllSkills(workspaceRoot, projectRoot)`
2. 用 `parseMentions` 找出 message 中提到的 skill。
3. 把 slug 解析到实际 `SKILL.md` 绝对路径。
4. 把 mention 替换成语义文本。

语义替换示例：

```text
[skill:datadog-api]
  -> [Mentioned skill: Datadog API (slug: datadog-api)]
```

这样做不是简单删除 mention，而是保留“用户明确提到了某个 skill”的语义。

如果用户只输入了 skill mention，没有其他文本，会补默认任务：

```text
Follow the skill instructions from the files listed above.
```

随后 `BaseAgent.chat()` 会：

1. 如果 skill 不存在，直接返回 error。
2. 把 `SKILL.md` 路径注册到 `PrerequisiteManager`。
3. 在用户消息前 prepend 一段强制指令：先读这些 `SKILL.md`。
4. 再调用 provider-specific 的 `chatImpl`。

强制指令类似：

```text
Before proceeding with the user's request, you MUST read the following skill instruction files using the Read tool or `cat` via Bash:
- /path/to/SKILL.md (skill: slug)

Do not take any other action until you have read these files.
```

这个设计重点是：skill 内容不会由宿主直接塞进 prompt，而是要求模型自己读取对应文件。这样路径透明，也能在上下文压缩后重新要求读取。

## 读前置约束

`PrerequisiteManager` 会记录 pending skill paths。

相关代码：

- `packages/shared/src/agent/core/prerequisite-manager.ts`

当还有未读的 `SKILL.md` 时：

- `Read` 工具允许通过。
- 其他工具会被阻止一次，提示必须先读 skill 文件。
- 如果模型通过 Bash `cat /path/to/SKILL.md` 读取，也会清除 pending prerequisite。

核心逻辑：

```ts
registerSkillPrerequisites(paths)
checkSkillPrerequisites(toolName)
trackReadTool(toolInput)
trackBashSkillRead(input)
```

所以机制不是“相信模型会看 skill”，而是有 pre-tool-use gate 强制执行读前置。

## requiredSources 自动启用

`requiredSources` 是 app 对 SDK skill 格式的增强使用。

使用位置：

- `packages/server-core/src/sessions/SessionManager.ts`

UI submit 时会把 `mentions.skills` 作为 `skillSlugs` 传到 session。`SessionManager` 在发送消息前读取这些 skill 的 `requiredSources`，并预先启用可用 source。

流程：

```text
options.skillSlugs
  -> loadSkillBySlug(workspaceRoot, slug, workingDirectory)
  -> collect metadata.requiredSources
  -> getSourcesBySlugs
  -> filter isSourceUsable
  -> append to managed.enabledSourceSlugs
  -> persist session
  -> emit sources_changed
```

如果 source 不存在或未认证，会被跳过并记录 warning：

```ts
sessionLog.warn(`Skill requires sources that are not usable ...`)
```

这个设计解决的问题是：如果 skill 依赖 Linear、GitHub 等 source，不需要 agent 第一轮发现缺工具、第二轮再启用。

## Plugin 名称和 SDK 兼容

workspace skill 需要通过 SDK plugin 名称定位。workspace 创建时会有：

```text
{workspaceRoot}/.claude-plugin/plugin.json
```

生成逻辑在：

- `packages/shared/src/workspaces/storage.ts`

manifest 示例：

```json
{
  "name": "craft-workspace-my-workspace",
  "version": "1.0.0"
}
```

project/global skill 统一用 `.agents` 作为 plugin name，因为 `{project}/.agents/` 和 `~/.agents/` 的 basename 都是 `.agents`。

pre-tool-use 里还有 `qualifySkillName`，用于把裸 slug 或错误 qualifier 修正成正确的 `plugin:slug`：

```text
project/global -> .agents:slug
workspace      -> workspacePluginName:slug
```

相关代码：

- `packages/shared/src/agent/core/pre-tool-use.ts`

## Marketplace / Remote / Zip 安装

app 支持多种非 agent 安装路径：

- Create：手动创建 `SKILL.md`
- Upload：上传 zip，扫描里面的 `SKILL.md`
- Remote：解析 GitHub/GitLab/git repo
- Marketplace：下载服务端 skill bundle
- CoPaw Market：当前产品市场服务路径

### Zip 发现

相关代码：

- `packages/shared/src/skills/zip-extractor.ts`

发现规则：

- zip 根目录有 `SKILL.md`：作为一个 skill。
- 子目录 1-2 层内有 `SKILL.md`：每个目录作为一个 skill。
- 忽略 `__MACOSX`。

### Remote 发现

相关代码：

- `packages/shared/src/skills/remote-resolver.ts`

支持：

- GitHub repo URL
- GitHub subpath URL
- GitLab repo URL
- `owner/repo` shorthand
- fallback git clone URL

GitHub repo 扫描最多 3 层目录。

### Marketplace 安装

相关代码：

- `packages/shared/src/skills/marketplace-install.ts`

Marketplace 安装流程：

```text
create install intent
  -> download bundle
  -> verify SHA-256
  -> write skill bundle to local skills
  -> write .marketplace-origin.json
  -> invalidate cache
  -> record install complete
```

sidecar 文件：

```text
skills/{slug}/.marketplace-origin.json
```

记录：

- marketplace id
- marketplace slug
- owner
- installed version
- install time
- source bundle hash
- modified 状态
- safety status
- basedOn 信息

设计含义：

- published bundle 的 `SKILL.md` 保持原样。
- 市场来源信息不污染 skill 正文。
- Marketplace Skill 安装成本地 Local Skill 后才可用，不从网络直接执行。

## 设计取舍

这套机制的核心取舍很清楚：

- Skill 是文件，不是数据库：方便编辑、同步、导入、和 Claude Code SDK 兼容。
- Skill 是指令，不是代码：降低执行面风险，真实工具能力仍由 sources/tools 控制。
- 三层覆盖：global 提供个人默认能力，workspace 提供工作区能力，project 提供代码仓库局部覆盖。
- Mention 触发：用户明确点选 skill，agent 才加载。
- Read-before-execute：通过 prerequisite gate 保证模型先读 `SKILL.md`。
- `requiredSources` 前置启用：让 skill 和外部 source 协同，不浪费一轮对话。
- Marketplace 只负责分发：Marketplace Skill 安装成本地 Local Skill 后才可用，不直接远程执行。

## 使用流程示例

### 创建本地 skill

```text
UI Create / Upload / Remote / Marketplace
  -> RPC skills.CREATE / FORCE_WRITE / INSTALL_*
  -> 写入 ~/.agents/skills/{slug}/SKILL.md 或 {workspace}/skills/{slug}/SKILL.md
  -> 安装 skill-provided MCP Sources
  -> 刷新新建或复用的 MCP Source 在 workspace MCP pool 中的连接和工具缓存
  -> 广播 skills.CHANGED
  -> UI 刷新列表
```

### 在对话中使用 skill

```text
用户输入 @skill
  -> mention menu 插入 [skill:plugin:slug]
  -> submit 时 parseMentions 得到 slug
  -> SessionManager 预启用 requiredSources
  -> BaseAgent 定位 SKILL.md
  -> 注册 prerequisite
  -> prompt 前置 read directive
  -> 模型先读 SKILL.md
  -> 执行用户任务
```

### 更新 Marketplace Skill

```text
Marketplace update intent
  -> download bundle
  -> verify hash
  -> overwrite local skill dir
  -> update .marketplace-origin.json
  -> invalidate cache
  -> broadcast skills.CHANGED
```

## 一句话总结

Skill 机制是一个以 `SKILL.md` 为中心的“可管理、可提及、可强制读取、可分发”的指令系统。UI 负责发现和插入 mention，server/shared 层负责加载、校验和安装，agent 层负责把 mention 变成必须读取的上下文，session 层负责把 `requiredSources` 提前启用，Marketplace 只负责把 skill bundle 安装成本地 Local Skill。
