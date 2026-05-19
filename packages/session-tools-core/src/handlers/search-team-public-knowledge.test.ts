/**
 * Tests for search_team_public_knowledge handler.
 *
 * Verifies search across team public knowledge entries with
 * kind, tag, scope, limit, and cursor support.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleSearchTeamPublicKnowledge } from './search-team-public-knowledge.ts';

function createCtx(workspacePath: string) {
  return {
    sessionId: 'test-session',
    workspacePath,
    get sourcesPath() { return join(workspacePath, 'sources'); },
    get skillsPath() { return join(workspacePath, 'skills'); },
    plansFolderPath: join(workspacePath, 'plans'),
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: (path: string) => existsSync(path),
      readFile: (path: string) => readFileSync(path, 'utf-8'),
      readFileBuffer: (path: string) => readFileSync(path),
      writeFile: (path: string, content: string) => writeFileSync(path, content),
      isDirectory: (path: string) => existsSync(path) && statSync(path).isDirectory(),
      readdir: (path: string) => readdirSync(path),
      stat: (path: string) => {
        const s = statSync(path);
        return { size: s.size, isDirectory: () => s.isDirectory() };
      },
    },
    loadSourceConfig: () => null,
    validators: undefined,
  } as const;
}

function writeCache(workspacePath: string, cache: unknown): void {
  const dir = join(workspacePath, 'team-public-knowledge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cache.json'), JSON.stringify(cache, null, 2));
}

describe('search_team_public_knowledge', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'search-knowledge-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects empty query with error', async () => {
    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: '' } as any);
    expect(result.isError).toBeTrue();
    expect(result.content[0]?.text).toContain('ERROR');
  });

  it('returns results matching query in content', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Rules',
          url: 'https://example.com/rules',
          priority: 1,
          content: `# Coding Rules

<!-- rule tags:typescript -->
Always use strict mode.

<!-- rule tags:testing -->
Always write tests for your code.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'strict' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.total).toBe(1);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.content).toContain('strict mode');
    expect(parsed.results[0]?.tags).toContain('typescript');
  });

  it('filters by kind', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Wiki',
          url: 'https://example.com/wiki',
          priority: 1,
          content: `# Topics

<!-- concept title:React -->
React is a UI library.

<!-- rule title:Testing -->
Always write tests.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    // Search for "ui" matching concept only
    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'ui', kind: 'concept' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.results.length).toBeGreaterThanOrEqual(1);
    for (const r of parsed.results) {
      expect(r.kind).toBe('concept');
    }
  });

  it('filters by tag', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Wiki',
          url: 'https://example.com/wiki',
          priority: 1,
          content: `# Topics

<!-- rule tags:security,authentication id:auth-rule -->
Always authenticate.

<!-- rule tags:performance -->
Optimize queries.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'authenticate', tag: 'security' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.results.length).toBeGreaterThanOrEqual(1);
    for (const r of parsed.results) {
      expect(r.tags).toContain('security');
    }
  });

  it('filters by scope', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Wiki',
          url: 'https://example.com/wiki',
          priority: 1,
          content: `# Topics

<!-- rule scope:backend -->
Backend rules.

<!-- rule scope:frontend -->
Frontend rules.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'rules', scope: 'backend' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.results.length).toBeGreaterThanOrEqual(1);
    for (const r of parsed.results) {
      expect(r.scope).toBe('backend');
    }
  });

  it('respects limit parameter', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Wiki',
          url: 'https://example.com/wiki',
          priority: 1,
          content: `# Items

<!-- concept -->
Item one.

<!-- concept -->
Item two.

<!-- concept -->
Item three.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'Item', limit: 2 });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.results.length).toBeLessThanOrEqual(2);
    expect(parsed.total).toBeGreaterThanOrEqual(3);
  });

  it('supports cursor-based pagination', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Wiki',
          url: 'https://example.com/wiki',
          priority: 1,
          content: `# Items

<!-- concept -->
Item one.

<!-- concept -->
Item two.

<!-- concept -->
Item three.

<!-- concept -->
Item four.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    // First page
    const page1 = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'Item', limit: 2 });
    const p1 = JSON.parse(page1.content[0]?.text ?? '');
    expect(p1.results).toHaveLength(2);
    expect(p1.nextCursor).toBeDefined();

    // Second page
    const page2 = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'Item', limit: 2, cursor: p1.nextCursor });
    const p2 = JSON.parse(page2.content[0]?.text ?? '');
    expect(p2.results).toHaveLength(2);

    // Verify different results
    expect(p1.results[0]?.content).not.toBe(p2.results[0]?.content);
  });

  it('returns empty results for empty cache', async () => {
    writeCache(tempDir, { entries: {} });

    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'anything' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.results).toHaveLength(0);
    expect(parsed.total).toBe(0);
  });

  it('includes metadata in results', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Wiki',
          url: 'https://example.com/wiki',
          priority: 1,
          content: `# Topics

<!-- rule id:auth-rule tags:security,authentication scope:backend defaults:{retryCount:3} validUntil:2025-12-31 -->
Always authenticate before accessing the API.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'authenticate' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.results).toHaveLength(1);
    const r = parsed.results[0];
    expect(r.tags).toContain('security');
    expect(r.scope).toBe('backend');
    expect(r.defaults).toBeDefined();
    expect(r.defaults.retryCount).toBe('3');
    expect(r.validUntil).toBe('2025-12-31');
    expect(r.source).toBe('Wiki');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.relevance).toBeDefined();
    expect(r.matchReason).toBeDefined();
  });

  it('flags stale entries in results', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Old Wiki',
          url: 'https://example.com/old',
          priority: 1,
          content: `# Topics

<!-- rule -->
Some rule from stale document.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: true,
          staleAt: 2000,
          lastError: 'HTTP 500',
        },
      },
    });

    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'rule' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.stale).toBeTrue();
  });

  it('surfaces expired validUntil entries with stale metadata', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Old Rule',
          url: 'https://example.com/old',
          priority: 1,
          content: `# Topics

<!-- rule validUntil:2025-01-01 -->
Use the old deployment process.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: Date.now(),
          updatedAt: Date.now(),
          stale: false,
        },
      },
    });

    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'deployment' });
    const parsed = JSON.parse(result.content[0]?.text ?? '');

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.stale).toBeTrue();
    expect(parsed.results[0]?.staleReason).toBe('valid_until_expired');
  });

  it('surfaces conflicting entries with conflict metadata', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Doc One',
          url: 'https://example.com/one',
          priority: 5,
          content: `# Glossary

<!-- alias term:runtime canonical:node -->
Runtime means Node.js.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: Date.now(),
          updatedAt: 3000,
          stale: false,
        },
        doc2: {
          id: 'doc2',
          title: 'Doc Two',
          url: 'https://example.com/two',
          priority: 5,
          content: `# Glossary

<!-- alias term:runtime canonical:bun -->
Runtime means Bun.`,
          contentHash: 'def',
          version: 1,
          fetchedAt: Date.now(),
          updatedAt: 3000,
          stale: false,
        },
      },
    });

    const result = await handleSearchTeamPublicKnowledge(createCtx(tempDir), { query: 'runtime' });
    const parsed = JSON.parse(result.content[0]?.text ?? '');

    expect(parsed.results).toHaveLength(2);
    expect(parsed.results.every((r: any) => r.conflict)).toBeTrue();
    expect(parsed.results[0]?.conflictReason).toBe('contradictory_explicit_entries');
  });
});
