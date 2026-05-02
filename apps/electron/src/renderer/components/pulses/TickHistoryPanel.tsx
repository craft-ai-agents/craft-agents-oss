/**
 * TickHistoryPanel
 *
 * Renders the tick log for a single Pulse automation. Subscribes to live tick
 * broadcasts from Lane C's `onPulseTick` channel.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../../shared/routes'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import type { PulseTickEntry } from '@craft-agent/shared/pulses'

interface TickHistoryPanelProps {
  workspaceId: string
  pulseId: string
  limit?: number
  className?: string
}

/** Bridge methods are fully typed via Lane C's electronAPI extensions. */
function getApi() {
  return window.electronAPI
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'now'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function actionChipColor(action: string): string {
  switch (action) {
    case 'do_nothing':
      return 'bg-foreground/8 text-foreground/55'
    case 'notify_user':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
    case 'kick_workflow':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'ask_user':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    default:
      return 'bg-foreground/8 text-foreground/55'
  }
}

function decisionExcerpt(decision: PulseTickEntry['decision']): string {
  switch (decision.action) {
    case 'do_nothing':
      return decision.reason
    case 'notify_user':
      return decision.message
    case 'kick_workflow':
      return decision.why
    case 'ask_user':
      return decision.question
    default:
      return ''
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

export function TickHistoryPanel({
  workspaceId,
  pulseId,
  limit = 50,
  className,
}: TickHistoryPanelProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const [ticks, setTicks] = React.useState<PulseTickEntry[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    const api = getApi()
    setLoading(true)
    if (!api.listPulseTicks) {
      setTicks([])
      setLoading(false)
      return
    }
    api
      .listPulseTicks(workspaceId, pulseId, limit)
      .then((entries) => {
        if (cancelled) return
        setTicks([...entries].sort((a, b) => b.tickedAt.localeCompare(a.tickedAt)))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, pulseId, limit])

  React.useEffect(() => {
    const api = getApi()
    if (!api.onPulseTick) return
    // Lane C's broadcast wire shape: (workspaceId, tick). Tick entries embed
    // their own pulseId, so filter by pulseId from the payload itself.
    const cleanup = api.onPulseTick((wsId, entry) => {
      if (wsId !== workspaceId || entry.pulseId !== pulseId) return
      setTicks((prev) => {
        const next = prev.filter((t) => t.tickedAt !== entry.tickedAt)
        next.unshift(entry)
        return next.slice(0, limit)
      })
    })
    return cleanup
  }, [workspaceId, pulseId, limit])

  return (
    <div className={cn('rounded-md border border-border/30 bg-background', className)}>
      <div className="px-3 py-2 border-b border-border/30 text-xs font-semibold text-foreground/70">
        {t('pulses.tickHistory.title')}
      </div>
      {loading ? (
        <div className="px-3 py-4 text-xs text-foreground/50">…</div>
      ) : ticks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Activity className="h-5 w-5 text-foreground/20" strokeWidth={1.5} />
          <p className="text-xs text-foreground/50">{t('pulses.tickHistory.empty')}</p>
        </div>
      ) : (
        <div className="divide-y divide-border/20">
          {ticks.map((tick) => {
            const action = tick.decision.action
            const goalSlug = 'goalSlug' in tick.decision ? tick.decision.goalSlug : undefined
            const runId =
              tick.decision.action === 'kick_workflow'
                ? // runId is appended by Lane B; tolerate the extension via cast
                  (tick.decision as unknown as { runId?: string }).runId
                : undefined
            return (
              <div key={`${tick.tickedAt}-${tick.driverSessionId}`} className="px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-foreground/50 shrink-0">
                        {relativeTime(tick.tickedAt)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {new Date(tick.tickedAt).toLocaleString()}
                    </TooltipContent>
                  </Tooltip>
                  <span
                    className={cn(
                      'px-1.5 py-0.5 text-[10px] font-medium rounded',
                      actionChipColor(action),
                    )}
                  >
                    {t(`pulses.action.${action}` as const)}
                  </span>
                  {goalSlug && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-foreground/8 text-foreground/60">
                      {goalSlug}
                    </span>
                  )}
                  <span className="text-foreground/40 ml-auto shrink-0">
                    {Math.max(1, Math.round(tick.durationMs / 1000))}s
                  </span>
                </div>
                <p className="mt-1 text-foreground/70 break-words">
                  {truncate(decisionExcerpt(tick.decision), 120)}
                </p>
                {runId && (
                  <button
                    type="button"
                    onClick={() => navigate(routes.view.workflowRun(runId))}
                    className="mt-1 text-[11px] text-accent hover:underline"
                  >
                    {t('notifications.openRun')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
