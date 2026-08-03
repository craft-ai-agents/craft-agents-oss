/**
 * Core Agent Types
 *
 * Shared types used by both ClaudeAgent and PiAgent.
 * These types define the interfaces for core functionality that is
 * provider-agnostic and shared across all agent implementations.
 */

import type { LoadedSource } from '../../sources/types.ts';
import type { Workspace } from '../../config/storage.ts';
import type { SessionConfig } from '../../sessions/storage.ts';

// Re-export common types from mode-types for convenience
// These are the types needed by permission evaluation
export type {
  PermissionMode,
  ModeConfig,
  CompiledApiEndpointRule,
  CompiledBashPattern,
  MismatchAnalysis,
  PermissionPaths,
} from '../mode-types.ts';

export {
  PERMISSION_MODE_ORDER,
  PERMISSION_MODE_CONFIG,
  SAFE_MODE_CONFIG,
} from '../mode-types.ts';

// Re-export ToolCheckResult from mode-manager
export type { ToolCheckResult } from '../mode-manager.ts';

/**
 * Message type for recovery context building.
 * Used when SDK session resume fails and we need to inject previous conversation context.
 */
export interface RecoveryMessage {
  type: 'user' | 'assistant';
  content: string;
}

/**
 * Configuration for PermissionManager
 */
export interface PermissionManagerConfig {
  /** Workspace ID for permission context */
  workspaceId: string;
  /** Session ID for mode state */
  sessionId: string;
  /** Working directory for the session */
  workingDirectory?: string;
  /** Plans folder path (writes to this folder are allowed in Explore mode) */
  plansFolderPath?: string;
  /** Data folder path (writes to this folder are allowed in Explore mode for transform_data output) */
  dataFolderPath?: string;
  /**
   * Retry defaults for tool calls that fail transiently.
   * These encode the retry directive from the compiled prompt's execution-policy
   * layer ("On tool failure: retry up to 3 times with exponential backoff before
   * asking") and are exposed via ToolPermissionResult.retryHint so the agent
   * runtime can implement retry-with-backoff without browsing the prompt text.
   */
  retryDefaults?: RetryConfig;
}

/**
 * Retry configuration for handling transient tool failures.
 * Aligned with the execution-policy layer's retry directive.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts before escalating to the user (default 3) */
  maxRetries: number;
  /**
   * Base delay in milliseconds for exponential backoff (doubles each attempt).
   * Default 1000 (1 second).
   */
  backoffMs: number;
}

/**
 * Retry hint attached to a tool permission check result.
 * Tells the agent runtime whether a tool call CAN be retried on transient
 * failure and, if so, how to back off before escalating.
 */
export interface RetryHint {
  /** Whether the tool call can be retried on transient failure */
  retryable: boolean;
  /** Maximum number of retry attempts before escalating (only when retryable) */
  maxRetries: number;
  /** Base delay in ms for exponential backoff (doubles each attempt) */
  backoffMs: number;
  /** Human-readable explanation of why retry is or isn't appropriate */
  reason?: string;
}

/**
 * Result of a tool permission check with detailed information.
 * Includes a retryHint that encodes the compiled prompt's retry directive for
 * the agent runtime.
 */
export interface ToolPermissionResult {
  /** Whether the tool is allowed */
  allowed: boolean;
  /** If not allowed, the reason why */
  reason?: string;
  /** If allowed but requires user confirmation */
  requiresPermission?: boolean;
  /** Description for permission prompt */
  description?: string;
  /**
   * Retry hint for the agent runtime.
   * - Allowed tools: retryable=true with configured backoff (default 3 retries, 1s)
   * - Permission-required tools: retryable=true, maxRetries=1 (user can try once more)
   * - Blocked tools: retryable=false (retrying a permission block won't help)
   */
  retryHint?: RetryHint;
}

/**
 * Configuration for SourceManager
 */
export interface SourceManagerConfig {
  /** Debug callback for logging */
  onDebug?: (message: string) => void;
}

/**
 * Configuration for PromptBuilder
 */
export interface PromptBuilderConfig {
  /** Workspace configuration */
  workspace: Workspace;
  /** Session configuration */
  session?: SessionConfig;
  /** Whether debug mode is enabled */
  debugMode?: {
    enabled: boolean;
    logFilePath?: string;
  };
  /** System prompt preset ('default' | 'mini' | custom string) */
  systemPromptPreset?: 'default' | 'mini' | string;
  /** Whether running in headless mode */
  isHeadless?: boolean;
  /** Optional pre-resolved project snapshot for prompt injection (lets tests pin a value) */
  project?: import('../../projects/types.ts').ProjectPromptContext;
}

/**
 * Context block options for building system prompt context
 */
export interface ContextBlockOptions {
  /** Current permission mode (optional - included in session state via formatSessionState) */
  permissionMode?: string;
  /** Plans folder path */
  plansFolderPath?: string;
  /** Data folder path (transform_data tool output) */
  dataFolderPath?: string;
  /** Active source slugs */
  activeSources?: string[];
  /** Inactive source slugs */
  inactiveSources?: LoadedSource[];
  /** Whether local MCP is enabled */
  localMcpEnabled?: boolean;
}

/**
 * Configuration for PathProcessor
 */
export interface PathProcessorConfig {
  /** Home directory (defaults to os.homedir()) */
  homeDir?: string;
}

/**
 * Configuration for ConfigValidator
 */
export interface ConfigValidatorConfig {
  /** Workspace path for config files */
  workspacePath?: string;
}

/**
 * Result of config validation
 */
export interface ConfigValidationResult {
  /** Whether the config is valid */
  valid: boolean;
  /** Validation errors if invalid */
  errors?: string[];
  /** Validation warnings (valid but potentially problematic) */
  warnings?: string[];
}

/**
 * Detected config file type
 */
export type ConfigFileType = 'json' | 'toml' | 'yaml' | null;
