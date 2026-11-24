import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  collectGitDeveloperContext,
  formatStableGitDeveloperContext,
  formatVolatileGitDeveloperContext,
} from '../developer-context.ts';
import { getProjectContextFilesPrompt } from '../system.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('git developer context', () => {
  it('returns null outside git repositories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'craft-prompt-non-git-'));
    tempDirs.push(dir);

    expect(collectGitDeveloperContext(dir)).toBeNull();
    expect(formatStableGitDeveloperContext(dir)).toBeNull();
    expect(formatVolatileGitDeveloperContext(dir)).toBeNull();
  });

  it('emits stable repo metadata with sibling worktree guidance', () => {
    const { root, packageDir } = createGitFixture();

    const block = formatStableGitDeveloperContext(packageDir);

    expect(block).not.toBeNull();
    expect(block!).toContain('<developer_context kind="git_repository" scope="stable">');
    expect(block!).toContain(`repoRoot: ${root}`);
    expect(block!).toContain('repoParent:');
    expect(block!).toContain('selectedPathWithinRepo: packages/shared');
    expect(block!).toContain('create it as a sibling of repoRoot inside repoParent');
  });

  it('emits bounded volatile git status', () => {
    const { packageDir } = createGitFixture();
    writeFileSync(join(packageDir, 'changed.txt'), 'dirty');

    const block = formatVolatileGitDeveloperContext(packageDir);

    expect(block).not.toBeNull();
    expect(block!).toContain('<developer_context kind="git_repository" scope="volatile">');
    expect(block!).toContain('worktreeState: dirty');
    expect(block!).toContain('changedFilesSample:');
    expect(block!).toContain('packages/shared/changed.txt');
  });

  it('lists root and selected-path context files relative to git context_root', () => {
    const { root, packageDir } = createGitFixture();

    const block = getProjectContextFilesPrompt(packageDir);

    expect(block).toContain(`context_root="${root}"`);
    expect(block).toContain('- CLAUDE.md (root)');
    expect(block).toContain('- packages/shared/CLAUDE.md');
  });

  // OSS #1140: the whole git root was globbed and capped to the 30 shallowest
  // files before filtering, so a big unrelated tree hid the selected path's files.
  it('keeps ancestor and subtree context files when unrelated trees fill the cap', () => {
    const { root, packageDir } = createGitFixture();
    for (let i = 0; i < 40; i++) {
      const dir = join(root, 'other', `p${String(i).padStart(2, '0')}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'CLAUDE.md'), '# Unrelated\n');
    }
    writeFileSync(join(root, 'packages', 'AGENTS.md'), '# Packages\n');
    mkdirSync(join(packageDir, 'src', 'deep'), { recursive: true });
    writeFileSync(join(packageDir, 'src', 'deep', 'claude.md'), '# Deep\n');

    const block = getProjectContextFilesPrompt(packageDir);

    expect(block).toContain('- CLAUDE.md (root)\n- packages/AGENTS.md\n- packages/shared/CLAUDE.md\n- packages/shared/src/deep/claude.md');
    expect(block).not.toContain('other/');
  });

  it('lists nothing when only folders beside the working folder have context files', () => {
    const { root, packageDir } = createGitFixture();
    rmSync(join(root, 'CLAUDE.md'));
    rmSync(join(packageDir, 'CLAUDE.md'));
    mkdirSync(join(root, 'other'));
    writeFileSync(join(root, 'other', 'CLAUDE.md'), '# Unrelated\n');

    expect(getProjectContextFilesPrompt(packageDir)).toBe('');
  });

  it('reads the git root and each folder above the working folder once, and nothing beside it', () => {
    const { root, packageDir } = createGitFixture();
    mkdirSync(join(root, 'other', 'deep'), { recursive: true });
    mkdirSync(join(root, 'packages', 'neighbour', 'src'), { recursive: true });
    mkdirSync(join(packageDir, 'src'), { recursive: true });
    const readdir = spyOn(fs, 'readdirSync');

    try {
      getProjectContextFilesPrompt(packageDir);

      const read = readdir.mock.calls.map(([dir]) => String(dir));
      const outside = read.filter((dir) => dir !== packageDir && !dir.startsWith(packageDir + sep));
      expect(outside).toEqual([root, join(root, 'packages')]);
      expect(read).toContain(join(packageDir, 'src'));
    } finally {
      readdir.mockRestore();
    }
  });
});

function createGitFixture(): { root: string; packageDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'craft-prompt-git-'));
  tempDirs.push(root);
  const packageDir = join(root, 'packages', 'shared');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), '# Root instructions\n');
  writeFileSync(join(packageDir, 'CLAUDE.md'), '# Package instructions\n');

  const init = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  if (init.status !== 0) {
    throw new Error(`git init failed: ${init.stderr}`);
  }

  return { root: realpathSync.native(root), packageDir: realpathSync.native(packageDir) };
}
