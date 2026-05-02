/**
 * PulseChatNotice
 *
 * Inline Concierge chat surface for a Pulse `notify_user` decision. Standalone
 * component — wiring into ChatDisplay is deferred to Phase 1.5 (no clean
 * system-message injection point exists today, see report).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NotificationEntry } from '@/atoms/notifications'

interface PulseChatNoticeProps {
  entry: NotificationEntry
  onViewInBell?: () => void
}

export function PulseChatNotice({ entry, onViewInBell }: PulseChatNoticeProps) {
  const { t } = useTranslation()

  const tint =
    entry.urgency === 'high'
      ? 'bg-red-500/[0.06] border-red-500/30'
      : entry.urgency === 'normal'
        ? 'bg-blue-500/[0.05] border-blue-500/30'
        : 'bg-foreground/[0.03] border-border/40'

  return (
    <div className={cn('flex items-start gap-2 my-2 mx-3 px-3 py-2 rounded-md border', tint)}>
      <Activity className="h-3.5 w-3.5 mt-0.5 text-foreground/60 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium">{entry.title ?? 'Pulse'}</span>
          {entry.goalSlug && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-foreground/8 text-foreground/60">
              {entry.goalSlug}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] text-foreground/75 whitespace-pre-wrap break-words">
          {entry.message}
        </p>
        {onViewInBell && (
          <button
            type="button"
            onClick={onViewInBell}
            className="mt-1 text-[11px] text-accent hover:underline"
          >
            {t('notifications.viewInBell')}
          </button>
        )}
      </div>
    </div>
  )
}
