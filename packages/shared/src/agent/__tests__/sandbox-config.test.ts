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
