/**
 * Server DTO types — data shapes used by RPC handlers and SessionManager.
 *
 * These were previously in apps/electron/src/shared/types.ts.
 * Extracted here so handler code in @archstudio/server-core can import
 * from @archstudio/shared/protocol without reaching into the app.
 */

import type {
  Message,
  TypedError,
  ContentBadge,
  ToolDisplayMeta,
  AnnotationV1,
  PermissionRequest as BasePermissionRequest,
} from '@archstudio/core/types'
import type { PermissionMode } from '../agent/mode-types'
import type { ThinkingLevel } from '../agent/thinking-levels'
import type { CustomEndpointConfig } from '../config/llm-connections'
import type {
  AuthRequest as SharedAuthRequest,
  CredentialInputMode as SharedCredentialInputMode,
  CredentialAuthRequest as SharedCredentialAuthRequest,
} from '../agent/index'

// Re-export generateMessageId for handler convenience
export { generateMessageId } from '@archstudio/core/types'

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

/**
 * Dynamic status ID referencing workspace status config.
 * Validated at runtime via validateSessionStatus().
 * Falls back to 'todo' if status doesn't exist.
 */
export type SessionStatus = string

export type BuiltInStatusId = 'todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled'

/**
 * Electron-specific Session type (includes runtime state).
 * Extends core Session with messages array and processing state.
 */
export interface Session {
  id: string
  workspaceId: string
  workspaceName: string
  name?: string
  /** Preview of first user message (from JSONL header, for lazy-loaded sessions) */
  preview?: string
  lastMessageAt: number
  messages: Message[]
  isProcessing: boolean
  isFlagged?: boolean
  /** Permission mode for this session ('safe', 'ask', 'allow-all') */
  permissionMode?: PermissionMode
  sessionStatus?: SessionStatus
  /** Labels (additive tags, many-per-session — bare IDs or "id::value" entries) */
  labels?: string[]
  lastReadMessageId?: string
  /**
   * Explicit unread flag - single source of truth for NEW badge.
   * Set to true when assistant message completes while user is NOT viewing.
   * Set to false when user views the session (and not processing).
   */
  hasUnread?: boolean
  enabledSourceSlugs?: string[]
  workingDirectory?: string
  sessionFolderPath?: string
  sharedUrl?: string
  sharedId?: string
  model?: string
  llmConnection?: string
  thinkingLevel?: ThinkingLevel
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error'
  lastFinalMessageId?: string
  isAsyncOperationOngoing?: boolean
  /** @deprecated Use isAsyncOperationOngoing instead */
  isRegeneratingTitle?: boolean
  currentStatus?: {
    message: string
    statusType?: string
  }
  createdAt?: number
  messageCount?: number
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    contextTokens: number
    costUsd: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    /** Model's context window size in tokens (from SDK modelUsage) */
    contextWindow?: number
  }
  /** When true, session is hidden from session list (e.g., mini edit sessions) */
  hidden?: boolean
  isArchived?: boolean
  archivedAt?: number
  supportsBranching?: boolean
  /** Workspace-scoped project id this session is bound to (undefined = unbound) */
  projectId?: string
  /** Parent session id — when set, this session is a subtask of the parent (undefined = top-level task) */
  parentSessionId?: string
  /** Kanban board column id ('todo' | 'in-progress' | 'done'); independent of sessionStatus */
  kanbanColumn?: string
  /** Tasks Conductor: slug of the task spec this session belongs to. */
  taskSlug?: string
  /** Tasks Conductor: id of the run that spawned this child session (child nodes only). */
  taskRunId?: string
  /** Tasks Conductor: id of the DAG node this child session executes (child nodes only). */
  taskNodeId?: string
  /** Tasks Conductor: total DAG node count (orchestrator only) — stable board progress denominator. */
  taskNodeCount?: number
  /** Tasks Conductor: generate-time draft orchestrator, hidden from the board until adopted by createTask. */
  taskDraft?: boolean
}

