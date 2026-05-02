/**
 * BellMenu
 *
 * Top-bar bell that surfaces Pulse notifications. Shows an urgency-tinted badge
 * with the unread count, and a popover listing entries grouped by urgency.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { TopBarButton } from '@/components/ui/TopBarButton'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../../shared/routes'
import { usePulseNotifications } from '@/hooks/usePulseNotifications'
import type { NotificationEntry } from '@/atoms/notifications'
import { NotificationItem } from './NotificationItem'
import { cn } from '@/lib/utils'

interface BellMenuProps {
  workspaceId: string | null
}

export function BellMenu({ workspaceId }: BellMenuProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const {
    entries,
    unreadCount,
    highestUrgency,
    acknowledge,
    clear,
    clearAll,
    respond,
  } = usePulseNotifications(workspaceId)

  const [showAcknowledged, setShowAcknowledged] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  const visibleByUrgency = React.useMemo(() => {
    const filter = (list: NotificationEntry[]) =>
      showAcknowledged ? list : list.filter((e) => !e.acknowledgedAt && !e.clearedAt)
    const buckets: Record<'high' | 'normal' | 'low', NotificationEntry[]> = {
      high: [],
      normal: [],
      low: [],
    }
    for (const entry of entries) {
      if (entry.clearedAt) continue
      buckets[entry.urgency].push(entry)
    }
    return {
      high: filter(buckets.high),
      normal: filter(buckets.normal),
      low: filter(buckets.low),
    }
  }, [entries, showAcknowledged])

  const totalVisible =
    visibleByUrgency.high.length + visibleByUrgency.normal.length + visibleByUrgency.low.length

  const badgeColor =
    highestUrgency === 'high'
      ? 'bg-red-500 text-white'
      : highestUrgency === 'normal'
        ? 'bg-blue-500 text-white'
        : highestUrgency === 'low'
          ? 'bg-foreground/40 text-background'
          : null

  const handleOpenRun = (runId: string) => {
    setOpen(false)
    navigate(routes.view.workflowRun(runId))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TopBarButton
          aria-label={t('notifications.bellTitle')}
          className="relative h-[26px] w-[26px] rounded-lg"
        >
          <Bell className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
          {badgeColor && unreadCount > 0 && (
            <span
              className={cn(
                'absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-semibold flex items-center justify-center leading-none',
                badgeColor,
              )}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </TopBarButton>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[360px] p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
          <span className="text-sm font-semibold">{t('notifications.bellTitle')}</span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-foreground/60 cursor-pointer">
              <input
                type="checkbox"
                checked={showAcknowledged}
                onChange={(e) => setShowAcknowledged(e.target.checked)}
                className="h-3 w-3"
              />
              {t('notifications.showAcknowledged')}
            </label>
            {entries.length > 0 && (
              <button
                type="button"
                onClick={() => void clearAll()}
                className="text-[11px] text-foreground/60 hover:text-foreground"
              >
                {t('notifications.clearAll')}
              </button>
            )}
          </div>
        </div>

        {totalVisible === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Bell className="h-6 w-6 text-foreground/20" strokeWidth={1.5} />
            <p className="text-xs text-foreground/50">{t('notifications.empty')}</p>
          </div>
        ) : (
          <div className="max-h-[480px] overflow-y-auto">
            {(['high', 'normal', 'low'] as const).map((bucket) => {
              const list = visibleByUrgency[bucket]
              if (list.length === 0) return null
              return (
                <div key={bucket}>
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/40">
                    {t(`notifications.urgency.${bucket}`)}
                  </div>
                  <div className="divide-y divide-border/20">
                    {list.map((entry) => (
                      <NotificationItem
                        key={entry.id}
                        entry={entry}
                        onAcknowledge={(id) => void acknowledge(id)}
                        onClear={(id) => void clear(id)}
                        onRespond={(id, text) => void respond(id, text)}
                        onOpenRun={handleOpenRun}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
