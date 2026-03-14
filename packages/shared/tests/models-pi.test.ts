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

  it('exposes OpenCode Zen and OpenCode Go in Pi API key providers', () => {
    const providers = getPiApiKeyProviders();
    expect(providers).toContainEqual({
      key: 'opencode',
      label: 'OpenCode Zen',
      placeholder: 'Paste your key here...',
    });
    expect(providers).toContainEqual({
      key: 'opencode-go',
      label: 'OpenCode Go',
      placeholder: 'Paste your key here...',
    });
  });

  it('loads models for OpenCode Zen and OpenCode Go', () => {
    expect(getPiModelsForAuthProvider('opencode').length).toBeGreaterThan(0);
    expect(getPiModelsForAuthProvider('opencode-go').length).toBeGreaterThan(0);
  });
});
