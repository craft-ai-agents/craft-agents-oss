import type { Session } from "../../shared/types"

/**
 * Get display title for a session.
 * Priority: custom name > first user message > preview (from metadata) > agent name > "New chat"
 */
export function getSessionTitle(session: Session): string {
  if (session.name) {
    return session.name
  }

  // Check loaded messages first
  const firstUserMessage = session.messages.find(m => m.role === 'user')
  if (firstUserMessage?.content) {
    const trimmed = firstUserMessage.content.slice(0, 50)
    return trimmed.length < firstUserMessage.content.length
      ? trimmed + '…'
      : trimmed
  }

  // Fall back to preview from JSONL header (for lazy-loaded sessions)
  if (session.preview) {
    const trimmed = session.preview.slice(0, 50)
    return trimmed.length < session.preview.length
      ? trimmed + '…'
      : trimmed
  }

  // For agent sessions, show the agent name instead of generic "New chat"
  if (session.agentName) {
    return session.agentName
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
