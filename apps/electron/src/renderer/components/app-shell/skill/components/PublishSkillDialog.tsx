import * as React from 'react'
import { Check, ChevronDown, Loader2, Upload } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAppShellContext } from '@/context/AppShellContext'
import { USE_MOCK_MARKET } from '../mock-data'
import type { LoadedSkill } from '../../../../../shared/types'
import type { CopawMarketUploadInput } from '@craft-agent/shared/skills'

export function PublishSkillDialog({
  open,
  onClose,
  workspaceId,
  currentUserId,
  sourceSkill,
  onPublished,
}: {
  open: boolean
  onClose: () => void
  workspaceId: string
  currentUserId: string | null
  sourceSkill?: LoadedSkill
  onPublished?: (skillName: string) => void
}) {
  const [name, setName] = React.useState('')
  const [chineseName, setChineseName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [tag, setTag] = React.useState<'A' | 'B'>('B')
  const [tagOpen, setTagOpen] = React.useState(false)
  const [file, setFile] = React.useState<File | null>(null)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const tagRef = React.useRef<HTMLDivElement>(null)

  // Pre-fill form when sourceSkill provided (publish from local skill)
  React.useEffect(() => {
    if (!open) return
    if (sourceSkill) {
      setName(sourceSkill.slug.replace(/-/g, '_'))
      setChineseName(sourceSkill.metadata?.name ?? '')
      setDescription(sourceSkill.metadata?.description ?? '')
    } else {
      setName(''); setChineseName(''); setDescription('')
    }
    setTag('B'); setFile(null); setErrors({})
  }, [open, sourceSkill])

  const { ssoUser } = useAppShellContext()
  const displayUser = ssoUser?.userName
    ? `${ssoUser.userName}（${ssoUser.employeeId ?? currentUserId ?? '—'}）`
    : (currentUserId ?? '—')

  const TAG_OPTIONS = [
    { value: 'B' as const, label: 'DevOps（DevOps 相关能力，天眼、乐高等）' },
    { value: 'A' as const, label: '公共（如 PDF）' },
  ]

  React.useEffect(() => {
    if (!tagOpen) return
    const fn = (e: MouseEvent) => { if (tagRef.current && !tagRef.current.contains(e.target as Node)) setTagOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [tagOpen])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.zip')) {
      setErrors((prev) => ({ ...prev, file: '只支持上传 .zip 文件' }))
      return
    }
    setFile(f)
    setErrors((prev) => ({ ...prev, file: '' }))
  }

  const validate = (): Record<string, string> => {
    const errs: Record<string, string> = {}
    if (!name.trim()) {
      errs.name = '请输入 Skill 名称'
    } else if (!/^[a-z0-9_]+$/.test(name.trim())) {
      errs.name = '只允许英文小写字母、数字和下划线'
    }
    if (!chineseName.trim()) errs.chineseName = '请输入 Skill 展示名称'
    if (!description.trim()) errs.description = '请输入 Skill 描述'
    if (!sourceSkill && !file) errs.file = '请选择要上传的 zip 文件'
    return errs
  }

  const handleSubmit = async () => {
    const errs = validate()
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    setUploading(true)

    try {
      // Build upload input — Path A: bundle from local skill; Path B: send raw zip bytes
      let input: CopawMarketUploadInput
      if (sourceSkill) {
        input = {
          name: name.trim(),
          chineseName: chineseName.trim(),
          description: description.trim(),
          tag,
          skillSlug: sourceSkill.slug,
          workspaceId,
          skillSource: sourceSkill.source,
        }
      } else if (file) {
        const buffer = await file.arrayBuffer()
        input = {
          name: name.trim(),
          chineseName: chineseName.trim(),
          description: description.trim(),
          tag,
          zipBytes: new Uint8Array(buffer),
        }
      } else {
        setUploading(false)
        return
      }

      const result: import('@craft-agent/shared/skills').CopawMarketUploadResult = USE_MOCK_MARKET
        ? { status: 'published', skill: { fileKey: 'mock', userName: 'mock', employeeId: 'mock', department: null, name: input.name, chineseName: input.chineseName, description: input.description, tag: input.tag, hot: 0, createdAt: new Date().toISOString() } }
        : await window.electronAPI.uploadMarketSkill(input)

      if (result.status === 'conflict') {
        setErrors({ name: result.message })
        setUploading(false)
        return
      }
      if (result.status === 'error') {
        setErrors({ submit: result.message })
        setUploading(false)
        return
      }

      const publishedName = input.chineseName?.trim() || input.name
      setUploading(false)
      toast.success(`「${publishedName}」已成功发布到市场`)
      onPublished?.(input.name)
      handleClose()
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : '发布失败，请稍后重试' })
      setUploading(false)
    }
  }

  const handleClose = () => {
    if (uploading) return
    setName(''); setChineseName(''); setDescription(''); setTag('B')
    setFile(null); setErrors({}); setTagOpen(false)
    onClose()
  }

  // Auto-generate zip info for display when publishing from local skill
  const autoZipName = sourceSkill ? `${sourceSkill.slug}.zip` : null

  const tagLabel = TAG_OPTIONS.find((o) => o.value === tag)?.label ?? ''

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-[520px] sm:max-w-[520px] flex-col gap-0 overflow-hidden p-0">

        {/* 标题 */}
        <div className="flex-shrink-0 border-b border-border px-7 py-5">
          <h2 className="text-[17px] font-semibold text-foreground">上传 Skill 到市场</h2>
        </div>

        {/* 表单区（可滚动） */}
        <div className="flex-1 space-y-5 overflow-y-auto px-7 py-5">

          {/* Skill 名称 */}
          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-foreground">
              Skill 名称（英文小写下划线）<span className="ml-0.5 text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: '' })) }}
                placeholder="例如：browser_tool"
                maxLength={36}
                className={cn(
                  'h-9 w-full rounded-lg border bg-background px-3 pr-12 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                  errors.name ? 'border-rose-400' : 'border-border',
                )}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/50">{name.length}/36</span>
            </div>
            {errors.name && <p className="mt-1 text-[12px] text-rose-500">{errors.name}</p>}
          </div>

          {/* Skill 展示名称 */}
          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-foreground">
              Skill 展示名称<span className="ml-0.5 text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={chineseName}
                onChange={(e) => { setChineseName(e.target.value); setErrors((p) => ({ ...p, chineseName: '' })) }}
                placeholder="例如：浏览器工具"
                maxLength={36}
                className={cn(
                  'h-9 w-full rounded-lg border bg-background px-3 pr-12 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                  errors.chineseName ? 'border-rose-400' : 'border-border',
                )}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/50">{chineseName.length}/36</span>
            </div>
            {errors.chineseName && <p className="mt-1 text-[12px] text-rose-500">{errors.chineseName}</p>}
          </div>

          {/* Skill 描述 */}
          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-foreground">
              Skill 描述<span className="ml-0.5 text-rose-500">*</span>
            </label>
            <div className="relative">
              <textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); setErrors((p) => ({ ...p, description: '' })) }}
                placeholder="简要描述 Skill 的功能和使用场景..."
                maxLength={1000}
                rows={3}
                className={cn(
                  'w-full resize-none rounded-lg border bg-background px-3 pb-6 pt-2.5 text-[14px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
                  errors.description ? 'border-rose-400' : 'border-border',
                )}
              />
              <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-muted-foreground/50">{description.length}/1000</span>
            </div>
            {errors.description && <p className="mt-1 text-[12px] text-rose-500">{errors.description}</p>}
          </div>

          {/* 分类 */}
          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-foreground">
              分类<span className="ml-0.5 text-rose-500">*</span>
            </label>
            <div ref={tagRef} className="relative">
              <button
                type="button"
                onClick={() => setTagOpen((v) => !v)}
                className="inline-flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-[14px] text-foreground transition-colors hover:bg-foreground/[0.04]"
              >
                <span className="truncate text-left">{tagLabel}</span>
                <ChevronDown className="ml-2 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              </button>
              {tagOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-thin">
                  {TAG_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setTag(opt.value); setTagOpen(false) }}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-[14px] transition-colors hover:bg-foreground/[0.06]',
                        opt.value === tag ? 'font-semibold text-foreground' : 'text-foreground/70',
                      )}
                    >
                      <span className="h-3 w-3 flex-shrink-0">{opt.value === tag ? <Check className="h-3 w-3" /> : null}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 上传人信息 */}
          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-foreground">上传人信息</label>
            <p className="text-[14px] text-muted-foreground">
              {displayUser}
            </p>
          </div>

          {/* Skill 文件（zip） */}
          <div>
            <label className="mb-1.5 block text-[14px] font-medium text-foreground">
              Skill 文件（zip）{!sourceSkill && <span className="ml-0.5 text-rose-500">*</span>}
            </label>
            {sourceSkill ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <span className="text-[14px] text-foreground">{autoZipName}</span>
                <span className="text-[12px] text-muted-foreground">（自动从本地技能生成）</span>
              </div>
            ) : (
              <>
                <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={handleFileChange} />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[14px] text-foreground transition-colors hover:bg-foreground/[0.04]"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    选择文件
                  </button>
                  {file ? (
                    <span className="truncate text-[14px] text-foreground">{file.name}（{(file.size / 1024).toFixed(1)} KB）</span>
                  ) : (
                    <span className="text-[14px] text-muted-foreground">未选择文件</span>
                  )}
                </div>
                {errors.file && <p className="mt-1.5 text-[12px] text-rose-500">{errors.file}</p>}
              </>
            )}
          </div>

        </div>

        {/* 底部操作 */}
        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-border px-7 py-4">
          {errors.submit && <p className="mr-auto text-[12px] text-rose-500">{errors.submit}</p>}
          <button
            type="button"
            onClick={handleClose}
            disabled={uploading}
            className="rounded-lg border border-border px-4 py-2 text-[14px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-[14px] font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            上传
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
