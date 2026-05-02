/**
 * RPC handlers for the agent definitions library.
 *
 * Endpoints:
 *   - listAll                     → every agent in the global library
 *   - listActiveInWorkspace(ws)   → slugs activated in workspace `ws`
 *   - get(slug)                   → load a single agent
 *   - upsert({ slug, metadata, systemPrompt, activateInWorkspaceId? })
 *                                 → create-or-overwrite, optionally auto-activate
 *   - delete(slug)                → remove from library + every workspace's manifest
 *   - setActive(workspaceId, slug, active) → toggle activation in a workspace
 *
 * All handlers serialize through a per-library mutex so concurrent UI
 * actions never clobber each other on disk.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  loadAllGlobalAgents,
  loadGlobalAgent,
  readActivatedAgents,
  setAgentActive,
  writeActivatedAgents,
  writeGlobalAgent,
  deleteGlobalAgent,
  type CreateAgentInput,
  type LoadedAgent,
} from '@craft-agent/shared/agent-definitions'
import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

/**
 * Single mutex for the whole global library. The library is a small set of
 * directories; the contention surface is tiny. A single lock is the right
 * trade-off vs. per-slug locks (which would race on the activation manifests
 * anyway).
 */
let libraryMutex: Promise<void> = Promise.resolve()
export function withAgentDefinitionsLibraryMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = libraryMutex.then(fn, fn)
  libraryMutex = next.then(() => {}, () => {})
  return next
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.agentDefinitions.LIST_ALL,
  RPC_CHANNELS.agentDefinitions.LIST_ACTIVE_IN_WORKSPACE,
  RPC_CHANNELS.agentDefinitions.GET,
  RPC_CHANNELS.agentDefinitions.UPSERT,
  RPC_CHANNELS.agentDefinitions.DELETE,
  RPC_CHANNELS.agentDefinitions.SET_ACTIVE,
] as const

export interface UpsertAgentPayload {
  slug: string
  metadata: CreateAgentInput['metadata']
  systemPrompt: string
  /** When set, the new/updated agent is auto-activated in this workspace. */
  activateInWorkspaceId?: string
}

export function broadcastAgentDefinitionsChanged(deps: HandlerDeps, workspaceId: string | null): void {
  // Use the standard push channel — the renderer's useAgents hook listens
  // on it and re-fetches both the library and per-workspace active list.
  // We push without a narrowing target so every connected client refreshes.
  // Hosts that don't expose a broadcaster are tolerated silently.
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.agentDefinitions.CHANGED, { to: 'all' }, workspaceId)
}

export function registerAgentDefinitionsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // -------------------------------------------------------------------------
  // Reads (no mutex needed; storage layer is read-only safe)
  // -------------------------------------------------------------------------

  server.handle(RPC_CHANNELS.agentDefinitions.LIST_ALL, async (): Promise<LoadedAgent[]> => {
    return loadAllGlobalAgents()
  })

  server.handle(RPC_CHANNELS.agentDefinitions.LIST_ACTIVE_IN_WORKSPACE, async (_ctx, workspaceId: string): Promise<string[]> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return []
    return readActivatedAgents(workspace.rootPath).active
  })

  server.handle(RPC_CHANNELS.agentDefinitions.GET, async (_ctx, slug: string): Promise<LoadedAgent | null> => {
    return loadGlobalAgent(slug)
  })

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  server.handle(RPC_CHANNELS.agentDefinitions.UPSERT, async (_ctx, payload: UpsertAgentPayload): Promise<LoadedAgent> => {
    return withAgentDefinitionsLibraryMutex(async () => {
      const loaded = writeGlobalAgent({
        slug: payload.slug,
        metadata: payload.metadata,
        systemPrompt: payload.systemPrompt,
      })

      // Auto-activate in the originating workspace by default.
      if (payload.activateInWorkspaceId) {
        const workspace = getWorkspaceByNameOrId(payload.activateInWorkspaceId)
        if (workspace) {
          try {
            setAgentActive(workspace.rootPath, payload.slug, true)
          } catch (err) {
            log.warn(`[agent-definitions] Failed to auto-activate "${payload.slug}" in workspace ${payload.activateInWorkspaceId}:`, err as Error)
          }
        }
      }

      broadcastAgentDefinitionsChanged(deps, payload.activateInWorkspaceId ?? null)
      return loaded
    })
  })

  server.handle(RPC_CHANNELS.agentDefinitions.DELETE, async (_ctx, slug: string): Promise<boolean> => {
    return withAgentDefinitionsLibraryMutex(async () => {
      // Build the workspace list once — deleteGlobalAgent updates each one's
      // activation manifest in place.
      const workspaces = getWorkspaces()
      const ok = deleteGlobalAgent(slug, workspaces.map((w) => w.rootPath))
      if (ok) broadcastAgentDefinitionsChanged(deps, null)
      return ok
    })
  })

  server.handle(RPC_CHANNELS.agentDefinitions.SET_ACTIVE, async (_ctx, workspaceId: string, slug: string, active: boolean): Promise<{ active: string[] }> => {
    return withAgentDefinitionsLibraryMutex(async () => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      const manifest = setAgentActive(workspace.rootPath, slug, active)
      broadcastAgentDefinitionsChanged(deps, workspaceId)
      return { active: manifest.active }
    })
  })
}

// Convenience: idempotent activate-many used by seed-on-first-run.
export async function bulkSetActive(workspaceId: string, slugs: string[]): Promise<void> {
  await withAgentDefinitionsLibraryMutex(async () => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return
    const current = new Set(readActivatedAgents(workspace.rootPath).active)
    for (const s of slugs) current.add(s)
    writeActivatedAgents(workspace.rootPath, [...current])
  })
}
