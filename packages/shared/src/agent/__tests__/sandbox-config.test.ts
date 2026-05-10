/**
 * Tests for the Claude SDK sandbox config builder.
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import {
  buildClaudeSandboxOptions,
  getSandboxWriteRoots,
  isPathInsideAllowedRoots,
  extractSandboxGatedFilePath,
  SANDBOX_GATED_TOOLS,
} from '../sandbox-config.ts';
import type { SessionConfig } from '../../sessions/types.ts';

const WORKSPACE = '/tmp/craft-test-workspace';
const SESSION_ID = 'test-session';
const EXPECTED_SESSION_DIR = join(WORKSPACE, 'sessions', SESSION_ID);
const EXPECTED_WORKSPACE_DATA_DIR = join(WORKSPACE, 'data');

function makeSession(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    id: SESSION_ID,
    workspaceRootPath: WORKSPACE,
    createdAt: 0,
    lastUsedAt: 0,
    ...overrides,
  };
}

describe('buildClaudeSandboxOptions', () => {
  it('returns undefined when session is missing', () => {
    const result = buildClaudeSandboxOptions({
      session: undefined,
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when sandboxed is not enabled', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: false }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when sandboxed is undefined', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession(),
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
    });
    expect(result).toBeUndefined();
  });

  it('returns enabled config when sandboxed is true', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true, workingDirectory: '/Users/me/project' }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: '/Users/me/project',
    });

    expect(result).toBeDefined();
    expect(result?.enabled).toBe(true);
    expect(result?.autoAllowBashIfSandboxed).toBe(true);
  });

  it('closes the dangerouslyDisableSandbox escape hatch', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    // Craft already exposes user-controlled escape hatches (toggle sandbox
    // off entirely, or unset it on the session). The SDK's per-tool
    // `dangerouslyDisableSandbox` parameter would let the LLM silently
    // bypass under allow-all permission mode, undermining the property
    // the user opted in for.
    expect(result?.allowUnsandboxedCommands).toBe(false);
  });

  it('defaults failIfUnavailable to true when sandboxFailHard is unset', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    expect(result?.failIfUnavailable).toBe(true);
  });

  it('honors sandboxFailHard: false for graceful degradation', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true, sandboxFailHard: false }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    expect(result?.failIfUnavailable).toBe(false);
  });

  it('includes workingDirectory, sdkCwd, session dir, and workspace data dir in allowWrite', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({
        sandboxed: true,
        workingDirectory: '/Users/me/project',
      }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: '/Users/me/project',
    });

    const allowWrite = result?.filesystem?.allowWrite ?? [];
    expect(allowWrite).toContain('/Users/me/project');
    expect(allowWrite).toContain(EXPECTED_SESSION_DIR);
    // Workspace `data/` is the documented home for cross-run state
    // (caches, seen-sets, etc.) that automations need to update.
    expect(allowWrite).toContain(EXPECTED_WORKSPACE_DATA_DIR);
  });

  it('does NOT add the whole workspace root to allowWrite', () => {
    // automations.json, config.json, sources/, and other sessions' transcripts
    // must remain write-protected even from the sandboxed agent itself.
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    const allowWrite = result?.filesystem?.allowWrite ?? [];
    expect(allowWrite).not.toContain(WORKSPACE);
  });

  it('deduplicates allowWrite when workingDirectory equals sdkCwd', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({
        sandboxed: true,
        workingDirectory: '/Users/me/project',
      }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: '/Users/me/project',
    });

    const allowWrite = result?.filesystem?.allowWrite ?? [];
    const occurrences = allowWrite.filter((p) => p === '/Users/me/project').length;
    expect(occurrences).toBe(1);
  });

  it('falls back to session dir + workspace data for sessions without a working folder', () => {
    // When no workingDirectory is set, sdkCwd defaults to the session storage
    // dir at session creation. Writable roots are then the session dir and
    // the workspace `data/` dir (workspace-shared scratch for automations).
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });

    const allowWrite = result?.filesystem?.allowWrite ?? [];
    expect(allowWrite).toContain(EXPECTED_SESSION_DIR);
    expect(allowWrite).toContain(EXPECTED_WORKSPACE_DATA_DIR);
    expect(allowWrite).toHaveLength(2);
  });

  it('does not preset network.allowedDomains (defers to SDK prompt UX)', () => {
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });
    // Intentionally absent — first-domain prompts are the SDK default.
    expect(result?.network).toBeUndefined();
  });
});

describe('getSandboxWriteRoots', () => {
  it('returns an empty array when not sandboxed', () => {
    expect(getSandboxWriteRoots({
      session: makeSession({ sandboxed: false }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: WORKSPACE,
    })).toEqual([]);
  });

  it('returns the same roots that buildClaudeSandboxOptions feeds the SDK', () => {
    // The PreToolUse hook and the OS sandbox MUST agree. This test guards
    // against drift between the two enforcement layers.
    const args = {
      session: makeSession({
        sandboxed: true,
        workingDirectory: '/Users/me/project',
      }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: '/Users/me/project',
    };
    const roots = getSandboxWriteRoots(args);
    const sandboxOpts = buildClaudeSandboxOptions(args);
    expect(sandboxOpts?.filesystem?.allowWrite).toEqual(roots);
  });
});

describe('isPathInsideAllowedRoots', () => {
  const ROOTS = ['/Users/me/project', '/tmp/scratch'];
  const CWD = '/Users/me/project';

  it('matches an exact root path', () => {
    expect(isPathInsideAllowedRoots('/Users/me/project', ROOTS, CWD)).toBe(true);
  });

  it('matches a file inside a root', () => {
    expect(isPathInsideAllowedRoots('/Users/me/project/src/foo.ts', ROOTS, CWD)).toBe(true);
  });

  it('matches via cwd resolution for relative paths', () => {
    expect(isPathInsideAllowedRoots('src/foo.ts', ROOTS, CWD)).toBe(true);
  });

  it('does not match a sibling whose name is a prefix of a root', () => {
    // Important: /Users/me/projection should NOT be considered inside /Users/me/project.
    expect(isPathInsideAllowedRoots('/Users/me/projection/x.ts', ROOTS, CWD)).toBe(false);
  });

  it('rejects paths outside every root', () => {
    expect(isPathInsideAllowedRoots('/etc/passwd', ROOTS, CWD)).toBe(false);
    expect(isPathInsideAllowedRoots('/Users/me/Documents/secret.txt', ROOTS, CWD)).toBe(false);
  });
});

describe('extractSandboxGatedFilePath', () => {
  it('extracts file_path for Write/Edit/MultiEdit', () => {
    expect(extractSandboxGatedFilePath('Write', { file_path: '/x/y.txt' })).toBe('/x/y.txt');
    expect(extractSandboxGatedFilePath('Edit', { file_path: '/x/y.txt' })).toBe('/x/y.txt');
    expect(extractSandboxGatedFilePath('MultiEdit', { file_path: '/x/y.txt' })).toBe('/x/y.txt');
  });

  it('extracts notebook_path for NotebookEdit', () => {
    expect(extractSandboxGatedFilePath('NotebookEdit', { notebook_path: '/x/y.ipynb' })).toBe('/x/y.ipynb');
  });

  it('returns null for tools that aren\'t sandbox-gated', () => {
    expect(extractSandboxGatedFilePath('Read', { file_path: '/x/y.txt' })).toBeNull();
    expect(extractSandboxGatedFilePath('Bash', { command: 'ls' })).toBeNull();
  });

  it('returns null when the path field is missing or non-string', () => {
    expect(extractSandboxGatedFilePath('Write', {})).toBeNull();
    expect(extractSandboxGatedFilePath('Write', { file_path: 42 })).toBeNull();
    expect(extractSandboxGatedFilePath('Write', undefined)).toBeNull();
  });

  it('SANDBOX_GATED_TOOLS covers exactly the SDK\'s built-in writers', () => {
    // Lock in the gated set — adding a new built-in writer (e.g. a future
    // notebook-cell editor) requires an explicit code change here, which
    // forces the author to think about sandbox semantics.
    expect([...SANDBOX_GATED_TOOLS].sort()).toEqual([
      'Edit', 'MultiEdit', 'NotebookEdit', 'Write',
    ]);
  });
});
