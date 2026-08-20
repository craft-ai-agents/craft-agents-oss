/**
 * SiYuan Engine Surface Atoms
 *
 * Renderer-side mirror of the main-process SiYuan surface registry
 * (main/handlers/siyuan.ts). Shape mirrors atoms/browser-pane.ts 1:1: a
 * map atom keyed by instanceId, a derived array for iteration, tombstones
 * guarding against late out-of-order events, setter atoms for IPC pushes,
 * and a workspace filter with the same null-passes convention.
 */

import { atom } from 'jotai'
import type { ElectronAPI, SiyuanSurfaceState } from '../../shared/types'

/** Map of all SiYuan surfaces by instance ID */
export const siyuanInstancesMapAtom = atom<Map<string, SiyuanSurfaceState>>(new Map())

/** Derived: array of all SiYuan surfaces (for iteration) */
export const siyuanInstancesAtom = atom<SiyuanSurfaceState[]>(
  (get) => Array.from(get(siyuanInstancesMapAtom).values())
)

/** Tombstones for surfaces removed from renderer state (guards against late out-of-order updates) */
export const removedSiyuanInstanceIdsAtom = atom<Set<string>>(new Set<string>())

/**
 * Filter SiYuan surfaces to those visible in the given workspace context.
 * Surfaces with `workspaceId: null` are unbound and pass every filter —
 * same convention as filterInstancesForWorkspace for browser instances.
 */
export function filterSiyuanForWorkspace(
  all: SiyuanSurfaceState[],
  activeWorkspaceId: string | null,
): SiyuanSurfaceState[] {
  return all.filter(
    (surface) => surface.workspaceId == null || surface.workspaceId === activeWorkspaceId
  )
}

/** Update a single surface (from IPC state change event) */
export const updateSiyuanInstanceAtom = atom(
  null,
  (get, set, state: SiyuanSurfaceState) => {
    if (get(removedSiyuanInstanceIdsAtom).has(state.instanceId)) {
      return
    }
    const map = new Map(get(siyuanInstancesMapAtom))
    map.set(state.instanceId, state)
    set(siyuanInstancesMapAtom, map)
  }
)

/** Remove a surface (when destroyed) */
export const removeSiyuanInstanceAtom = atom(
  null,
  (get, set, id: string) => {
    const map = new Map(get(siyuanInstancesMapAtom))
    map.delete(id)
    set(siyuanInstancesMapAtom, map)

    const removedIds = new Set(get(removedSiyuanInstanceIdsAtom))
    removedIds.add(id)
    set(removedSiyuanInstanceIdsAtom, removedIds)
  }
)

/** Set all surfaces at once (from list query) */
export const setSiyuanInstancesAtom = atom(
  null,
  (get, set, instances: SiyuanSurfaceState[]) => {
    const map = new Map<string, SiyuanSurfaceState>()
    for (const state of instances) {
      map.set(state.instanceId, state)
    }
    set(siyuanInstancesMapAtom, map)

    const removedIds = new Set(get(removedSiyuanInstanceIdsAtom))
    for (const state of instances) {
      removedIds.delete(state.instanceId)
    }
    set(removedSiyuanInstanceIdsAtom, removedIds)
  }
)

type SiyuanEngineApi = Pick<ElectronAPI['siyuanEngine'], 'list' | 'onStateChanged' | 'onRemoved'>

/**
 * Store surface consumed by wireSiyuanEngineEvents. Structurally satisfied by
 * the jotai store returned by createStore()/useStore() — kept as a named
 * local contract so this module doesn't couple to jotai's internals.
 */
export interface SiyuanSurfaceStore {
  set(atom: typeof setSiyuanInstancesAtom, value: SiyuanSurfaceState[]): void
  set(atom: typeof updateSiyuanInstanceAtom, value: SiyuanSurfaceState): void
  set(atom: typeof removeSiyuanInstanceAtom, value: string): void
}

/**
 * Event subscription wiring (mirrors the browser-pane wiring in
 * BrowserTabStrip): seed from LIST for restore, then mirror STATE_CHANGED /
 * REMOVED pushes into the atoms. Returns one unsubscribe for all three.
 * Store + API are injected so this module stays free of window globals and
 * jotai default-store coupling — safe to unit-test with createStore().
 */
export function wireSiyuanEngineEvents(store: SiyuanSurfaceStore, api: SiyuanEngineApi): () => void {
  void api
    .list()
    .then((instances) => store.set(setSiyuanInstancesAtom, instances))
    .catch(() => {})

  const cleanupState = api.onStateChanged((state) => {
    store.set(updateSiyuanInstanceAtom, state)
  })
  const cleanupRemoved = api.onRemoved((id) => {
    store.set(removeSiyuanInstanceAtom, id)
  })

  return () => {
    cleanupState()
    cleanupRemoved()
  }
}
