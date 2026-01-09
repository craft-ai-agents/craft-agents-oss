/**
 * Session Event Handlers
 *
 * Handles complete, error, sources_changed, etc.
 * Pure functions that return new state - no side effects.
 */

import type {
  SessionState,
  ProcessResult,
  CompleteEvent,
  ErrorEvent,
  TypedErrorEvent,
  SourcesChangedEvent,
  PermissionRequestEvent,
  CredentialRequestEvent,
  PlanSubmittedEvent,
  StatusEvent,
  InfoEvent,
  InterruptedEvent,
  TitleGeneratedEvent,
  WorkingDirectoryChangedEvent,
  PermissionModeChangedEvent,
  AskQuestionRequestEvent,
  UserMessageEvent,
  AgentStatusEvent,
} from '../types'
import type { Message } from '../../../shared/types'
import { generateMessageId, appendMessage } from '../helpers'

/**
 * Handle complete - agent loop finished
 *
 * Sets isProcessing: false, clears streaming state.
 * Also marks any running tools as complete (fail-safe).
 */
export function handleComplete(
  state: SessionState,
  _event: CompleteEvent
): ProcessResult {
  const { session } = state

  // Fail-safe: mark any running tools as complete
  let updatedMessages = session.messages
  const hasRunningTools = session.messages.some(
    m => m.role === 'tool' && m.toolStatus === 'executing'
  )

  if (hasRunningTools) {
    updatedMessages = session.messages.map(m => {
      if (m.role === 'tool' && m.toolStatus === 'executing') {
        return { ...m, toolStatus: 'completed' as const }
      }
      return m
    })
  }

  return {
    state: {
      session: {
        ...session,
        messages: updatedMessages,
        isProcessing: false,
        currentStatus: undefined,  // Clear any lingering status
      },
      streaming: null,
    },
    effects: [],
  }
}

/**
 * Handle error - simple error event
 */
export function handleError(
  state: SessionState,
  event: ErrorEvent
): ProcessResult {
  const { session } = state

  // Fail-safe: Mark any running tools as failed
  const messagesWithFailedTools = session.messages.map(m =>
    m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error'
      ? { ...m, toolStatus: 'error' as const, toolResult: 'Error occurred', isError: true }
      : m
  )

  const errorMessage: Message = {
    id: generateMessageId(),
    role: 'error',
    content: event.error,
    timestamp: Date.now(),
  }

  return {
    state: {
      session: {
        ...session,
        messages: [...messagesWithFailedTools, errorMessage],
        isProcessing: false,
        currentStatus: undefined,  // Clear any lingering status
      },
      streaming: null,
    },
    effects: [],
  }
}

/**
 * Handle typed_error - error with structured details
 */
export function handleTypedError(
  state: SessionState,
  event: TypedErrorEvent
): ProcessResult {
  const { session } = state

  // Fail-safe: Mark any running tools as failed
  const messagesWithFailedTools = session.messages.map(m =>
    m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error'
      ? { ...m, toolStatus: 'error' as const, toolResult: 'Error occurred', isError: true }
      : m
  )

  const errorMessage: Message = {
    id: generateMessageId(),
    role: 'error',
    content: event.error.title
      ? `${event.error.title}: ${event.error.message}`
      : event.error.message,
    timestamp: Date.now(),
    errorCode: event.error.code,
    errorTitle: event.error.title,
    errorDetails: event.error.details,
    errorOriginal: event.error.originalError,
    errorCanRetry: event.error.canRetry,
  }

  return {
    state: {
      session: {
        ...session,
        messages: [...messagesWithFailedTools, errorMessage],
        isProcessing: false,
        currentStatus: undefined,  // Clear any lingering status
      },
      streaming: null,
    },
    effects: [],
  }
}

/**
 * Handle status - status message (e.g., compacting)
 * Stores on session for ProcessingIndicator AND appends as message for TurnCard activity
 */
