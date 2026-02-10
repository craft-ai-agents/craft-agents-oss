/**
 * HookSystem - Unified Facade for the Hooks System
 *
 * Single entry point that:
 * - Creates EventBus instance (per workspace)
 * - Creates and registers all handlers
 * - Loads hooks.json configuration
 * - Manages scheduler service
 * - Provides diffing for session metadata changes
 * - Provides dispose() for cleanup
 *
 * Benefits:
 * - No global state - each HookSystem instance is self-contained
 * - Easy to create for testing
 * - SessionManager uses ~30 lines instead of ~300
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../utils/debug.ts';
import { WorkspaceEventBus, type EventPayloadMap } from './event-bus.ts';
import { CommandHandler, PromptHandler, EventLogHandler, type HooksConfigProvider } from './handlers/index.ts';
import { AGENT_EVENTS, type HooksConfig, type HookEvent, type HookMatcher, type PendingPrompt, type AppEvent, type AgentEvent, type CommandHookDefinition, type SdkHookInput, type SdkHookCallbackMatcher } from './types.ts';
import { validateHooksConfig } from './validation.ts';
import { buildEnvFromSdkInput } from './sdk-bridge.ts';
import { executeCommand } from './command-executor.ts';
import { SchedulerService, type SchedulerTickPayload } from '../scheduler/scheduler-service.ts';

const log = createLogger('hook-system');

// Re-export SessionMetadataSnapshot from types (single source of truth)
export type { SessionMetadataSnapshot } from './types.ts';
import type { SessionMetadataSnapshot } from './types.ts';

// ============================================================================
// HookSystem Options
// ============================================================================

export interface HookSystemOptions {
  /** Workspace root path (where hooks.json lives) */
  workspaceRootPath: string;
  /** Workspace ID for logging and events */
  workspaceId: string;
  /** Working directory for command execution */
  workingDir?: string;
  /** Active source slugs for permission rules */
  activeSourceSlugs?: string[];
  /** Whether to start the scheduler service (default: false) */
  enableScheduler?: boolean;
  /** Called when prompts are ready to be executed */
  onPromptsReady?: (prompts: PendingPrompt[]) => void;
  /** Called when an error occurs during hook execution */
  onError?: (event: HookEvent, error: Error) => void;
  /** Called when events are lost after retries */
  onEventLost?: (events: string[], error: Error) => void;
}

// ============================================================================
// HookSystem Implementation
// ============================================================================

export class HookSystem implements HooksConfigProvider {
  readonly eventBus: WorkspaceEventBus;

  private readonly options: HookSystemOptions;
  private config: HooksConfig | null = null;
  private commandHandler: CommandHandler | null = null;
  private promptHandler: PromptHandler | null = null;
  private eventLogHandler: EventLogHandler | null = null;
  private scheduler: SchedulerService | null = null;
  private disposed = false;

  // Session metadata tracking (moved from SessionManager)
  private readonly lastKnownMetadata: Map<string, SessionMetadataSnapshot> = new Map();

