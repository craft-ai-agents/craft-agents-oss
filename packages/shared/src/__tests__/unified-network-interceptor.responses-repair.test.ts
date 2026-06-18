import { beforeAll, describe, expect, it } from 'bun:test';

let repairResponsesHistoryInPlace: typeof import('../unified-network-interceptor.ts').repairResponsesHistoryInPlace;
let validateOpenAiResponsesBody: typeof import('../unified-network-interceptor.ts').validateOpenAiResponsesBody;

describe('unified-network-interceptor responses-history repair (#613)', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    const mod = await import('../unified-network-interceptor.ts');
    repairResponsesHistoryInPlace = mod.repairResponsesHistoryInPlace;
    validateOpenAiResponsesBody = mod.validateOpenAiResponsesBody;
  });

  it('synthesizes a deterministic call_id when function_call is missing one', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{"path":"/tmp"}' },
    ];
    const result = repairResponsesHistoryInPlace(input);
    expect(result.synthesizedCallIds).toBe(1);
    expect(result.droppedOrphans).toBe(0);
    expect(typeof input[0]!.call_id).toBe('string');
    expect((input[0]!.call_id as string).startsWith('repaired_')).toBe(true);
  });

  it('synthesizes a stable call_id given the same name + arguments', () => {
    const a: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{"x":1}' },
    ];
    const b: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{"x":1}' },
    ];
    repairResponsesHistoryInPlace(a);
    repairResponsesHistoryInPlace(b);
    expect(a[0]!.call_id).toBe(b[0]!.call_id);
  });

  it('drops function_call_output entries that reference unknown call_ids', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', call_id: 'call_1', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_ghost', output: 'orphan' },
      { type: 'function_call_output', call_id: 'call_1', output: 'real' },
    ];
    const result = repairResponsesHistoryInPlace(input);
    expect(result.droppedOrphans).toBe(1);
    expect(input.length).toBe(2);
    expect((input[1] as { call_id: string }).call_id).toBe('call_1');
  });

  it('keeps function_call_output that references a synthesized call_id', () => {
    // Pi SDK drops call_id on the function_call but the output still has one;
    // repair must synthesize for the call AND link the output.
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'should_be_dropped', output: 'orphan' },
    ];
    const result = repairResponsesHistoryInPlace(input);
    expect(result.synthesizedCallIds).toBe(1);
    // output gets dropped because its call_id doesn't match the synthesized one
    expect(result.droppedOrphans).toBe(1);
    expect(input.length).toBe(1);
  });

  it('is a no-op when history is already well-formed', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', call_id: 'call_1', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'a' },
    ];
    const result = repairResponsesHistoryInPlace(input);
    expect(result.synthesizedCallIds).toBe(0);
    expect(result.droppedOrphans).toBe(0);
    expect(input.length).toBe(2);
  });

  it('produces a body that passes validation after repair (end-to-end)', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'orphan', output: 'gone' },
    ];
    repairResponsesHistoryInPlace(input);
    expect(() => validateOpenAiResponsesBody({ input })).not.toThrow();
  });
});
