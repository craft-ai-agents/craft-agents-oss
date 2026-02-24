/**
 * AutomationEventTimeline
 *
 * Compact timeline showing recent automation executions.
 * Displayed as a section within AutomationInfoPage.
 */

import { CheckCircle2, XCircle, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getEventDisplayName, type ExecutionEntry, type ExecutionStatus } from './types'

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (seconds < 60) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function formatDuration(ms: number): string {
  if (ms === 0) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const statusConfig: Record<ExecutionStatus, { icon: React.ElementType; classes: string }> = {
  success: { icon: CheckCircle2, classes: 'text-success' },
  error:   { icon: XCircle,      classes: 'text-destructive' },
  blocked: { icon: ShieldAlert,   classes: 'text-warning' },
}

// ============================================================================
// Component
// ============================================================================

export interface AutomationEventTimelineProps {
  entries: ExecutionEntry[]
  className?: string
}

export function AutomationEventTimeline({ entries, className }: AutomationEventTimelineProps) {
  if (entries.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        No activity yet.
      </div>
    )
  }

  return (
    <div className={cn('divide-y divide-border/30', className)}>
      {entries.map((entry) => {
        const config = statusConfig[entry.status]
        const StatusIcon = config.icon

        return (
          <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            {/* Status icon */}
            <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', config.classes)} />

            {/* Time */}
            <span className="text-xs text-muted-foreground w-16 shrink-0 tabular-nums">
              {formatRelativeTime(entry.timestamp)}
            </span>

            {/* Event badge */}
            <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-foreground/8 text-foreground/60">
              {getEventDisplayName(entry.event)}
            </span>

            {/* Action summary */}
            <span className="flex-1 min-w-0 truncate text-xs text-foreground/70">
              {entry.actionSummary || entry.error || '—'}
            </span>

            {/* Duration */}
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {formatDuration(entry.duration)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
