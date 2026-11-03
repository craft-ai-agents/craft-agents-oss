/**
 * AutomationSystem - Unified Facade for the Automations System
 *
 * Single entry point that:
 * - Creates EventBus instance (per workspace)
 * - Creates and registers all handlers
 * - Loads automations.json configuration
 * - Manages scheduler service
 * - Provides diffing for session metadata changes
 * - Provides dispose() for cleanup
 *
 * Benefits:
 * - No global state - each AutomationSystem instance is self-contained
 * - Easy to create for testing
 * - SessionManager uses ~30 lines instead of ~300
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAutomationsConfigPath, generateShortId } from './resolve-config-path.ts';
import { compactAutomationHistorySync } from './history-store.ts';
import { createLogger } from '../utils/debug.ts';
import { WorkspaceEventBus, type EventPayloadMap } from './event-bus.ts';
import { PromptHandler, EventLogHandler, WebhookHandler, ScriptHandler, type AutomationsConfigProvider } from './handlers/index.ts';
import { type AutomationsConfig, type AutomationEvent, type AutomationMatcher, type PendingPrompt, type WebhookActionResult, type ScriptActionResult, type AppEvent, type AgentEvent, type SdkAutomationCallbackMatcher, type SdkAutomationInput, type AutomationLoadIssue, type AutomationsLenientLoadResult } from './types.ts';
import { buildPageRefreshMatchers } from '../pages/refresh.ts';
import { loadAutomationsConfigLenient } from './validation.ts';
import { matcherMatchesSdk } from './utils.ts';
import { SchedulerService, type SchedulerTickPayload } from '../scheduler/scheduler-service.ts';

const log = createLogger('automation-system');

// Re-export SessionMetadataSnapshot from types (single source of truth)
export type { SessionMetadataSnapshot } from './types.ts';
import type { SessionMetadataSnapshot } from './types.ts';

// ============================================================================
// AutomationSystem Options
// ============================================================================

export interface AutomationSystemOptions {
  /** Workspace root path (where automations.json lives) */
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
  /** Called when webhook results are available */
  onWebhookResults?: (results: WebhookActionResult[]) => void;
  /** Called when script results are available */
  onScriptResults?: (results: ScriptActionResult[]) => void;
  /** Called when an error occurs during automation execution */
  onError?: (event: AutomationEvent, error: Error) => void;
  /** Called when events are lost after retries */
  onEventLost?: (events: string[], error: Error) => void;
}

// ============================================================================
// AutomationSystem Implementation
// ============================================================================

export class AutomationSystem implements AutomationsConfigProvider {
  readonly eventBus: WorkspaceEventBus;

  private readonly options: AutomationSystemOptions;
  private config: AutomationsConfig | null = null;
  private promptHandler: PromptHandler | null = null;
  private webhookHandler: WebhookHandler | null = null;
  private scriptHandler: ScriptHandler | null = null;
  private eventLogHandler: EventLogHandler | null = null;
  private scheduler: SchedulerService | null = null;
  private disposed = false;
  /** Synthetic SchedulerTick matchers derived from page refresh specs */
  private pageRefreshMatchers: AutomationMatcher[] = [];

  // Session metadata tracking (moved from SessionManager)
  private readonly lastKnownMetadata: Map<string, SessionMetadataSnapshot> = new Map();

