import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  getTeamPublicKnowledgePrefetchResults,
  getTeamPublicKnowledgeRefreshSummary,
  getTeamPublicKnowledgeTriggerResults,
  refreshTeamPublicKnowledge,
} from '../index.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeWorkspaceConfig(workspaceRoot: string, documents = [
  {
    id: 'slang',
    title: 'Team Slang',
    url: 'https://example.com/slang.md',
    priority: 10,
  },
]): void {
  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify({
      id: 'ws_team',
      name: 'Team Workspace',
      slug: 'team-workspace',
      teamPublicKnowledge: {
        enabled: true,
        documents,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, null, 2),
    'utf-8',
  );
}

describe('team public knowledge refresh', () => {
  it('fetches configured Markdown, stores hash metadata, and exposes fresh trigger results', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-refresh-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot);

    const content = '# Slang\n\nShip it means deploy after review.';
    const summary = await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      fetchMarkdown: async () => content,
    });

    expect(summary).toMatchObject({
      added: 1,
      updated: 0,
      removed: 0,
      stale: 0,
      conflicts: 0,
    });

    const cache = JSON.parse(readFileSync(join(workspaceRoot, 'team-public-knowledge', 'cache.json'), 'utf-8'));
    expect(cache.entries.slang.contentHash).toBe(createHash('sha256').update(content, 'utf8').digest('hex'));
    expect(cache.entries.slang.version).toBe(1);

    const results = getTeamPublicKnowledgeTriggerResults(workspaceRoot, { now: 1_000 });
    expect(results.map(result => ({
      id: result.id,
      title: result.title,
      priority: result.priority,
      content: result.content,
    }))).toEqual([
      {
        id: 'slang',
        title: 'Team Slang',
        priority: 10,
        content,
      },
    ]);
  });

  it('marks prior documents stale on refresh failure and excludes them from trigger results', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-stale-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot);

    await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      fetchMarkdown: async () => '# Slang\n\nInitial content.',
    });

    const summary = await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 2_000,
      fetchMarkdown: async () => {
        throw new Error('network down');
      },
    });

    expect(summary).toMatchObject({
      added: 0,
      updated: 0,
      removed: 0,
      stale: 1,
      conflicts: 0,
    });

    const cache = JSON.parse(readFileSync(join(workspaceRoot, 'team-public-knowledge', 'cache.json'), 'utf-8'));
    expect(cache.entries.slang.stale).toBe(true);
    expect(cache.entries.slang.staleAt).toBe(2_000);
    expect(cache.entries.slang.lastError).toBe('network down');
    expect(getTeamPublicKnowledgeTriggerResults(workspaceRoot, { now: 2_000 })).toEqual([]);
  });

  it('orders trigger and prefetch results by configured priority metadata', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-priority-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot, [
      { id: 'later', title: 'Later', url: 'https://example.com/later.md', priority: 30 },
      { id: 'first', title: 'First', url: 'https://example.com/first.md', priority: 5 },
    ]);

    await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      fetchMarkdown: async document => `# ${document.title}`,
    });

    expect(getTeamPublicKnowledgeTriggerResults(workspaceRoot, { now: 1_000 }).map(result => result.id)).toEqual([
      'first',
      'later',
    ]);
    expect(getTeamPublicKnowledgePrefetchResults(workspaceRoot, { now: 1_000 }).map(result => result.id)).toEqual([
      'first',
      'later',
    ]);
  });

  it('excludes public knowledge cache entries older than 24 hours', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-ttl-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot);

    await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      fetchMarkdown: async () => '# Slang',
    });

    const justFresh = 1_000 + 24 * 60 * 60 * 1_000;
    const expired = justFresh + 1;
    expect(getTeamPublicKnowledgeTriggerResults(workspaceRoot, { now: justFresh }).map(result => result.id)).toEqual(['slang']);
    expect(getTeamPublicKnowledgePrefetchResults(workspaceRoot, { now: expired })).toEqual([]);
  });

  it('records removed and conflict counts without adding summary entries to results', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-summary-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot, [
      { id: 'keep', title: 'Keep', url: 'https://example.com/keep.md', priority: 1 },
      { id: 'remove', title: 'Remove', url: 'https://example.com/remove.md', priority: 2 },
    ]);

    await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      fetchMarkdown: async document => `# ${document.title}`,
    });

    writeWorkspaceConfig(workspaceRoot, [
      { id: 'keep', title: 'Keep', url: 'https://example.com/keep.md', priority: 1 },
      { id: 'keep', title: 'Keep Duplicate', url: 'https://example.com/keep-2.md', priority: 2 },
    ]);

    const summary = await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 2_000,
      fetchMarkdown: async document => `# ${document.title}`,
    });

    expect(summary).toMatchObject({
      added: 0,
      updated: 0,
      removed: 1,
      stale: 0,
      conflicts: 1,
    });
    expect(getTeamPublicKnowledgeRefreshSummary(workspaceRoot)).toMatchObject(summary);
    expect(getTeamPublicKnowledgeTriggerResults(workspaceRoot, { now: 2_000 }).map(result => result.id)).toEqual(['keep']);
  });
});
