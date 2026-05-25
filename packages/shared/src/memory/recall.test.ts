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
});
