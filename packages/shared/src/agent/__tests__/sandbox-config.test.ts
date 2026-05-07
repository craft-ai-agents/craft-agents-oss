/**
 * Tests for the Claude SDK sandbox config builder.
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { buildClaudeSandboxOptions } from '../sandbox-config.ts';
import type { SessionConfig } from '../../sessions/types.ts';

const WORKSPACE = '/tmp/craft-test-workspace';
const SESSION_ID = 'test-session';
const EXPECTED_SESSION_DIR = join(WORKSPACE, 'sessions', SESSION_ID);

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

  it('includes workingDirectory, sdkCwd, and session dir in allowWrite', () => {
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

  it('falls back to session dir for sessions without a working folder', () => {
    // When no workingDirectory is set, sdkCwd defaults to the session storage
    // dir at session creation, so the only writable root is the session dir.
    const result = buildClaudeSandboxOptions({
      session: makeSession({ sandboxed: true }),
      workspaceRootPath: WORKSPACE,
      sdkCwd: EXPECTED_SESSION_DIR,
    });

    const allowWrite = result?.filesystem?.allowWrite ?? [];
    expect(allowWrite).toEqual([EXPECTED_SESSION_DIR]);
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
