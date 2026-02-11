/**
 * Event Log Handler
 *
 * Logs hook events to a JSONL file for debugging.
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { debug } from '../../utils/debug.ts';
import { CONFIG_DIR } from '../../config/paths.ts';
import type { HookAction, HookEventType, BaseEventPayload, HookHandler, EventLogHookAction } from '../types.ts';

const DEFAULT_LOG_FILE = join(CONFIG_DIR, 'hooks-log.jsonl');
const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export class EventLogHandler implements HookHandler {
  readonly type = 'event-log' as const;

  async handle(
    action: HookAction,
    event: HookEventType,
    payload: BaseEventPayload,
  ): Promise<void> {
    if (action.type !== 'event-log') return;

    const logAction = action as EventLogHookAction;
    const logFile = logAction.logFile || DEFAULT_LOG_FILE;

    try {
      // Ensure directory exists
      const dir = dirname(logFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const entry = {
        timestamp: new Date(payload.timestamp).toISOString(),
        event,
        workspaceId: payload.workspaceId,
        sessionId: payload.sessionId,
        payload: stripLargeFields(payload),
      };

      appendFileSync(logFile, JSON.stringify(entry) + '\n');
    } catch (error) {
      debug(`[EventLogHandler] Failed to write log: ${error instanceof Error ? error.message : error}`);
    }
  }
}

/**
 * Remove large fields from payload to keep log entries compact.
 */
function stripLargeFields(payload: BaseEventPayload): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' && value.length > 500) {
      cleaned[key] = value.substring(0, 500) + '...[truncated]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Skip nested objects (like tool input) to keep logs compact
      cleaned[key] = '[object]';
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}
