/**
 * Tests for PiEventAdapter
 *
 * Tests the Pi SDK AgentEvent / AgentSessionEvent → Craft AgentEvent conversion.
 * Each test provides mock Pi SDK event objects and verifies the AgentEvents produced.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiEventAdapter } from '../backend/pi/event-adapter.ts';
import { toolMetadataStore } from '../../interceptor-common.ts';

// Helper: collect all events from a generator
function collect(gen: Generator<any>): any[] {
  return [...gen];
}

describe('PiEventAdapter', () => {
  let adapter: PiEventAdapter;
  let sessionDir: string;

  beforeEach(() => {
    adapter = new PiEventAdapter();
    sessionDir = mkdtempSync(join(tmpdir(), 'pi-adapter-'));
    adapter.setSessionDir(sessionDir);
    toolMetadataStore.setSessionDir(sessionDir);
    adapter.startTurn();
  });

  afterEach(() => {
    toolMetadataStore._clearForTesting();
    rmSync(sessionDir, { recursive: true, force: true });
  });

  // ============================================================
  // Agent lifecycle
  // ============================================================

  describe('agent lifecycle', () => {
    it('should emit nothing for agent_start', () => {
      const events = collect(adapter.adaptEvent({ type: 'agent_start' } as any));
      expect(events).toHaveLength(0);
    });

    it('should emit complete for agent_end', () => {
      const events = collect(adapter.adaptEvent({ type: 'agent_end' } as any));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'complete' });
    });
  });

  // ============================================================
  // Turn lifecycle
  // ============================================================

  describe('turn lifecycle', () => {
    it('should set currentTurnId on turn_start', () => {
      // turn_start is handled internally — emits no events
      const events = collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      expect(events).toHaveLength(0);
    });

    it('should emit nothing on turn_end', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({ type: 'turn_end' } as any));
      expect(events).toHaveLength(0);
    });

    it('should generate sequential turn IDs across turns', () => {
      // First turn (turnIndex=1 from beforeEach startTurn)
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events1 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Hello' },
      } as any));
      expect(events1[0].turnId).toMatch(/^pi-turn-1/);

      // End first turn, start second
      collect(adapter.adaptEvent({ type: 'turn_end' } as any));
      adapter.startTurn();
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const events2 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'World' },
      } as any));
      expect(events2[0].turnId).toMatch(/^pi-turn-2/);
    });
  });

  // ============================================================
  // Message events — text streaming
  // ============================================================

  describe('message events', () => {
    it('should emit nothing for message_start', () => {
      const events = collect(adapter.adaptEvent({ type: 'message_start' } as any));
      expect(events).toHaveLength(0);
    });

    it('should emit text_delta for message_update with text_delta', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_delta',
        text: 'Hello',
      });
      expect(events[0].turnId).toMatch(/^pi-turn-1__m0$/);
    });

    it('should skip message_update without text_delta type', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'usage_delta', delta: null },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should skip message_update with empty delta', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '' },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should reuse same sub-turnId for consecutive deltas', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const events1 = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      } as any));
      const events2 = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: ' World' },
      } as any));

      expect(events1[0].turnId).toBe(events2[0].turnId);
    });

    it('should emit text_complete for final assistant message_end', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Hello there' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_complete',
        text: 'Hello there',
        isIntermediate: false,
      });
    });

    it('should skip non-assistant message_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'user', content: 'Hello' },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should skip toolResult message_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'toolResult', content: 'result' },
      } as any));
      expect(events).toHaveLength(0);
    });

    it('should extract text from content array', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: ' Part 2' },
          ],
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].text).toBe('Part 1 Part 2');
    });

    it('should skip message_end with no text content', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: [{ type: 'tool_use', id: 'tool1' }],
        },
      } as any));
      expect(events).toHaveLength(0);
    });
  });

  // ============================================================
  // Intermediate vs final text classification
  // ============================================================

  describe('intermediate text classification', () => {
    it('should set isIntermediate: true when stopReason is toolUse', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'toolUse',
          content: 'Let me check that...',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_complete',
        text: 'Let me check that...',
        isIntermediate: true,
      });
    });

    it('should set isIntermediate: false when stopReason is stop', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'Here is the final answer.',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'text_complete',
        text: 'Here is the final answer.',
        isIntermediate: false,
      });
    });

    it('should allow multiple intermediate messages in a turn', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // First intermediate message
      const events1 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'toolUse',
          content: 'Let me read the file...',
        },
      } as any));

      // Simulate tool execution between intermediates
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'tool1',
        toolName: 'read',
        args: { path: '/foo.ts' },
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'tool1',
        result: 'file content',
        isError: false,
      } as any));

      // Second intermediate message
      const events2 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'toolUse',
          content: 'Now let me check the tests...',
        },
      } as any));

      expect(events1).toHaveLength(1);
      expect(events1[0].isIntermediate).toBe(true);

      expect(events2).toHaveLength(1);
      expect(events2[0].isIntermediate).toBe(true);
    });

    it('should block duplicate final messages in same turn', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // First final message
      const events1 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'Final answer',
        },
      } as any));

      // Duplicate final message (should be blocked)
      const events2 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'Duplicate final',
        },
      } as any));

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(0);
    });

    it('should allow final message after tool completion resets state', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // Intermediate message
      collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'toolUse', content: 'Checking...' },
      } as any));

      // Tool execution
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'tool1',
        toolName: 'read',
        args: {},
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'tool1',
        result: 'output',
        isError: false,
      } as any));

      // Final message after tool — should work because tool_execution_end resets hasEmittedFinalText
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Here is the answer.' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].isIntermediate).toBe(false);
    });
  });

  // ============================================================
  // Sub-turnId isolation
  // ============================================================

  describe('sub-turnId isolation', () => {
    it('should generate unique sub-turnIds for text blocks', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // First text block
      const events1 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'toolUse', content: 'First' },
      } as any));

      // Tool between text blocks
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'read',
        args: {},
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 't1',
        result: 'ok',
        isError: false,
      } as any));

      // Second text block
      const events2 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Second' },
      } as any));

      expect(events1[0].turnId).not.toBe(events2[0].turnId);
      expect(events1[0].turnId).toMatch(/^pi-turn-1__m/);
      expect(events2[0].turnId).toMatch(/^pi-turn-1__m/);
    });

    it('should use streaming sub-turnId when deltas preceded text_complete', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // Stream deltas first
      const deltaEvents = collect(adapter.adaptEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'Hello' },
      } as any));

      // Then text_complete
      const completeEvents = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Hello world' },
      } as any));

      // text_complete should reuse the delta's sub-turnId
      expect(completeEvents[0].turnId).toBe(deltaEvents[0].turnId);
    });

    it('should reset sub-turnId counter across turns', () => {
      // First turn
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events1 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Turn 1' },
      } as any));

      // End turn, start new one
      collect(adapter.adaptEvent({ type: 'turn_end' } as any));
      adapter.startTurn();
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const events2 = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Turn 2' },
      } as any));

      // Sub-turn counter resets: both should end with m0
      expect(events1[0].turnId).toBe('pi-turn-1__m0');
      expect(events2[0].turnId).toBe('pi-turn-2__m0');
    });
  });

  // ============================================================
  // Error surfacing
  // ============================================================

  describe('error surfacing', () => {
    it('should emit plain error for unclassified error messages', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Something went wrong internally',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'error',
        message: 'Something went wrong internally',
      });
    });

    it('should emit typed_error for auth-expiry error messages', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'Provided authentication token is expired. Please try signing in again.',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('typed_error');
      expect(events[0].error.code).toBe('expired_oauth_token');
    });

    it('should emit typed_error for 401 unauthorized errors', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: '401 Unauthorized',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('typed_error');
      expect(events[0].error.code).toBe('invalid_api_key');
    });

    it('should emit typed_error for billing/402 errors', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: '402 Payment required',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('typed_error');
      expect(events[0].error.code).toBe('billing_error');
    });

    it('should emit typed_error for rate limit errors', () => {
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: '429 Too many requests - rate limit exceeded',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('typed_error');
      expect(events[0].error.code).toBe('rate_limited');
    });

    it('should not emit error without errorMessage even if stopReason is error', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          // No errorMessage — fall through to normal text extraction
          content: 'Some partial content',
        },
      } as any));

      // Should emit as text_complete, not error
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('text_complete');
    });
  });

  // ============================================================
  // Tool events
  // ============================================================

  describe('tool events', () => {
    it('should emit tool_start for tool_execution_start', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_123',
        toolName: 'bash',
        args: { command: 'ls -la', description: 'List files' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolName: 'Bash',
        toolUseId: 'call_123',
        input: { command: 'ls -la', description: 'List files' },
        displayName: 'Run Command',
      });
    });

    it('should fallback to args metadata when store has no entry', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_no_store',
        toolName: 'bash',
        args: {
          command: 'npm test',
          _intent: 'Run unit tests',
          _displayName: 'Run Tests',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolName: 'Bash',
        toolUseId: 'call_no_store',
        intent: 'Run unit tests',
        displayName: 'Run Tests',
      });
    });

    it('should prefer store metadata over args metadata when both exist', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      toolMetadataStore.set('call_store_wins', {
        intent: 'Stored intent',
        displayName: 'Stored name',
        timestamp: Date.now(),
      });

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_store_wins',
        toolName: 'bash',
        args: {
          command: 'npm test',
          _intent: 'Args intent',
          _displayName: 'Args name',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolUseId: 'call_store_wins',
        intent: 'Stored intent',
        displayName: 'Stored name',
      });
    });

    it('should use canonical metadata from event payload', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_canonical',
        toolName: 'bash',
        args: { command: 'npm test' },
        toolMetadata: {
          intent: 'Canonical intent',
          displayName: 'Canonical name',
          source: 'interceptor',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolUseId: 'call_canonical',
        intent: 'Canonical intent',
        displayName: 'Canonical name',
      });
    });

    it('should fallback to base id metadata when toolCallId includes a pipe suffix', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      toolMetadataStore.set('call_base_id', {
        intent: 'Stored base intent',
        displayName: 'Stored base name',
        timestamp: Date.now(),
      });

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_base_id|fc_123',
        toolName: 'bash',
        args: { command: 'npm test' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolUseId: 'call_base_id|fc_123',
        intent: 'Stored base intent',
        displayName: 'Stored base name',
      });
    });

    it('should prefer canonical metadata over store and args', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      toolMetadataStore.set('call_canonical_wins', {
        intent: 'Stored intent',
        displayName: 'Stored name',
        timestamp: Date.now(),
      });

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_canonical_wins',
        toolName: 'bash',
        args: {
          command: 'npm test',
          _intent: 'Args intent',
          _displayName: 'Args name',
        },
        toolMetadata: {
          intent: 'Canonical intent',
          displayName: 'Canonical name',
          source: 'interceptor',
        },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_start',
        toolUseId: 'call_canonical_wins',
        intent: 'Canonical intent',
        displayName: 'Canonical name',
      });
    });

    it('should resolve Pi lowercase tool names to PascalCase', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      const toolTests = [
        { piName: 'read', expected: 'Read' },
        { piName: 'write', expected: 'Write' },
        { piName: 'edit', expected: 'Edit' },
        { piName: 'grep', expected: 'Grep' },
        { piName: 'find', expected: 'Find' },
        { piName: 'ls', expected: 'Ls' },
      ];

      for (const { piName, expected } of toolTests) {
        const events = collect(adapter.adaptEvent({
          type: 'tool_execution_start',
          toolCallId: `call_${piName}`,
          toolName: piName,
          args: {},
        } as any));

        expect(events[0].toolName).toBe(expected);
      }
    });

    it('should emit tool_result for tool_execution_end', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // Start tool first
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'read',
        args: { path: '/foo.ts' },
      } as any));

      // End tool
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        result: { content: [{ type: 'text', text: 'file contents' }] },
        isError: false,
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'tool_result',
        toolUseId: 'call_1',
        toolName: 'Read',
        result: 'file contents',
        isError: false,
      });
    });

    it('should handle string result in tool_execution_end', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: {},
      } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        result: 'command output',
        isError: false,
      } as any));

      expect(events[0].result).toBe('command output');
    });

    it('should handle error tool results', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: {},
      } as any));

      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        result: null,
        isError: true,
      } as any));

      expect(events[0]).toMatchObject({
        type: 'tool_result',
        isError: true,
        result: 'Tool execution failed',
      });
    });

    it('should accumulate partial output from tool_execution_update', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: {},
      } as any));

      // Partial updates
      collect(adapter.adaptEvent({
        type: 'tool_execution_update',
        toolCallId: 'call_1',
        partialResult: { content: [{ type: 'text', text: 'line 1\n' }] },
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_update',
        toolCallId: 'call_1',
        partialResult: { content: [{ type: 'text', text: 'line 2\n' }] },
      } as any));

      // End — should use accumulated output
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        result: 'ignored because accumulated',
        isError: false,
      } as any));

      expect(events[0].result).toBe('line 1\nline 2\n');
    });

    it('should use description as intent for bash tools', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: { command: 'npm test', description: 'Run unit tests' },
      } as any));

      expect(events[0].intent).toBe('Run unit tests');
    });

    it('should classify bash cat commands as Read tool starts', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));
      const events = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: { command: 'cat /path/to/file.ts' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].toolName).toBe('Read');
      expect(events[0].displayName).toBe('Read File');
    });

    it('should reset hasEmittedFinalText after tool_execution_end', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // Emit final text
      collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'toolUse', content: 'Checking...' },
      } as any));

      // Tool execution
      collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 't1',
        toolName: 'read',
        args: {},
      } as any));
      collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 't1',
        result: 'ok',
        isError: false,
      } as any));

      // Another text after tool — should succeed
      const events = collect(adapter.adaptEvent({
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'stop', content: 'Done!' },
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0].text).toBe('Done!');
    });
  });

  // ============================================================
  // Session-level events
  // ============================================================

  describe('session events', () => {
    it('should emit status for auto_compaction_start', () => {
      const events = collect(adapter.adaptEvent({
        type: 'auto_compaction_start',
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Compacting context...',
      });
    });

    it('should emit info for successful auto_compaction_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'auto_compaction_end',
        result: { /* compaction result */ },
        aborted: false,
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'info',
        message: 'Compacted context to fit within limits',
      });
    });

    it('should emit error for failed auto_compaction_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'auto_compaction_end',
        result: null,
        aborted: false,
        errorMessage: 'Out of memory',
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'error',
        message: 'Context compaction failed: Out of memory',
      });
    });

    it('should emit nothing for aborted compaction', () => {
      const events = collect(adapter.adaptEvent({
        type: 'auto_compaction_end',
        result: null,
        aborted: true,
      } as any));

      expect(events).toHaveLength(0);
    });

    it('should emit status for auto_retry_start', () => {
      const events = collect(adapter.adaptEvent({
        type: 'auto_retry_start',
        attempt: 2,
        maxAttempts: 3,
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'status',
        message: 'Retrying (attempt 2/3)...',
      });
    });

    it('should emit error for failed auto_retry_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'auto_retry_end',
        success: false,
        finalError: 'Max retries exceeded',
      } as any));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'error',
        message: 'Retry failed: Max retries exceeded',
      });
    });

    it('should emit nothing for successful auto_retry_end', () => {
      const events = collect(adapter.adaptEvent({
        type: 'auto_retry_end',
        success: true,
      } as any));

      expect(events).toHaveLength(0);
    });
  });

  // ============================================================
  // Full multi-turn flow
  // ============================================================

  describe('full multi-turn flow', () => {
    it('should handle intermediate → tool → final message flow', () => {
      collect(adapter.adaptEvent({ type: 'turn_start' } as any));

      // 1. Intermediate commentary
      const intermediateEvents = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'toolUse',
          content: 'Let me check the file...',
        },
      } as any));

      // 2. Tool execution
      const toolStartEvents = collect(adapter.adaptEvent({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'read',
        args: { path: '/src/index.ts' },
      } as any));

      const toolEndEvents = collect(adapter.adaptEvent({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        result: 'file contents here',
        isError: false,
      } as any));

      // 3. Final response
      const finalEvents = collect(adapter.adaptEvent({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          content: 'The file contains your code.',
        },
      } as any));

      // Verify complete flow
      expect(intermediateEvents[0]).toMatchObject({
        type: 'text_complete',
        isIntermediate: true,
        text: 'Let me check the file...',
      });
      expect(toolStartEvents[0]).toMatchObject({
        type: 'tool_start',
        toolName: 'Read',
      });
      expect(toolEndEvents[0]).toMatchObject({
        type: 'tool_result',
        toolName: 'Read',
      });
      expect(finalEvents[0]).toMatchObject({
        type: 'text_complete',
        isIntermediate: false,
        text: 'The file contains your code.',
      });

      // All events should have pi-turn-1 prefix
      expect(intermediateEvents[0].turnId).toMatch(/^pi-turn-1/);
      expect(toolStartEvents[0].turnId).toMatch(/^pi-turn-1/);
      expect(finalEvents[0].turnId).toMatch(/^pi-turn-1/);
    });
  });
});
