/**
 * HookSystem
 *
 * Facade that ties together the event bus, handlers, config loading,
 * and session metadata diffing. One HookSystem instance per workspace.
 */

import { debug } from '../utils/debug.ts';
import { EventBus } from './event-bus.ts';
import { CommandHandler } from './handlers/command-handler.ts';
import { PromptHandler } from './handlers/prompt-handler.ts';
import { EventLogHandler } from './handlers/event-log-handler.ts';
import { loadAndValidateHooksConfig } from './validation.ts';
import { matchesEvent } from './utils.ts';
import { cronMatchesNow } from './cron-matcher.ts';
import type {
  HookEventType,
  BaseEventPayload,
  EventPayloadMap,
  HooksConfig,
  HookAction,
  HookMatcher,
  SessionMetadataSnapshot,
  PromptReadyCallback,
} from './types.ts';

// ============================================================
// HookSystem
// ============================================================

export class HookSystem {
  private workspaceId: string;
  private workspacePath: string;
  private eventBus: EventBus;
  private commandHandler: CommandHandler;
  private promptHandler: PromptHandler;
  private eventLogHandler: EventLogHandler;
  private config: HooksConfig | null = null;
  private disposed = false;

  /** Track session metadata for diffing (sessionId -> snapshot) */
  private sessionSnapshots: Map<string, SessionMetadataSnapshot> = new Map();

  /** Unsubscribe functions from event bus */
  private unsubscribers: Array<() => void> = [];

  /** Scheduler tick timer (fires every 60s aligned to minute boundary) */
  private schedulerTickTimer: NodeJS.Timeout | null = null;