export interface CreateSessionOptions {
  name?: string
  permissionMode?: PermissionMode
  /**
   * Reasoning/thinking level override. When set, takes precedence over workspace
   * and global defaults. Silently ignored by the underlying SDK on non-reasoning
   * models (e.g. gpt-4o) — provider drivers don't attach the reasoning param to
   * the API request for models with `reasoning: false` in the Pi SDK catalog.
   */
  thinkingLevel?: ThinkingLevel
  /**
   * Working directory for the session:
   * - 'user_default' or undefined: Use workspace's configured default working directory
   * - 'none': No working directory (session folder only)
   * - Absolute path string: Use this specific path
   */
  workingDirectory?: string | 'user_default' | 'none'
  model?: string
  llmConnection?: string
  systemPromptPreset?: 'default' | 'mini' | string
  hidden?: boolean
  sessionStatus?: SessionStatus
  labels?: string[]
  isFlagged?: boolean
  enabledSourceSlugs?: string[]
  /**
   * Message ID to branch from. This is a hard context cutoff:
   * the new session must not include model context from later parent messages.
   */
  branchFromMessageId?: string
  /** Parent session ID used together with branchFromMessageId. */
  branchFromSessionId?: string
  /** Bind the new session to a workspace project (inherits project's workingDirectory). */
  projectId?: string
  /** Mark the new session as a subtask of this parent session (undefined = top-level task). */
  parentSessionId?: string
  /** Tasks Conductor: slug of the task spec this session belongs to (orchestrator + child nodes). */
  taskSlug?: string
  /** Tasks Conductor: id of the run that spawned this child session (child nodes only). */
  taskRunId?: string
  /** Tasks Conductor: id of the DAG node this child session executes (child nodes only). */
  taskNodeId?: string
  /** Tasks Conductor: mark the orchestrator as a generate-time draft (hidden until adopted by createTask). */
  taskDraft?: boolean
  /**
   * Apply the reserved "Task" label (valueType 'number') after creation. Top-level sessions
   * allocate the next task number; sessions with a `parentSessionId` inherit the parent's
   * number (labeling a plain-chat parent in the same pass). Task flows opt in; plain chats don't.
   */
  applyTaskLabel?: boolean
}

export interface RemoteSessionTransferPayload {
  sourceSessionId: string
  name?: string
  sessionStatus?: SessionStatus
  labels?: string[]
  permissionMode?: PermissionMode
  summary: string
}

export interface ImportRemoteSessionTransferResult {
  sessionId: string
}

// ---------------------------------------------------------------------------
// Tasks (Conductor) DTOs — wire contract for the tasks:* channels.
// ---------------------------------------------------------------------------

export interface TaskValidationIssueDto {
  /** Dotted path into the spec, e.g. "nodes.design.depends_on". */
  path: string
  message: string
  severity: 'error' | 'warning'
  suggestion?: string
}

export interface TaskValidationResultDto {
  valid: boolean
  errors: TaskValidationIssueDto[]
  warnings: TaskValidationIssueDto[]
  /** Pre-flight estimate: total nodes and how many sessions a run would spawn. */
  estimate?: { nodeCount: number; sessionNodeCount: number }
}

export interface TaskCreateRequest {
  /** task.yaml source text (authoritative). */
  yaml: string
  /**
   * When this YAML was authored by a `tasks:generate` orchestrator, the id of that hidden
   * draft session. tasks:create promotes it in place (clears taskDraft, binds taskSlug)
   * instead of minting a second top-level session — preventing duplicate board tiles (#bug1).
   * Only honored when the draft is still unadopted and its slug matches; otherwise ignored.
   */
  orchestratorSessionId?: string
  /**
   * Edit-mode bind: the id of an existing, board-visible session (e.g. a quick-add tile) that the
   * user is saving this spec onto. tasks:create calls `bindExistingSessionToTask` and HARD-ERRORS
   * if the bind fails — it must never fall through to minting a fresh orchestrator (that would
   * leave a duplicate tile). Distinct from `orchestratorSessionId`, which adopts a hidden draft.
   */
  attachToExistingSession?: string
}

export interface TaskCreateResult {
  /** Empty string when validation failed — inspect `validation`. */
  slug: string
  /** The persistent parent/orchestrator session (author + final verifier). */
  orchestratorSessionId: string
  validation: TaskValidationResultDto
  /**
   * Resolved id of the reserved "Task" label applied to the orchestrator. May differ from the
   * literal 'task' (a user-owned label with that name forces a fresh slug like 'task-2'), so
   * navigation/filtering MUST use this id. Undefined when label application failed (fail-soft).
   */
  taskLabelId?: string
}

export interface TaskGenerateRequest {
  /** Natural-language goal the orchestrator turns into a task.yaml DAG. */
  goal: string
  /** Optional working title for the task / orchestrator session. */
  title?: string
  /** Optional model for the orchestrator session (defaults to the session default). */
  model?: string
  /** Optional working directory for the orchestrator session (defaults to project/workspace cwd). */
  cwd?: string
  /** Project to bind the draft orchestrator to, so it authors against the project's `<project_context>`. */
  projectId?: string
  /**
   * LLM connection slug that serves `model`. Required for non-default (e.g. pi/*) models — without it
   * the authoring turn can't resolve a backend and completes instantly with no output (invalid spec).
   */
  llmConnection?: string
  /** Task-level source slugs the draft orchestrator may author against (omitted → workspace default). */
  enabledSourceSlugs?: string[]
  /** Permission mode for the draft orchestrator, so its authoring turn matches the task's chosen
   *  autonomy from the start instead of running at the workspace default until adoption. */
  permissionMode?: PermissionMode
}

