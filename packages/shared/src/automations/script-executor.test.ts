/**
 * Tests for the script action executor.
 *
 * Successor to the pre-rename command-executor tests (recovered from
 * 9f013b3f^): the security model changed from shell + allowlist to
 * argv spawn + workspace containment + CRAFT_*-only env, so the cases
 * here assert the new invariants.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { executeScriptAction, clampScriptTimeout, createScriptHistoryEntry, DEFAULT_SCRIPT_TIMEOUT_MS, MAX_SCRIPT_TIMEOUT_MS } from './script-executor.ts';
import { buildScriptEnv } from './utils.ts';
import { loadPageConfig, savePageConfig } from '../pages/storage.ts';
import type { ScriptAction } from './types.ts';

const IS_WINDOWS = process.platform === 'win32';

describe('script-executor', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'script-executor-test-'));
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  function action(overrides: Partial<ScriptAction> & Pick<ScriptAction, 'script'>): ScriptAction {
    return { type: 'script', runtime: 'bun', ...overrides };
  }

  function ctx(env: Record<string, string> = {}) {
    return { workspaceRootPath: workspaceDir, env };
  }

  describe('path containment', () => {
    it('blocks absolute script paths', async () => {
      const abs = IS_WINDOWS ? 'C:\\evil.ts' : '/tmp/evil.ts';
      const result = await executeScriptAction(action({ script: abs }), ctx());
      expect(result.blocked).toBe(true);
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('relative');
    });

    it('blocks paths escaping the workspace via ..', async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), 'script-executor-escape-'));
      try {
        writeFileSync(join(outsideDir, 'outside.ts'), 'console.log("outside")');
        const escapePath = join('..', relative(tmpdir(), outsideDir), 'outside.ts');
        const result = await executeScriptAction(action({ script: escapePath }), ctx());
        expect(result.blocked).toBe(true);
        expect(result.stderr).toContain('escapes the workspace');
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it.skipIf(IS_WINDOWS)('blocks symlinks pointing outside the workspace', async () => {
      const outsideDir = mkdtempSync(join(tmpdir(), 'script-executor-outside-'));
      try {
        writeFileSync(join(outsideDir, 'target.ts'), 'console.log("outside")');
        symlinkSync(join(outsideDir, 'target.ts'), join(workspaceDir, 'link.ts'));
        const result = await executeScriptAction(action({ script: 'link.ts' }), ctx());
        expect(result.blocked).toBe(true);
        expect(result.stderr).toContain('escapes the workspace');
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('blocks missing scripts', async () => {
      const result = await executeScriptAction(action({ script: 'nope.ts' }), ctx());
      expect(result.blocked).toBe(true);
      expect(result.stderr).toContain('not found');
    });
  });

  describe('execution', () => {
    it('runs a script and captures stdout/exit code', async () => {
      writeFileSync(join(workspaceDir, 'ok.ts'), 'console.log("hello from script")');
      const result = await executeScriptAction(action({ script: 'ok.ts' }), ctx());
      expect(result.blocked).toBeUndefined();
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello from script');
    });

    it('reports non-zero exits as failure with stderr', async () => {
      writeFileSync(join(workspaceDir, 'fail.ts'), 'console.error("boom"); process.exit(3)');
      const result = await executeScriptAction(action({ script: 'fail.ts' }), ctx());
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(3);
      expect(result.stderr).toContain('boom');
    });

    it('passes argv and the provided env (and nothing else CRAFT-relevant)', async () => {
      writeFileSync(
        join(workspaceDir, 'env.ts'),
        'console.log(JSON.stringify({ argv: process.argv.slice(2), craft: process.env.CRAFT_EVENT, leak: process.env.SCRIPT_EXECUTOR_LEAK_PROBE ?? null }))',
      );
      process.env.SCRIPT_EXECUTOR_LEAK_PROBE = 'should-not-leak';
      try {
        const result = await executeScriptAction(
          action({ script: 'env.ts', args: ['--flag', 'value'] }),
          ctx({ CRAFT_EVENT: 'SchedulerTick' }),
        );
        expect(result.success).toBe(true);
        const parsed = JSON.parse(result.stdout) as { argv: string[]; craft: string; leak: string | null };
        expect(parsed.argv).toEqual(['--flag', 'value']);
        expect(parsed.craft).toBe('SchedulerTick');
        expect(parsed.leak).toBeNull();
      } finally {
        delete process.env.SCRIPT_EXECUTOR_LEAK_PROBE;
      }
    });

    it('kills scripts that exceed their timeout', async () => {
      writeFileSync(join(workspaceDir, 'hang.ts'), 'await new Promise(() => {})');
      const result = await executeScriptAction(
        action({ script: 'hang.ts', timeoutMs: 1_000 }),
        ctx(),
      );
      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
      expect(result.stderr).toContain('Timed out');
    }, 15_000);

    it('kills a running script when the abort signal fires', async () => {
      writeFileSync(join(workspaceDir, 'hang.ts'), 'await new Promise(() => {})');
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 200);
      const result = await executeScriptAction(
        // Long timeout so the abort — not the timeout — is what ends the run.
        action({ script: 'hang.ts', timeoutMs: 30_000 }),
        { workspaceRootPath: workspaceDir, env: {}, signal: controller.signal },
      );
      expect(result.success).toBe(false);
      expect(result.exitCode).toBeNull();
      expect(result.timedOut).toBeUndefined();
      expect(result.stderr).toContain('Aborted');
    }, 15_000);

    it('aborts immediately when handed an already-aborted signal', async () => {
      writeFileSync(join(workspaceDir, 'hang.ts'), 'await new Promise(() => {})');
      const result = await executeScriptAction(
        action({ script: 'hang.ts', timeoutMs: 30_000 }),
        { workspaceRootPath: workspaceDir, env: {}, signal: AbortSignal.abort() },
      );
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Aborted');
    }, 15_000);
  });

  describe('page refresh recording', () => {
    it('records the outcome on page.json after the run', async () => {
      const pageDir = join(workspaceDir, 'pages', 'dash');
      mkdirSync(pageDir, { recursive: true });
      savePageConfig(workspaceDir, {
        schemaVersion: 1,
        id: 'page_test0001',
        slug: 'dash',
        name: 'Dash',
        kind: 'interactive',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      writeFileSync(join(workspaceDir, 'refresh.ts'), 'console.log("refreshed")');

      const result = await executeScriptAction(
        action({ script: 'refresh.ts', page: 'dash' }),
        ctx(),
      );
      expect(result.success).toBe(true);

      const config = loadPageConfig(workspaceDir, 'dash');
      expect(config?.lastRefresh?.ok).toBe(true);
      expect(config?.lastRefresh?.durationMs).toBeGreaterThanOrEqual(0);
      expect(config?.lastRefresh?.error).toBeUndefined();
    });

    it('records failures with the captured stderr', async () => {
      mkdirSync(join(workspaceDir, 'pages', 'dash'), { recursive: true });
      savePageConfig(workspaceDir, {
        schemaVersion: 1,
        id: 'page_test0002',
        slug: 'dash',
        name: 'Dash',
        kind: 'interactive',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      writeFileSync(join(workspaceDir, 'bad.ts'), 'console.error("kaput"); process.exit(1)');

      const result = await executeScriptAction(
        action({ script: 'bad.ts', page: 'dash' }),
        ctx(),
      );
      expect(result.success).toBe(false);

      const config = loadPageConfig(workspaceDir, 'dash');
      expect(config?.lastRefresh?.ok).toBe(false);
      expect(config?.lastRefresh?.error).toContain('kaput');
    });
  });

  describe('clampScriptTimeout', () => {
    it('defaults and clamps', () => {
      expect(clampScriptTimeout(undefined)).toBe(DEFAULT_SCRIPT_TIMEOUT_MS);
      expect(clampScriptTimeout(1)).toBe(1_000);
      expect(clampScriptTimeout(999_999_999)).toBe(MAX_SCRIPT_TIMEOUT_MS);
      expect(clampScriptTimeout(5_000)).toBe(5_000);
    });
  });

  describe('createScriptHistoryEntry', () => {
    it('builds the automations-history shape with error capping', () => {
      const entry = createScriptHistoryEntry({
        matcherId: 'abc123',
        result: {
          type: 'script',
          script: 'x.ts',
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'e'.repeat(5000),
          durationMs: 42,
          page: 'dash',
        },
      });
      expect(entry.id).toBe('abc123');
      expect(entry.ok).toBe(false);
      const script = entry.script as Record<string, unknown>;
      expect(script.script).toBe('x.ts');
      expect(script.page).toBe('dash');
      expect((script.error as string).length).toBeLessThanOrEqual(2000);
    });
  });

  describe('buildScriptEnv', () => {
    it('is CRAFT_*-only plus documented platform essentials', () => {
      process.env.CRAFT_TEST_PASSTHROUGH = 'yes';
      process.env.NOT_CRAFT_SECRET = 'no';
      try {
        const env = buildScriptEnv(
          'SchedulerTick',
          { workspaceId: 'ws', timestamp: 123, localTime: '10:00', utcTime: 't' } as never,
          { workspaceRootPath: workspaceDir, page: 'dash' },
        );
        expect(env.CRAFT_TEST_PASSTHROUGH).toBe('yes');
        expect(env.NOT_CRAFT_SECRET).toBeUndefined();
        expect(env.CRAFT_EVENT).toBe('SchedulerTick');
        expect(env.CRAFT_WORKSPACE_PATH).toBe(workspaceDir);
        expect(env.CRAFT_PAGE_SLUG).toBe('dash');
        expect(env.CRAFT_PAGE_DIR).toBe(join(workspaceDir, 'pages', 'dash'));
        expect(env.CRAFT_PAGE_DATA_DIR).toBe(join(workspaceDir, 'pages', 'dash', 'data'));
        expect(env.PATH).toBeUndefined();
        // Every key is CRAFT_* or a documented essential
        const essentials = new Set(IS_WINDOWS
          ? ['USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']
          : ['HOME']);
        for (const key of Object.keys(env)) {
          expect(key.startsWith('CRAFT_') || essentials.has(key)).toBe(true);
        }
      } finally {
        delete process.env.CRAFT_TEST_PASSTHROUGH;
        delete process.env.NOT_CRAFT_SECRET;
      }
    });
  });
});
