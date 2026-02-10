/**
 * HookHandler Interface and Common Types
 *
 * Defines the contract for all hook handlers in the Event Bus system.
 * Each handler:
 * - Subscribes to relevant events on the bus
 * - Executes its specific logic
 * - Is self-contained and testable in isolation
 */

import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { HookEvent, HooksConfig, HookMatcher, PendingPrompt } from '../types.ts';

// ============================================================================
// Handler Interface
// ============================================================================

/**
 * Base interface for all hook handlers.
 * Handlers subscribe to events and process them independently.
 */
export interface HookHandler {
  /** Subscribe to events on the bus */
  subscribe(bus: EventBus): void;

  /** Clean up resources and unsubscribe from events */
  dispose(): void | Promise<void>;
}

// ============================================================================
// Handler Options
// ============================================================================

/** Options for creating a CommandHandler */
export interface CommandHandlerOptions {
  /** Workspace root path for permission context */
  workspaceRootPath: string;
  /** Working directory for command execution */
  workingDir?: string;
  /** Active source slugs for permission rules */
  activeSourceSlugs?: string[];
  /** Called when a command execution fails */
  onError?: (event: HookEvent, error: Error) => void;
}

/** Options for creating a PromptHandler */
export interface PromptHandlerOptions {
  /** Workspace ID */
  workspaceId: string;
  /** Session ID (if executing in a session context) */
  sessionId?: string;
  /** Called when prompts are ready to be executed */
  onPromptsReady?: (prompts: PendingPrompt[]) => void;
  /** Called when a prompt execution fails */
  onError?: (event: HookEvent, error: Error) => void;
}

/** Options for creating an EventLogHandler */
export interface EventLogHandlerOptions {
  /** Workspace root path for log file location */
  workspaceRootPath: string;
  /** Workspace ID for log entries */
  workspaceId: string;
  /** Called when logging fails after retries */
  onEventLost?: (events: string[], error: Error) => void;
}

// ============================================================================
// Handler Result Types
// ============================================================================

/** Result from command execution */
export interface CommandExecutionResult {
  event: HookEvent;
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
  blocked?: boolean;
  durationMs: number;
}

/** Result from prompt processing */
export interface PromptProcessingResult {
  event: HookEvent;
  prompts: PendingPrompt[];
  durationMs: number;
}

// ============================================================================
// Config Provider Interface
// ============================================================================

/**
 * Interface for getting hooks configuration.
 * Allows handlers to be decoupled from config loading.
 */
export interface HooksConfigProvider {
  /** Get the current hooks configuration */
  getConfig(): HooksConfig | null;

  /** Get matchers for a specific event */
  getMatchersForEvent(event: HookEvent): HookMatcher[];
}