/**
 * Synchronous ack for `tasks:generate`. The orchestrator session is created immediately
 * (cheap) and returned right away; the authored spec arrives later via the `tasks:generated`
 * push event. This keeps the RPC well under the uniform client timeout even when authoring
 * takes longer than the request budget.
 */
export interface TaskGenerateAck {
  /** The persistent orchestrator session, reachable immediately so its work is never lost. */
  orchestratorSessionId: string
}

export interface TaskGenerateResult {
  /** The persistent orchestrator session that authored the spec (also handles revisions). */
  orchestratorSessionId: string
  /** Slug of the authored spec; empty when generation produced an invalid spec. */
  slug: string
  /** Parsed TaskSpec when valid (consumers cast to TaskSpec from @archstudio/shared/tasks). */
  spec?: unknown
  /** The raw task.yaml the orchestrator produced — shown and editable in the editor. */
  yaml: string
  validation: TaskValidationResultDto
  /** Set when generation failed before producing a spec (e.g. orchestrator turn errored/timed out). */
  error?: string
}

export interface TaskRunRequest {
  slug: string
  runId?: string
  orchestratorSessionId?: string
  params?: Record<string, unknown>
}

export interface TaskNodeRunStateDto {
  id: string
  /** pending | running | done | failed | cancelled | skipped */
  state: string
  sessionId?: string
  attempt: number
}

export interface TaskRunSnapshotDto {
  slug: string
  runId: string
  taskId: string
  /** running | paused | verifying | stopped | completed | failed */
  status: string
  orchestratorSessionId?: string
  nodes: TaskNodeRunStateDto[]
  /** Sum of each child's (input + output) tokens observed at completion. */
  tokensUsed: number
}

export interface TaskGetResult {
  slug: string
  validation: TaskValidationResultDto
  /** The parsed TaskSpec (from @archstudio/shared/tasks) when valid; consumers cast. */
  spec?: unknown
  /** Active run snapshot when a runId was supplied and known; otherwise null. */
  run?: TaskRunSnapshotDto | null
}

/** One subtask's outcome in a completed/persisted run, for the editor's Results tab. */
export interface TaskResultNodeDto {
  id: string
  title: string
  /** pending | running | done | failed | cancelled | skipped */
  state: string
  /** The child session that ran this node, recovered from the run log (drill-in link). */
  sessionId?: string
  /** The node's recorded final output text (from nodes/<id>.json), when present. */
  output?: string
}

/**
 * Storage-backed read of a task run's outcome — verdict + per-node final output, recovered from
 * the persisted run artifacts (run-log.jsonl, nodes/<id>.json, per-run spec.json snapshot). Unlike
 * `TaskRunSnapshotDto` this survives restart and does not require an active in-memory run.
 */
export interface TaskResultsDto {
  slug: string
  /** The run inspected; null when the task has never been run. */
  runId: string | null
  /** All run ids for this task (newest last), for a run picker. */
  runIds: string[]
  /** The most recent verdict (kept for back-compat with single-verdict consumers). */
  verdict?: { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] }
  /** Every verdict in order (a FAIL→repair loop produces several), for the Results history view. */
  verdicts?: { result: 'pass' | 'fail' | 'unparsed'; reason?: string; nodes?: string[] }[]
  /** Repair-loop accounting: attempts consumed (= count of FAIL verdicts) and the resolved cap. */
  repair?: { used: number; max: number }
  /** Terminal run status recovered from the run-log (completed | failed | stopped | …). */
  runStatus?: string
  /** The run's acceptance criteria (from the per-run spec snapshot), shown above the verdict. */
  acceptanceCriteria?: string
  nodes: TaskResultNodeDto[]
}

export interface PermissionModeState {
  permissionMode: PermissionMode
  previousPermissionMode?: PermissionMode
  transitionDisplay?: string
  modeVersion: number
  changedAt: string
  changedBy: 'user' | 'system' | 'restore' | 'automation' | 'unknown'
}

// ---------------------------------------------------------------------------
// Session events (main → renderer)
// ---------------------------------------------------------------------------

