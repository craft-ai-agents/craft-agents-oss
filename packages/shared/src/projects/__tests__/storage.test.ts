/**
 * Tests for Project Storage — MEMORY.md loading.
 *
 * Uses real temp directories to exercise actual filesystem operations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { estimateTokensDensityAware } from '../../utils/large-response.ts';
import {
  createProject,
  getProjectMemoryPath,
  loadProjectMemory,
  sanitizeAssetFilename,
} from '../storage.ts';

let tempDir: string;
let workspaceRoot: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'projects-test-'));
  workspaceRoot = join(tempDir, 'workspace');
});

afterEach(() => {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function makeProjectSlug(name = 'Memory Test'): string {
  return createProject(workspaceRoot, { name }).slug;
}

describe('sanitizeAssetFilename', () => {
  it('strips control chars and NUL bytes (the literal-NUL regex fix)', () => {
    // A NUL, newline, and tab are all removed — the source regex no longer carries a literal NUL.
    expect(sanitizeAssetFilename('re\x00port\n\t.pdf')).toBe('report.pdf');
  });

  it('strips path separators and leading dots so an upload stays in the assets dir', () => {
    expect(sanitizeAssetFilename('..\\..\\etc\\passwd')).toBe('etcpasswd');
  });

  it('falls back to a generated name when the input reduces to empty', () => {
    expect(sanitizeAssetFilename('\x00\n\t')).toMatch(/^asset_[0-9a-f]{8}$/);
  });
});

describe('loadProjectMemory', () => {
  it('returns null when MEMORY.md does not exist', () => {
    const slug = makeProjectSlug();
    expect(loadProjectMemory(workspaceRoot, slug)).toBeNull();
  });

  it('returns null when MEMORY.md is whitespace-only', () => {
    const slug = makeProjectSlug();
    writeFileSync(getProjectMemoryPath(workspaceRoot, slug), '   \n\t\n');
    expect(loadProjectMemory(workspaceRoot, slug)).toBeNull();
  });

  it('returns content verbatim when under the token cap', () => {
    const slug = makeProjectSlug();
    const content = '# Lessons\n\n- Always read the guide first.\n- Cache is king.';
    writeFileSync(getProjectMemoryPath(workspaceRoot, slug), content);
    expect(loadProjectMemory(workspaceRoot, slug)).toBe(content);
  });

  it('head-truncates and appends a marker when over the cap, staying within budget', () => {
    const slug = makeProjectSlug();
    const maxTokens = 50;
    // ~2000 chars of plain text => ~500 tokens, well over the 50-token cap.
    const body = 'TOP-OF-MEMORY ' + 'lorem ipsum dolor sit amet '.repeat(74) + ' BOTTOM-OF-MEMORY';
    writeFileSync(getProjectMemoryPath(workspaceRoot, slug), body);

    const result = loadProjectMemory(workspaceRoot, slug, maxTokens);
    expect(result).not.toBeNull();
    const text = result as string;

    // Head kept (newest-first authoring), tail dropped.
    expect(text).toContain('TOP-OF-MEMORY');
    expect(text).not.toContain('BOTTOM-OF-MEMORY');

    // Marker present and budget respected (marker included).
    expect(text).toContain(`truncated at ${maxTokens}-token cap`);
    expect(estimateTokensDensityAware(text)).toBeLessThanOrEqual(maxTokens);
  });
});
