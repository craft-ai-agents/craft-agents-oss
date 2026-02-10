/**
 * Tests for CommandHandler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkspaceEventBus } from '../event-bus.ts';
import { CommandHandler } from './command-handler.ts';
import type { HooksConfigProvider, CommandHandlerOptions } from './types.ts';
import type { HookMatcher, HookEvent } from '../index.ts';

// Mock command-executor to avoid real shell execution
vi.mock('../command-executor.ts', () => ({
  executeCommand: vi.fn().mockResolvedValue({ success: true, stdout: 'ok', stderr: '', blocked: false }),
}));

import { executeCommand } from '../command-executor.ts';

const mockedExecuteCommand = vi.mocked(executeCommand);

// Helper to create a mock HooksConfigProvider
function createMockConfigProvider(matchersByEvent: Partial<Record<HookEvent, HookMatcher[]>> = {}): HooksConfigProvider {
  return {
    getConfig: () => ({ hooks: matchersByEvent }),
    getMatchersForEvent: (event: HookEvent) => matchersByEvent[event] ?? [],
  };
}

// Helper to create default options
function createOptions(overrides: Partial<CommandHandlerOptions> = {}): CommandHandlerOptions {
  return {
    workspaceRootPath: '/tmp/test-workspace',
    workingDir: '/tmp/test-workspace',
    activeSourceSlugs: [],
    ...overrides,
  };
}

describe('CommandHandler', () => {
  let bus: WorkspaceEventBus;

  beforeEach(() => {
    bus = new WorkspaceEventBus('test-workspace');
    vi.clearAllMocks();
  });

  afterEach(() => {
    bus.dispose();
  });

  describe('subscribe', () => {
    it('should subscribe to the event bus on construction and subscribe call', () => {
      const configProvider = createMockConfigProvider();
      const handler = new CommandHandler(createOptions(), configProvider);

      expect(bus.getHandlerCount()).toBe(0);
      handler.subscribe(bus);
      expect(bus.getHandlerCount()).toBe(1);

      handler.dispose();
    });
  });

  describe('event matching', () => {
    it('should execute command for matching LabelAdd event', async () => {
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          matcher: 'bug',
          hooks: [{ type: 'command', command: 'echo bug added' }],
        }],
      });

      const handler = new CommandHandler(createOptions(), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'bug',
      });

      expect(mockedExecuteCommand).toHaveBeenCalledTimes(1);
      expect(mockedExecuteCommand).toHaveBeenCalledWith('echo bug added', expect.objectContaining({
        timeout: 60000,
      }));

      handler.dispose();
    });

    it('should execute command for matching PreToolUse event', async () => {
      const configProvider = createMockConfigProvider({
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo tool used' }],
        }],
      });

      const handler = new CommandHandler(createOptions(), configProvider);
      handler.subscribe(bus);

      await bus.emit('PreToolUse', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        data: { tool_name: 'Bash' },
      });

      expect(mockedExecuteCommand).toHaveBeenCalledTimes(1);

      handler.dispose();
    });

    it('should execute command for matching TodoStateChange event', async () => {
      const configProvider = createMockConfigProvider({
        TodoStateChange: [{
          matcher: 'done',
          hooks: [{ type: 'command', command: 'echo state changed' }],
        }],
      });

      const handler = new CommandHandler(createOptions(), configProvider);
      handler.subscribe(bus);

      await bus.emit('TodoStateChange', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        oldState: 'in_progress',
        newState: 'done',
      });

      expect(mockedExecuteCommand).toHaveBeenCalledTimes(1);

      handler.dispose();
    });

    it('should not execute command for non-matching events', async () => {
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          matcher: 'bug',
          hooks: [{ type: 'command', command: 'echo bug added' }],
        }],
      });

      const handler = new CommandHandler(createOptions(), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'feature',
      });

      expect(mockedExecuteCommand).not.toHaveBeenCalled();

      handler.dispose();
    });

    it('should not execute for events with no matchers configured', async () => {
      const configProvider = createMockConfigProvider({});

      const handler = new CommandHandler(createOptions(), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'bug',
      });

      expect(mockedExecuteCommand).not.toHaveBeenCalled();

      handler.dispose();
    });

    it('should skip prompt hooks and only execute command hooks', async () => {
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [
            { type: 'prompt', prompt: 'do something' },
            { type: 'command', command: 'echo hello' },
          ],
        }],
      });

      const handler = new CommandHandler(createOptions(), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(mockedExecuteCommand).toHaveBeenCalledTimes(1);
      expect(mockedExecuteCommand).toHaveBeenCalledWith('echo hello', expect.any(Object));

      handler.dispose();
    });
  });

  describe('command execution', () => {
    it('should use custom timeout when specified', async () => {
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [{ type: 'command', command: 'echo test', timeout: 5000 }],
        }],
      });

      const handler = new CommandHandler(createOptions(), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(mockedExecuteCommand).toHaveBeenCalledWith('echo test', expect.objectContaining({
        timeout: 5000,
      }));

      handler.dispose();
    });

    it('should pass permissionMode from matcher to executeCommand', async () => {
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          permissionMode: 'safe',
          hooks: [{ type: 'command', command: 'echo safe' }],
        }],
      });

      const handler = new CommandHandler(createOptions(), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(mockedExecuteCommand).toHaveBeenCalledWith('echo safe', expect.objectContaining({
        permissionMode: 'safe',
      }));

      handler.dispose();
    });

    it('should execute multiple commands in parallel', async () => {
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [
            { type: 'command', command: 'echo first' },
            { type: 'command', command: 'echo second' },
          ],
        }],
      });

      const handler = new CommandHandler(createOptions(), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(mockedExecuteCommand).toHaveBeenCalledTimes(2);
      expect(mockedExecuteCommand).toHaveBeenCalledWith('echo first', expect.any(Object));
      expect(mockedExecuteCommand).toHaveBeenCalledWith('echo second', expect.any(Object));

      handler.dispose();
    });
  });

  describe('onError callback', () => {
    it('should call onError when command execution throws', async () => {
      const error = new Error('execution failed');
      mockedExecuteCommand.mockRejectedValueOnce(error);

      const onError = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [{ type: 'command', command: 'failing-command' }],
        }],
      });

      const handler = new CommandHandler(createOptions({ onError }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(onError).toHaveBeenCalledWith('LabelAdd', error);

      handler.dispose();
    });
  });

  describe('dispose', () => {
    it('should unsubscribe from the event bus', () => {
      const configProvider = createMockConfigProvider();
      const handler = new CommandHandler(createOptions(), configProvider);

      handler.subscribe(bus);
      expect(bus.getHandlerCount()).toBe(1);

      handler.dispose();
      expect(bus.getHandlerCount()).toBe(0);
    });

    it('should not process events after disposal', async () => {
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [{ type: 'command', command: 'echo test' }],
        }],
      });

      const handler = new CommandHandler(createOptions(), configProvider);
      handler.subscribe(bus);
      handler.dispose();

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(mockedExecuteCommand).not.toHaveBeenCalled();
    });
  });
});