// turnId: Correlation ID from the API's message.id, groups all events in an assistant turn
export type SessionEvent =
  | { type: 'text_delta'; sessionId: string; delta: string; turnId?: string }
  | { type: 'text_complete'; sessionId: string; text: string; isIntermediate?: boolean; turnId?: string; parentToolUseId?: string; timestamp?: number; messageId?: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; toolUseId: string; toolInput: Record<string, unknown>; toolIntent?: string; toolDisplayName?: string; toolDisplayMeta?: ToolDisplayMeta; turnId?: string; parentToolUseId?: string; timestamp?: number }
  | { type: 'tool_result'; sessionId: string; toolUseId: string; toolName: string; result: string; turnId?: string; parentToolUseId?: string; isError?: boolean; timestamp?: number }
  | { type: 'error'; sessionId: string; error: string; timestamp?: number }
  | { type: 'typed_error'; sessionId: string; error: TypedError; timestamp?: number }
  | { type: 'complete'; sessionId: string; tokenUsage?: Session['tokenUsage']; hasUnread?: boolean; backgroundTasksAlive?: boolean }
  | { type: 'interrupted'; sessionId: string; message?: Message; queuedMessages?: string[] }
  | { type: 'status'; sessionId: string; message: string; statusType?: 'compacting' }
  | { type: 'info'; sessionId: string; message: string; statusType?: 'compaction_complete'; level?: 'info' | 'warning' | 'error' | 'success'; timestamp?: number }
  | { type: 'title_generated'; sessionId: string; title: string }
  | { type: 'title_regenerating'; sessionId: string; isRegenerating: boolean }
  | { type: 'async_operation'; sessionId: string; isOngoing: boolean }
  | { type: 'working_directory_changed'; sessionId: string; workingDirectory: string }
  | { type: 'permission_request'; sessionId: string; request: PermissionRequest }
  | { type: 'credential_request'; sessionId: string; request: CredentialRequest }
  | { type: 'permission_mode_changed'; sessionId: string; permissionMode: PermissionMode; previousPermissionMode?: PermissionMode; transitionDisplay?: string; modeVersion?: number; changedAt?: string; changedBy?: PermissionModeState['changedBy'] }
  | { type: 'plan_submitted'; sessionId: string; message: Message }
  | { type: 'sources_changed'; sessionId: string; enabledSourceSlugs: string[] }
  | { type: 'labels_changed'; sessionId: string; labels: string[] }
  | { type: 'project_id_changed'; sessionId: string; projectId: string | null }
  | { type: 'connection_changed'; sessionId: string; connectionSlug: string; supportsBranching?: boolean }
  | { type: 'task_backgrounded'; sessionId: string; toolUseId: string; taskId: string; intent?: string; turnId?: string; kind?: 'workflow'; workflowId?: string }
  | { type: 'shell_backgrounded'; sessionId: string; toolUseId: string; shellId: string; intent?: string; command?: string; turnId?: string }
  | { type: 'task_progress'; sessionId: string; toolUseId: string; elapsedSeconds: number; turnId?: string }
  | { type: 'task_completed'; sessionId: string; taskId: string; status: 'completed' | 'failed' | 'stopped'; outputFile?: string; summary?: string; turnId?: string }
  | { type: 'workflow_agent_completed'; sessionId: string; workflowId: string; agentId: string; turnId?: string }
  | { type: 'shell_killed'; sessionId: string; shellId: string }
  | { type: 'user_message'; sessionId: string; message: Message; status: 'accepted' | 'queued' | 'processing'; optimisticMessageId?: string }
  | { type: 'session_flagged'; sessionId: string }
  | { type: 'session_unflagged'; sessionId: string }
  | { type: 'session_archived'; sessionId: string }
  | { type: 'session_unarchived'; sessionId: string }
  | { type: 'name_changed'; sessionId: string; name?: string }
  | { type: 'session_model_changed'; sessionId: string; model: string | null }
  | { type: 'session_status_changed'; sessionId: string; sessionStatus: SessionStatus }
  | { type: 'session_metadata_changed'; sessionId: string; changes: Partial<Pick<Session, 'taskNodeCount' | 'kanbanColumn' | 'taskDraft' | 'taskSlug' | 'projectId'>> }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'session_created'; sessionId: string }
  | { type: 'session_shared'; sessionId: string; sharedUrl: string }
  | { type: 'session_unshared'; sessionId: string }
  | { type: 'auth_request'; sessionId: string; message: Message; request: SharedAuthRequest }
  | { type: 'auth_completed'; sessionId: string; requestId: string; success: boolean; cancelled?: boolean; error?: string }
  | { type: 'source_activated'; sessionId: string; sourceSlug: string; originalMessage: string }
  | { type: 'usage_update'; sessionId: string; tokenUsage: { inputTokens: number; contextWindow?: number } }
  | { type: 'message_annotations_updated'; sessionId: string; messageId: string; annotations: AnnotationV1[] }
  | { type: 'working_directory_error'; sessionId: string; error: string }

export interface SendMessageOptions {
  skillSlugs?: string[]
  badges?: ContentBadge[]
  optimisticMessageId?: string
  /**
   * When true, the message drives a turn (reaches the model) but is marked
   * `hidden` on the persisted `Message` so it never renders as a transcript
   * bubble. Used for system-generated nudges (e.g. WS2 background-task-completion
   * surfacing) that should wake the agent without looking user-authored.
   */
  hidden?: boolean
}

// ---------------------------------------------------------------------------
// Session commands (consolidated operations)
// ---------------------------------------------------------------------------

