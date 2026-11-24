/**
 * Shared visual helpers for Pages surfaces (tiles + detail header):
 * kind glyphs/chips, the poster placeholder, and the freshness indicator derived from PageConfig.
 */

import * as React from 'react'
import { Activity, FileText, MousePointerClick, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { formatShortAge } from '@/utils/session'
import type { PageConfig, PageKind } from '@craft-agent/shared/pages/types'

export const PAGE_KIND_ICONS: Record<PageKind, LucideIcon> = {
  static: FileText,
  interactive: MousePointerClick,
  live: Activity,
}

/**
 * Quiet tone behind a poster placeholder, from a role (never a fixed hue): live pages read as
 * "fresh" (success tint), interactive as the accent, static as neutral.
 */
const PAGE_KIND_TONE: Record<PageKind, string> = {
  static: 'var(--fill-hover)',
  interactive: 'var(--accent-tint)',
  live: 'var(--success-tint)',
}

/** Neutral kind chip (the label is always shown, so kind is never color-only). Live gets a success dot. */
export function PageKindBadge({ kind, className }: { kind: PageKind; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-xs bg-fill-hover px-1.5 text-label-sm text-secondary',
        className,
      )}
    >
      {kind === 'live' && <span className="size-1.5 shrink-0 rounded-full bg-current text-success" aria-hidden />}
      {t(`pages.kind.${kind}`)}
    </span>
  )
}

/**
 * Honest placeholder until a captured poster exists (always in WebUI): the kind icon in a raised
 * circle on a flat, kind-tinted well — no fake content. (A diagonal stripe pattern repeated on every
 * tile was the loudest thing on the page, especially in dark mode.)
 */
export function PagePosterPlaceholder({ kind }: { kind: PageKind }) {
  const Icon = PAGE_KIND_ICONS[kind]
  return (
    <span
      className="absolute inset-0 grid place-items-center"
      style={{ backgroundColor: PAGE_KIND_TONE[kind] }}
      aria-hidden
    >
      <span className="grid size-11 place-items-center rounded-full bg-raised text-secondary shadow-elev-1">
        <Icon className="size-4.5" strokeWidth={1.75} />
      </span>
    </span>
  )
}

/**
 * Freshness of a page's data/content:
 * - last refresh failed → destructive dot + "refresh failed"
 * - last refresh ok     → success dot + relative time
 * - never refreshed     → neutral dot + relative updatedAt
 */
export function PageFreshness({ config, className }: { config: PageConfig; className?: string }) {
  const { t } = useTranslation()
  const last = config.lastRefresh

  let tone = 'text-tertiary'
  let dotTone = 'text-tertiary'
  let text: string
  if (last && !last.ok) {
    tone = 'text-destructive'
    dotTone = 'text-destructive'
    text = t('pages.refreshFailed')
  } else if (last) {
    dotTone = 'text-success'
    text = formatShortAge(last.at)
  } else {
    text = formatShortAge(config.updatedAt)
  }

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-label-sm tabular-nums', tone, className)}>
      <span className={cn('size-1.5 shrink-0 rounded-full bg-current', dotTone)} aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  )
}
