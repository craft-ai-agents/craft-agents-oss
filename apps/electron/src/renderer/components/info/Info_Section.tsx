/**
 * Info_Section
 *
 * Section container with title, optional description, and content card.
 * Matches SettingsSection styling pattern.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface Info_SectionProps {
  /** Section title */
  title: string
  /** Optional description below title */
  description?: string
  /** Optional right-aligned header actions */
  actions?: React.ReactNode
  /** Section content */
  children: React.ReactNode
  className?: string
}

export function Info_Section({
  title,
  description,
  actions,
  children,
  className,
}: Info_SectionProps) {
  return (
    <section className={cn('space-y-3 pt-2', className)}>
      <div className="flex items-start justify-between pl-1">
        <div className="space-y-0.5">
          <h3 className="text-[15px] font-semibold text-white/90">
            {title}
          </h3>
          {description && (
            <p className="text-[13px] leading-5 text-white/46">{description}</p>
          )}
        </div>
        {actions}
      </div>
      <div className="overflow-hidden rounded-[14px] border border-white/[0.075] bg-white/[0.035] shadow-middle">
        {children}
      </div>
    </section>
  )
}
