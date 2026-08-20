/**
 * Thinking Event Handlers
 *
 * Handles thinking_delta and thinking_complete events (OMP reasoning models,
 * e.g. kimi-k3 reasoning:true).
 *
 * Runtime-only: the resulting messages have role 'thinking' and stay inside
 * the renderer state — the main process never pushes them into
 * managed.messages or session.jsonl (see SessionManager.processEvent).
 * Pure functions that return new state - no side effects.
 */

import type { SessionState, ThinkingDeltaEvent, ThinkingCompleteEvent } from '../types'
import type { Message } from '../../../shared/types'
import {
  updateMessageAt,
  appendMessage,
  generateMessageId
} from '../helpers'

/**
 * Find thinking message by turnId (mirrors findStreamingMessage convention),
 * falling back to the last still-streaming thinking block.
 */
function findThinkingMessage(
  messages: Message[],
  turnId?: string
): number {
  if (turnId) {
    const index = messages.findIndex(m =>
      m.role === 'thinking' && m.turnId === turnId
    )
    if (index !== -1) return index
  }
  // Fallback: find last streaming thinking message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'thinking' && messages[i].isStreaming) {
      return i
    }
  }
  return -1
}

/**
 * Handle thinking_delta - accumulate streaming reasoning content.
 *
 * Creates a new thinking message if none exists, otherwise updates existing.
 * Uses turnId for lookup, never position.
 */
export function handleThinkingDelta(
  state: SessionState,
  event: ThinkingDeltaEvent
): SessionState {
  const { session, streaming } = state

  const index = findThinkingMessage(session.messages, event.turnId)

  if (index !== -1) {
    const currentMsg = session.messages[index]
    const updatedSession = updateMessageAt(session, index, {
      content: currentMsg.content + event.text,
    })
    return { session: updatedSession, streaming }
  }

  // No thinking message found - create new one
  // Don't update lastMessageAt for streaming messages (they're intermediate)
  const newMessage: Message = {
    id: generateMessageId(),
    role: 'thinking',
    content: event.text,
    timestamp: Date.now(),
    isStreaming: true,
    isPending: true,
    turnId: event.turnId,
  }

  return {
    session: appendMessage(session, newMessage, false),
    streaming,
  }
}

/**
 * Handle thinking_complete - finalize the thinking block.
 *
 * Sets isStreaming: false, isPending: false — the UI card force-collapses.
 * Uses complete text from backend (event.text), not accumulated content.
 */
export function handleThinkingComplete(
  state: SessionState,
  event: ThinkingCompleteEvent
): SessionState {
  const { session, streaming } = state

  const index = findThinkingMessage(session.messages, event.turnId)

  if (index !== -1) {
    const existingMsg = session.messages[index]
    const updatedSession = updateMessageAt(session, index, {
      // Prefer authoritative complete text; keep accumulated as fallback
      content: event.text || existingMsg.content,
      isStreaming: false,
      isPending: false,
      turnId: event.turnId,
    })
    return { session: updatedSession, streaming }
  }

  // Message not found - CREATE IT (race: complete before delta's setSessions)
  const newMessage: Message = {
    id: generateMessageId(),
    role: 'thinking',
    content: event.text,
    timestamp: Date.now(),
    isStreaming: false,
    isPending: false,
    turnId: event.turnId,
  }

  return {
    session: appendMessage(session, newMessage, false),
    streaming,
  }
}
