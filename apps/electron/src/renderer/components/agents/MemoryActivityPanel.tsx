import * as React from 'react'
import { Clock3, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMemoryEvents } from '@/hooks/useMemoryEvents'
import type { MemoryEvent, MemoryScope } from '@craft-agent/shared/memory/types'

interface MemoryActivityPanelProps {
  scope: MemoryScope
  agentSlug?: string | null
}

export function MemoryActivityPanel({ scope, agentSlug }: MemoryActivityPanelProps) {
  const { events, loading, error, refresh } = useMemoryEvents(scope, agentSlug)
  const recentEvents = events.slice(0, 8)

  return (
    <div className="runneros-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Clock3 className="h-4 w-4 shrink-0 text-white/45" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-white/78">Memory activity</div>
            <div className="text-xs text-white/38">Recent writes and deletes from this memory file.</div>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0 text-white/50 hover:bg-white/[0.06] hover:text-white"
          onClick={() => void refresh()}
          aria-label="Refresh memory activity"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-white/42">Loading activity...</div>
        ) : error ? (
          <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{error}</div>
        ) : recentEvents.length === 0 ? (
          <div className="text-sm text-white/42">No memory activity yet.</div>
        ) : (
          <div className="grid gap-2">
            {recentEvents.map((event) => (
              <MemoryActivityRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MemoryActivityRow({ event }: { event: MemoryEvent }) {
  return (
    <div className="rounded-[10px] border border-white/[0.07] bg-white/[0.025] px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={activityBadgeClass(event.action)}>{formatAction(event.action)}</span>
            <span className="truncate text-sm text-white/76">{event.entryName ?? 'memory'}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/36">
            <span>{event.source}</span>
            {event.actor ? <span>actor: {event.actor}</span> : null}
            {event.runId ? <span>run: {event.runId}</span> : null}
          </div>
          {event.evidence ? (
            <div className="mt-1 line-clamp-2 text-xs text-white/42">{event.evidence}</div>
          ) : null}
        </div>
        <time className="shrink-0 text-[11px] text-white/30" dateTime={event.createdAt}>
          {formatTime(event.createdAt)}
        </time>
      </div>
    </div>
  )
}

function activityBadgeClass(action: MemoryEvent['action']): string {
  const base = 'rounded-[6px] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide'
  switch (action) {
    case 'save':
      return `${base} border border-emerald-400/25 bg-emerald-400/10 text-emerald-200/85`
    case 'update':
      return `${base} border border-sky-400/25 bg-sky-400/10 text-sky-200/85`
    case 'forget':
      return `${base} border border-red-400/25 bg-red-400/10 text-red-200/85`
    default:
      return `${base} border border-white/15 bg-white/[0.06] text-white/65`
  }
}

function formatAction(action: MemoryEvent['action']): string {
  if (action === 'forget') return 'forgot'
  return action
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
