import React, { useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { Activity, Clock, Square, CheckCircle2, XCircle, Loader2, Coins, Download, Send, Share2, Trash2, X, Brain, AlertTriangle, Archive } from 'lucide-react'
import { toast } from 'sonner'
import { sessionMetaMapAtom, type SessionMeta } from '../../atoms/sessions'
import { useAppShellContext } from '../../context/AppShellContext'
import type { AnyMemory } from '@craft-agent/shared/memory/types'
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
  const { onDeleteSession, onArchiveSession, onSendMessage, onCreateSession, activeWorkspaceId } = useAppShellContext()
  const [agentSource, setAgentSource] = useState<SessionMeta | null>(null)
  const [agentTarget, setAgentTarget] = useState('new')
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  // Save-to-Memory dialog state
  const [memorySource, setMemorySource] = useState<SessionMeta | null>(null)
  const [memoryDraft, setMemoryDraft] = useState<{
    title: string
    content: string
    memoryClass: 'episodic' | 'semantic' | 'procedural' | 'profile'
  } | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<{ id: string; title: string } | null>(null)
  const [savingMemory, setSavingMemory] = useState(false)

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

  /**
   * Open the Save-to-Memory dialog for a session. Fetches the transcript,
   * auto-generates a memory draft, and checks for duplicates before showing
   * the editable dialog.
   */
  const openSaveToMemory = async (meta: SessionMeta) => {
    setPendingAction(`memory-load:${meta.id}`)
    setMemorySource(meta)
    setMemoryDraft(null)
    setDuplicateWarning(null)
    try {
      const session = await window.electronAPI.getSessionMessages(meta.id)
      const messages = session?.messages ?? []
      const userMessages = messages.filter((m) => m.role === 'user')
      const assistantMessages = messages.filter((m) => m.role === 'assistant')
      const errorMessages = messages.filter((m) => m.role === 'error')

      const firstUser = userMessages[0]
      const lastAssistant = assistantMessages[assistantMessages.length - 1]

      const taskText = firstUser ? messageText(firstUser.content).slice(0, 500).trim() : 'No user message recorded'
      const outcomeText = lastAssistant
        ? messageText(lastAssistant.content).slice(0, 1500).trim()
        : errorMessages.length > 0
          ? messageText(errorMessages[errorMessages.length - 1].content).slice(0, 500).trim()
          : 'No outcome recorded'

      const status = runStatus(meta)
      const duration = formatDuration(meta.createdAt, meta.lastMessageAt)

      const contentParts = [
        `Task: ${taskText}`,
        '',
        `Outcome: ${outcomeText}`,
        '',
        `Messages: ${messages.length} (${userMessages.length} user, ${assistantMessages.length} assistant)`,
        duration ? `Duration: ${duration}` : null,
        status === 'failed' ? 'Status: Failed' : null,
      ].filter(Boolean)

      const title = (meta.name || meta.preview || meta.id).slice(0, 80)

      setMemoryDraft({
        title,
        content: contentParts.join('\n'),
        memoryClass: 'episodic',
      })

      // Check for duplicates — search existing memories by title
      try {
        const hits = await window.electronAPI.searchMemories({ query: title, limit: 5 })
        const closeMatch = hits.find((h) => h.score > 0.7)
        if (closeMatch) {
          setDuplicateWarning({ id: closeMatch.memory.id, title: closeMatch.memory.title })
        }
      } catch {
        // Duplicate check is best-effort — don't block the dialog on failure
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load session for memory')
      setMemorySource(null)
    } finally {
      setPendingAction(null)
    }
  }

  /**
   * Save the memory draft to the memory store. Constructs a full AnyMemory
   * object from the dialog inputs and calls createMemory IPC.
   */
  const confirmSaveToMemory = async () => {
    if (!memoryDraft || !memorySource) return
    setSavingMemory(true)
    try {
      const now = new Date().toISOString()
      const status = runStatus(memorySource)
      const outcomeMap: Record<RunStatus, 'completed' | 'interrupted' | 'failed' | 'abandoned'> = {
        running: 'interrupted',
        completed: 'completed',
        failed: 'failed',
        idle: 'abandoned',
      }

      const memory: AnyMemory = {
        id: crypto.randomUUID(),
        class: memoryDraft.memoryClass,
        title: memoryDraft.title.trim() || 'Untitled activity',
        content: memoryDraft.content.trim(),
        scope: 'workspace',
        confidence: 0.8,
        sensitivity: 'internal',
        source: { sessionId: memorySource.id },
        createdAt: now,
        updatedAt: now,
        tags: ['session', 'activity'],
        archived: false,
        supersedesIds: [],
        // Episodic-specific fields
        ...(memoryDraft.memoryClass === 'episodic'
          ? {
              sessionId: memorySource.id,
              outcome: outcomeMap[status],
              decisions: [],
              artifacts: [],
              tokenCost: memorySource.tokenUsage?.totalTokens,
              durationSeconds:
                memorySource.createdAt && memorySource.lastMessageAt
                  ? Math.round((memorySource.lastMessageAt - memorySource.createdAt) / 1000)
                  : undefined,
            }
          : {}),
        // Semantic-specific fields
        ...(memoryDraft.memoryClass === 'semantic'
          ? {
              category: 'decision' as const,
              explicit: true,
            }
          : {}),
        // Procedural-specific fields
        ...(memoryDraft.memoryClass === 'procedural'
          ? {
              triggers: [],
              steps: [],
              successCount: 0,
              pitfalls: [],
              dependencies: [],
            }
          : {}),
        // Profile-specific fields
        ...(memoryDraft.memoryClass === 'profile'
          ? {
              key: memoryDraft.title.trim().toLowerCase().replace(/\s+/g, '-'),
              previousValues: [],
            }
          : {}),
      } as AnyMemory

      await window.electronAPI.createMemory(memory)
      toast.success('Saved to Memory', { description: memoryDraft.title })
      setMemorySource(null)
      setMemoryDraft(null)
      setDuplicateWarning(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save memory')
    } finally {
      setSavingMemory(false)
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
                <button type="button" title="Save to Memory" aria-label="Save to Memory" disabled={!!pendingAction} onClick={() => void openSaveToMemory(meta)}><Brain size={15} /><span>Memory</span></button>
                {onArchiveSession && (
                  <button type="button" title="Archive activity" aria-label="Archive activity" disabled={!!pendingAction} onClick={() => onArchiveSession(meta.id)}><Archive size={15} /><span>Archive</span></button>
                )}
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

      {/* Save to Memory dialog */}
      {memorySource && (
        <div
          className="runs-agent-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="runs-memory-title"
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setMemorySource(null); setMemoryDraft(null); setDuplicateWarning(null) } }}
        >
          <div className="runs-memory-dialog__card">
            <div className="runs-agent-dialog__header">
              <div>
                <h3 id="runs-memory-title">Save to Memory</h3>
                <p>Extract key takeaways from this activity into a persistent memory.</p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => { setMemorySource(null); setMemoryDraft(null); setDuplicateWarning(null) }}
              >
                <X size={18} />
              </button>
            </div>

            {memoryDraft ? (
              <>
                <label htmlFor="runs-memory-title-input">Title</label>
                <input
                  id="runs-memory-title-input"
                  type="text"
                  className="runs-memory-dialog__input"
                  value={memoryDraft.title}
                  onChange={(e) => setMemoryDraft({ ...memoryDraft, title: e.target.value })}
                  maxLength={120}
                />

                <label htmlFor="runs-memory-class">Memory class</label>
                <select
                  id="runs-memory-class"
                  value={memoryDraft.memoryClass}
                  onChange={(e) => setMemoryDraft({ ...memoryDraft, memoryClass: e.target.value as typeof memoryDraft.memoryClass })}
                >
                  <option value="episodic">Episodic — session summary</option>
                  <option value="semantic">Semantic — durable fact / decision</option>
                  <option value="procedural">Procedural — reusable workflow</option>
                  <option value="profile">Profile — user preference</option>
                </select>

                <label htmlFor="runs-memory-content">Content</label>
                <textarea
                  id="runs-memory-content"
                  className="runs-memory-dialog__textarea"
                  value={memoryDraft.content}
                  onChange={(e) => setMemoryDraft({ ...memoryDraft, content: e.target.value })}
                  rows={10}
                />

                {duplicateWarning && (
                  <div className="runs-memory-dialog__warning">
                    <AlertTriangle size={14} />
                    <span>
                      Similar memory exists: <strong>{duplicateWarning.title}</strong>. This will create a new memory alongside it.
                    </span>
                  </div>
                )}

                <div className="runs-agent-dialog__footer">
                  <button type="button" onClick={() => { setMemorySource(null); setMemoryDraft(null); setDuplicateWarning(null) }}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="runs-agent-dialog__primary"
                    disabled={savingMemory || !memoryDraft.title.trim() || !memoryDraft.content.trim()}
                    onClick={() => void confirmSaveToMemory()}
                  >
                    {savingMemory ? <Loader2 size={15} className="runs-badge__spin" /> : <Brain size={15} />} Save to Memory
                  </button>
                </div>
              </>
            ) : (
              <div className="runs-memory-dialog__loading">
                <Loader2 size={20} className="runs-badge__spin" />
                <span>Loading session transcript…</span>
              </div>
            )}
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
