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
  /** Preview of first user message (for title fallback) */
  preview?: string
  workspaceId: string
  lastMessageAt?: number
  isProcessing?: boolean
  isFlagged?: boolean
  lastReadMessageId?: string
  workingDirectory?: string
  enabledSourceSlugs?: string[]
  /** Shared viewer URL (if shared via viewer) */
  sharedUrl?: string
  /** Shared session ID in viewer (for revoke) */
  sharedId?: string
  /** ID of the last final (non-intermediate) assistant message - for unread detection */
  lastFinalMessageId?: string
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean
  /** Labels for filtering (additive tags, many-per-session) */
  labels?: string[]
  /** Permission mode ('safe', 'ask', 'allow-all') — used by view expressions */
  permissionMode?: string
  /** Todo state for filtering */
  todoState?: string
  /** Role/type of the last message (for badge display without loading messages) */
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error'
  /** Whether an async operation is ongoing (sharing, updating share, revoking, title regeneration) */
  isAsyncOperationOngoing?: boolean
  /** @deprecated Use isAsyncOperationOngoing instead */
  isRegeneratingTitle?: boolean
  /** Model override for this session */
  model?: string
  /** Token usage stats (from JSONL header, available without loading messages) */
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    costUsd: number
    contextTokens: number
  }
  /** When the session was created (ms timestamp) */
  createdAt?: number
  /** Total number of messages in this session */
  messageCount?: number
  /** When true, session is hidden from session list (e.g., mini edit sessions) */
  hidden?: boolean
}

/**
 * Find the last final (non-intermediate) assistant message ID
 */
function findLastFinalMessageId(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant' && !msg.isIntermediate) {
      return msg.id
    }
  }
  return undefined
}

/**
 * Extract metadata from a full session object
 */
export function extractSessionMeta(session: Session): SessionMeta {
  const messages = session.messages || []
  // Prefer pre-computed lastFinalMessageId from session storage (available without loading messages).
  // Fall back to computing from messages for newly created sessions or when messages are loaded.
  const lastFinalMessageId = session.lastFinalMessageId ?? findLastFinalMessageId(messages)

  return {
    id: session.id,
    name: session.name,
    preview: session.preview,
    workspaceId: session.workspaceId,
    lastMessageAt: session.lastMessageAt,
    isProcessing: session.isProcessing,
    isFlagged: session.isFlagged,
    lastReadMessageId: session.lastReadMessageId,
    workingDirectory: session.workingDirectory,
    enabledSourceSlugs: session.enabledSourceSlugs,
    sharedUrl: session.sharedUrl,
    sharedId: session.sharedId,
    lastFinalMessageId,
    // Explicit unread flag - source of truth for NEW badge
    hasUnread: session.hasUnread,
    labels: session.labels,
    permissionMode: session.permissionMode,
    todoState: session.todoState,
    lastMessageRole: session.lastMessageRole,
    // Use isAsyncOperationOngoing if available, fall back to deprecated isRegeneratingTitle
    isAsyncOperationOngoing: session.isAsyncOperationOngoing ?? session.isRegeneratingTitle,
    isRegeneratingTitle: session.isRegeneratingTitle,
    // Fields needed by view expressions (messageCount, model, createdAt, tokenUsage)
    messageCount: session.messageCount ?? session.messages?.length ?? 0,
    model: session.model,
    createdAt: session.createdAt,
    tokenUsage: session.tokenUsage,
    // Hidden sessions (e.g., mini edit sessions in EditPopover)
    hidden: session.hidden,
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
 * Track which sessions have had their messages loaded (for lazy loading)
 * Sessions are loaded with empty messages initially, messages are fetched on-demand
 */
export const loadedSessionsAtom = atom<Set<string>>(new Set<string>())

/**
 * Promise cache for deduplicating concurrent session load requests.
 * Prevents race condition where multiple calls (e.g., from React re-renders)
 * start loading before the first completes and marks the session as loaded.
 * Module-level map since it tracks in-flight promises, not React state.
 */
const sessionLoadingPromises = new Map<string, Promise<Session | null>>()

/**
 * Currently active session ID - the session displayed in the main content area
 * This replaces the tab-based session selection
 */
export const activeSessionIdAtom = atom<string | null>(null)

// NOTE: sessionsAtom REMOVED to fix memory leak
// The sessions array with messages was being retained by Jotai's internal state.
// Instead, we now use:
// - sessionMetaMapAtom for listing (lightweight metadata, no messages)
// - sessionAtomFamily(id) for individual session data
// - initializeSessionsAtom for bulk initialization
// - addSessionAtom, removeSessionAtom for individual operations

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
    // Clean up stale atom family entries from previous workspace.
    // Without this, switching workspaces leaves orphaned atoms in memory
    // and components subscribed to old session IDs see stale/empty data.
    const oldIds = get(sessionIdsAtom)
    const newIdSet = new Set(sessions.map(s => s.id))
    for (const oldId of oldIds) {
      if (!newIdSet.has(oldId)) {
        sessionAtomFamily.remove(oldId)
        backgroundTasksAtomFamily.remove(oldId)
      }
    }
    // Reset loaded sessions tracking — new workspace needs fresh lazy loading
    set(loadedSessionsAtom, new Set<string>())

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

    // NOTE: Do NOT mark sessions as loaded here
    // Sessions from getSessions() have empty messages: [] to save memory
    // Messages are lazy-loaded via ensureSessionMessagesLoadedAtom when session is opened
    // This reduces initial memory usage from ~500MB to ~50MB for 300+ sessions
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

    // Mark as loaded (new sessions are complete - no lazy loading needed)
    const loadedSessions = get(loadedSessionsAtom)
    const newLoadedSessions = new Set(loadedSessions)
    newLoadedSessions.add(session.id)
    set(loadedSessionsAtom, newLoadedSessions)
  }
)

