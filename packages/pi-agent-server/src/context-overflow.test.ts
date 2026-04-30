import { describe, expect, it } from 'bun:test';
import {
  getAutoCompactTokenLimit,
  isContextOverflowErrorMessage,
  shouldPrePromptCompact,
} from './context-overflow.ts';

describe('context overflow handling', () => {
  it('recognizes OpenAI Codex context_length_exceeded payloads', () => {
    const message = 'Codex error: {"type":"error","error":{"type":"invalid_request_error","code":"context_length_exceeded","message":"Your input exceeds the context window of this model. Please adjust your input and try again.","param":"input"},"sequence_number":2}';

    expect(isContextOverflowErrorMessage(message)).toBe(true);
  });

  it('uses Codex-compatible 90 percent auto compact limit by default', () => {
    expect(getAutoCompactTokenLimit(272_000)).toBe(244_800);
  });

  it('compacts before prompt when known usage is near the limit', () => {
    const decision = shouldPrePromptCompact({
      contextWindow: 272_000,
      lastKnownInputTokens: 213_000,
      pendingInputTokens: 500,
    });

    expect(decision.shouldCompact).toBe(true);
    expect(decision.reason).toBe('known_usage_near_limit');
    expect(decision.autoCompactLimit).toBe(244_800);
    expect(decision.prePromptLimit).toBe(212_800);
  });

  it('compacts before prompt when the projected request crosses the limit', () => {
    const decision = shouldPrePromptCompact({
      contextWindow: 272_000,
      lastKnownInputTokens: 200_000,
      pendingInputTokens: 45_000,
    });

    expect(decision.shouldCompact).toBe(true);
    expect(decision.reason).toBe('projected_usage_exceeds_limit');
  });

  it('does not compact when the request has enough headroom', () => {
    const decision = shouldPrePromptCompact({
      contextWindow: 272_000,
      lastKnownInputTokens: 120_000,
      pendingInputTokens: 10_000,
    });

    expect(decision.shouldCompact).toBe(false);
    expect(decision.reason).toBeNull();
  });
});
