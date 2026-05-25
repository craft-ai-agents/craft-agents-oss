import * as React from 'react'
import { X, RefreshCw, CheckCircle2, AlertCircle, ChevronRight, RotateCcw, Trash2 } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { SkillOrphan } from '../../../../../shared/types'

// ─── Types ───────────────────────────────────────────────────────────────────

export type UpdateStatus = 'idle' | 'checking' | 'updating' | 'done'

export interface UpdateProgress {
  total: number
  completed: number
  failedCount: number
}

export interface UpdateResult {
  updated: string[]
  failed: Array<{ slug: string; error: string }>
  orphans: SkillOrphan[]
}

interface Props {
  status: UpdateStatus
  progress: UpdateProgress
  result: UpdateResult | null
  orphans: SkillOrphan[]
  onRetry: (slugs: string[]) => void
  onDeleteOrphans: (slugs: string[]) => void
  onDismiss: () => void
}

// ─── Banner ───────────────────────────────────────────────────────────────────

export function SkillUpdateBanner({ status, progress, result, orphans, onRetry, onDeleteOrphans, onDismiss }: Props) {
  const [detailOpen, setDetailOpen] = React.useState(false)

  if (status === 'idle') return null

  const hasOrphans = orphans.length > 0
  const hasFailed = (result?.failed.length ?? 0) > 0

  let bannerText = ''
  let bannerIcon = <RefreshCw className="h-3.5 w-3.5 animate-spin" />
  let bannerColor = 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'

  if (status === 'checking') {
    bannerText = '正在检查技能更新...'
  } else if (status === 'updating') {
    bannerText = `正在后台更新技能（${progress.completed} / ${progress.total}）`
  } else if (status === 'done') {
    const updatedCount = result?.updated.length ?? 0
    const failedCount = result?.failed.length ?? 0
    if (hasFailed || hasOrphans) {
      bannerIcon = <AlertCircle className="h-3.5 w-3.5" />
      bannerColor = 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
      const parts: string[] = []
      if (updatedCount > 0) parts.push(`成功更新 ${updatedCount} 个`)
      if (failedCount > 0) parts.push(`失败 ${failedCount} 个`)
      if (hasOrphans) parts.push(`发现 ${orphans.length} 个已下架技能`)
      bannerText = parts.join('，')
    } else if (updatedCount > 0) {
      bannerIcon = <CheckCircle2 className="h-3.5 w-3.5" />
      bannerColor = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
      bannerText = `成功更新 ${updatedCount} 个技能`
    } else {
      // All up to date, no action needed — dismiss automatically
      return null
    }
  }

  return (
    <>
      <div className={cn('mx-0 mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]', bannerColor)}>
        {bannerIcon}
        <span>{bannerText}</span>
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="flex items-center gap-0.5 font-medium opacity-80 hover:opacity-100"
        >
          详情 <ChevronRight className="h-3 w-3" />
        </button>
        <span className="flex-1" />
        {status === 'done' && (
          <button type="button" onClick={onDismiss} className="opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <UpdateDetailDialog
        open={detailOpen}
        onClose={() => { setDetailOpen(false); if (status === 'done') onDismiss() }}
        status={status}
        progress={progress}
        result={result}
        orphans={orphans}
        onRetry={onRetry}
        onDeleteOrphans={onDeleteOrphans}
      />
    </>
  )
}

// ─── Detail Dialog ────────────────────────────────────────────────────────────

interface DetailDialogProps {
  open: boolean
  onClose: () => void
  status: UpdateStatus
  progress: UpdateProgress
  result: UpdateResult | null
  orphans: SkillOrphan[]
  onRetry: (slugs: string[]) => void
  onDeleteOrphans: (slugs: string[]) => void
}

function UpdateDetailDialog({ open, onClose, status, progress, result, orphans, onRetry, onDeleteOrphans }: DetailDialogProps) {
  const [selectedOrphans, setSelectedOrphans] = React.useState<Set<string>>(new Set())

  // Reset selection when orphans change
  React.useEffect(() => {
    setSelectedOrphans(new Set())
  }, [orphans.length])

  const toggleOrphan = (slug: string) => {
    setSelectedOrphans((prev) => {
      const next = new Set(prev)
      next.has(slug) ? next.delete(slug) : next.add(slug)
      return next
    })
  }

  const toggleAllOrphans = () => {
    if (selectedOrphans.size === orphans.length) {
      setSelectedOrphans(new Set())
    } else {
      setSelectedOrphans(new Set(orphans.map((o) => o.slug)))
    }
  }

  const handleDeleteSelected = () => {
    onDeleteOrphans([...selectedOrphans])
    setSelectedOrphans(new Set())
  }

  const failedSlugs = result?.failed.map((f) => f.slug) ?? []

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-h-[80vh] w-[480px] overflow-hidden p-0">
        <div className="flex flex-col">
          {/* Header */}
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-[15px] font-semibold text-foreground">技能更新详情</h2>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Progress / summary */}
            {(status === 'updating' || status === 'checking') && (
              <Section title="更新进度">
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
                  <span className="text-[13px] text-muted-foreground">
                    {status === 'checking' ? '正在检查版本...' : `已完成 ${progress.completed} / ${progress.total}`}
                  </span>
                </div>
                {status === 'updating' && progress.total > 0 && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                    />
                  </div>
                )}
              </Section>
            )}

            {/* Updated */}
            {(result?.updated.length ?? 0) > 0 && (
              <Section title={`成功更新（${result!.updated.length}）`}>
                <ul className="space-y-1">
                  {result!.updated.map((slug) => (
                    <li key={slug} className="flex items-center gap-2 text-[13px] text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                      {slug}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Failed */}
            {(result?.failed.length ?? 0) > 0 && (
              <Section title={`更新失败（${result!.failed.length}）`}>
                <ul className="space-y-2">
                  {result!.failed.map((f) => (
                    <li key={f.slug} className="flex items-start gap-2 text-[13px]">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-500" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-foreground">{f.slug}</span>
                        <p className="truncate text-[11px] text-muted-foreground">{f.error}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => onRetry(failedSlugs)}
                  className="mt-2 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重试失败的技能
                </button>
              </Section>
            )}

            {/* Orphans */}
            {orphans.length > 0 && (
              <Section title={`已下架技能（${orphans.length}）`}>
                <p className="mb-3 text-[12px] text-muted-foreground">
                  以下技能已从市场下架，可选择删除本地副本。删除。
                </p>
                {/* Select all */}
                <label className="mb-2 flex cursor-pointer items-center gap-2 px-1 text-[12px] text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={selectedOrphans.size === orphans.length && orphans.length > 0}
                    onChange={toggleAllOrphans}
                    className="h-3.5 w-3.5 rounded border-border accent-foreground"
                  />
                  全选
                </label>
                <ul className="space-y-1.5">
                  {orphans.map((o) => (
                    <li key={o.slug}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 hover:bg-foreground/[0.04]">
                        <input
                          type="checkbox"
                          checked={selectedOrphans.has(o.slug)}
                          onChange={() => toggleOrphan(o.slug)}
                          className="h-3.5 w-3.5 rounded border-border accent-foreground"
                        />
                        <span className="flex-1 text-[13px] text-foreground">{o.name}</span>
                        <span className="text-[11px] text-muted-foreground">{o.slug}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {selectedOrphans.size > 0 && (
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="mt-3 flex items-center gap-1.5 rounded-md bg-rose-500/10 px-3 py-1.5 text-[12px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除已选（{selectedOrphans.size}）
                  </button>
                )}
              </Section>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-foreground px-4 py-1.5 text-[13px] font-medium text-background hover:opacity-85 transition-opacity"
            >
              关闭
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}
