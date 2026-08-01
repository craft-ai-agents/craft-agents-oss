import { useCallback, useState } from 'react'
import { getDefaultStore } from 'jotai'
import type { Session } from '../../shared/types'
import type { SessionOptions } from './useSessionOptions'
import { DEFAULT_THINKING_LEVEL } from '@archstudio/shared/agent/thinking-levels'
import {
  loadedSessionsAtom,
  refreshSessionsMetadataAtom,
  sessionAtomFamily,
  sessionMetaMapAtom,
  type SessionMeta,
} from '../atoms/sessions'
import { navigate, routes } from '../lib/navigate'
import { formatSessionLoadFailure, shouldTreatSessionLoadFailureAsTransportFallback } from '../lib/session-load'
import { rendererLog } from '../lib/logger'
import { useStaleSessionRecovery } from './useStaleSessionRecovery'

type JotaiStore = ReturnType<typeof getDefaultStore>

type SessionListRefreshOptions = {
  removeMissing?: boolean
  reason?: string
  selectedSessionId?: string | null
}

const SESSION_REFRESH_LOG_ID_LIMIT = 25

function summarizeIds(ids: Iterable<string>, limit = SESSION_REFRESH_LOG_ID_LIMIT) {
  const all = Array.from(ids)
  return { count: all.length, ids: all.slice(0, limit), truncated: all.length > limit }
}

function workspaceDistribution(sessions: Iterable<{ workspaceId?: string }>): Record<string, number> {
  const distribution: Record<string, number> = {}
  for (const session of sessions) {
    const key = session.workspaceId || '(missing)'
    distribution[key] = (distribution[key] ?? 0) + 1
  }
  return distribution
}

interface UseSessionControllerOptions {
  store: JotaiStore
  initializeSessions: (sessions: Session[]) => void
  replaceLoadedSession: (session: Session) => void
  clearStreamingState: (sessionId: string) => void
  syncSessionOptionsFromSession: (session: Session) => void
  reconcilePermissionModeState: (sessionId: string) => Promise<void>
  setSessionOptions: React.Dispatch<React.SetStateAction<Map<string, SessionOptions>>>
  initialSessionId: string | null
  workspaceId: string | null
  remoteWorkspaceId: string | null
}

