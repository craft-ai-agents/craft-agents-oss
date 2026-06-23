import { describe, expect, it } from 'bun:test';
import { messageToStored, storedToMessage, type Message } from '@craft-agent/core/types';

describe('message display intent', () => {
  it('persists Canvas visual review display intent', () => {
    const message: Message = {
      id: 'msg-1',
      role: 'user',
      content: '<system-reminder>hidden model prompt</system-reminder>',
      timestamp: 123,
      displayIntent: 'canvas-visual-review',
    };

    const stored = messageToStored(message);
    expect(stored.displayIntent).toBe('canvas-visual-review');
    expect(storedToMessage(stored).displayIntent).toBe('canvas-visual-review');
  });

  it('persists passive agent message display intent', () => {
    const message: Message = {
      id: 'msg-2',
      role: 'info',
      content: 'Passive agent update.',
      timestamp: 123,
      displayIntent: 'agent-message-passive',
      agentMessage: {
        receiptId: 'receipt-1',
        childSessionId: 'child-1',
        targetAgentSlug: 'reviewer',
        status: 'running',
      },
    };

    const stored = messageToStored(message);
    expect(stored.type).toBe('info');
    expect(stored.displayIntent).toBe('agent-message-passive');
    expect(stored.agentMessage?.childSessionId).toBe('child-1');
    expect(storedToMessage(stored).displayIntent).toBe('agent-message-passive');
    expect(storedToMessage(stored).agentMessage?.receiptId).toBe('receipt-1');
  });
});