  constructor(workspacePath: string, workspaceId: string) {
    this.workspacePath = workspacePath;
    this.workspaceId = workspaceId;
    this.eventBus = new EventBus(workspaceId);
    this.commandHandler = new CommandHandler(workspacePath);
    this.promptHandler = new PromptHandler(workspaceId);
    this.eventLogHandler = new EventLogHandler();

    // Load config and register handlers
    this.loadConfig();
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Emit an event to the hook system.
   * This is the main entry point for firing events.
   */
  async emit<T extends HookEventType>(
    event: T,
    payload: Omit<EventPayloadMap[T], 'workspaceId' | 'timestamp'>,
  ): Promise<void> {
    if (this.disposed) return;
    await this.eventBus.emit(event, payload);
  }

  /**
   * Register the callback for creating sessions from prompt hooks.
   */
  onPromptsReady(callback: PromptReadyCallback): void {
    this.promptHandler.setPromptReadyCallback(callback);
  }

  /**
   * Update session metadata and auto-diff to emit events.
   * Call this whenever session labels, flags, or todo state change.
   *
   * @returns Array of events that were emitted
   */
  updateSessionMetadata(
    sessionId: string,
    newSnapshot: SessionMetadataSnapshot,
  ): HookEventType[] {
    if (this.disposed) return [];

    const emittedEvents: HookEventType[] = [];
    const oldSnapshot = this.sessionSnapshots.get(sessionId);

    // Store new snapshot
    this.sessionSnapshots.set(sessionId, { ...newSnapshot });

    if (!oldSnapshot) {
      // First snapshot — no diffing possible
      return emittedEvents;
    }

    // Diff labels
    const oldLabels = new Set(oldSnapshot.labels);
    const newLabels = new Set(newSnapshot.labels);

    for (const label of newSnapshot.labels) {
      if (!oldLabels.has(label)) {
        this.emit('LabelAdd', {
          sessionId,
          label,
          allLabels: newSnapshot.labels,
        });
        emittedEvents.push('LabelAdd');
      }
    }

    for (const label of oldSnapshot.labels) {
      if (!newLabels.has(label)) {
        this.emit('LabelRemove', {
          sessionId,
          label,
          allLabels: newSnapshot.labels,
        });
        emittedEvents.push('LabelRemove');
      }
    }

    // Diff flagged state
    if (oldSnapshot.isFlagged !== newSnapshot.isFlagged) {
      this.emit('FlagChange', {
        sessionId,
        isFlagged: newSnapshot.isFlagged,
      });
      emittedEvents.push('FlagChange');
    }

    // Diff todo state
    if (oldSnapshot.todoState !== newSnapshot.todoState) {
      this.emit('TodoStateChange', {
        sessionId,
        oldState: oldSnapshot.todoState,
        newState: newSnapshot.todoState,
      });
      emittedEvents.push('TodoStateChange');
    }

    // Diff permission mode
    if (oldSnapshot.permissionMode !== newSnapshot.permissionMode &&
        oldSnapshot.permissionMode && newSnapshot.permissionMode) {
      this.emit('PermissionModeChange', {
        sessionId,
        oldMode: oldSnapshot.permissionMode,
        newMode: newSnapshot.permissionMode,
      });
      emittedEvents.push('PermissionModeChange');
    }

    return emittedEvents;
  }

  /**
   * Initialize a session's metadata snapshot (no events emitted).
   * Call this when a session is first loaded or created.
   */
  initSessionSnapshot(sessionId: string, snapshot: SessionMetadataSnapshot): void {
    this.sessionSnapshots.set(sessionId, { ...snapshot });
  }

  /**
   * Remove a session's metadata snapshot.
   * Call this when a session is deleted.
   */
  removeSessionSnapshot(sessionId: string): void {
    this.sessionSnapshots.delete(sessionId);
  }

  /**
   * Reload configuration from disk.
   * Called when hooks.json changes.
   */
  reloadConfig(): void {
    debug(`[HookSystem] Reloading hooks config for workspace ${this.workspaceId}`);
    this.unregisterHandlers();
    this.loadConfig();
  }

  /**
   * Get the current hooks config (for inspection/debugging).
   */
  getConfig(): HooksConfig | null {
    return this.config;
  }

  /**
   * Get the event bus (for direct listener registration).
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Dispose the hook system.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    debug(`[HookSystem] Disposing for workspace ${this.workspaceId}`);

    this.stopSchedulerTick();
    this.unregisterHandlers();
    this.promptHandler.dispose();
    this.eventBus.dispose();
    this.sessionSnapshots.clear();
  }

  // ============================================================
  // Internal
  // ============================================================

  /**
   * Load hooks config and register event handlers.
   */
  private loadConfig(): void {
    const { config, result } = loadAndValidateHooksConfig(this.workspacePath);

    if (!config) {
      this.config = null;
      this.stopSchedulerTick();
      if (result.errors.length > 0) {
        debug(`[HookSystem] Config errors: ${result.errors.map(e => e.message).join(', ')}`);
      }
      return;
    }

    this.config = config;
    this.registerHandlers();

    // Start/stop scheduler tick based on whether SchedulerTick hooks are configured
    if (config.hooks.SchedulerTick && config.hooks.SchedulerTick.length > 0) {
      this.startSchedulerTick();
    } else {
      this.stopSchedulerTick();
    }

    const matcherCount = Object.values(config.hooks).reduce(
      (sum, matchers) => sum + (matchers?.length ?? 0), 0
    );
    debug(`[HookSystem] Loaded ${matcherCount} hook matcher(s) for workspace ${this.workspaceId}`);
  }

  /**
   * Start emitting SchedulerTick events every 60 seconds, aligned to minute boundary.
   */
  private startSchedulerTick(): void {
    if (this.schedulerTickTimer) return; // Already running

    const emitTick = () => {
      if (this.disposed) return;
      const now = new Date();
      const minute = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      this.emit('SchedulerTick', { minute }).catch(() => {});
    };

    // Align to next minute boundary
    const now = Date.now();
    const msToNextMinute = 60_000 - (now % 60_000);

    // First tick at next minute boundary, then every 60 seconds
    this.schedulerTickTimer = setTimeout(() => {
      emitTick();
      this.schedulerTickTimer = setInterval(emitTick, 60_000) as unknown as NodeJS.Timeout;
    }, msToNextMinute);

    debug(`[HookSystem] Started scheduler tick (next in ${Math.round(msToNextMinute / 1000)}s)`);
  }

  /**
   * Stop emitting SchedulerTick events.
   */
  private stopSchedulerTick(): void {
    if (this.schedulerTickTimer) {
      clearTimeout(this.schedulerTickTimer);
      clearInterval(this.schedulerTickTimer);
      this.schedulerTickTimer = null;
      debug(`[HookSystem] Stopped scheduler tick`);
    }
  }

  /**
   * Register event bus listeners based on current config.
   */
  private registerHandlers(): void {
    if (!this.config) return;

    for (const [eventType, matchers] of Object.entries(this.config.hooks)) {
      if (!matchers || matchers.length === 0) continue;

      const unsub = this.eventBus.on(
        eventType as HookEventType,
        async (event, payload) => {
          await this.processMatchers(
            event,
            payload,
            matchers,
          );
        },
      );

      this.unsubscribers.push(unsub);
    }
  }

  /**
   * Unregister all event bus listeners.
   */
  private unregisterHandlers(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  /**
   * Process matchers for an event, executing matching hooks.
   */
  private async processMatchers(
    event: HookEventType,
    payload: BaseEventPayload,
    matchers: HookMatcher[],
  ): Promise<void> {
    // Get session labels for label-based filtering
    const sessionLabels = payload.sessionId
      ? this.sessionSnapshots.get(payload.sessionId)?.labels
      : undefined;

    for (const matcher of matchers) {
      // For SchedulerTick, check cron expression
      if (event === 'SchedulerTick' && matcher.cron) {
        const now = new Date(payload.timestamp);
        if (!cronMatchesNow(matcher.cron, now, matcher.timezone)) {
          continue;
        }
      }

      // Check if matcher matches this event
      if (!matchesEvent(matcher, event, payload, sessionLabels)) {
        continue;
      }

      // Execute all hook actions for this matcher
      for (const action of matcher.hooks) {
        try {
          await this.executeAction(action, event, payload);
        } catch (error) {
          debug(`[HookSystem] Hook action error: ${error instanceof Error ? error.message : error}`);
        }
      }
    }
  }

  /**
   * Execute a single hook action.
   */
  private async executeAction(
    action: HookAction,
    event: HookEventType,
    payload: BaseEventPayload,
  ): Promise<void> {
    switch (action.type) {
      case 'command':
        await this.commandHandler.handle(action, event, payload);
        break;
      case 'prompt':
        await this.promptHandler.handle(action, event, payload);
        break;
      case 'event-log':
        await this.eventLogHandler.handle(action, event, payload);
        break;
    }
  }
}
