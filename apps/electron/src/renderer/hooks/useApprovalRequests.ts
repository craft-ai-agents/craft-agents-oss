import { useCallback, useState } from 'react'
import type {
  CredentialRequest,
  CredentialResponse,
  PermissionRequest,
  PermissionResponseOptions,
} from '../../shared/types'

function appendRequest<T>(queues: Map<string, T[]>, sessionId: string, request: T): Map<string, T[]> {
  const next = new Map(queues)
  next.set(sessionId, [...(next.get(sessionId) ?? []), request])
  return next
}

function removeFirstRequest<T>(queues: Map<string, T[]>, sessionId: string): Map<string, T[]> {
  const next = new Map(queues)
  const remaining = (next.get(sessionId) ?? []).slice(1)
  if (remaining.length === 0) next.delete(sessionId)
  else next.set(sessionId, remaining)
  return next
}

function clearSessionQueue<T>(queues: Map<string, T[]>, sessionId: string): Map<string, T[]> {
  if (!queues.has(sessionId)) return queues
  const next = new Map(queues)
  next.delete(sessionId)
  return next
}

export function useApprovalRequests() {
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, PermissionRequest[]>>(new Map())
  const [pendingCredentials, setPendingCredentials] = useState<Map<string, CredentialRequest[]>>(new Map())

  const enqueuePermission = useCallback((sessionId: string, request: PermissionRequest) => {
    setPendingPermissions(queues => appendRequest(queues, sessionId, request))
  }, [])

  const enqueueCredential = useCallback((sessionId: string, request: CredentialRequest) => {
    setPendingCredentials(queues => appendRequest(queues, sessionId, request))
  }, [])

  const clearSessionRequests = useCallback((sessionId: string) => {
    setPendingPermissions(queues => clearSessionQueue(queues, sessionId))
    setPendingCredentials(queues => clearSessionQueue(queues, sessionId))
  }, [])

  const clearAllRequests = useCallback(() => {
    setPendingPermissions(new Map())
    setPendingCredentials(new Map())
  }, [])

  const respondToPermission = useCallback(async (
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean,
    options?: PermissionResponseOptions,
  ) => {
    await window.electronAPI.respondToPermission(sessionId, requestId, allowed, alwaysAllow, options)
    // Clear the handled request even when the backend no longer has the session,
    // otherwise the approval UI remains stuck on a stale request.
    setPendingPermissions(queues => removeFirstRequest(queues, sessionId))
  }, [])

  const respondToCredential = useCallback(async (
    sessionId: string,
    requestId: string,
    response: CredentialResponse,
  ) => {
    await window.electronAPI.respondToCredential(sessionId, requestId, response)
    setPendingCredentials(queues => removeFirstRequest(queues, sessionId))
  }, [])

  return {
    clearAllRequests,
    clearSessionRequests,
    enqueueCredential,
    enqueuePermission,
    pendingCredentials,
    pendingPermissions,
    respondToCredential,
    respondToPermission,
  }
}
