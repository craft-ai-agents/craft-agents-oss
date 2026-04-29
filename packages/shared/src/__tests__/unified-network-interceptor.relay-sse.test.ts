import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { toolMetadataStore } from '../interceptor-common.ts';

let createOpenAiSseStrippingStream: typeof import('../unified-network-interceptor.ts').createOpenAiSseStrippingStream;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function runThroughProcessor(
  processor: TransformStream<Uint8Array, Uint8Array>,
  chunks: string[],
): Promise<string> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  const output = input.pipeThrough(processor);
  const reader = output.getReader();
  let result = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

/**
 * Counts how many SSE events in the post-strip output carry an event for a
 * given tool_call id with both id and name populated. With the consolidated-
 * emit contract, this MUST be exactly 1 per logical tool call.
 */
function countInitEventsForId(out: string, toolCallId: string): number {
  const lines = out.split('\n');
  let count = 0;
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{
          delta?: {
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      const tcs = parsed.choices?.[0]?.delta?.tool_calls;
      if (!tcs) continue;
      for (const tc of tcs) {
        if (tc.id === toolCallId && tc.function?.name) {
          count++;
        }
      }
    } catch {
      continue;
    }
  }
  return count;
}

/**
 * Reassembles the post-strip SSE output the way an OpenAI-compatible SDK
 * would. Each chunk's `delta.tool_calls[i]` is keyed by `index` — the first
 * chunk at an index sets id/name/type, later chunks append `arguments`.
 *
 * Returns the final tool_calls array. With the consolidated-emit contract,
 * each tool_call should appear with id, name, and full args in one event.
 */
