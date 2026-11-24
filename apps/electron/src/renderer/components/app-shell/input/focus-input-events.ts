export interface FocusInputEventDetail {
  sessionId?: string
  /** Recheck automatic focus at the moment it would move, after the chat loads. */
  shouldFocus?: () => boolean
}

let pendingFocus: FocusInputEventDetail | undefined

/**
 * Queue a targeted focus request so newly-mounted inputs can consume it
 * after a session switch race (e.g., SessionList Enter).
 */
export function queuePendingFocusForSession(sessionId?: string | null, shouldFocus?: () => boolean): void {
  if (sessionId) pendingFocus = { sessionId, shouldFocus }
}

/**
 * Dispatch the global focus-input event with optional session scoping.
 * Also stores a pending target to survive session switch timing races.
 */
export function dispatchFocusInputEvent(detail: FocusInputEventDetail = {}): void {
  queuePendingFocusForSession(detail.sessionId, detail.shouldFocus)
  window.dispatchEvent(new CustomEvent<FocusInputEventDetail>('craft:focus-input', { detail }))
}

/**
 * Take the queued request for this session without dropping a different target.
 */
export function consumePendingFocusForSession(sessionId?: string | null): FocusInputEventDetail | undefined {
  if (!sessionId || pendingFocus?.sessionId !== sessionId) return
  const request = pendingFocus
  pendingFocus = undefined
  return request
}

/** Clear queued focus for a session if present. */
export function clearPendingFocusForSession(sessionId?: string | null): void {
  if (!sessionId) return
  if (pendingFocus?.sessionId === sessionId) pendingFocus = undefined
}

/** Do not retain automatic focus when leaving the selected session. */
export function clearPendingSelectionFocus(sessionId: string | null): void {
  if (pendingFocus?.shouldFocus) clearPendingFocusForSession(sessionId)
}

/** Test-only reset helper. */
export function __resetPendingFocusForTests(): void {
  pendingFocus = undefined
}
