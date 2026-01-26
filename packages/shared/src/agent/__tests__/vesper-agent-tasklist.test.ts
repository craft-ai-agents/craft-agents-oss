/**
 * Integration tests for VesperAgent task list ID injection
 *
 * These tests verify that VesperAgent correctly injects the CLAUDE_CODE_TASK_LIST_ID
 * environment variable for multi-agent workflow coordination. The env var must be set
 * per-session to prevent cross-contamination between concurrent agent sessions.
 *
 * Key behaviors tested:
 * - setTaskListId() updates internal state
 * - chat() injects CLAUDE_CODE_TASK_LIST_ID env var when taskListId is set
 * - chat() does not inject env var when taskListId is undefined
 * - Per-session isolation (multiple agents don't contaminate each other)
 * - Env var persists across multiple chat() calls
 * - Integration with setAnthropicOptionsEnv()
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { VesperAgent } from '../vesper-agent.ts';
import { setAnthropicOptionsEnv, getDefaultOptions } from '../options.ts';
import type { VesperAgentConfig } from '../vesper-agent.ts';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// Mock the query function from the SDK to capture env vars without making API calls
let capturedEnv: Record<string, string> | null = null;
let mockQueryCallCount = 0;

// Mock the entire SDK module
mock.module('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: (params: any) => {
      mockQueryCallCount++;
      // Capture the env vars that were set before query() was called
      capturedEnv = { ...getDefaultOptions().env } as Record<string, string>;

      // Return a mock async generator that yields properly formatted events
      return (async function* () {
        // Yield a result message with proper structure to avoid VesperAgent errors
        yield {
          type: 'result',
          subtype: undefined,
          result: {
            output: 'Mock response',
            modelUsage: {
              inputTokens: 10,
              outputTokens: 5,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
              contextWindow: 200000,
            },
          },
          // Include usage field to prevent undefined errors in VesperAgent
          usage: {
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            input_tokens: 10,
            output_tokens: 5,
          },
        };
      })();
    },
    // Mock other exports as needed
    AbortReason: {
      UserAborted: 'UserAborted' as const,
      Interrupted: 'Interrupted' as const,
      SessionExpired: 'SessionExpired' as const,
      InactivityTimeout: 'InactivityTimeout' as const,
    },
  };
});

/**
 * Helper to create a minimal VesperAgent config for testing
 */
function createTestConfig(workspaceId: string = 'test-workspace'): VesperAgentConfig {
  const testDir = join(tmpdir(), `vesper-test-${Date.now()}-${Math.random()}`);
  mkdirSync(testDir, { recursive: true });

  return {
    workspace: {
      id: workspaceId,
      name: 'Test Workspace',
      rootPath: testDir,
    },
    session: {
      id: `session-${Date.now()}`,
      workspaceId,
      name: 'Test Session',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: 'claude-opus-4-5',
      thinkingLevel: 'think',
      permissionMode: 'ask',
      defaultCwd: testDir,
    },
    claudeApiKey: 'test-api-key',
    onEvent: async () => {},
  };
}

/**
 * Reset test state before each test
 */
function resetTestState() {
  capturedEnv = null;
  mockQueryCallCount = 0;
  // Clear the options env to ensure clean state
  setAnthropicOptionsEnv({});
  // Clear any existing CLAUDE_CODE_TASK_LIST_ID from process.env
  // This is important because the env var might be set by the parent process
  delete process.env.CLAUDE_CODE_TASK_LIST_ID;
}

