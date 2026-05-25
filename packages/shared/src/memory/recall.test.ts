import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveMemoryEntry } from './storage.ts';
import { rankMemoryEntries, recallMemoryEntries } from './recall.ts';
import type { MemoryStorageOptions } from './types.ts';

let root: string;
let options: MemoryStorageOptions;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-memory-recall-test-'));
  options = { globalAgentsDir: root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('rankMemoryEntries', () => {
  test('prioritizes name matches over body-only matches', () => {
    const results = rankMemoryEntries('short answers', [
      {
        scope: 'user',
        entry: {
          name: 'prefers short answers',
          type: 'feedback',
          created: '2026-05-01',
          body: 'Use direct language.',
        },
      },
      {
        scope: 'user',
        entry: {
          name: 'formatting',
          type: 'feedback',
          created: '2026-05-01',
          body: 'Short answers are useful when the user asks for speed.',
        },
      },
    ]);

    expect(results.map((result) => result.entry.name)).toEqual([
      'prefers short answers',
      'formatting',
    ]);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  test('boosts exact phrase matches above scattered token matches', () => {
    const results = rankMemoryEntries('browser follow up', [
      {
        scope: 'user',
        entry: {
          name: 'research method',
          type: 'feedback',
          created: '2026-05-01',
          body: 'Prefer browser follow up before synthesis.',
        },
      },
      {
        scope: 'user',
        entry: {
          name: 'browser notes',
          type: 'feedback',
          created: '2026-05-01',
          body: 'Use browser searches. Follow leads. Summarize up front.',
        },
      },
    ]);

    expect(results.map((result) => result.entry.name)).toEqual([
      'research method',
      'browser notes',
    ]);
  });

  test('gives recent memories a small tie-break boost', () => {
    const results = rankMemoryEntries('launch receipt', [
      {
        scope: 'user',
        entry: {
          name: 'old receipt note',
          type: 'reference',
          created: '2024-01-01',
          body: 'Launch receipt should list injected context.',
        },
      },
      {
        scope: 'user',
        entry: {
          name: 'new receipt note',
          type: 'reference',
          created: new Date().toISOString().slice(0, 10),
          body: 'Launch receipt should list injected context.',
        },
      },
    ]);

    expect(results[0]!.entry.name).toBe('new receipt note');
  });

  test('does not return unrelated recent memories', () => {
    const results = rankMemoryEntries('browser follow up', [
      {
        scope: 'user',
        entry: {
          name: 'new unrelated note',
          type: 'reference',
          created: new Date().toISOString().slice(0, 10),
          body: 'Launch receipts include injected memory.',
        },
      },
    ]);

    expect(results).toEqual([]);
  });
});

describe('recallMemoryEntries', () => {
  test('recalls across USER.md and selected agent memory', async () => {
    await saveMemoryEntry({
      scope: 'user',
      name: 'prefers concise replies',
      type: 'feedback',
      body: 'User prefers concise, punchy answers.',
    }, options);
    await saveMemoryEntry({
      scope: 'agent',
      agentSlug: 'researcher',
      name: 'browser loop',
      type: 'feedback',
      body: 'Deep research should use follow-up browser searches before synthesis.',
    }, options);

    const results = recallMemoryEntries({
      query: 'research browser follow up',
      agentSlug: 'researcher',
    }, options);

    expect(results.map((result) => result.entry.name)).toContain('browser loop');
    expect(results.find((result) => result.entry.name === 'browser loop')?.scope).toBe('agent');
  });

  test('requires agentSlug when agent scope is requested', () => {
    expect(() => recallMemoryEntries({
      query: 'browser',
      scopes: ['agent'],
    }, options)).toThrow(/agentSlug is required/);
  });

  test('does not recall expired memory entries', async () => {
    await saveMemoryEntry({
      scope: 'user',
      name: 'expired launch note',
      type: 'reference',
      body: 'Launch receipts used to omit memory.',
      expires: '2000-01-01',
    }, options);
    await saveMemoryEntry({
      scope: 'user',
      name: 'active launch note',
      type: 'reference',
      body: 'Launch receipts include memory.',
    }, options);

    const results = recallMemoryEntries({ query: 'launch receipts' }, options);

    expect(results.map((result) => result.entry.name)).toEqual(['active launch note']);
  });
});
