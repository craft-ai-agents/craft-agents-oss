import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PromptBuilder } from '../prompt-builder.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('PromptBuilder developer context split', () => {
  it('places git repo identity in stable context and status in volatile context', () => {
    const { root, packageDir } = createGitFixture();
    writeFileSync(join(packageDir, 'dirty.txt'), 'dirty');

    const builder = new PromptBuilder({
      workspace: { id: 'workspace', name: 'Workspace', rootPath: root } as any,
      session: { id: 'session-1', workingDirectory: packageDir } as any,
    });

    const stableParts = builder.buildStableContextParts();
    const volatileParts = builder.buildVolatileContextParts({ plansFolderPath: join(root, 'plans') });
    const stable = stableParts.join('\n');
    const volatile = volatileParts.join('\n');

    expect(stable).toContain('<developer_context kind="git_repository" scope="stable">');
    expect(stable).toContain(`repoRoot: ${root}`);
    expect(stable).toContain('create it as a sibling of repoRoot inside repoParent');
    expect(stable).not.toContain('changedFilesSample:');

    expect(volatile).toContain('<developer_context kind="git_repository" scope="volatile">');
    expect(volatile).toContain('worktreeState: dirty');
    expect(volatile).toContain('changedFilesSample:');
    expect(volatile).not.toContain('repoParent:');
  });
});

describe('PromptBuilder agent profile', () => {
  const workspace = { id: 'workspace', name: 'Workspace', rootPath: '/tmp/craft-prompt-builder-ws' } as any;
  const session = { id: 'session-1' } as any;

  it('includes workspace capabilities by default', () => {
    const builder = new PromptBuilder({ workspace, session });
    expect(builder.buildStableContextParts().join('\n')).toContain('<workspace_capabilities>');
  });

  it('drops workspace capabilities in coding mode, set at construction or later', () => {
    expect(new PromptBuilder({ workspace, session, agentProfile: 'coding' }).buildStableContextParts().join('\n'))
      .not.toContain('<workspace_capabilities>');

    const builder = new PromptBuilder({ workspace, session });
    builder.setAgentProfile('coding');
    const stable = builder.buildStableContextParts().join('\n');
    expect(stable).not.toContain('<workspace_capabilities>');
    expect(stable).toContain('<working_directory>');
  });
});

function createGitFixture(): { root: string; packageDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'craft-prompt-builder-git-'));
  tempDirs.push(root);
  const packageDir = join(root, 'packages', 'shared');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), '# Root instructions\n');

  const init = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  if (init.status !== 0) {
    throw new Error(`git init failed: ${init.stderr}`);
  }

  return { root: realpathSync.native(root), packageDir: realpathSync.native(packageDir) };
}
