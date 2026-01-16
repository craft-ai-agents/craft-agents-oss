import type { Session } from "../../shared/types"
import type { SessionMeta } from "../atoms/sessions"

/** Common session fields used by getSessionTitle */
type SessionLike = Pick<Session, 'name' | 'preview'> & { messages?: Session['messages'] }

/**
 * Sanitize content for display as session title.
 * Strips XML blocks (e.g. <edit_request>) and normalizes whitespace.
 */
function sanitizePreview(content: string): string {
  return content
    .replace(/<edit_request>[\s\S]*?<\/edit_request>/g, '') // Strip entire edit_request blocks
    .replace(/<[^>]+>/g, '')     // Strip remaining XML/HTML tags
    .replace(/\s+/g, ' ')        // Collapse whitespace
    .trim()
}

/**
 * Get display title for a session.
 * Priority: custom name > first user message > preview (from metadata) > "New chat"
 * Works with both Session (full) and SessionMeta (lightweight)
 */
export function getSessionTitle(session: SessionLike | SessionMeta): string {
  if (session.name) {
    return session.name
  }

  // Check loaded messages first (only available on full Session)
  if ('messages' in session && session.messages) {
    const firstUserMessage = session.messages.find(m => m.role === 'user')
    if (firstUserMessage?.content) {
      const sanitized = sanitizePreview(firstUserMessage.content)
      if (sanitized) {
        const trimmed = sanitized.slice(0, 50)
        return trimmed.length < sanitized.length ? trimmed + '…' : trimmed
      }
    }
  }

  // Fall back to preview from JSONL header (for lazy-loaded sessions and SessionMeta)
  if (session.preview) {
    const sanitized = sanitizePreview(session.preview)
    if (sanitized) {
      const trimmed = sanitized.slice(0, 50)
      return trimmed.length < sanitized.length ? trimmed + '…' : trimmed
    }
  }

  return 'New chat'
}

/**
 * Get the ID of the last final assistant message (not intermediate)
 * Used for unread message tracking
 */
export function getLastFinalAssistantMessageId(session: Session): string | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const msg = session.messages[i]
    if (msg.role === 'assistant' && !msg.isIntermediate) {
      return msg.id
    }
  }
  return undefined
}

/**
 * Check if a session has unread messages
 * A session is unread if:
 * - There's a final assistant message AND
 * - Its ID differs from lastReadMessageId
 */
export function hasUnreadMessages(session: Session): boolean {
  const lastFinalId = getLastFinalAssistantMessageId(session)
  if (!lastFinalId) return false  // No final assistant message yet
  return lastFinalId !== session.lastReadMessageId
}

/**
 * Count the number of unread final assistant messages
 * Returns the count of final assistant messages after lastReadMessageId
 */
export function countUnreadMessages(session: Session): number {
  if (!session.lastReadMessageId) {
    // Never read - count all final assistant messages
    return session.messages.filter(msg => msg.role === 'assistant' && !msg.isIntermediate).length
  }

  // Find the index of the last read message
  const lastReadIndex = session.messages.findIndex(msg => msg.id === session.lastReadMessageId)
  if (lastReadIndex === -1) {
    // Last read message not found - count all final assistant messages
    return session.messages.filter(msg => msg.role === 'assistant' && !msg.isIntermediate).length
  }

  // Count final assistant messages after the last read index
  let count = 0
  for (let i = lastReadIndex + 1; i < session.messages.length; i++) {
    const msg = session.messages[i]
    if (msg.role === 'assistant' && !msg.isIntermediate) {
      count++
    }
  }
  return count
}
