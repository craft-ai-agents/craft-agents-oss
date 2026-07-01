import * as React from 'react'
import { CalendarDays, CheckCircle2, Circle, Clock3, MessageSquare, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import type { SessionMeta } from '@/atoms/sessions'
import type { SessionStatus } from '@/config/session-status-config'

interface AgendaPageProps {
  sessions: SessionMeta[]
  statuses?: SessionStatus[]
  onOpenSession: (sessionId: string) => void
  onNewTask: () => void
}

const FALLBACK_COLUMNS = [
  { id: 'todo', label: 'To Do' },
  { id: 'in-progress', label: 'Doing' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
]

export function AgendaPage({ sessions, statuses, onOpenSession, onNewTask }: AgendaPageProps) {
  const columns = React.useMemo(() => {
    const configured = (statuses ?? []).map((status) => ({ id: status.id, label: status.label }))
    return configured.length ? configured : FALLBACK_COLUMNS
  }, [statuses])
  const visibleSessions = React.useMemo(
    () => sessions.filter((session) => !session.hidden && !session.isArchived),
    [sessions],
  )
  const byColumn = React.useMemo(() => {
    const map = new Map<string, SessionMeta[]>()
    for (const column of columns) map.set(column.id, [])
    const fallback = columns[0]?.id
    for (const session of visibleSessions) {
      const key = session.sessionStatus && map.has(session.sessionStatus) ? session.sessionStatus : fallback
      if (!key) continue
      map.get(key)?.push(session)
    }
    for (const items of map.values()) {
      items.sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0))
    }
    return map
  }, [columns, visibleSessions])

  return (
    <div className="runneros-glass-route h-full overflow-y-auto">
      <div className="mx-auto min-h-full max-w-[1320px] px-8 py-9">
        <header className="mb-7 flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.025] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/46">
              <CalendarDays className="h-3.5 w-3.5 text-orange-300/75" />
              Work Board
            </div>
            <h1 className="text-4xl font-medium tracking-tight text-white/90">Agenda</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
              Track jobs, follow-ups, and active work without opening chat. Campaign command centers stay inside their own workspaces.
            </p>
          </div>
          <button
            type="button"
            onClick={onNewTask}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-4 text-xs font-medium text-white/65"
          >
            <Plus className="h-3.5 w-3.5" />
            New Task
          </button>
        </header>

        <div className="grid min-h-[520px] grid-cols-1 gap-3 lg:grid-cols-4">
          {columns.slice(0, 4).map((column, index) => {
            const items = byColumn.get(column.id) ?? []
            return (
              <section key={column.id} className="rounded-[18px] border border-white/[0.055] bg-[#0A0A0A]/82 p-3">
                <div className="mb-3 flex items-center justify-between border-b border-white/[0.045] pb-2.5">
                  <div className="flex items-center gap-2">
                    <ColumnIcon index={index} />
                    <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">{column.label}</h2>
                  </div>
                  <span className="text-[10px] tabular-nums text-white/28">{items.length}</span>
                </div>

                <div className="space-y-2">
                  {items.length ? items.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => onOpenSession(session.id)}
                      className="w-full rounded-[14px] border border-white/[0.055] bg-white/[0.025] p-3 text-left transition-colors hover:bg-white/[0.05]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="line-clamp-2 text-sm font-medium leading-5 text-white/78">{getSessionTitle(session)}</p>
                        <Circle className={cn('mt-1 h-3 w-3 shrink-0', session.isProcessing ? 'text-orange-300' : 'text-white/24')} />
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/38">
                        {session.preview || session.spawnedFromAgent?.agentName || 'Workspace task'}
                      </p>
                      <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-white/25">
                        <MessageSquare className="h-3 w-3" />
                        {session.messageCount ?? 0} notes
                      </div>
                    </button>
                  )) : (
                    <div className="rounded-[14px] border border-dashed border-white/[0.06] bg-white/[0.012] px-3 py-6 text-center text-xs text-white/30">
                      Nothing here.
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ColumnIcon({ index }: { index: number }) {
  const Icon = index === 0 ? Circle : index === 1 ? Clock3 : index === 2 ? CalendarDays : CheckCircle2
  return <Icon className="h-3.5 w-3.5 text-white/35" />
}
