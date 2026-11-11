/**
 * Tests for model detection utilities in config/models.ts
 */
import { describe, it, expect } from 'bun:test';
import {
  isClaudeModel,
  getModelShortName,
  getModelDisplayName,
  getModelContextWindow,
  getModelById,
  ANTHROPIC_MODELS,
  getModelIdByShortName,
  normalizeDeprecatedModelId,
  isAdaptiveThinkingAlwaysOnModel,
  getDefaultSummarizationModel,
} from '../src/config/models.ts';

describe('isClaudeModel', () => {
  // Direct Anthropic model IDs
  it('detects direct Anthropic Claude model IDs', () => {
    expect(isClaudeModel('claude-sonnet-4-6')).toBe(true);
    expect(isClaudeModel('claude-opus-4-8')).toBe(true);
    expect(isClaudeModel('claude-haiku-4-5-20251001')).toBe(true);
    expect(isClaudeModel('claude-3-5-sonnet-20241022')).toBe(true);
  });

  // OpenRouter provider-prefixed Claude IDs
  it('detects OpenRouter-prefixed Claude model IDs', () => {
    expect(isClaudeModel('anthropic/claude-sonnet-4')).toBe(true);
    expect(isClaudeModel('anthropic/claude-opus-4-7')).toBe(true);
    expect(isClaudeModel('anthropic/claude-3.5-haiku')).toBe(true);
  });

  // Non-Claude models via OpenRouter
  it('rejects non-Claude OpenRouter models', () => {
    expect(isClaudeModel('openai/gpt-5')).toBe(false);
    expect(isClaudeModel('openai/gpt-4o')).toBe(false);
    expect(isClaudeModel('google/gemini-2.5-pro')).toBe(false);
    expect(isClaudeModel('meta-llama/llama-4-maverick')).toBe(false);
    expect(isClaudeModel('deepseek/deepseek-r1')).toBe(false);
    expect(isClaudeModel('mistralai/mistral-large')).toBe(false);
  });

  // Non-Claude models via Ollama (no provider prefix)
  it('rejects non-Claude Ollama models', () => {
    expect(isClaudeModel('llama3.2')).toBe(false);
    expect(isClaudeModel('deepseek-r1')).toBe(false);
    expect(isClaudeModel('qwen3-coder')).toBe(false);
    expect(isClaudeModel('mistral')).toBe(false);
    expect(isClaudeModel('gemma2')).toBe(false);
  });

  // Bedrock-native model IDs
  it('detects Bedrock-native Claude model IDs', () => {
    expect(isClaudeModel('anthropic.claude-opus-4-8')).toBe(true);
    expect(isClaudeModel('anthropic.claude-sonnet-4-6')).toBe(true);
    expect(isClaudeModel('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(true);
  });

  // Case insensitivity
  it('handles case variations', () => {
    expect(isClaudeModel('Claude-Sonnet-4-6')).toBe(true);
    expect(isClaudeModel('CLAUDE-OPUS-4-8')).toBe(true);
    expect(isClaudeModel('Anthropic/Claude-Sonnet-4')).toBe(true);
  });
});

describe('getModelShortName', () => {
  it('returns registry shortName for known models', () => {
    expect(getModelShortName('claude-opus-4-8')).toBe('Opus');
    expect(getModelShortName('claude-sonnet-4-6')).toBe('Sonnet');
    expect(getModelShortName('claude-haiku-4-5-20251001')).toBe('Haiku');
  });

  it('strips provider prefix for slash-separated IDs', () => {
    expect(getModelShortName('openai/gpt-5.4')).toBe('gpt-5.4');
    expect(getModelShortName('anthropic/claude-sonnet-4')).toBe('claude-sonnet-4');
  });

  it('preserves version numbers for custom endpoint models', () => {
    expect(getModelShortName('gpt-5.4')).toBe('Gpt 5.4');
    expect(getModelShortName('gpt-5.2')).toBe('Gpt 5.2');
    expect(getModelShortName('glm-4.7')).toBe('Glm 4.7');
  });

  it('humanizes bare model names without versions', () => {
    expect(getModelShortName('mistral')).toBe('Mistral');
    expect(getModelShortName('gemma2')).toBe('Gemma2');
  });

  it('humanizes multi-part model names', () => {
    expect(getModelShortName('mistral-large')).toBe('Mistral large');
    expect(getModelShortName('deepseek-r1')).toBe('Deepseek r1');
  });

  it('strips date suffix for unknown claude models', () => {
    expect(getModelShortName('claude-sonnet-3-5-20241022')).toBe('Sonnet 3.5');
  });
});

describe('Opus registry', () => {
  it('lists Opus 5.5 first, then Opus 5, 4.8, 4.7 and 4.6', () => {
    const opusIds = ANTHROPIC_MODELS.map(m => m.id).filter(id => id.startsWith('claude-opus-'));
    expect(opusIds).toEqual(['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6']);
  });

  it('resolves "Opus" shortName to 5.5 (the default for new connections)', () => {
    expect(getModelIdByShortName('Opus')).toBe('claude-opus-5-5');
  });

  it('exposes Opus 5.5 and Opus 5 metadata', () => {
    expect(getModelDisplayName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(getModelShortName('claude-opus-5-5')).toBe('Opus');
    expect(getModelContextWindow('claude-opus-5-5')).toBe(1_000_000);
    expect(getModelById('claude-opus-5-5')?.thinkingAlwaysOn).toBe(true);
    expect(getModelDisplayName('claude-opus-5')).toBe('Opus 5');
    expect(getModelContextWindow('claude-opus-5')).toBe(1_000_000);
    expect(getModelById('claude-opus-5')?.thinkingAlwaysOn).toBeUndefined();
    expect(getModelById('claude-opus-4-8')?.thinkingAlwaysOn).toBeUndefined();
  });

  it('maps Bedrock Opus 5.5 / Opus 5 IDs back to the bare IDs without cross-mapping', () => {
    expect(getModelById('us.anthropic.claude-opus-5-5')?.id).toBe('claude-opus-5-5');
    expect(getModelById('eu.anthropic.claude-opus-5-5')?.id).toBe('claude-opus-5-5');
    expect(getModelById('anthropic.claude-opus-5')?.id).toBe('claude-opus-5');
    expect(getModelById('global.anthropic.claude-opus-5')?.id).toBe('claude-opus-5');
  });

  it('normalizes deprecated Opus IDs to Opus 4.8 without migrating Opus 4.7 or 4.6', () => {
    expect(normalizeDeprecatedModelId('claude-opus-4-5-20251101')).toBe('claude-opus-4-8');
    expect(normalizeDeprecatedModelId('claude-opus-4-7')).toBe('claude-opus-4-7');
    expect(normalizeDeprecatedModelId('claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(normalizeDeprecatedModelId('pi/claude-opus-4-6')).toBe('pi/claude-opus-4-6');
    expect(normalizeDeprecatedModelId('us.anthropic.claude-opus-4-6-v1')).toBe('us.anthropic.claude-opus-4-6-v1');
  });

  it('migrates the retired DeepSeek v4 Flash aliases to deepseek-flash (pi 0.86+ catalog)', () => {
    expect(normalizeDeprecatedModelId('deepseek-v4-flash')).toBe('deepseek-flash');
    expect(normalizeDeprecatedModelId('pi/deepseek-v4-flash')).toBe('pi/deepseek-flash');
    expect(normalizeDeprecatedModelId('pi/deepseek-v4-flash-vision-exp')).toBe('pi/deepseek-flash');
    expect(normalizeDeprecatedModelId('deepseek-v4-pro')).toBe('deepseek-v4-pro');
  });
});

describe('Sonnet registry', () => {
  it('includes Sonnet 5 and keeps Sonnet 4.6', () => {
    const ids = ANTHROPIC_MODELS.map(m => m.id);
    expect(ids).toContain('claude-sonnet-5');
    expect(ids).toContain('claude-sonnet-4-6');
  });

  it('resolves "Sonnet" shortName to Sonnet 5.5', () => {
    expect(getModelIdByShortName('Sonnet')).toBe('claude-sonnet-5-5');
  });

  it('registers the 5.5 Sonnet and Haiku as adaptive-only, 1M-context models', () => {
    for (const id of ['claude-sonnet-5-5', 'claude-haiku-5-5']) {
      expect(getModelContextWindow(id)).toBe(1_000_000);
      expect(isAdaptiveThinkingAlwaysOnModel(id)).toBe(true);
      expect(isAdaptiveThinkingAlwaysOnModel(`pi/${id}`)).toBe(true);
      expect(isAdaptiveThinkingAlwaysOnModel(`us.anthropic.${id}`)).toBe(true);
    }
    expect(getModelDisplayName('claude-haiku-5-5')).toBe('Haiku 5.5');
    // Previous generations keep accepting `thinking: disabled`.
    expect(isAdaptiveThinkingAlwaysOnModel('claude-sonnet-5')).toBe(false);
    expect(isAdaptiveThinkingAlwaysOnModel('claude-haiku-4-5-20251001')).toBe(false);
  });

  it('makes Haiku 5.5 the default summarization model', () => {
    expect(getDefaultSummarizationModel()).toBe('claude-haiku-5-5');
  });

  it('exposes Sonnet 5 metadata', () => {
    expect(getModelDisplayName('claude-sonnet-5')).toBe('Sonnet 5');
    expect(getModelShortName('claude-sonnet-5')).toBe('Sonnet');
    expect(getModelContextWindow('claude-sonnet-5')).toBe(1_000_000);
  });

  it('maps Bedrock Sonnet 5 IDs back to the bare ID', () => {
    expect(getModelById('us.anthropic.claude-sonnet-5')?.id).toBe('claude-sonnet-5');
    expect(getModelById('anthropic.claude-sonnet-5')?.id).toBe('claude-sonnet-5');
  });
});

describe('isAdaptiveThinkingAlwaysOnModel', () => {
  it('flags the registered always-on models in every id form', () => {
    for (const id of [
      'claude-opus-5-5', 'pi/claude-opus-5-5',
      'us.anthropic.claude-opus-5-5', 'eu.anthropic.claude-opus-5-5', 'anthropic.claude-opus-5-5',
      // Region prefixes the Bedrock tables do not list still resolve by suffix.
      'au.anthropic.claude-opus-5-5', 'pi/jp.anthropic.claude-opus-5-5',
      'claude-fable-5-2', 'pi/claude-fable-5-2', 'us.anthropic.claude-fable-5-2',
      'claude-fable-5-1', 'claude-fable-5', 'pi/claude-fable-5-1',
    ]) {
      expect(isAdaptiveThinkingAlwaysOnModel(id)).toBe(true);
    }
  });

  it('keeps the Fable/Mythos family regex as a fallback for unregistered ids', () => {
    expect(isAdaptiveThinkingAlwaysOnModel('claude-mythos-5-1')).toBe(true);
    expect(isAdaptiveThinkingAlwaysOnModel('anthropic/claude-mythos-5')).toBe(true);
  });

  it('covers unregistered Opus 5.5 variants by pattern (dated snapshots, provider prefixes)', () => {
    for (const id of [
      // A dated snapshot surfaced by /v1/models before the registry knows it.
      'claude-opus-5-5-20260922', 'pi/claude-opus-5-5-20260922',
      // Bedrock-style dated id that the suffix match cannot resolve.
      'us.anthropic.claude-opus-5-5-20260922-v1:0',
      // Provider-prefixed form (OpenRouter-style).
      'anthropic/claude-opus-5-5',
    ]) {
      expect(isAdaptiveThinkingAlwaysOnModel(id)).toBe(true);
    }
  });

  it('leaves models that still accept thinking.type disabled alone', () => {
    for (const id of [
      'claude-opus-5', 'us.anthropic.claude-opus-5', 'pi/claude-opus-5',
      // A dated Opus 5 snapshot must not be caught by the Opus 5.5 pattern.
      'claude-opus-5-20260601', 'us.anthropic.claude-opus-5-20260601-v1:0',
      'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-5', 'claude-haiku-4-5-20251001',
      'gpt-6-astra',
    ]) {
      expect(isAdaptiveThinkingAlwaysOnModel(id)).toBe(false);
    }
  });
});
