import * as storage from '../lib/local-storage'
import type { SessionFamily } from './session-tree'

export type SessionPlacement = 'before' | 'after'

export function loadManualSessionOrder(scope: string): string[] {
  const saved = storage.get<unknown>(storage.KEYS.manualSessionOrder, [], scope)
  return Array.isArray(saved) ? [...new Set(saved.filter(id => typeof id === 'string'))] : []
}

export function saveManualSessionOrder(scope: string, ids: readonly string[]): void {
  storage.set(storage.KEYS.manualSessionOrder, ids, scope)
}

export function orderSessionFamilies(families: SessionFamily[], savedIds: readonly string[]): SessionFamily[] {
  const rank = new Map(savedIds.map((id, index) => [id, index]))
  // New (unranked) families go first, in creation order, not activity order. The ID
  // makes the fallback deterministic even for legacy sessions without createdAt.
  const unranked = families.filter(({ view }) => !rank.has(view.id))
  unranked.sort(({ view: a }, { view: b }) =>
    (b.createdAt ?? 0) - (a.createdAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const ranked = families.filter(({ view }) => rank.has(view.id))
  ranked.sort((a, b) => rank.get(a.view.id)! - rank.get(b.view.id)!)
  return [...unranked, ...ranked]
}

export function moveSessionFamily(
  savedIds: readonly string[],
  currentIds: readonly string[],
  source: string,
  target: string,
  placement: SessionPlacement,
): string[] | undefined {
  if (source === target || !currentIds.includes(source) || !currentIds.includes(target)) return
  const next = currentIds.filter(id => id !== source)
  next.splice(next.indexOf(target) + (placement === 'after' ? 1 : 0), 0, source)
  if (next.every((id, index) => currentIds[index] === id)) return

  // Keep saved slots for chats temporarily absent due to filtering or archiving.
  // New chats occupy the leading slots, matching the rendered order before the move.
  const saved = new Set(savedIds)
  const visible = new Set(currentIds)
  const slots = [...currentIds.filter(id => !saved.has(id)), ...savedIds]
  let index = 0
  return slots.map(id => visible.has(id) ? next[index++]! : id)
}
