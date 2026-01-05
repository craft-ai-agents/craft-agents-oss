/**
 * Text Event Handlers
 *
 * Handles text_delta and text_complete events.
 * Pure functions that return new state - no side effects.
 */

import type { SessionState, StreamingState, TextDeltaEvent, TextCompleteEvent } from '../types'
import type { Message } from '../../../shared/types'
import {
  findStreamingMessage,
  findAssistantMessage,
  updateMessageAt,
  appendMessage,
  generateMessageId
} from '../helpers'

/**
 * Handle text_delta - accumulate streaming content
 *
 * Creates a new streaming message if none exists, otherwise updates existing.
 * Uses turnId for lookup, never position.
 */
export function handleTextDelta(
  state: SessionState,
  event: TextDeltaEvent
): SessionState {
  const { session, streaming } = state

  // Accumulate in streaming state
  const newStreaming: StreamingState = streaming
    ? {
        ...streaming,
        content: streaming.content + event.delta,
        turnId: event.turnId ?? streaming.turnId
      }
    : {
        content: event.delta,
        turnId: event.turnId
      }

  // Find existing streaming message by turnId
  const streamingIndex = findStreamingMessage(session.messages, event.turnId)

  if (streamingIndex !== -1) {
    // Message exists - update its content
    const currentMsg = session.messages[streamingIndex]
    const updatedSession = updateMessageAt(session, streamingIndex, {
      content: currentMsg.content + event.delta,
    })
    return { session: updatedSession, streaming: newStreaming }
  }

  // No streaming message found - create new one
  // Don't update lastMessageAt for streaming messages (they're intermediate)
  const newMessage: Message = {
    id: generateMessageId(),
    role: 'assistant',
    content: event.delta,
    timestamp: Date.now(),
    isStreaming: true,
    isPending: true,
    turnId: event.turnId,
  }

  return {
    session: appendMessage(session, newMessage, false),
    streaming: newStreaming,
  }
}

/**
 * Handle text_complete - finalize the streaming message
 *
 * Sets isStreaming: false, isPending: false.
 * If message not found, CREATES it (fixes race condition bug).
 * Uses complete text from SDK (event.text), not accumulated content.
 */
export function handleTextComplete(
  state: SessionState,
  event: TextCompleteEvent
): SessionState {
  const { session } = state

  // Find message by turnId (try streaming first, then any assistant)
  let msgIndex = findStreamingMessage(session.messages, event.turnId)
  if (msgIndex === -1) {
    msgIndex = findAssistantMessage(session.messages, event.turnId)
  }

  if (msgIndex !== -1) {
    // Update existing message with final content
    // Only update lastMessageAt for final (non-intermediate) messages
    const shouldUpdateTimestamp = !event.isIntermediate
    const updatedSession = updateMessageAt(session, msgIndex, {
      content: event.text,  // Complete text from SDK
      isStreaming: false,
      isPending: false,
      isIntermediate: event.isIntermediate,
      turnId: event.turnId,
      parentToolUseId: event.parentToolUseId,
    }, shouldUpdateTimestamp)
    return { session: updatedSession, streaming: null }
  }

  // Message not found - CREATE IT
  // This handles the race condition where text_complete arrives
  // before text_delta's setSessions has been processed
  const newMessage: Message = {
    id: generateMessageId(),
    role: 'assistant',
    content: event.text,
    timestamp: Date.now(),
    isStreaming: false,
    isPending: false,
    isIntermediate: event.isIntermediate,
    turnId: event.turnId,
    parentToolUseId: event.parentToolUseId,
  }

  // Only update lastMessageAt for final (non-intermediate) messages
  const shouldUpdateTimestamp = !event.isIntermediate

  return {
    session: appendMessage(session, newMessage, shouldUpdateTimestamp),
    streaming: null,
  }
}