  constructor(options: AutomationSystemOptions) {
    this.options = options;
    this.eventBus = new WorkspaceEventBus(options.workspaceId);

    // Load configuration
    this.loadConfig();

    // Materialize page refresh specs as synthetic cron matchers
    this.reloadPageRefreshMatchers();

    // Create handlers
    this.createHandlers();

    // Start scheduler if enabled
    if (options.enableScheduler) {
      this.startScheduler();
    }

    log.debug(`[AutomationSystem] Created for workspace: ${options.workspaceId}`);
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Read and parse automations.json, then load it leniently: every valid
   * matcher is kept, invalid ones are skipped and reported, so one bad entry
   * can't stop the others (see loadAutomationsConfigLenient). Shared pipeline
   * for loadConfig/reloadConfig; returns the raw JSON too so backfillIds doesn't
   * re-read. Throws only when the file is not valid JSON.
   */
  private readAndLoadConfig(configPath: string): { raw: unknown; result: AutomationsLenientLoadResult } {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    return { raw, result: loadAutomationsConfigLenient(raw) };
  }

  /** One line per load issue, for logs and reloadConfig's result. */
  private static formatLoadIssues(issues: AutomationLoadIssue[]): string[] {
    return issues.map((issue) => {
      const where = issue.event === undefined
        ? 'automations.json'
        : `${issue.event}${issue.index === undefined ? '' : `[${issue.index}]`}${issue.name ? ` (${issue.name})` : ''}`;
      return `${where}: ${issue.messages.join('; ')}`;
    });
  }

  /**
   * Load automations configuration from automations.json.
   */
  private loadConfig(): void {
    const configPath = resolveAutomationsConfigPath(this.options.workspaceRootPath);

    if (!existsSync(configPath)) {
      log.debug(`[AutomationSystem] No automations config found at ${configPath}`);
      this.config = { automations: {} };
      return;
    }

    try {
      const { raw, result } = this.readAndLoadConfig(configPath);
      this.config = result.config;
      if (result.issues.length > 0) {
        console.warn('[AutomationSystem] Some automations will not run:', AutomationSystem.formatLoadIssues(result.issues));
      }
      this.backfillIds(configPath, raw);
      this.rotateHistory();
      const actionCount = this.getActionCount();
      log.debug(`[AutomationSystem] Loaded ${actionCount} actions from ${configPath}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.warn('[AutomationSystem] Failed to load automations config:', error);
      this.config = { automations: {} };
    }
  }

  /**
   * Reload automations configuration.
   * Call this when automations.json changes.
   *
   * `success` means the file was read and loaded; `errors` lists the automations
   * that will not run (skipped as invalid, or on an event that never runs).
   * When the file is not valid JSON (e.g. mid-edit) the last loaded config keeps
   * running and `success` is false.
   */
  reloadConfig(): { success: boolean; automationCount: number; errors: string[] } {
    const configPath = resolveAutomationsConfigPath(this.options.workspaceRootPath);

    if (!existsSync(configPath)) {
      this.config = { automations: {} };
      return { success: true, automationCount: 0, errors: [] };
    }

    try {
      const { raw, result } = this.readAndLoadConfig(configPath);
      this.config = result.config;
      this.backfillIds(configPath, raw);
      const actionCount = this.getActionCount();
      log.debug(`[AutomationSystem] Reloaded ${actionCount} actions`);
      return { success: true, automationCount: actionCount, errors: AutomationSystem.formatLoadIssues(result.issues) };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, automationCount: 0, errors: [`Failed to parse JSON: ${error}`] };
    }
  }

  /**
   * Backfill missing IDs on matchers in the raw config.
   * Operates on the already-parsed raw JSON to avoid re-reading from disk.
   * Only writes if IDs were actually missing — no-op on subsequent loads.
   */
  private backfillIds(configPath: string, raw: unknown): void {
    try {
      const obj = raw as Record<string, unknown>;
      const eventMap = (obj.automations ?? obj.tasks ?? obj.hooks) as Record<string, unknown[]> | undefined;
      if (!eventMap) return;

      let changed = false;
      for (const matchers of Object.values(eventMap)) {
        if (!Array.isArray(matchers)) continue;
        for (const m of matchers as Record<string, unknown>[]) {
          if (!m.id) { m.id = generateShortId(); changed = true; }
        }
      }

      if (changed) {
        writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
        log.debug('[AutomationSystem] Backfilled missing matcher IDs');
      }
    } catch {
      // Non-critical — IDs will be backfilled on next mutation via IPC
    }
  }

  /**
   * Compact automations-history.jsonl on startup: two-tier retention.
   * 1) Keep only the last N entries per automation ID.
   * 2) If total still exceeds the global cap, drop oldest globally.
   * Runs synchronously during init — single-threaded, no race with concurrent appends.
   */
  private rotateHistory(): void {
    try {
      compactAutomationHistorySync(this.options.workspaceRootPath);
    } catch {
      // Non-critical — compaction failure doesn't affect functionality
    }
  }

  /**
   * Get total number of actions.
   */
  private getActionCount(): number {
    if (!this.config) return 0;
    return Object.values(this.config.automations).reduce(
      (sum, matchers) => sum + (matchers?.reduce((s, m) => s + m.actions.length, 0) ?? 0),
      0
    );
  }

  // ============================================================================
  // AutomationsConfigProvider Implementation
  // ============================================================================

  getConfig(): AutomationsConfig | null {
    return this.config;
  }

  getMatchersForEvent(event: AutomationEvent): AutomationMatcher[] {
    const configured = this.config?.automations[event] ?? [];
    // Page refreshes are cron-driven: synthetic matchers only join SchedulerTick
    if (event === 'SchedulerTick' && this.pageRefreshMatchers.length > 0) {
      return [...configured, ...this.pageRefreshMatchers];
    }
    return configured;
  }

  /**
   * Rebuild the synthetic page-refresh matchers from pages/{slug}/page.json.
   * Called at construction and whenever the config watcher reports a pages
   * change. Returns the number of scheduled page refreshes.
   */
  reloadPageRefreshMatchers(): number {
    try {
      this.pageRefreshMatchers = buildPageRefreshMatchers(this.options.workspaceRootPath);
    } catch (e) {
      // Non-critical — a broken page config must never break automations
      log.debug(`[AutomationSystem] Failed to build page refresh matchers: ${e}`);
      this.pageRefreshMatchers = [];
    }
    if (this.pageRefreshMatchers.length > 0) {
      log.debug(`[AutomationSystem] ${this.pageRefreshMatchers.length} page refresh matcher(s) active`);
    }
    return this.pageRefreshMatchers.length;
  }

  // ============================================================================
  // Handlers
  // ============================================================================

  /**
   * Create and register all handlers.
   */
  private createHandlers(): void {
    // Prompt handler
    this.promptHandler = new PromptHandler(
      {
        workspaceId: this.options.workspaceId,
        workspaceRootPath: this.options.workspaceRootPath,
        onPromptsReady: this.options.onPromptsReady,
        onError: this.options.onError,
      },
      this
    );
    this.promptHandler.subscribe(this.eventBus);

    // Webhook handler
    this.webhookHandler = new WebhookHandler(
      {
        workspaceId: this.options.workspaceId,
        workspaceRootPath: this.options.workspaceRootPath,
        onWebhookResults: this.options.onWebhookResults,
        onError: this.options.onError,
      },
      this
    );
    this.webhookHandler.subscribe(this.eventBus);

    // Script handler
    this.scriptHandler = new ScriptHandler(
      {
        workspaceId: this.options.workspaceId,
        workspaceRootPath: this.options.workspaceRootPath,
        onScriptResults: this.options.onScriptResults,
        onError: this.options.onError,
      },
      this
    );
    this.scriptHandler.subscribe(this.eventBus);

    // Event log handler
    this.eventLogHandler = new EventLogHandler({
      workspaceRootPath: this.options.workspaceRootPath,
      workspaceId: this.options.workspaceId,
      onEventLost: this.options.onEventLost,
    });
    this.eventLogHandler.subscribe(this.eventBus);

    log.debug(`[AutomationSystem] Handlers created and subscribed`);
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
    log.debug(`[AutomationSystem] Scheduler started`);
  }

  /**
   * Stop the scheduler service.
   */
  stopScheduler(): void {
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
      log.debug(`[AutomationSystem] Scheduler stopped`);
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

    // Common fields for all events
    const sessionName = next.sessionName;
    const labels = next.labels ?? [];

    // Permission mode change
    if (prev.permissionMode !== next.permissionMode) {
      await this.eventBus.emit('PermissionModeChange', {
        sessionId,
        sessionName,
        workspaceId: this.options.workspaceId,
        timestamp,
        labels,
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
          labels: [...nextLabels],
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
          labels: [...nextLabels],
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
        labels,
        isFlagged,
      });
      emittedEvents.push('FlagChange');
    }

    // Session status change
    if (prev.sessionStatus !== next.sessionStatus) {
      await this.eventBus.emit('SessionStatusChange', {
        sessionId,
        sessionName,
        workspaceId: this.options.workspaceId,
        timestamp,
        labels,
        oldState: prev.sessionStatus ?? '',
        newState: next.sessionStatus ?? '',
      });
      emittedEvents.push('SessionStatusChange');
    }

    // Update stored metadata
    this.lastKnownMetadata.set(sessionId, { ...next });

    if (emittedEvents.length > 0) {
      log.debug(`[AutomationSystem] Emitted ${emittedEvents.length} events for session ${sessionId}: ${emittedEvents.join(', ')}`);
    }

    return emittedEvents;
  }

  /**
   * Remove session metadata tracking.
   * Call this when a session is deleted.
   */
  removeSessionMetadata(sessionId: string): void {
    this.lastKnownMetadata.delete(sessionId);
    log.debug(`[AutomationSystem] Removed metadata for session ${sessionId}`);
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
  async emit<T extends AutomationEvent>(event: T, payload: EventPayloadMap[T]): Promise<void> {
    await this.eventBus.emit(event, payload);
  }

  // ============================================================================
  // Agent Event Execution (Backend-Agnostic)
  // ============================================================================

  /**
   * Match an agent event (PreToolUse, Stop, …) against automations.json.
   * Entry point for backends that emit agent events themselves (Pi); Claude would
   * go through buildSdkHooks.
   *
   * Agent events do NOT run actions: prompt, webhook and script actions run on
   * app events only (#1117). This counts matching matchers (conditions included)
   * and nothing else. loadAutomationsConfigLenient and config_validate report
   * agent-event automations as never running, so users and agents learn it.
   *
   * @param signal - Optional AbortSignal (unused while nothing runs)
   * @returns Number of matched matchers (for diagnostics/testing)
   */
  async executeAgentEvent(event: AgentEvent, input: SdkAutomationInput, signal?: AbortSignal): Promise<number> {
    if (!this.config) return 0;

    const matchers = this.config.automations[event];
    if (!matchers?.length) return 0;

    let matchedCount = 0;

    for (const matcher of matchers) {
      if (!matcherMatchesSdk(matcher, event, input)) continue;

      matchedCount++;
      log.debug(`[AutomationSystem] Matched ${event} automation (agent events don't run actions)`);
    }

    return matchedCount;
  }

  // ============================================================================
  // SDK Automation Integration
  // ============================================================================

  /**
   * Claude SDK hooks for agent-event automations. Always empty: agent events don't
   * run actions (prompt, webhook and script actions run on app events only; #1117).
   * Kept as the seam ClaudeAgent merges into its query hooks, should agent-event
   * actions ever be built.
   */
  buildSdkHooks(): Partial<Record<AgentEvent, SdkAutomationCallbackMatcher[]>> {
    return {};
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
   * Dispose the automation system, cleaning up all resources.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;

    log.debug(`[AutomationSystem] Disposing for workspace: ${this.options.workspaceId}`);

    // Stop scheduler
    this.stopScheduler();

    // Dispose handlers
    this.promptHandler?.dispose();
    this.webhookHandler?.dispose();
    this.scriptHandler?.dispose();
    await this.eventLogHandler?.dispose();

    // Dispose event bus
    this.eventBus.dispose();

    // Clear metadata
    this.lastKnownMetadata.clear();

    this.disposed = true;
    log.debug(`[AutomationSystem] Disposed`);
  }
}
