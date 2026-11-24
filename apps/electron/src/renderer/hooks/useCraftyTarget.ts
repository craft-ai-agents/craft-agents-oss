/**
 * Crafty's target in Craft's windows: the session its questions land in ("Send Crafty Here"). One
 * store per window, fed by `crafty:targetChanged` from main, shared by the session menus and the
 * composer's Crafty chip. Crafty is macOS desktop only: elsewhere (and in the Web UI, which has no
 * `electronAPI.crafty`) it stays unavailable and every caller renders nothing.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { CraftyTargetRef } from '../../shared/crafty'

export interface CraftyTargetSnapshot {
  /** Main has answered once. Before that `target` is unknown, not "none" (the glow waits for it). */
  loaded: boolean
  /** Crafty runs here and is switched on: the session menus offer it. */
  available: boolean
  /** The session Crafty sends to; null while each question starts a new session. */
  target: CraftyTargetRef | null
}

const UNAVAILABLE: CraftyTargetSnapshot = { loaded: false, available: false, target: null }

let snapshot = UNAVAILABLE
let supported = false
let started = false
const listeners = new Set<() => void>()

function publish(next: CraftyTargetSnapshot): void {
  const same = next.loaded === snapshot.loaded
    && next.available === snapshot.available
    && next.target?.sessionId === snapshot.target?.sessionId
    && next.target?.workspaceId === snapshot.target?.workspaceId
  if (same) return
  snapshot = next
  for (const listener of listeners) listener()
}

/** Read the status again: the menus call it when they open, so they never offer a stale item. */
export async function refreshCraftyTarget(): Promise<void> {
  const crafty = window.electronAPI?.crafty
  if (!crafty) return
  try {
    const status = await crafty.getStatus()
    supported = status.supported
    const available = status.supported && status.enabled
    publish({ loaded: true, available, target: available ? status.target : null })
  } catch {
    // Keep what we had: the next push or menu open tries again
  }
}

function start(): void {
  if (started) return
  started = true
  const crafty = window.electronAPI?.crafty
  // A renderer hot-reloaded over an older preload has Crafty without the target calls: stay off
  if (typeof crafty?.onTargetChanged !== 'function') return
  crafty.onTargetChanged(({ enabled, target }) => publish({ loaded: true, available: supported && enabled, target }))
  void refreshCraftyTarget()
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const getSnapshot = () => snapshot

export function isCraftyTarget(target: CraftyTargetRef | null, workspaceId: string | undefined, sessionId: string | undefined): boolean {
  return !!target && target.sessionId === sessionId && target.workspaceId === workspaceId
}

/**
 * The target, and a setter that rejects (with main's reason) for a session that can't take it.
 * `refreshOnMount`: menus pass it, since they mount when they open.
 */
export function useCraftyTarget({ refreshOnMount = false }: { refreshOnMount?: boolean } = {}): CraftyTargetSnapshot & {
  setTarget: (target: CraftyTargetRef | null) => Promise<void>
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => {
    if (refreshOnMount) void refreshCraftyTarget()
  }, [refreshOnMount])
  const setTarget = useCallback(async (target: CraftyTargetRef | null) => {
    await window.electronAPI?.crafty?.setTarget(target)
  }, [])
  return { ...state, setTarget }
}
