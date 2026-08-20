/**
 * SiYuan engine surface handlers (P2 native knowledge mode).
 *
 * Thin registry over BrowserPaneManager: embedded SiYuan desktop surfaces are
 * keyed by a durable document key (`siyuan:{kind}:{id}:{mode}`), so re-opening a doc
 * dedupifies onto the existing surface and renderers restore survivors across
 * restarts via LIST. This supersedes the ephemeral `browser-embedded-${n}`
 * id as the knowledge-surface handle — the durable key is the stable contract.
 *
 * Delegation shape mirrors handlers/browser.ts 1:1 (create-embedded /
 * sync-bounds / destroy / list / focus forwards, broadcastToAll push
 * semantics). All channels are LOCAL_ONLY (routing.ts): surface lifecycle
 * drives local Electron BrowserViews and is never proxied.
 *
 * REMOVED is broadcast from DESTROY itself, not from a BrowserPaneManager
 * onRemoved subscription: browser-pane-manager exposes onRemoved as a
 * single-slot setter, and stealing the slot here would clobber the browser
 * domain's own REMOVED broadcast. External teardown (app quit) takes the
 * whole registry with it anyway.
 */

import { RPC_CHANNELS, type SiyuanSurfaceState } from '../../shared/types'
import type { EmbeddedBoundsRect } from '../browser-pane-manager'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import { bumpKnowledgeMetric } from '@craft-agent/server-core/knowledge'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { HandlerDeps } from './handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.siyuan.CREATE_EMBEDDED,
  RPC_CHANNELS.siyuan.DESTROY,
  RPC_CHANNELS.siyuan.LIST,
  RPC_CHANNELS.siyuan.SYNC_BOUNDS,
  RPC_CHANNELS.siyuan.FOCUS,
  RPC_CHANNELS.siyuan.EVALUATE,
] as const

/** Registry record: wire state plus the last bounds reported by the renderer. */
interface SiyuanSurfaceRecord extends SiyuanSurfaceState {
  rect: EmbeddedBoundsRect | null
  /**
   * Holder refcount (P1-8): every createEmbedded call — including a dedup
   * re-open onto an existing surface — takes one owner slot; DESTROY releases
   * one slot. The native BrowserView is torn down only when the LAST owner
   * releases, so concurrent holders (two panels, two windows, panel + compat
   * view) never lose their surface to a sibling's destroy.
   */
  owners: number
}

/**
 * In-memory durableKey → surface registry. Deliberately process-local: the
 * BrowserViews it tracks die with the app, so there is nothing durable to
 * persist — renderers re-issue createEmbedded on restore (LIST exposes live
 * state for that).
 */
export class SiyuanSurfaceManager {
  private readonly byDurableKey = new Map<string, SiyuanSurfaceRecord>()

  get(durableKey: string): SiyuanSurfaceRecord | undefined {
    return this.byDurableKey.get(durableKey)
  }

  getByInstanceId(instanceId: string): SiyuanSurfaceRecord | undefined {
    for (const record of this.byDurableKey.values()) {
      if (record.instanceId === instanceId) return record
    }
    return undefined
  }

  register(record: SiyuanSurfaceRecord): void {
    this.byDurableKey.set(record.durableKey, record)
  }

  remove(instanceId: string): SiyuanSurfaceRecord | undefined {
    for (const [durableKey, record] of this.byDurableKey) {
      if (record.instanceId === instanceId) {
        this.byDurableKey.delete(durableKey)
        return record
      }
    }
    return undefined
  }

  setBounds(instanceId: string, rect: EmbeddedBoundsRect | null): SiyuanSurfaceRecord | undefined {
    for (const record of this.byDurableKey.values()) {
      if (record.instanceId === instanceId) {
        record.rect = rect
        return record
      }
    }
    return undefined
  }

  /**
   * Wire-state list, optionally workspace-scoped. Surfaces bound to no
   * workspace (`null`) pass every filter — same convention as
   * BrowserInstanceInfo.workspaceId.
   */
  list(workspaceId?: string | null): SiyuanSurfaceState[] {
    const states: SiyuanSurfaceState[] = []
    for (const record of this.byDurableKey.values()) {
      if (workspaceId == null || record.workspaceId == null || record.workspaceId === workspaceId) {
        states.push(toState(record))
      }
    }
    return states
  }
}

function toState(record: SiyuanSurfaceRecord): SiyuanSurfaceState {
  return {
    instanceId: record.instanceId,
    durableKey: record.durableKey,
    url: record.url,
    workspaceId: record.workspaceId,
  }
}

export interface SiyuanCreateEmbeddedInput {
  durableKey: string
  url: string
  workspaceId?: string | null
}

export interface SiyuanInstanceInput {
  instanceId: string
}

export interface SiyuanListInput {
  workspaceId?: string | null
}

export interface SiyuanSyncBoundsInput extends SiyuanInstanceInput {
  rect: EmbeddedBoundsRect | null
}

export interface SiyuanEvaluateInput extends SiyuanInstanceInput {
  expression: string
}

