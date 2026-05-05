/**
 * RPC handlers for the workflows library.
 *
 * Mirrors `agent-definitions.ts` — workflows are global with per-workspace
 * activation manifests.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  loadAllGlobalWorkflows,
  loadGlobalWorkflow,
  readActivatedWorkflows,
  setWorkflowActive,
  writeGlobalWorkflow,
  deleteGlobalWorkflow,
  type CreateWorkflowInput,
  type LoadedWorkflow,
} from '@craft-agent/shared/workflows'
import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let libraryMutex: Promise<void> = Promise.resolve()
function withLibraryMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = libraryMutex.then(fn, fn)
  libraryMutex = next.then(() => {}, () => {})
  return next
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workflows.LIST_ALL,
  RPC_CHANNELS.workflows.LIST_ACTIVE_IN_WORKSPACE,
  RPC_CHANNELS.workflows.GET,
  RPC_CHANNELS.workflows.UPSERT,
  RPC_CHANNELS.workflows.DELETE,
  RPC_CHANNELS.workflows.SET_ACTIVE,
] as const

export interface UpsertWorkflowPayload {
  slug: string
  metadata: CreateWorkflowInput['metadata']
  body: string
  /** When set, the new/updated workflow is auto-activated in this workspace. */
  activateInWorkspaceId?: string
}

function broadcastChanged(deps: HandlerDeps, workspaceId: string | null, workflows: LoadedWorkflow[]): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.workflows.CHANGED, { to: 'all' }, workspaceId, workflows)
}

export function registerWorkflowsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.workflows.LIST_ALL, async (): Promise<LoadedWorkflow[]> => {
    return loadAllGlobalWorkflows()
  })

  server.handle(RPC_CHANNELS.workflows.LIST_ACTIVE_IN_WORKSPACE, async (_ctx, workspaceId: string): Promise<string[]> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return []
    return readActivatedWorkflows(workspace.rootPath).active
  })

  server.handle(RPC_CHANNELS.workflows.GET, async (_ctx, slug: string): Promise<LoadedWorkflow | null> => {
    return loadGlobalWorkflow(slug)
  })

  server.handle(RPC_CHANNELS.workflows.UPSERT, async (_ctx, payload: UpsertWorkflowPayload): Promise<LoadedWorkflow> => {
    return withLibraryMutex(async () => {
      const activationWorkspace = payload.activateInWorkspaceId
        ? getWorkspaceByNameOrId(payload.activateInWorkspaceId)
        : null
      if (payload.activateInWorkspaceId && !activationWorkspace) {
        throw new Error(`Workspace not found: ${payload.activateInWorkspaceId}`)
      }

      const loaded = writeGlobalWorkflow({
        slug: payload.slug,
        metadata: payload.metadata,
        body: payload.body,
      })

      if (activationWorkspace) {
        setWorkflowActive(activationWorkspace.rootPath, payload.slug, true)
      }

      broadcastChanged(deps, payload.activateInWorkspaceId ?? null, loadAllGlobalWorkflows())
      return loaded
    })
  })

  server.handle(RPC_CHANNELS.workflows.DELETE, async (_ctx, slug: string): Promise<boolean> => {
    return withLibraryMutex(async () => {
      const workspaces = getWorkspaces()
      const ok = deleteGlobalWorkflow(slug, workspaces.map((w) => w.rootPath))
      if (ok) broadcastChanged(deps, null, loadAllGlobalWorkflows())
      return ok
    })
  })

  server.handle(RPC_CHANNELS.workflows.SET_ACTIVE, async (_ctx, workspaceId: string, slug: string, active: boolean): Promise<{ active: string[] }> => {
    return withLibraryMutex(async () => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      if (active && !loadGlobalWorkflow(slug)) {
        throw new Error(`Workflow not found: ${slug}`)
      }
      const manifest = setWorkflowActive(workspace.rootPath, slug, active)
      broadcastChanged(deps, workspaceId, loadAllGlobalWorkflows())
      return { active: manifest.active }
    })
  })
}
