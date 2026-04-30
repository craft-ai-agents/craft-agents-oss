/**
 * AgentInfoPage
 *
 * Read-only detail view for a saved agent. Shows what skills/sources are
 * bundled, the runtime knobs, and the system prompt. Provides:
 *
 *   - Active toggle (per current workspace)
 *   - "Run agent" stub (composer integration lands in the next round)
 *   - "Open in editor" (raw AGENT.md) — Round 1 edits happen on disk
 *   - Delete (removes from global library + every workspace's manifest)
 *
 * Form-based create/edit ships in a follow-up; raw-file edit is the
 * MVP affordance to keep this page lean.
 */

import * as React from 'react'
import { Bot, FileEdit, Play, Trash2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Badge,
  Info_Markdown,
  Info_Alert,
} from '@/components/info'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { useAgents } from '@/hooks/useAgents'
import type { AgentDefinitionDTO } from '../../shared/types'

interface AgentInfoPageProps {
  agentSlug: string
  workspaceId: string
}

export default function AgentInfoPage({ agentSlug, workspaceId }: AgentInfoPageProps) {
  const [agent, setAgent] = React.useState<AgentDefinitionDTO | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const activeWorkspace = useActiveWorkspace()
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

  const handleRunStub = () => {
    // Run-from-agent (composer prefill) ships in the next commit.
    // For now surface a clear message so users know it's intentional.
    toast.info('Run-from-agent coming next', {
      description: 'Run wiring lands in the next commit. For now use @-mention in a session.',
    })
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${agent.metadata.name}" from the global library? This removes it from every workspace.`)) {
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
            onClick={handleRunStub}
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border/50 hover:bg-red-500/10 text-red-500 ml-auto"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>

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

        {/* Skills + sources */}
        <Info_Section
          title="Bundled skills & sources"
          description="These activate automatically when this agent runs."
        >
          <Info_Table>
            <Info_Table.Row label="Skills">
              {agent.metadata.skills && agent.metadata.skills.length > 0 ? (
                <div className="flex gap-1.5 flex-wrap">
                  {agent.metadata.skills.map((s) => (
                    <Info_Badge key={s} color="muted">
                      ${s}
                    </Info_Badge>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-foreground/50">none</span>
              )}
            </Info_Table.Row>
            <Info_Table.Row label="Sources">
              {agent.metadata.sources && agent.metadata.sources.length > 0 ? (
                <div className="flex gap-1.5 flex-wrap">
                  {agent.metadata.sources.map((s) => (
                    <Info_Badge key={s} color="muted">
                      @{s}
                    </Info_Badge>
                  ))}
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
