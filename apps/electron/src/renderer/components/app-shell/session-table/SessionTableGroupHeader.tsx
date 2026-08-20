import * as React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SessionTableGroupHeaderProps {
  bucket: { key: string; label: string; count: number }
  collapsed: boolean
  onToggle: () => void
  style?: React.CSSProperties
}

export function SessionTableGroupHeader({ bucket, collapsed, onToggle, style }: SessionTableGroupHeaderProps) {
  return (
    <li
      className={cn(
        'sticky top-[29px] z-[5] flex min-h-8 items-center gap-2 border-b border-border/40 bg-background/95 px-3 py-1.5 text-xs font-semibold text-foreground/80 backdrop-blur',
      )}
      style={style}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1.5 hover:text-foreground"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        <span>{bucket.label}</span>
        <span className="font-normal text-muted-foreground">({bucket.count})</span>
      </button>
    </li>
  )
}
