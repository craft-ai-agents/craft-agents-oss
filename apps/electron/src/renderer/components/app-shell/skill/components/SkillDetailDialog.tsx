import * as React from 'react'
import { Check, Loader2, Plus } from 'lucide-react'
import { Markdown } from '@craft-agent/ui'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { USE_MOCK_MARKET } from '../mock-data'
import type { MarketplaceSkillListing } from '../types'
import { ExpandableDescription } from './LocalSkillDetailDialog'

export function SkillDetailDialog({
  skill,
  onClose,
  onInstall,
  onUninstall,
  currentUserId,
  isInstalling = false,
}: {
  skill: MarketplaceSkillListing | null
  onClose: () => void
  onInstall: (s: MarketplaceSkillListing) => void
  onUninstall: (s: MarketplaceSkillListing) => void
  currentUserId: string | null
  isInstalling?: boolean
}) {
  const [skillContent, setSkillContent] = React.useState<string | null>(null)
  const [skillExtraMetadata, setSkillExtraMetadata] = React.useState<Record<string, unknown> | null>(null)
  const [showSpinner, setShowSpinner] = React.useState(false)

  React.useEffect(() => {
    if (!skill) return
    // 不立即清空旧内容，保留上一个技能的内容直到新内容加载完
    // spinner 延迟 250ms 才显示，加载够快时完全不闪
    let active = true
    const spinnerTimer = setTimeout(() => { if (active) setShowSpinner(true) }, 250)

    if (USE_MOCK_MARKET) {
      const t = setTimeout(() => {
        if (active) { setSkillContent(null); setShowSpinner(false) }
      }, 800)
      return () => { active = false; clearTimeout(t); clearTimeout(spinnerTimer) }
    }

    window.electronAPI.fetchMarketSkillContent(skill.slug, skill.latestVersion)
      .then(({ content, extraMetadata }) => {
        if (active) {
          setSkillContent(content)
          setSkillExtraMetadata(extraMetadata ?? null)
        }
      })
      .catch(() => { if (active) { setSkillContent(null); setSkillExtraMetadata(null) } })
      .finally(() => { if (active) { setShowSpinner(false); clearTimeout(spinnerTimer) } })
    return () => { active = false; clearTimeout(spinnerTimer) }
  }, [skill?.slug])

  if (!skill) return null

  const installed = skill.installState === 'installed'
  const isOwner = Boolean(currentUserId && skill.ownerId === currentUserId)

  const mockMarkdown = `## 概述

${skill.description}

本技能深度集成到 MDP 工作流中，让你通过自然语言即可完成原本需要多步命令行操作的任务，大幅降低操作门槛，提升团队协作效率。

---

## 核心功能

### 1. 自动化任务执行

支持通过对话触发以下操作：

- **构建与部署**：一键触发构建流水线，实时查看日志输出
- **环境管理**：创建、删除、切换运行环境，支持多环境配置
- **资源监控**：实时获取 CPU、内存、磁盘等资源使用情况
- **日志分析**：自动聚合日志并提取关键错误信息

### 2. 智能问题诊断

当任务失败时，技能会自动：

1. 解析错误堆栈，定位根本原因
2. 结合上下文给出修复建议
3. 提供参考文档链接

### 3. 配置文件管理

\`\`\`yaml
# 示例配置文件 .mdp/${skill.slug}.yml
version: "1.0"
settings:
  timeout: 300
  retry: 3
  notify: true
environments:
  - name: production
    region: cn-hangzhou
  - name: staging
    region: cn-beijing
\`\`\`

---

## 快速开始

### 前置条件

在使用本技能前，请确保已满足以下条件：

| 依赖项 | 最低版本 | 说明 |
|--------|---------|------|
| Node.js | 18.0+ | 运行时环境 |
| ${skill.slug} CLI | 2.0+ | 命令行工具 |
| API Token | — | 在账户设置中生成 |

### 安装步骤

\`\`\`bash
# 第一步：安装 CLI 工具
npm install -g @mdp/${skill.slug}-cli

# 第二步：登录认证
${skill.slug} auth login

# 第三步：初始化项目
${skill.slug} init --workspace my-project

# 验证安装
${skill.slug} --version
\`\`\`

### 在 MDP 中激活

安装本技能后，在对话框中直接输入指令即可：

> 「帮我检查一下 production 环境的运行状态」

> 「最近 1 小时有没有报错日志？」

> 「把 staging 的配置同步到 production」

---

## 高级用法

### 批量操作

\`\`\`bash
# 批量重启服务
${skill.slug} restart --env production --service all

# 批量导出配置
${skill.slug} config export --format json --output ./backup/
\`\`\`

### Webhook 集成

你可以配置 Webhook，在特定事件发生时自动通知 MDP：

\`\`\`json
{
  "url": "https://your-mdp-instance/webhook/${skill.slug}",
  "events": ["deploy.success", "deploy.failed", "alert.triggered"],
  "secret": "your-webhook-secret"
}
\`\`\`

### 自定义规则

在 \`SKILL.md\` 中可以覆盖默认行为：

\`\`\`markdown
## Custom Rules

- 所有部署操作前必须先运行测试套件
- production 环境的变更需要二次确认
- 错误日志超过 100 条时自动告警
\`\`\`

---

## 常见问题

**Q：认证 Token 过期后会怎样？**

技能会自动检测 Token 状态，过期时提示重新登录，不会中断当前对话上下文。

**Q：是否支持私有化部署？**

支持。在配置文件中将 \`endpoint\` 指向你的私有服务地址即可。

**Q：操作日志保存多久？**

默认保留 30 天，可在设置中调整为 7 / 30 / 90 / 180 天。

---

## 更新日志

### v${skill.latestVersion}（当前版本）
- 新增批量操作支持
- 优化错误信息展示，更易于定位问题
- 修复在弱网络环境下偶发的超时问题

### v1.0.0
- 初始版本发布
- 支持基础的部署与监控功能`

  const publishedAt = skill.publishedAt
    ? new Date(skill.publishedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[660px] sm:max-w-[660px] flex-col gap-0 overflow-hidden p-0">

        {/* 图标 + 标题行 */}
        <div className="flex items-start justify-between px-7 pt-7 pb-1">
          <div className="flex items-center gap-4">
            <div className={cn('flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white', skill.iconBg ?? 'bg-foreground')}>
              {skill.icon}
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <h2 className="text-[18px] font-bold text-foreground">{skill.name}</h2>
                <span className="text-[13px] font-normal text-muted-foreground">Skill</span>
              </div>
              {skill.description ? <ExpandableDescription text={skill.description} /> : null}
            </div>
          </div>
        </div>

        {/* 作者 + 发布时间 + 安装数 */}
        <div className="flex items-center gap-2 px-7 pb-4 pt-2 text-[12px] text-muted-foreground/55">
          <span>作者：{skill.owner}</span>
          <span>·</span>
          <span>发布于 {publishedAt}</span>
          <span>·</span>
          <span>{skill.installCount.toLocaleString()} 次安装</span>
        </div>

        {/* Markdown 内容区 */}
        <div className="relative mx-7 mb-5 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-muted/20 px-6 py-5 text-[13px] leading-relaxed">
          {skillExtraMetadata && (
            <div className="mb-4">
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">Metadata</p>
              <pre className="overflow-x-auto rounded-lg bg-muted/40 px-4 py-3 text-[12px] leading-relaxed text-foreground/80">
                {JSON.stringify(skillExtraMetadata, null, 2)}
              </pre>
              <div className="my-4 border-t border-border" />
            </div>
          )}
          <Markdown>{skillContent ?? mockMarkdown}</Markdown>
          {showSpinner && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-muted/60 backdrop-blur-[2px]">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t border-border px-7 py-4">
          <div>
            {isOwner && (
              <button
                type="button"
                onClick={() => onUninstall(skill)}
                className="rounded-lg bg-red-50 px-4 py-2 text-[13px] font-medium text-red-500 transition-colors hover:bg-red-100 dark:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/25"
              >
                删除
              </button>
            )}
          </div>
          {installed ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-4 py-2 text-[13px] font-medium text-muted-foreground">
              <Check className="h-3.5 w-3.5" />
              已安装
            </span>
          ) : (
            <button
              type="button"
              disabled={isInstalling}
              onClick={() => onInstall(skill)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50 disabled:cursor-default"
            >
              {isInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {isInstalling ? '安装中…' : '安装'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
