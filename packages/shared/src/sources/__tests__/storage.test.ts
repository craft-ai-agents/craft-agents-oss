/**
 * Tests for the global-tier source loaders and activation manifest.
 * Phase 1 of the Global Sources feature — read path only.
 */

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'fs';
import * as os from 'os';
import { tmpdir } from 'os';
import { join } from 'path';
import type { FolderSourceConfig } from '../types.ts';

// Redirect ~/ to a temp directory before importing storage.ts so that
// GLOBAL_AGENT_SOURCES_DIR resolves into the sandbox.
const sandboxHome = mkdtempSync(join(tmpdir(), 'global-sources-home-'));
mock.module('os', () => ({
  ...os,
  homedir: () => sandboxHome,
}));

const storage = await import('../storage.ts');
const {
  GLOBAL_AGENT_SOURCES_DIR,
  GLOBAL_WORKSPACE_ID,
  WORKSPACE_GLOBAL_SOURCES_MANIFEST,
  getGlobalSourcePath,
  getWorkspaceGlobalSourcesManifestPath,
  readGlobalSourcesManifest,
  isGlobalSourceActivatedInWorkspace,
  loadGlobalSource,
  loadGlobalSources,
  listGlobalSourceSlugs,
  loadAllSources,
} = storage;

afterAll(() => {
  try {
    rmSync(sandboxHome, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function makeWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'global-sources-ws-'));
  mkdirSync(join(ws, 'sources'), { recursive: true });
  return ws;
}

function writeManifest(ws: string, body: string | object): void {
  const path = getWorkspaceGlobalSourcesManifestPath(ws);
  mkdirSync(join(ws, 'sources'), { recursive: true });
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
}

function writeGlobalSource(slug: string, partial: Partial<FolderSourceConfig> = {}): void {
  const dir = getGlobalSourcePath(slug);
  mkdirSync(dir, { recursive: true });
  const config: FolderSourceConfig = {
    id: `${slug}_test`,
    name: partial.name ?? slug,
    slug,
    enabled: partial.enabled ?? true,
    provider: partial.provider ?? 'custom',
    type: partial.type ?? 'mcp',
    mcp: partial.mcp ?? { transport: 'http', url: 'https://example.test/mcp', authType: 'none' },
    ...partial,
  };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
}

function writeWorkspaceSource(ws: string, slug: string): void {
  const dir = join(ws, 'sources', slug);
  mkdirSync(dir, { recursive: true });
  const config: FolderSourceConfig = {
    id: `${slug}_ws`,
    name: slug,
    slug,
    enabled: true,
    provider: 'custom',
    type: 'mcp',
    mcp: { transport: 'http', url: 'https://workspace.test/mcp', authType: 'none' },
  };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
}

beforeAll(() => {
  // Ensure the global sources dir is empty at the start.
  try {
    rmSync(GLOBAL_AGENT_SOURCES_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
  mkdirSync(GLOBAL_AGENT_SOURCES_DIR, { recursive: true });
});

describe('global tier paths', () => {
  test('GLOBAL_AGENT_SOURCES_DIR resolves under the sandboxed home', () => {
    expect(GLOBAL_AGENT_SOURCES_DIR.startsWith(sandboxHome)).toBe(true);
    expect(GLOBAL_AGENT_SOURCES_DIR.endsWith(join('.agents', 'sources'))).toBe(true);
  });

  test('GLOBAL_WORKSPACE_ID is the documented sentinel', () => {
    expect(GLOBAL_WORKSPACE_ID).toBe('__global__');
  });

  test('manifest path lives inside <workspace>/sources/', () => {
    const ws = makeWorkspace();
    const path = getWorkspaceGlobalSourcesManifestPath(ws);
    expect(path).toBe(join(ws, 'sources', WORKSPACE_GLOBAL_SOURCES_MANIFEST));
  });
});

describe('readGlobalSourcesManifest', () => {
  test('returns empty manifest when file is missing', () => {
    const ws = makeWorkspace();
    const m = readGlobalSourcesManifest(ws);
    expect(m.activatedSlugs).toEqual([]);
    expect(m.version).toBe(1);
    expect(typeof m.lastModified).toBe('string');
  });

  test('tolerates malformed JSON without throwing', () => {
    const ws = makeWorkspace();
    writeManifest(ws, '{ this is not json');
    const m = readGlobalSourcesManifest(ws);
    expect(m.activatedSlugs).toEqual([]);
    // The malformed file should have been moved aside as a backup.
    const entries = readdirSync(join(ws, 'sources'));
    expect(entries.some((e) => e.startsWith(`${WORKSPACE_GLOBAL_SOURCES_MANIFEST}.broken-`))).toBe(true);
  });

  test('dedupes duplicate slugs on read', () => {
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: ['notion', 'notion', 'github'], lastModified: 'x' });
    const m = readGlobalSourcesManifest(ws);
    expect(m.activatedSlugs).toEqual(['notion', 'github']);
  });

  test('isGlobalSourceActivatedInWorkspace reflects the manifest', () => {
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: ['linear'], lastModified: 'x' });
    expect(isGlobalSourceActivatedInWorkspace(ws, 'linear')).toBe(true);
    expect(isGlobalSourceActivatedInWorkspace(ws, 'notion')).toBe(false);
  });
});

