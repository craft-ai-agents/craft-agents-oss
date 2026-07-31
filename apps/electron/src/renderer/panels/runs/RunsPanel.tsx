import React, { useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { Activity, Clock, Square, CheckCircle2, XCircle, Loader2, Coins, Download, Send, Share2, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { sessionMetaMapAtom, type SessionMeta } from '../../atoms/sessions'
import { useAppShellContext } from '../../context/AppShellContext'
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

function safeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'activity'
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  try { return JSON.stringify(content) } catch { return String(content ?? '') }
}

async function buildHandoff(sessionId: string, title: string): Promise<string> {
  const session = await window.electronAPI.getSessionMessages(sessionId)
  const transcript = (session?.messages ?? [])
    .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'error')
    .map((message) => `## ${message.role === 'assistant' ? 'Agent' : message.role === 'user' ? 'User' : 'Error'}\n${messageText(message.content)}`)
    .join('\n\n')
  const clipped = transcript.length > 40_000 ? `${transcript.slice(0, 40_000)}\n\n[Transcript clipped]` : transcript
  return `Continue from this ARCHstudio Activity: **${title}**\n\nSource session: ${sessionId}\n\n${clipped || 'No transcript is available.'}`
}

export function RunsPanel({ onOpenSession }: RunsPanelProps = {}) {
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const { onDeleteSession, onSendMessage, onCreateSession, activeWorkspaceId } = useAppShellContext()
  const [agentSource, setAgentSource] = useState<SessionMeta | null>(null)
  const [agentTarget, setAgentTarget] = useState('new')
  const [pendingAction, setPendingAction] = useState<string | null>(null)

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

  const saveActivity = async (meta: SessionMeta) => {
    setPendingAction(`save:${meta.id}`)
    try {
      const bundle = await window.electronAPI.exportSession(meta.id)
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${safeFilename(meta.name || meta.preview || meta.id)}.archstudio-session.json`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
      toast.success('Activity saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save activity')
    } finally {
      setPendingAction(null)
    }
  }

  const shareActivity = async (meta: SessionMeta) => {
    setPendingAction(`share:${meta.id}`)
    try {
      const title = meta.name || meta.preview || meta.id
      const text = await buildHandoff(meta.id, title)
      if (navigator.share) {
        await navigator.share({ title, text })
      } else {
        await navigator.clipboard.writeText(text)
        toast.success('Activity copied — paste it into any app')
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.error(error instanceof Error ? error.message : 'Could not share activity')
    } finally {
      setPendingAction(null)
    }
  }

  const addToAgent = async () => {
    if (!agentSource || !activeWorkspaceId) return
    setPendingAction(`agent:${agentSource.id}`)
    try {
      const title = agentSource.name || agentSource.preview || agentSource.id
      const handoff = await buildHandoff(agentSource.id, title)
      let targetId = agentTarget
      if (targetId === 'new') {
        const target = await onCreateSession(activeWorkspaceId)
        targetId = target.id
      }
      onSendMessage(targetId, handoff)
      toast.success('Activity added to agent')
      setAgentSource(null)
      onOpenSession?.(targetId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add activity to agent')
    } finally {
      setPendingAction(null)
    }
  }

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
              <div className="runs-panel__actions" role="group" aria-label={`Actions for ${title}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <button type="button" title="Save activity" aria-label="Save activity" disabled={!!pendingAction} onClick={() => void saveActivity(meta)}><Download size={15} /><span>Save</span></button>
                <button type="button" title="Add to agent" aria-label="Add to agent" disabled={!!pendingAction} onClick={() => { setAgentTarget('new'); setAgentSource(meta) }}><Send size={15} /><span>Add to Agent</span></button>
                <button type="button" title="Share to another app" aria-label="Share to another app" disabled={!!pendingAction} onClick={() => void shareActivity(meta)}><Share2 size={15} /><span>Share</span></button>
                <button type="button" className="runs-panel__delete" title="Delete activity" aria-label="Delete activity" disabled={!!pendingAction} onClick={() => void onDeleteSession(meta.id)}><Trash2 size={15} /><span>Delete</span></button>
              </div>
            </div>
          )
        })}
      </div>

      {agentSource && (
        <div className="runs-agent-dialog" role="dialog" aria-modal="true" aria-labelledby="runs-agent-title" onMouseDown={(e) => { if (e.target === e.currentTarget) setAgentSource(null) }}>
          <div className="runs-agent-dialog__card">
            <div className="runs-agent-dialog__header">
              <div><h3 id="runs-agent-title">Add to Agent</h3><p>Send this activity as context to another chat.</p></div>
              <button type="button" aria-label="Close" onClick={() => setAgentSource(null)}><X size={18} /></button>
            </div>
            <label htmlFor="runs-agent-target">Destination</label>
            <select id="runs-agent-target" value={agentTarget} onChange={(e) => setAgentTarget(e.target.value)}>
              <option value="new">New agent chat</option>
              {runs.filter((meta) => meta.id !== agentSource.id).map((meta) => (
                <option key={meta.id} value={meta.id}>{meta.name || meta.preview || meta.id}</option>
              ))}
            </select>
            <div className="runs-agent-dialog__footer">
              <button type="button" onClick={() => setAgentSource(null)}>Cancel</button>
              <button type="button" className="runs-agent-dialog__primary" disabled={pendingAction === `agent:${agentSource.id}`} onClick={() => void addToAgent()}>
                {pendingAction === `agent:${agentSource.id}` ? <Loader2 size={15} className="runs-badge__spin" /> : <Send size={15} />} Add to Agent
              </button>
            </div>
          </div>
        </div>
      )}
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
