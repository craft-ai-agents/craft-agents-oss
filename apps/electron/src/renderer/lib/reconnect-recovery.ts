import type { SessionMeta } from '@/atoms/sessions'

export function getSessionsToRefreshAfterReconnect(
  metaMap: Map<string, SessionMeta>,
  activeSessionId: string | null,
  isStale: boolean
): string[] {
  const refreshIds = new Set<string>()

  if (activeSessionId) {
    refreshIds.add(activeSessionId)
  }

  if (!isStale) {
    return [...refreshIds]
  }

  for (const [sessionId, meta] of metaMap) {
    if (meta.isProcessing) {
      refreshIds.add(sessionId)
    }
  }

  return [...refreshIds]
}

export const getSessionsToRefreshAfterStaleReconnect = (
  metaMap: Map<string, SessionMeta>,
  activeSessionId: string | null
): string[] => getSessionsToRefreshAfterReconnect(metaMap, activeSessionId, true)
