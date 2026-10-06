import { describe, expect, it } from 'bun:test';
import type { PiLargeResultGateRequest } from '../../shared/src/agent/backend/pi/protocol.ts';
import { createLargeResultGateClient } from './large-result-gate.ts';

const input = { text: 'y'.repeat(50_000), context: { toolName: 'bash', intent: 'list files' }, budgetChars: 24_000, filePath: '/s/long_responses/r.txt' };

describe('Pi large-result filter client', () => {
  it('sends the main process the whole result and returns the kept parts', async () => {
    const sent: PiLargeResultGateRequest[] = [];
    const client = createLargeResultGateClient((request) => sent.push(request));
    const answer = client.filter(input);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'large_result_gate_request', toolName: 'bash', intent: 'list files', budgetChars: 24_000, filePath: '/s/long_responses/r.txt' });
    expect(sent[0]!.text).toBe(input.text);
    client.handleResponse('unrelated', null);
    client.handleResponse(sent[0]!.requestId, { text: 'y', kept: 2, total: 9 });
    expect(await answer).toEqual({ text: 'y', kept: 2, total: 9 });
    // A late duplicate reply is ignored.
    client.handleResponse(sent[0]!.requestId, null);
  });

  it('counts a reply that never comes as no answer', async () => {
    const client = createLargeResultGateClient(() => {}, 10);
    expect(await client.filter(input)).toBeNull();
  });
});
