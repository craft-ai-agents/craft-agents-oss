import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendWebhookDeliveryRecord,
  compactWebhookDeliveryHistory,
  WEBHOOK_DELIVERY_HISTORY_FILE,
  type WebhookDeliveryRecord,
} from './delivery-history.ts';

function readRecords(dir: string): WebhookDeliveryRecord[] {
  try {
    return readFileSync(join(dir, WEBHOOK_DELIVERY_HISTORY_FILE), 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function makeRecord(i: number): WebhookDeliveryRecord {
  return {
    timestamp: i,
    workspaceId: 'ws1',
    slug: 'incoming',
    method: 'POST',
    outcome: 'accepted',
    httpStatus: 202,
    remoteIp: '127.0.0.1',
    reason: 'accepted',
  };
}

describe('delivery-history', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'delivery-history-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends webhook delivery records', async () => {
    await appendWebhookDeliveryRecord(tempDir, makeRecord(1));
    await appendWebhookDeliveryRecord(tempDir, {
      ...makeRecord(2),
      outcome: 'invalid_signature',
      httpStatus: 401,
      reason: 'invalid_signature',
    });

    const records = readRecords(tempDir);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.outcome)).toEqual(['accepted', 'invalid_signature']);
  });

  it('compacts to the latest records and drops malformed lines', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 5; i++) lines.push(JSON.stringify(makeRecord(i)));
    lines.splice(2, 0, '{not json');
    writeFileSync(join(tempDir, WEBHOOK_DELIVERY_HISTORY_FILE), lines.join('\n') + '\n');

    await compactWebhookDeliveryHistory(tempDir, 3);

    const records = readRecords(tempDir);
    expect(records).toHaveLength(3);
    expect(records.map((record) => record.timestamp)).toEqual([2, 3, 4]);
  });
});
