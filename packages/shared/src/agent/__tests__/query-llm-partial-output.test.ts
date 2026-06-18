/**
 * Tests for the call_llm partial-output recovery path.
 *
 * Covers:
 *  - `consumeLlmQueryMessages` (the SDK-stream consumer extracted from
 *    `ClaudeAgent.queryLlm`) across the five SDK shapes it has to handle.
 *  - The `call_llm` tool's render block, which must prefix
 *    `[Partial result — ...]` when the backend queryFn returns a `warning`.
 *
 * These tests avoid constructing a full ClaudeAgent and avoid touching the
 * real SDK — the consumer takes an `AsyncIterable<SDKMessage>` and the tool
 * takes a `getQueryFn` stub, both of which are trivial to fake here.
 */
import { describe, it, expect } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { consumeLlmQueryMessages, summarizeSdkError } from '../claude-llm-query.ts';
import { createLLMTool, type LLMQueryRequest, type LLMQueryResult } from '../llm-tool.ts';

// ============================================================
// Helpers
// ============================================================

/**
 * Builds an async iterator from a pre-scripted message list.
 * If `throwAt` is provided, the iterator throws on that index instead of yielding.
 */
async function* scriptIterator(messages: SDKMessage[], throwAt?: { index: number; error: Error }): AsyncGenerator<SDKMessage> {
  for (let i = 0; i < messages.length; i++) {
    if (throwAt && i === throwAt.index) {
      throw throwAt.error;
    }
    yield messages[i]!;
  }
  if (throwAt && throwAt.index === messages.length) {
    throw throwAt.error;
  }
}

function assistantMsg(text: string): SDKMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  } as unknown as SDKMessage;
}

function successResult(structuredOutput?: unknown): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    structured_output: structuredOutput,
    num_turns: 1,
    stop_reason: 'end_turn',
  } as unknown as SDKMessage;
}

function errorResult(subtype: 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | 'error_max_structured_output_retries', overrides: Partial<Record<string, unknown>> = {}): SDKMessage {
  return {
    type: 'result',
    subtype,
    is_error: true,
    num_turns: 3,
    stop_reason: null,
    errors: [],
    ...overrides,
  } as unknown as SDKMessage;
}

function collectDebug() {
  const logs: string[] = [];
  return { logs, onDebug: (m: string) => logs.push(m) };
}

// ============================================================
// consumeLlmQueryMessages
// ============================================================

describe('consumeLlmQueryMessages', () => {
  it('happy path — returns text, no warning', async () => {
    const iter = scriptIterator([
      assistantMsg('Hello '),
      assistantMsg('world.'),
      successResult(),
    ]);

    const result = await consumeLlmQueryMessages(iter);

    expect(result.text).toBe('Hello world.');
    expect(result.warning).toBeUndefined();
  });

  it('max-turns thrown mid-stream — preserves partial text + warning', async () => {
    const { logs, onDebug } = collectDebug();
    const iter = scriptIterator(
      [assistantMsg('Partial draft here.'), /* throw before result */],
      { index: 1, error: new Error('Reached maximum number of turns (10)') },
    );

    const result = await consumeLlmQueryMessages(iter, onDebug);

    expect(result.text).toBe('Partial draft here.');
    expect(result.warning).toMatch(/Model stopped early/i);
    expect(result.warning).toMatch(/maximum number of turns/i);
    expect(logs.some((l) => l.includes('SDK threw'))).toBe(true);
  });

  it('max-turns thrown with no accumulated text — re-throws', async () => {
    const iter = scriptIterator([], { index: 0, error: new Error('Reached maximum number of turns (10)') });

    await expect(consumeLlmQueryMessages(iter)).rejects.toThrow('Reached maximum number of turns');
  });

  it('error result yielded (not thrown) — returns partial text + warning', async () => {
    const { logs, onDebug } = collectDebug();
    const iter = scriptIterator([
      assistantMsg('Draft that stopped short.'),
      errorResult('error_max_turns', { num_turns: 10, errors: ['hit cap'] }),
    ]);

    const result = await consumeLlmQueryMessages(iter, onDebug);

    expect(result.text).toBe('Draft that stopped short.');
    expect(result.warning).toMatch(/Model stopped at max turns/i);
    expect(result.warning).toContain('num_turns=10');
    expect(result.warning).toContain('hit cap');
    expect(logs.some((l) => l.includes('subtype=error_max_turns'))).toBe(true);
  });

  it('structured output + error result — prefers structured and attaches warning', async () => {
    const iter = scriptIterator([
      successResult({ answer: 'yes' }),
      errorResult('error_max_structured_output_retries'),
    ]);

    const result = await consumeLlmQueryMessages(iter);

    expect(JSON.parse(result.text)).toEqual({ answer: 'yes' });
    expect(result.warning).toMatch(/Structured output retries exhausted/i);
  });

  it('non-error exception with some text — still recovers', async () => {
    const iter = scriptIterator(
      [assistantMsg('Some output.')],
      { index: 1, error: new Error('socket hang up') },
    );

    const result = await consumeLlmQueryMessages(iter);

    expect(result.text).toBe('Some output.');
    expect(result.warning).toContain('socket hang up');
  });
});

