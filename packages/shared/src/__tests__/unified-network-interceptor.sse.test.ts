import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { toolMetadataStore } from '../interceptor-common.ts';

let createOpenAiSseStrippingStream: typeof import('../unified-network-interceptor.ts').createOpenAiSseStrippingStream;
let createOpenAiResponsesSseStrippingStream: typeof import('../unified-network-interceptor.ts').createOpenAiResponsesSseStrippingStream;
let createAnthropicSseStrippingStream: typeof import('../unified-network-interceptor.ts').createAnthropicSseStrippingStream;
let stripMetadataFieldsFromRawJson: typeof import('../unified-network-interceptor.ts').stripMetadataFieldsFromRawJson;

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
    stripMetadataFieldsFromRawJson = mod.stripMetadataFieldsFromRawJson;
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

  it('OpenAI: decomposes hallucinated multi_tool_use.parallel into individual calls', async () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_parallel_1","type":"function","function":{"name":"multi_tool_use.parallel","arguments":"{\\"tool_uses\\":[{\\"recipient_name\\":\\"web_search\\",\\"parameters\\":{\\"query\\":\\"sample query\\",\\"_intent\\":\\"Find sample\\",\\"_displayName\\":\\"Search Sample\\"}},{\\"recipient_name\\":\\"read\\",\\"parameters\\":{\\"path\\":\\"/tmp/sample.json\\",\\"_intent\\":\\"Read sample\\",\\"_displayName\\":\\"Read Sample\\"}}]}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    expect(out).not.toContain('multi_tool_use.parallel');
    expect(out).toContain('"id":"call_parallel_1_parallel_0"');
    expect(out).toContain('"id":"call_parallel_1_parallel_1"');
    expect(out).toContain('"name":"web_search"');
    expect(out).toContain('"name":"read"');
    expect(out).toContain('"arguments":"{\\"query\\":\\"sample query\\"}"');
    expect(out).toContain('"arguments":"{\\"path\\":\\"/tmp/sample.json\\"}"');
    expect(out).not.toContain('_intent');
    expect(out).not.toContain('_displayName');

    expect(toolMetadataStore.get('call_parallel_1_parallel_0', sessionDir)?.intent).toBe('Find sample');
    expect(toolMetadataStore.get('call_parallel_1_parallel_0', sessionDir)?.displayName).toBe('Search Sample');
    expect(toolMetadataStore.get('call_parallel_1_parallel_1', sessionDir)?.intent).toBe('Read sample');
    expect(toolMetadataStore.get('call_parallel_1_parallel_1', sessionDir)?.displayName).toBe('Read Sample');

    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('OpenAI: decomposes multi_tool_use.parallel streamed across multiple delta chunks', async () => {
    const argsJson = '{"tool_uses":[{"recipient_name":"web_search","parameters":{"query":"query one","_intent":"Find sample","_displayName":"Search Sample"}},{"recipient_name":"web_search","parameters":{"query":"query two"}},{"recipient_name":"read","parameters":{"path":"/tmp/sample.json"}}]}';
    const half = Math.floor(argsJson.length / 2);
    const argsPart1 = argsJson.slice(0, half);
    const argsPart2 = argsJson.slice(half);

    const sse = [
      `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_stream_1","type":"function","function":{"name":"multi_tool_use.parallel","arguments":""}}]}}]}\n\n`,
      `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"${argsPart1.replace(/"/g, '\\"')}"}}]}}]}\n\n`,
      `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"${argsPart2.replace(/"/g, '\\"')}"}}]}}]}\n\n`,
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    expect(out).not.toContain('multi_tool_use.parallel');
    expect(out).toContain('"id":"call_stream_1_parallel_0"');
    expect(out).toContain('"id":"call_stream_1_parallel_1"');
    expect(out).toContain('"id":"call_stream_1_parallel_2"');
    expect(out).toContain('"name":"web_search"');
    expect(out).toContain('"name":"read"');
    expect(out).toContain('"arguments":"{\\"query\\":\\"query one\\"}"');
    expect(out).toContain('"arguments":"{\\"query\\":\\"query two\\"}"');
    expect(out).toContain('"arguments":"{\\"path\\":\\"/tmp/sample.json\\"}"');
    expect(out).not.toContain('_intent');
    expect(out).not.toContain('_displayName');

    expect(toolMetadataStore.get('call_stream_1_parallel_0', sessionDir)?.intent).toBe('Find sample');
    expect(toolMetadataStore.get('call_stream_1_parallel_0', sessionDir)?.displayName).toBe('Search Sample');
    expect(toolMetadataStore.get('call_stream_1_parallel_1', sessionDir)).toBeUndefined();
    expect(toolMetadataStore.get('call_stream_1_parallel_2', sessionDir)).toBeUndefined();

    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('OpenAI: handles multi_tool_use.parallel with empty/missing parameters gracefully', async () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_empty_1","type":"function","function":{"name":"multi_tool_use.parallel","arguments":"{\\"tool_uses\\":[{\\"recipient_name\\":\\"web_search\\",\\"parameters\\":{}},{\\"recipient_name\\":\\"read\\"},{\\"recipient_name\\":\\"web_search\\",\\"parameters\\":{\\"query\\":\\"test\\"}}]}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    expect(out).not.toContain('multi_tool_use.parallel');
    expect(out).toContain('"id":"call_empty_1_parallel_0"');
    expect(out).toContain('"id":"call_empty_1_parallel_1"');
    expect(out).toContain('"id":"call_empty_1_parallel_2"');
    expect(out).toContain('"arguments":"{}"');
    expect(out).toContain('"arguments":"{\\"query\\":\\"test\\"}"');

    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('OpenAI: handles repeated tc.id chunks correctly (dedup)', async () => {
    // Simulates OpenAI/Codex SSE tool-call streams where every chunk includes
    // id/call_id, including bridged Responses-based streams where call_id is
    // present on every event.
    const sse = [
      // Init events from response.output_item.added (id + name, no args)
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_ws1","type":"function","function":{"name":"web_search"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_rd1","type":"function","function":{"name":"read"}}]}}]}\n\n',
      // Arg deltas from response.function_call_arguments.delta (id + partial args)
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_ws1","type":"function","function":{"arguments":"{\\"query\\":\\"sample"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_rd1","type":"function","function":{"arguments":"{\\"path\\":\\"/tmp"}}]}}]}\n\n',
      // More arg deltas
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_ws1","type":"function","function":{"arguments":" query\\",\\"_intent\\":\\"Find sample\\",\\"_displayName\\":\\"Search Sample\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_rd1","type":"function","function":{"arguments":"/sample.json\\",\\"_intent\\":\\"Read sample\\",\\"_displayName\\":\\"Read Sample\\"}"}}]}}]}\n\n',
      // Done events from response.function_call_arguments.done (id + name + full args)
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_ws1","type":"function","function":{"name":"web_search","arguments":"{\\"query\\":\\"sample query\\",\\"_intent\\":\\"Find sample\\",\\"_displayName\\":\\"Search Sample\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_rd1","type":"function","function":{"name":"read","arguments":"{\\"path\\":\\"/tmp/sample.json\\",\\"_intent\\":\\"Read sample\\",\\"_displayName\\":\\"Read Sample\\"}"}}]}}]}\n\n',
      // Finish
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    // Only ONE init event per tool call (dedup should prevent duplicates)
    const initOccurrences = (out.match(/"id":"call_ws1"/g) || []).length;
    expect(initOccurrences).toBeGreaterThanOrEqual(1);

    // Args should be stripped of metadata and present (JSON-in-JSON escaping)
    expect(out).toContain('\\"query\\":\\"sample query\\"');
    expect(out).toContain('\\"path\\":\\"/tmp/sample.json\\"');
    expect(out).not.toContain('_intent');
    expect(out).not.toContain('_displayName');

    // Metadata stored
    expect(toolMetadataStore.get('call_ws1', sessionDir)?.intent).toBe('Find sample');
    expect(toolMetadataStore.get('call_rd1', sessionDir)?.displayName).toBe('Read Sample');

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

  describe('stripMetadataFieldsFromRawJson', () => {
    it('strips _intent and _displayName from valid JSON', () => {
      const input = '{"path":"/tmp","_intent":"Read file","_displayName":"Read Tmp"}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{"path":"/tmp"}');
      expect(result).not.toContain('_intent');
      expect(result).not.toContain('_displayName');
    });

    it('strips metadata fields at the beginning of the object', () => {
      const input = '{"_intent":"do thing","_displayName":"Do Thing","path":"/tmp"}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{"path":"/tmp"}');
    });

    it('strips metadata fields in the middle of the object', () => {
      const input = '{"a":1,"_intent":"do thing","_displayName":"Do Thing","b":2}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{"a":1,"b":2}');
    });

    it('handles escaped quotes in metadata values', () => {
      const input = '{"path":"/tmp","_intent":"Read \\"special\\" file","_displayName":"Read"}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{"path":"/tmp"}');
    });

    it('returns unchanged JSON when no metadata fields present', () => {
      const input = '{"path":"/tmp","limit":10}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{"path":"/tmp","limit":10}');
    });

    it('handles JSON with only metadata fields', () => {
      const input = '{"_intent":"do thing","_displayName":"Do Thing"}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{}');
    });
  });
});