export function handleStatus(
  state: SessionState,
  event: StatusEvent
): ProcessResult {
  const { session, streaming } = state

  const statusMessage: Message = {
    id: generateMessageId(),
    role: 'status',
    content: event.message,
    timestamp: Date.now(),
    statusType: event.statusType,
  }

  const updatedSession = appendMessage(session, statusMessage)

  return {
    state: {
      session: {
        ...updatedSession,
        // Also store on session for ProcessingIndicator
        currentStatus: {
          message: event.message,
          statusType: event.statusType,
        },
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle info - info message (may update existing compacting message)
 */
export function handleInfo(
  state: SessionState,
  event: InfoEvent
): ProcessResult {
  const { session, streaming } = state

  // If this is a compaction complete, update the existing compacting message and clear currentStatus
  if (event.statusType === 'compaction_complete') {
    const updatedMessages = session.messages.map(m =>
      m.role === 'status' && m.statusType === 'compacting'
        ? { ...m, role: 'info' as const, content: event.message, statusType: 'compaction_complete' as const, infoLevel: event.level }
        : m
    )
    return {
      state: {
        session: {
          ...session,
          messages: updatedMessages,
          currentStatus: undefined,  // Clear status from ProcessingIndicator
        },
        streaming,
      },
      effects: [],
    }
  }

  // Otherwise, add as new info message
  const infoMessage: Message = {
    id: generateMessageId(),
    role: 'info',
    content: event.message,
    timestamp: Date.now(),
    infoLevel: event.level,
  }

  return {
    state: {
      session: appendMessage(session, infoMessage),
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle interrupted - agent was interrupted
 * When message is provided, it's a user-initiated stop (shows "Response interrupted")
 * When message is omitted, it's a silent redirect (user sent new message while processing)
 */
export function handleInterrupted(
  state: SessionState,
  event: InterruptedEvent
): ProcessResult {
  const { session } = state

  // Clear transient streaming state (isPending, isStreaming) and mark running tools as interrupted
  // These fields are not persisted, so this matches the state after a reload
  const updatedMessages = session.messages.map(m => {
    // Mark running tools as interrupted
    if (m.role === 'tool' && m.toolResult === undefined && m.toolStatus !== 'completed' && m.toolStatus !== 'error') {
      return { ...m, toolStatus: 'error' as const, toolResult: 'Interrupted', isError: true }
    }
    // Clear pending state on assistant messages (transient streaming state)
    if (m.role === 'assistant' && m.isPending) {
      return { ...m, isPending: false, isStreaming: false }
    }
    return m
  })

  // Only add the "Response interrupted" message if provided (not a silent redirect)
  const messages = event.message
    ? [...updatedMessages, event.message]
    : updatedMessages

  return {
    state: {
      session: {
        ...session,
        isProcessing: false,
        messages,
        currentStatus: undefined,  // Clear any lingering status
      },
      streaming: null,
    },
    effects: [],
  }
}

/**
 * Handle title_generated - update session title
 */
export function handleTitleGenerated(
  state: SessionState,
  event: TitleGeneratedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: { ...session, name: event.title },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle working_directory_changed - update session working directory (user-initiated via UI)
 */
export function handleWorkingDirectoryChanged(
  state: SessionState,
  event: WorkingDirectoryChangedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: { ...session, workingDirectory: event.workingDirectory },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle permission_mode_changed - return effect for parent to handle session options
 */
export function handlePermissionModeChanged(
  state: SessionState,
  event: PermissionModeChangedEvent
): ProcessResult {
  return {
    state,
    effects: [{
      type: 'permission_mode_changed',
      sessionId: event.sessionId,
      permissionMode: event.permissionMode,
    }],
  }
}

/**
 * Handle ask_question_request - return effect for parent to handle
 */
export function handleAskQuestionRequest(
  state: SessionState,
  event: AskQuestionRequestEvent
): ProcessResult {
  return {
    state,
    effects: [{
      type: 'ask_question_request',
      sessionId: event.sessionId,
      request: event.request,
    }],
  }
}

/**
 * Handle user_message - confirms optimistic user message from backend
 *
 * Three statuses:
 * - 'accepted': Message is being processed (confirms optimistic message)
 * - 'queued': Message was queued during ongoing response (adds if not present, marks as queued)
 * - 'processing': Queued message is now being processed (updates status)
 */
export function handleUserMessage(
  state: SessionState,
  event: UserMessageEvent
): ProcessResult {
  const { session, streaming } = state
  const { message, status } = event

  // Find existing message by content + timestamp match (for optimistic updates)
  // or by ID (for queued messages where backend created the ID)
  const existingIndex = session.messages.findIndex(m =>
    m.role === 'user' && (
      m.id === message.id ||
      (m.content === message.content && Math.abs(m.timestamp - message.timestamp) < 5000)
    )
  )

  let updatedMessages: Message[]

  if (existingIndex >= 0) {
    // Update existing message - remove isPending, add isQueued if status is 'queued'
    updatedMessages = session.messages.map((m, i) => {
      if (i === existingIndex) {
        return {
          ...m,
          id: message.id,  // Use backend's ID as canonical
          isPending: false,
          isQueued: status === 'queued',
        }
      }
      return m
    })
  } else {
    // Message not found (e.g., queued message from backend) - add it
    const newMessage: Message = {
      ...message,
      isPending: false,
      isQueued: status === 'queued',
    }
    updatedMessages = [...session.messages, newMessage]
  }

  return {
    state: {
      session: {
        ...session,
        messages: updatedMessages,
        lastMessageAt: Date.now(),
        // Set isProcessing when message is accepted/processing (enables multi-window sync)
        isProcessing: status === 'accepted' || status === 'processing',
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle sources_changed - update session's enabled sources
 */
export function handleSourcesChanged(
  state: SessionState,
  event: SourcesChangedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        enabledSourceSlugs: event.enabledSourceSlugs,
      },
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle permission_request - return effect for parent to handle
 */
export function handlePermissionRequest(
  state: SessionState,
  event: PermissionRequestEvent
): ProcessResult {
  return {
    state,
    effects: [{
      type: 'permission_request',
      request: event.request,
    }]
  }
}

/**
 * Handle credential_request - return effect for parent to handle
 */
export function handleCredentialRequest(
  state: SessionState,
  event: CredentialRequestEvent
): ProcessResult {
  return {
    state,
    effects: [{
      type: 'credential_request',
      request: event.request,
    }]
  }
}

/**
 * Handle plan_submitted - add plan message to session
 */
export function handlePlanSubmitted(
  state: SessionState,
  event: PlanSubmittedEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: appendMessage(session, event.message),
      streaming,
    },
    effects: [],
  }
}

/**
 * Handle agent_status - update agent status on session
 * This is informational; the actual agent state is managed by useAgentState hook
 */
export function handleAgentStatus(
  state: SessionState,
  event: AgentStatusEvent
): ProcessResult {
  const { session, streaming } = state

  return {
    state: {
      session: {
        ...session,
        agentStatus: event.status,
      },
      streaming,
    },
    effects: [],
  }
}
