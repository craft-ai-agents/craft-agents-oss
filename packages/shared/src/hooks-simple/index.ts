/**
 * Craft Agent Hooks - Public API
 *
 * Slim barrel file that re-exports from decomposed modules:
 * - types.ts: All type definitions
 * - validation.ts: Config validation functions
 * - sdk-bridge.ts: SDK environment variable building
 * - utils.ts: Shared utilities (toSnakeCase, expandEnvVars, etc.)
 * - hook-system.ts: HookSystem facade (main entry point)
 * - event-bus.ts: WorkspaceEventBus
 * - handlers/: CommandHandler, PromptHandler, EventLogHandler
 */

// ============================================================================
// Types
// ============================================================================

export type {
  AppEvent,
  AgentEvent,
  HookEvent,
  CommandHookDefinition,
  PromptHookDefinition,
  HookDefinition,
  HookMatcher,
  HooksConfig,
  CommandHookResult,
  PromptReferences,
  PromptHookResult,
  HookExecutionResult,
  PendingPrompt,
  HookResult,
  HooksValidationResult,
  SdkHookInput,
  SdkHookCallback,
  SdkHookCallbackMatcher,
  SessionMetadataSnapshot,
} from './types.ts';

export { APP_EVENTS, AGENT_EVENTS } from './types.ts';

// ============================================================================
// Validation
// ============================================================================

export {
  validateHooksConfig,
  validateHooksContent,
  validateHooks,
} from './validation.ts';

// ============================================================================
// SDK Bridge
// ============================================================================

export { buildEnvFromSdkInput } from './sdk-bridge.ts';

// ============================================================================
// Utilities
// ============================================================================

export { parsePromptReferences } from './utils.ts';

// ============================================================================
// Re-exports from sub-modules
// ============================================================================

// Event logger
export { HookEventLogger, type LoggedHookEvent, type LoggedHookEventInput } from './event-logger.ts';

// Schemas
export { HooksConfigSchema, zodErrorToIssues, VALID_EVENTS } from './schemas.ts';

// Security utilities
export { sanitizeForShell } from './security.ts';

// Cron matching
export { matchesCron } from './cron-matcher.ts';

// Command executor
export {
  resolvePermissionsConfig,
  isCommandAllowed,
  executeCommand,
  type CommandExecutionOptions,
  type CommandExecutionResult,
} from './command-executor.ts';

// Event Bus
export {
  WorkspaceEventBus,
  type EventBus,
  type EventPayloadMap,
  type BaseEventPayload,
  type LabelEventPayload,
  type PermissionModeChangePayload,
  type FlagChangePayload,
  type TodoStateChangePayload,
  type SchedulerTickPayload,
  type LabelConfigChangePayload,
  type GenericEventPayload,
  type EventHandler,
  type AnyEventHandler,
} from './event-bus.ts';

// HookSystem facade
export {
  HookSystem,
  type HookSystemOptions,
  type SessionMetadataSnapshot as HookSystemMetadataSnapshot,
} from './hook-system.ts';

// Handlers
export {
  CommandHandler,
  PromptHandler,
  EventLogHandler,
  type HookHandler,
  type CommandHandlerOptions,
  type PromptHandlerOptions,
  type EventLogHandlerOptions,
  type HooksConfigProvider,
} from './handlers/index.ts';
