/**
 * B5 LexoRank reorder helpers for collection views.
 */

import type { SessionMeta } from '@/atoms/sessions'

export interface RankNeighbors {
  prevId?: string
  nextId?: string
}

export interface RankReorderRequest extends RankNeighbors {
  sessionId: string
}

export function isStaleRankNeighborsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /RANK_NEIGHBORS_STALE/.test(message)
}

/**
 * Runs one authoritative stale-neighbor recovery. The second command error is
 * deliberately surfaced so callers can roll back their optimistic rank.
 */
export async function retryStaleRankReorder(
  initial: RankReorderRequest,
  command: (request: RankReorderRequest) => Promise<unknown>,
  refresh: () => Promise<void>,
  recompute: () => RankReorderRequest | null,
): Promise<void> {
  try {
    await command(initial)
    return
  } catch (error) {
    if (!isStaleRankNeighborsError(error)) throw error
  }

  await refresh()
  const retry = recompute()
  if (!retry) throw new Error('RANK_NEIGHBORS_UNAVAILABLE')
  await command(retry)
}

/**
 * Given the visible ordered list of sibling sessions in a bucket/column/view,
 * compute prev/next ids for a card dropped between beforeIndex and beforeIndex+1.
 * - `list` must already be sorted by rank asc for orderBy=rank.
 * - 0 <= beforeIndex <= list.length (list.length = append to end).
 */
export function rankNeighborsForDrop(list: SessionMeta[], beforeIndex: number): RankNeighbors {
  const clamped = Math.max(0, Math.min(beforeIndex, list.length))
  const prev = clamped > 0 ? list[clamped - 1] : undefined
  const next = clamped < list.length ? list[clamped] : undefined
  return { prevId: prev?.id, nextId: next?.id }
}

