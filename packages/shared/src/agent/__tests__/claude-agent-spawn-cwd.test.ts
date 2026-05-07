/**
 * Tests for the SDK subprocess spawn-cwd guard and ENOENT diagnostics.
 *
 * Covers the helpers in `agent/spawn-helpers.ts` plus the simulated
 * pre-spawn detection / cwd-resolution logic that lives in
 * `claude-agent.ts:chatImpl`.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isExistingDirectory,
  extractSdkReportedBinaryPath,
  isSpawnEnoent,
} from '../spawn-helpers.ts';

// ============================================================
// isExistingDirectory
// ============================================================

describe('isExistingDirectory', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'craft-spawn-helpers-'));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns true for an existing directory', () => {
    expect(isExistingDirectory(tempDir)).toBe(true);
  });

  it('returns false for a non-existent path', () => {
    expect(isExistingDirectory(join(tempDir, 'does-not-exist'))).toBe(false);
  });

  it('returns false for a regular file', () => {
    const filePath = join(tempDir, 'regular.txt');
    writeFileSync(filePath, 'content');
    expect(isExistingDirectory(filePath)).toBe(false);
  });

  it('returns false for a broken symlink (target missing)', () => {
    const linkPath = join(tempDir, 'broken-link');
    symlinkSync(join(tempDir, 'no-such-target'), linkPath);
    // lstatSync returns SymbolicLink stats, isDirectory() is false → "missing"
    expect(isExistingDirectory(linkPath)).toBe(false);
  });

  it('returns false for null / undefined / empty input', () => {
    expect(isExistingDirectory(null)).toBe(false);
    expect(isExistingDirectory(undefined)).toBe(false);
    expect(isExistingDirectory('')).toBe(false);
  });
});

// ============================================================
// resolveSpawnCwd (simulated — mirrors claude-agent.ts logic)
// ============================================================

describe('resolveSpawnCwd (simulated)', () => {
  let tempDir: string;
  let workspaceRoot: string;
  let parentCwd: string;
  let sessionPath: string;
  let sdkCwd: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'craft-resolve-cwd-'));
    workspaceRoot = join(tempDir, 'ws');
    parentCwd = join(tempDir, 'parent');
    sessionPath = join(tempDir, 'session');
    sdkCwd = join(tempDir, 'sdk-cwd');
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Mirrors ClaudeAgent.resolveSpawnCwd. We can't construct a real
  // ClaudeAgent in unit tests (full SDK + config dependency), so we mirror
  // the candidate ordering inline.
  function resolveSpawnCwd({
    isRetry,
    branchFromSdkSessionId,
    branchFromSdkCwd,
    sdkCwd,
    sessionId,
    sessionPath,
    workspaceRootPath,
  }: {
    isRetry: boolean;
    branchFromSdkSessionId: string | null;
    branchFromSdkCwd: string | null;
    sdkCwd: string | undefined;
    sessionId: string | null;
    sessionPath: string | null;
    workspaceRootPath: string;
  }): string {
    const candidates: Array<string | null | undefined> = [
      !isRetry && branchFromSdkSessionId ? branchFromSdkCwd : null,
      sdkCwd,
      sessionId ? sessionPath : null,
      workspaceRootPath,
    ];
    for (const c of candidates) {
      if (isExistingDirectory(c)) return c!;
    }
    return workspaceRootPath;
  }

  it('returns branchFromSdkCwd when it is an existing directory and not a retry', () => {
    mkdirSync(parentCwd, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
    const got = resolveSpawnCwd({
      isRetry: false,
      branchFromSdkSessionId: 'parent-123',
      branchFromSdkCwd: parentCwd,
      sdkCwd: undefined,
      sessionId: null,
      sessionPath: null,
      workspaceRootPath: workspaceRoot,
    });
    expect(got).toBe(parentCwd);
  });

  it('does not consult branchFromSdkCwd when isRetry=true', () => {
    mkdirSync(parentCwd, { recursive: true });
    mkdirSync(sdkCwd, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
    const got = resolveSpawnCwd({
      isRetry: true,
      branchFromSdkSessionId: 'parent-123',
      branchFromSdkCwd: parentCwd,
      sdkCwd,
      sessionId: null,
      sessionPath: null,
      workspaceRootPath: workspaceRoot,
    });
    expect(got).toBe(sdkCwd);
  });

  it('skips branchFromSdkCwd when missing and falls through to sdkCwd', () => {
    // parentCwd intentionally not created
    mkdirSync(sdkCwd, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
    const got = resolveSpawnCwd({
      isRetry: false,
      branchFromSdkSessionId: 'parent-123',
      branchFromSdkCwd: parentCwd,
      sdkCwd,
      sessionId: null,
      sessionPath: null,
      workspaceRootPath: workspaceRoot,
    });
    expect(got).toBe(sdkCwd);
  });

  it('falls through to workspaceRootPath when all earlier candidates are missing', () => {
    mkdirSync(workspaceRoot, { recursive: true });
    const got = resolveSpawnCwd({
      isRetry: false,
      branchFromSdkSessionId: null,
      branchFromSdkCwd: null,
      sdkCwd: undefined,
      sessionId: null,
      sessionPath: null,
      workspaceRootPath: workspaceRoot,
    });
    expect(got).toBe(workspaceRoot);
  });
});

// ============================================================
// extractSdkReportedBinaryPath
// ============================================================

describe('extractSdkReportedBinaryPath', () => {
  it('matches the modern "native binary" SDK wrapper string', () => {
    const msg = 'Claude Code native binary not found at /opt/claude/bin/claude';
    expect(extractSdkReportedBinaryPath(msg)).toBe('/opt/claude/bin/claude');
  });

  it('matches the legacy "executable not found" wrapper string', () => {
    const msg = 'Claude Code executable not found at /usr/local/bin/claude';
    expect(extractSdkReportedBinaryPath(msg)).toBe('/usr/local/bin/claude');
  });

  it('captures macOS .app bundle paths without truncating at the first dot', () => {
    const msg =
      'Claude Code native binary not found at /Applications/Craft Agents.app/Contents/Resources/app/node_modules/@anthropic-ai/claude-agent-sdk-binary/claude';
    expect(extractSdkReportedBinaryPath(msg)).toBe(
      '/Applications/Craft Agents.app/Contents/Resources/app/node_modules/@anthropic-ai/claude-agent-sdk-binary/claude',
    );
  });

  it('strips a trailing sentence period without eating dots inside the path', () => {
    const msg = 'Claude Code native binary not found at /opt/0.9.1/claude.';
    expect(extractSdkReportedBinaryPath(msg)).toBe('/opt/0.9.1/claude');
  });

  it('returns undefined when the message does not match', () => {
    expect(extractSdkReportedBinaryPath('some unrelated error')).toBeUndefined();
    expect(extractSdkReportedBinaryPath('')).toBeUndefined();
    expect(extractSdkReportedBinaryPath(null)).toBeUndefined();
    expect(extractSdkReportedBinaryPath(undefined)).toBeUndefined();
  });
});

// ============================================================
// isSpawnEnoent
// ============================================================

describe('isSpawnEnoent', () => {
  it('detects ENOENT via structured error fields', () => {
    expect(
      isSpawnEnoent({
        errorCode: 'ENOENT',
        errorSyscall: 'spawn /opt/claude',
      }),
    ).toBe(true);
  });

  it('detects "spawn ... ENOENT" in raw error text', () => {
    expect(isSpawnEnoent({ rawErrorMsg: 'spawn /opt/claude ENOENT' })).toBe(true);
  });

  it('detects "spawn ... ENOENT" in stderr', () => {
    expect(isSpawnEnoent({ stderr: 'Error: spawn /opt/claude ENOENT' })).toBe(true);
  });

  it('detects the SDK wrapper "Claude Code native binary not found at ..."', () => {
    expect(
      isSpawnEnoent({
        rawErrorMsg: 'Claude Code native binary not found at /opt/claude/bin/claude',
      }),
    ).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isSpawnEnoent({ errorCode: 'EACCES' })).toBe(false);
    expect(isSpawnEnoent({ rawErrorMsg: 'Connection refused' })).toBe(false);
    expect(isSpawnEnoent({})).toBe(false);
  });
});

// ============================================================
// Pre-spawn stale-branch routing (simulated chatImpl entry guard)
// ============================================================

describe('pre-spawn stale-branch detection', () => {
  // Mirrors the guard at the top of chatImpl(): if the parent cwd doesn't
  // exist on disk, route through the recovery helper instead of letting the
  // SDK fail with the misleading "binary not found" wrapper.
  function shouldRouteToRecovery(state: {
    isRetry: boolean;
    branchFromSdkCwd: string | null;
    branchFromSdkSessionId: string | null;
    cwdExists: boolean;
  }): boolean {
    return (
      !state.isRetry &&
      !!state.branchFromSdkCwd &&
      !!state.branchFromSdkSessionId &&
      !state.cwdExists
    );
  }

  it('routes to recovery when branchFromSdkCwd is missing on disk', () => {
    expect(
      shouldRouteToRecovery({
        isRetry: false,
        branchFromSdkCwd: '/missing/parent/cwd',
        branchFromSdkSessionId: 'parent-123',
        cwdExists: false,
      }),
    ).toBe(true);
  });

  it('does NOT route to recovery when branch cwd exists', () => {
    expect(
      shouldRouteToRecovery({
        isRetry: false,
        branchFromSdkCwd: '/existing/parent/cwd',
        branchFromSdkSessionId: 'parent-123',
        cwdExists: true,
      }),
    ).toBe(false);
  });

  it('does NOT route to recovery when isRetry=true (retry must not loop into recovery)', () => {
    expect(
      shouldRouteToRecovery({
        isRetry: true,
        branchFromSdkCwd: '/missing/parent/cwd',
        branchFromSdkSessionId: 'parent-123',
        cwdExists: false,
      }),
    ).toBe(false);
  });

  it('does NOT route when no branch fields are set (regular fresh session)', () => {
    expect(
      shouldRouteToRecovery({
        isRetry: false,
        branchFromSdkCwd: null,
        branchFromSdkSessionId: null,
        cwdExists: false,
      }),
    ).toBe(false);
  });
});

// ============================================================
// onBranchForkInvalidated callback (atomic persistence — the v2 fix)
// ============================================================

describe('onBranchForkInvalidated callback', () => {
  /**
   * Mirrors the SessionManager callback that this PR introduces.
   * Verifies all four fork fields are cleared and persistence is triggered.
   */
  function makeCallback(managed: Record<string, unknown>) {
    const persistSession = mock((_m: Record<string, unknown>) => {});
    const flush = mock((_id: string) => {});
    const sessionLog = { info: mock((_msg: string) => {}) };
    const onBranchForkInvalidated = () => {
      managed.sdkSessionId = undefined;
      managed.branchFromSdkSessionId = undefined;
      managed.branchFromSdkCwd = undefined;
      managed.branchFromSdkTurnId = undefined;
      sessionLog.info(
        `Branch fork invalidated for ${managed.id}: cleared all fork metadata`,
      );
      persistSession(managed);
      flush(managed.id as string);
    };
    return { onBranchForkInvalidated, persistSession, flush, sessionLog };
  }

  it('clears all four fork fields atomically', () => {
    const managed: Record<string, unknown> = {
      id: 'session-123',
      sdkSessionId: 'child-sdk-789',
      branchFromSdkSessionId: 'parent-sdk-456',
      branchFromSdkCwd: '/old/parent/cwd',
      branchFromSdkTurnId: 'turn-321',
    };
    const { onBranchForkInvalidated, persistSession, flush } = makeCallback(managed);

    onBranchForkInvalidated();

    expect(managed.sdkSessionId).toBeUndefined();
    expect(managed.branchFromSdkSessionId).toBeUndefined();
    expect(managed.branchFromSdkCwd).toBeUndefined();
    expect(managed.branchFromSdkTurnId).toBeUndefined();
    expect(persistSession).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('logs an invalidation message rather than the generic "cleared" message', () => {
    const managed: Record<string, unknown> = {
      id: 'session-456',
      sdkSessionId: 'child',
      branchFromSdkSessionId: 'parent',
      branchFromSdkCwd: '/cwd',
      branchFromSdkTurnId: 'turn',
    };
    const { onBranchForkInvalidated, sessionLog } = makeCallback(managed);

    onBranchForkInvalidated();

    const firstLog = sessionLog.info.mock.calls[0] as unknown as string[];
    expect(firstLog[0]).toContain('Branch fork invalidated');
    expect(firstLog[0]).toContain('session-456');
  });
});
