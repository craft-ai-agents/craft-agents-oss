import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  loadCollectionDisplay,
  saveCollectionDisplay,
  type CollectionDisplay,
} from '@craft-agent/shared/sessions'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.collection.GET_DISPLAY,
  RPC_CHANNELS.collection.SET_DISPLAY,
] as const

export function registerCollectionHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.collection.GET_DISPLAY, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return loadCollectionDisplay(workspace.rootPath)
  })

  server.handle(
    RPC_CHANNELS.collection.SET_DISPLAY,
    async (_ctx, workspaceId: string, display: CollectionDisplay) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      const saved = saveCollectionDisplay(workspace.rootPath, display)
      pushTyped(
        server,
        RPC_CHANNELS.collection.CHANGED,
        { to: 'workspace', workspaceId },
        workspaceId,
        saved,
      )
      log.info(`Collection display saved for workspace ${workspaceId}`)
      return saved
    },
  )
}
