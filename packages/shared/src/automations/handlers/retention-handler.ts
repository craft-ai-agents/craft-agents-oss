/**
 * RetentionHandler - Automatic session archiving and cleanup
 *
 * Subscribes to SchedulerTick events and, once per hour, runs retention
 * logic based on workspace config:
 * - Archives idle sessions (no activity for N days)
 * - Deletes archived sessions past retention window (M days)
 *
 * This is a system-level handler (not driven by automations.json).
 * It reads retention config live from the workspace, so changes take
 * effect without restarting the app.
 */

import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload } from '../event-bus.ts';
import type { AutomationHandler, RetentionHandlerOptions } from './types.ts';
import type { AutomationEvent } from '../types.ts';
import { archiveIdleSessions, deleteOldArchivedSessions } from '../../sessions/storage.ts';

const log = createLogger('retention-handler');

// ============================================================================
// RetentionHandler Implementation
// ============================================================================

export class RetentionHandler implements AutomationHandler {
  private readonly options: RetentionHandlerOptions;
  private bus: EventBus | null = null;
  private boundHandler: ((event: AutomationEvent, payload: BaseEventPayload) => Promise<void>) | null = null;
  private lastRunHour = -1;

  constructor(options: RetentionHandlerOptions) {
    this.options = options;
  }

  /**
   * Subscribe to events on the bus.
   */
  subscribe(bus: EventBus): void {
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
    log.debug(`[RetentionHandler] Subscribed to event bus`);
  }

  /**
   * Handle SchedulerTick events. Runs retention logic once per hour.
   */
  private async handleEvent(event: AutomationEvent, payload: BaseEventPayload): Promise<void> {
    if (event !== 'SchedulerTick') return;

    // Throttle to once per hour: only run when minute === 0
    const tickPayload = payload as BaseEventPayload & { localTime?: string };
    const localTime = tickPayload.localTime;
    if (!localTime) return;

    const parts = localTime.split(':');
    const hour = parseInt(parts[0] ?? '0', 10);
    const minute = parseInt(parts[1] ?? '0', 10);
    if (minute !== 0) return;

    // Deduplicate: don't re-run if we already ran this hour
    if (hour === this.lastRunHour) return;
    this.lastRunHour = hour;

    // Read live config (no restart needed when user changes settings)
    const config = this.options.getRetentionConfig();
    if (!config) return;

    const { autoArchiveAfterDays, autoDeleteArchivedAfterDays } = config;
    if (!autoArchiveAfterDays && !autoDeleteArchivedAfterDays) return;

    log.debug(`[RetentionHandler] Running retention check (archive=${autoArchiveAfterDays}d, delete=${autoDeleteArchivedAfterDays}d)`);

    try {
      let archived = 0;
      let deleted = 0;

      // Step 1: Archive idle sessions
      if (autoArchiveAfterDays && autoArchiveAfterDays > 0) {
        const excludeIds = this.options.getActiveSessionIds?.() ?? [];
        archived = await archiveIdleSessions(
          this.options.workspaceRootPath,
          autoArchiveAfterDays,
          { excludeSessionIds: excludeIds }
        );
      }

      // Step 2: Delete old archived sessions
      if (autoDeleteArchivedAfterDays && autoDeleteArchivedAfterDays > 0) {
        deleted = deleteOldArchivedSessions(
          this.options.workspaceRootPath,
          autoDeleteArchivedAfterDays
        );
      }

      if (archived > 0 || deleted > 0) {
        log.debug(`[RetentionHandler] Retention complete: ${archived} archived, ${deleted} deleted`);
      }

      this.options.onRetentionRun?.({ archived, deleted, timestamp: new Date().toISOString() });
    } catch (error) {
      log.debug(`[RetentionHandler] Error during retention: ${error}`);
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
    log.debug(`[RetentionHandler] Disposed`);
  }
}
