/**
 * Context-file discovery is bounded (craft-agents-oss#1140): the system prompt is
 * built synchronously on the main process, and a glob over a home-folder-sized
 * git root froze the app for 30–40 s.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { getProjectContextFilesPrompt, invalidateContextFileCache, scanContextFiles } from '../system.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A temp folder holding `paths`: files with some text, folders where a path ends in `/`. */
function tree(paths: string[]): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'craft-context-files-')));
  tempDirs.push(root);
  for (const path of paths) {
    if (path.endsWith('/')) {
      mkdirSync(join(root, path), { recursive: true });
    } else {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), '# Instructions\n');
    }
  }
  return root;
}

/** `width` folders per level, `levels` deep, under `prefix` */
function wideTree(prefix: string, width: number, levels: number): string[] {
  if (levels === 0) return [`${prefix}/`];
  return Array.from({ length: width }, (_, i) => wideTree(`${prefix}/d${i}`, width, levels - 1)).flat();
}

describe('scanContextFiles', () => {
  it('lists context files of any case below the folder, shallowest first, with / separators', () => {
    const root = tree(['CLAUDE.md', 'AGENTS.md', 'b/agents.md', 'a/x/Claude.md', 'a/README.md']);

    const scan = scanContextFiles(root);

    expect(scan).toEqual({ files: ['AGENTS.md', 'CLAUDE.md', 'b/agents.md', 'a/x/Claude.md'], dirsRead: 4, truncated: false });
  });

  it('stops at the folder limit in a large tree', () => {
    const root = tree(['CLAUDE.md', ...wideTree('big', 6, 3)]);

    const scan = scanContextFiles(root, { maxDirs: 50 });

    expect(scan.dirsRead).toBe(50);
    expect(scan.truncated).toBe(true);
    expect(scan.files).toEqual(['CLAUDE.md']);
  });

  it('keeps the shallow files when it stops', () => {
    const root = tree(['CLAUDE.md', 'b/CLAUDE.md', 'a/CLAUDE.md', 'a/deeper/CLAUDE.md', 'c/CLAUDE.md']);

    // Folders are read level by level, in name order: the root, then a, b, c
    expect(scanContextFiles(root, { maxDirs: 3 })).toEqual({
      files: ['CLAUDE.md', 'a/CLAUDE.md', 'b/CLAUDE.md'],
      dirsRead: 3,
      truncated: true,
    });

    // A clock that ticks 1 ms per reading of it: time is up before the third folder
    let clock = 0;
    expect(scanContextFiles(root, { budgetMs: 3, now: () => clock++ })).toEqual({
      files: ['CLAUDE.md', 'a/CLAUDE.md'],
      dirsRead: 2,
      truncated: true,
    });
  });

  it('looks only as deep as allowed', () => {
    const root = tree(['a/CLAUDE.md', 'a/b/CLAUDE.md', 'a/b/c/CLAUDE.md']);

    expect(scanContextFiles(root, { maxDepth: 2 })).toEqual({ files: ['a/CLAUDE.md', 'a/b/CLAUDE.md'], dirsRead: 3, truncated: false });
  });

  it('skips hidden folders, excluded folders in any case and ~/Library', () => {
    const root = tree([
      'src/CLAUDE.md',
      '.github/CLAUDE.md',
      '.git/CLAUDE.md',
      'Build/CLAUDE.md',
      'Node_Modules/pkg/CLAUDE.md',
      'DIST/CLAUDE.md',
      'Library/CLAUDE.md',
      'projects/Library/CLAUDE.md',
    ]);

    // Only the home folder's own Library is skipped
    expect(scanContextFiles(root, { homeDir: root }).files).toEqual(['src/CLAUDE.md', 'projects/Library/CLAUDE.md']);
  });

  it('lists symlinked context files but never enters symlinked folders', () => {
    const root = tree(['docs/guide.md', 'real/CLAUDE.md']);
    symlinkSync(join(root, 'docs', 'guide.md'), join(root, 'AGENTS.md'));
    symlinkSync(join(root, 'real'), join(root, 'linked'));
    symlinkSync(root, join(root, 'real', 'loop'));

    const scan = scanContextFiles(root);

    expect(scan.files).toEqual(['AGENTS.md', 'real/CLAUDE.md']);
    expect(scan.dirsRead).toBe(3);
  });
});

describe('getProjectContextFilesPrompt outside git', () => {
  it('lists the files of a symlinked working folder', () => {
    const root = tree(['real/CLAUDE.md', 'real/sub/CLAUDE.md']);
    const link = join(root, 'link');
    symlinkSync(join(root, 'real'), link);

    const block = getProjectContextFilesPrompt(link);

    expect(block).toContain(`context_root="${link}"`);
    expect(block).toContain('- CLAUDE.md (root)\n- sub/CLAUDE.md');
  });

  it('caches per working folder until that folder is invalidated', () => {
    const root = tree(['CLAUDE.md', 'pkg/CLAUDE.md']);
    const pkg = join(root, 'pkg');

    expect(getProjectContextFilesPrompt(root)).toContain('- CLAUDE.md (root)\n- pkg/CLAUDE.md');
    expect(getProjectContextFilesPrompt(pkg)).toContain('- CLAUDE.md (root)\n</project_context_files>');

    writeFileSync(join(pkg, 'AGENTS.md'), '# New\n');
    expect(getProjectContextFilesPrompt(pkg)).not.toContain('AGENTS.md');

    // The path is resolved the same way as for discovery
    invalidateContextFileCache(`${pkg}/../pkg/`);
    expect(getProjectContextFilesPrompt(pkg)).toContain('- AGENTS.md (root)\n- CLAUDE.md (root)');
    expect(getProjectContextFilesPrompt(root)).not.toContain('AGENTS.md');
  });
});
