import { describe, expect, it } from 'bun:test';
import { GIT_BASH_PATH_ENV_VAR, resolveConfiguredGitBashShellPath } from './git-bash-shell.ts';

describe('Git Bash shell path bridge', () => {
  it('returns undefined when no Git Bash path is configured', () => {
    expect(resolveConfiguredGitBashShellPath({})).toBeUndefined();
  });

  it('trims and returns the configured Git Bash path', () => {
    expect(resolveConfiguredGitBashShellPath({
      [GIT_BASH_PATH_ENV_VAR]: '  C:\\Program Files\\Git\\bin\\bash.exe  ',
    })).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
  });

  it('ignores blank configured values', () => {
    expect(resolveConfiguredGitBashShellPath({
      [GIT_BASH_PATH_ENV_VAR]: '   ',
    })).toBeUndefined();
  });
});