/**
 * Action atom: remove a session
 */
export const removeSessionAtom = atom(
  null,
  (get, set, sessionId: string) => {
    // Clear session atom value first
    set(sessionAtomFamily(sessionId), null)
    // Remove atom from family cache to allow GC of the atom and its stored value
    sessionAtomFamily.remove(sessionId)

    // Remove from metadata map
    const metaMap = get(sessionMetaMapAtom)
    const newMetaMap = new Map(metaMap)
    newMetaMap.delete(sessionId)
    set(sessionMetaMapAtom, newMetaMap)

    // Remove from IDs list
    const ids = get(sessionIdsAtom)
    set(sessionIdsAtom, ids.filter(id => id !== sessionId))

    // Remove from loaded sessions tracking
    const loadedSessions = get(loadedSessionsAtom)
    const newLoadedSessions = new Set(loadedSessions)
    newLoadedSessions.delete(sessionId)
    set(loadedSessionsAtom, newLoadedSessions)

    // Clean up additional atom families to prevent memory leaks
    // These store per-session UI state that should be garbage collected
    backgroundTasksAtomFamily.remove(sessionId)
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
    const loadedSessions = get(loadedSessionsAtom)

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

      // CRITICAL: If session messages were lazy-loaded, atom has full messages
      // but React state may have empty array. Only skip if React would lose messages.
      // Allow sync when React has MORE messages (e.g., user just sent a message).
      if (loadedSessions.has(session.id) && atomSession) {
        const atomMessageCount = atomSession.messages?.length ?? 0
        const reactMessageCount = session.messages?.length ?? 0
        // Skip sync only if React has fewer messages (would lose data)
        if (reactMessageCount < atomMessageCount) {
          continue
        }
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
      const meta = extractSessionMeta(session)
      // Preserve isProcessing from atom if atom is processing
      // React state may have stale isProcessing: false during streaming
      const atomSession = get(sessionAtomFamily(session.id))
      if (atomSession?.isProcessing) {
        meta.isProcessing = true
      }
      metaMap.set(session.id, meta)
    }
    set(sessionMetaMapAtom, metaMap)

    // Update ordered IDs (preserve order from React state)
    set(sessionIdsAtom, sessions.map(s => s.id))
  }
)

