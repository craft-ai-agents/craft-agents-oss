/**
 * Tests for ClaudeEventAdapter
 *
 * Tests the SDK message → AgentEvent conversion extracted from ClaudeAgent.
 * Each test provides mock SDKMessage objects and verifies the AgentEvents produced.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { ClaudeEventAdapter, buildWindowsSkillsDirError, type ClaudeAdapterCallbacks } from '../backend/claude/event-adapter.ts';
import type { AgentEvent } from '@craft-agent/core/types';

// Helper: create default callbacks
function createCallbacks(overrides?: Partial<ClaudeAdapterCallbacks>): ClaudeAdapterCallbacks {
  return {
    onDebug: undefined,
    mapSDKError: async (errorCode) => ({
      type: 'typed_error' as const,
      error: {
        code: 'unknown_error',
        title: 'Test Error',
        message: `Mock error for ${errorCode}`,
        details: [],
        actions: [],
        canRetry: false,
      },
    }),
    ...overrides,
  };
}

describe('ClaudeEventAdapter', () => {
  let adapter: ClaudeEventAdapter;

  beforeEach(() => {
    adapter = new ClaudeEventAdapter(createCallbacks());
    adapter.startTurn();
  });

  describe('stream_event: message_start', () => {
    it('should capture turn ID from message_start', async () => {
      const events = await adapter.adapt({
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: { id: 'msg-123' },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
      } as any);

      // No events emitted for message_start itself
      expect(events).toHaveLength(0);

      // Subsequent events should include the turn ID
      const textEvents = await adapter.adapt({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hello' },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
      } as any);

      expect(textEvents).toHaveLength(1);
      expect(textEvents[0]).toMatchObject({
        type: 'text_delta',
        text: 'hello',
        turnId: 'msg-123',
      });
    });
  });

  describe('stream_event: text_delta', () => {
    it('should emit text_delta for content_block_delta', async () => {
      const events = await adapter.adapt({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello world' },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_delta',
        text: 'Hello world',
      });
    });

    it('should include parentToolUseId from SDK message', async () => {
      const events = await adapter.adapt({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'nested' },
        },
        parent_tool_use_id: 'task-001',
        session_id: 'sess-1',
      } as any);

      expect(events[0]).toMatchObject({
        type: 'text_delta',
        parentToolUseId: 'task-001',
      });
    });
  });

  describe('stream_event: message_delta (text_complete)', () => {
    it('should emit text_complete when message_delta arrives with pending text', async () => {
      // First: assistant message sets pending text
      await adapter.adapt({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Final answer' }],
          usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      // Then: message_delta triggers text_complete
      const events = await adapter.adapt({
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
      } as any);

      const textComplete = events.find(e => e.type === 'text_complete');
      expect(textComplete).toBeDefined();
      expect(textComplete).toMatchObject({
        type: 'text_complete',
        text: 'Final answer',
        isIntermediate: false,
      });
    });

    it('should set isIntermediate=true when stop_reason is tool_use', async () => {
      await adapter.adapt({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Let me check...' }],
          usage: { input_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      const events = await adapter.adapt({
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
      } as any);

      const textComplete = events.find(e => e.type === 'text_complete');
      expect(textComplete).toMatchObject({
        isIntermediate: true,
      });
    });
  });

  describe('assistant message', () => {
    it('should skip replayed messages', async () => {
      const events = await adapter.adapt({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'replayed' }],
          usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: true,
      } as any);

      expect(events).toHaveLength(0);
    });

    it('should emit usage_update for non-sidechain messages', async () => {
      const events = await adapter.adapt({
        type: 'assistant',
        message: {
          content: [],
          usage: {
            input_tokens: 1000,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 200,
          },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      const usageEvent = events.find(e => e.type === 'usage_update');
      expect(usageEvent).toBeDefined();
      expect(usageEvent).toMatchObject({
        type: 'usage_update',
        usage: {
          inputTokens: 1700, // 1000 + 500 + 200
        },
      });
    });

    it('should not emit usage_update for sidechain messages', async () => {
      const events = await adapter.adapt({
        type: 'assistant',
        message: {
          content: [],
          usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: 'task-001', // sidechain
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      const usageEvent = events.find(e => e.type === 'usage_update');
      expect(usageEvent).toBeUndefined();
    });

    it('should handle SDK errors via callback', async () => {
      const events = await adapter.adapt({
        type: 'assistant',
        error: 'rate_limit',
        message: { content: [], usage: {} },
        parent_tool_use_id: null,
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'typed_error',
        error: {
          message: 'Mock error for rate_limit',
        },
      });
    });
  });

  describe('user message (tool results)', () => {
    it('should skip replayed user messages', async () => {
      const events = await adapter.adapt({
        type: 'user',
        tool_use_result: 'result data',
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: true,
      } as any);

      expect(events).toHaveLength(0);
    });
  });

  describe('tool_progress', () => {
    it('should emit task_progress with elapsed time', async () => {
      const events = await adapter.adapt({
        type: 'tool_progress',
        tool_use_id: 'tool-1',
        tool_name: 'Task',
        parent_tool_use_id: 'parent-1',
        elapsed_time_seconds: 5.2,
        session_id: 'sess-1',
      } as any);

      const progressEvent = events.find(e => e.type === 'task_progress');
      expect(progressEvent).toBeDefined();
      expect(progressEvent).toMatchObject({
        type: 'task_progress',
        toolUseId: 'parent-1', // Uses parent_tool_use_id
        elapsedSeconds: 5.2,
      });
    });

    it('should use tool_use_id when no parent', async () => {
      const events = await adapter.adapt({
        type: 'tool_progress',
        tool_use_id: 'tool-1',
        tool_name: 'Bash',
        parent_tool_use_id: null,
        elapsed_time_seconds: 1.0,
        session_id: 'sess-1',
      } as any);

      const progressEvent = events.find(e => e.type === 'task_progress');
      expect(progressEvent).toMatchObject({
        toolUseId: 'tool-1',
      });
    });
  });

  describe('result', () => {
    it('should emit complete with usage on success', async () => {
      const events = await adapter.adapt({
        type: 'result',
        subtype: 'success',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100,
        },
        total_cost_usd: 0.05,
        modelUsage: {
          'claude-opus': { contextWindow: 200000 },
        },
        session_id: 'sess-1',
      } as any);

      const completeEvent = events.find(e => e.type === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent).toMatchObject({
        type: 'complete',
        usage: {
          outputTokens: 500,
          costUsd: 0.05,
          contextWindow: 200000,
        },
      });
    });

    it('should emit error then complete on failure', async () => {
      const events = await adapter.adapt({
        type: 'result',
        subtype: 'error',
        errors: ['Something went wrong', 'Another error'],
        usage: {
          input_tokens: 100,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        total_cost_usd: 0.01,
        modelUsage: {},
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: 'error',
        message: 'Something went wrong, Another error',
      });
      expect(events[1]).toMatchObject({
        type: 'complete',
      });
    });

    it('should use lastAssistantUsage for accurate context display', async () => {
      // Send an assistant message first to capture per-message usage
      await adapter.adapt({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'test' }],
          usage: {
            input_tokens: 800,
            cache_read_input_tokens: 400,
            cache_creation_input_tokens: 100,
          },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      // Now send result — should use the per-message usage, not cumulative
      const events = await adapter.adapt({
        type: 'result',
        subtype: 'success',
        usage: {
          input_tokens: 5000, // cumulative (should be ignored)
          output_tokens: 1000,
          cache_read_input_tokens: 2000,
          cache_creation_input_tokens: 500,
        },
        total_cost_usd: 0.10,
        modelUsage: {},
        session_id: 'sess-1',
      } as any);

      const completeEvent = events.find(e => e.type === 'complete') as any;
      // Should use lastAssistantUsage (800+400+100=1300), not cumulative (5000+2000+500=7500)
      expect(completeEvent.usage.inputTokens).toBe(1300);
      expect(completeEvent.usage.cacheReadTokens).toBe(400);
      expect(completeEvent.usage.cacheCreationTokens).toBe(100);
    });
  });

  describe('system', () => {
    it('should capture sdkTools from init message', async () => {
      await adapter.adapt({
        type: 'system',
        subtype: 'init',
        tools: ['Read', 'Write', 'Bash'],
        session_id: 'sess-1',
      } as any);

      expect(adapter.sdkTools).toEqual(['Read', 'Write', 'Bash']);
    });

    it('should emit info for compact_boundary', async () => {
      const events = await adapter.adapt({
        type: 'system',
        subtype: 'compact_boundary',
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'info',
        message: 'Compacted Conversation',
      });
    });

    it('should emit status for compacting', async () => {
      const events = await adapter.adapt({
        type: 'system',
        subtype: 'status',
        status: 'compacting',
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Compacting conversation...',
      });
    });

    it('should emit task_completed for task_notification', async () => {
      adapter.startTurn();
      const events = await adapter.adapt({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'agent-abc123',
        status: 'completed',
        output_file: '/tmp/task-output.txt',
        summary: 'Found 3 matching files',
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'task_completed',
        taskId: 'agent-abc123',
        status: 'completed',
        outputFile: '/tmp/task-output.txt',
        summary: 'Found 3 matching files',
      });
    });

    it('should handle task_notification with failed status', async () => {
      adapter.startTurn();
      const events = await adapter.adapt({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'agent-xyz',
        status: 'failed',
        output_file: '/tmp/task-error.txt',
        summary: 'Task failed with error',
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'task_completed',
        taskId: 'agent-xyz',
        status: 'failed',
      });
    });

    it('should handle task_notification with stopped status', async () => {
      adapter.startTurn();
      const events = await adapter.adapt({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'agent-stopped',
        status: 'stopped',
        summary: 'User stopped the task',
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'task_completed',
        taskId: 'agent-stopped',
        status: 'stopped',
      });
    });

    it('should skip task_notification with missing task_id', async () => {
      adapter.startTurn();
      const events = await adapter.adapt({
        type: 'system',
        subtype: 'task_notification',
        // task_id intentionally missing
        status: 'completed',
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(0);
    });

    it('should default to completed for unknown task_notification status', async () => {
      adapter.startTurn();
      const events = await adapter.adapt({
        type: 'system',
        subtype: 'task_notification',
        task_id: 'agent-unknown',
        status: 'some_future_status',
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'task_completed',
        taskId: 'agent-unknown',
        status: 'completed', // defaults to completed for unknown statuses
      });
    });
  });

  describe('auth_status', () => {
    it('should emit error for auth errors', async () => {
      const events = await adapter.adapt({
        type: 'auth_status',
        error: 'token expired',
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'error',
        message: 'Auth error: token expired. Try running /auth to re-authenticate.',
      });
    });

    it('should not emit events when no auth error', async () => {
      const events = await adapter.adapt({
        type: 'auth_status',
        error: null,
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(0);
    });
  });

  describe('flushPending', () => {
    it('should flush pending text', async () => {
      // Set pending text via assistant message
      await adapter.adapt({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'unflushed text' }],
          usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      const flushed = adapter.flushPending();
      expect(flushed).toMatchObject({
        type: 'text_complete',
        text: 'unflushed text',
        isIntermediate: false,
      });

      // Second flush should return null
      expect(adapter.flushPending()).toBeNull();
    });

    it('should return null when nothing pending', () => {
      expect(adapter.flushPending()).toBeNull();
    });
  });

  describe('unknown message types', () => {
    it('should log and return empty for unknown types', async () => {
      const debugMessages: string[] = [];
      const adapter = new ClaudeEventAdapter(createCallbacks({
        onDebug: (msg) => debugMessages.push(msg),
      }));
      adapter.startTurn();

      const events = await adapter.adapt({
        type: 'unknown_type',
        session_id: 'sess-1',
      } as any);

      expect(events).toHaveLength(0);
      expect(debugMessages.some(m => m.includes('Unhandled SDK message type'))).toBe(true);
    });
  });

  describe('tool start dedup across stream + assistant messages', () => {
    it('should re-emit tool_start with complete input when assistant follows stream', async () => {
      // Stream event arrives first with content_block_start (empty input)
      const streamEvents = await adapter.adapt({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tool-dup-1', name: 'Read', input: {} },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
      } as any);

      const streamToolStarts = streamEvents.filter(e => e.type === 'tool_start');
      expect(streamToolStarts).toHaveLength(1);
      expect(streamToolStarts[0]).toMatchObject({ toolUseId: 'tool-dup-1', toolName: 'Read', input: {} });

      // Full assistant message arrives with same tool + complete input
      const assistantEvents = await adapter.adapt({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tool-dup-1', name: 'Read', input: { file_path: '/test' } }],
          usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      // Should re-emit with complete input (update mechanism for UI)
      const assistantToolStarts = assistantEvents.filter(e => e.type === 'tool_start');
      expect(assistantToolStarts).toHaveLength(1);
      expect(assistantToolStarts[0]).toMatchObject({
        toolUseId: 'tool-dup-1',
        toolName: 'Read',
        input: { file_path: '/test' },
      });
    });

    it('should not re-emit when assistant has no new input', async () => {
      // Stream with empty input
      await adapter.adapt({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tool-noinput-1', name: 'Read', input: {} },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
      } as any);

      // Assistant also has empty input (same as stream)
      const events = await adapter.adapt({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tool-noinput-1', name: 'Read', input: {} }],
          usage: { input_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      // No re-emit because input is still empty
      const toolStarts = events.filter(e => e.type === 'tool_start');
      expect(toolStarts).toHaveLength(0);
    });

    it('should handle multiple tools: re-emit known + emit new', async () => {
      // Stream for tool-a (empty input)
      await adapter.adapt({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'tool-a', name: 'Read', input: {} },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
      } as any);

      // Assistant with tool-a (complete input) + tool-b (new)
      const events = await adapter.adapt({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tool-a', name: 'Read', input: { file_path: '/a' } },
            { type: 'tool_use', id: 'tool-b', name: 'Grep', input: { pattern: 'x' } },
          ],
          usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      // tool-a re-emitted with complete input + tool-b is new
      const toolStarts = events.filter(e => e.type === 'tool_start');
      expect(toolStarts).toHaveLength(2);
      expect(toolStarts[0]).toMatchObject({ toolUseId: 'tool-a', input: { file_path: '/a' } });
      expect(toolStarts[1]).toMatchObject({ toolUseId: 'tool-b', input: { pattern: 'x' } });
    });
  });

  describe('activeParentTools lifecycle', () => {
    it('should track Task tools and remove them on result', async () => {
      // Task tool start via assistant message
      await adapter.adapt({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'task-parent-1', name: 'Task', input: { prompt: 'research' } }],
          usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      expect(adapter.getActiveParentTools().has('task-parent-1')).toBe(true);

      // Task tool result via user message
      await adapter.adapt({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'task-parent-1',
            content: 'Done',
          }],
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      expect(adapter.getActiveParentTools().has('task-parent-1')).toBe(false);
    });

    it('should reset activeParentTools on new turn', async () => {
      await adapter.adapt({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'task-reset-1', name: 'Task', input: {} }],
          usage: { input_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      expect(adapter.getActiveParentTools().size).toBe(1);

      adapter.startTurn();
      expect(adapter.getActiveParentTools().size).toBe(0);
    });
  });

  describe('toolIndex: tool_start → tool_result matching', () => {
    it('should match tool_result to previously started tool via toolIndex', async () => {
      // Step 1: tool_start via stream event
      await adapter.adapt({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          content_block: { type: 'tool_use', id: 'bash-1', name: 'Bash', input: {} },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
      } as any);

      // Step 2: assistant message confirms tool (deduped)
      await adapter.adapt({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'ls' } }],
          usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      // Step 3: user message with tool result
      const resultEvents = await adapter.adapt({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'bash-1',
            content: 'file1.txt\nfile2.txt',
          }],
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      const toolResult = resultEvents.find(e => e.type === 'tool_result');
      expect(toolResult).toBeDefined();
      expect(toolResult).toMatchObject({
        type: 'tool_result',
        toolUseId: 'bash-1',
        toolName: 'Bash',
      });
    });

    it('should handle full multi-tool sequence: start → result → start → result', async () => {
      // Tool 1 start
      await adapter.adapt({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Let me read the file.' },
            { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/test.ts' } },
          ],
          usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      // Tool 1 result
      const result1Events = await adapter.adapt({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'read-1',
            content: 'file contents here',
          }],
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      expect(result1Events.find(e => e.type === 'tool_result')).toMatchObject({
        toolUseId: 'read-1',
        toolName: 'Read',
      });

      // Tool 2 start
      await adapter.adapt({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Now let me search.' },
            { type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'TODO' } },
          ],
          usage: { input_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      // Tool 2 result
      const result2Events = await adapter.adapt({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'grep-1',
            content: 'found 3 matches',
          }],
        },
        parent_tool_use_id: null,
        session_id: 'sess-1',
        isReplay: false,
      } as any);

      expect(result2Events.find(e => e.type === 'tool_result')).toMatchObject({
        toolUseId: 'grep-1',
        toolName: 'Grep',
      });
    });
  });
});

describe('buildWindowsSkillsDirError', () => {
  it('should detect Windows ENOENT skills directory error', () => {
    const result = buildWindowsSkillsDirError(
      "ENOENT: no such file or directory, scandir 'C:\\ProgramData\\ClaudeCode\\.claude\\skills'"
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe('typed_error');
    expect(result!.error.title).toBe('Windows Setup Required');
    expect(result!.error.message).toContain('C:\\ProgramData\\ClaudeCode\\.claude\\skills');
  });

  it('should return null for non-matching errors', () => {
    expect(buildWindowsSkillsDirError('Connection refused')).toBeNull();
    expect(buildWindowsSkillsDirError('ENOENT: no such file, /tmp/other')).toBeNull();
  });
});
