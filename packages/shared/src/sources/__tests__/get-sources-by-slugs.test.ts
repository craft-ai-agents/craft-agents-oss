/**
 * Tests for getSourcesBySlugs slug validation.
 *
 * Regression test for issue #1105: a `null` entry in `enabledSourceSlugs`
 * (workspace defaults or a session header) used to be forwarded straight into
 * `path.join`, so every `sendMessage` failed with
 * `The "path" argument must be of type string. Received null`.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getSourcesBySlugs } from '../storage.ts';

const tempRoots: string[] = [];

function createWorkspaceWithSource(slug: string): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-sources-'));
  tempRoots.push(root);

  const sourceDir = join(root, 'sources', slug);
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    join(sourceDir, 'config.json'),
    JSON.stringify({
      id: `${slug}-id`,
      name: slug,
      slug,
      enabled: true,
      provider: 'test',
      type: 'mcp',
      mcp: { url: 'https://example.invalid/mcp' },
    })
  );

  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('getSourcesBySlugs', () => {
  it('loads a valid source slug', () => {
    const root = createWorkspaceWithSource('linear');

    const sources = getSourcesBySlugs(root, ['linear']);

    expect(sources).toHaveLength(1);
    expect(sources[0]!.config.slug).toBe('linear');
    expect(sources[0]!.folderPath).toBe(join(root, 'sources', 'linear'));
  });

  it('skips non-string and empty entries instead of throwing', () => {
    const root = createWorkspaceWithSource('linear');

    // `null` reaches the slug list from hand-editable workspace config and session headers.
    const slugs = ['linear', null, '', '   ', undefined, 42, {}] as unknown as string[];
    const sources = getSourcesBySlugs(root, slugs);

    expect(sources).toHaveLength(1);
    expect(sources[0]!.config.slug).toBe('linear');
  });

  it('returns no sources when the only entries are invalid', () => {
    const root = createWorkspaceWithSource('linear');

    expect(getSourcesBySlugs(root, [null as unknown as string])).toEqual([]);
  });

  it('treats a missing slug list as empty', () => {
    const root = createWorkspaceWithSource('linear');

    expect(getSourcesBySlugs(root, undefined)).toEqual([]);
    expect(getSourcesBySlugs(root, null)).toEqual([]);
  });
});
