/**
 * AgentsLaunchpad
 *
 * The main-content view shown when the user is in the Agents navigator
 * but hasn't selected a specific agent yet. Replaces the older "list of
 * 40 agents in the middle pane" — sidebar children now carry the active
 * subset, so this view is a friendly orientation surface instead.
 *
 * Surfaces:
 *   - Active agent cards (Orchestrator pinned first) — click to open detail
 *   - "Manage agents" CTA → opens the AgentLibraryDialog (handled by parent
 *     via the same hook so toggling state is consistent across surfaces)
 *   - Lightweight intro copy framing the mental model
 */

import * as React from 'react'
import { Sparkles, Settings2 } from 'lucide-react'
import { useAgents } from '@/hooks/useAgents'
import { AgentLibraryDialog } from './AgentLibraryDialog'
import { navigate, routes } from '@/lib/navigate'

const ORCHESTRATOR_SLUG = 'orchestrator'

interface AgentsLaunchpadProps {
  workspaceId: string | null | undefined
}

export function AgentsLaunchpad({ workspaceId }: AgentsLaunchpadProps) {
  const { activeAgents, allAgents, loading } = useAgents(workspaceId)
  const [libraryOpen, setLibraryOpen] = React.useState(false)

  // Pin orchestrator first; alphabetical for the rest.
  const sorted = React.useMemo(() => {
    const orch = activeAgents.find((a) => a.slug === ORCHESTRATOR_SLUG)
    const rest = activeAgents
      .filter((a) => a.slug !== ORCHESTRATOR_SLUG)
      .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
    return orch ? [orch, ...rest] : rest
  }, [activeAgents])

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Agents
            </h1>
            <p className="text-sm text-foreground/60 mt-1 max-w-xl">
              Saved personas that bundle an LLM, a system prompt, and the skills + tools they
              need. Summon one to start a session, or open the library to activate more.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border/40 hover:bg-foreground/5 shrink-0"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Manage library
          </button>
        </div>

        {/* Active agent cards */}
        {loading && sorted.length === 0 ? (
          <div className="text-sm text-foreground/50">Loading agents…</div>
        ) : sorted.length === 0 ? (
          <EmptyState
            allAgentsCount={allAgents.length}
            onOpenLibrary={() => setLibraryOpen(true)}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sorted.map((agent) => (
              <AgentCard
                key={agent.slug}
                slug={agent.slug}
                name={agent.metadata.name}
                description={agent.metadata.description}
                avatar={agent.metadata.avatar}
                isOrchestrator={agent.slug === ORCHESTRATOR_SLUG}
                onClick={() => navigate(routes.view.agents(agent.slug))}
              />
            ))}
          </div>
        )}
      </div>

      <AgentLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        workspaceId={workspaceId}
      />
    </div>
  )
}

interface AgentCardProps {
  slug: string
  name: string
  description: string
  avatar?: string
  isOrchestrator: boolean
  onClick: () => void
}

function AgentCard({ name, description, avatar, isOrchestrator, onClick }: AgentCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left flex flex-col gap-2 p-4 rounded-lg border border-border/40 hover:border-border/80 hover:bg-foreground/5 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            fontSize: 20,
            background: isOrchestrator ? 'rgba(80,160,250,0.12)' : 'rgba(125,125,125,0.10)',
          }}
        >
          {avatar?.trim() || (isOrchestrator ? '🎯' : '🤖')}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm">{name}</span>
            {isOrchestrator && (
              <span className="text-[10px] uppercase tracking-wider text-foreground/55 px-1.5 py-0.5 rounded bg-foreground/5">
                core
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-foreground/60 leading-snug">{description}</p>
    </button>
  )
}

interface EmptyStateProps {
  allAgentsCount: number
  onOpenLibrary: () => void
}

function EmptyState({ allAgentsCount, onOpenLibrary }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-border/40 p-6 text-center">
      <p className="text-sm text-foreground/70">
        No agents are active in this workspace yet.
      </p>
      <p className="text-xs text-foreground/50 mt-1 mb-4">
        {allAgentsCount > 0
          ? `${allAgentsCount} agents are available in the global library.`
          : 'The global library is empty. Restart the app to seed the starter set, or create one manually under ~/.agents/agents/.'}
      </p>
      {allAgentsCount > 0 && (
        <button
          type="button"
          onClick={onOpenLibrary}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border/40 hover:bg-foreground/5"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Open library
        </button>
      )}
    </div>
  )
}
