/**
 * Per-Session State Management with Jotai
 *
 * Uses atomFamily to create isolated atoms per session.
 * Updates to one session don't trigger re-renders in other sessions.
 *
 * This solves the performance issue where streaming in Session A
 * caused re-renders and focus loss in Session B.
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { Session, Message } from '../../shared/types'

/**
 * Session metadata for list display (lightweight, no messages)
 * Used by SessionList to avoid re-rendering on message changes
 */
export interface SessionMeta {
  id: string
  name?: string
  agentId?: string
  agentName?: string
  workspaceId: string
  lastMessageAt?: number
  isProcessing?: boolean
  isFlagged?: boolean
  lastReadMessageId?: string
  workingDirectory?: string
  enabledSourceSlugs?: string[]
}

/**
 * Extract metadata from a full session object
 */
export function extractSessionMeta(session: Session): SessionMeta {
  return {
    id: session.id,
    name: session.name,
    agentId: session.agentId,
    agentName: session.agentName,
    workspaceId: session.workspaceId,
    lastMessageAt: session.lastMessageAt,
    isProcessing: session.isProcessing,
    isFlagged: session.isFlagged,
    lastReadMessageId: session.lastReadMessageId,
    workingDirectory: session.workingDirectory,
    enabledSourceSlugs: session.enabledSourceSlugs,
  }
}

/**
 * Atom family for individual session state
 * Each session gets its own atom - updates are isolated
 */
export const sessionAtomFamily = atomFamily(
  (_sessionId: string) => atom<Session | null>(null),
  (a, b) => a === b
)

/**
 * Atom for session metadata map (for list display)
 * Only contains lightweight data needed for SessionList
 */
export const sessionMetaMapAtom = atom<Map<string, SessionMeta>>(new Map())

/**
 * Derived atom: ordered list of session IDs (for list ordering)
 */
export const sessionIdsAtom = atom<string[]>([])

/**
 * Action atom: update a single session
 * Only triggers re-render in components subscribed to this specific session
 */
export const updateSessionAtom = atom(
  null,
  (get, set, sessionId: string, updater: (prev: Session | null) => Session | null) => {
    const sessionAtom = sessionAtomFamily(sessionId)
    const currentSession = get(sessionAtom)
    const newSession = updater(currentSession)
    set(sessionAtom, newSession)

    // Also update metadata if session exists
    if (newSession) {
      const metaMap = get(sessionMetaMapAtom)
      const newMetaMap = new Map(metaMap)
      newMetaMap.set(sessionId, extractSessionMeta(newSession))
      set(sessionMetaMapAtom, newMetaMap)
    }
  }
)

/**
 * Action atom: update only session metadata (for list display updates)
 * Doesn't affect the full session atom
 */
export const updateSessionMetaAtom = atom(
  null,
  (get, set, sessionId: string, updates: Partial<SessionMeta>) => {
    const metaMap = get(sessionMetaMapAtom)
    const existing = metaMap.get(sessionId)
    if (existing) {
      const newMetaMap = new Map(metaMap)
      newMetaMap.set(sessionId, { ...existing, ...updates })
      set(sessionMetaMapAtom, newMetaMap)
    }
  }
)

/**
 * Action atom: append message to session (for streaming)
 * Optimized to only update the specific session
 * Note: Does NOT update lastMessageAt - caller must handle timestamp updates
 * to avoid session list jumping on intermediate/tool messages
 */
export const appendMessageAtom = atom(
  null,
  (get, set, sessionId: string, message: Message) => {
    const sessionAtom = sessionAtomFamily(sessionId)
    const session = get(sessionAtom)
    if (session) {
      set(sessionAtom, {
        ...session,
        messages: [...session.messages, message],
        // Don't update lastMessageAt here - only user messages and final responses should update it
      })
    }
  }
)

/**
 * Action atom: update streaming content for a session
 * For text_delta events - appends to the last streaming message
 */
export const updateStreamingContentAtom = atom(
  null,
  (get, set, sessionId: string, content: string, turnId?: string) => {
    const sessionAtom = sessionAtomFamily(sessionId)
    const session = get(sessionAtom)
    if (!session) return

    const messages = [...session.messages]
    const lastMsg = messages[messages.length - 1]

    // Append to existing streaming message
    if (lastMsg?.role === 'assistant' && lastMsg.isStreaming &&
        (!turnId || lastMsg.turnId === turnId)) {
      messages[messages.length - 1] = {
        ...lastMsg,
        content: lastMsg.content + content,
      }
      set(sessionAtom, { ...session, messages })
    }
  }
)

/**
 * Action atom: initialize sessions from loaded data
 */
