import { IPC_CHANNELS } from '../../shared/types'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'

export const HANDLED_CHANNELS = [
  IPC_CHANNELS.labels.LIST,
  IPC_CHANNELS.labels.CREATE,
  IPC_CHANNELS.labels.DELETE,
] as const

export function registerLabelsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // List all labels for a workspace
  server.handle(IPC_CHANNELS.labels.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listLabels } = await import('@craft-agent/shared/labels/storage')
    return listLabels(workspace.rootPath)
  })

  // Create a new label in a workspace
  server.handle(IPC_CHANNELS.labels.CREATE, async (_ctx, workspaceId: string, input: import('@craft-agent/shared/labels').CreateLabelInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createLabel } = await import('@craft-agent/shared/labels/crud')
    const label = createLabel(workspace.rootPath, input)
    pushTyped(server, IPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return label
  })

  // Delete a label (and descendants) from a workspace
  server.handle(IPC_CHANNELS.labels.DELETE, async (_ctx, workspaceId: string, labelId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteLabel } = await import('@craft-agent/shared/labels/crud')
    const result = deleteLabel(workspace.rootPath, labelId)
    pushTyped(server, IPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return result
  })
}
