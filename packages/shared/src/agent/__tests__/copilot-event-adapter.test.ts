/**
 * Tests for CopilotEventAdapter
 *
 * Tests the Copilot SDK SessionEvent → AgentEvent conversion.
 * Each test provides mock SessionEvent objects and verifies the AgentEvents produced.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { CopilotEventAdapter } from '../backend/copilot/event-adapter.ts';

// Helper: collect all events from a generator
function collect(gen: Generator<any>): any[] {
  return [...gen];
}

describe('CopilotEventAdapter', () => {
  let adapter: CopilotEventAdapter;

  beforeEach(() => {
    adapter = new CopilotEventAdapter();
    adapter.startTurn();
  });

  describe('session lifecycle', () => {
    it('should emit nothing for session.start', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.start',
        data: {},
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should emit nothing for session.resume', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.resume',
        data: { eventCount: 5 },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should emit complete for session.idle', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.idle',
        data: {},
      } as any));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'complete' });
    });

    it('should emit typed_error for auth errors (401)', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.error',
        data: {
          errorType: 'authentication',
          message: 'Token expired',
          statusCode: 401,
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'typed_error',
        error: {
          code: 'invalid_credentials',
          title: 'Authentication Required',
        },
      });
    });

    it('should emit typed_error for rate limits (429)', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.error',
        data: {
          errorType: 'rate_limit',
          message: 'Too many requests',
          statusCode: 429,
        },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'typed_error',
        error: { code: 'rate_limited' },
      });
    });

    it('should emit typed_error for server errors (5xx)', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.error',
        data: {
          errorType: 'server',
          message: 'Internal error',
          statusCode: 500,
        },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'typed_error',
        error: { code: 'service_error' },
      });
    });

    it('should emit typed_error for network errors', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.error',
        data: {
          errorType: 'network',
          message: 'Connection refused',
        },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'typed_error',
        error: { code: 'network_error' },
      });
    });

    it('should emit plain error for unrecognized error types', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.error',
        data: {
          errorType: 'unknown',
          message: 'Something broke',
        },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'error',
        message: 'Something broke',
      });
    });

    it('should emit status for compaction_start', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.compaction_start',
        data: {},
      } as any));

      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Compacting context...',
      });
    });

    it('should emit info for successful compaction_complete', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.compaction_complete',
        data: {
          success: true,
          preCompactionTokens: 100000,
          postCompactionTokens: 50000,
        },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'info',
      });
      expect((events[0] as any).message).toContain('100000');
      expect((events[0] as any).message).toContain('50000');
    });

    it('should emit error for failed compaction', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.compaction_complete',
        data: { success: false, error: 'out of memory' },
      } as any));

      expect(events[0]).toMatchObject({ type: 'error' });
    });

    it('should emit usage_update for session.usage_info', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.usage_info',
        data: { currentTokens: 50000, tokenLimit: 200000 },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'usage_update',
        usage: { inputTokens: 50000, contextWindow: 200000 },
      });
    });

    it('should emit status for session.info', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.info',
        data: { message: 'Session info message' },
      } as any));
      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Session info message',
      });
    });

    it('should emit status for session.model_change', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.model_change',
        data: { newModel: 'gpt-4o' },
      } as any));
      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Model changed to gpt-4o',
      });
    });

    it('should emit status for session.truncation', () => {
      const events = collect(adapter.adaptEvent({
        type: 'session.truncation',
        data: { messagesRemovedDuringTruncation: 5 },
      } as any));
      expect(events[0]).toMatchObject({ type: 'status' });
      expect((events[0] as any).message).toContain('5 messages removed');
    });
  });

  describe('assistant events', () => {
    it('should capture turnId from assistant.turn_start', () => {
      collect(adapter.adaptEvent({
        type: 'assistant.turn_start',
        data: { turnId: 'turn-abc' },
      } as any));

      // Verify the turnId is used in subsequent events
      const events = collect(adapter.adaptEvent({
        type: 'assistant.message_delta',
        data: { deltaContent: 'hello' },
      } as any));

      // Sub-turnId includes __m0 suffix for message-block isolation
      expect(events[0]).toMatchObject({ turnId: 'turn-abc__m0' });
    });

    it('should emit text_delta for assistant.message_delta', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.message_delta',
        data: { deltaContent: 'Hello world' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_delta',
        text: 'Hello world',
      });
    });

    it('should include parentToolUseId in text_delta', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.message_delta',
        data: { deltaContent: 'nested', parentToolCallId: 'task-1' },
      } as any));

      expect(events[0]).toMatchObject({
        parentToolUseId: 'task-1',
      });
    });

    it('should skip empty deltas', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.message_delta',
        data: { deltaContent: '' },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should emit text_complete for assistant.message', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.message',
        data: { content: 'Full response text' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_complete',
        text: 'Full response text',
        isIntermediate: false,
      });
    });

    it('should set isIntermediate when parentToolCallId present', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.message',
        data: { content: 'subagent text', parentToolCallId: 'task-1' },
      } as any));

      expect(events[0]).toMatchObject({ isIntermediate: true });
    });

    it('should set isIntermediate when toolRequests present', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.message',
        data: { content: 'Let me check...', toolRequests: [{ id: 'tool-1' }] },
      } as any));

      expect(events[0]).toMatchObject({ isIntermediate: true });
    });

    it('should deduplicate identical intermediate text', () => {
      // First emission
      const events1 = collect(adapter.adaptEvent({
        type: 'assistant.message',
        data: { content: 'same text', parentToolCallId: 'task-1' },
      } as any));
      expect(events1).toHaveLength(1);

      // Reset the final text guard (simulating tool completion)
      // Emit a tool completion to reset hasEmittedFinalText
      collect(adapter.adaptEvent({
        type: 'tool.execution_complete',
        data: { toolCallId: 'task-1', success: true, result: { content: 'ok' } },
      } as any));

      // Same intermediate text again — should be skipped
      const events2 = collect(adapter.adaptEvent({
        type: 'assistant.message',
        data: { content: 'same text', parentToolCallId: 'task-2' },
      } as any));
      expect(events2).toHaveLength(0);
    });

    it('should not emit duplicate text_complete per turn', () => {
      // First message
      const events1 = collect(adapter.adaptEvent({
        type: 'assistant.message',
        data: { content: 'First response' },
      } as any));
      expect(events1).toHaveLength(1);

      // Second message in same turn — should be blocked by hasEmittedFinalText
      const events2 = collect(adapter.adaptEvent({
        type: 'assistant.message',
        data: { content: 'Duplicate response' },
      } as any));
      expect(events2).toHaveLength(0);
    });

    it('should suppress assistant.reasoning_delta', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.reasoning_delta',
        data: { deltaContent: 'I need to think...' },
      } as any));

      expect(events).toHaveLength(0);
    });

    it('should suppress assistant.reasoning', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.reasoning',
        data: { content: 'Full reasoning block' },
      } as any));

      expect(events).toHaveLength(0);
    });

    it('should suppress assistant.intent', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.intent',
        data: { intent: 'I will read the file' },
      } as any));

      expect(events).toHaveLength(0);
    });

    it('should emit usage_update for assistant.usage', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.usage',
        data: { inputTokens: 1000, cacheReadTokens: 500 },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'usage_update',
        usage: { inputTokens: 1500 },
      });
    });

    it('should not emit usage_update when tokens are zero', () => {
      const events = collect(adapter.adaptEvent({
        type: 'assistant.usage',
        data: { inputTokens: 0, cacheReadTokens: 0 },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should reset state on assistant.turn_end', () => {
      // Set up turn state
      collect(adapter.adaptEvent({
        type: 'assistant.turn_start',
        data: { turnId: 'turn-1' },
      } as any));
      collect(adapter.adaptEvent({
        type: 'assistant.message_delta',
        data: { deltaContent: 'hello' },
      } as any));

      // End turn
      collect(adapter.adaptEvent({
        type: 'assistant.turn_end',
        data: {},
      } as any));

      // Next message_delta should have fallback turnId (currentTurnId was cleared to null)
      const events = collect(adapter.adaptEvent({
        type: 'assistant.message_delta',
        data: { deltaContent: 'new turn' },
      } as any));
      expect(events[0].turnId).toBe('unknown__m0');
    });
  });

  describe('tool events', () => {
    it('should emit tool_start for tool.execution_start', () => {
      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: {
          toolCallId: 'tc-1',
          toolName: 'bash',
          arguments: { command: 'ls -la' },
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolName: 'Bash', // normalized from lowercase
        toolUseId: 'tc-1',
        input: { command: 'ls -la' },
      });
    });

    it('should normalize tool names from lowercase to PascalCase', () => {
      for (const [sdk, expected] of [
        ['bash', 'Bash'],
        ['read', 'Read'],
        ['write', 'Write'],
        ['edit', 'Edit'],
        ['glob', 'Glob'],
        ['grep', 'Grep'],
      ]) {
        const events = collect(adapter.adaptEvent({
          type: 'tool.execution_start',
          data: { toolCallId: `tc-${sdk}`, toolName: sdk, arguments: {} },
        } as any));
        expect(events[0].toolName).toBe(expected);
      }
    });

    it('should format MCP tool names as mcp__server__tool', () => {
      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: {
          toolCallId: 'tc-mcp',
          toolName: 'list_issues',
          mcpServerName: 'linear',
          mcpToolName: 'list_issues',
          arguments: {},
        },
      } as any));

      expect(events[0]).toMatchObject({
        toolName: 'mcp__linear__list_issues',
      });
    });

    it('should classify bash read commands as Read tool', () => {
      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: {
          toolCallId: 'tc-read',
          toolName: 'bash',
          arguments: { command: 'cat /src/file.ts' },
        },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolName: 'Read',
        input: { file_path: '/src/file.ts' },
      });
    });

    it('should include parentToolUseId', () => {
      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: {
          toolCallId: 'tc-1',
          toolName: 'bash',
          arguments: { command: 'echo hi' },
          parentToolCallId: 'parent-1',
        },
      } as any));

      expect(events[0]).toMatchObject({
        parentToolUseId: 'parent-1',
      });
    });

    it('should normalize Copilot path → file_path for Read/Write/Edit', () => {
      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: {
          toolCallId: 'tc-1',
          toolName: 'read',
          arguments: { path: '/src/file.ts' },
        },
      } as any));

      expect(events[0].input).toMatchObject({
        file_path: '/src/file.ts',
      });
      // Should not have duplicate `path` key
      expect(events[0].input.path).toBeUndefined();
    });

    it('should emit tool_result for tool.execution_complete', () => {
      // Start the tool first to register the name
      collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc-1', toolName: 'bash', arguments: {} },
      } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'tc-1',
          success: true,
          result: { content: 'output here' },
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_result',
        toolName: 'Bash',
        toolUseId: 'tc-1',
        result: 'output here',
        isError: false,
      });
    });

    it('should use detailedContent over content when available', () => {
      collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc-1', toolName: 'bash', arguments: {} },
      } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'tc-1',
          success: true,
          result: { content: 'short', detailedContent: 'detailed output' },
        },
      } as any));

      expect(events[0]).toMatchObject({ result: 'detailed output' });
    });

    it('should include error code in error result', () => {
      collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc-1', toolName: 'bash', arguments: {} },
      } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'tc-1',
          success: false,
          error: { code: 'ENOENT', message: 'File not found' },
        },
      } as any));

      expect(events[0]).toMatchObject({
        isError: true,
        result: '[ENOENT] File not found',
      });
    });

    it('should use block reason for declined tools', () => {
      collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc-1', toolName: 'bash', arguments: {} },
      } as any));

      adapter.setBlockReason('tc-1', 'Permission denied');

      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'tc-1',
          success: false,
          error: { message: 'Blocked' },
        },
      } as any));

      expect(events[0]).toMatchObject({ result: 'Permission denied' });
    });

    it('should use accumulated partial results in tool_result', () => {
      collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc-1', toolName: 'bash', arguments: {} },
      } as any));

      collect(adapter.adaptEvent({
        type: 'tool.execution_partial_result',
        data: { toolCallId: 'tc-1', partialOutput: 'part 1 ' },
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool.execution_partial_result',
        data: { toolCallId: 'tc-1', partialOutput: 'part 2' },
      } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_complete',
        data: { toolCallId: 'tc-1', success: true },
      } as any));

      expect(events[0]).toMatchObject({ result: 'part 1 part 2' });
    });

    it('should emit Read tool_result when command was classified as read', () => {
      collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc-1', toolName: 'bash', arguments: { command: 'cat /file.ts' } },
      } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_complete',
        data: { toolCallId: 'tc-1', success: true, result: { content: 'file data' } },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'tool_result',
        toolName: 'Read',
      });
    });

    it('should emit status for tool.execution_progress', () => {
      const events = collect(adapter.adaptEvent({
        type: 'tool.execution_progress',
        data: { progressMessage: 'Installing packages...' },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Installing packages...',
      });
    });

    it('should reset hasEmittedFinalText after tool completion', () => {
      // Emit a text_complete
      collect(adapter.adaptEvent({
        type: 'assistant.message',
        data: { content: 'First' },
      } as any));

      // Complete a tool — resets guard
      collect(adapter.adaptEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc-1', toolName: 'bash', arguments: {} },
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool.execution_complete',
        data: { toolCallId: 'tc-1', success: true, result: { content: 'ok' } },
      } as any));

      // Should emit again now
      const events = collect(adapter.adaptEvent({
        type: 'assistant.message',
        data: { content: 'Second response' },
      } as any));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ text: 'Second response' });
    });
  });

  describe('subagent events', () => {
    it('should emit tool_start for subagent.started', () => {
      const events = collect(adapter.adaptEvent({
        type: 'subagent.started',
        data: {
          toolCallId: 'sa-1',
          agentName: 'researcher',
          agentDescription: 'Research task',
        },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolName: 'SubAgent:researcher',
        toolUseId: 'sa-1',
      });
    });

    it('should emit tool_result for subagent.completed', () => {
      const events = collect(adapter.adaptEvent({
        type: 'subagent.completed',
        data: { toolCallId: 'sa-1', agentName: 'researcher' },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'tool_result',
        toolName: 'SubAgent:researcher',
        isError: false,
      });
    });

    it('should emit error tool_result for subagent.failed', () => {
      const events = collect(adapter.adaptEvent({
        type: 'subagent.failed',
        data: { toolCallId: 'sa-1', agentName: 'researcher', error: 'Timeout' },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'tool_result',
        isError: true,
        result: 'Timeout',
      });
    });

    it('should emit status for subagent.selected', () => {
      const events = collect(adapter.adaptEvent({
        type: 'subagent.selected',
        data: { agentDisplayName: 'Code Reviewer' },
      } as any));

      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Agent selected: Code Reviewer',
      });
    });
  });

  describe('other events', () => {
    it('should emit status for abort', () => {
      const events = collect(adapter.adaptEvent({
        type: 'abort',
        data: { reason: 'user cancelled' },
      } as any));
      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Aborted: user cancelled',
      });
    });

    it('should emit status for skill.invoked', () => {
      const events = collect(adapter.adaptEvent({
        type: 'skill.invoked',
        data: { name: 'commit' },
      } as any));
      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Skill invoked: commit',
      });
    });

    it('should emit nothing for internal events', () => {
      for (const type of ['user.message', 'pending_messages.modified', 'session.shutdown', 'session.snapshot_rewind', 'hook.start', 'hook.end', 'system.message', 'tool.user_requested']) {
        const events = collect(adapter.adaptEvent({
          type,
          data: {},
        } as any));
        expect(events).toHaveLength(0);
      }
    });
  });
});
