/**
 * ScriptHandler - Processes script actions for App events
 *
 * Subscribes to App events and executes workspace-local scripts via the
 * script executor (argv spawn through resolveScriptRuntime — never a shell).
 *
 * Concurrency: runs of the SAME matcher never overlap. A tick that fires
 * while the matcher's previous run is still in flight is skipped and
 * recorded in history (a hanging script surfaces as a run of skips instead
 * of silently piling up processes). Actions within one matcher run
 * sequentially; distinct matchers run independently.
 */

import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { AutomationHandler, AutomationsConfigProvider } from './types.ts';
import { APP_EVENTS, type AutomationEvent, type ScriptAction, type ScriptActionResult, type AppEvent } from '../types.ts';
import { matcherMatches, buildScriptEnv } from '../utils.ts';
import { executeScriptAction, createScriptHistoryEntry } from '../script-executor.ts';
import { appendAutomationHistoryEntry } from '../history-store.ts';

const log = createLogger('script-handler');

// ============================================================================
// Types
// ============================================================================

export interface ScriptHandlerOptions {
  /** Workspace ID */
  workspaceId: string;
  /** Workspace root path (scripts live and run here) */
  workspaceRootPath: string;
  /** Called when script results are available */
  onScriptResults?: (results: ScriptActionResult[]) => void;
  /** Called when a script execution fails unexpectedly */
  onError?: (event: AutomationEvent, error: Error) => void;
}

/** Script actions of one matched matcher, executed sequentially under its lock */
interface MatcherScripts {
  matcherId: string;
  actions: ScriptAction[];
}

// ============================================================================
// ScriptHandler Implementation
// ============================================================================

export class ScriptHandler implements AutomationHandler {
  private readonly options: ScriptHandlerOptions;
  private readonly configProvider: AutomationsConfigProvider;
  /** Per-matcher concurrency locks: present key = run in flight */
  private readonly inFlight = new Map<string, Promise<void>>();
  private bus: EventBus | null = null;
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null;

  constructor(options: ScriptHandlerOptions, configProvider: AutomationsConfigProvider) {
    this.options = options;
    this.configProvider = configProvider;
  }

  /**
   * Subscribe to App events on the bus.
   */
  subscribe(bus: EventBus): void {
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
    log.debug(`[ScriptHandler] Subscribed to event bus`);
  }

  /**
   * Handle an event by executing matching script actions.
   */
  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    // Only process App events for script actions
    if (!APP_EVENTS.includes(event as AppEvent)) {
      return;
    }

    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;

    const matched: MatcherScripts[] = [];
    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload as unknown as Record<string, unknown>)) continue;

      const actions = matcher.actions.filter((a): a is ScriptAction => a.type === 'script');
      if (actions.length > 0) {
        matched.push({ matcherId: matcher.id ?? 'unknown', actions });
      }
    }

    if (matched.length === 0) return;

    log.debug(`[ScriptHandler] Processing ${matched.length} matchers with script actions for ${event}`);

    const results: ScriptActionResult[] = [];

    await Promise.all(
      matched.map(async ({ matcherId, actions }) => {
        // Per-matcher concurrency lock: skip (and record) instead of piling up.
        if (this.inFlight.has(matcherId)) {
          log.debug(`[ScriptHandler] Skipping ${matcherId}: previous run still in progress`);
          for (const action of actions) {
            const skipped: ScriptActionResult = {
              type: 'script',
              script: action.script,
              success: false,
              exitCode: null,
              skipped: true,
              stdout: '',
              stderr: 'Skipped: previous run of this automation is still in progress',
              durationMs: 0,
              page: action.page,
            };
            results.push(skipped);
            await this.appendHistory(matcherId, skipped);
          }
          return;
        }

        const run = (async () => {
          for (const action of actions) {
            try {
              const env = buildScriptEnv(event, payload, {
                workspaceRootPath: this.options.workspaceRootPath,
                page: action.page,
              });
              const result = await executeScriptAction(action, {
                workspaceRootPath: this.options.workspaceRootPath,
                env,
              });

              if (!result.success) {
                log.debug(`[ScriptHandler] ${action.script} → ${result.stderr.slice(0, 200)}`);
              }
              results.push(result);
              await this.appendHistory(matcherId, result);
            } catch (error) {
              // executeScriptAction folds failures into its result; this is a
              // true unexpected error (e.g. history I/O) — report, keep going.
              const err = error instanceof Error ? error : new Error(String(error));
              log.error(`[ScriptHandler] Error executing ${action.script}:`, err);
              this.options.onError?.(event, err);
            }
          }
        })();

        this.inFlight.set(matcherId, run);
        try {
          await run;
        } finally {
          this.inFlight.delete(matcherId);
        }
      })
    );

    if (results.length > 0 && this.options.onScriptResults) {
      log.debug(`[ScriptHandler] Delivering ${results.length} script results`);
      this.options.onScriptResults(results);
    }
  }

  /**
   * Append a history entry. Await for durability, but keep failures non-fatal.
   */
  private async appendHistory(matcherId: string, result: ScriptActionResult): Promise<void> {
    try {
      await appendAutomationHistoryEntry(
        this.options.workspaceRootPath,
        createScriptHistoryEntry({ matcherId, result }),
      );
    } catch (e) {
      log.debug(`[ScriptHandler] Failed to write history: ${e}`);
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.bus && this.boundHandler) {
      this.bus.offAny(this.boundHandler);
      this.boundHandler = null;
    }
    this.bus = null;
    this.inFlight.clear();
    log.debug(`[ScriptHandler] Disposed`);
  }
}
