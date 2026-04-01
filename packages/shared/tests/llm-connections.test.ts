/**
 * Tests for LLM connection utilities (llm-connections.ts).
 *
 * Focuses on getMiniModel() / findSmallModel() — the provider-aware small
 * model resolution used for title generation, summarization, and call_llm.
 */
import { describe, it, expect } from 'bun:test';
import { getMiniModel, getSummarizationModel } from '../src/config/llm-connections.ts';
import type { LlmProviderType } from '../src/config/llm-connections.ts';

// ============================================================
// Helpers
// ============================================================

function makeConnection(providerType: LlmProviderType, models: string[]) {
  return { providerType, models };
}

// ============================================================
// getMiniModel / findSmallModel
// ============================================================

describe('getMiniModel()', () => {
  // --- Anthropic providers ---

  it('finds haiku for anthropic provider', () => {
    const conn = makeConnection('anthropic', [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ]);
    expect(getMiniModel(conn)).toBe('claude-haiku-4-5-20251001');
  });

  // --- Pi providers ---

  it('finds mini for pi provider', () => {
    const conn = makeConnection('pi', [
      'pi/gpt-5.2-codex',
      'pi/gpt-5.1-codex-mini',
    ]);
    expect(getMiniModel(conn)).toBe('pi/gpt-5.1-codex-mini');
  });

  it('skips denied codex-mini-latest alias for pi provider', () => {
    const conn = makeConnection('pi', [
      'pi/codex-mini-latest',
      'pi/gpt-5.1-codex-mini',
      'pi/gpt-5.2-codex',
    ]);
    expect(getMiniModel(conn)).toBe('pi/gpt-5.1-codex-mini');
  });

  it('skips denied pi/codex-mini-latest alias for pi provider', () => {
    const conn = makeConnection('pi', [
      'pi/codex-mini-latest',
      'pi/gpt-5.1-codex-mini',
      'pi/gpt-5.3-codex',
    ]);
    expect(getMiniModel(conn)).toBe('pi/gpt-5.1-codex-mini');
  });

  it('finds mini for pi_compat provider', () => {
    const conn = makeConnection('pi_compat', [
      'openai/gpt-5.2-codex',
      'openai/gpt-5.1-codex-mini',
    ]);
    expect(getMiniModel(conn)).toBe('openai/gpt-5.1-codex-mini');
  });

  // --- Pi fallback behavior ---

  it('finds mini for Pi list with mixed models', () => {
    const conn = makeConnection('pi', [
      'pi/claude-sonnet-4.6',
      'pi/gpt-5',
      'pi/gpt-5-mini',
      'pi/o3',
    ]);
    expect(getMiniModel(conn)).toBe('pi/gpt-5-mini');
  });

  it('finds mini even when model name has "mini" in different position', () => {
    const conn = makeConnection('pi', [
      'pi/gpt-5',
      'pi/o4-mini',
      'pi/claude-sonnet-4.6',
    ]);
    expect(getMiniModel(conn)).toBe('pi/o4-mini');
  });

  it('falls back to last model when Pi list has no mini/flash model', () => {
    const conn = makeConnection('pi', [
      'pi/gpt-5',
      'pi/claude-sonnet-4.6',
      'pi/o3',
    ]);
    expect(getMiniModel(conn)).toBe('pi/o3');
  });

  // --- Edge cases ---

  it('returns undefined for empty model list', () => {
    const conn = makeConnection('anthropic', []);
    expect(getMiniModel(conn)).toBeUndefined();
  });

  it('returns undefined for undefined models', () => {
    const conn = { providerType: 'anthropic' as LlmProviderType, models: undefined };
    expect(getMiniModel(conn)).toBeUndefined();
  });

  it('falls back to last model when no keyword match', () => {
    const conn = makeConnection('anthropic', [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
    ]);
    // No haiku in list — falls back to last model
    expect(getMiniModel(conn)).toBe('claude-sonnet-4-6');
  });

  it('fallback ignores denied alias and returns last allowed model', () => {
    const conn = makeConnection('pi', [
      'pi/codex-mini-latest',
      'pi/gpt-5',
      'pi/claude-sonnet-4.6',
    ]);
    expect(getMiniModel(conn)).toBe('pi/claude-sonnet-4.6');
  });

  it('handles single-model list', () => {
    const conn = makeConnection('pi', ['pi/gpt-5']);
    expect(getMiniModel(conn)).toBe('pi/gpt-5');
  });
});

// ============================================================
// getSummarizationModel (same logic, but separate function)
// ============================================================

describe('getSummarizationModel()', () => {
  it('returns same result as getMiniModel (shared implementation)', () => {
    const conn = makeConnection('pi', [
      'pi/gpt-5',
      'pi/gpt-5-mini',
      'pi/claude-sonnet-4.6',
    ]);
    expect(getSummarizationModel(conn)).toBe(getMiniModel(conn));
  });
});
