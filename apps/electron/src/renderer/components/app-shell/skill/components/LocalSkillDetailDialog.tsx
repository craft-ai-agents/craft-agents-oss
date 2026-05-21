import * as React from 'react'
import { ExternalLink, Folder, MessageCircle, MoreHorizontal, Store } from 'lucide-react'
import { Markdown } from '@craft-agent/ui'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { navigate, routes } from '@/lib/navigate'
import { LocalSkillIcon } from './LocalSkillRow'
import type { LoadedSkill } from '../../../../../shared/types'

export function LocalSkillMoreMenu({ slug, workspaceId }: { slug: string; workspaceId: string }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[172px] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-thin">
          <button
            type="button"
            onClick={() => { setOpen(false); window.electronAPI.openSkillInEditor(workspaceId, slug) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <ExternalLink className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            在编辑器中打开
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); window.electronAPI.openSkillInFinder(workspaceId, slug) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            在文件夹中显示
          </button>
        </div>
      )}
    </div>
  )
}

export function LocalSkillDetailDialog({
  skill,
  workspaceId,
  onClose,
  onUninstall,
  onPublish,
  isFromMarket = false,
}: {
  skill: LoadedSkill | null
  workspaceId: string
  onClose: () => void
  onUninstall: (s: LoadedSkill) => void
  onPublish: (s: LoadedSkill) => void
  isFromMarket?: boolean
}) {
  if (!skill) return null

  const name = skill.metadata?.name ?? skill.slug
  const description = skill.metadata?.description ?? ''

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[660px] sm:max-w-[660px] flex-col gap-0 overflow-hidden p-0">

        {/* 图标 + 标题行 */}
        <div className="flex items-start justify-between px-7 pt-7 pb-1">
          <div className="flex items-center gap-4">
            <LocalSkillIcon skill={skill} />
            <div>
              <div className="flex items-baseline gap-2">
                <h2 className="text-[18px] font-bold text-foreground">{name}</h2>
                <span className="text-[13px] font-normal text-muted-foreground">本地</span>
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{description || '—'}</p>
            </div>
          </div>
          <div className="ml-4 flex flex-shrink-0 items-center gap-2 pt-1">
            <LocalSkillMoreMenu slug={skill.slug} workspaceId={workspaceId} />
          </div>
        </div>

        {/* 路径信息 + 发布到市场 */}
        <div className="flex items-center justify-between px-7 pb-4 pt-2">
          <span className="text-[12px] text-muted-foreground/55">路径：{skill.path}</span>
          {!skill.marketplaceOrigin && !isFromMarket && (
            <button
              type="button"
              onClick={() => { onClose(); onPublish(skill) }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
            >
              <Store className="h-3.5 w-3.5" />
              发布到市场
            </button>
          )}
        </div>

        {/* Markdown 内容区 */}
        <div className="mx-7 mb-5 min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-muted/20 px-6 py-5 text-[13px] leading-relaxed">
          {skill.content
            ? <Markdown>{skill.content}</Markdown>
            : <p className="text-muted-foreground">（内容为空）</p>
          }
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t border-border px-7 py-4">
          <button
            type="button"
            onClick={() => onUninstall(skill)}
            className="rounded-lg bg-red-50 px-4 py-2 text-[13px] font-medium text-red-500 transition-colors hover:bg-red-100 dark:bg-red-500/15 dark:text-red-400 dark:hover:bg-red-500/25"
          >
            卸载
          </button>
          <button
            type="button"
            onClick={() => {
              onClose()
              navigate(routes.action.newSession({ input: `[skill:${skill.slug}] ` }))
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-85"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            在对话中试用
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
