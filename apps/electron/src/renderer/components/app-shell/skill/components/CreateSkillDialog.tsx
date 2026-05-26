import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { LoadedSkill } from '../../../../../shared/types'

export function CreateSkillDialog({
  open,
  workspaceId,
  onClose,
  onCreated,
}: {
  open: boolean
  workspaceId: string
  onClose: () => void
  onCreated: (skill: LoadedSkill) => void
}) {
  const [slug, setSlug] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [content, setContent] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {}
    if (!slug.trim()) {
      errs.slug = '请输入技能标识符'
    } else if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug.trim())) {
      errs.slug = '只允许小写字母、数字、下划线和连字符，且以字母或数字开头'
    }
    if (!displayName.trim()) errs.displayName = '请输入展示名称'
    if (!description.trim()) errs.description = '请输入技能描述'
    if (!content.trim()) errs.content = '请输入技能内容'
    return errs
  }

  const handleSubmit = async () => {
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }

    const trimmedSlug = slug.trim()
    const metadata = { name: displayName.trim(), description: description.trim() }
    const body = content.trim()

    setSaving(true)
    try {
      const result = await window.electronAPI.createSkill(workspaceId, trimmedSlug, metadata, body, 'global')
      if ('conflict' in result && result.conflict) {
        setErrors({ slug: '此标识符已存在，请更换一个' })
        setSaving(false)
        return
      }
    } catch (err) {
      setErrors({ slug: '创建失败：' + String(err) })
      setSaving(false)
      return
    }
    setSaving(false)
    toast.success(`「${metadata.name}」创建成功`)

    const newSkill: LoadedSkill = {
      slug: trimmedSlug,
      metadata,
      content: body,
      path: `~/.agents/skills/${trimmedSlug}`,
      source: 'global',
      // 无 marketplaceOrigin → 归入「本地上传」分类
    }
    onCreated(newSkill)
    handleClose()
  }

  const handleClose = () => {
    if (saving) return
    setSlug(''); setDisplayName(''); setDescription(''); setContent(''); setErrors({})
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[580px] sm:max-w-[580px] flex-col gap-0 overflow-hidden p-0">

        {/* 标题 */}
        <div className="flex-shrink-0 border-b border-border px-7 py-5">
          <h2 className="text-[17px] font-semibold text-foreground">创建技能</h2>
          <p className="mt-0.5 text-[14px] text-muted-foreground">技能将保存到全局目录 <code className="rounded bg-muted px-1 py-0.5 text-[12px]">~/.agents/</code></p>
        </div>

        {/* 表单区 */}
        <div className="flex-1 space-y-4 overflow-y-auto px-7 py-5">

          {/* 标识符 */}
          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-foreground">
              标识符 <span className="text-rose-500">*</span>
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">小写字母、数字、下划线</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={slug}
                onChange={(e) => { setSlug(e.target.value.toLowerCase()); setErrors((p) => ({ ...p, slug: '' })) }}
                placeholder="例如：code_reviewer"
                maxLength={64}
                className={cn(
                  'h-9 w-full rounded-lg border bg-background px-3 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                  errors.slug ? 'border-rose-400' : 'border-border',
                )}
              />
            </div>
            {errors.slug && <p className="mt-1 text-[12px] text-rose-500">{errors.slug}</p>}
          </div>

          {/* 展示名称 */}
          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-foreground">
              展示名称 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); setErrors((p) => ({ ...p, displayName: '' })) }}
              placeholder="例如：代码审查"
              maxLength={64}
              className={cn(
                'h-9 w-full rounded-lg border bg-background px-3 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                errors.displayName ? 'border-rose-400' : 'border-border',
              )}
            />
            {errors.displayName && <p className="mt-1 text-[12px] text-rose-500">{errors.displayName}</p>}
          </div>

          {/* 描述 */}
          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-foreground">
              描述 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setErrors((p) => ({ ...p, description: '' })) }}
              placeholder="简要说明此技能的用途"
              maxLength={200}
              className={cn(
                'h-9 w-full rounded-lg border bg-background px-3 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                errors.description ? 'border-rose-400' : 'border-border',
              )}
            />
            {errors.description && <p className="mt-1 text-[12px] text-rose-500">{errors.description}</p>}
          </div>

          {/* 技能内容 */}
          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-foreground">
              技能内容 <span className="text-rose-500">*</span>
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">描述此技能的行为规则和指令</span>
            </label>
            <div className="relative">
              <textarea
                value={content}
                onChange={(e) => { setContent(e.target.value); setErrors((p) => ({ ...p, content: '' })) }}
                placeholder={`例如：\n\n## 规则\n\n- 审查代码时优先关注安全问题\n- 每次审查都需要给出改进建议\n- 使用中文回复`}
                rows={10}
                className={cn(
                  'w-full resize-none rounded-lg border bg-background px-3 py-2.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono',
                  errors.content ? 'border-rose-400' : 'border-border',
                )}
              />
            </div>
            {errors.content && <p className="mt-1 text-[12px] text-rose-500">{errors.content}</p>}
          </div>

        </div>

        {/* 底部操作 */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-border px-7 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded-lg border border-border px-4 py-2 text-[14px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[14px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
