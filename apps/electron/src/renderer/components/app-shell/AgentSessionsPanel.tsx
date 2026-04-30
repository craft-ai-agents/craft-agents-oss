/**
 * AgentSessionsPanel
 *
 * Middle pane for the Agents navigator. When the user selects an agent
 * in the sidebar, this panel shows every session that was spawned from
 * that agent. Each agent becomes its own work-stream / channel —
 * "open Researcher" lists every research session you've ever run.
 *
 * The filter is `session.spawnedFromAgent.agentSlug === currentSlug`.
 * That field is set at session-creation time when the user summons an
 * agent (via the upcoming run button or `/slug` mention syntax).
 *
 * Empty states expose the same Run behavior as the detail page: create a
 * normal session from the saved agent config and open the composer.
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Play, Inbox } from 'lucide-react'
import { toast } from 'sonner'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import { useAgents } from '@/hooks/useAgents'
import { useAppShellContext } from '@/context/AppShellContext'
import { openAgentSessionComposer } from '@/lib/run-agent'
import { navigate, routes } from '@/lib/navigate'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ORCHESTRATOR_SLUG } from '@craft-agent/shared/agent-definitions/types'

interface AgentSessionsPanelProps {
  agentSlug: string
  workspaceId: string | null | undefined
}

export function AgentSessionsPanel({ agentSlug, workspaceId }: AgentSessionsPanelProps) {
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const skills = useAtomValue(skillsAtom)
  const sources = useAtomValue(sourcesAtom)
  const { allAgents } = useAgents(workspaceId)
  const { onCreateSession, onInputChange } = useAppShellContext()

  const agent = React.useMemo(
    () => allAgents.find((a) => a.slug === agentSlug),
    [allAgents, agentSlug],
  )

  // Filter sessions: must belong to the active workspace AND have been
  // spawned from this agent. Sort by most-recent activity first.
  const sessions = React.useMemo(() => {
    const out: SessionMeta[] = []
    for (const s of sessionMetaMap.values()) {
      if (s.spawnedFromAgent?.agentSlug !== agentSlug) continue
      if (workspaceId && s.workspaceId !== workspaceId) continue
      if (s.isArchived) continue
      out.push(s)
    }
    out.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
    return out
  }, [sessionMetaMap, agentSlug, workspaceId])

  const handleRun = React.useCallback(async () => {
    if (!workspaceId || !agent) {
      navigate(routes.view.agents(agentSlug))
      return
    }
    try {
      await openAgentSessionComposer({
        agent,
        workspaceId,
        onCreateSession,
        onInputChange,
        skills,
        sources,
      })
    } catch (err) {
      toast.error('Failed to run agent', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [agent, agentSlug, onCreateSession, onInputChange, skills, sources, workspaceId])

  const avatar = agent?.metadata.avatar?.trim() || (agentSlug === ORCHESTRATOR_SLUG ? '🎯' : '🤖')
  const name = agent?.metadata.name ?? agentSlug

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-3 border-b border-border/30">
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            fontSize: 18,
            background: 'rgba(125,125,125,0.10)',
          }}
        >
          {avatar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{name}</div>
          <div className="text-[11px] text-foreground/55">
            {sessions.length === 0 ? 'No sessions yet' : `${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <button
          type="button"
          onClick={handleRun}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-border/40 hover:bg-foreground/5 shrink-0"
          title={`Run ${name}`}
        >
          <Play className="h-3 w-3" />
          Run
        </button>
      </div>

      {/* Sessions list */}
      {sessions.length === 0 ? (
        <EmptyState agentName={name} onRun={handleRun} />
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col">
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onClick={() => {
                  // Jumps to the standard sessions navigator. A future round can
                  // introduce a nested "agents/agent/<slug>/session/<id>" route
                  // to keep the agent context while a session is open.
                  navigate(`allSessions/session/${session.id}`)
                }}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

interface SessionRowProps {
  session: SessionMeta
  onClick: () => void
}

function SessionRow({ session, onClick }: SessionRowProps) {
  const title = session.name || session.preview?.slice(0, 48) || '(untitled)'
  const subtitle = formatRelativeTime(session.lastMessageAt ?? session.createdAt)
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left px-3 py-2 border-b border-border/20 hover:bg-foreground/5"
    >
      <div className="text-sm font-medium truncate">{title}</div>
      <div className="text-[11px] text-foreground/50 mt-0.5 flex items-center gap-2">
        <span>{subtitle}</span>
        {session.messageCount != null && session.messageCount > 0 && (
          <span>· {session.messageCount} msgs</span>
        )}
        {session.hasUnread && <span className="text-blue-500">· new</span>}
      </div>
    </button>
  )
}

interface EmptyStateProps {
  agentName: string
  onRun: () => void
}

function EmptyState({ agentName, onRun }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-8 text-center">
      <Inbox className="h-8 w-8 text-foreground/30" />
      <div>
        <p className="text-sm text-foreground/70">No sessions yet for {agentName}.</p>
        <p className="text-xs text-foreground/50 mt-1 max-w-xs mx-auto">
          Every time you summon this agent, the session lands here — it becomes
          your work-stream for {agentName}.
        </p>
      </div>
      <button
        type="button"
        onClick={onRun}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border/40 hover:bg-foreground/5"
      >
        <Play className="h-3 w-3" />
        Run {agentName}
      </button>
    </div>
  )
}

function formatRelativeTime(ts?: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
