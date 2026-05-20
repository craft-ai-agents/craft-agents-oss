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
import { Check, Pencil, Plus, Search, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useAgents } from '@/hooks/useAgents'
import { AgentEditDialog } from './AgentEditDialog'
import { useAgentDisplayNames } from '@/hooks/useAgentDisplayNames'
import type { AgentDefinitionDTO } from '../../../shared/types'
import { CONCIERGE_SLUG, ORCHESTRATOR_SLUG } from '@craft-agent/shared/agent-definitions/types'

interface AgentLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string | null | undefined
}

export function AgentLibraryDialog({ open, onOpenChange, workspaceId }: AgentLibraryDialogProps) {
  const { allAgents, activeSlugs, setActive } = useAgents(workspaceId)
  const { getDisplayName, setDisplayName } = useAgentDisplayNames()
  const [query, setQuery] = React.useState('')
  const [createOpen, setCreateOpen] = React.useState(false)

  const sortedAgents = React.useMemo(() => {
    return allAgents
      .filter((a) => !isSystemAgent(a.slug))
      .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)))
  }, [allAgents, getDisplayName])

  const filteredAgents = React.useMemo(() => {
    if (!query.trim()) return sortedAgents
    const q = query.toLowerCase()
    return sortedAgents.filter(
      (a) =>
        getDisplayName(a).toLowerCase().includes(q) ||
        a.metadata.name.toLowerCase().includes(q) ||
        a.metadata.description.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q),
    )
  }, [sortedAgents, query, getDisplayName])

  const activeSet = new Set(activeSlugs)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-2xl overflow-hidden !rounded-[18px] !border !border-white/[0.08] !bg-[#09090c] p-0 !text-white !shadow-[0_28px_90px_rgba(0,0,0,0.62)]">
        <DialogHeader className="border-b border-white/[0.06] bg-[radial-gradient(circle_at_18%_0%,rgba(94,106,210,0.20),transparent_34%),#0b0b0f] px-6 py-5">
          <DialogTitle className="text-[22px] font-semibold leading-tight text-white">Manage agents</DialogTitle>
          <DialogDescription className="max-w-xl text-sm leading-6 text-white/52">
            Choose which agents appear in this workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4 px-6 py-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/34" />
            <input
              type="text"
              placeholder="Search agents"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-full rounded-[12px] border border-white/[0.08] bg-white/[0.035] pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#8b8cff]/40"
            />
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="absolute right-1.5 top-1/2 inline-flex h-7 -translate-y-1/2 items-center gap-1.5 rounded-[9px] border border-[#8b8cff]/24 bg-[#5e6ad2]/18 px-2.5 text-[11px] font-medium text-[#c3c6ff] transition-colors hover:bg-[#5e6ad2]/28 hover:text-white"
              title="Create a new agent from scratch"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>

          <div className="max-h-[54vh] min-w-0 space-y-2 overflow-y-auto overflow-x-hidden pr-1">
            {filteredAgents.length === 0 && (
              <div className="rounded-[14px] border border-dashed border-white/[0.10] px-4 py-8 text-center text-xs text-white/38">
                No agents match your search.
              </div>
            )}
            {filteredAgents.map((agent) => (
              <AgentRow
                key={agent.slug}
                agent={agent}
                displayName={getDisplayName(agent)}
                active={activeSet.has(agent.slug)}
                onToggle={() => setActive(agent.slug, !activeSet.has(agent.slug))}
                onRename={(name) => setDisplayName(agent, name)}
              />
            ))}
          </div>

          <p className="border-t border-white/[0.06] pt-3 text-[11px] text-white/34">
            {filteredActiveCount(activeSet, allAgents)} of {allAgents.filter((agent) => !isSystemAgent(agent.slug)).length} active in this workspace.
          </p>
        </div>
      </DialogContent>

      <AgentEditDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
      />
    </Dialog>
  )
}

interface AgentRowProps {
  agent: AgentDefinitionDTO
  displayName: string
  active: boolean
  onToggle: () => void
  onRename: (name: string) => void
}

function AgentRow({ agent, displayName, active, onToggle, onRename }: AgentRowProps) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(displayName)
  const cleanName = cleanDisplayText(displayName)
  const initials = cleanName.slice(0, 2)

  React.useEffect(() => {
    if (!editing) setDraft(displayName)
  }, [displayName, editing])

  const save = React.useCallback(() => {
    onRename(draft)
    setEditing(false)
  }, [draft, onRename])

  return (
    <div
      className="group flex min-w-0 cursor-pointer items-center gap-3 rounded-[14px] border border-white/[0.065] bg-white/[0.032] px-3 py-3 transition-colors hover:border-[#8b8cff]/28 hover:bg-white/[0.055]"
      style={{ opacity: active ? 1 : 0.7 }}
    >
      <input
        type="checkbox"
        checked={active}
        onChange={onToggle}
        className="h-3.5 w-3.5 cursor-pointer accent-[#8b8cff]"
      />
      <div
        className="flex shrink-0 items-center justify-center border border-white/[0.08] bg-white/[0.055] font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#b8bcff]"
        style={{
          width: 32,
          height: 32,
          borderRadius: 11,
        }}
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        {editing ? (
          <form
            className="flex min-w-0 items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setDraft(displayName)
                  setEditing(false)
                }
              }}
              className="h-7 min-w-0 flex-1 rounded-[8px] border border-[#8b8cff]/28 bg-black/30 px-2 text-sm font-medium text-white outline-none placeholder:text-white/28"
              placeholder={agent.metadata.name}
            />
            <button
              type="submit"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[#b8bcff] hover:bg-white/[0.06] hover:text-white"
              title="Save display name"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(displayName)
                setEditing(false)
              }}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-white/42 hover:bg-white/[0.06] hover:text-white"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </form>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-white">{cleanName}</span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-white/24 opacity-0 transition-colors hover:bg-white/[0.06] hover:text-[#c3c6ff] group-hover:opacity-100"
              title="Edit display name"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        )}
        <p className="mt-0.5 min-w-0 truncate text-xs text-white/42">{cleanDisplayText(agent.metadata.description)}</p>
      </div>
    </div>
  )
}

function cleanDisplayText(value: string) {
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function filteredActiveCount(activeSet: Set<string>, agents: AgentDefinitionDTO[]) {
  return agents.filter((agent) => !isSystemAgent(agent.slug) && activeSet.has(agent.slug)).length
}

function isSystemAgent(slug: string) {
  return slug === CONCIERGE_SLUG || slug === ORCHESTRATOR_SLUG
}