describe('VesperAgent task list injection', () => {
  let testDirs: string[] = [];

  beforeEach(() => {
    resetTestState();
  });

  afterEach(() => {
    // Clean up test directories
    for (const dir of testDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        // Ignore cleanup errors
      }
    }
    testDirs = [];
    resetTestState();
  });

  describe('setTaskListId() method', () => {
    it('should update internal task list ID state', () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      // Set a task list ID
      agent.setTaskListId('task-list-123');

      // Verify internal state (we'll confirm via chat() injection)
      // Note: currentTaskListId is private, so we test via side effects
      expect(agent).toBeDefined();
    });

    it('should accept undefined to clear task list ID', () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      // Set and then clear
      agent.setTaskListId('task-list-123');
      agent.setTaskListId(undefined);

      expect(agent).toBeDefined();
    });

    it('should accept string task list IDs', () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      agent.setTaskListId('custom-id');
      agent.setTaskListId('another-id');
      agent.setTaskListId('');

      expect(agent).toBeDefined();
    });
  });

  describe('chat() method env var injection', () => {
    it('should inject CLAUDE_CODE_TASK_LIST_ID when taskListId is set', async () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      // Set task list ID before chatting
      agent.setTaskListId('test-task-list-456');

      // Trigger chat() to invoke setAnthropicOptionsEnv()
      const generator = agent.chat('Hello');

      // Consume the generator to trigger the query
      const events = [];
      for await (const event of generator) {
        events.push(event);
      }

      // Verify env var was injected
      expect(capturedEnv).toBeDefined();
      expect(capturedEnv?.CLAUDE_CODE_TASK_LIST_ID).toBe('test-task-list-456');
      expect(mockQueryCallCount).toBe(1);
    });

    it('should not inject env var when taskListId is undefined', async () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      // Don't set task list ID (default is undefined)
      // Trigger chat()
      const generator = agent.chat('Hello');

      const events = [];
      for await (const event of generator) {
        events.push(event);
      }

      // Verify env var was NOT set
      expect(capturedEnv).toBeDefined();
      expect(capturedEnv?.CLAUDE_CODE_TASK_LIST_ID).toBeUndefined();
      expect(mockQueryCallCount).toBe(1);
    });

    it('should not inject env var after clearing taskListId', async () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      // Set and then clear
      agent.setTaskListId('task-list-789');
      agent.setTaskListId(undefined);

      // Trigger chat()
      const generator = agent.chat('Hello');

      const events = [];
      for await (const event of generator) {
        events.push(event);
      }

      // Verify env var was NOT set
      expect(capturedEnv).toBeDefined();
      expect(capturedEnv?.CLAUDE_CODE_TASK_LIST_ID).toBeUndefined();
      expect(mockQueryCallCount).toBe(1);
    });
  });

  describe('per-session isolation', () => {
    it('should not contaminate env vars between different agent instances', async () => {
      // Create two separate agents with different configs
      const config1 = createTestConfig('workspace-1');
      const config2 = createTestConfig('workspace-2');
      testDirs.push(config1.workspace.rootPath, config2.workspace.rootPath);

      const agent1 = new VesperAgent(config1);
      const agent2 = new VesperAgent(config2);

      // Set different task list IDs
      agent1.setTaskListId('agent-1-task-list');
      agent2.setTaskListId('agent-2-task-list');

      // Chat with agent1
      resetTestState(); // Clear captured state
      const gen1 = agent1.chat('Agent 1 message');
      for await (const event of gen1) {
        // Consume events
      }
      const agent1Env = capturedEnv?.CLAUDE_CODE_TASK_LIST_ID;

      // Chat with agent2
      resetTestState(); // Clear captured state
      const gen2 = agent2.chat('Agent 2 message');
      for await (const event of gen2) {
        // Consume events
      }
      const agent2Env = capturedEnv?.CLAUDE_CODE_TASK_LIST_ID;

      // Verify each agent used its own task list ID
      expect(agent1Env).toBe('agent-1-task-list');
      expect(agent2Env).toBe('agent-2-task-list');
    });

    it('should handle one agent with taskListId and another without', async () => {
      const config1 = createTestConfig('workspace-1');
      const config2 = createTestConfig('workspace-2');
      testDirs.push(config1.workspace.rootPath, config2.workspace.rootPath);

      const agent1 = new VesperAgent(config1);
      const agent2 = new VesperAgent(config2);

      // Only set task list ID for agent1
      agent1.setTaskListId('only-agent-1');
      // agent2 has no task list ID set

      // Chat with agent1
      resetTestState();
      const gen1 = agent1.chat('Agent 1 message');
      for await (const event of gen1) {
        // Consume events
      }
      const agent1Env = capturedEnv?.CLAUDE_CODE_TASK_LIST_ID;

      // Chat with agent2
      resetTestState();
      const gen2 = agent2.chat('Agent 2 message');
      for await (const event of gen2) {
        // Consume events
      }
      const agent2Env = capturedEnv?.CLAUDE_CODE_TASK_LIST_ID;

      // Verify agent1 has env var, agent2 does not
      expect(agent1Env).toBe('only-agent-1');
      expect(agent2Env).toBeUndefined();
    });
  });

  describe('env var persistence across chat() calls', () => {
    it('should inject same env var across multiple chat() invocations', async () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      agent.setTaskListId('persistent-task-list');

      // First chat
      resetTestState();
      const gen1 = agent.chat('First message');
      for await (const event of gen1) {
        // Consume events
      }
      const firstEnv = capturedEnv?.CLAUDE_CODE_TASK_LIST_ID;

      // Second chat (should use same task list ID)
      resetTestState();
      const gen2 = agent.chat('Second message');
      for await (const event of gen2) {
        // Consume events
      }
      const secondEnv = capturedEnv?.CLAUDE_CODE_TASK_LIST_ID;

      // Third chat
      resetTestState();
      const gen3 = agent.chat('Third message');
      for await (const event of gen3) {
        // Consume events
      }
      const thirdEnv = capturedEnv?.CLAUDE_CODE_TASK_LIST_ID;

      // All chats should use the same task list ID
      expect(firstEnv).toBe('persistent-task-list');
      expect(secondEnv).toBe('persistent-task-list');
      expect(thirdEnv).toBe('persistent-task-list');
    });

    it('should update env var when taskListId changes between chats', async () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      // First chat with initial task list ID
      agent.setTaskListId('first-task-list');
      resetTestState();
      const gen1 = agent.chat('First message');
      for await (const event of gen1) {
        // Consume events
      }
      const firstEnv = capturedEnv?.CLAUDE_CODE_TASK_LIST_ID;

      // Change task list ID and chat again
      agent.setTaskListId('second-task-list');
      resetTestState();
      const gen2 = agent.chat('Second message');
      for await (const event of gen2) {
        // Consume events
      }
      const secondEnv = capturedEnv?.CLAUDE_CODE_TASK_LIST_ID;

      // Clear task list ID and chat again
      agent.setTaskListId(undefined);
      resetTestState();
      const gen3 = agent.chat('Third message');
      for await (const event of gen3) {
        // Consume events
      }
      const thirdEnv = capturedEnv?.CLAUDE_CODE_TASK_LIST_ID;

      // Each chat should reflect the current task list ID
      expect(firstEnv).toBe('first-task-list');
      expect(secondEnv).toBe('second-task-list');
      expect(thirdEnv).toBeUndefined();
    });
  });

  describe('integration with setAnthropicOptionsEnv()', () => {
    it('should merge task list env var with other env vars', async () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      agent.setTaskListId('merge-test');

      // Trigger chat()
      const generator = agent.chat('Hello');
      for await (const event of generator) {
        // Consume events
      }

      // Verify both CLAUDE_CODE_TASK_LIST_ID and other env vars are present
      expect(capturedEnv).toBeDefined();
      expect(capturedEnv?.CLAUDE_CODE_TASK_LIST_ID).toBe('merge-test');
      // VESPER_DEBUG should also be present from getDefaultOptions()
      expect(capturedEnv?.VESPER_DEBUG).toBeDefined();
    });

    it('should handle empty string task list ID', async () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      // Edge case: empty string
      agent.setTaskListId('');

      const generator = agent.chat('Hello');
      for await (const event of generator) {
        // Consume events
      }

      // Empty string should be treated as falsy (no env var set)
      expect(capturedEnv).toBeDefined();
      expect(capturedEnv?.CLAUDE_CODE_TASK_LIST_ID).toBeUndefined();
    });
  });

  describe('error scenarios', () => {
    it('should handle chat() without prior setTaskListId() call', async () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      // Don't call setTaskListId() at all
      const generator = agent.chat('Hello');

      // Should not throw
      const events = [];
      for await (const event of generator) {
        events.push(event);
      }

      // Should work fine, just no task list env var
      expect(capturedEnv).toBeDefined();
      expect(capturedEnv?.CLAUDE_CODE_TASK_LIST_ID).toBeUndefined();
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle rapid setTaskListId() calls before chat()', () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      // Rapid updates (only last one should matter)
      agent.setTaskListId('id-1');
      agent.setTaskListId('id-2');
      agent.setTaskListId('id-3');
      agent.setTaskListId('final-id');

      expect(agent).toBeDefined();
      // Actual behavior will be tested in chat() injection test
    });

    it('should handle special characters in task list ID', async () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      // Task list IDs with special characters
      agent.setTaskListId('task-list-with-dashes-123');

      const generator = agent.chat('Hello');
      for await (const event of generator) {
        // Consume events
      }

      expect(capturedEnv?.CLAUDE_CODE_TASK_LIST_ID).toBe('task-list-with-dashes-123');
    });

    it('should handle very long task list IDs', async () => {
      const config = createTestConfig();
      testDirs.push(config.workspace.rootPath);
      const agent = new VesperAgent(config);

      const longId = 'task-list-' + 'x'.repeat(1000);
      agent.setTaskListId(longId);

      const generator = agent.chat('Hello');
      for await (const event of generator) {
        // Consume events
      }

      expect(capturedEnv?.CLAUDE_CODE_TASK_LIST_ID).toBe(longId);
    });
  });
});
