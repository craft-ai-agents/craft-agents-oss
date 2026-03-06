import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { toolMetadataStore } from '../interceptor-common.ts';

let createOpenAiSseStrippingStream: typeof import('../unified-network-interceptor.ts').createOpenAiSseStrippingStream;
let createOpenAiResponsesSseStrippingStream: typeof import('../unified-network-interceptor.ts').createOpenAiResponsesSseStrippingStream;
let createAnthropicSseStrippingStream: typeof import('../unified-network-interceptor.ts').createAnthropicSseStrippingStream;

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

describe('unified-network-interceptor SSE processors', () => {
  let sessionDir: string;

  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    const mod = await import('../unified-network-interceptor.ts');
    createOpenAiSseStrippingStream = mod.createOpenAiSseStrippingStream;
    createOpenAiResponsesSseStrippingStream = mod.createOpenAiResponsesSseStrippingStream;
    createAnthropicSseStrippingStream = mod.createAnthropicSseStrippingStream;
  });

  afterAll(() => {
    delete process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL;
  });

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'interceptor-sse-'));
    toolMetadataStore.setSessionDir(sessionDir);
  });

  afterEach(() => {
    toolMetadataStore._clearForTesting();
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('OpenAI: handles multiple tool calls in one delta chunk without dropping calls', async () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"toolA","arguments":"{\\"a\\":1,\\"_intent\\":\\"intent-1\\",\\"_displayName\\":\\"Display 1\\"}"}},{"index":1,"id":"call_2","type":"function","function":{"name":"toolB","arguments":"{\\"b\\":2,\\"_intent\\":\\"intent-2\\",\\"_displayName\\":\\"Display 2\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    expect(out).toContain('"id":"call_1"');
    expect(out).toContain('"id":"call_2"');
    expect(out).toContain('"arguments":"{\\"a\\":1}"');
    expect(out).toContain('"arguments":"{\\"b\\":2}"');
    expect(out).not.toContain('_intent');
    expect(out).not.toContain('_displayName');

    expect(toolMetadataStore.get('call_1', sessionDir)?.intent).toBe('intent-1');
    expect(toolMetadataStore.get('call_2', sessionDir)?.displayName).toBe('Display 2');

    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('OpenAI: processes tool calls for multiple choices', async () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"toolA","arguments":"{\\"x\\":1,\\"_intent\\":\\"intent-a\\"}"}}]}},{"index":1,"delta":{"tool_calls":[{"index":0,"id":"call_b","type":"function","function":{"name":"toolB","arguments":"{\\"y\\":2,\\"_displayName\\":\\"Display B\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"},{"index":1,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    expect(out).toContain('"id":"call_a"');
    expect(out).toContain('"id":"call_b"');
    expect(out).toContain('"choices":[{"index":1');
    expect(out).toContain('"arguments":"{\\"x\\":1}"');
    expect(out).toContain('"arguments":"{\\"y\\":2}"');

    expect(toolMetadataStore.get('call_a', sessionDir)?.intent).toBe('intent-a');
    expect(toolMetadataStore.get('call_b', sessionDir)?.displayName).toBe('Display B');

    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('OpenAI Responses: strips metadata on function_call done events', async () => {
    const sse = [
      'data: {"type":"response.function_call_arguments.done","call_id":"call_resp_1","arguments":"{\\"foo\\":1,\\"_intent\\":\\"do thing\\",\\"_displayName\\":\\"Do Thing\\"}"}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_resp_1","id":"fc_1","name":"mcp__craft__search","arguments":"{\\"foo\\":1,\\"_intent\\":\\"do thing\\",\\"_displayName\\":\\"Do Thing\\"}"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiResponsesSseStrippingStream(), sse);

    expect(out).toContain('"type":"response.function_call_arguments.done"');
    expect(out).toContain('"arguments":"{\\"foo\\":1}"');
    expect(out).not.toContain('_intent');
    expect(out).not.toContain('_displayName');

    const meta = toolMetadataStore.get('call_resp_1', sessionDir);
    expect(meta?.intent).toBe('do thing');
    expect(meta?.displayName).toBe('Do Thing');

    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('Anthropic: supports multi-line data payloads and strips metadata', async () => {
    const sse = [
      'event: content_block_start\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read"}}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta",\n',
      'data: "partial_json":"{\\"path\\":\\"/tmp\\",\\"_intent\\":\\"Read file\\",\\"_displayName\\":\\"Read Tmp\\"}"}}\n\n',
      'event: content_block_stop\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
    ];

    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), sse);

    expect(out).toContain('event: content_block_delta');
    expect(out).toContain('"partial_json":"{\\"path\\":\\"/tmp\\"}"');
    expect(out).not.toContain('_intent');
    expect(out).not.toContain('_displayName');

    const meta = toolMetadataStore.get('toolu_1', sessionDir);
    expect(meta?.intent).toBe('Read file');
    expect(meta?.displayName).toBe('Read Tmp');

    rmSync(sessionDir, { recursive: true, force: true });
  });
});
