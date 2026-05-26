import { describe, expect, it } from 'bun:test';
import { DEFAULT_THINKING_ENABLED, normalizeThinkingEnabled } from './thinking-toggle.ts';

describe('thinking toggle', () => {
  it('defaults thinking to enabled', () => {
    expect(DEFAULT_THINKING_ENABLED).toBe(true);
  });

  it('leaves undefined unset', () => {
    expect(normalizeThinkingEnabled(undefined)).toBeUndefined();
  });

  it('maps legacy off to disabled', () => {
    expect(normalizeThinkingEnabled('off')).toBe(false);
  });

  it('maps legacy thinking toggles to enabled', () => {
    for (const value of ['think', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(normalizeThinkingEnabled(value)).toBe(true);
    }
  });

  it('preserves boolean values', () => {
    expect(normalizeThinkingEnabled(true)).toBe(true);
    expect(normalizeThinkingEnabled(false)).toBe(false);
  });

  it('leaves unknown values unset', () => {
    expect(normalizeThinkingEnabled('custom')).toBeUndefined();
    expect(normalizeThinkingEnabled(1)).toBeUndefined();
    expect(normalizeThinkingEnabled({})).toBeUndefined();
    expect(normalizeThinkingEnabled(null)).toBeUndefined();
    expect(normalizeThinkingEnabled(0)).toBeUndefined();
  });
});
