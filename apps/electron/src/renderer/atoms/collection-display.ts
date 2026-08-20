/**
 * Workspace-scoped CollectionDisplay atom + load/persist helpers.
 *
 * Display prefs live in `{workspace}/collection/display.json` via RPC
 * (getCollectionDisplay / setCollectionDisplay / onCollectionDisplayChanged).
 * Filters stay local to the host (list/table) for B2; full viewFilters
 * migration lands later.
 */

import { atom } from 'jotai'
import { DEFAULT_COLLECTION_DISPLAY,
type CollectionDisplay, } from '@craft-agent/shared/sessions/collection'
import { windowWorkspaceIdAtom } from './sessions'

function cloneDisplay(display: CollectionDisplay = DEFAULT_COLLECTION_DISPLAY): CollectionDisplay {
  return {
    ...display,
    visibleProperties: [...display.visibleProperties],
  }
}

/** Current workspace CollectionDisplay (defaults until loaded). */
export const collectionDisplayAtom = atom<CollectionDisplay>(cloneDisplay())

/** True while a workspace display load is in flight. */
export const collectionDisplayLoadingAtom = atom(false)

const collectionDisplayUpdateChains = new Map<string, Promise<void>>()
const collectionDisplayUpdateVersions = new Map<string, number>()

/**
 * Replace local display state. Prefer `setCollectionDisplayAtom` when the
 * change should persist to the workspace file.
 */
export const replaceCollectionDisplayAtom = atom(
  null,
  (_get, set, display: CollectionDisplay) => {
    set(collectionDisplayAtom, cloneDisplay(display))
  },
)

export type SetCollectionDisplayInput = {
  display: Partial<CollectionDisplay> | CollectionDisplay
  /** Override active workspace (defaults to windowWorkspaceIdAtom). */
  workspaceId?: string | null
}

/**
 * Optimistically update local display and persist via RPC.
 * Returns the normalized server payload when save succeeds.
 */
export const setCollectionDisplayAtom = atom(
  null,
  async (
    get,
    set,
    input: Partial<CollectionDisplay> | CollectionDisplay | SetCollectionDisplayInput,
  ): Promise<CollectionDisplay> => {
    const patch =
      input && typeof input === 'object' && 'display' in input
        ? (input as SetCollectionDisplayInput).display
        : (input as Partial<CollectionDisplay> | CollectionDisplay)
    const workspaceId =
      input && typeof input === 'object' && 'display' in input
        ? ((input as SetCollectionDisplayInput).workspaceId ?? get(windowWorkspaceIdAtom))
        : get(windowWorkspaceIdAtom)

    const prev = get(collectionDisplayAtom)
    const next: CollectionDisplay = {
      ...prev,
      ...patch,
      version: 1,
      visibleProperties: patch.visibleProperties
        ? [...patch.visibleProperties]
        : [...prev.visibleProperties],
    }
    set(collectionDisplayAtom, next)

    if (!workspaceId || typeof window === 'undefined' || !window.electronAPI?.setCollectionDisplay) {
      return next
    }

    const version = (collectionDisplayUpdateVersions.get(workspaceId) ?? 0) + 1
    collectionDisplayUpdateVersions.set(workspaceId, version)
    const previousUpdate = collectionDisplayUpdateChains.get(workspaceId) ?? Promise.resolve()
    const update = previousUpdate.catch(() => undefined).then(async () => {
      try {
        const saved = await window.electronAPI.setCollectionDisplay(workspaceId, next)
        const activeWorkspaceId = get(windowWorkspaceIdAtom)
        if (
          collectionDisplayUpdateVersions.get(workspaceId) === version &&
          (activeWorkspaceId == null || activeWorkspaceId === workspaceId)
        ) {
          set(collectionDisplayAtom, cloneDisplay(saved))
        }
        return saved
      } catch (err) {
        // Keep optimistic value; caller may toast. Reload on next workspace tick.
        console.warn('[collection-display] setCollectionDisplay failed', err)
        return next
      }
    })
    collectionDisplayUpdateChains.set(workspaceId, update.then(() => undefined))
    return update
  },
)

/**
 * Load display for a workspace id (or active window workspace).
 * Applies result when the requested id is still the active one.
 */
export const loadCollectionDisplayAtom = atom(
  null,
  async (get, set, workspaceId?: string | null): Promise<CollectionDisplay> => {
    const id = workspaceId === undefined ? get(windowWorkspaceIdAtom) : workspaceId
    if (!id || typeof window === 'undefined' || !window.electronAPI?.getCollectionDisplay) {
      const fallback = cloneDisplay()
      set(collectionDisplayAtom, fallback)
      set(collectionDisplayLoadingAtom, false)
      return fallback
    }

    set(collectionDisplayLoadingAtom, true)
    try {
      const loaded = await window.electronAPI.getCollectionDisplay(id)
      // Drop stale responses after a workspace switch.
      const active = get(windowWorkspaceIdAtom)
      if (active != null && active !== id) {
        return get(collectionDisplayAtom)
      }
      const next = cloneDisplay(loaded)
      set(collectionDisplayAtom, next)
      return next
    } catch (err) {
      console.warn('[collection-display] getCollectionDisplay failed', err)
      const active = get(windowWorkspaceIdAtom)
      if (active != null && active !== id) {
        return get(collectionDisplayAtom)
      }
      const fallback = cloneDisplay()
      set(collectionDisplayAtom, fallback)
      return fallback
    } finally {
      const active = get(windowWorkspaceIdAtom)
      if (active == null || active === id) {
        set(collectionDisplayLoadingAtom, false)
      }
    }
  },
)