// ============================================================
// summarizeSdkError
// ============================================================

describe('summarizeSdkError', () => {
  it('maps known subtypes to human-readable strings', () => {
    const r = {
      subtype: 'error_max_budget_usd',
      num_turns: 4,
      errors: ['budget $5 exceeded'],
    } as unknown as Parameters<typeof summarizeSdkError>[0];

    const s = summarizeSdkError(r);
    expect(s).toContain('budget cap');
    expect(s).toContain('num_turns=4');
    expect(s).toContain('budget $5 exceeded');
  });

  it('falls back on unknown subtypes', () => {
    const r = {
      subtype: 'error_unknown_new_thing',
      num_turns: 2,
      errors: [],
    } as unknown as Parameters<typeof summarizeSdkError>[0];

    expect(summarizeSdkError(r)).toContain('error_unknown_new_thing');
  });
});

// ============================================================
// call_llm tool rendering
// ============================================================

describe('call_llm tool — warning prefix rendering', () => {
  function buildTool(queryFn: (req: LLMQueryRequest) => Promise<LLMQueryResult>) {
    return createLLMTool({
      sessionId: 'test-session',
      getQueryFn: () => queryFn,
    });
  }

  // Handler's inferred arg type requires all zod fields (optionals resolve to `T | undefined`).
  function argsFor(prompt: string): Parameters<ReturnType<typeof buildTool>['handler']>[0] {
    return {
      prompt,
      attachments: undefined,
      model: undefined,
      systemPrompt: undefined,
      maxTokens: undefined,
      temperature: undefined,
      outputFormat: undefined,
      outputSchema: undefined,
    };
  }

  async function invoke(tool: ReturnType<typeof buildTool>, prompt: string) {
    return tool.handler(argsFor(prompt), {});
  }

  it('renders a [Partial result — …] prefix when queryFn returns a warning', async () => {
    const tool = buildTool(async () => ({
      text: 'Draft body here.',
      warning: 'Model stopped at max turns (num_turns=10)',
    }));

    const resp = await invoke(tool, 'draft a paragraph');

    expect(resp.content[0]!.type).toBe('text');
    const body = (resp.content[0] as { text: string }).text;
    expect(body.startsWith('[Partial result — Model stopped at max turns (num_turns=10)]')).toBe(true);
    expect(body).toContain('Draft body here.');
  });

  it('renders plain text when no warning is set', async () => {
    const tool = buildTool(async () => ({ text: 'Clean response.' }));

    const resp = await invoke(tool, 'hi');

    expect((resp.content[0] as { text: string }).text).toBe('Clean response.');
  });

  it('renders warning with placeholder body when text is empty but warning set', async () => {
    const tool = buildTool(async () => ({
      text: '',
      warning: 'Model stopped at max turns (num_turns=10)',
    }));

    const resp = await invoke(tool, 'hi');

    const body = (resp.content[0] as { text: string }).text;
    expect(body).toContain('[Partial result —');
    expect(body).toContain('(no text produced before stop)');
  });

  it('renders "(Model returned empty response)" when both text and warning are empty', async () => {
    const tool = buildTool(async () => ({ text: '' }));

    const resp = await invoke(tool, 'hi');

    expect((resp.content[0] as { text: string }).text).toBe('(Model returned empty response)');
  });
});