export const initializeSessionsAtom = atom(
  null,
  (get, set, sessions: Session[]) => {
    // Set individual session atoms
    for (const session of sessions) {
      set(sessionAtomFamily(session.id), session)
    }

    // Build metadata map
    const metaMap = new Map<string, SessionMeta>()
    for (const session of sessions) {
      metaMap.set(session.id, extractSessionMeta(session))
    }
    set(sessionMetaMapAtom, metaMap)

    // Set ordered IDs (sorted by lastMessageAt desc)
    const ids = sessions
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
      .map(s => s.id)
    set(sessionIdsAtom, ids)
  }
)

/**
 * Action atom: add a new session
 */
export const addSessionAtom = atom(
  null,
  (get, set, session: Session) => {
    // Set session atom
    set(sessionAtomFamily(session.id), session)

    // Add to metadata map
    const metaMap = get(sessionMetaMapAtom)
    const newMetaMap = new Map(metaMap)
    newMetaMap.set(session.id, extractSessionMeta(session))
    set(sessionMetaMapAtom, newMetaMap)

    // Add to beginning of IDs list
    const ids = get(sessionIdsAtom)
    set(sessionIdsAtom, [session.id, ...ids])
  }
)

/**
 * Action atom: remove a session
 */
export const removeSessionAtom = atom(
  null,
  (get, set, sessionId: string) => {
    // Clear session atom
    set(sessionAtomFamily(sessionId), null)

    // Remove from metadata map
    const metaMap = get(sessionMetaMapAtom)
    const newMetaMap = new Map(metaMap)
    newMetaMap.delete(sessionId)
    set(sessionMetaMapAtom, newMetaMap)

    // Remove from IDs list
    const ids = get(sessionIdsAtom)
    set(sessionIdsAtom, ids.filter(id => id !== sessionId))
  }
)

/**
 * Action atom: sync React state to per-session atoms
 *
 * This is the key to the hybrid approach:
 * - React state (sessions array) remains the source of truth
 * - This atom syncs changes to per-session atoms automatically
 * - Components using useSession(id) get isolated updates
 * - Jotai's referential equality prevents unnecessary re-renders
 *
 * IMPORTANT: During streaming, the atom is the source of truth.
 * Streaming events (text_delta, tool_start, tool_result) update atoms directly
 * and bypass React state for performance. We must NOT overwrite atoms for
 * sessions that are processing, or we lose streaming data (tool calls, text).
 * Once a "handoff" event (complete, error, etc.) occurs, React state catches up
 * and sync works normally again.
 */
export const syncSessionsToAtomsAtom = atom(
  null,
  (get, set, sessions: Session[]) => {
    // Update each session atom
    for (const session of sessions) {
      const sessionAtom = sessionAtomFamily(session.id)
      const atomSession = get(sessionAtom)

      // CRITICAL: If the atom's session is processing, it has streaming updates
      // that React state doesn't know about yet. Don't overwrite - atom is
      // source of truth during streaming. The handoff event will reconcile.
      if (atomSession?.isProcessing) {
        continue
      }

      // Only update if the session object is different (referential check)
      // This prevents unnecessary re-renders when the session hasn't changed
      if (atomSession !== session) {
        set(sessionAtom, session)
      }
    }

    // Update metadata map for list display
    // Note: We still update metadata from React state, which is fine because
    // metadata doesn't include messages - the streaming content we're protecting
    const metaMap = new Map<string, SessionMeta>()
    for (const session of sessions) {
      metaMap.set(session.id, extractSessionMeta(session))
    }
    set(sessionMetaMapAtom, metaMap)

    // Update ordered IDs (preserve order from React state)
    set(sessionIdsAtom, sessions.map(s => s.id))
  }
)

/**
 * Atom family for tracking expanded turn IDs per session
 * Persists expanded/collapsed state across session switches
 */
export const expandedTurnsAtomFamily = atomFamily(
  (_sessionId: string) => atom<Set<string>>(new Set<string>()),
  (a, b) => a === b
)

/**
 * Atom family for tracking expanded activity group IDs per session
 * Persists expanded/collapsed state for Task subagents
 * Default is collapsed (ID not in set = collapsed)
 */
export const expandedActivityGroupsAtomFamily = atomFamily(
  (_sessionId: string) => atom<Set<string>>(new Set<string>()),
  (a, b) => a === b
)

/**
 * Background task for ActiveTasksBar display
 */
export interface BackgroundTask {
  /** Task or shell ID */
  id: string
  /** Task type */
  type: 'agent' | 'shell'
  /** Tool use ID for correlation with messages */
  toolUseId: string
  /** When the task started */
  startTime: number
  /** Elapsed seconds (from progress events) */
  elapsedSeconds: number
  /** Task intent/description */
  intent?: string
}

/**
 * Atom family for tracking active background tasks per session
 * Updated on task_backgrounded, shell_backgrounded, task_progress events
 * Cleared when tasks complete or are killed
 */
export const backgroundTasksAtomFamily = atomFamily(
  (_sessionId: string) => atom<BackgroundTask[]>([]),
  (a, b) => a === b
)