export type SessionCommand =
  | { type: 'flag' }
  | { type: 'unflag' }
  | { type: 'archive' }
  | { type: 'unarchive' }
  | { type: 'rename'; name: string }
  | { type: 'setSessionStatus'; state: SessionStatus }
  | { type: 'markRead' }
  | { type: 'markUnread' }
  | { type: 'setActiveViewing'; workspaceId: string }
  | { type: 'setPermissionMode'; mode: PermissionMode }
  | { type: 'setThinkingLevel'; level: ThinkingLevel }
  | { type: 'updateWorkingDirectory'; dir: string }
  | { type: 'setSources'; sourceSlugs: string[] }
  | { type: 'setLabels'; labels: string[] }
  | { type: 'setProjectId'; projectId: string | null }
  | { type: 'setKanbanColumn'; column: string | null }
  | { type: 'showInFinder' }
  | { type: 'copyPath' }
  | { type: 'shareToViewer' }
  | { type: 'updateShare' }
  | { type: 'revokeShare' }
  | { type: 'refreshTitle' }
  | { type: 'setConnection'; connectionSlug: string }
  | { type: 'setPendingPlanExecution'; planPath: string; draftInputSnapshot?: string }
  | { type: 'markCompactionComplete' }
  | { type: 'markPendingPlanExecutionDispatched' }
  | { type: 'clearPendingPlanExecution' }
  | { type: 'addAnnotation'; messageId: string; annotation: AnnotationV1 }
  | { type: 'removeAnnotation'; messageId: string; annotationId: string }
  | { type: 'updateAnnotation'; messageId: string; annotationId: string; patch: Partial<AnnotationV1> }
  | { type: 'removeAttachment'; messageId: string; attachmentId: string }
  | { type: 'clearAttachments' }
  | { type: 'gitCheckout'; filePath: string }

export interface NewChatActionParams {
  input?: string
  name?: string
}

// ---------------------------------------------------------------------------
// Permission / credential types
// ---------------------------------------------------------------------------

export type { BasePermissionRequest }

/**
 * Permission request with session context (for multi-session Electron app)
 */
export interface PermissionRequest extends BasePermissionRequest {
  sessionId: string
}

export interface PermissionResponseOptions {
  rememberForMinutes?: number
}

// Re-export for handler convenience
export type { SharedCredentialInputMode as CredentialInputMode }
export type CredentialRequest = SharedCredentialAuthRequest
export type { SharedAuthRequest as AuthRequest }

export interface CredentialResponse {
  type: 'credential'
  value?: string
  username?: string
  password?: string
  headers?: Record<string, string>
  cancelled: boolean
}

// ---------------------------------------------------------------------------
// Directory browsing types (remote mode)
// ---------------------------------------------------------------------------

/** Server-side directory listing result (for remote directory browsing). */
export interface DirectoryListingResult {
  /** Normalized absolute path of the listed directory (after resolve(), not symlink-resolved). */
  currentPath: string
  /** Parent directory path, or null if at root. */
  parentPath: string | null
  /** Pre-split breadcrumb segments for display (computed server-side). */
  breadcrumbs: Array<{ name: string; path: string }>
  /** Server platform info. */
  platform: 'win32' | 'darwin' | 'linux'
  /** Whether the server truncated the directory list for safety/performance. */
  truncated: boolean
  /** Total number of matching child directories before truncation. */
  totalEntries: number
  /** Child directory entries. */
  entries: Array<{ name: string; path: string; isSymlink: boolean }>
}

// ---------------------------------------------------------------------------
// File types
// ---------------------------------------------------------------------------

export interface FileAttachment {
  type: 'image' | 'text' | 'pdf' | 'office' | 'audio' | 'unknown'
  path: string
  name: string
  mimeType: string
  base64?: string
  text?: string
  size: number
  thumbnailBase64?: string
}

export interface SessionFile {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  /** File modification timestamp (ms since epoch), populated when stat succeeded */
  mtime?: number
  children?: SessionFile[]
}

// ---------------------------------------------------------------------------
// Media list (Media Lab) — server-side cursor pagination over classified files
// ---------------------------------------------------------------------------

/**
 * Kinds of media the server classifies in `media:list`. Mirrors the EXT map
 * the renderer used to own; the server now classifies so a single RPC can
 * return a page of items instead of N fan-out calls.
 *
 * `'all'` is a renderer-side pseudo-filter (sent as undefined to the server)
 * so consumers don't need a sentinel value.
 */
export type MediaKind = 'image' | 'video' | 'audio' | 'doc'

/**
 * A single media item as returned by `media:list`. The renderer uses
 * `sessionId` + `path` as a stable key for dedupe across pages.
 */
