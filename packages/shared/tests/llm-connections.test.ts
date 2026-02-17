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
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ]);
    expect(getMiniModel(conn)).toBe('claude-haiku-4-5-20251001');
  });

  it('finds haiku for bedrock provider', () => {
    const conn = makeConnection('bedrock', [
      'anthropic.claude-opus-4-6',
      'anthropic.claude-haiku-4-5-20251001',
    ]);
    expect(getMiniModel(conn)).toBe('anthropic.claude-haiku-4-5-20251001');
  });

  it('finds haiku for vertex provider', () => {
    const conn = makeConnection('vertex', [
      'claude-opus-4-6',
      'claude-haiku-4-5-20251001',
    ]);
    expect(getMiniModel(conn)).toBe('claude-haiku-4-5-20251001');
  });

  it('finds haiku for anthropic_compat provider', () => {
    const conn = makeConnection('anthropic_compat', [
      'anthropic/claude-opus-4.6',
      'anthropic/claude-haiku-4.5',
    ]);
    expect(getMiniModel(conn)).toBe('anthropic/claude-haiku-4.5');
  });

  // --- OpenAI providers ---

  it('finds mini for openai provider', () => {
    const conn = makeConnection('openai', [
      'gpt-5.2-codex',
      'gpt-5.1-codex-mini',
    ]);
    expect(getMiniModel(conn)).toBe('gpt-5.1-codex-mini');
  });

  it('finds mini for openai_compat provider', () => {
    const conn = makeConnection('openai_compat', [
      'openai/gpt-5.2-codex',
      'openai/gpt-5.1-codex-mini',
    ]);
    expect(getMiniModel(conn)).toBe('openai/gpt-5.1-codex-mini');
  });

  // --- Copilot provider ---

  it('finds mini for copilot provider', () => {
    const conn = makeConnection('copilot', [
      'claude-sonnet-4.5',
      'gpt-5',
      'gpt-5-mini',
      'o3',
    ]);
    expect(getMiniModel(conn)).toBe('gpt-5-mini');
  });

  it('finds mini for copilot even when model name has "mini" in different position', () => {
    const conn = makeConnection('copilot', [
      'gpt-5',
      'o4-mini',
      'claude-sonnet-4.5',
    ]);
    expect(getMiniModel(conn)).toBe('o4-mini');
  });

  it('falls back to last model when copilot has no mini model', () => {
    const conn = makeConnection('copilot', [
      'gpt-5',
      'claude-sonnet-4.5',
      'o3',
    ]);
    expect(getMiniModel(conn)).toBe('o3');
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
      'claude-sonnet-4-5-20250929',
    ]);
    // No haiku in list — falls back to last model
    expect(getMiniModel(conn)).toBe('claude-sonnet-4-5-20250929');
  });

  it('handles single-model list', () => {
    const conn = makeConnection('copilot', ['gpt-5']);
    expect(getMiniModel(conn)).toBe('gpt-5');
  });
});

// ============================================================
// getSummarizationModel (same logic, but separate function)
// ============================================================

describe('getSummarizationModel()', () => {
  it('returns same result as getMiniModel (shared implementation)', () => {
    const conn = makeConnection('copilot', [
      'gpt-5',
      'gpt-5-mini',
      'claude-sonnet-4.5',
    ]);
    expect(getSummarizationModel(conn)).toBe(getMiniModel(conn));
  });
});
