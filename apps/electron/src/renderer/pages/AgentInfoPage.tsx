/**
 * AgentInfoPage
 *
 * Read-only detail view for a saved agent. Shows what skills/sources are
 * bundled, the runtime knobs, and the system prompt. Provides:
 *
 *   - Active toggle (per current workspace)
 *   - "Run agent" (opens the standard new-session composer with this agent's config)
 *   - "Open in editor" (raw AGENT.md) — Round 1 edits happen on disk
 *   - Delete (removes from global library + every workspace's manifest)
 *
 * Form-based create/edit ships in a follow-up; raw-file edit is the
 * MVP affordance to keep this page lean.
 */

import * as React from 'react'
import { Bot, FileEdit, Play, Trash2, AlertTriangle } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Badge,
  Info_Markdown,
  Info_Alert,
} from '@/components/info'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { useAgents } from '@/hooks/useAgents'
import { openAgentSessionComposer } from '@/lib/run-agent'
import { resolveAgentReferences, describeMissingReferences } from '@/lib/agent-references'
import { skillsAtom } from '@/atoms/skills'
import { sourcesAtom } from '@/atoms/sources'
import type { AgentDefinitionDTO } from '../../shared/types'

interface AgentInfoPageProps {
  agentSlug: string
  workspaceId: string
}

