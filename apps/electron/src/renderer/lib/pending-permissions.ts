import type { PermissionRequest } from '../../shared/types'

/**
 * The pending prompts without `requestId`. By id, not position: the answer of
 * this window and the `permission_resolved` event for it can arrive in either
 * order, and a session can hold several prompts at once.
 */
export function withoutPermissionRequest(
  pending: Map<string, PermissionRequest[]>,
  sessionId: string,
  requestId: string,
): Map<string, PermissionRequest[]> {
  const queue = pending.get(sessionId)
  if (!queue?.some(request => request.requestId === requestId)) return pending
  const next = new Map(pending)
  const remaining = queue.filter(request => request.requestId !== requestId)
  if (remaining.length === 0) next.delete(sessionId)
  else next.set(sessionId, remaining)
  return next
}