  constructor(options: HookSystemOptions) {
    this.options = options;
    this.eventBus = new WorkspaceEventBus(options.workspaceId);

    // Load configuration
    this.loadConfig();

    // Create handlers
    this.createHandlers();

    // Start scheduler if enabled
    if (options.enableScheduler) {
      this.startScheduler();
    }

    log.debug(`[HookSystem] Created for workspace: ${options.workspaceId}`);
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Load hooks configuration from hooks.json.
   */
  private loadConfig(): void {
    const configPath = join(this.options.workspaceRootPath, 'hooks.json');

    if (!existsSync(configPath)) {
      log.debug(`[HookSystem] No hooks.json found at ${configPath}`);
      this.config = { hooks: {} };
      return;
    }

    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      const validation = validateHooksConfig(raw);

      if (!validation.valid) {
        console.warn('[HookSystem] Invalid hooks.json:', validation.errors);
        this.config = { hooks: {} };
        return;
      }

      this.config = validation.config;
      const hookCount = this.getHookCount();
      log.debug(`[HookSystem] Loaded ${hookCount} hooks from ${configPath}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.warn('[HookSystem] Failed to load hooks.json:', error);
      this.config = { hooks: {} };
    }
  }

  /**
   * Reload hooks configuration.
   * Call this when hooks.json changes.
   */
  reloadConfig(): { success: boolean; hookCount: number; errors: string[] } {
    const configPath = join(this.options.workspaceRootPath, 'hooks.json');

    if (!existsSync(configPath)) {
      this.config = { hooks: {} };
      return { success: true, hookCount: 0, errors: [] };
    }

    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      const validation = validateHooksConfig(raw);

      if (!validation.valid) {
        return { success: false, hookCount: 0, errors: validation.errors };
      }

      this.config = validation.config;
      const hookCount = this.getHookCount();
      log.debug(`[HookSystem] Reloaded ${hookCount} hooks`);
      return { success: true, hookCount, errors: [] };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, hookCount: 0, errors: [`Failed to parse JSON: ${error}`] };
    }
  }

  /**
   * Get total number of hooks.
   */
  private getHookCount(): number {
    if (!this.config) return 0;
    return Object.values(this.config.hooks).reduce(
      (sum, matchers) => sum + (matchers?.reduce((s, m) => s + m.hooks.length, 0) ?? 0),
      0
    );
  }

  // ============================================================================
  // HooksConfigProvider Implementation
  // ============================================================================

  getConfig(): HooksConfig | null {
    return this.config;
  }

  getMatchersForEvent(event: HookEvent): HookMatcher[] {
    return this.config?.hooks[event] ?? [];
  }

  // ============================================================================
  // Handlers
  // ============================================================================

  /**
   * Create and register all handlers.
   */
  private createHandlers(): void {
    // Command handler
    this.commandHandler = new CommandHandler(
      {
        workspaceRootPath: this.options.workspaceRootPath,
        workingDir: this.options.workingDir,
        activeSourceSlugs: this.options.activeSourceSlugs,
        onError: this.options.onError,
      },
      this
    );
    this.commandHandler.subscribe(this.eventBus);

    // Prompt handler
    this.promptHandler = new PromptHandler(
      {
        workspaceId: this.options.workspaceId,
        onPromptsReady: this.options.onPromptsReady,
        onError: this.options.onError,
      },
      this
    );
    this.promptHandler.subscribe(this.eventBus);

    // Event log handler
    this.eventLogHandler = new EventLogHandler({
      workspaceRootPath: this.options.workspaceRootPath,
      workspaceId: this.options.workspaceId,
      onEventLost: this.options.onEventLost,
    });
    this.eventLogHandler.subscribe(this.eventBus);

    log.debug(`[HookSystem] Handlers created and subscribed`);
  }

  // ============================================================================
  // Scheduler
  // ============================================================================

  /**
   * Start the scheduler service.
   */
  private startScheduler(): void {
    if (this.scheduler) return;

    this.scheduler = new SchedulerService(async (payload: SchedulerTickPayload) => {
      await this.eventBus.emit('SchedulerTick', {
        workspaceId: this.options.workspaceId,
        timestamp: Date.now(),
        localTime: payload.localTime,
        utcTime: payload.timestamp,
      });
    });

    this.scheduler.start();
    log.debug(`[HookSystem] Scheduler started`);
  }

  /**
   * Stop the scheduler service.
   */
  stopScheduler(): void {
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
      log.debug(`[HookSystem] Scheduler stopped`);
    }
  }

  // ============================================================================
  // Session Metadata Diffing
  // ============================================================================

  /**
   * Update session metadata and emit events for changes.
   *
   * This replaces the diffing logic that was in SessionManager.
   * Call this whenever session metadata changes.
   *
   * @param sessionId - The session ID
   * @param next - The new metadata snapshot
   * @returns The events that were emitted
   */
  async updateSessionMetadata(
    sessionId: string,
    next: SessionMetadataSnapshot
  ): Promise<AppEvent[]> {
    const prev = this.lastKnownMetadata.get(sessionId) ?? {};
    const emittedEvents: AppEvent[] = [];
    const timestamp = Date.now();

    // Session name for all events
    const sessionName = next.sessionName;

    // Permission mode change
    if (prev.permissionMode !== next.permissionMode) {
      await this.eventBus.emit('PermissionModeChange', {
        sessionId,
        sessionName,
        workspaceId: this.options.workspaceId,
        timestamp,
        oldMode: prev.permissionMode ?? '',
        newMode: next.permissionMode ?? '',
      });
      emittedEvents.push('PermissionModeChange');
    }

    // Labels (array diff)
    const prevLabels = new Set(prev.labels ?? []);
    const nextLabels = new Set(next.labels ?? []);

    for (const label of nextLabels) {
      if (!prevLabels.has(label)) {
        await this.eventBus.emit('LabelAdd', {
          sessionId,
          sessionName,
          workspaceId: this.options.workspaceId,
          timestamp,
          label,
        });
        emittedEvents.push('LabelAdd');
      }
    }

    for (const label of prevLabels) {
      if (!nextLabels.has(label)) {
        await this.eventBus.emit('LabelRemove', {
          sessionId,
          sessionName,
          workspaceId: this.options.workspaceId,
          timestamp,
          label,
        });
        emittedEvents.push('LabelRemove');
      }
    }

    // Flag change
    const wasFlagged = prev.isFlagged ?? false;
    const isFlagged = next.isFlagged ?? false;
    if (wasFlagged !== isFlagged) {
      await this.eventBus.emit('FlagChange', {
        sessionId,
        sessionName,
        workspaceId: this.options.workspaceId,
        timestamp,
        isFlagged,
      });
      emittedEvents.push('FlagChange');
    }

    // Todo state change
    if (prev.todoState !== next.todoState) {
      await this.eventBus.emit('TodoStateChange', {
        sessionId,
        sessionName,
        workspaceId: this.options.workspaceId,
        timestamp,
        oldState: prev.todoState ?? '',
        newState: next.todoState ?? '',
      });
      emittedEvents.push('TodoStateChange');
    }

    // Update stored metadata
    this.lastKnownMetadata.set(sessionId, { ...next });

    if (emittedEvents.length > 0) {
      log.debug(`[HookSystem] Emitted ${emittedEvents.length} events for session ${sessionId}: ${emittedEvents.join(', ')}`);
    }

    return emittedEvents;
  }

  /**
   * Remove session metadata tracking.
   * Call this when a session is deleted.
   */
  removeSessionMetadata(sessionId: string): void {
    this.lastKnownMetadata.delete(sessionId);
    log.debug(`[HookSystem] Removed metadata for session ${sessionId}`);
  }

  /**
   * Get stored metadata for a session.
   */
  getSessionMetadata(sessionId: string): SessionMetadataSnapshot | undefined {
    return this.lastKnownMetadata.get(sessionId);
  }

  /**
   * Set initial metadata for a session (without emitting events).
   * Call this when loading existing sessions.
   */
  setInitialSessionMetadata(sessionId: string, metadata: SessionMetadataSnapshot): void {
    this.lastKnownMetadata.set(sessionId, { ...metadata });
  }

  // ============================================================================
  // Direct Event Emission
  // ============================================================================

  /**
   * Emit a LabelConfigChange event.
   * Call this when labels/config.json changes.
   */
  async emitLabelConfigChange(): Promise<void> {
    await this.eventBus.emit('LabelConfigChange', {
      workspaceId: this.options.workspaceId,
      timestamp: Date.now(),
    });
  }

  /**
   * Emit an event directly (for edge cases).
   */
  async emit<T extends HookEvent>(event: T, payload: EventPayloadMap[T]): Promise<void> {
    await this.eventBus.emit(event, payload);
  }

  // ============================================================================
  // SDK Hook Integration
  // ============================================================================

  /**
   * Build SDK hooks callbacks from hooks.json definitions.
   * This is the bridge between hooks.json and the Claude SDK hook system.
   *
   * Returns a partial record of event name -> array of hook matchers in SDK format.
   * The caller should merge these with any internal hooks.
   */
  buildSdkHooks(): Partial<Record<AgentEvent, SdkHookCallbackMatcher[]>> {
    if (!this.config) return {};

    const sdkHooks: Partial<Record<AgentEvent, SdkHookCallbackMatcher[]>> = {};

    for (const event of AGENT_EVENTS) {
      const matchers = this.config.hooks[event];
      if (!matchers?.length) continue;

      sdkHooks[event] = matchers.filter(m => m.enabled !== false).map(matcher => ({
        matcher: matcher.matcher,
        timeout: 30,
        hooks: [async (input: SdkHookInput, _toolUseId: string, options: { signal?: AbortSignal }) => {
          // Build environment variables from SDK input
          const env = buildEnvFromSdkInput(event, input);

          // Execute command hooks for this matcher
          const result = await this.executeHooksForSdkMatcher(matcher, event, env, options.signal);

          return result;
        }],
      }));
    }

    return sdkHooks;
  }

  /**
   * Execute command hooks for a matcher and return SDK-compatible result.
   */
  private async executeHooksForSdkMatcher(
    matcher: HookMatcher,
    event: AgentEvent,
    env: Record<string, string>,
    signal?: AbortSignal
  ): Promise<{ continue: boolean; reason?: string }> {
    const commandHooks = matcher.hooks.filter((h): h is CommandHookDefinition => h.type === 'command');

    if (commandHooks.length === 0) {
      return { continue: true };
    }

    for (const hook of commandHooks) {
      if (signal?.aborted) {
        return { continue: false, reason: 'Aborted' };
      }

      const result = await executeCommand(hook.command, {
        env,
        timeout: hook.timeout ?? 60000,
        cwd: this.options.workingDir,
        permissionMode: matcher.permissionMode,
        permissionsContext: {
          workspaceRootPath: this.options.workspaceRootPath,
          activeSourceSlugs: this.options.activeSourceSlugs,
        },
      });

      if (result.blocked) {
        console.warn(`[HookSystem] Blocked command in ${event}: ${hook.command} - ${result.stderr}`);
        continue;
      }

      if (!result.success) {
        console.warn(`[HookSystem] Command failed in ${event}: ${hook.command}`, result.stderr);
      }
    }

    return { continue: true };
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Check if the system has been disposed.
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Dispose the hook system, cleaning up all resources.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    log.debug(`[HookSystem] Disposing for workspace: ${this.options.workspaceId}`);

    // Stop scheduler
    this.stopScheduler();

    // Dispose handlers
    this.commandHandler?.dispose();
    this.promptHandler?.dispose();
    await this.eventLogHandler?.dispose();

    // Dispose event bus
    this.eventBus.dispose();

    // Clear metadata
    this.lastKnownMetadata.clear();

    this.disposed = true;
    log.debug(`[HookSystem] Disposed`);
  }
}