export interface MediaItem {
  /** 'image' | 'video' | 'audio' | 'doc' — server-classified */
  kind: MediaKind
  /** File basename */
  name: string
  /** Absolute filesystem path (renderer's `file://` source for previews) */
  path: string
  /** File size in bytes, when stat succeeded */
  size?: number
  /** File modification timestamp (ms since epoch), when stat succeeded */
  mtime?: number
  /** Owning session id — reuses the renderer-side dedupe key */
  sessionId: string
  /** Human-readable session title (for the card subtitle) */
  sessionTitle: string
  /** Owning session's lastMessageAt, for ordering + empty-state debug */
  lastMessageAt: number
}

/**
 * Cursor + filter args for `media:list`. All fields optional — a request
 * with `{}` returns the first page of every kind for the calling workspace.
 *
 * `cursor` is opaque to the client; the server encodes the most recent
 * `lastMessageAt` + `sessionId` it finished scanning. Pass it back to fetch
 * the next page; the server returns `nextCursor: null` when no more pages
 * remain in the workspace.
 */
export interface MediaListRequest {
  kind?: MediaKind
  cursor?: string
  /** Soft cap on returned items. Server may emit slightly fewer when
   *  crossing a session boundary. Defaults to 200 server-side. */
  limit?: number
}

/**
 * One page of `media:list`. `items` is ordered by session-recency desc
 * (matches the existing Media Lab UX). `nextCursor` is null when the
 * server exhausted its scan.
 */
export interface MediaListPage {
  items: MediaItem[]
  hasMore: boolean
  nextCursor: string | null
}

// ---------------------------------------------------------------------------
// ComfyUI Media Lab generation
// ---------------------------------------------------------------------------

export type ComfyWorkflowKind = 'image' | 'video' | 'audio' | 'unknown'
export type ComfyParameterKind = 'text' | 'number' | 'seed' | 'image' | 'model' | 'select'

export interface ComfyHealth {
  connected: boolean
  baseUrl: string
  version?: string
  device?: string
  vramTotal?: number
  vramFree?: number
  queueRunning?: number
  queuePending?: number
  error?: string
}

export interface ComfyWorkflowParameterDto {
  id: string
  label: string
  kind: ComfyParameterKind
  value: string | number
  options?: Array<string | number>
}

export interface ComfyWorkflowSummary {
  id: string
  name: string
  kind: ComfyWorkflowKind
  nodeClasses: string[]
  parameters: ComfyWorkflowParameterDto[]
}

export interface ComfyWorkflowList {
  workflows: ComfyWorkflowSummary[]
  rejectedCount: number
}

export interface ComfyRunRequest {
  workflowId: string
  parameters?: Record<string, string | number>
}

export interface ComfyRunResult {
  promptId: string
  queueNumber?: number
}

export interface ComfyJobStatusRequest {
  promptId: string
}

export interface ComfyJobStatus {
  promptId: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'unknown'
  stage?: 'queued' | 'executing' | 'saving' | 'completed' | 'failed'
  currentNode?: string
  progress?: number
  startedAt?: number
  finishedAt?: number
  error?: string
}

export interface FileSearchResult {
  name: string
  path: string
  type: 'file' | 'directory'
  relativePath: string
}

// ---------------------------------------------------------------------------
// LLM connection types
// ---------------------------------------------------------------------------

/**
 * Resolved Anthropic OAuth identity (issue #838), captured from the
 * token-exchange response. Shape mirrors `ClaudeOAuthIdentity` in
 * `auth/claude-oauth.ts`; kept in the protocol layer so DTOs stay decoupled
 * from the auth module. All fields optional and fail-soft.
 */
export interface ClaudeOAuthIdentityDto {
  account?: { uuid?: string; emailAddress?: string }
  organization?: { uuid?: string; name?: string }
}

export interface LlmConnectionSetup {
  slug: string
  credential?: string
  baseUrl?: string | null
  defaultModel?: string | null
  models?: string[] | null
  piAuthProvider?: string
  modelSelectionMode?: 'automaticallySyncedFromProvider' | 'userDefined3Tier'
  /** When true, reject setup if the connection doesn't already exist (reauth guard). */
  updateOnly?: boolean
  /** Custom endpoint protocol for arbitrary OpenAI/Anthropic-compatible APIs */
  customEndpoint?: CustomEndpointConfig
  /** IAM credentials for Pi+Bedrock (piAuthProvider='amazon-bedrock') connections */
  iamCredentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
  /** AWS region for Pi+Bedrock connections */
  awsRegion?: string
  /** Bedrock authentication method — determines auth type for Pi+Bedrock connections */
  bedrockAuthMethod?: 'iam_credentials' | 'environment'
  /**
   * When true, this connection was set up through the local-model (Ollama) onboarding path.
   * Used by the UI to show a more specific display name (e.g. "Ollama" vs "Anthropic API").
   */
  isLocalModel?: boolean

