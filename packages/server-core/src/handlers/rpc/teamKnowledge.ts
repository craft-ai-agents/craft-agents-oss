import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { TeamContextPreview } from '@craft-agent/shared/protocol/dto'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.teamKnowledge.GET_CONFIG,
  RPC_CHANNELS.teamKnowledge.UPDATE_CONFIG,
  RPC_CHANNELS.teamKnowledge.REFRESH,
  RPC_CHANNELS.teamKnowledge.GET_PREVIEW,
] as const

export function registerTeamKnowledgeHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // Get the current team knowledge config for a workspace
  server.handle(RPC_CHANNELS.teamKnowledge.GET_CONFIG, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { loadTeamKnowledgeConfig } = await import('@craft-agent/shared/teamKnowledge/storage')
    return loadTeamKnowledgeConfig(workspace.rootPath)
  })

  // Update the team knowledge config (full overwrite)
  server.handle(RPC_CHANNELS.teamKnowledge.UPDATE_CONFIG, async (
    _ctx,
    workspaceId: string,
    config: import('@craft-agent/shared/teamKnowledge/types').TeamKnowledgeConfig,
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { saveTeamKnowledgeConfig } = await import('@craft-agent/shared/teamKnowledge/storage')
    saveTeamKnowledgeConfig(workspace.rootPath, config)
    pushTyped(server, RPC_CHANNELS.teamKnowledge.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  })

  // Trigger an immediate refresh of all configured docs
  server.handle(RPC_CHANNELS.teamKnowledge.REFRESH, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { refreshTeamKnowledge } = await import('@craft-agent/shared/teamKnowledge/refresh')
    const summary = await refreshTeamKnowledge(workspace.rootPath)
    pushTyped(server, RPC_CHANNELS.teamKnowledge.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return summary
  })

  // Get team context preview for debug/preview surface
  server.handle(RPC_CHANNELS.teamKnowledge.GET_PREVIEW, async (
    _ctx,
    workspaceId: string,
    sampleMessage?: string,
  ): Promise<TeamContextPreview> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { loadWorkspaceConfig } = await import('@craft-agent/shared/workspaces/storage')
    const config = loadWorkspaceConfig(workspace.rootPath)
    const enabled = config?.teamPublicKnowledge?.enabled ?? false

    const { loadTeamPublicKnowledgeCache } = await import('@craft-agent/shared/team-public-knowledge/index')
    const cache = loadTeamPublicKnowledgeCache(workspace.rootPath)
    const entries = Object.values(cache.entries)
    const documentsCount = entries.length

    if (!enabled || documentsCount === 0) {
      return { enabled, documentsCount, triggerTerms: [] }
    }

    const {
      formatTeamKnowledgePolicy,
      prefetchTeamKnowledge,
      formatPrefetchBlock,
    } = await import('@craft-agent/shared/agent/core/team-public-knowledge-injector')

    const policyXml = formatTeamKnowledgePolicy(workspace.rootPath)

    // Extract trigger terms from the policy XML
    const triggerTerms: import('@craft-agent/shared/protocol/dto').TeamContextPreviewTriggerTerm[] = []
    if (policyXml) {
      const termRegex = /^\d+\.\s+"([^"]+)"\s+\((\w+)\)/gm
      let match
      while ((match = termRegex.exec(policyXml)) !== null) {
        triggerTerms.push({ term: match[1], kind: match[2], priority: 0 })
      }
    }

    // Compute prefetch preview if a sample message was provided
    let prefetchResults
    if (sampleMessage) {
      const results = prefetchTeamKnowledge(workspace.rootPath, sampleMessage)
      if (results.length > 0) {
        prefetchResults = results.map(r => ({
          term: r.relevance === 'exact match' ? sampleMessage : sampleMessage,
          kind: r.kind,
          summary: r.summary,
          excerpt: r.excerpt,
          confidence: r.confidence,
          relevance: r.relevance,
          source: r.source,
          updatedAt: r.updatedAt,
        }))
      }
    }

    return {
      enabled,
      documentsCount,
      policyXml: policyXml ?? undefined,
      triggerTerms,
      prefetchResults,
    }
  })
}
