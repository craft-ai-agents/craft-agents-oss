/**
 * AgentLibraryDialog
 *
 * Full-library activation picker. Shows every agent in the global library
 * with a checkbox per row; toggling auto-saves the workspace's
 * activated-agents manifest.
 *
 * Why a modal instead of a sidebar list of all 40 agents:
 *   - Sidebar should show the user's curated set, not the firehose.
 *   - The "+ Manage agents" entry in the sidebar opens this picker; the
 *     sidebar then re-renders with the new active subset.
 *
 * Auto-save (vs. an explicit Save button) is deliberate — toggling feels
 * lighter, the pattern matches how iOS/macOS toggles work, and there's
 * nothing destructive enough to warrant confirmation.
 */

import * as React from 'react'
import { Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useAgents } from '@/hooks/useAgents'
import type { AgentDefinitionDTO } from '../../../shared/types'
import { ORCHESTRATOR_SLUG } from '@craft-agent/shared/agent-definitions/types'

interface AgentLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string | null | undefined
}

export function AgentLibraryDialog({ open, onOpenChange, workspaceId }: AgentLibraryDialogProps) {
  const { allAgents, activeSlugs, setActive } = useAgents(workspaceId)
  const [query, setQuery] = React.useState('')

  const sortedAgents = React.useMemo(() => {
    // Orchestrator first, then alphabetical. The Orchestrator is foundational
    // to the sidebar UX, so it leads even when search filters the rest.
    const others = allAgents
      .filter((a) => a.slug !== ORCHESTRATOR_SLUG)
      .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
    const orch = allAgents.find((a) => a.slug === ORCHESTRATOR_SLUG)
    return orch ? [orch, ...others] : others
  }, [allAgents])

  const filteredAgents = React.useMemo(() => {
    if (!query.trim()) return sortedAgents
    const q = query.toLowerCase()
    return sortedAgents.filter(
      (a) =>
        a.metadata.name.toLowerCase().includes(q) ||
        a.metadata.description.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q),
    )
  }, [sortedAgents, query])

  const activeSet = new Set(activeSlugs)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Agents</DialogTitle>
          <DialogDescription>
            Pick which agents are active in this workspace. Inactive agents stay in the global library at <code className="font-mono">~/.agents/agents/</code> — flip them on anytime.
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/40" />
          <input
            type="text"
            placeholder="Search agents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border/40 rounded-md bg-background"
          />
        </div>

        {/* List */}
        <div className="flex flex-col gap-1 max-h-[55vh] overflow-y-auto pr-1">
          {filteredAgents.length === 0 && (
            <div className="text-xs text-foreground/50 py-4 text-center">
              No agents match your search.
            </div>
          )}
          {filteredAgents.map((agent) => (
            <AgentRow
              key={agent.slug}
              agent={agent}
              active={activeSet.has(agent.slug)}
              onToggle={() => setActive(agent.slug, !activeSet.has(agent.slug))}
            />
          ))}
        </div>

        <p className="text-[11px] text-foreground/50 mt-2">
          {activeSet.size} of {allAgents.length} active in this workspace.
        </p>
      </DialogContent>
    </Dialog>
  )
}

interface AgentRowProps {
  agent: AgentDefinitionDTO
  active: boolean
  onToggle: () => void
}

function AgentRow({ agent, active, onToggle }: AgentRowProps) {
  const avatar = agent.metadata.avatar?.trim() || '🤖'
  const isOrchestrator = agent.slug === ORCHESTRATOR_SLUG
  return (
    <label
      className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-foreground/5 cursor-pointer"
      style={{ opacity: active ? 1 : 0.7 }}
    >
      <input
        type="checkbox"
        checked={active}
        onChange={onToggle}
        className="h-3.5 w-3.5 cursor-pointer"
      />
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          fontSize: 16,
          background: 'rgba(125,125,125,0.10)',
        }}
      >
        {avatar}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{agent.metadata.name}</span>
          {isOrchestrator && (
            <span className="text-[10px] uppercase tracking-wider text-foreground/50 px-1.5 py-0.5 rounded bg-foreground/5">
              core
            </span>
          )}
        </div>
        <p className="text-xs text-foreground/55 truncate">{agent.metadata.description}</p>
      </div>
    </label>
  )
}