describe('loadGlobalSource', () => {
  test('returns null when the slug does not exist', () => {
    expect(loadGlobalSource('does-not-exist-' + Date.now())).toBeNull();
  });

  test('loads an existing global config with tier=global', () => {
    const slug = 'notion-' + Date.now();
    writeGlobalSource(slug, { name: 'Notion' });
    const s = loadGlobalSource(slug);
    expect(s).not.toBeNull();
    expect(s!.config.slug).toBe(slug);
    expect(s!.config.name).toBe('Notion');
    expect(s!.tier).toBe('global');
    expect(s!.workspaceId).toBe(GLOBAL_WORKSPACE_ID);
  });
});

describe('loadAllSources', () => {
  test('includes activated globals listed in the manifest', () => {
    const slug = 'github-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: [slug], lastModified: 'x' });

    const all = loadAllSources(ws);
    const found = all.find((s) => s.config.slug === slug);
    expect(found).toBeDefined();
    expect(found!.tier).toBe('global');
  });

  test('excludes globals not listed in the manifest', () => {
    const slug = 'unlisted-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace(); // no manifest

    const all = loadAllSources(ws);
    expect(all.find((s) => s.config.slug === slug)).toBeUndefined();
  });

  test('includeDormant: true surfaces unactivated globals as global-dormant', () => {
    const slug = 'dormant-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace();

    const dormant = loadAllSources(ws, { includeDormant: true });
    const found = dormant.find((s) => s.config.slug === slug);
    expect(found).toBeDefined();
    expect(found!.tier).toBe('global-dormant');
  });

  test('workspace tier wins over a same-slug activated global', () => {
    const slug = 'shared-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace();
    writeWorkspaceSource(ws, slug);
    writeManifest(ws, { version: 1, activatedSlugs: [slug], lastModified: 'x' });

    const all = loadAllSources(ws);
    const matches = all.filter((s) => s.config.slug === slug);
    expect(matches.length).toBe(1);
    expect(matches[0]!.tier).toBe('workspace');
    // Workspace MCP url, not the global one.
    expect(matches[0]!.config.mcp?.url).toBe('https://workspace.test/mcp');
  });

  test('activated slug pointing to a missing global is dropped without throwing', () => {
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: ['ghost-slug-xyz'], lastModified: 'x' });
    const all = loadAllSources(ws);
    expect(all.find((s) => s.config.slug === 'ghost-slug-xyz')).toBeUndefined();
  });

  test('includeDormant skips globals already activated', () => {
    const slug = 'no-double-' + Date.now();
    writeGlobalSource(slug);
    const ws = makeWorkspace();
    writeManifest(ws, { version: 1, activatedSlugs: [slug], lastModified: 'x' });

    const all = loadAllSources(ws, { includeDormant: true });
    const matches = all.filter((s) => s.config.slug === slug);
    expect(matches.length).toBe(1);
    expect(matches[0]!.tier).toBe('global');
  });
});

describe('loadGlobalSources / listGlobalSourceSlugs', () => {
  test('listGlobalSourceSlugs lists slugs with a config.json', () => {
    const slug = 'listed-' + Date.now();
    writeGlobalSource(slug);
    expect(listGlobalSourceSlugs()).toContain(slug);
  });

  test('loadGlobalSources returns parsed configs only', () => {
    const slug = 'parsed-' + Date.now();
    writeGlobalSource(slug);
    const all = loadGlobalSources();
    expect(all.find((s) => s.config.slug === slug)).toBeDefined();
  });
});
