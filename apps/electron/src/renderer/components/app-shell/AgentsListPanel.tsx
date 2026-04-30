/**
 * AgentsListPanel
 *
 * Renders the "Agents" sidebar panel: every saved agent in the global
 * library, with an in-row toggle for "active in this workspace."
 *
 * - The toggle is the primary affordance: workspaces opt in to agents,
 *   so making activation a one-click action keeps the per-workspace
 *   subset feeling fluid and discoverable.
 * - Inactive agents stay visible but rendered at reduced opacity so
 *   users can browse the whole library without leaving the workspace.
 * - Detail click navigates to AgentInfoPage; we don't shortcut to a
 *   "run" composer here because the user said run = open composer
 *   (Round 1 scope).
 */

import * as React from 'react'
import { Bot } from 'lucide-react'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { agentSelection } from '@/hooks/useEntitySelection'
import { useAgents } from '@/hooks/useAgents'
import type { AgentDefinitionDTO } from '../../../shared/types'

interface AgentsListPanelProps {
  workspaceId: string | null | undefined
  onAgentClick: (agent: AgentDefinitionDTO) => void
  selectedSlug?: string | null
  className?: string
}

export function AgentsListPanel({
  workspaceId,
  onAgentClick,
  selectedSlug,
  className,
}: AgentsListPanelProps) {
  const { allAgents, activeSlugs, loading, setActive } = useAgents(workspaceId)

  if (loading && allAgents.length === 0) {
    // First-load placeholder — keep panel in flow rather than flicker an empty state
    return (
      <div className={className} style={{ padding: 16, opacity: 0.5, fontSize: 13 }}>
        Loading agents…
      </div>
    )
  }

  return (
    <EntityPanel<AgentDefinitionDTO>
      items={allAgents}
      getId={(a) => a.slug}
      selection={agentSelection}
      selectedId={selectedSlug}
      onItemClick={onAgentClick}
      className={className}
      emptyState={
        <EntityListEmptyScreen
          icon={<Bot />}
          title="No agents yet"
          description="Agents are saved personas you can summon — LLM, prompt, skills, and tools bundled together. The starter set lives in ~/.agents/agents/."
          docKey="skills"
        />
      }
      mapItem={(agent) => {
        const isActive = activeSlugs.includes(agent.slug)
        return {
          icon: <AgentAvatarBadge avatar={agent.metadata.avatar} active={isActive} />,
          title: (
            <span style={{ opacity: isActive ? 1 : 0.55 }}>{agent.metadata.name}</span>
          ),
          badges: (
            <span
              className="flex items-center gap-1.5 min-w-0"
              style={{ opacity: isActive ? 1 : 0.5 }}
            >
              <span className="truncate">{agent.metadata.description}</span>
            </span>
          ),
          menu: (
            <ActiveToggle
              active={isActive}
              onToggle={() => setActive(agent.slug, !isActive)}
            />
          ),
        }
      }}
    />
  )
}

interface AgentAvatarBadgeProps {
  avatar?: string
  active: boolean
}

function AgentAvatarBadge({ avatar, active }: AgentAvatarBadgeProps) {
  // Inline emoji-or-fallback. Keeps the component dependency-light;
  // a richer SVG/image avatar comes in a follow-up round.
  const display = avatar?.trim() || '🤖'
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        opacity: active ? 1 : 0.5,
        background: 'rgba(125,125,125,0.10)',
      }}
    >
      {display}
    </div>
  )
}

interface ActiveToggleProps {
  active: boolean
  onToggle: () => void
}

function ActiveToggle({ active, onToggle }: ActiveToggleProps) {
  // Plain button — uses theme-friendly opacity rather than introducing a
  // new color token. Click stops propagation so it doesn't navigate to
  // the detail page on every flip.
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      title={active ? 'Active in this workspace · click to deactivate' : 'Inactive · click to activate here'}
      style={{
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 999,
        border: '1px solid rgba(125,125,125,0.25)',
        background: active ? 'rgba(60,180,120,0.18)' : 'transparent',
        color: active ? 'rgb(50,160,100)' : 'inherit',
        opacity: active ? 1 : 0.65,
        cursor: 'pointer',
      }}
    >
      {active ? 'Active' : 'Inactive'}
    </button>
  )
}
