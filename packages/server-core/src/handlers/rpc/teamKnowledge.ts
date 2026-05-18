import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.teamKnowledge.GET_CONFIG,
  RPC_CHANNELS.teamKnowledge.UPDATE_CONFIG,
  RPC_CHANNELS.teamKnowledge.REFRESH,
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
}
