import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getSourcesBySlugs } from '../storage.ts';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('getSourcesBySlugs', () => {
  test('ignores malformed slugs without preventing valid sources from loading', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-source-slugs-'));
    tempRoots.push(workspaceRoot);

    const configPath = join(workspaceRoot, 'sources', 'valid-source', 'config.json');
    mkdirSync(join(workspaceRoot, 'sources', 'valid-source'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      id: 'source-id',
      slug: 'valid-source',
      name: 'Valid source',
      type: 'api',
      enabled: true,
      provider: 'custom',
      api: { baseUrl: 'https://example.com/', authType: 'none' },
    }));

    const slugs = ['valid-source', null, ''] as unknown as string[];

    expect(getSourcesBySlugs(workspaceRoot, slugs).map((source) => source.config.slug))
      .toEqual(['valid-source']);
  });
});