export function useSessionController({
  store,
  initializeSessions,
  replaceLoadedSession,
  clearStreamingState,
  syncSessionOptionsFromSession,
  reconcilePermissionModeState,
  setSessionOptions,
  initialSessionId,
  workspaceId,
  remoteWorkspaceId,
}: UseSessionControllerOptions) {
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [sessionLoadError, setSessionLoadError] = useState<string | null>(null)

  const refreshSessionFromServer = useCallback(async (
    sessionId: string,
  ): Promise<'refreshed' | 'preserved_stale_messages' | 'failed'> => {
    try {
      const fresh = await window.electronAPI.getSessionMessages(sessionId)
      if (!fresh) return 'failed'

      const previous = store.get(sessionAtomFamily(sessionId))
      const preservedStaleMessages = !!previous && previous.messages.length > 0 && (!fresh.messages || fresh.messages.length === 0)
      const nextSession = preservedStaleMessages ? { ...fresh, messages: previous.messages } : fresh

      clearStreamingState(sessionId)
      replaceLoadedSession(nextSession)
      syncSessionOptionsFromSession(nextSession)
      void reconcilePermissionModeState(sessionId)
      return preservedStaleMessages ? 'preserved_stale_messages' : 'refreshed'
    } catch (error) {
      console.error(`[App] Failed to refresh session ${sessionId}:`, error)
      return 'failed'
    }
  }, [clearStreamingState, reconcilePermissionModeState, replaceLoadedSession, store, syncSessionOptionsFromSession])

  const loadSessionsFromServer = useCallback(async () => {
    setSessionLoadError(null)
    try {
      const loadedSessions = await window.electronAPI.getSessions()
      initializeSessions(loadedSessions)

      const optionsMap = new Map<string, SessionOptions>()
      for (const session of loadedSessions) {
        const hasNonDefaultMode = session.permissionMode && session.permissionMode !== 'ask'
        const hasNonDefaultThinking = session.thinkingLevel && session.thinkingLevel !== DEFAULT_THINKING_LEVEL
        if (hasNonDefaultMode || hasNonDefaultThinking) {
          optionsMap.set(session.id, {
            permissionMode: session.permissionMode ?? 'ask',
            thinkingLevel: session.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
          })
        }
      }
      setSessionOptions(optionsMap)
      await Promise.allSettled(loadedSessions.map(session => reconcilePermissionModeState(session.id)))
      setSessionsLoaded(true)

      if (initialSessionId && workspaceId) {
        const session = loadedSessions.find(candidate => candidate.id === initialSessionId)
        if (session) navigate(routes.view.allSessions(session.id))
      }
    } catch (error) {
      console.error('[App] Failed to load sessions:', error)
      const transportState = await window.electronAPI.getTransportConnectionState().catch(() => null)
      if (shouldTreatSessionLoadFailureAsTransportFallback(transportState)) {
        console.error('[App] Treating session load failure as transport fallback:', transportState)
        setSessionsLoaded(true)
        setSessionLoadError(null)
        return
      }
      setSessionLoadError(formatSessionLoadFailure(error))
      setSessionsLoaded(true)
    }
  }, [initialSessionId, initializeSessions, reconcilePermissionModeState, setSessionOptions, workspaceId])

  const refreshSessionListMetadataFromServer = useCallback(async (
    options: SessionListRefreshOptions = {},
  ): Promise<Map<string, SessionMeta> | null> => {
    const { removeMissing = true, reason = 'manual-or-authoritative', selectedSessionId = null } = options
    const beforeMetaMap = store.get(sessionMetaMapAtom)
    const beforeIds = new Set(beforeMetaMap.keys())
    const transportState = await window.electronAPI.getTransportConnectionState().catch(() => null)

    try {
      const sessions = await window.electronAPI.getSessions()
      const returnedIds = new Set(sessions.map(session => session.id))
      const missingIds = Array.from(beforeIds).filter(id => !returnedIds.has(id))
      const addedIds = sessions.map(session => session.id).filter(id => !beforeIds.has(id))
      const logPayload = {
        reason,
        removeMissing,
        windowWorkspaceId: workspaceId,
        windowRemoteWorkspaceId: remoteWorkspaceId,
        selectedSessionId,
        beforeCount: beforeIds.size,
        returnedCount: sessions.length,
        beforeIds: summarizeIds(beforeIds),
        returnedIds: summarizeIds(returnedIds),
        missingIds: summarizeIds(missingIds),
        addedIds: summarizeIds(addedIds),
        beforeWorkspaceIds: workspaceDistribution(beforeMetaMap.values()),
        returnedWorkspaceIds: workspaceDistribution(sessions),
        transportState,
      }

      rendererLog.info('[App] Session list metadata refresh result', logPayload)
      if (!removeMissing && missingIds.length > 0) {
        rendererLog.warn('[App] Non-destructive refresh preserved sessions omitted by getSessions(); this indicates a partial backend response or workspace-context mismatch', logPayload)
      }

      const loadedSessionIds = store.get(loadedSessionsAtom)
      const nextMetaMap = store.set(refreshSessionsMetadataAtom, { sessions, loadedSessionIds, removeMissing })
      for (const session of sessions) syncSessionOptionsFromSession(session)
      await Promise.allSettled(sessions.map(session => reconcilePermissionModeState(session.id)))
      return nextMetaMap
    } catch (error) {
      rendererLog.error('[App] Failed to refresh session list metadata after reconnect:', {
        reason,
        removeMissing,
        windowWorkspaceId: workspaceId,
        windowRemoteWorkspaceId: remoteWorkspaceId,
        selectedSessionId,
        beforeCount: beforeIds.size,
        beforeIds: summarizeIds(beforeIds),
        beforeWorkspaceIds: workspaceDistribution(beforeMetaMap.values()),
        transportState,
        error,
      })
      return null
    }
  }, [reconcilePermissionModeState, remoteWorkspaceId, store, syncSessionOptionsFromSession, workspaceId])

  const { trackSessionActivity } = useStaleSessionRecovery({ store, refreshSessionFromServer })

  return {
    loadSessionsFromServer,
    refreshSessionFromServer,
    refreshSessionListMetadataFromServer,
    sessionLoadError,
    sessionsLoaded,
    trackSessionActivity,
  }
}
