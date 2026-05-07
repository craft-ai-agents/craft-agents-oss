import { beforeAll, describe, expect, it } from 'bun:test';

let validateOpenAiChatBody: typeof import('../unified-network-interceptor.ts').validateOpenAiChatBody;
let validateOpenAiResponsesBody: typeof import('../unified-network-interceptor.ts').validateOpenAiResponsesBody;
let MalformedBodyError: typeof import('../unified-network-interceptor.ts').MalformedBodyError;
let sanitizeOpenAiHistoryInPlace: typeof import('../unified-network-interceptor.ts').sanitizeOpenAiHistoryInPlace;

describe('unified-network-interceptor validators (#613)', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    const mod = await import('../unified-network-interceptor.ts');
    validateOpenAiChatBody = mod.validateOpenAiChatBody;
    validateOpenAiResponsesBody = mod.validateOpenAiResponsesBody;
    MalformedBodyError = mod.MalformedBodyError;
    sanitizeOpenAiHistoryInPlace = mod.sanitizeOpenAiHistoryInPlace;
  });

  describe('OpenAI Chat Completions', () => {
    it('accepts a well-formed body with one tool call + one tool result', () => {
      const body = {
        messages: [
          { role: 'user', content: 'list files' },
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_1', content: 'a.txt b.txt' },
        ],
      };
      expect(() => validateOpenAiChatBody(body)).not.toThrow();
    });

    it('throws duplicate_tool_call_id when same id appears in two tool_calls', () => {
      const body = {
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } },
              { id: 'call_1', type: 'function', function: { name: 'pwd', arguments: '{}' } },
            ],
          },
        ],
      };
      try {
        validateOpenAiChatBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('duplicate_tool_call_id');
      }
    });

    it('throws empty_tool_name when assistant emits a tool_call with blank name', () => {
      const body = {
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: '', arguments: '{}' } },
            ],
          },
        ],
      };
      try {
        validateOpenAiChatBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('empty_tool_name');
      }
    });

    it('throws missing_tool_call_id on tool message without tool_call_id', () => {
      const body = {
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } },
            ],
          },
          { role: 'tool', content: 'oops' },
        ],
      };
      try {
        validateOpenAiChatBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('missing_tool_call_id');
      }
    });

    it('throws orphaned_function_call_output when tool result references unknown id', () => {
      const body = {
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_999', content: 'ghost' },
        ],
      };
      try {
        validateOpenAiChatBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('orphaned_function_call_output');
      }
    });

    it('is a no-op when body has no messages array', () => {
      expect(() => validateOpenAiChatBody({})).not.toThrow();
      expect(() => validateOpenAiChatBody({ messages: 'not-an-array' })).not.toThrow();
    });
  });

  describe('OpenAI Responses API', () => {
    it('accepts a well-formed input[] with paired function_call + function_call_output', () => {
      const body = {
        input: [
          { type: 'message', role: 'user', content: 'ping' },
          { type: 'function_call', call_id: 'call_1', name: 'ping', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call_1', output: 'pong' },
        ],
      };
      expect(() => validateOpenAiResponsesBody(body)).not.toThrow();
    });

    it('throws missing_call_id on function_call without call_id (#613 primary symptom)', () => {
      const body = {
        input: [
          { type: 'function_call', name: 'ls', arguments: '{}' },
        ],
      };
      try {
        validateOpenAiResponsesBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('missing_call_id');
      }
    });

    it('throws duplicate_tool_call_id on repeated call_id in function_calls', () => {
      const body = {
        input: [
          { type: 'function_call', call_id: 'call_1', name: 'ls', arguments: '{}' },
          { type: 'function_call', call_id: 'call_1', name: 'pwd', arguments: '{}' },
        ],
      };
      try {
        validateOpenAiResponsesBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('duplicate_tool_call_id');
      }
    });

    it('throws empty_tool_name on function_call with blank name', () => {
      const body = {
        input: [
          { type: 'function_call', call_id: 'call_1', name: '   ', arguments: '{}' },
        ],
      };
      try {
        validateOpenAiResponsesBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('empty_tool_name');
      }
    });

    it('throws orphaned_function_call_output when output references unknown call_id', () => {
      const body = {
        input: [
          { type: 'function_call', call_id: 'call_1', name: 'ls', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call_999', output: 'ghost' },
        ],
      };
      try {
        validateOpenAiResponsesBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('orphaned_function_call_output');
      }
    });

    it('is a no-op when body has no input array', () => {
      expect(() => validateOpenAiResponsesBody({})).not.toThrow();
      expect(() => validateOpenAiResponsesBody({ input: 'not-an-array' })).not.toThrow();
    });
  });

  describe('MalformedBodyError', () => {
    it('carries code, detail, and adapter for telemetry', () => {
      try {
        validateOpenAiChatBody({
          messages: [{ role: 'tool', content: 'no id' }],
        });
        throw new Error('expected throw');
      } catch (err) {
        const e = err as InstanceType<typeof MalformedBodyError>;
        expect(e).toBeInstanceOf(MalformedBodyError);
        expect(e.code).toBe('missing_tool_call_id');
        expect(e.adapter).toBe('openai');
        expect(e.detail).toContain('messages[0]');
        expect(e.message).toContain('[openai]');
      }
    });
  });

  describe('sanitizeOpenAiHistoryInPlace (poisoned-history recovery)', () => {
    it('drops empty-id tool_calls from assistant messages and orphan tool results', () => {
      // Mirrors the shape persisted by the pre-fix strip stream: a real
      // tool_call followed by phantom empty-id entries from flush re-emits.
      const body = {
        messages: [
          { role: 'user', content: 'fetch articles' },
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_real', type: 'function', function: { name: 'web_fetch', arguments: '{}' } },
              { id: '', type: 'function', function: { name: '', arguments: '{"url":"https://a.example"}' } },
              { id: '', type: 'function', function: { name: '', arguments: '{"url":"https://b.example"}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_real', content: 'result' },
          { role: 'tool', tool_call_id: '', content: 'orphan 1' },
          { role: 'tool', tool_call_id: '', content: 'orphan 2' },
        ],
      };

      const result = sanitizeOpenAiHistoryInPlace(body);

      expect(result.droppedToolCalls).toBe(2);
      expect(result.droppedToolResults).toBe(2);

      // Sanitized body validates cleanly.
      expect(() => validateOpenAiChatBody(body)).not.toThrow();

      const messages = body.messages as Array<{ role?: string; tool_calls?: unknown[]; tool_call_id?: string }>;
      expect(messages).toHaveLength(3); // user + assistant + 1 tool result
      expect(messages[1]?.tool_calls).toHaveLength(1);
      expect(messages[2]?.tool_call_id).toBe('call_real');
    });

    it('removes tool_calls field entirely when all entries are empty-id', () => {
      const body = {
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: '', type: 'function', function: { name: '', arguments: '{"url":"x"}' } },
            ],
          },
        ],
      };
      sanitizeOpenAiHistoryInPlace(body);
      const msg = (body.messages as Array<{ tool_calls?: unknown }>)[0];
      expect(msg).not.toHaveProperty('tool_calls');
    });

    it('is a no-op on healthy history', () => {
      const body = {
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_1', content: 'a.txt' },
        ],
      };
      const before = JSON.stringify(body);
      const result = sanitizeOpenAiHistoryInPlace(body);
      expect(result.droppedToolCalls).toBe(0);
      expect(result.droppedToolResults).toBe(0);
      expect(JSON.stringify(body)).toBe(before);
    });

    it('handles missing messages field gracefully', () => {
      const body: Record<string, unknown> = {};
      const result = sanitizeOpenAiHistoryInPlace(body);
      expect(result.droppedToolCalls).toBe(0);
      expect(result.droppedToolResults).toBe(0);
    });
  });
});
