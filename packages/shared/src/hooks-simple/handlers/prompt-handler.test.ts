/**
 * Tests for PromptHandler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkspaceEventBus } from '../event-bus.ts';
import { PromptHandler } from './prompt-handler.ts';
import type { HooksConfigProvider, PromptHandlerOptions } from './types.ts';
import type { HookMatcher, HookEvent, PendingPrompt } from '../index.ts';

// Helper to create a mock HooksConfigProvider
function createMockConfigProvider(matchersByEvent: Partial<Record<HookEvent, HookMatcher[]>> = {}): HooksConfigProvider {
  return {
    getConfig: () => ({ hooks: matchersByEvent }),
    getMatchersForEvent: (event: HookEvent) => matchersByEvent[event] ?? [],
  };
}

// Helper to create default options
function createOptions(overrides: Partial<PromptHandlerOptions> = {}): PromptHandlerOptions {
  return {
    workspaceId: 'test-workspace',
    sessionId: 'test-session',
    ...overrides,
  };
}

describe('PromptHandler', () => {
  let bus: WorkspaceEventBus;

  beforeEach(() => {
    bus = new WorkspaceEventBus('test-workspace');
  });

  afterEach(() => {
    bus.dispose();
  });

  describe('matcher matching for app events', () => {
    it('should process prompt hooks for matching LabelAdd event', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          matcher: 'bug',
          hooks: [{ type: 'prompt', prompt: 'A bug label was added' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'bug',
      });

      expect(onPromptsReady).toHaveBeenCalledTimes(1);
      const prompts: PendingPrompt[] = onPromptsReady.mock.calls[0]![0];
      expect(prompts).toHaveLength(1);
      expect(prompts[0]!.prompt).toBe('A bug label was added');
      expect(prompts[0]!.sessionId).toBe('test-session');

      handler.dispose();
    });

    it('should process prompt hooks for PermissionModeChange', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        PermissionModeChange: [{
          matcher: 'safe',
          hooks: [{ type: 'prompt', prompt: 'Mode changed to safe' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('PermissionModeChange', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        oldMode: 'ask',
        newMode: 'safe',
      });

      expect(onPromptsReady).toHaveBeenCalledTimes(1);

      handler.dispose();
    });

    it('should not call onPromptsReady for non-matching events', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          matcher: 'bug',
          hooks: [{ type: 'prompt', prompt: 'Bug detected' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'feature',
      });

      expect(onPromptsReady).not.toHaveBeenCalled();

      handler.dispose();
    });
  });

  describe('agent events are ignored', () => {
    it('should not process prompts for PreToolUse (agent event)', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        PreToolUse: [{
          hooks: [{ type: 'prompt', prompt: 'Should not fire' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('PreToolUse', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        data: { tool_name: 'Bash' },
      });

      expect(onPromptsReady).not.toHaveBeenCalled();

      handler.dispose();
    });

    it('should not process prompts for SessionStart (agent event)', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        SessionStart: [{
          hooks: [{ type: 'prompt', prompt: 'Should not fire' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('SessionStart', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        data: {},
      });

      expect(onPromptsReady).not.toHaveBeenCalled();

      handler.dispose();
    });

    it('should not process prompts for PostToolUse (agent event)', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        PostToolUse: [{
          hooks: [{ type: 'prompt', prompt: 'Should not fire' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('PostToolUse', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        data: {},
      });

      expect(onPromptsReady).not.toHaveBeenCalled();

      handler.dispose();
    });
  });

  describe('environment variable expansion', () => {
    it('should expand $VAR syntax in prompt text', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [{ type: 'prompt', prompt: 'Label $CRAFT_LABEL was added' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'urgent',
      });

      expect(onPromptsReady).toHaveBeenCalledTimes(1);
      const prompts: PendingPrompt[] = onPromptsReady.mock.calls[0]![0];
      expect(prompts[0]!.prompt).toContain('urgent');

      handler.dispose();
    });

    it('should expand ${VAR} syntax in prompt text', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [{ type: 'prompt', prompt: 'Label ${CRAFT_LABEL} was added to ${CRAFT_WORKSPACE_ID}' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'priority',
      });

      expect(onPromptsReady).toHaveBeenCalledTimes(1);
      const prompts: PendingPrompt[] = onPromptsReady.mock.calls[0]![0];
      expect(prompts[0]!.prompt).toContain('priority');
      expect(prompts[0]!.prompt).toContain('test-workspace');

      handler.dispose();
    });
  });

  describe('@mention parsing and deduplication', () => {
    it('should parse @mentions from prompt text', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [{ type: 'prompt', prompt: 'Please @linear check for issues and @github create a PR' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(onPromptsReady).toHaveBeenCalledTimes(1);
      const prompts: PendingPrompt[] = onPromptsReady.mock.calls[0]![0];
      expect(prompts[0]!.mentions).toContain('linear');
      expect(prompts[0]!.mentions).toContain('github');

      handler.dispose();
    });

    it('should deduplicate @mentions', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [{ type: 'prompt', prompt: '@linear do X then @linear do Y' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(onPromptsReady).toHaveBeenCalledTimes(1);
      const prompts: PendingPrompt[] = onPromptsReady.mock.calls[0]![0];
      const linearMentions = prompts[0]!.mentions.filter(m => m === 'linear');
      expect(linearMentions).toHaveLength(1);

      handler.dispose();
    });
  });

  describe('onPromptsReady callback', () => {
    it('should deliver multiple prompts from a single event', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [
          {
            hooks: [{ type: 'prompt', prompt: 'First prompt' }],
          },
          {
            hooks: [{ type: 'prompt', prompt: 'Second prompt' }],
          },
        ],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(onPromptsReady).toHaveBeenCalledTimes(1);
      const prompts: PendingPrompt[] = onPromptsReady.mock.calls[0]![0];
      expect(prompts).toHaveLength(2);
      expect(prompts[0]!.prompt).toBe('First prompt');
      expect(prompts[1]!.prompt).toBe('Second prompt');

      handler.dispose();
    });

    it('should not call onPromptsReady if no prompt hooks match', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [{ type: 'command', command: 'echo hello' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(onPromptsReady).not.toHaveBeenCalled();

      handler.dispose();
    });

    it('should pass labels from matcher to pending prompts', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          labels: ['auto-created', 'from-hook'],
          hooks: [{ type: 'prompt', prompt: 'Do something' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(onPromptsReady).toHaveBeenCalledTimes(1);
      const prompts: PendingPrompt[] = onPromptsReady.mock.calls[0]![0];
      expect(prompts[0]!.labels).toEqual(['auto-created', 'from-hook']);

      handler.dispose();
    });
  });

  describe('dispose', () => {
    it('should unsubscribe from the event bus', () => {
      const configProvider = createMockConfigProvider();
      const handler = new PromptHandler(createOptions(), configProvider);

      handler.subscribe(bus);
      expect(bus.getHandlerCount()).toBe(1);

      handler.dispose();
      expect(bus.getHandlerCount()).toBe(0);
    });

    it('should not process events after disposal', async () => {
      const onPromptsReady = vi.fn();
      const configProvider = createMockConfigProvider({
        LabelAdd: [{
          hooks: [{ type: 'prompt', prompt: 'Should not fire' }],
        }],
      });

      const handler = new PromptHandler(createOptions({ onPromptsReady }), configProvider);
      handler.subscribe(bus);
      handler.dispose();

      await bus.emit('LabelAdd', {
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test',
      });

      expect(onPromptsReady).not.toHaveBeenCalled();
    });
  });
});
