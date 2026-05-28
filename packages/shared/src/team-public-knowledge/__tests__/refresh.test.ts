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
        manifestPath: '/api/team/knowledge',
        documents,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, null, 2),
    'utf-8',
  );
}

describe('team public knowledge refresh', () => {
  it('syncs documents from the remote manifest before refreshing content', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-manifest-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot, []);

    const requests: string[] = [];
    const summary = await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      baseUrl: 'https://knowledge.example.test',
      fetchFn: async (url, init) => {
        requests.push(String(url));
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer sso-id-token');
        if (String(url).endsWith('/api/team/knowledge')) {
          return Response.json({
            documents: [
              { id: 'git', title: 'Git Workflow', url: '/api/team/knowledge/git', priority: 2 },
              { id: 'standards', title: 'Coding Standards', url: '/api/team/knowledge/standards', priority: 1 },
            ],
          });
        }
        return new Response(`# ${String(url).split('/').pop()}`, {
          headers: { 'content-type': 'text/markdown' },
        });
      },
      getIdToken: async () => 'sso-id-token',
    });

    expect(summary).toMatchObject({
      added: 2,
      updated: 0,
      removed: 0,
      stale: 0,
      conflicts: 0,
      manifestUpdated: true,
    });
    expect(requests).toEqual([
      'https://knowledge.example.test/api/team/knowledge',
      'https://knowledge.example.test/api/team/knowledge/standards',
      'https://knowledge.example.test/api/team/knowledge/git',
    ]);

    const config = JSON.parse(readFileSync(join(workspaceRoot, 'config.json'), 'utf-8'));
    expect(config.teamPublicKnowledge.documents.map((doc: { id: string }) => doc.id)).toEqual(['standards', 'git']);
  });

  it('keeps the previous document list when manifest fetch fails', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-manifest-fail-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot);

    const summary = await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      baseUrl: 'https://knowledge.example.test',
      fetchFn: async (url) => {
        if (String(url).endsWith('/api/team/knowledge')) {
          return new Response(null, { status: 503 });
        }
        return new Response('# Fallback Slang', {
          headers: { 'content-type': 'text/plain' },
        });
      },
    });

    expect(summary.manifestError).toContain('HTTP 503');
    expect(summary.added).toBe(1);
    expect(getTeamPublicKnowledgeTriggerResults(workspaceRoot, { now: 1_000 }).map(result => result.id)).toEqual(['slang']);
  });

  it('does not stale existing cache entries when the base URL is not configured', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-missing-base-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot, [
      { id: 'slang', title: 'Team Slang', url: '/api/team/knowledge/slang', priority: 1 },
    ]);

    await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      baseUrl: 'https://knowledge.example.test',
      fetchFn: async (url) => {
        if (String(url).endsWith('/api/team/knowledge')) {
          return Response.json({
            documents: [
              { id: 'slang', title: 'Team Slang', url: '/api/team/knowledge/slang', priority: 1 },
            ],
          });
        }
        return new Response('# Slang', { headers: { 'content-type': 'text/markdown' } });
      },
    });

    const summary = await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 2_000,
      baseUrl: null,
      fetchFn: async () => {
        throw new Error('should not fetch');
      },
    });

    expect(summary.manifestError).toContain('MDP_TEAM_PUBLIC_KNOWLEDGE_BASE_URL');
    expect(summary.stale).toBe(0);
    expect(getTeamPublicKnowledgeTriggerResults(workspaceRoot, { now: 2_000 }).map(result => result.id)).toEqual(['slang']);
  });

  it('dedupes manifest documents by id using the lowest priority winner', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-manifest-dupes-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot, []);

    const summary = await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      baseUrl: 'https://knowledge.example.test',
      fetchFn: async (url) => {
        if (String(url).endsWith('/api/team/knowledge')) {
          return Response.json({
            documents: [
              { id: 'git', title: 'Old Git', url: '/old', priority: 10 },
              { id: 'git', title: 'New Git', url: '/new', priority: 2 },
            ],
          });
        }
        return new Response('# Git', { headers: { 'content-type': 'text/markdown' } });
      },
    });

    expect(summary.conflicts).toBe(1);
    const config = JSON.parse(readFileSync(join(workspaceRoot, 'config.json'), 'utf-8'));
    expect(config.teamPublicKnowledge.documents).toEqual([
      { id: 'git', title: 'New Git', url: '/new', priority: 2 },
    ]);
  });

  it('rejects manifest documents that use absolute URLs', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-manifest-absolute-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot, []);

    const summary = await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      baseUrl: 'https://knowledge.example.test',
      fetchFn: async () => Response.json({
        documents: [
          { id: 'bad', title: 'Bad', url: 'https://example.com/bad', priority: 1 },
        ],
      }),
    });

    expect(summary.manifestError).toContain('must use a path URL');
    expect(summary.added).toBe(0);
  });

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

  it('adds the SSO idToken bearer authorization header when fetching configured Markdown', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-idtoken-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot);

    const requestHeaders: Headers[] = [];
    await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      baseUrl: 'https://knowledge.example.test',
      getIdToken: async () => 'sso-id-token',
      fetchFn: async (_url, init) => {
        requestHeaders.push(new Headers(init?.headers));
        return new Response('# Slang', { status: 200 });
      },
    });

    expect(requestHeaders[0]?.get('Authorization')).toBe('Bearer sso-id-token');
  });

  it('rejects non-text document content types', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'team-knowledge-content-type-'));
    tempDirs.push(workspaceRoot);
    writeWorkspaceConfig(workspaceRoot, [
      { id: 'binary', title: 'Binary', url: '/api/team/knowledge/binary', priority: 1 },
    ]);

    const summary = await refreshTeamPublicKnowledge(workspaceRoot, {
      now: 1_000,
      baseUrl: 'https://knowledge.example.test',
      fetchFn: async (url) => {
        if (String(url).endsWith('/api/team/knowledge')) {
          throw new Error('manifest unavailable');
        }
        return new Response('nope', { headers: { 'content-type': 'application/octet-stream' } });
      },
    });

    expect(summary.stale).toBe(1);
    expect(summary.manifestError).toBe('manifest unavailable');
    expect(getTeamPublicKnowledgeTriggerResults(workspaceRoot, { now: 1_000 })).toEqual([]);
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
