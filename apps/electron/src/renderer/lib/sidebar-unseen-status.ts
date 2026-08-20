/**
 * Per-workspace map of session-status ids with an unseen accent dot in the
 * sidebar. Set when a session moves into a status bucket the user has not
 * opened yet; cleared when the user opens that status filter.
 *
 * Storage key: `craft-sidebar-unseen-status:{workspaceId}` → Record<statusId, true>
 */

import { get, set, KEYS } from './local-storage'

export type UnseenStatusMap = Record<string, true>

const EVENT = 'craft:sidebar-unseen-status-changed'

/** Read the unseen status map for a workspace. */
export function getUnseenStatuses(workspaceId: string): UnseenStatusMap {
  return get<UnseenStatusMap>(KEYS.sidebarUnseenStatus, {}, workspaceId)
}

/**
 * Mark a status bucket as unseen (e.g. after a session lands there).
 * No-op when statusId is empty or already marked.
 */
export function markStatusUnseen(workspaceId: string, statusId: string): void {
  if (!workspaceId || !statusId) return
  const map = getUnseenStatuses(workspaceId)
  if (map[statusId]) return
  set(KEYS.sidebarUnseenStatus, { ...map, [statusId]: true as const }, workspaceId)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { workspaceId } }))
}

/**
 * Clear the unseen bit when the user opens that status filter.
 */
export function clearStatusUnseen(workspaceId: string, statusId: string): void {
  if (!workspaceId || !statusId) return
  const map = getUnseenStatuses(workspaceId)
  if (!map[statusId]) return
  const next = { ...map }
  delete next[statusId]
  set(KEYS.sidebarUnseenStatus, next, workspaceId)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { workspaceId } }))
}

/** Replace the entire map (tests / bulk clear). */
export function setUnseenStatuses(workspaceId: string, map: UnseenStatusMap): void {
  set(KEYS.sidebarUnseenStatus, map, workspaceId)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { workspaceId } }))
}

/**
 * Subscribe to unseen-map changes for a workspace. Returns an unsubscribe fn.
 * Also listens to the native `storage` event so multi-window stays in sync.
 */
export function subscribeUnseenStatuses(
  workspaceId: string,
  listener: (map: UnseenStatusMap) => void
): () => void {
  const onCustom = (e: Event) => {
    const detail = (e as CustomEvent<{ workspaceId?: string }>).detail
    if (detail?.workspaceId && detail.workspaceId !== workspaceId) return
    listener(getUnseenStatuses(workspaceId))
  }
  const storageKey = `craft-${KEYS.sidebarUnseenStatus}:${workspaceId}`
  const onStorage = (e: StorageEvent) => {
    if (e.key !== storageKey) return
    listener(getUnseenStatuses(workspaceId))
  }
  window.addEventListener(EVENT, onCustom)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, onCustom)
    window.removeEventListener('storage', onStorage)
  }
}
