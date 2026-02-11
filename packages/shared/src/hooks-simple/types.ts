/**
 * Hooks System Types
 *
 * Type definitions for the event-driven hooks system.
 * Events are emitted by sessions, agents, and the scheduler.
 * Hooks execute commands, create sessions, or log events in response.
 */

// ============================================================
// Event Types
// ============================================================

/** App-level events fired from SessionManager or external changes */
export type AppEventType =
  | 'LabelAdd'
  | 'LabelRemove'
  | 'PermissionModeChange'
  | 'FlagChange'
  | 'TodoStateChange'
  | 'SchedulerTick'
  | 'LabelConfigChange';

/** Agent-level events fired from SDK hooks in G4Agent */
export type AgentEventType =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'SessionStart'
  | 'SessionEnd'
  | 'SubagentStart'
  | 'SubagentStop';

/** All event types */
export type HookEventType = AppEventType | AgentEventType;

// ============================================================
// Event Payloads
// ============================================================

/** Base payload included in all events */
export interface BaseEventPayload {
  workspaceId: string;
  sessionId?: string;
  timestamp: number;
}

export interface LabelAddPayload extends BaseEventPayload {
  label: string;
  allLabels: string[];
}

export interface LabelRemovePayload extends BaseEventPayload {
  label: string;
  allLabels: string[];
}

export interface PermissionModeChangePayload extends BaseEventPayload {
  oldMode: string;
  newMode: string;
}

export interface FlagChangePayload extends BaseEventPayload {
  isFlagged: boolean;
}

export interface TodoStateChangePayload extends BaseEventPayload {
  oldState?: string;
  newState?: string;
}

export interface SchedulerTickPayload extends BaseEventPayload {
  /** ISO minute string, e.g. "2025-01-15T09:00" */
  minute: string;
}

export interface LabelConfigChangePayload extends BaseEventPayload {}

export interface PreToolUsePayload extends BaseEventPayload {
  toolName: string;
  input: Record<string, unknown>;
}

export interface PostToolUsePayload extends BaseEventPayload {
  toolName: string;
  input: Record<string, unknown>;
  /** Truncated output (first 500 chars) */
  outputPreview?: string;
}

export interface PostToolUseFailurePayload extends BaseEventPayload {
  toolName: string;
  input: Record<string, unknown>;
  error: string;
}

export interface SessionStartPayload extends BaseEventPayload {}

export interface SessionEndPayload extends BaseEventPayload {}

export interface SubagentStartPayload extends BaseEventPayload {
  agentId?: string;
  agentType?: string;
}

export interface SubagentStopPayload extends BaseEventPayload {
  agentId?: string;
}

/** Map event types to their payload types */
export interface EventPayloadMap {
  LabelAdd: LabelAddPayload;
  LabelRemove: LabelRemovePayload;
  PermissionModeChange: PermissionModeChangePayload;
  FlagChange: FlagChangePayload;
  TodoStateChange: TodoStateChangePayload;
  SchedulerTick: SchedulerTickPayload;
  LabelConfigChange: LabelConfigChangePayload;
  PreToolUse: PreToolUsePayload;
  PostToolUse: PostToolUsePayload;
  PostToolUseFailure: PostToolUseFailurePayload;
  SessionStart: SessionStartPayload;
  SessionEnd: SessionEndPayload;
  SubagentStart: SubagentStartPayload;
  SubagentStop: SubagentStopPayload;
}

// ============================================================
// Hook Action Types
// ============================================================

/** Execute a shell command */
export interface CommandHookAction {
  type: 'command';
  command: string;
  /** Timeout in ms (default: 30000) */
  timeout?: number;
  /** Working directory (default: workspace root) */
  cwd?: string;
}

/** Create a new session with a prompt */
export interface PromptHookAction {
  type: 'prompt';
  prompt: string;
  /** Permission mode for the created session */
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  /** Model override */
  model?: string;
  /** Labels to apply to created session */
  labels?: string[];
  /** Source slugs to enable */
  enabledSourceSlugs?: string[];
}

/** Log the event for debugging */
export interface EventLogHookAction {
  type: 'event-log';
  /** Log file path (default: ~/.g4os/hooks-log.jsonl) */
  logFile?: string;
}

export type HookAction = CommandHookAction | PromptHookAction | EventLogHookAction;

// ============================================================
// Hook Matcher Configuration
// ============================================================

/** A matcher determines when hooks fire for a given event */
export interface HookMatcher {
  /** Regex pattern to match against the event's primary value (e.g., label name, tool name) */
  matcher?: string;
  /** Cron expression for SchedulerTick events */
  cron?: string;
  /** IANA timezone for cron evaluation (default: system timezone) */
  timezone?: string;
  /** Override permission mode for command hooks in this matcher */
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  /** Labels filter — only fire if session has one of these labels */
  labels?: string[];
  /** Actions to execute when this matcher fires */
  hooks: HookAction[];
}

// ============================================================
// Hooks Configuration File
// ============================================================

/** The hooks.json configuration file format */
export interface HooksConfig {
  version: 1;
  hooks: Partial<Record<HookEventType, HookMatcher[]>>;
}

// ============================================================
// Session Metadata Snapshot (for diffing)
// ============================================================

/** Snapshot of session state for change detection */
export interface SessionMetadataSnapshot {
  labels: string[];
  isFlagged: boolean;
  todoState?: string;
  permissionMode?: string;
}

// ============================================================
// Handler Interfaces
// ============================================================

/** Handler for hook actions */
export interface HookHandler {
  readonly type: HookAction['type'];
  handle(
    action: HookAction,
    event: HookEventType,
    payload: BaseEventPayload,
  ): Promise<void>;
  dispose?(): void;
}

/** Callback for prompt hooks that need to create sessions */
export interface PromptReadyCallback {
  (options: {
    prompt: string;
    workspaceId: string;
    permissionMode?: 'safe' | 'ask' | 'allow-all';
    model?: string;
    labels?: string[];
    enabledSourceSlugs?: string[];
  }): void;
}

// ============================================================
// Rate Limit Configuration
// ============================================================

export interface RateLimitConfig {
  /** Max events per window */
  maxEvents: number;
  /** Window size in ms */
  windowMs: number;
}

/** Default rate limits per event type */
export const DEFAULT_RATE_LIMITS: Partial<Record<HookEventType, RateLimitConfig>> = {
  SchedulerTick: { maxEvents: 60, windowMs: 60_000 },
};

/** Global default rate limit */
export const GLOBAL_RATE_LIMIT: RateLimitConfig = {
  maxEvents: 10,
  windowMs: 60_000,
};
