/**
 * Tests for resolve_team_public_term handler.
 *
 * Verifies term resolution against cached team public knowledge entries.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleResolveTeamPublicTerm } from './resolve-team-public-term.ts';

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

describe('resolve_team_public_term', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'resolve-term-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns found status when term matches exactly', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Engineering Conventions',
          url: 'https://example.com/conv',
          priority: 1,
          content: `# Conventions

<!-- alias id:py-casing term:py-casing canonical:snake_case -->
Python uses snake_case for variables.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    const result = await handleResolveTeamPublicTerm(createCtx(tempDir), { term: 'py-casing' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.status).toBe('found');
    expect(parsed.match.term).toBe('py-casing');
    expect(parsed.match.canonical).toBe('snake_case');
    expect(parsed.match.kind).toBe('alias');
    expect(parsed.source).toBe('Engineering Conventions');
    expect(parsed.confidence).toBeGreaterThan(0);
  });

  it('returns not_found with suggestions when no match', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Engineering Conventions',
          url: 'https://example.com/conv',
          priority: 1,
          content: `# Conventions

<!-- alias term:snake_case canonical:snake_case -->
Use snake_case.

<!-- alias term:camelCase canonical:camelCase -->
Use camelCase for JS.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    const result = await handleResolveTeamPublicTerm(createCtx(tempDir), { term: 'kebab-case' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.status).toBe('not_found');
    expect(parsed.suggestions).toBeDefined();
    expect(Array.isArray(parsed.suggestions)).toBeTrue();
  });

  it('returns ambiguous when multiple entries match', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Conventions',
          url: 'https://example.com/conv',
          priority: 1,
          content: `# Naming

<!-- concept term:foo -->
First definition of foo.

<!-- rule term:foo -->
Second definition of foo.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    const result = await handleResolveTeamPublicTerm(createCtx(tempDir), { term: 'foo' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.status).toBe('ambiguous');
    expect(parsed.matches).toBeDefined();
    expect(parsed.matches.length).toBe(2);
  });

  it('returns conflict when cache has stale entries', async () => {
    writeCache(tempDir, {
      entries: {
        doc1: {
          id: 'doc1',
          title: 'Conventions',
          url: 'https://example.com/conv',
          priority: 1,
          content: `# Naming

<!-- convention term:foo -->
Use foo.`,
          contentHash: 'abc',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: true,
          staleAt: 2000,
          lastError: 'HTTP 500',
        },
        doc2: {
          id: 'doc2',
          title: 'Other Conventions',
          url: 'https://example.com/other',
          priority: 2,
          content: `# Naming

<!-- convention term:bar -->
Use bar.`,
          contentHash: 'def',
          version: 1,
          fetchedAt: 1000,
          updatedAt: 1000,
          stale: false,
        },
      },
    });

    const result = await handleResolveTeamPublicTerm(createCtx(tempDir), { term: 'foo' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.status).toBe('conflict');
    expect(parsed.conflicts).toBeDefined();
    expect(parsed.conflicts.length).toBeGreaterThan(0);
    expect(parsed.conflicts[0]?.id).toBe('doc1');
  });

  it('returns not_found for empty cache', async () => {
    writeCache(tempDir, { entries: {} });

    const result = await handleResolveTeamPublicTerm(createCtx(tempDir), { term: 'anything' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.status).toBe('not_found');
  });

  it('returns not_found when cache file does not exist', async () => {
    const result = await handleResolveTeamPublicTerm(createCtx(tempDir), { term: 'anything' });
    const text = result.content[0]?.text ?? '';
    expect(result.isError).toBeFalsy();

    const parsed = JSON.parse(text);
    expect(parsed.status).toBe('not_found');
  });
});
