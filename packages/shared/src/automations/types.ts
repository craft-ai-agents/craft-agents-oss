/**
 * Automation System Type Definitions
 *
 * All types, interfaces, and type exports for the automations system.
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
  | 'SessionStatusChange'
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

export type AutomationEvent = AppEvent | AgentEvent;

export const APP_EVENTS: AppEvent[] = [
  'LabelAdd', 'LabelRemove', 'LabelConfigChange',
  'PermissionModeChange', 'FlagChange', 'SessionStatusChange', 'SchedulerTick'
];

export const AGENT_EVENTS: AgentEvent[] = [
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification',
  'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest', 'Setup'
];

// ============================================================================
// Action Definitions
// ============================================================================

/** A prompt action - sends a prompt to Craft Agent */
export interface PromptAction {
  type: 'prompt';
  prompt: string;
  /** LLM connection slug for the created session (falls back to default if not found) */
  llmConnection?: string;
  /** Model ID for the created session (falls back to provider default if invalid) */
  model?: string;
}

export type AutomationAction = PromptAction;

export interface AutomationMatcher {
  /** Short 6-character hex ID for stable identification across config changes. */
  id?: string;
  /** Optional display name. If omitted, derived from the first action. */
  name?: string;
  /** Regex pattern for matching event data (not used for SchedulerTick) */
  matcher?: string;
  /** Cron expression for SchedulerTick events (5-field format) */
  cron?: string;
  /** IANA timezone for cron evaluation (e.g., "Europe/Budapest", "America/New_York") */
  timezone?: string;
  /** Permission mode for sessions created by prompt actions. */
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  /** Labels to apply to sessions created by prompt actions */
  labels?: string[];
  /** Whether this automation matcher is enabled. Defaults to true. Set to false to disable without removing. */
  enabled?: boolean;
  actions: AutomationAction[];
}

export interface AutomationsConfig {
  automations: Partial<Record<AutomationEvent, AutomationMatcher[]>>;
}

// ============================================================================
// Action Results
// ============================================================================

/** References parsed from a prompt (@name for sources and skills) */
export interface PromptReferences {
  /**
   * All @name references found in the prompt.
   * These could be sources (@linear, @github) or skills (@commit, @review-pr).
   * The caller should resolve which are sources vs skills based on available configurations.
   */
  mentions: string[];
}

/** Result of a prompt action - returns the prompt to be executed by caller */
export interface PromptActionResult {
  type: 'prompt';
  prompt: string;
  /** The expanded prompt with environment variables substituted */
  expandedPrompt: string;
  /** References to sources and skills found in the prompt */
  references: PromptReferences;
}

export type ActionExecutionResult = PromptActionResult;

/** A pending prompt with its metadata */
export interface PendingPrompt {
  /** The session ID this prompt should be sent to */
  sessionId: string | undefined;
  /** The automation matcher ID this prompt originated from */
  matcherId?: string;
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
  /** LLM connection slug for the created session (falls back to default if not found) */
  llmConnection?: string;
  /** Model ID for the created session (falls back to provider default if invalid) */
  model?: string;
}

export interface AutomationResult {
  event: string;
  matched: number;
  results: ActionExecutionResult[];
  /** Prompts that should be executed by Craft Agent (with metadata) */
  pendingPrompts: PendingPrompt[];
}

// ============================================================================
// Validation Types
// ============================================================================

/** Internal validation result that includes the parsed config */
export type AutomationsValidationResult = {
  valid: boolean;
  errors: string[];
  config: AutomationsConfig | null;
};

// ============================================================================
// SDK Types
// ============================================================================

/**
 * SDK automation input type - union of all possible SDK event inputs
 */
export interface SdkAutomationInput {
  hook_event_name: string;
  // Tool events
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: string;
  tool_use_id?: string;
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
 * SDK automation callback signature (matches Claude SDK HookCallback type)
 */
export type SdkAutomationCallback = (
  input: SdkAutomationInput,
  toolUseId: string,
  options: { signal?: AbortSignal }
) => Promise<{ continue: boolean; reason?: string }>;

/**
 * SDK automation matcher format (matches Claude SDK HookCallbackMatcher type)
 * Note: The `hooks` field name is kept as-is to match the Claude SDK interface.
 */
export interface SdkAutomationCallbackMatcher {
  matcher?: string;
  timeout?: number;
  hooks: SdkAutomationCallback[];
}

// ============================================================================
// Session Metadata
// ============================================================================

/**
 * Lightweight session metadata for diffing.
 * Only includes fields that trigger automations.
 */
export interface SessionMetadataSnapshot {
  permissionMode?: string;
  labels?: string[];
  isFlagged?: boolean;
  sessionStatus?: string;
  /** Session name (user-defined or auto-generated) */
  sessionName?: string;
}
