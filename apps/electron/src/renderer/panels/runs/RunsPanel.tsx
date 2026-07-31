import React, { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { Activity, Clock, Square, CheckCircle2, XCircle, Loader2, Coins } from 'lucide-react'
import { sessionMetaMapAtom, type SessionMeta } from '../../atoms/sessions'
import './RunsPanel.css'

type RunStatus = 'running' | 'completed' | 'failed' | 'idle'

function runStatus(meta: SessionMeta): RunStatus {
  if (meta.isProcessing) return 'running'
  if (meta.lastMessageRole === 'error') return 'failed'
  if (meta.messageCount && meta.messageCount > 0) return 'completed'
  return 'idle'
}

const STATUS_ORDER: Record<RunStatus, number> = { running: 0, failed: 1, completed: 2, idle: 3 }

function formatDuration(startMs?: number, endMs?: number): string | null {
  if (!startMs || !endMs || endMs < startMs) return null
  const s = Math.round((endMs - startMs) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export interface RunsPanelProps {
  /**
   * Open the session behind a row. Supplied by LayoutShell, which both
   * switches the shell back to the chat view and routes to the session —
   * a panel can't do the first part on its own. Omitted in tests and in the
   * playground, where rows simply render as non-interactive.
   */
  onOpenSession?: (sessionId: string) => void
}

export function RunsPanel({ onOpenSession }: RunsPanelProps = {}) {
  const metaMap = useAtomValue(sessionMetaMapAtom)

  const runs = useMemo(() => {
    return Array.from(metaMap.values())
      .filter((m) => !m.hidden && !m.isArchived)
      .sort((a, b) => {
        const byStatus = STATUS_ORDER[runStatus(a)] - STATUS_ORDER[runStatus(b)]
        if (byStatus !== 0) return byStatus
        return (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0)
      })
  }, [metaMap])

  const activeCount = runs.filter((m) => runStatus(m) === 'running').length

  /**
   * Workspace-wide spend. This is the one number the panel surfaces that
   * nothing else in the app does — sessions carry `tokenUsage` individually,
   * but until now there was nowhere to see the total.
   *
   * Only sessions with recorded usage contribute; a session whose provider
   * never reported usage is absent from the totals rather than counted as
   * zero, so `sessionsWithUsage` is shown alongside to make the denominator
   * explicit instead of implying the figure covers everything.
   */
  const totals = useMemo(() => {
    let tokens = 0
    let costUsd = 0
    let sessionsWithUsage = 0
    for (const m of runs) {
      if (!m.tokenUsage) continue
      sessionsWithUsage++
      tokens += m.tokenUsage.totalTokens ?? 0
      costUsd += m.tokenUsage.costUsd ?? 0
    }
    return { tokens, costUsd, sessionsWithUsage }
  }, [runs])

  return (
    <div className="runs-panel">
      <div className="runs-panel__header">
        <div className="runs-panel__title">
          <Activity size={20} />
          <h2>Activity</h2>
          {activeCount > 0 && <span className="runs-panel__live">{activeCount} active</span>}
        </div>
        {totals.sessionsWithUsage > 0 && (
          <div
            className="runs-panel__totals"
            title={`Across ${totals.sessionsWithUsage} of ${runs.length} session${runs.length === 1 ? '' : 's'} with recorded usage`}
          >
            <Coins size={14} />
            <span>{totals.tokens.toLocaleString()} tokens</span>
            {totals.costUsd > 0 && (
              <span className="runs-panel__totals-cost">${totals.costUsd.toFixed(4)}</span>
            )}
          </div>
        )}
      </div>

      <div className="runs-panel__list">
        {runs.length === 0 && (
          <div className="runs-panel__empty">No activity yet. Start a session and it will appear here.</div>
        )}
        {runs.map((meta) => {
          const status = runStatus(meta)
          const duration =
            status === 'running' ? null : formatDuration(meta.createdAt, meta.lastMessageAt)
          const title = meta.name || meta.preview || meta.id
          const interactive = !!onOpenSession
          return (
            <div
              key={meta.id}
              className={`runs-panel__item ${interactive ? 'runs-panel__item--interactive' : ''}`}
              {...(interactive
                ? {
                    role: 'button' as const,
                    tabIndex: 0,
                    title: `Open "${title}"`,
                    onClick: () => onOpenSession(meta.id),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpenSession(meta.id)
                      }
                    },
                  }
                : {})}
            >
              <div className="runs-panel__item-header">
                <span className="runs-panel__item-title">{title}</span>
                <StatusBadge status={status} />
              </div>
              <div className="runs-panel__item-meta">
                <Clock size={14} />
                {/* Wall-clock between the first and last message — NOT time spent
                    working. A session left open overnight reads as many hours.
                    Labelled "open for" rather than a bare duration so it doesn't
                    imply compute time. */}
                {meta.createdAt && <span>Started {new Date(meta.createdAt).toLocaleString()}</span>}
                {duration && <span>· open for {duration}</span>}
                {meta.messageCount != null && <span>· {meta.messageCount} msgs</span>}
              </div>
              {meta.tokenUsage && (
                <div className="runs-panel__item-meta">
                  <Coins size={14} />
                  <span>{meta.tokenUsage.totalTokens.toLocaleString()} tokens</span>
                  {meta.tokenUsage.costUsd > 0 && <span>· ${meta.tokenUsage.costUsd.toFixed(4)}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: RunStatus }) {
  const map = {
    running: { label: 'Running', icon: Loader2, className: 'runs-badge--running' },
    completed: { label: 'Completed', icon: CheckCircle2, className: 'runs-badge--completed' },
    failed: { label: 'Failed', icon: XCircle, className: 'runs-badge--failed' },
    idle: { label: 'Idle', icon: Square, className: 'runs-badge--cancelled' },
  } as const

  const cfg = map[status]
  const Icon = cfg.icon

  return (
    <span className={`runs-badge ${cfg.className}`}>
      <Icon size={14} className={status === 'running' ? 'runs-badge__spin' : undefined} />
      {cfg.label}
    </span>
  )
}
