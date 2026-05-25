import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  enqueueMemoryReviewItem,
  getMemoryReviewQueueFile,
  listMemoryReviewItems,
  resolveMemoryReviewItem,
} from './review-queue.ts';
import type { MemoryStorageOptions } from './types.ts';

let root: string;
let options: MemoryStorageOptions;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-memory-review-test-'));
  options = { globalAgentsDir: root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('memory review queue', () => {
  test('enqueue stores a pending sidecar proposal locally', () => {
    const item = enqueueMemoryReviewItem({
      action: 'save',
      scope: 'agent',
      agentSlug: 'researcher',
      name: 'primary sources',
      type: 'feedback',
      body: 'Prefer primary sources.',
      confidence: 0.92,
      evidence: 'User corrected the research style.',
      sourceRunId: 'run_123',
    }, options);

    expect(item.status).toBe('pending');
    expect(item.source).toBe('sidecar');
    expect(item.agentSlug).toBe('researcher');
    expect(existsSync(getMemoryReviewQueueFile(options))).toBe(true);
    expect(listMemoryReviewItems(options)).toEqual([item]);
  });

  test('resolve updates item status and decision metadata', () => {
    const item = enqueueMemoryReviewItem({
      action: 'forget',
      scope: 'user',
      name: 'old preference',
      confidence: 1,
      source: 'user',
    }, options);

    const resolved = resolveMemoryReviewItem({
      id: item.id,
      status: 'rejected',
      decisionReason: 'Keep it for now.',
    }, options);

    expect(resolved?.status).toBe('rejected');
    expect(resolved?.decisionReason).toBe('Keep it for now.');
    expect(resolved?.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(listMemoryReviewItems(options)[0]!.status).toBe('rejected');
  });

  test('rejects malformed save proposals', () => {
    expect(() => enqueueMemoryReviewItem({
      action: 'save',
      scope: 'agent',
      agentSlug: 'researcher',
      name: 'missing body',
      type: 'feedback',
      confidence: 0.8,
    }, options)).toThrow(/body is required/i);
  });

  test('loads an empty queue from missing or malformed files', () => {
    expect(listMemoryReviewItems(options)).toEqual([]);
    writeFileSync(getMemoryReviewQueueFile(options), 'not json', 'utf-8');
    expect(listMemoryReviewItems(options)).toEqual([]);
  });
});
