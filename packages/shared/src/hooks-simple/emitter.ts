/**
 * HookEmitter - Delegates hook emission with session metadata diffing
 *
 * This class provides a clean separation between:
 * 1. Detecting what changed (diffing)
 * 2. Emitting events to the hooks system
 *
 * It follows SRP by handling hook emission delegation, while the caller
 * (SessionManager) handles state management.
 */

import { emitHook, initHooks, clearHooks, type HookResult, type AppEvent } from './index.ts';
import type { HookEventLogger } from './event-logger.ts';
import { createLogger } from '../utils/debug.ts';

// Use shared debug infrastructure (controlled via CRAFT_DEBUG=1)
const log = createLogger('hooks-emitter');

// ============================================================================
// Types
// ============================================================================

export interface SessionMetadataChange {
  event: AppEvent;
  payload: Record<string, unknown>;
}

export interface HookEmitterOptions {
  workspaceRootPath: string;
  workspaceId: string;
  /** Called when a hook execution fails */
  onError?: (event: AppEvent, error: Error) => void;
  /** Called when hooks are emitted (for logging) */
  onEmit?: (event: AppEvent, payload: Record<string, unknown>) => void;
  /** Active source slugs for permission rules */
  activeSourceSlugs?: string[];
  /** Optional event logger for persisting events to events.jsonl */
  eventLogger?: HookEventLogger;
}

export interface HookEmitResult {
  event: AppEvent;
  result: HookResult;
  error?: string;
  durationMs: number;
}

/**
 * Lightweight session metadata for diffing.
 * Only includes fields that trigger hooks.
 */
export interface SessionMetadataSnapshot {
  permissionMode?: string;
  labels?: string[];
  isFlagged?: boolean;
  todoState?: string;
}

// ============================================================================
// HookEmitter Class
// ============================================================================

export class HookEmitter {
  private initialized = false;
  private options: HookEmitterOptions;

  constructor(options: HookEmitterOptions) {
    this.options = options;
  }

  /**
   * Initialize the hooks system.
   * Safe to call multiple times - will only initialize once.
   */
  async initialize(): Promise<{ success: boolean; errors: string[]; hookCount: number }> {
    log.debug(`[HookEmitter] initialize called, already initialized: ${this.initialized}`);

    // Allow re-initialization (for config reload)
    const result = initHooks({
      workspaceRootPath: this.options.workspaceRootPath,
      workspaceId: this.options.workspaceId,
      activeSourceSlugs: this.options.activeSourceSlugs,
    });

    log.debug(`[HookEmitter] initHooks result: success=${result.success}, hookCount=${result.hookCount}, errors=${result.errors.join(', ')}`);
    this.initialized = true;
    return result;
  }

  /**
   * Check if the emitter has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Diff session metadata and return changes as events.
   *
   * Compares previous and next snapshots, returning an array of changes
   * that should trigger hooks.
   */
  diffSessionMetadata(
    prev: SessionMetadataSnapshot,
    next: SessionMetadataSnapshot,
    sessionId: string
  ): SessionMetadataChange[] {
    const changes: SessionMetadataChange[] = [];

    // Permission mode change
    if (prev.permissionMode !== next.permissionMode) {
      changes.push({
        event: 'PermissionModeChange',
        payload: {
          sessionId,
          oldMode: prev.permissionMode ?? '',
          newMode: next.permissionMode ?? '',
        },
      });
    }

    // Labels (array diff)
    const prevLabels = new Set(prev.labels ?? []);
    const nextLabels = new Set(next.labels ?? []);

    // Check for added labels
    for (const label of nextLabels) {
      if (!prevLabels.has(label)) {
        changes.push({
          event: 'LabelAdd',
          payload: { sessionId, label },
        });
      }
    }

    // Check for removed labels
    for (const label of prevLabels) {
      if (!nextLabels.has(label)) {
        changes.push({
          event: 'LabelRemove',
          payload: { sessionId, label },
        });
      }
    }

    // Flag change
    const wasFlagged = prev.isFlagged ?? false;
    const isFlagged = next.isFlagged ?? false;
    if (wasFlagged !== isFlagged) {
      changes.push({
        event: 'FlagChange',
        payload: { sessionId, isFlagged },
      });
    }

    // Todo state change
    if (prev.todoState !== next.todoState) {
      changes.push({
        event: 'TodoStateChange',
        payload: {
          sessionId,
          oldState: prev.todoState ?? '',
          newState: next.todoState ?? '',
        },
      });
    }

    return changes;
  }

  /**
   * Emit all changes, handling errors gracefully.
   *
   * Returns results for all emissions. Errors are logged but don't
   * prevent other hooks from running.
   */
  async emitAll(changes: SessionMetadataChange[]): Promise<HookEmitResult[]> {
    log.debug(`[HookEmitter] emitAll called with ${changes.length} changes`);
    const results: HookEmitResult[] = [];

    for (const change of changes) {
      log.debug(`[HookEmitter] Processing change: event=${change.event}`);
      const startTime = Date.now();

      try {
        this.options.onEmit?.(change.event, change.payload);

        log.debug(`[HookEmitter] Calling emitHook for ${change.event}`);
        const result = await emitHook(change.event, change.payload);
        log.debug(`[HookEmitter] emitHook result: matched=${result.matched}, pendingPrompts=${result.pendingPrompts.length}`);
        const durationMs = Date.now() - startTime;

        // Log event to event stream
        this.options.eventLogger?.log({
          type: change.event,
          sessionId: change.payload.sessionId as string | undefined,
          workspaceId: this.options.workspaceId,
          data: change.payload,
          results: result.results,
          durationMs,
        });

        results.push({
          event: change.event,
          result,
          durationMs,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const durationMs = Date.now() - startTime;

        // Log error but don't fail other hooks
        this.options.onError?.(change.event, error as Error);

        // Still log the failed event
        this.options.eventLogger?.log({
          type: change.event,
          sessionId: change.payload.sessionId as string | undefined,
          workspaceId: this.options.workspaceId,
          data: { ...change.payload, error: errorMessage },
          results: [],
          durationMs,
        });

        results.push({
          event: change.event,
          result: {
            event: change.event,
            matched: 0,
            results: [],
            pendingPrompts: [],
          },
          error: errorMessage,
          durationMs,
        });
      }
    }

    return results;
  }

  /**
   * Convenience method: diff and emit in one call.
   *
   * @param prev - Previous session metadata snapshot
   * @param next - New session metadata snapshot
   * @param sessionId - Session ID for payloads
   * @returns Array of emit results (empty if no changes)
   */
  async diffAndEmit(
    prev: SessionMetadataSnapshot,
    next: SessionMetadataSnapshot,
    sessionId: string
  ): Promise<HookEmitResult[]> {
    const changes = this.diffSessionMetadata(prev, next, sessionId);

    if (changes.length === 0) {
      return [];
    }

    return this.emitAll(changes);
  }

  /**
   * Dispose the emitter, cleaning up resources.
   * Flushes the event logger and clears hooks state.
   */
  async dispose(): Promise<void> {
    log.debug(`[HookEmitter] Disposing emitter for ${this.options.workspaceRootPath}`);

    // Flush and close the event logger
    if (this.options.eventLogger) {
      await this.options.eventLogger.dispose();
    }

    // Clear hooks state for this workspace
    clearHooks();

    this.initialized = false;
    log.debug(`[HookEmitter] Disposed`);
  }
}
