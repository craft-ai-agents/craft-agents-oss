import { useCallback } from 'react'
import { getDefaultStore } from 'jotai'
import type { CreateSessionOptions, Session, SessionStatus } from '../../shared/types'
import { sessionMetaMapAtom } from '../atoms/sessions'

type JotaiStore = ReturnType<typeof getDefaultStore>
type SessionUpdater = (
  sessionId: string,
  updates: Partial<Session> | ((session: Session) => Partial<Session>),
) => void

interface UseSessionActionsOptions {
  store: JotaiStore
  activeWorkspaceId: string | null
  addSession: (session: Session) => void
  removeSession: (sessionId: string) => void
  updateSession: SessionUpdater
  syncSessionOptions: (session: Session) => void
}

export function useAppSessionActions({
  store,
  activeWorkspaceId,
  addSession,
  removeSession,
  updateSession,
  syncSessionOptions,
}: UseSessionActionsOptions) {
  const createSession = useCallback(async (
    workspaceId: string,
    options?: CreateSessionOptions,
  ): Promise<Session> => {
    const session = await window.electronAPI.createSession(workspaceId, options)
    addSession(session)
    syncSessionOptions(session)
    return session
  }, [addSession, syncSessionOptions])

  const deleteSession = useCallback(async (sessionId: string, skipConfirmation = false): Promise<boolean> => {
    if (!skipConfirmation) {
      const meta = store.get(sessionMetaMapAtom).get(sessionId)
      const isEmpty = !meta || (!meta.lastFinalMessageId && !meta.name)
      if (!isEmpty) {
        const confirmed = await window.electronAPI.showDeleteSessionConfirmation(meta?.name || 'Untitled')
        if (!confirmed) return false
      }
    }

    await window.electronAPI.deleteSession(sessionId)
    removeSession(sessionId)
    return true
  }, [removeSession, store])

  const autoDeleteEmptySession = useCallback((sessionId: string) => {
    void window.electronAPI.deleteSession(sessionId)
    removeSession(sessionId)
  }, [removeSession])

  const flagSession = useCallback((sessionId: string) => {
    updateSession(sessionId, { isFlagged: true })
    void window.electronAPI.sessionCommand(sessionId, { type: 'flag' })
  }, [updateSession])

  const unflagSession = useCallback((sessionId: string) => {
    updateSession(sessionId, { isFlagged: false })
    void window.electronAPI.sessionCommand(sessionId, { type: 'unflag' })
  }, [updateSession])

  const archiveSession = useCallback((sessionId: string) => {
    updateSession(sessionId, { isArchived: true, archivedAt: Date.now() })
    void window.electronAPI.sessionCommand(sessionId, { type: 'archive' })
  }, [updateSession])

  const unarchiveSession = useCallback((sessionId: string) => {
    updateSession(sessionId, { isArchived: false, archivedAt: undefined })
    void window.electronAPI.sessionCommand(sessionId, { type: 'unarchive' })
  }, [updateSession])

  const setActiveViewingSession = useCallback((sessionId: string) => {
    updateSession(sessionId, { hasUnread: false })
    void window.electronAPI.sessionCommand(sessionId, {
      type: 'setActiveViewing',
      workspaceId: activeWorkspaceId ?? '',
    })
  }, [activeWorkspaceId, updateSession])

  const markSessionRead = useCallback((sessionId: string) => {
    updateSession(sessionId, session => {
      const lastFinalId = session.messages.findLast(
        message => (message.role === 'assistant' || message.role === 'plan') && !message.isIntermediate,
      )?.id
      return {
        hasUnread: false,
        ...(lastFinalId ? { lastReadMessageId: lastFinalId } : {}),
      }
    })
    void window.electronAPI.sessionCommand(sessionId, { type: 'markRead' })
  }, [updateSession])

  const markSessionUnread = useCallback((sessionId: string) => {
    updateSession(sessionId, { hasUnread: true, lastReadMessageId: undefined })
    void window.electronAPI.sessionCommand(sessionId, { type: 'markUnread' })
  }, [updateSession])

  const changeSessionStatus = useCallback((sessionId: string, state: SessionStatus) => {
    updateSession(sessionId, { sessionStatus: state })
    void window.electronAPI.sessionCommand(sessionId, { type: 'setSessionStatus', state })
  }, [updateSession])

  const renameSession = useCallback((sessionId: string, name: string) => {
    updateSession(sessionId, { name })
    void window.electronAPI.sessionCommand(sessionId, { type: 'rename', name })
  }, [updateSession])

  return {
    archiveSession,
    autoDeleteEmptySession,
    changeSessionStatus,
    createSession,
    deleteSession,
    flagSession,
    markSessionRead,
    markSessionUnread,
    renameSession,
    setActiveViewingSession,
    unarchiveSession,
    unflagSession,
  }
}
