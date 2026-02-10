/**
 * Tests for HookSystem.buildSdkHooks()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HookSystem } from './hook-system.ts';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock command-executor to avoid real shell execution
vi.mock('./command-executor.ts', () => ({
  executeCommand: vi.fn().mockResolvedValue({ success: true, stdout: 'ok', stderr: '', blocked: false }),
  resolvePermissionsConfig: vi.fn().mockReturnValue({}),
}));

import { executeCommand } from './command-executor.ts';
const mockedExecuteCommand = vi.mocked(executeCommand);

describe('HookSystem.buildSdkHooks', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `buildSdkHooks-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createSystem(hooks: Record<string, unknown>) {
    writeFileSync(join(testDir, 'hooks.json'), JSON.stringify({ hooks }));
    return new HookSystem({
      workspaceRootPath: testDir,
      workspaceId: 'test-workspace',
    });
  }

  it('should return empty object when no hooks.json exists', () => {
    const system = new HookSystem({
      workspaceRootPath: testDir,
      workspaceId: 'test-workspace',
    });
    const result = system.buildSdkHooks();
    expect(result).toEqual({});
    system.dispose();
  });

  it('should return empty object when no agent event hooks exist', () => {
    const system = createSystem({
      TodoStateChange: [{
        matcher: 'done',
        hooks: [{ type: 'command', command: 'echo done' }],
      }],
    });
    const result = system.buildSdkHooks();
    // TodoStateChange is an app event, not an agent event
    expect(result).toEqual({});
    system.dispose();
  });

  it('should build callbacks for PreToolUse event', () => {
    const system = createSystem({
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'echo pre-tool' }],
      }],
    });
    const result = system.buildSdkHooks();
    expect(result.PreToolUse).toBeDefined();
    expect(result.PreToolUse).toHaveLength(1);
    expect(result.PreToolUse![0]!.matcher).toBe('Bash');
    system.dispose();
  });

  it('should build callbacks for multiple agent event types', () => {
    const system = createSystem({
      PreToolUse: [{
        hooks: [{ type: 'command', command: 'echo pre' }],
      }],
      PostToolUse: [{
        hooks: [{ type: 'command', command: 'echo post' }],
      }],
    });
    const result = system.buildSdkHooks();
    expect(result.PreToolUse).toHaveLength(1);
    expect(result.PostToolUse).toHaveLength(1);
    system.dispose();
  });

  it('should filter out disabled matchers', () => {
    const system = createSystem({
      PreToolUse: [
        {
          enabled: false,
          hooks: [{ type: 'command', command: 'echo disabled' }],
        },
        {
          hooks: [{ type: 'command', command: 'echo enabled' }],
        },
      ],
    });
    const result = system.buildSdkHooks();
    expect(result.PreToolUse).toHaveLength(1);
    system.dispose();
  });

  it('should forward matcher pattern to SDK hook', () => {
    const system = createSystem({
      PreToolUse: [{
        matcher: 'Read|Write',
        hooks: [{ type: 'command', command: 'echo file-op' }],
      }],
    });
    const result = system.buildSdkHooks();
    expect(result.PreToolUse![0]!.matcher).toBe('Read|Write');
    system.dispose();
  });

  it('should execute command hooks and return continue: true', async () => {
    const system = createSystem({
      PreToolUse: [{
        hooks: [{ type: 'command', command: 'echo test' }],
      }],
    });
    const result = system.buildSdkHooks();
    const hookFn = result.PreToolUse![0]!.hooks[0]!;

    const hookResult = await hookFn(
      { tool_name: 'Bash' },
      'tool-use-123',
      { signal: undefined }
    );
    expect(hookResult).toEqual({ continue: true });
    expect(mockedExecuteCommand).toHaveBeenCalledTimes(1);
    system.dispose();
  });

  it('should set timeout to 30 for SDK hooks', () => {
    const system = createSystem({
      PreToolUse: [{
        hooks: [{ type: 'command', command: 'echo test' }],
      }],
    });
    const result = system.buildSdkHooks();
    expect(result.PreToolUse![0]!.timeout).toBe(30);
    system.dispose();
  });

  it('should pass permissionsContext to executeCommand', async () => {
    const system = createSystem({
      PreToolUse: [{
        permissionMode: 'safe',
        hooks: [{ type: 'command', command: 'echo safe' }],
      }],
    });
    const result = system.buildSdkHooks();
    const hookFn = result.PreToolUse![0]!.hooks[0]!;

    await hookFn({ tool_name: 'Bash' }, 'tool-use-123', { signal: undefined });

    expect(mockedExecuteCommand).toHaveBeenCalledWith('echo safe', expect.objectContaining({
      permissionMode: 'safe',
      permissionsContext: expect.objectContaining({
        workspaceRootPath: testDir,
      }),
    }));
    system.dispose();
  });

  it('should return continue: true when matcher has no command hooks', async () => {
    const system = createSystem({
      PreToolUse: [{
        hooks: [{ type: 'prompt', prompt: 'This is a prompt, not a command' }],
      }],
    });
    const result = system.buildSdkHooks();
    const hookFn = result.PreToolUse![0]!.hooks[0]!;

    const hookResult = await hookFn(
      { tool_name: 'Bash' },
      'tool-use-123',
      { signal: undefined }
    );
    expect(hookResult).toEqual({ continue: true });
    expect(mockedExecuteCommand).not.toHaveBeenCalled();
    system.dispose();
  });
});
