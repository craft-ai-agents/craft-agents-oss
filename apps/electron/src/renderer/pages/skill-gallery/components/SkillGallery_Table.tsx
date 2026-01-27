/**
 * SkillGallery_Table
 *
 * Clean definition list style key-value display for gallery skill metadata.
 * Duplicated from Info_Table to allow the gallery to evolve independently.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SkillGallery_TableProps {
  children: React.ReactNode
  /** Optional footer content */
  footer?: React.ReactNode
  /** Label column width in pixels (default: 120) */
  labelWidth?: number
  className?: string
}

export interface SkillGallery_TableRowProps {
  /** Left column label */
  label: string
  /** Right column value (shorthand) */
  value?: React.ReactNode
  /** Right column content (for complex content, use instead of value) */
  children?: React.ReactNode
  className?: string
}

function SkillGallery_TableRoot({
  children,
  footer,
  labelWidth = 120,
  className,
}: SkillGallery_TableProps) {
  return (
    <div className={cn('py-2', className)}>
      <dl
        className="divide-y divide-border/30"
        style={{ '--label-width': `${labelWidth}px` } as React.CSSProperties}
      >
        {children}
      </dl>
      {footer}
    </div>
  )
}

function SkillGallery_TableRow({ label, value, children, className }: SkillGallery_TableRowProps) {
  const content = children ?? value

  return (
    <div className={cn('flex py-2.5 px-4 text-sm', className)}>
      <dt
        className="text-muted-foreground shrink-0"
        style={{ width: 'var(--label-width)' }}
      >
        {label}
      </dt>
      <dd className="flex-1 min-w-0">{content}</dd>
    </div>
  )
}

export const SkillGallery_Table = Object.assign(SkillGallery_TableRoot, {
  Row: SkillGallery_TableRow,
})
