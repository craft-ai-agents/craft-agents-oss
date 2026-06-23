import { describe, expect, it } from 'bun:test';
import { shouldAllowToolInMode } from '../../agent/mode-manager.ts';

describe('send_agent_message permission mode handling', () => {
  const toolName = 'mcp__session__send_agent_message';

  it('allows passive messages in safe mode', () => {
    const result = shouldAllowToolInMode(toolName, {
      sessionId: 'target',
      message: 'Progress update.',
      deliveryMode: 'passive',
    }, 'safe');

    expect(result.allowed).toBe(true);
  });

  it('blocks normal messages in safe mode', () => {
    const result = shouldAllowToolInMode(toolName, {
      sessionId: 'target',
      message: 'Please act on this.',
    }, 'safe');

    expect(result.allowed).toBe(false);
  });

  it('blocks passive messages with attachments in safe mode', () => {
    const result = shouldAllowToolInMode(toolName, {
      sessionId: 'target',
      message: 'See attached.',
      deliveryMode: 'passive',
      attachments: [{ path: '/tmp/file.txt' }],
    }, 'safe');

    expect(result.allowed).toBe(false);
  });
});
