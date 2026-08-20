import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureBuiltinSources,
  isBuiltinSource,
  getBuiltinSources,
} from '../builtin-sources.ts';
import { computeSourceTokenStats } from '../source-stats.ts';

describe('builtin sources seed', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'craft-builtin-src-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('recognizes exa and firecrawl slugs as builtin', () => {
    expect(isBuiltinSource('exa')).toBe(true);
    expect(isBuiltinSource('firecrawl')).toBe(true);
    expect(isBuiltinSource('craft-agents-docs')).toBe(true);
    expect(isBuiltinSource('linear')).toBe(false);
  });

  it('creates disabled API source templates once', () => {
    const first = ensureBuiltinSources(dir);
    expect(first.created.sort()).toEqual(['exa', 'firecrawl']);
    expect(existsSync(join(dir, 'sources', 'exa', 'config.json'))).toBe(true);
    expect(existsSync(join(dir, 'sources', 'firecrawl', 'guide.md'))).toBe(true);

    const cfg = JSON.parse(readFileSync(join(dir, 'sources', 'exa', 'config.json'), 'utf-8'));
    expect(cfg.slug).toBe('exa');
    expect(cfg.type).toBe('api');
    expect(cfg.enabled).toBe(false);

    const second = ensureBuiltinSources(dir);
    expect(second.created).toEqual([]);
  });

  it('does not overwrite user-edited config', () => {
    ensureBuiltinSources(dir);
    const path = join(dir, 'sources', 'exa', 'config.json');
    const edited = JSON.parse(readFileSync(path, 'utf-8'));
    edited.name = 'My Exa';
    writeFileSync(path, JSON.stringify(edited, null, 2));
    ensureBuiltinSources(dir);
    const again = JSON.parse(readFileSync(path, 'utf-8'));
    expect(again.name).toBe('My Exa');
  });

  it('computeSourceTokenStats uses guide for api builtins', () => {
    const [exa] = getBuiltinSources('ws', dir);
    const stats = computeSourceTokenStats(exa!);
    expect(stats.source).toBe('guide');
    expect(stats.tokenEstimate).toBeGreaterThan(0);
  });
});
