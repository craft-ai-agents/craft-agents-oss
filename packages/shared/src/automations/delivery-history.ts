/**
 * Webhook delivery history — compact append-only log for inbound trigger requests.
 *
 * This is intentionally separate from automations-history.jsonl, which records
 * action execution. Delivery history records the HTTP ingress decision without
 * persisting request bodies or sensitive headers.
 */

import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../utils/debug.ts';

const log = createLogger('delivery-history');

export const WEBHOOK_DELIVERY_HISTORY_FILE = 'webhook-deliveries.jsonl';
export const WEBHOOK_DELIVERY_HISTORY_MAX_ENTRIES = 1000;

export type WebhookDeliveryOutcome =
  | 'accepted'
  | 'rate_limited'
  | 'event_bus_rate_limited'
  | 'automation_system_unavailable'
  | 'invalid_signature'
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'stale_timestamp'
  | 'unauthenticated_denied'
  | 'misconfigured_secret'
  | 'body_too_large'
  | 'body_read_timeout'
  | 'bad_request'
  | 'method_not_allowed'
  | 'trigger_not_found'
  | 'internal_error';

export interface WebhookDeliveryRecord {
  timestamp: number;
  workspaceId: string;
  slug?: string;
  matcherId?: string;
  method: string;
  outcome: WebhookDeliveryOutcome;
  httpStatus: number;
  remoteIp?: string;
  reason?: string;
}

const mutexes = new Map<string, Promise<void>>();
const appendCounters = new Map<string, number>();

function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexes.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  mutexes.set(key, next.then(() => {}, () => {}));
  return next;
}

export async function appendWebhookDeliveryRecord(
  workspaceRootPath: string,
  record: WebhookDeliveryRecord,
): Promise<void> {
  const historyPath = join(workspaceRootPath, WEBHOOK_DELIVERY_HISTORY_FILE);

  await withMutex(workspaceRootPath, async () => {
    await appendFile(historyPath, JSON.stringify(sanitizeRecord(record)) + '\n', 'utf-8');

    const count = (appendCounters.get(workspaceRootPath) ?? 0) + 1;
    appendCounters.set(workspaceRootPath, count);

    if (count >= WEBHOOK_DELIVERY_HISTORY_MAX_ENTRIES) {
      appendCounters.set(workspaceRootPath, 0);
      await runCompaction(historyPath, WEBHOOK_DELIVERY_HISTORY_MAX_ENTRIES);
    }
  });
}

export async function compactWebhookDeliveryHistory(
  workspaceRootPath: string,
  maxEntries: number = WEBHOOK_DELIVERY_HISTORY_MAX_ENTRIES,
): Promise<void> {
  const historyPath = join(workspaceRootPath, WEBHOOK_DELIVERY_HISTORY_FILE);
  await withMutex(workspaceRootPath, async () => {
    await runCompaction(historyPath, maxEntries);
  });
}

export function compactWebhookDeliveryHistorySync(
  workspaceRootPath: string,
  maxEntries: number = WEBHOOK_DELIVERY_HISTORY_MAX_ENTRIES,
): void {
  const historyPath = join(workspaceRootPath, WEBHOOK_DELIVERY_HISTORY_FILE);
  if (!existsSync(historyPath)) return;

  let content: string;
  try { content = readFileSync(historyPath, 'utf-8'); } catch { return; }

  const result = compactContent(content, maxEntries);
  if (!result) return;

  writeFileSync(historyPath, result, 'utf-8');
  log.debug('[DeliveryHistory] Startup compaction complete');
}

async function runCompaction(historyPath: string, maxEntries: number): Promise<void> {
  let content: string;
  try {
    if (!existsSync(historyPath)) return;
    content = await readFile(historyPath, 'utf-8');
  } catch {
    return;
  }

  const result = compactContent(content, maxEntries);
  if (!result) return;

  await writeFile(historyPath, result, 'utf-8');
  log.debug('[DeliveryHistory] Compacted delivery history');
}

function compactContent(content: string, maxEntries: number): string | null {
  const lines = content.trim().split('\n').filter(Boolean);
  if (lines.length <= maxEntries) return null;

  const validLines: string[] = [];
  for (const line of lines) {
    try {
      JSON.parse(line);
      validLines.push(line);
    } catch {
      // Drop malformed lines during compaction.
    }
  }

  const kept = validLines.slice(-maxEntries);
  if (kept.length === lines.length) return null;
  return kept.join('\n') + '\n';
}

function sanitizeRecord(record: WebhookDeliveryRecord): WebhookDeliveryRecord {
  return {
    timestamp: record.timestamp,
    workspaceId: record.workspaceId,
    slug: record.slug ? trim(record.slug, 200) : undefined,
    matcherId: record.matcherId ? trim(record.matcherId, 200) : undefined,
    method: trim(record.method, 20),
    outcome: record.outcome,
    httpStatus: record.httpStatus,
    remoteIp: record.remoteIp ? trim(record.remoteIp, 200) : undefined,
    reason: record.reason ? trim(record.reason, 500) : undefined,
  };
}

function trim(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