  /**
   * Resolved Anthropic OAuth identity (issue #838), threaded through setup so it
   * persists for both new and re-auth connections. Optional and fail-soft.
   */
  oauthIdentity?: ClaudeOAuthIdentityDto
}

export interface TestLlmConnectionParams {
  provider: 'anthropic' | 'pi'
  apiKey: string
  baseUrl?: string
  model?: string
  piAuthProvider?: string
  /** Optional custom endpoint protocol hint so setup tests mirror runtime routing */
  customEndpoint?: CustomEndpointConfig
}

export interface TestLlmConnectionResult {
  success: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// Source / skill types
// ---------------------------------------------------------------------------

export interface SkillFile {
  name: string
  type: 'file' | 'directory'
  size?: number
  children?: SkillFile[]
}

export interface OAuthResult {
  success: boolean
  error?: string
}

export interface McpValidationResult {
  success: boolean
  error?: string
  tools?: string[]
}

export interface McpToolWithPermission {
  name: string
  description?: string
  allowed: boolean
}

export interface McpToolsResult {
  success: boolean
  error?: string
  tools?: McpToolWithPermission[]
}

// ---------------------------------------------------------------------------
// Search types
// ---------------------------------------------------------------------------

export interface SessionSearchMatch {
  sessionId: string
  lineNumber: number
  snippet: string
}

export interface SessionSearchResult {
  sessionId: string
  matchCount: number
  matches: SessionSearchMatch[]
}

// ---------------------------------------------------------------------------
// Session result types
// ---------------------------------------------------------------------------

export interface UnreadSummary {
  totalUnreadSessions: number
  byWorkspace: Record<string, number>
  hasUnreadByWorkspace: Record<string, boolean>
}

export interface ShareResult {
  success: boolean
  url?: string
  error?: string
}

export interface RefreshTitleResult {
  success: boolean
  title?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

export interface PlanStep {
  id: string
  description: string
  tools?: string[]
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
}

export interface Plan {
  id: string
  title: string
  summary?: string
  steps: PlanStep[]
  questions?: string[]
  state?: 'creating' | 'refining' | 'ready' | 'executing' | 'completed' | 'cancelled'
  createdAt?: number
  updatedAt?: number
}

// ---------------------------------------------------------------------------
// System types
// ---------------------------------------------------------------------------

/**
 * Result of a git status check in a working directory.
 */
export interface GitStatusResult {
  /** Current branch name, or null if not a git repository. */
  branch: string | null
  /** Working directory the status was fetched for. */
  dirPath: string
  /** Parsed entries from `git diff --stat` + `git status --porcelain`. */
  files: GitStatusFileEntry[]
}

/**
 * A single file entry in a git status result.
 */
export interface GitStatusFileEntry {
  /** File path relative to the repository root. */
  path: string
  /** Status classification. */
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'copied'
  /** Which side of `git status --porcelain` produced this entry. A single
   *  path may appear in both staged and unstaged when its XY code has
   *  non-space on both sides (e.g. `AM` = staged-add + working-tree-modify). */
  bucket: 'staged' | 'unstaged' | 'untracked'
  /** Lines inserted (0 for non-tracked or non-diff entries). */
  insertions: number
  /** Lines deleted (0 for non-tracked or non-diff entries). */
  deletions: number
  /** Previous path when status is 'renamed'. */
  previousPath?: string
}

/**
 * Per-file diff payload returned by `git:fileDiff`.
 *
 * For a `modified/renamed/copied` file both `original` and `modified` are
 * typically non-null and Shiki-diff-renderable. For an untracked/`added` file
 * `original` is null. For a `deleted` file `modified` is null. For binary
 * files both may populate but `isBinary` is true and the renderer should
 * skip ShikiDiffViewer and just show the +/- counts.
 */
export interface GitFileDiffResult {
  /** HEAD version of the file (full content). null for untracked/added. */
  original: string | null
  /** Working-tree version of the file (full content). null for deleted. */
  modified: string | null
  /** Total insertions from `git diff --numstat`. 0 for binary/untracked. */
  additions: number
  /** Total deletions from `git diff --numstat`. 0 for binary/untracked. */
  deletions: number
  /** True when first ~8KB contains NUL bytes — ShikiDiffViewer can't render these. */
  isBinary: boolean
}

export interface GitBashStatus {
  found: boolean
  path: string | null
  platform: 'win32' | 'darwin' | 'linux'
}

export interface UpdateInfo {
  available: boolean
  currentVersion: string
  latestVersion: string | null
  downloadState: 'idle' | 'downloading' | 'ready' | 'installing' | 'error'
  downloadProgress: number
  error?: string
}

// ---------------------------------------------------------------------------
// Workspace types
// ---------------------------------------------------------------------------

export interface WorkspaceSettings {
  name?: string
  model?: string
  permissionMode?: PermissionMode
  cyclablePermissionModes?: PermissionMode[]
  thinkingLevel?: ThinkingLevel
  workingDirectory?: string
  localMcpEnabled?: boolean
  defaultLlmConnection?: string
  enabledSourceSlugs?: string[]
  /**
   * Cumulative open-directory cap for the working-directory tree's right
   * rail. Limits the number of directories that can be simultaneously
   * expanded (across any combination of manual clicks, file-watch
   * re-expands, drill-mode bumps, or the bulk BFS). When exceeded, leaf-most
   * entries are silently collapsed until under the cap. Undefined falls
   * back to a renderer-side default of 50.
   *
   * Promote-to-setting path for `MAX_OPEN_DIRS` in LayoutShell — see the
   * count-cap useEffect there. Power users with wide monorepos can bump
   * this to 100 or 200 without paying the cost of the default for
   * typical repos.
   */
  maxOpenDirs?: number
}

// ---------------------------------------------------------------------------
// Auth result types
// ---------------------------------------------------------------------------

export interface ClaudeOAuthResult {
  success: boolean
  token?: string
  error?: string
  /**
   * Resolved Anthropic identity (issue #838), forwarded to the renderer so it
   * can thread it into the SETUP payload (which is what persists it). Present
   * only when the token-exchange response carried identity.
   */
  identity?: ClaudeOAuthIdentityDto
}

// ---------------------------------------------------------------------------
// Automation types
// ---------------------------------------------------------------------------

export type TestAutomationAction =
  | { type: 'prompt'; prompt: string; llmConnection?: string; model?: string; thinkingLevel?: ThinkingLevel }
  | { type: 'webhook'; url: string; method?: string; headers?: Record<string, string>; bodyFormat?: 'json' | 'form' | 'raw'; body?: unknown; captureResponse?: boolean; auth?: { type: 'basic'; username: string; password: string } | { type: 'bearer'; token: string } }

export interface TestAutomationPayload {
  workspaceId: string
  automationId?: string
  automationName?: string
  actions: TestAutomationAction[]
  permissionMode?: PermissionMode
  labels?: string[]
  /** Forwarded from the matcher; routes test-run sessions into a Telegram topic when paired. */
  telegramTopic?: string
}

export type TestAutomationActionResult =
  | { type: 'prompt'; success: boolean; stderr?: string; sessionId?: string; duration: number }
  | { type: 'webhook'; success: boolean; url: string; statusCode: number; error?: string; duration: number }

export interface TestAutomationResult {
  actions: TestAutomationActionResult[]
}

// ---------------------------------------------------------------------------
// Window types
// ---------------------------------------------------------------------------

export type WindowCloseRequestSource = 'keyboard-shortcut' | 'window-button' | 'unknown'

export interface WindowCloseRequest {
  source: WindowCloseRequestSource
}

// ---------------------------------------------------------------------------
// Read directory types (working directory file browser)
// ---------------------------------------------------------------------------

/**
 * Result of reading a directory with file metadata.
 * Used by the working-directory file browser in the LayoutShell rail.
 */
export interface ReadDirectoryResult {
  /** Normalized absolute path of the listed directory. */
  currentPath: string
  /** Parent directory path, or null if at root. */
  parentPath: string | null
  /** Child entries (files and directories) with metadata. */
  entries: ReadDirectoryEntry[]
}

/**
 * A single entry in a directory listing.
 */
export interface ReadDirectoryEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  /** File size in bytes (0 for directories). */
  size?: number
  /** File modification timestamp (ms since epoch). */
  mtime?: number
  /**
   * File birth / creation timestamp (ms since epoch).  Undefined on
   * filesystems that do not track birthtime reliably (pre-Linux-4.11
   * ext4, FAT32, network mounts).  Renderers should treat absence as
   * "unknown" rather than synthesizing a value from mtime.
   */
  ctime?: number
  isSymlink: boolean
}

// ---------------------------------------------------------------------------
// Browser / navigation types (data shapes used by BroadcastEventMap)
// ---------------------------------------------------------------------------

export interface BrowserInstanceInfo {
  id: string
  url: string
  title: string
  favicon: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  boundSessionId: string | null
  ownerType: 'session' | 'manual'
  ownerSessionId: string | null
  isVisible: boolean
  agentControlActive: boolean
  themeColor: string | null
  /**
   * Workspace that owns this browser instance, or `null` for unbound manual
   * windows. Renderers filter the tab strip / status badge by `activeWorkspaceId`
   * so a session in workspace A doesn't see windows opened by workspace B.
   * Missing/null entries always pass the filter — this keeps older renderers
   * and main processes that pre-date the field working unchanged.
   */
  workspaceId?: string | null
}

export interface DeepLinkNavigation {
  view?: string
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
}
