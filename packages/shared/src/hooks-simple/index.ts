/**
 * Hooks System
 *
 * Event-driven automation for G4 OS workspaces.
 * Enables shell commands, session creation, and event logging
 * in response to session and agent events.
 *
 * Usage:
 *   import { HookSystem } from '@g4os/shared/hooks';
 *
 *   const hooks = new HookSystem(workspacePath, workspaceId);
 *   hooks.onPromptsReady(callback);
 *   hooks.emit('LabelAdd', { sessionId, label, allLabels });
 */

// Core
export { HookSystem } from './hook-system.ts';
export { EventBus, type EventListener } from './event-bus.ts';

// Types
export type {
  HookEventType,
  AppEventType,
  AgentEventType,
  BaseEventPayload,
  EventPayloadMap,
  LabelAddPayload,
  LabelRemovePayload,
  PermissionModeChangePayload,
  FlagChangePayload,
  TodoStateChangePayload,
  SchedulerTickPayload,
  LabelConfigChangePayload,
  PreToolUsePayload,
  PostToolUsePayload,
  PostToolUseFailurePayload,
  SessionStartPayload,
  SessionEndPayload,
  SubagentStartPayload,
  SubagentStopPayload,
  HooksConfig,
  HookMatcher,
  HookAction,
  CommandHookAction,
  PromptHookAction,
  EventLogHookAction,
  SessionMetadataSnapshot,
  HookHandler,
  PromptReadyCallback,
} from './types.ts';

// Validation
export {
  validateHooksConfig,
  loadAndValidateHooksConfig,
  formatHooksValidationResult,
} from './validation.ts';
export {
  validateHooksConfigObject,
  formatHooksValidationResult as formatSchemaValidationResult,
  type HooksValidationResult,
  type HooksValidationError,
  type HooksValidationWarning,
} from './schemas.ts';

// Utilities
export { buildEventEnv, matchesEvent, getMatchValue, expandTemplate } from './utils.ts';
export { sanitizeForShell, checkCommandSafety, validateCommand } from './security.ts';
export { cronMatchesNow, validateCronExpression, getNextCronRun } from './cron-matcher.ts';
export { executeCommand, type CommandResult } from './command-executor.ts';

// Handlers
export { CommandHandler } from './handlers/command-handler.ts';
export { PromptHandler } from './handlers/prompt-handler.ts';
export { EventLogHandler } from './handlers/event-log-handler.ts';
