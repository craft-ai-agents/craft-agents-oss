import { describe, it, expect } from 'bun:test';
import { getPiApiKeyProviders, getPiModelsForAuthProvider } from '../src/config/models-pi.ts';

describe('models-pi filtering', () => {
  it('excludes codex-mini-latest for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.includes('pi/codex-mini-latest')).toBe(false);
  });

  it('excludes all gpt-4* models for openai models', () => {
    const models = getPiModelsForAuthProvider('openai');
    const ids = models.map(m => m.id);
    expect(ids.some(id => id.startsWith('pi/gpt-4'))).toBe(false);
  });

  it('keeps Claude Opus 4.6 models in Anthropic catalogs', () => {
    // TODO(opus-4.6-sunset): flip these back to exclusion when 4.6 is deprecated.
    const anthropicIds = getPiModelsForAuthProvider('anthropic').map(m => m.id);
    expect(anthropicIds).toContain('pi/claude-opus-4-6');

    const bedrockIds = getPiModelsForAuthProvider('amazon-bedrock').map(m => m.id);
    expect(bedrockIds.some(id => id.includes('claude-opus-4-6'))).toBe(true);
  });

  it('includes DeepSeek in the Pi API key provider list with a human-readable label', () => {
    const providers = getPiApiKeyProviders();
    expect(providers.some(provider => provider.key === 'deepseek' && provider.label === 'DeepSeek')).toBe(true);
  });

  it('returns current DeepSeek models from the Pi SDK catalog', () => {
    const models = getPiModelsForAuthProvider('deepseek');
    const ids = models.map(m => m.id);
    expect(ids).toContain('pi/deepseek-v4-flash');
    expect(ids).toContain('pi/deepseek-v4-pro');
  });

  it('returns current Kimi Code models with K3 first-class metadata', () => {
    const models = getPiModelsForAuthProvider('kimi-coding');
    const ids = models.map(m => m.id);

    expect(ids).toEqual([
      'pi/k3',
      'pi/kimi-for-coding',
      'pi/kimi-for-coding-highspeed',
    ]);

    const k3 = models[0];
    expect(k3?.name).toBe('Kimi K3');
    expect(k3?.contextWindow).toBe(1_048_576);
    expect(k3?.supportsThinking).toBe(true);
    expect(k3?.supportsImages).toBe(true);
  });
});
