/**
 * NotificationItem
 *
 * One row inside the BellMenu popover. Surfaces a Pulse / system notification
 * with acknowledge / dismiss / reply / open-run affordances.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { NotificationEntry } from '@/atoms/notifications'

const MAX_PREVIEW_CHARS = 200

function relativeTime(iso: string | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

interface NotificationItemProps {
  entry: NotificationEntry
  onAcknowledge: (id: string) => void
  onClear: (id: string) => void
  onRespond: (id: string, text: string) => void
  onOpenRun?: (runId: string) => void
}

export function NotificationItem({
  entry,
  onAcknowledge,
  onClear,
  onRespond,
  onOpenRun,
}: NotificationItemProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const [reply, setReply] = React.useState('')

  const Icon = entry.source === 'pulse' ? Activity : Bell

  const message = entry.message ?? ''
  const truncated = !expanded && message.length > MAX_PREVIEW_CHARS
  const preview = truncated ? message.slice(0, MAX_PREVIEW_CHARS) + '…' : message

  const urgencyTint =
    entry.urgency === 'high'
      ? 'bg-red-500/[0.06] border-l-red-500/40'
      : entry.urgency === 'normal'
        ? 'bg-blue-500/[0.05] border-l-blue-500/40'
        : 'bg-foreground/[0.02] border-l-foreground/15'

  const title = entry.title ?? (entry.source === 'pulse' ? 'Pulse' : 'Notification')
  const isAcknowledged = !!entry.acknowledgedAt

  return (
    <div
      className={cn(
        'border-l-2 px-3 py-2 text-sm',
        urgencyTint,
        isAcknowledged && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-foreground/60" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[13px] truncate">{title}</span>
            <span className="text-[11px] text-foreground/50 shrink-0">
              {relativeTime(entry.createdAt)}
            </span>
            {entry.goalSlug && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-foreground/8 text-foreground/60 truncate">
                {entry.goalSlug}
              </span>
            )}
          </div>
          {message && (
            <button
              type="button"
              onClick={() => truncated && setExpanded(true)}
              className={cn(
                'mt-1 block text-left text-[12px] text-foreground/75 whitespace-pre-wrap break-words',
                truncated && 'cursor-pointer hover:text-foreground',
              )}
            >
              {preview}
            </button>
          )}

          {entry.awaitingResponse && !entry.userResponse && (
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="text"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t('notifications.replyPlaceholder')}
                className="flex-1 h-7 px-2 text-[12px] rounded-md border border-border/40 bg-background/60 outline-none focus:border-accent/60"
              />
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={!reply.trim()}
                onClick={() => {
                  const text = reply.trim()
                  if (!text) return
                  onRespond(entry.id, text)
                  setReply('')
                }}
              >
                {t('notifications.reply')}
              </Button>
            </div>
          )}

          <div className="mt-2 flex items-center gap-1.5 text-[11px]">
            {entry.workflowRunId && onOpenRun && (
              <button
                type="button"
                onClick={() => onOpenRun(entry.workflowRunId!)}
                className="px-2 py-0.5 rounded-md text-foreground/70 hover:text-foreground hover:bg-foreground/5"
              >
                {t('notifications.openRun')}
              </button>
            )}
            {!isAcknowledged && (
              <button
                type="button"
                onClick={() => onAcknowledge(entry.id)}
                className="px-2 py-0.5 rounded-md text-foreground/70 hover:text-foreground hover:bg-foreground/5"
              >
                {t('notifications.acknowledge')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onClear(entry.id)}
              className="px-2 py-0.5 rounded-md text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5"
            >
              {t('notifications.dismiss')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
