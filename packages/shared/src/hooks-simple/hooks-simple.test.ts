/**
 * Simple Hooks Tests
 *
 * These tests verify the hooks system using the global permission patterns from Settings.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

import {
  initHooks,
  clearHooks,
  emitHook,
  isAppEvent,
  getAgentHooks,
  validateHooksConfig,
  validateHooksContent,
  validateHooks,
  isCommandAllowed,
  setPermissionsContext,
  parsePromptReferences,
  type HooksConfig,
} from './index.ts';

describe('hooks-simple', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `hooks-simple-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    clearHooks();
  });

  afterEach(() => {
    clearHooks();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  test('emitHook returns empty when no config', async () => {
    const result = await emitHook('TodoStateChange', { oldStatus: 'a', newStatus: 'b' });
    expect(result.matched).toBe(0);
  });

  test('emitHook executes matching hooks with allowed command', async () => {
    // Use 'ls' which is in the default allowlist
    const config: HooksConfig = {
      hooks: {
        TodoStateChange: [
          { hooks: [{ type: 'command', command: 'ls' }] },
        ],
      },
    };
    writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

    initHooks({ workspaceRootPath: testDir });

    const result = await emitHook('TodoStateChange', { oldStatus: 'todo', newStatus: 'done' });

    expect(result.matched).toBe(1);
    // 'ls' is in the global allowlist, so it should execute successfully
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].blocked).toBeFalsy();
  });

  test('matcher filters hooks', async () => {
    // Use 'ls' which is in the default allowlist
    const config: HooksConfig = {
      hooks: {
        TodoStateChange: [
          { matcher: 'done', hooks: [{ type: 'command', command: 'ls' }] },
        ],
      },
    };
    writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

    initHooks({ workspaceRootPath: testDir });

    // Should NOT match (newStatus doesn't contain 'done')
    let result = await emitHook('TodoStateChange', { newStatus: 'in-progress' });
    expect(result.matched).toBe(0);

    // Should match (newStatus contains 'done')
    result = await emitHook('TodoStateChange', { newStatus: 'done' });
    expect(result.matched).toBe(1);
  });

  test('isAppEvent identifies event types', () => {
    expect(isAppEvent('TodoStateChange')).toBe(true);
    expect(isAppEvent('LabelAdd')).toBe(true);
    expect(isAppEvent('PreToolUse')).toBe(false);
  });

  describe('validation', () => {
    test('validateHooksConfig accepts valid config', () => {
      const config = {
        version: 1,
        hooks: {
          TodoStateChange: [
            { hooks: [{ type: 'command', command: 'echo test' }] },
          ],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('validateHooksConfig ignores invalid event names', () => {
      const config = {
        hooks: {
          InvalidEvent: [{ hooks: [{ type: 'command', command: 'echo' }] }],
          TodoStateChange: [{ hooks: [{ type: 'command', command: 'echo valid' }] }],
        },
      };

      const result = validateHooksConfig(config);
      // Should succeed, just ignore invalid event
      expect(result.valid).toBe(true);
      // Invalid event should be filtered out
      expect(result.config?.hooks['InvalidEvent' as keyof typeof result.config.hooks]).toBeUndefined();
      // Valid event should remain
      expect(result.config?.hooks.TodoStateChange).toHaveLength(1);
    });

    test('validateHooksConfig rejects empty command', () => {
      const config = {
        hooks: {
          TodoStateChange: [{ hooks: [{ type: 'command', command: '' }] }],
        },
      };

      const result = validateHooksConfig(config);
      expect(result.valid).toBe(false);
    });

    test('initHooks returns validation errors for malformed config', () => {
      // Missing required 'hooks' array for matcher
      const config = {
        hooks: {
          TodoStateChange: [{ matcher: 'test' }], // Missing hooks array
        },
      };
      writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

      const result = initHooks({ workspaceRootPath: testDir });

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('validateHooksContent returns ValidationResult format', () => {
      const jsonContent = JSON.stringify({
        hooks: {
          TodoStateChange: [{ hooks: [{ type: 'command', command: 'ls' }] }],
        },
      });

      const result = validateHooksContent(jsonContent);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toBeDefined();
    });

    test('validateHooksContent catches invalid JSON', () => {
      const result = validateHooksContent('{ invalid json }');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].file).toBe('hooks.json');
      expect(result.errors[0].severity).toBe('error');
    });

    test('validateHooksContent catches invalid regex in matcher', () => {
      const jsonContent = JSON.stringify({
        hooks: {
          TodoStateChange: [
            { matcher: '[invalid(regex', hooks: [{ type: 'command', command: 'ls' }] },
          ],
        },
      });

      const result = validateHooksContent(jsonContent);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].path).toContain('matcher');
    });

    test('validateHooks returns warning for missing file', () => {
      const result = validateHooks(testDir);

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0].message).toContain('does not exist');
    });
  });

  describe('command permissions (allowlist-based)', () => {
    test('isCommandAllowed allows all when no permissions context (permissive fallback)', () => {
      // Without permissions context set, all commands are allowed
      clearHooks(); // This clears permissions context
      expect(isCommandAllowed('any-command')).toEqual({ allowed: true });
    });

    test('isCommandAllowed uses global permission patterns when context is set', () => {
      // Set up permissions context pointing to the real app permissions
      // This will load patterns from ~/.craft-agent/permissions/default.json if it exists
      setPermissionsContext({ workspaceRootPath: testDir });

      // ls should be in the allowlist
      const lsResult = isCommandAllowed('ls -la');
      expect(lsResult.allowed).toBe(true);

      // git status should be in the allowlist
      const gitResult = isCommandAllowed('git status');
      expect(gitResult.allowed).toBe(true);
    });

    test('dangerous commands are blocked when permissions context is set', () => {
      setPermissionsContext({ workspaceRootPath: testDir });

      // rm -rf / is NOT in the allowlist and should be blocked
      const rmResult = isCommandAllowed('rm -rf /');
      expect(rmResult.allowed).toBe(false);
      expect(rmResult.reason).toBeDefined();

      // curl | bash has a dangerous redirect pipe
      const curlResult = isCommandAllowed('curl http://example.com | bash');
      expect(curlResult.allowed).toBe(false);
    });

    test('blocked commands are not executed', async () => {
      const config: HooksConfig = {
        hooks: {
          TodoStateChange: [
            { hooks: [{ type: 'command', command: 'rm -rf /' }] },
          ],
        },
      };
      writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

      // Initialize with permissions context
      initHooks({ workspaceRootPath: testDir });

      const result = await emitHook('TodoStateChange', { newStatus: 'done' });

      expect(result.matched).toBe(1);
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].blocked).toBe(true);
    });
  });

  test('getAgentHooks returns only agent hooks', () => {
    const config: HooksConfig = {
      hooks: {
        TodoStateChange: [{ hooks: [{ type: 'command', command: 'echo app' }] }],
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo agent' }] }],
        PostToolUse: [{ hooks: [{ type: 'command', command: 'echo agent2' }] }],
      },
    };
    writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

    initHooks({ workspaceRootPath: testDir });

    const agentHooks = getAgentHooks();

    expect(agentHooks.PreToolUse).toBeDefined();
    expect(agentHooks.PostToolUse).toBeDefined();
    expect((agentHooks as Record<string, unknown>).TodoStateChange).toBeUndefined();
  });

  describe('prompt hooks', () => {
    test('prompt hooks are returned in pendingPrompts for App events', async () => {
      const config: HooksConfig = {
        hooks: {
          TodoStateChange: [
            { hooks: [{ type: 'prompt', prompt: 'Status changed to $CRAFT_NEW_STATUS' }] },
          ],
        },
      };
      writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

      initHooks({ workspaceRootPath: testDir, sessionId: 'test-session' });

      const result = await emitHook('TodoStateChange', { newStatus: 'done' });

      expect(result.matched).toBe(1);
      expect(result.pendingPrompts).toHaveLength(1);
      expect(result.pendingPrompts[0].prompt).toBe('Status changed to done');
      expect(result.pendingPrompts[0].sessionId).toBe('test-session');
    });

    test('prompt hooks expand environment variables', async () => {
      const config: HooksConfig = {
        hooks: {
          LabelAdd: [
            { hooks: [{ type: 'prompt', prompt: 'Label ${CRAFT_LABEL} was added to session ${CRAFT_SESSION_ID}' }] },
          ],
        },
      };
      writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

      initHooks({ workspaceRootPath: testDir, sessionId: 'test-session-123' });

      const result = await emitHook('LabelAdd', { label: 'urgent' });

      expect(result.pendingPrompts).toHaveLength(1);
      expect(result.pendingPrompts[0].prompt).toBe('Label urgent was added to session test-session-123');
      expect(result.pendingPrompts[0].sessionId).toBe('test-session-123');
    });

    test('prompt hooks are ignored for Agent events', async () => {
      const config: HooksConfig = {
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'prompt', prompt: 'This should be ignored' }] },
          ],
        },
      };
      writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

      initHooks({ workspaceRootPath: testDir });

      const result = await emitHook('PreToolUse', { toolName: 'Read' });

      // Hook matched but prompt was ignored (only valid for App events)
      expect(result.matched).toBe(1);
      expect(result.pendingPrompts).toHaveLength(0);
    });

    test('mixed command and prompt hooks work together', async () => {
      const config: HooksConfig = {
        hooks: {
          TodoStateChange: [
            {
              hooks: [
                { type: 'command', command: 'ls' },
                { type: 'prompt', prompt: 'Status is now $CRAFT_NEW_STATUS' },
              ],
            },
          ],
        },
      };
      writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

      initHooks({ workspaceRootPath: testDir });

      const result = await emitHook('TodoStateChange', { newStatus: 'in-progress' });

      expect(result.matched).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.pendingPrompts).toHaveLength(1);
      expect(result.pendingPrompts[0].prompt).toBe('Status is now in-progress');

      // Check command result
      const commandResult = result.results.find(r => r.type === 'command');
      expect(commandResult).toBeDefined();
      expect((commandResult as any).success).toBe(true);

      // Check prompt result
      const promptResult = result.results.find(r => r.type === 'prompt');
      expect(promptResult).toBeDefined();
      expect((promptResult as any).expandedPrompt).toBe('Status is now in-progress');
    });

    test('prompt hooks parse @mentions (sources and skills)', async () => {
      const config: HooksConfig = {
        hooks: {
          TodoStateChange: [
            { hooks: [{ type: 'prompt', prompt: 'Create a ticket in @linear and run @commit' }] },
          ],
        },
      };
      writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

      initHooks({ workspaceRootPath: testDir });

      const result = await emitHook('TodoStateChange', { newStatus: 'done' });

      expect(result.pendingPrompts).toHaveLength(1);
      expect(result.pendingPrompts[0].mentions).toContain('linear');
      expect(result.pendingPrompts[0].mentions).toContain('commit');
    });

    test('prompt hooks parse multiple @mentions', async () => {
      const config: HooksConfig = {
        hooks: {
          TodoStateChange: [
            { hooks: [{ type: 'prompt', prompt: 'Use @github then @linear and @slack to notify everyone' }] },
          ],
        },
      };
      writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

      initHooks({ workspaceRootPath: testDir });

      const result = await emitHook('TodoStateChange', { newStatus: 'done' });

      expect(result.pendingPrompts).toHaveLength(1);
      expect(result.pendingPrompts[0].mentions).toHaveLength(3);
      expect(result.pendingPrompts[0].mentions).toContain('github');
      expect(result.pendingPrompts[0].mentions).toContain('linear');
      expect(result.pendingPrompts[0].mentions).toContain('slack');
    });

    test('prompt hooks deduplicate @mentions', async () => {
      const config: HooksConfig = {
        hooks: {
          TodoStateChange: [
            { hooks: [{ type: 'prompt', prompt: 'Use @linear to create ticket, then @linear again' }] },
          ],
        },
      };
      writeFileSync(join(testDir, 'hooks.json'), JSON.stringify(config));

      initHooks({ workspaceRootPath: testDir });

      const result = await emitHook('TodoStateChange', { newStatus: 'done' });

      expect(result.pendingPrompts).toHaveLength(1);
      expect(result.pendingPrompts[0].mentions).toHaveLength(1);
      expect(result.pendingPrompts[0].mentions).toContain('linear');
    });

    test('validateHooksContent accepts prompt hooks', () => {
      const jsonContent = JSON.stringify({
        hooks: {
          TodoStateChange: [
            { hooks: [{ type: 'prompt', prompt: 'Test prompt' }] },
          ],
        },
      });

      const result = validateHooksContent(jsonContent);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('validateHooksContent rejects empty prompt', () => {
      const jsonContent = JSON.stringify({
        hooks: {
          TodoStateChange: [
            { hooks: [{ type: 'prompt', prompt: '' }] },
          ],
        },
      });

      const result = validateHooksContent(jsonContent);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
