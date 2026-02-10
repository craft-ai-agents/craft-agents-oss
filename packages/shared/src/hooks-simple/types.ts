/**
 * Hook System Type Definitions
 *
 * All types, interfaces, and type exports for the hooks system.
 */

// ============================================================================
// Event Types
// ============================================================================

/** App events - handled by Craft */
export type AppEvent =
  | 'LabelAdd'
  | 'LabelRemove'
  | 'LabelConfigChange'
  | 'PermissionModeChange'
  | 'FlagChange'
  | 'TodoStateChange'
  | 'SchedulerTick';

/** Agent events - passed to Claude SDK */
export type AgentEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'Setup';

export type HookEvent = AppEvent | AgentEvent;

export const APP_EVENTS: AppEvent[] = [
  'LabelAdd', 'LabelRemove', 'LabelConfigChange',
  'PermissionModeChange', 'FlagChange', 'TodoStateChange', 'SchedulerTick'
];

export const AGENT_EVENTS: AgentEvent[] = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification',
  'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest', 'Setup'
];

// ============================================================================
// Hook Definitions
// ============================================================================

/** A command hook - executes a shell command */
export interface CommandHookDefinition {
  type: 'command';
  command: string;
  timeout?: number;
}

/** A prompt hook - sends a prompt to Craft Agent (App events only) */
export interface PromptHookDefinition {
  type: 'prompt';
  prompt: string;
}

export type HookDefinition = CommandHookDefinition | PromptHookDefinition;

export interface HookMatcher {
  /** Regex pattern for matching event data (not used for SchedulerTick) */
  matcher?: string;
  /** Cron expression for SchedulerTick events (5-field format) */
  cron?: string;
  /** IANA timezone for cron evaluation (e.g., "Europe/Budapest", "America/New_York") */
  timezone?: string;
  /** Permission mode for command hooks. 'allow-all' bypasses security checks. */
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  /** Labels to apply to sessions created by prompt hooks */
  labels?: string[];
  /** Whether this hook matcher is enabled. Defaults to true. Set to false to disable without removing. */
  enabled?: boolean;
  hooks: HookDefinition[];
}

export interface HooksConfig {
  hooks: Partial<Record<HookEvent, HookMatcher[]>>;
}

// ============================================================================
// Hook Results
// ============================================================================

/** Result of a command hook execution */
export interface CommandHookResult {
  type: 'command';
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
  blocked?: boolean;
}

/** References parsed from a prompt (@name for sources and skills) */
export interface PromptReferences {
  /**
   * All @name references found in the prompt.
   * These could be sources (@linear, @github) or skills (@commit, @review-pr).
   * The caller should resolve which are sources vs skills based on available configurations.
   */
  mentions: string[];
}

/** Result of a prompt hook - returns the prompt to be executed by caller */
export interface PromptHookResult {
  type: 'prompt';
  prompt: string;
  /** The expanded prompt with environment variables substituted */
  expandedPrompt: string;
  /** References to sources and skills found in the prompt */
  references: PromptReferences;
}

export type HookExecutionResult = CommandHookResult | PromptHookResult;

/** A pending prompt with its metadata */
export interface PendingPrompt {
  /** The session ID this prompt should be sent to */
  sessionId: string | undefined;
  /** The expanded prompt text */
  prompt: string;
  /**
   * All @mentions found in the prompt (sources and skills).
   * The caller should resolve which are sources vs skills based on available configurations.
   */
  mentions: string[];
  /** Labels to apply to the created session */
  labels?: string[];
  /** Permission mode for the created session (from matcher config) */
  permissionMode?: 'safe' | 'ask' | 'allow-all';
}

export interface HookResult {
  event: string;
  matched: number;
  results: HookExecutionResult[];
  /** Prompts that should be executed by Craft Agent (with metadata) */
  pendingPrompts: PendingPrompt[];
}

// ============================================================================
// Validation Types
// ============================================================================

/** Internal validation result that includes the parsed config */
export type HooksValidationResult = {
  valid: boolean;
  errors: string[];
  config: HooksConfig | null;
};

// ============================================================================
// SDK Types
// ============================================================================

/**
 * SDK hook input type - union of all possible SDK event inputs
 */
export interface SdkHookInput {
  hook_event_name: string;
  // Tool events
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: string;
  // Session events
  source?: string;  // startup, resume, clear, compact
  model?: string;
  // Subagent events
  agent_id?: string;
  agent_type?: string;
  // User prompt events
  prompt?: string;
  // Notification events
  message?: string;
  title?: string;
  // Error events
  error?: string;
}

/**
 * SDK hook callback signature (matches Claude SDK HookCallback type)
 */
export type SdkHookCallback = (
  input: SdkHookInput,
  toolUseId: string,
  options: { signal?: AbortSignal }
) => Promise<{ continue: boolean; reason?: string }>;

/**
 * SDK hook matcher format (matches Claude SDK HookCallbackMatcher type)
 */
export interface SdkHookCallbackMatcher {
  matcher?: string;
  timeout?: number;
  hooks: SdkHookCallback[];
}

// ============================================================================
// Session Metadata
// ============================================================================

/**
 * Lightweight session metadata for diffing.
 * Only includes fields that trigger hooks.
 */
export interface SessionMetadataSnapshot {
  permissionMode?: string;
  labels?: string[];
  isFlagged?: boolean;
  todoState?: string;
  /** Session name (user-defined or auto-generated) */
  sessionName?: string;
}
