/**
 * Event Processor Types
 *
 * Defines the state and event types for the centralized event processor.
 * All agent events flow through a single pure function for consistent state transitions.
 */

import type { Session, Message, PermissionRequest, CredentialRequest, TypedError, PermissionMode, AskQuestionRequest, TodoState, AgentStatus } from '../../shared/types'

/**
 * Streaming state for a session - replaces streamingTextRef
 */
export interface StreamingState {
  content: string
  turnId?: string
  parentToolUseId?: string
}

/**
 * Complete state for a session - combines session + streaming
 */
export interface SessionState {
  session: Session
  streaming: StreamingState | null
}

/**
 * Text delta event - streaming text content
 */
export interface TextDeltaEvent {
  type: 'text_delta'
  sessionId: string
  delta: string
  turnId?: string
}

/**
 * Text complete event - finalizes streaming text
 */
export interface TextCompleteEvent {
  type: 'text_complete'
  sessionId: string
  text: string
  turnId?: string
  isIntermediate?: boolean
  parentToolUseId?: string
}

/**
 * Tool start event - begins tool execution
 * Field names match SessionEvent from shared/types.ts
 */
export interface ToolStartEvent {
  type: 'tool_start'
  sessionId: string
  toolUseId: string
  toolName: string
  toolInput?: Record<string, unknown>
  turnId?: string
  parentToolUseId?: string
  toolIntent?: string
  toolDisplayName?: string
}

/**
 * Tool result event - completes tool execution
 */
export interface ToolResultEvent {
  type: 'tool_result'
  sessionId: string
  toolUseId: string
  toolName?: string
  result: string
  isError?: boolean
  turnId?: string
  parentToolUseId?: string
}

/**
 * Parent update event - deferred parent assignment
 * When multiple parent tools (Tasks) are active, we can't determine the correct
 * parent at tool_start time. This event assigns the correct parent once we know it.
 */
export interface ParentUpdateEvent {
  type: 'parent_update'
  sessionId: string
  toolUseId: string
  parentToolUseId: string
}

/**
 * Complete event - agent loop finished
 */
export interface CompleteEvent {
  type: 'complete'
  sessionId: string
}

/**
 * Error event - agent error occurred
 */
export interface ErrorEvent {
  type: 'error'
  sessionId: string
  error: string
  code?: string
  title?: string
  details?: string
  original?: string
}

/**
 * Permission request event
 * Matches SessionEvent shape from shared/types.ts
 */
export interface PermissionRequestEvent {
  type: 'permission_request'
  sessionId: string
  request: PermissionRequest
}

/**
 * Sources changed event
 */
export interface SourcesChangedEvent {
  type: 'sources_changed'
  sessionId: string
  enabledSourceSlugs: string[]
}

/**
 * Plan submitted event
 */
export interface PlanSubmittedEvent {
  type: 'plan_submitted'
  sessionId: string
  message: Message
}

/**
 * Typed error event
 */
export interface TypedErrorEvent {
  type: 'typed_error'
  sessionId: string
  error: TypedError
}

/**
 * Status event
 */
export interface StatusEvent {
  type: 'status'
  sessionId: string
  message: string
  statusType?: 'compacting'
}

/**
 * Info event
 */
export interface InfoEvent {
  type: 'info'
  sessionId: string
  message: string
  statusType?: 'compaction_complete'
  level?: 'info' | 'warning' | 'error' | 'success'
}

/**
 * Interrupted event
 */
export interface InterruptedEvent {
  type: 'interrupted'
  sessionId: string
  message: Message
}

/**
 * Title generated event
 */
export interface TitleGeneratedEvent {
  type: 'title_generated'
  sessionId: string
  title: string
}

/**
 * Working directory changed event
 */
export interface WorkingDirectoryChangedEvent {
  type: 'working_directory_changed'
  sessionId: string
  workingDirectory: string
}

/**
 * Permission mode changed event
 */
export interface PermissionModeChangedEvent {
  type: 'permission_mode_changed'
  sessionId: string
  permissionMode: PermissionMode
}

/**
 * Ask question request event
 */
export interface AskQuestionRequestEvent {
  type: 'ask_question_request'
  sessionId: string
  request: AskQuestionRequest
}

/**
 * Credential request event - prompts user for credentials
 */
export interface CredentialRequestEvent {
  type: 'credential_request'
  sessionId: string
  request: CredentialRequest
}

/**
 * Task backgrounded event - background agent started
 */
export interface TaskBackgroundedEvent {
  type: 'task_backgrounded'
  sessionId: string
  toolUseId: string
  taskId: string
  intent?: string
  turnId?: string
}

/**
 * Shell backgrounded event - background bash shell started
 */
export interface ShellBackgroundedEvent {
  type: 'shell_backgrounded'
  sessionId: string
  toolUseId: string
  shellId: string
  intent?: string
  turnId?: string
}

/**
 * Task progress event - live progress updates for background tasks
 */
export interface TaskProgressEvent {
  type: 'task_progress'
  sessionId: string
  toolUseId: string
  elapsedSeconds: number
  turnId?: string
}

/**
 * User message event - backend confirmation of optimistic user message
 * Used for optimistic UI: frontend shows message immediately,
 * backend confirms/updates status via this event
 */
export interface UserMessageEvent {
  type: 'user_message'
  sessionId: string
  message: Message
  status: 'accepted' | 'queued' | 'processing'
}

/**
 * Agent status event - updates agent state (idle, extracting, ready, etc.)
 */
export interface AgentStatusEvent {
  type: 'agent_status'
  sessionId: string
  status: AgentStatus
}

/**
 * Union of all agent events
 */
export type AgentEvent =
  | TextDeltaEvent
  | TextCompleteEvent
  | ToolStartEvent
  | ToolResultEvent
  | ParentUpdateEvent
  | CompleteEvent
  | ErrorEvent
  | TypedErrorEvent
  | PermissionRequestEvent
  | CredentialRequestEvent
  | SourcesChangedEvent
  | PlanSubmittedEvent
  | StatusEvent
  | InfoEvent
  | InterruptedEvent
  | TitleGeneratedEvent
  | WorkingDirectoryChangedEvent
  | PermissionModeChangedEvent
  | AskQuestionRequestEvent
  | TaskBackgroundedEvent
  | ShellBackgroundedEvent
  | TaskProgressEvent
  | UserMessageEvent
  | AgentStatusEvent

/**
 * Side effects that need to be handled outside the pure processor
 */
export type Effect =
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'credential_request'; request: CredentialRequest }
  | { type: 'generate_title'; sessionId: string; userMessage: string }
  | { type: 'permission_mode_changed'; sessionId: string; permissionMode: PermissionMode }
  | { type: 'ask_question_request'; sessionId: string; request: AskQuestionRequest }

/**
 * Result of processing an event
 */
export interface ProcessResult {
  state: SessionState
  /** Side effects to execute (permissions, etc.) */
  effects: Effect[]
}
