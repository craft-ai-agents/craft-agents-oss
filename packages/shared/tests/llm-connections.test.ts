/**
 * Tests for LLM connection utilities (llm-connections.ts).
 *
 * Focuses on getMiniModel() / findSmallModel() — the provider-aware small
 * model resolution used for title generation, summarization, and call_llm.
 */
import { describe, it, expect } from 'bun:test';
import { getMiniModel, getSummarizationModel, isDeniedMiniModelId } from '../src/config/llm-connections.ts';
import type { LlmProviderType } from '../src/config/llm-connections.ts';

// ============================================================
// Helpers
// ============================================================

function makeConnection(providerType: LlmProviderType, models: string[], piAuthProvider?: string) {
  return { providerType, models, piAuthProvider };
}

// ============================================================
// getMiniModel / findSmallModel
// ============================================================

describe('getMiniModel()', () => {
  // --- Anthropic providers ---

  it('finds haiku for anthropic provider', () => {
    const conn = makeConnection('anthropic', [
      'claude-opus-4-7',
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
      'claude-opus-4-7',
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

// ============================================================
// Auth-flavor awareness — see isDeniedMiniModelId
// ============================================================

describe('getMiniModel() — auth-flavor awareness', () => {
  it('skips *codex-mini* variants under openai-codex auth', () => {
    // Reproduces the bug surfaced as:
    //   "The 'gpt-5.1-codex-mini' model is not supported when using Codex
    //    with a ChatGPT account."
    // The keyword search would otherwise pick gpt-5.1-codex-mini first.
    const conn = makeConnection(
      'pi',
      ['pi/gpt-5.2-codex', 'pi/gpt-5.1-codex-mini', 'pi/gpt-5-mini'],
      'openai-codex',
    );
    expect(getMiniModel(conn)).toBe('pi/gpt-5-mini');
  });

  it('still returns *codex-mini* variants under regular openai (API-key) auth', () => {
    const conn = makeConnection(
      'pi',
      ['pi/gpt-5.2-codex', 'pi/gpt-5.1-codex-mini'],
      'openai',
    );
    expect(getMiniModel(conn)).toBe('pi/gpt-5.1-codex-mini');
  });

  it('falls back to last allowed model when every mini candidate is denied', () => {
    const conn = makeConnection(
      'pi',
      ['pi/gpt-5', 'pi/gpt-5.1-codex-mini', 'pi/gpt-5.2-codex'],
      'openai-codex',
    );
    // No remaining mini/flash candidate after filtering → falls back to last
    // allowed model (gpt-5.2-codex).
    expect(getMiniModel(conn)).toBe('pi/gpt-5.2-codex');
  });
});

// ============================================================
// isDeniedMiniModelId — re-exported from this module so getMiniModel and
// the pi-agent-server queryLlm guard share one source of truth.
// ============================================================

describe('isDeniedMiniModelId()', () => {
  it('always denies codex-mini-latest', () => {
    expect(isDeniedMiniModelId('codex-mini-latest')).toBe(true);
    expect(isDeniedMiniModelId('pi/codex-mini-latest')).toBe(true);
    expect(isDeniedMiniModelId('codex-mini-latest', 'openai')).toBe(true);
  });

  it('denies *codex-mini* variants only under openai-codex auth', () => {
    expect(isDeniedMiniModelId('gpt-5.1-codex-mini', 'openai-codex')).toBe(true);
    expect(isDeniedMiniModelId('pi/gpt-5.1-codex-mini', 'openai-codex')).toBe(true);
    expect(isDeniedMiniModelId('gpt-5.1-codex-mini', 'openai')).toBe(false);
    expect(isDeniedMiniModelId('gpt-5.1-codex-mini')).toBe(false);
  });

  it('does not deny non-codex-mini models', () => {
    expect(isDeniedMiniModelId('gpt-5-mini', 'openai-codex')).toBe(false);
    expect(isDeniedMiniModelId('claude-haiku-4-5', 'openai-codex')).toBe(false);
    expect(isDeniedMiniModelId('gpt-5.1-codex', 'openai-codex')).toBe(false);
  });
});
