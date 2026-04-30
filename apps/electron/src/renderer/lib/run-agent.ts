import { toast } from 'sonner'
import { navigate, routes } from '@/lib/navigate'
import { resolveAgentReferences, hasMissingReferences, describeMissingReferences } from '@/lib/agent-references'
import type { AgentDefinitionDTO, CreateSessionOptions, Session, LoadedSkill, LoadedSource } from '../../shared/types'

export function buildAgentDraftInput(agent: AgentDefinitionDTO): string {
  const parts: string[] = []
  const greeting = agent.metadata.greeting?.trim()
  if (greeting) parts.push(greeting)

  const skills = agent.metadata.skills?.filter(Boolean) ?? []
  if (skills.length > 0) {
    parts.push(`Use ${skills.map((slug) => `@${slug}`).join(' ')}.`)
  }

  return parts.join('\n\n')
}

export function buildAgentCreateSessionOptions(
  agent: AgentDefinitionDTO,
  /**
   * Optional resolved skills/sources. When provided, missing slugs are dropped
   * from the spawned session config (the agent still runs, just without the
   * unavailable bundles). When omitted (legacy callers), all declared slugs
   * pass through verbatim.
   */
  resolved?: { resolvedSkills: string[]; resolvedSources: string[] },
): CreateSessionOptions {
  const skills = resolved
    ? resolved.resolvedSkills
    : agent.metadata.skills ?? []
  const sources = resolved
    ? resolved.resolvedSources
    : agent.metadata.sources ?? []

  const options: CreateSessionOptions = {
    name: agent.metadata.name,
    customSystemPrompt: agent.systemPrompt || undefined,
    agentSkillSlugs: skills.length ? skills : undefined,
    enabledSourceSlugs: sources.length ? sources : undefined,
    llmConnection: agent.metadata.llmConnection,
    model: agent.metadata.model,
    permissionMode: agent.metadata.permissionMode,
    thinkingLevel: agent.metadata.thinkingLevel,
    spawnedFromAgent: {
      agentSlug: agent.slug,
      agentName: agent.metadata.name,
      timestamp: Date.now(),
    },
  }

  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined),
  ) as CreateSessionOptions
}

export async function openAgentSessionComposer(params: {
  agent: AgentDefinitionDTO
  workspaceId: string
  onCreateSession: (workspaceId: string, options?: CreateSessionOptions) => Promise<Session>
  onInputChange: (sessionId: string, value: string) => void
  /**
   * Optional live skill/source snapshots. When provided, missing slugs are
   * dropped from the spawned session config and the user gets a transparent
   * toast listing what got dropped. Strongly recommended — without these, the
   * session may try to activate skills/sources that don't exist on this
   * machine and silently fail to bind them.
   */
  skills?: LoadedSkill[]
  sources?: LoadedSource[]
}): Promise<Session> {
  let resolved: { resolvedSkills: string[]; resolvedSources: string[] } | undefined
  if (params.skills && params.sources) {
    const resolution = resolveAgentReferences(params.agent, params.skills, params.sources)
    resolved = {
      resolvedSkills: resolution.resolvedSkills,
      resolvedSources: resolution.resolvedSources,
    }
    if (hasMissingReferences(resolution)) {
      const summary = describeMissingReferences(resolution)
      // Inform the user what got dropped, but don't block — the agent still
      // produces useful output without the unavailable bundles.
      toast.warning(`${params.agent.metadata.name}: ${summary}`, {
        description: 'The session will run without those bundles. Activate them in this workspace to fix.',
      })
    }
  }

  const session = await params.onCreateSession(
    params.workspaceId,
    buildAgentCreateSessionOptions(params.agent, resolved),
  )
  navigate(routes.view.allSessions(session.id))

  const draft = buildAgentDraftInput(params.agent)
  if (draft) {
    setTimeout(() => params.onInputChange(session.id, draft), 100)
  }

  return session
}
