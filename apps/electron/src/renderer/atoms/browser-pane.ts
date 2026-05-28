/**
 * Browser Pane Atoms
 *
 * Jotai atoms for browser instance state in the renderer.
 * Synced from the main process via BROWSER_PANE_STATE_CHANGED IPC events.
 */

import { atom } from 'jotai'
import type { BrowserInstanceInfo } from '../../shared/types'

/** Map of all browser instances by ID */
export const browserInstancesMapAtom = atom<Map<string, BrowserInstanceInfo>>(new Map())

/** Derived: array of all browser instances (for iteration) */
export const browserInstancesAtom = atom<BrowserInstanceInfo[]>(
  (get) => Array.from(get(browserInstancesMapAtom).values())
)

/** Derived: count of active browser instances */
export const browserInstanceCountAtom = atom<number>(
  (get) => get(browserInstancesMapAtom).size
)

/**
 * Filter browser instances to those visible in the given workspace context.
 *
 * Renderers in remote-connected workspaces have TWO relevant workspace IDs:
 *
 * - `activeWorkspaceId` — the local Craft Agents window's workspace identity
 *   (used to stamp locally-opened manual tabs).
 * - `remoteWorkspaceId` — the remote server's workspace identity for the same
 *   conceptual workspace (used by the remote agent when it stamps tabs
 *   through the WS bridge). Read from `activeWorkspace.remoteServer.remoteWorkspaceId`.
 *
 * An instance is visible when:
 *   - its `workspaceId` is null/undefined (truly unbound, visible everywhere), OR
 *   - its `workspaceId` matches the local workspace, OR
 *   - its `workspaceId` matches the remote-mirror workspace.
 *
 * When both context IDs are null (no workspace resolved yet), returns the
 * unfiltered list — safe default.
 */
export function filterInstancesForWorkspace(
  all: BrowserInstanceInfo[],
  activeWorkspaceId: string | null,
  remoteWorkspaceId: string | null,
): BrowserInstanceInfo[] {
  if (!activeWorkspaceId && !remoteWorkspaceId) return all
  return all.filter(
    (i) =>
      !i.workspaceId ||
      i.workspaceId === activeWorkspaceId ||
      i.workspaceId === remoteWorkspaceId,
  )
}

/** Currently active browser instance ID (selected/focused by user interactions) */
export const activeBrowserInstanceIdAtom = atom<string | null>(null)

/** Tombstones for instances removed from renderer state (guards against late out-of-order updates) */
export const removedBrowserInstanceIdsAtom = atom<Set<string>>(new Set<string>())

/** Derived: currently active browser instance info */
export const activeBrowserInstanceAtom = atom<BrowserInstanceInfo | null>((get) => {
  const activeId = get(activeBrowserInstanceIdAtom)
  if (!activeId) return null
  return get(browserInstancesMapAtom).get(activeId) ?? null
})

/** Update a single browser instance (from IPC state change event) */
export const updateBrowserInstanceAtom = atom(
  null,
  (get, set, info: BrowserInstanceInfo) => {
    const removedIds = get(removedBrowserInstanceIdsAtom)
    if (removedIds.has(info.id)) {
      return
    }

    const map = new Map(get(browserInstancesMapAtom))
    map.set(info.id, info)
    set(browserInstancesMapAtom, map)
  }
)

/** Remove a browser instance (when destroyed) */
export const removeBrowserInstanceAtom = atom(
  null,
  (get, set, id: string) => {
    const map = new Map(get(browserInstancesMapAtom))
    map.delete(id)
    set(browserInstancesMapAtom, map)

    const removedIds = new Set(get(removedBrowserInstanceIdsAtom))
    removedIds.add(id)
    set(removedBrowserInstanceIdsAtom, removedIds)
  }
)

/** Set all browser instances at once (from list query) */
export const setBrowserInstancesAtom = atom(
  null,
  (get, set, instances: BrowserInstanceInfo[]) => {
    const map = new Map<string, BrowserInstanceInfo>()
    for (const info of instances) {
      map.set(info.id, info)
    }
    set(browserInstancesMapAtom, map)

    const removedIds = new Set(get(removedBrowserInstanceIdsAtom))
    for (const info of instances) {
      removedIds.delete(info.id)
    }
    set(removedBrowserInstanceIdsAtom, removedIds)
  }
)
