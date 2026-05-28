import { describe, expect, it } from 'bun:test';
import { resolveClaudeThinkingOptions } from '../claude-agent.ts';

describe('resolveClaudeThinkingOptions', () => {
  it('returns adaptive xhigh when thinkingEnabled=true', () => {
    const result = resolveClaudeThinkingOptions({ thinkingEnabled: true, minimizeThinking: false });
    expect(result).toEqual({ thinking: { type: 'adaptive' }, effort: 'xhigh' });
  });

  it('returns disabled when thinkingEnabled=false', () => {
    const result = resolveClaudeThinkingOptions({ thinkingEnabled: false, minimizeThinking: false });
    expect(result).toEqual({ thinking: { type: 'disabled' } });
  });

  it('returns disabled when minimizeThinking=true regardless of thinkingEnabled', () => {
    const result = resolveClaudeThinkingOptions({ thinkingEnabled: true, minimizeThinking: true });
    expect(result).toEqual({ thinking: { type: 'disabled' } });
  });

  it('has no maxThinkingTokens in any path', () => {
    for (const thinkingEnabled of [true, false] as const) {
      for (const minimizeThinking of [true, false]) {
        const result = resolveClaudeThinkingOptions({ thinkingEnabled, minimizeThinking });
        expect('maxThinkingTokens' in result).toBe(false);
      }
    }
  });
});
