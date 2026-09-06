/**
 * Shared visual helpers for Pages surfaces (tiles + detail header):
 * kind glyphs/badges and the freshness indicator derived from PageConfig.
 */

import * as React from 'react'
import { Activity, FileText, MousePointerClick, type LucideIcon } from 'lucide-react'
import { formatDistanceToNowStrict, type Locale } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { shortTimeLocale } from '@/utils/session'
import type { PageConfig, PageKind } from '@craft-agent/shared/pages/types'

export const PAGE_KIND_ICONS: Record<PageKind, LucideIcon> = {
  static: FileText,
  interactive: MousePointerClick,
  live: Activity,
}

export function relativeTime(epochMs: number): string {
  return formatDistanceToNowStrict(new Date(epochMs), {
    locale: shortTimeLocale as Locale,
    roundingMethod: 'floor',
  })
}

/** Compact "icon + label" pill for the page kind (text + icon, never color-only). */
export function PageKindBadge({ kind, className }: { kind: PageKind; className?: string }) {
  const { t } = useTranslation()
  const Icon = PAGE_KIND_ICONS[kind]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-foreground/[0.02] px-1.5 py-0.5 text-[10.5px] font-medium text-foreground/60',
        kind === 'live' && 'text-emerald-600 dark:text-emerald-400',
        kind === 'interactive' && 'text-sky-600 dark:text-sky-400',
        className,
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />
      {t(`pages.kind.${kind}`)}
    </span>
  )
}

/**
 * Freshness of a page's data/content:
 * - last refresh failed → red dot + "refresh failed"
 * - last refresh ok     → green dot + relative time
 * - never refreshed     → neutral dot + relative updatedAt
 */
export function PageFreshness({ config, className }: { config: PageConfig; className?: string }) {
  const { t } = useTranslation()
  const last = config.lastRefresh

  let dotClass = 'bg-foreground/30'
  let text: string
  if (last && !last.ok) {
    dotClass = 'bg-red-500'
    text = t('pages.refreshFailed')
  } else if (last) {
    dotClass = 'bg-emerald-500'
    text = relativeTime(last.at)
  } else {
    text = relativeTime(config.updatedAt)
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[11px] text-foreground/50', className)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass)} aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  )
}