export function registerSiyuanHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { browserPaneManager } = deps
  if (!browserPaneManager) return

  const surfaces = new SiyuanSurfaceManager()

  server.handle(RPC_CHANNELS.siyuan.CREATE_EMBEDDED, (_ctx, input: SiyuanCreateEmbeddedInput): string => {
    const existing = surfaces.get(input.durableKey)
    if (existing) {
      // Dedup: the document already has a live surface — focus it instead of
      // compositing a second BrowserView for the same durable key. Re-broadcast
      // the state so renderers that missed the original push (e.g. a second
      // window) still receive the full surface record.
      existing.owners += 1
      // P2-11: refresh the workspace binding on re-open. A controller may
      // reopen the same document from a different workspace context; the
      // latest opener's binding wins so workspace-scoped LIST stays accurate.
      if (input.workspaceId !== undefined) {
        existing.workspaceId = input.workspaceId ?? null
      }
      // Mode/URL may change on re-open (editor→graph, different craftSurface).
      // Navigate the live instance when the URL differs so the surface reflects
      // the latest presentation without spawning a second BrowserView.
      // Commit existing.url only after navigate settles — a failed navigate must
      // not poison the registry (retry with the same nextUrl must re-attempt).
      if (input.url && input.url !== existing.url) {
        const nextUrl = input.url
        const instanceId = existing.instanceId
        void browserPaneManager.navigate(instanceId, nextUrl).then(
          () => {
            const live = surfaces.get(input.durableKey)
            if (!live || live.instanceId !== instanceId) return
            // Skip if a newer successful navigate already moved past nextUrl.
            if (live.url === nextUrl) return
            live.url = nextUrl
            pushTyped(server, RPC_CHANNELS.siyuan.STATE_CHANGED, { to: 'all' }, toState(live))
          },
          (error: unknown) => {
            console.warn(
              `[siyuan] re-open navigate failed id=${instanceId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          },
        )
      }
      browserPaneManager.focus(existing.instanceId)
      pushTyped(server, RPC_CHANNELS.siyuan.STATE_CHANGED, { to: 'all' }, toState(existing))
      return existing.instanceId
    }

    const instanceId = browserPaneManager.createEmbeddedInstance({
      url: input.url,
      workspaceId: input.workspaceId ?? null,
    })
    const record: SiyuanSurfaceRecord = {
      instanceId,
      durableKey: input.durableKey,
      url: input.url,
      workspaceId: input.workspaceId ?? null,
      rect: null,
      owners: 1,
    }
    surfaces.register(record)
    pushTyped(server, RPC_CHANNELS.siyuan.STATE_CHANGED, { to: 'all' }, toState(record))
    // G1: count first open of a durable knowledge surface (dedup re-opens skip).
    try {
      const wsId = input.workspaceId
      if (typeof wsId === 'string' && wsId.length > 0) {
        const ws = getWorkspaceByNameOrId(wsId)
        if (ws?.rootPath) bumpKnowledgeMetric(ws.rootPath, 'knowledgeSurfaceOpens')
      }
    } catch {
      /* metrics must never break surface open */
    }
    return instanceId
  })

  server.handle(RPC_CHANNELS.siyuan.DESTROY, (_ctx, input: SiyuanInstanceInput) => {
    const record = surfaces.getByInstanceId(input.instanceId)
    if (record && record.owners > 1) {
      // Shared durable surface: release only this owner's slot. The native
      // instance and the REMOVED broadcast wait for the LAST owner, so the
      // remaining holders' surfaces are untouched.
      record.owners -= 1
      return
    }
    browserPaneManager.destroyInstance(input.instanceId)
    const removed = surfaces.remove(input.instanceId)
    if (removed) {
      pushTyped(server, RPC_CHANNELS.siyuan.REMOVED, { to: 'all' }, removed.instanceId)
    }
  })

  server.handle(RPC_CHANNELS.siyuan.LIST, (_ctx, input?: SiyuanListInput) => {
    return surfaces.list(input?.workspaceId)
  })

  server.handle(RPC_CHANNELS.siyuan.SYNC_BOUNDS, (_ctx, input: SiyuanSyncBoundsInput) => {
    browserPaneManager.syncEmbeddedBounds(input.instanceId, input.rect)
    surfaces.setBounds(input.instanceId, input.rect)
  })

  server.handle(RPC_CHANNELS.siyuan.FOCUS, (_ctx, input: SiyuanInstanceInput) => {
    // BrowserPaneManager.focus is a no-op for embedded instances (no OS
    // window); visibility is renderer-driven via syncBounds rects. The
    // forward is kept for contract completeness with the browserPane shape.
    browserPaneManager.focus(input.instanceId)
  })

  server.handle(RPC_CHANNELS.siyuan.EVALUATE, async (_ctx, input: SiyuanEvaluateInput) => {
    // LOCAL_ONLY JS eval against the embedded SiYuan WebContentsView —
    // used by the surface host to open docks / switch craftSurface modes.
    // Refuse unknown instanceIds so callers cannot eval into arbitrary browser panes.
    if (!surfaces.getByInstanceId(input.instanceId)) {
      throw new Error(`Unknown SiYuan surface: ${input.instanceId}`)
    }
    return browserPaneManager.evaluate(input.instanceId, input.expression)
  })
}
