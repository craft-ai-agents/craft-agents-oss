/**
 * Tool Event Handlers
 *
 * Handles tool_start and tool_result events.
 * Pure functions that return new state - no side effects.
 */

import type { SessionState, ToolStartEvent, ToolResultEvent, ParentUpdateEvent, TaskBackgroundedEvent, ShellBackgroundedEvent, TaskProgressEvent } from '../types'
import type { Message } from '../../../shared/types'
import {
  findToolMessage,
  updateMessageAt,
  appendMessage,
  generateMessageId
} from '../helpers'

/**
 * Handle tool_start - create or update tool message
 *
 * SDK sends two events per tool: first from stream_event (empty input),
 * second from assistant message (complete input). We handle both.
 */
export function handleToolStart(
  state: SessionState,
  event: ToolStartEvent
): SessionState {
  const { session, streaming } = state

  // Check if tool message already exists (SDK sends two events)
  const existingIndex = findToolMessage(session.messages, event.toolUseId)

  if (existingIndex !== -1) {
    // Update with complete input (second event has full input)
    const updatedSession = updateMessageAt(session, existingIndex, {
      toolInput: event.toolInput,
      toolIntent: event.toolIntent,
      toolDisplayName: event.toolDisplayName,
      toolDisplayMeta: event.toolDisplayMeta,
      turnId: event.turnId,
      parentToolUseId: event.parentToolUseId,
    })
    return { session: updatedSession, streaming }
  }

  // Create new tool message
  const toolMessage: Message = {
    id: generateMessageId(),
    role: 'tool',
    content: '',
    timestamp: Date.now(),
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    toolInput: event.toolInput,
    toolStatus: 'executing',
    turnId: event.turnId,
    parentToolUseId: event.parentToolUseId,
    toolIntent: event.toolIntent,
    toolDisplayName: event.toolDisplayName,
    toolDisplayMeta: event.toolDisplayMeta,
  }

  return {
    session: appendMessage(session, toolMessage),
    streaming,
  }
}

/**
 * Handle tool_result - complete tool execution
 *
 * Updates the tool message with result. If tool not found (out-of-order),
 * creates the tool message with result included.
 */
export function handleToolResult(
  state: SessionState,
  event: ToolResultEvent
): SessionState {
  const { session, streaming } = state

  const toolIndex = findToolMessage(session.messages, event.toolUseId)

  if (toolIndex !== -1) {
    // Update existing tool message
    const updatedSession = updateMessageAt(session, toolIndex, {
      toolResult: event.result,
      toolStatus: 'completed',
      isError: event.isError,
    })
    return { session: updatedSession, streaming }
  }

  // Tool not found - create it with result
  // This handles out-of-order events where result arrives before start
  const toolMessage: Message = {
    id: generateMessageId(),
    role: 'tool',
    content: '',
    timestamp: Date.now(),
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    toolResult: event.result,
    toolStatus: 'completed',
    isError: event.isError,
    turnId: event.turnId,
    parentToolUseId: event.parentToolUseId,
  }

  return {
    session: appendMessage(session, toolMessage),
    streaming,
  }
}

/**
 * Handle parent_update - deferred parent assignment
 *
 * When multiple parent tools (Tasks) are active at tool_start time, we can't
 * determine the correct parent. This event assigns the correct parent once
 * the tool result arrives with the authoritative parent_tool_use_id from SDK.
 */
export function handleParentUpdate(
  state: SessionState,
  event: ParentUpdateEvent
): SessionState {
  const { session, streaming } = state

  const toolIndex = findToolMessage(session.messages, event.toolUseId)

  if (toolIndex !== -1) {
    // Update the tool message with correct parent
    const updatedSession = updateMessageAt(session, toolIndex, {
      parentToolUseId: event.parentToolUseId,
    })
    return { session: updatedSession, streaming }
  }

  // Tool not found - shouldn't happen, but return state unchanged
  return state
}

/**
 * Handle task_backgrounded - mark tool as backgrounded with task ID
 *
 * When a Task is executed with run_in_background: true, the SDK returns
 * immediately with an agentId. This event updates the tool message status
 * to 'backgrounded' and stores the taskId for later polling via TaskOutput.
 */
export function handleTaskBackgrounded(
  state: SessionState,
  event: TaskBackgroundedEvent
): SessionState {
  const { session, streaming } = state

  const toolIndex = findToolMessage(session.messages, event.toolUseId)

  if (toolIndex !== -1) {
    // Update tool status to backgrounded and add task ID
    const updatedSession = updateMessageAt(session, toolIndex, {
      toolStatus: 'backgrounded',
      taskId: event.taskId,
      isBackground: true,
    })
    return { session: updatedSession, streaming }
  }

  // Tool not found - shouldn't happen, but return state unchanged
  return state
}

/**
 * Handle shell_backgrounded - mark shell as backgrounded with shell ID
 *
 * When a Bash command is executed with run_in_background: true, the SDK
 * returns immediately with a shell_id. This event updates the tool message
 * status to 'backgrounded' and stores the shellId for later reference.
 */
export function handleShellBackgrounded(
  state: SessionState,
  event: ShellBackgroundedEvent
): SessionState {
  const { session, streaming } = state

  const toolIndex = findToolMessage(session.messages, event.toolUseId)

  if (toolIndex !== -1) {
    // Update tool status to backgrounded and add shell ID
    const updatedSession = updateMessageAt(session, toolIndex, {
      toolStatus: 'backgrounded',
      shellId: event.shellId,
      isBackground: true,
    })
    return { session: updatedSession, streaming }
  }

  // Tool not found - shouldn't happen, but return state unchanged
  return state
}

/**
 * Handle task_progress - update elapsed time for background task
 *
 * The SDK emits tool_progress events with elapsed_time_seconds for
 * background tasks. This event updates the elapsedSeconds field on
 * the tool message to display live progress in the UI.
 */
export function handleTaskProgress(
  state: SessionState,
  event: TaskProgressEvent
): SessionState {
  const { session, streaming } = state

  const toolIndex = findToolMessage(session.messages, event.toolUseId)

  if (toolIndex !== -1) {
    // Update elapsed time for live progress display
    const updatedSession = updateMessageAt(session, toolIndex, {
      elapsedSeconds: event.elapsedSeconds,
    })
    return { session: updatedSession, streaming }
  }

  // Tool not found - shouldn't happen, but return state unchanged
  return state
}
