import { toast } from 'sonner'
import { navigate, routes } from '@/lib/navigate'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions'
import { resolveAgentReferences, hasMissingReferences, describeMissingReferences } from '@/lib/agent-references'
import { composeAgentSystemPrompt } from '@/lib/compose-agent-prompt'
import type { AgentDefinitionDTO, ContextDocDTO, CreateSessionOptions, Session, LoadedSkill, LoadedSource } from '../../shared/types'

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
   * Optional live skill / source snapshots. When provided:
   *   - missing slugs are dropped from `agentSkillSlugs` / `enabledSourceSlugs`
   *     so the session doesn't try to activate things that don't exist
   *   - the system prompt gets a generated footer enumerating each bundled
   *     skill + tool with their description (so the LLM has clear "here's
   *     your menu" guidance, not just an opaque list of slugs)
   * When omitted (legacy callers), all declared slugs pass through verbatim
   * and no footer is generated.
   */
  context?: { skills: LoadedSkill[]; sources: LoadedSource[]; contextDocs?: ContextDocDTO[]; agentCatalog?: AgentDefinitionDTO[] },
): CreateSessionOptions {
  let skillSlugs = agent.metadata.skills ?? []
  let sourceSlugs = agent.metadata.sources ?? []

  if (context) {
    const resolution = resolveAgentReferences(agent, context.skills, context.sources)
    skillSlugs = resolution.resolvedSkills
    sourceSlugs = resolution.resolvedSources
  }

  // Compose the prompt: persona body + workspace context + bundle footer.
  // Each section is optional; pure absence collapses cleanly.
  const composedPrompt = context
    ? composeAgentSystemPrompt(
        agent,
        context.skills,
        context.sources,
        context.contextDocs ?? [],
        (context.agentCatalog ?? []).map((a) => ({
          slug: a.slug,
          name: a.metadata.name,
          description: a.metadata.description,
          inputs: a.metadata.inputs,
          outputs: a.metadata.outputs,
          tags: a.metadata.tags,
        })),
      )
    : agent.systemPrompt
  const isConcierge = agent.slug === CONCIERGE_SLUG
  const agentCatalog = context?.agentCatalog ?? []

  const options: CreateSessionOptions = {
    name: agent.metadata.name,
    customSystemPrompt: composedPrompt || undefined,
    agentSkillSlugs: skillSlugs.length ? skillSlugs : undefined,
    enabledSourceSlugs: sourceSlugs.length ? sourceSlugs : undefined,
    llmConnection: agent.metadata.llmConnection,
    model: agent.metadata.model,
    permissionMode: agent.metadata.permissionMode,
    thinkingLevel: agent.metadata.thinkingLevel,
    spawnedFromAgent: {
      agentSlug: agent.slug,
      agentName: agent.metadata.name,
      timestamp: Date.now(),
    },
    launchReceipt: {
      createdAt: Date.now(),
      origin: isConcierge ? 'concierge' : 'agent',
      summary: isConcierge ? 'Concierge chat session.' : `Started from @${agent.slug}.`,
      agent: {
        slug: agent.slug,
        name: agent.metadata.name,
        description: agent.metadata.description,
        inputs: agent.metadata.inputs,
        outputs: agent.metadata.outputs,
        tags: agent.metadata.tags,
      },
      config: {
        llmConnection: agent.metadata.llmConnection,
        model: agent.metadata.model,
        permissionMode: agent.metadata.permissionMode,
        thinkingLevel: agent.metadata.thinkingLevel,
      },
      injected: {
        systemPromptChars: composedPrompt.length,
        skills: skillSlugs,
        sources: sourceSlugs,
        contextDocs: (context?.contextDocs ?? []).map((doc) => ({
          slug: doc.slug,
          name: doc.metadata.name,
        })),
        ...(agentCatalog.length > 0
          ? {
              agentCatalog: agentCatalog.map((a) => ({
                slug: a.slug,
                name: a.metadata.name,
                description: a.metadata.description,
                inputs: a.metadata.inputs,
                outputs: a.metadata.outputs,
                tags: a.metadata.tags,
              })),
            }
          : {}),
      },
      ...(isConcierge
        ? {
            routing: {
              mode: 'concierge',
              activeAgentCount: agentCatalog.length,
              instruction: 'Use the active agent capability catalog to route the user to a specialist when appropriate.',
            },
          }
        : {}),
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
  /**
   * Workspace context docs already filtered by routing for this agent. When
   * omitted, the composer asks the server for the source-of-truth filtered set.
   */
  contextDocs?: ContextDocDTO[]
  /**
   * Active agents visible to the Concierge as a structured routing catalog.
   */
  agentCatalog?: AgentDefinitionDTO[]
  /**
   * Optional draft to prefill instead of the agent's saved greeting.
   */
  draftInput?: string
}): Promise<Session> {
  const contextDocs = params.contextDocs
    ?? await window.electronAPI.listWorkspaceContextDocsForAgent(params.workspaceId, params.agent.slug)

  // Surface a one-off toast if the agent declares slugs that don't resolve in
  // this workspace. The session still spawns without them; the warning is so
  // the user knows why output may be reduced.
  if (params.skills && params.sources) {
    const resolution = resolveAgentReferences(params.agent, params.skills, params.sources)
    if (hasMissingReferences(resolution)) {
      const summary = describeMissingReferences(resolution)
      toast.warning(`${params.agent.metadata.name}: ${summary}`, {
        description: 'The session will run without those bundles. Activate them in this workspace to fix.',
      })
    }
  }

  // When live skills/sources are available, pass them through so the session
  // gets a composed system prompt (persona body + bundle footer) and any
  // missing slugs are dropped from agentSkillSlugs/enabledSourceSlugs.
  const context = params.skills && params.sources
    ? { skills: params.skills, sources: params.sources, contextDocs, agentCatalog: params.agentCatalog }
    : contextDocs.length > 0
      ? { skills: [], sources: [], contextDocs, agentCatalog: params.agentCatalog }
      : undefined

  const session = await params.onCreateSession(
    params.workspaceId,
    buildAgentCreateSessionOptions(params.agent, context),
  )
  navigate(routes.view.allSessions(session.id))

  const draft = params.draftInput?.trim() || buildAgentDraftInput(params.agent)
  if (draft) {
    setTimeout(() => params.onInputChange(session.id, draft), 100)
  }

  return session
}