export default function AgentInfoPage({ agentSlug, workspaceId }: AgentInfoPageProps) {
  const [agent, setAgent] = React.useState<AgentDefinitionDTO | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const activeWorkspace = useActiveWorkspace()
  const { onCreateSession, onInputChange } = useAppShellContext()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const { activeSlugs, setActive, remove } = useAgents(workspaceId)

  // Load + refresh on agentDefinitions:changed
  React.useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try {
        const loaded = await window.electronAPI.getAgentDefinition(agentSlug)
        if (!mounted) return
        if (!loaded) {
          setLoadError(`Agent "${agentSlug}" was deleted or not found in the global library.`)
          setAgent(null)
        } else {
          setAgent(loaded)
          setLoadError(null)
        }
      } catch (err) {
        if (!mounted) return
        setLoadError(err instanceof Error ? err.message : String(err))
      }
    }
    refresh()
    const cleanup = window.electronAPI.onAgentDefinitionsChanged(() => refresh())
    return () => {
      mounted = false
      cleanup()
    }
  }, [agentSlug])

  if (loadError) {
    return (
      <Info_Page>
        <Info_Page.Content>
          <Info_Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
            <Info_Alert.Title>Agent unavailable</Info_Alert.Title>
            <Info_Alert.Description>{loadError}</Info_Alert.Description>
          </Info_Alert>
        </Info_Page.Content>
      </Info_Page>
    )
  }

  if (!agent) {
    return (
      <Info_Page>
        <Info_Page.Content>
          <div style={{ padding: 24, opacity: 0.6, fontSize: 13 }}>Loading…</div>
        </Info_Page.Content>
      </Info_Page>
    )
  }

  const isActive = activeSlugs.includes(agent.slug)
  const avatar = agent.metadata.avatar?.trim() || '🤖'

  // Cross-check declared skills/sources against the live workspace artifacts.
  // The user sees "missing" badges in line with the bundle list AND a top-level
  // banner summarizing the situation, so they can fix it before clicking Run.
  const skills = useAtomValue(skillsAtom)
  const sources = useAtomValue(sourcesAtom)
  const references = React.useMemo(
    () => resolveAgentReferences(agent, skills, sources),
    [agent, skills, sources],
  )
  const missingDescription = describeMissingReferences(references)

  const handleToggleActive = async () => {
    try {
      await setActive(agent.slug, !isActive)
      toast.success(isActive ? 'Deactivated in this workspace' : 'Activated in this workspace')
    } catch (err) {
      toast.error('Failed to update activation', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleOpenRaw = async () => {
    if (!canRevealLocally) return
    try {
      await window.electronAPI.showInFolder(`${agent.path}/AGENT.md`)
    } catch (err) {
      toast.error('Failed to reveal AGENT.md', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleRun = async () => {
    try {
      await openAgentSessionComposer({
        agent,
        workspaceId,
        onCreateSession,
        onInputChange,
        // Pass live workspace bundles so the run path can drop any missing
        // references with a transparent toast (instead of silently failing
        // to bind them at session start).
        skills,
        sources,
      })
    } catch (err) {
      toast.error('Failed to run agent', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${agent.metadata.name}" from the global library?\n\nThis is not workspace deactivation. It removes the AGENT.md file and deactivates this agent in every workspace.`)) {
      return
    }
    try {
      const ok = await remove(agent.slug)
      if (ok) toast.success(`Deleted "${agent.metadata.name}"`)
      else toast.error('Delete returned no-op (was the agent already gone?)')
    } catch (err) {
      toast.error('Failed to delete agent', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <Info_Page>
      <Info_Page.Header title={agent.metadata.name} />
      <Info_Page.Content>
        {/* Hero */}
        <Info_Page.Hero
          avatar={
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 32,
                background: 'rgba(125,125,125,0.10)',
              }}
            >
              {avatar}
            </div>
          }
          title={agent.metadata.name}
          tagline={agent.metadata.description}
        />

        {/* Quick actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleToggleActive}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border/50 hover:bg-foreground/5"
            style={{
              background: isActive ? 'rgba(60,180,120,0.15)' : undefined,
              color: isActive ? 'rgb(50,160,100)' : undefined,
            }}
          >
            {isActive ? 'Active in this workspace' : 'Activate in this workspace'}
          </button>
          <button
            type="button"
            onClick={handleRun}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border/50 hover:bg-foreground/5"
          >
            <Play className="h-3 w-3" />
            Run
          </button>
          {canRevealLocally && (
            <button
              type="button"
              onClick={handleOpenRaw}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border/50 hover:bg-foreground/5"
            >
              <FileEdit className="h-3 w-3" />
              Edit raw
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-red-500/30 hover:bg-red-500/10 text-red-500 ml-auto opacity-80"
          >
            <Trash2 className="h-3 w-3" />
            Delete globally
          </button>
        </div>

        {agent.parseWarnings && agent.parseWarnings.length > 0 && (
          <Info_Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
            <Info_Alert.Title>AGENT.md has ignored fields</Info_Alert.Title>
            <Info_Alert.Description>
              {agent.parseWarnings.map((warning) => warning.message).join(' ')}
            </Info_Alert.Description>
          </Info_Alert>
        )}

        {missingDescription && (
          <Info_Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
            <Info_Alert.Title>This agent references things that aren't in this workspace</Info_Alert.Title>
            <Info_Alert.Description>
              {missingDescription}. Running the agent will work, but those bundles won't activate. Activate them in the
              workspace, or remove them from the agent's bundled list.
            </Info_Alert.Description>
          </Info_Alert>
        )}

        {/* Configuration */}
        <Info_Section title="Configuration">
          <Info_Table>
            <Info_Table.Row label="Slug">
              <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                /{agent.slug}
              </code>
            </Info_Table.Row>
            <Info_Table.Row label="LLM connection" value={agent.metadata.llmConnection ?? '(workspace default)'} />
            <Info_Table.Row label="Model" value={agent.metadata.model ?? '(provider default)'} />
            <Info_Table.Row label="Permission mode" value={agent.metadata.permissionMode ?? 'ask'} />
            <Info_Table.Row label="Thinking level" value={agent.metadata.thinkingLevel ?? '(workspace default)'} />
          </Info_Table>
        </Info_Section>

        {/* Capabilities — declarative I/O contract */}
        {(agent.metadata.inputs || agent.metadata.outputs || (agent.metadata.tags?.length ?? 0) > 0) && (
          <Info_Section
            title="Capabilities"
            description="What this agent expects, what it produces, and tags for browse / orchestration."
          >
            <Info_Table>
              {agent.metadata.inputs && (
                <Info_Table.Row label="Takes" value={agent.metadata.inputs} />
              )}
              {agent.metadata.outputs && (
                <Info_Table.Row label="Produces" value={agent.metadata.outputs} />
              )}
              {agent.metadata.tags && agent.metadata.tags.length > 0 && (
                <Info_Table.Row label="Tags">
                  <div className="flex gap-1.5 flex-wrap">
                    {agent.metadata.tags.map((tag) => (
                      <Info_Badge key={tag} color="muted">
                        #{tag}
                      </Info_Badge>
                    ))}
                  </div>
                </Info_Table.Row>
              )}
            </Info_Table>
          </Info_Section>
        )}

        {/* Skills + sources */}
        <Info_Section
          title="Bundled skills & sources"
          description="These activate automatically when this agent runs."
        >
          <Info_Table>
            <Info_Table.Row label="Skills">
              {agent.metadata.skills && agent.metadata.skills.length > 0 ? (
                <div className="flex gap-1.5 flex-wrap">
                  {agent.metadata.skills.map((s) => {
                    const isMissing = references.missingSkills.includes(s)
                    return (
                      <Info_Badge key={s} color={isMissing ? 'warning' : 'muted'}>
                        @{s}{isMissing ? ' (missing)' : ''}
                      </Info_Badge>
                    )
                  })}
                </div>
              ) : (
                <span className="text-xs text-foreground/50">none</span>
              )}
            </Info_Table.Row>
            <Info_Table.Row label="Sources">
              {agent.metadata.sources && agent.metadata.sources.length > 0 ? (
                <div className="flex gap-1.5 flex-wrap">
                  {agent.metadata.sources.map((s) => {
                    const isMissing = references.missingSources.includes(s)
                    return (
                      <Info_Badge key={s} color={isMissing ? 'warning' : 'muted'}>
                        @{s}{isMissing ? ' (missing)' : ''}
                      </Info_Badge>
                    )
                  })}
                </div>
              ) : (
                <span className="text-xs text-foreground/50">none</span>
              )}
            </Info_Table.Row>
          </Info_Table>
        </Info_Section>

        {/* System prompt */}
        <Info_Section
          title="System prompt"
          description="The instructions the agent receives at session start."
        >
          <Info_Markdown maxHeight={420}>{agent.systemPrompt || '_(empty)_'}</Info_Markdown>
        </Info_Section>

        {/* Greeting (when set) */}
        {agent.metadata.greeting && (
          <Info_Section title="Composer greeting">
            <p className="text-sm text-foreground/70">{agent.metadata.greeting}</p>
          </Info_Section>
        )}
      </Info_Page.Content>
    </Info_Page>
  )
}

// Suppress unused-import lint when actions get further trimmed in the future
void Bot
