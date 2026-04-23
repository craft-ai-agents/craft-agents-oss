/**
 * Tests for model detection utilities in config/models.ts
 */
import { describe, it, expect } from 'bun:test';
import {
  isClaudeModel,
  isOpusModel,
  getModelShortName,
  getModelDisplayName,
  ANTHROPIC_MODELS,
  getModelIdByShortName,
} from '../src/config/models.ts';

describe('isClaudeModel', () => {
  // Direct Anthropic model IDs
  it('detects direct Anthropic Claude model IDs', () => {
    expect(isClaudeModel('claude-sonnet-4-6')).toBe(true);
    expect(isClaudeModel('claude-opus-4-7')).toBe(true);
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
    expect(isClaudeModel('anthropic.claude-opus-4-7-v1')).toBe(true);
    expect(isClaudeModel('anthropic.claude-sonnet-4-6')).toBe(true);
    expect(isClaudeModel('anthropic.claude-haiku-4-5-20251001-v1:0')).toBe(true);
  });

  // Case insensitivity
  it('handles case variations', () => {
    expect(isClaudeModel('Claude-Sonnet-4-6')).toBe(true);
    expect(isClaudeModel('CLAUDE-OPUS-4-7')).toBe(true);
    expect(isClaudeModel('Anthropic/Claude-Sonnet-4')).toBe(true);
  });
});

describe('getModelShortName', () => {
  it('returns registry shortName for known models', () => {
    expect(getModelShortName('claude-opus-4-7')).toBe('Opus');
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

// TODO(opus-4.6-sunset): drop this block when Opus 4.6 is deprecated.
describe('Opus 4.6 registry presence', () => {
  it('recognizes claude-opus-4-6 as a Claude model', () => {
    expect(isClaudeModel('claude-opus-4-6')).toBe(true);
  });

  it('recognizes claude-opus-4-6 as an Opus model', () => {
    expect(isOpusModel('claude-opus-4-6')).toBe(true);
  });

  it('returns Opus shortName for claude-opus-4-6', () => {
    expect(getModelShortName('claude-opus-4-6')).toBe('Opus');
  });

  it('returns "Opus 4.6" display name for claude-opus-4-6', () => {
    expect(getModelDisplayName('claude-opus-4-6')).toBe('Opus 4.6');
  });

  it('includes both claude-opus-4-7 and claude-opus-4-6 in ANTHROPIC_MODELS', () => {
    const ids = ANTHROPIC_MODELS.map(m => m.id);
    expect(ids).toContain('claude-opus-4-7');
    expect(ids).toContain('claude-opus-4-6');
  });

  it('resolves "Opus" shortName to 4.7 (first match wins)', () => {
    // 4.7 is listed first in MODEL_REGISTRY so default Opus callers unchanged.
    expect(getModelIdByShortName('Opus')).toBe('claude-opus-4-7');
  });
});