function reassembleToolCalls(out: string): Array<{
  index: number;
  id: string;
  type: string;
  function: { name: string; arguments: string };
}> {
  const byIndex = new Map<number, { index: number; id: string; type: string; function: { name: string; arguments: string } }>();
  for (const line of out.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    let parsed: {
      choices?: Array<{
        delta?: {
          tool_calls?: Array<{
            index?: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const tcs = parsed.choices?.[0]?.delta?.tool_calls;
    if (!tcs) continue;
    for (const tc of tcs) {
      const idx = tc.index ?? 0;
      const existing = byIndex.get(idx);
      if (!existing) {
        byIndex.set(idx, {
          index: idx,
          id: tc.id ?? '',
          type: tc.type ?? 'function',
          function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' },
        });
      } else {
        if (tc.id) existing.id = tc.id;
        if (tc.type) existing.type = tc.type;
        if (tc.function?.name) existing.function.name = tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }
  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
}

describe('unified-network-interceptor relay SSE quirks (#613)', () => {
  let sessionDir: string;

  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    ({ createOpenAiSseStrippingStream } = await import('../unified-network-interceptor.ts'));
  });

  afterAll(() => {
    delete process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL;
  });

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'interceptor-relay-'));
    toolMetadataStore.setSessionDir(sessionDir);
  });

  afterEach(() => {
    toolMetadataStore._clearForTesting();
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('dedupes init events when a relay repeats tc.id on every chunk', async () => {
    // Reproduces the relay-style SSE stream that triggers the duplicate
    // tool_call_id 400. Every chunk includes both id and name — instead of
    // sending id once and arg-deltas after.
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_relay","type":"function","function":{"name":"ls","arguments":"{\\"pa"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_relay","type":"function","function":{"name":"ls","arguments":"th\\":"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_relay","type":"function","function":{"name":"ls","arguments":"\\"/tmp\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    // Exactly ONE init event for call_relay, regardless of repetitions
    expect(countInitEventsForId(out, 'call_relay')).toBe(1);
    // Final argument delta should contain the fully reassembled JSON
    expect(out).toContain('"arguments":"{\\"path\\":\\"/tmp\\"}"');
  });

  it('does not collide parallel tool calls when relay drops tc.index on later chunks', async () => {
    // Two parallel tool calls; subsequent argument-delta chunks omit
    // `index`. Naive code would bucket every later chunk under index 0 and
    // smash one call's args into the other's tracked entry.
    const sse = [
      // First chunk opens both calls with explicit indices
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_A","type":"function","function":{"name":"ls","arguments":"{\\"a\\":"}}, {"index":1,"id":"call_B","type":"function","function":{"name":"pwd","arguments":"{\\"b\\":"}}]}}]}\n\n',
      // Subsequent argument-delta for call_B WITHOUT index — should bind to last opened (B)
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"function":{"arguments":"2}"}}]}}]}\n\n',
      // Subsequent argument-delta for call_A WITH explicit index 0
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    expect(countInitEventsForId(out, 'call_A')).toBe(1);
    expect(countInitEventsForId(out, 'call_B')).toBe(1);
    // call_A should have {"a":1}, call_B should have {"b":2}
    expect(out).toContain('"arguments":"{\\"a\\":1}"');
    expect(out).toContain('"arguments":"{\\"b\\":2}"');
  });

  it('reassembles to N tool_calls (not 2N) — output contract', async () => {
    // The duplicate-empty-id bug: phase-1 chunks at indices 0,1 carry
    // id+name+metadata-only args; phase-2 chunks at NEW indices 2,3 carry
    // empty id+name and the actual url args. Pi SDK reassembly used to see
    // 4 separate tool_calls (2 with id+name+empty-args, 2 with empty-id+url-
    // args). After the consolidated-emit fix, downstream sees exactly 2.
    const sse = [
      // Phase 1: id+name with metadata-only args at indices 0, 1
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_00_Yp3Y","type":"function","function":{"name":"web_fetch","arguments":"{\\"_intent\\":\\"fetch news\\",\\"_displayName\\":\\"Fetch article\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_01_Zg1a","type":"function","function":{"name":"web_fetch","arguments":"{\\"_intent\\":\\"fetch backup\\",\\"_displayName\\":\\"Fetch article\\"}"}}]}}]}\n\n',
      // Phase 2: empty id+name with url args at NEW indices 2, 3
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":2,"id":"","function":{"name":"","arguments":"{\\"url\\":\\"https://daily.example/news\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":3,"id":"","function":{"name":"","arguments":"{\\"url\\":\\"https://ap.example/article\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);
    const reassembled = reassembleToolCalls(out);

    // Exactly two tool_calls — not four.
    expect(reassembled).toHaveLength(2);
    // Both have non-empty id and name (no orphan empty-id leakage).
    for (const tc of reassembled) {
      expect(tc.id).not.toBe('');
      expect(tc.function.name).not.toBe('');
    }
    // Args were merged from phase-1 metadata + phase-2 url, then stripped.
    const argsArr = reassembled.map(tc => JSON.parse(tc.function.arguments));
    expect(argsArr[0]).toEqual({ url: 'https://daily.example/news' });
    expect(argsArr[1]).toEqual({ url: 'https://ap.example/article' });
    // No metadata leakage in output.
    for (const args of argsArr) {
      expect(args).not.toHaveProperty('_intent');
      expect(args).not.toHaveProperty('_displayName');
    }
    // ids preserved correctly per call.
    expect(reassembled[0]?.id).toBe('call_00_Yp3Y');
    expect(reassembled[1]?.id).toBe('call_01_Zg1a');
  });

  it('handles standard OpenAI streaming (id-once + arg-deltas at same index)', async () => {
    // Vanilla OpenAI shape: first chunk has id+name+empty-args, subsequent
    // chunks have only arg-deltas at the same index. Must still produce one
    // consolidated tool_call.
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_std","type":"function","function":{"name":"ls","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"_in"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"tent\\":\\"x\\",\\"path\\":\\"/tmp\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);
    const reassembled = reassembleToolCalls(out);

    expect(reassembled).toHaveLength(1);
    expect(reassembled[0]?.id).toBe('call_std');
    expect(reassembled[0]?.function.name).toBe('ls');
    expect(JSON.parse(reassembled[0]!.function.arguments)).toEqual({ path: '/tmp' });
  });

  it('does not leak empty-id tool_calls into output for any DeepSeek phase-2 shape', async () => {
    // Stress test: phase-1 chunks for 3 parallel calls, phase-2 chunks at
    // NEW indices interleaved. Output must contain ZERO tool_call entries
    // with empty id.
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"read","arguments":"{\\"_intent\\":\\"a\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"ls","arguments":"{\\"_intent\\":\\"b\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":2,"id":"call_c","type":"function","function":{"name":"grep","arguments":"{\\"_intent\\":\\"c\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":3,"id":"","function":{"name":"","arguments":"{\\"path\\":\\"/a\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":4,"id":"","function":{"name":"","arguments":"{\\"path\\":\\"/b\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":5,"id":"","function":{"name":"","arguments":"{\\"pattern\\":\\"foo\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);
    const reassembled = reassembleToolCalls(out);

    expect(reassembled).toHaveLength(3);
    expect(reassembled.map(tc => tc.id)).toEqual(['call_a', 'call_b', 'call_c']);
    expect(reassembled.map(tc => tc.function.name)).toEqual(['read', 'ls', 'grep']);
    expect(JSON.parse(reassembled[0]!.function.arguments)).toEqual({ path: '/a' });
    expect(JSON.parse(reassembled[1]!.function.arguments)).toEqual({ path: '/b' });
    expect(JSON.parse(reassembled[2]!.function.arguments)).toEqual({ pattern: 'foo' });
  });
});
