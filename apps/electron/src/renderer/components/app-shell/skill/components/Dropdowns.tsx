import * as React from 'react'
import { Check, ChevronDown, FilePlus2, FolderUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CATEGORIES } from '../copaw-mapping'
import type { Category } from '../copaw-mapping'

export type PageTab = 'market' | 'local'
export type LocalOriginFilter = '全部' | '市场安装' | '本地上传'
export const LOCAL_ORIGIN_OPTIONS: LocalOriginFilter[] = ['全部', '市场安装', '本地上传']

export function LocalOriginDropdown({ value, onChange }: { value: LocalOriginFilter; onChange: (v: LocalOriginFilter) => void }) {
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
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
      >
        {value}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[110px] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-thin">
          {LOCAL_ORIGIN_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-[13px] transition-colors hover:bg-foreground/[0.06]',
                opt === value ? 'font-semibold text-foreground' : 'text-foreground/70',
              )}
            >
              <span className="h-3 w-3 flex-shrink-0">{opt === value ? <Check className="h-3 w-3" /> : null}</span>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function LocalCreateDropdown({
  onUpload,
  onCreateSkill,
}: {
  onUpload: () => void
  onCreateSkill: () => void
}) {
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
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-[13px] font-medium text-foreground shadow-xs transition-colors hover:bg-foreground/[0.04]"
      >
        创建
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[168px] overflow-hidden rounded-xl border border-border bg-popover py-1.5 shadow-thin">
          <button
            type="button"
            onClick={() => { onUpload(); setOpen(false) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <FolderUp className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            上传本地技能
          </button>
          <button
            type="button"
            onClick={() => { onCreateSkill(); setOpen(false) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] text-foreground transition-colors hover:bg-foreground/[0.06]"
          >
            <FilePlus2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            创建技能
          </button>
        </div>
      )}
    </div>
  )
}

export function CategoryDropdown({ value, onChange }: { value: Category; onChange: (v: Category) => void }) {
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
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
      >
        {value}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-thin">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => { onChange(cat); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-[13px] transition-colors hover:bg-foreground/[0.06]',
                cat === value ? 'font-semibold text-foreground' : 'text-foreground/70',
              )}
            >
              <span className="h-3 w-3 flex-shrink-0">{cat === value ? <Check className="h-3 w-3" /> : null}</span>
              {cat}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