// loadedSessionsAtom moved up before sessionsAtom (needed for self-syncing)

/**
 * Action atom: Load session messages if not already loaded
 * Returns the loaded session or current session if already loaded.
 * Uses promise deduplication to prevent redundant IPC calls from concurrent requests.
 *
 * IMPORTANT: This only merges messages into the existing session atom.
 * UI state fields (hasUnread, isFlagged, todoState, etc.) are preserved from
 * the in-memory atom, NOT overwritten with potentially stale disk data.
 * This prevents a race condition where optimistic updates (e.g., clearing the
 * NEW badge on session view) get clobbered by async message loading that reads
 * older state from disk.
 */
export const ensureSessionMessagesLoadedAtom = atom(
  null,
  async (get, set, sessionId: string): Promise<Session | null> => {
    const loadedSessions = get(loadedSessionsAtom)

    // Already loaded, return current session
    if (loadedSessions.has(sessionId)) {
      return get(sessionAtomFamily(sessionId))
    }

    // Check if already loading - return existing promise to deduplicate concurrent calls
    const existingPromise = sessionLoadingPromises.get(sessionId)
    if (existingPromise) {
      return existingPromise
    }

    // Create the loading promise with all the fetch and update logic
    const loadPromise = (async (): Promise<Session | null> => {
      // Fetch messages from main process
      const loadedSession = await window.electronAPI.getSessionMessages(sessionId)
      if (!loadedSession) {
        return get(sessionAtomFamily(sessionId))
      }

      // Merge messages and disk-only fields into existing session, preserving in-memory UI state.
      // The renderer's atom is authoritative for UI fields (hasUnread, isFlagged, etc.)
      // because optimistic updates may have changed them since the disk write.
      // tokenUsage and sessionFolderPath are only returned by getSession() (not getSessions()),
      // so they must be explicitly merged here to be available after app restart.
      const existingSession = get(sessionAtomFamily(sessionId))
      const mergedSession = existingSession
        ? {
            ...existingSession,
            messages: loadedSession.messages,
            tokenUsage: loadedSession.tokenUsage ?? existingSession.tokenUsage,
            sessionFolderPath: loadedSession.sessionFolderPath ?? existingSession.sessionFolderPath,
          }
        : loadedSession
      set(sessionAtomFamily(sessionId), mergedSession)

      // Update only lastFinalMessageId in metadata (now computable from loaded messages).
      // Don't replace the full meta entry — other fields are maintained through
      // optimistic updates and IPC events, and may be ahead of disk state.
      const lastFinalMessageId = findLastFinalMessageId(loadedSession.messages)
      if (lastFinalMessageId) {
        const metaMap = get(sessionMetaMapAtom)
        const existingMeta = metaMap.get(sessionId)
        if (existingMeta && existingMeta.lastFinalMessageId !== lastFinalMessageId) {
          const newMetaMap = new Map(metaMap)
          newMetaMap.set(sessionId, { ...existingMeta, lastFinalMessageId })
          set(sessionMetaMapAtom, newMetaMap)
        }
      }

      // Mark as loaded
      const newLoadedSessions = new Set(get(loadedSessionsAtom))
      newLoadedSessions.add(sessionId)
      set(loadedSessionsAtom, newLoadedSessions)

      return mergedSession
    })()

    // Cache the promise before awaiting
    sessionLoadingPromises.set(sessionId, loadPromise)

    try {
      return await loadPromise
    } finally {
      // Always clean up the cache, whether success or failure
      sessionLoadingPromises.delete(sessionId)
    }
  }
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

