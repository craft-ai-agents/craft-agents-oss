import { describe, expect, it } from 'bun:test';
import { resolvePiModel } from './model-resolution.ts';

/**
 * Minimal mock of PiModelRegistry.
 * Maps provider → modelId → model object.
 */
function createMockRegistry(
  providers: Record<string, Array<{ id: string; name: string; provider?: string }>>,
) {
  const allModels = Object.entries(providers).flatMap(([provider, models]) =>
    models.map(m => ({ ...m, provider })),
  );

  return {
    find(provider: string, modelId: string) {
      const models = providers[provider];
      if (!models) return undefined;
      return models.find(m => m.id === modelId || m.name === modelId) ?? undefined;
    },
    getAll() {
      return allModels;
    },
  } as any;
}

describe('resolvePiModel', () => {
  describe('preferCustomEndpoint', () => {
    it('returns custom-endpoint model when preferCustomEndpoint=true and model exists in both providers', () => {
      const registry = createMockRegistry({
        'custom-endpoint': [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'custom-endpoint' }],
        anthropic: [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'anthropic' }],
      });

      const result = resolvePiModel(registry, 'claude-sonnet-4-6', 'anthropic', true);
      expect(result).toBeDefined();
      expect(result!.provider).toBe('custom-endpoint');
    });

    it('returns anthropic model when preferCustomEndpoint=false', () => {
      const registry = createMockRegistry({
        'custom-endpoint': [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'custom-endpoint' }],
        anthropic: [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'anthropic' }],
      });

      const result = resolvePiModel(registry, 'claude-sonnet-4-6', 'anthropic', false);
      expect(result).toBeDefined();
      expect(result!.provider).toBe('anthropic');
    });

    it('falls through to piAuthProvider when preferCustomEndpoint=true but model not in custom-endpoint', () => {
      const registry = createMockRegistry({
        'custom-endpoint': [],
        anthropic: [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'anthropic' }],
      });

      const result = resolvePiModel(registry, 'claude-sonnet-4-6', 'anthropic', true);
      expect(result).toBeDefined();
      expect(result!.provider).toBe('anthropic');
    });
  });

  describe('exact provider lookup', () => {
    it('returns exact match for piAuthProvider', () => {
      const registry = createMockRegistry({
        openai: [{ id: 'gpt-5.2', name: 'GPT 5.2', provider: 'openai' }],
        'azure-openai-responses': [{ id: 'gpt-5.2', name: 'GPT 5.2', provider: 'azure-openai-responses' }],
      });

      const result = resolvePiModel(registry, 'gpt-5.2', 'openai');
      expect(result).toBeDefined();
      expect(result!.provider).toBe('openai');
    });

    it('strips MiniMax- prefix for minimax-cn provider', () => {
      const registry = createMockRegistry({
        'minimax-cn': [{ id: 'MiniMax-M2.5-highspeed', name: 'MiniMax-M2.5-highspeed', provider: 'minimax-cn' }],
      });

      const result = resolvePiModel(registry, 'MiniMax-M2.5-highspeed', 'minimax-cn');
      expect(result).toBeDefined();
      expect(result!.id).toBe('M2.5-highspeed');
    });
  });

  describe('pi/ prefix stripping', () => {
    it('strips pi/ prefix from model ID', () => {
      const registry = createMockRegistry({
        anthropic: [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'anthropic' }],
      });

      const result = resolvePiModel(registry, 'pi/claude-sonnet-4-6', 'anthropic');
      expect(result).toBeDefined();
      expect(result!.id).toBe('claude-sonnet-4-6');
    });
  });

  describe('provider synthesis for SDK version skew', () => {
    it('synthesizes a model for piAuthProvider when model only exists under a different provider', () => {
      // Simulates: pi-agent-server pi-ai v0.56.2 lacks "gpt-5.4" under github-copilot,
      // but finds it under azure-openai-responses. Should NOT return azure-openai-responses model.
      const registry = createMockRegistry({
        'github-copilot': [
          { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'github-copilot', api: 'openai-responses' } as any,
        ],
        'azure-openai-responses': [
          { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'azure-openai-responses', api: 'azure-openai-responses' } as any,
        ],
      });

      const result = resolvePiModel(registry, 'gpt-5.4', 'github-copilot');
      expect(result).toBeDefined();
      expect(result!.id).toBe('gpt-5.4');
      expect(result!.provider).toBe('github-copilot');
    });

    it('synthesizes using same-api-type template when available', () => {
      const registry = createMockRegistry({
        'github-copilot': [
          { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'github-copilot', api: 'anthropic-messages' } as any,
          { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'github-copilot', api: 'openai-responses' } as any,
        ],
        'azure-openai-responses': [
          { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'azure-openai-responses', api: 'azure-openai-responses' } as any,
        ],
      });

      // gpt-5.4 found under azure with api 'azure-openai-responses'.
      // No github-copilot model has that exact api, so falls back to any copilot template.
      const result = resolvePiModel(registry, 'gpt-5.4', 'github-copilot');
      expect(result).toBeDefined();
      expect(result!.provider).toBe('github-copilot');
      expect(result!.id).toBe('gpt-5.4');
    });

    it('synthesizes unknown model (like "auto") using provider template', () => {
      const registry = createMockRegistry({
        'github-copilot': [
          { id: 'gpt-5.1', name: 'GPT-5.1', provider: 'github-copilot', api: 'openai-responses' } as any,
        ],
        openrouter: [
          { id: 'auto', name: 'Auto', provider: 'openrouter', api: 'openai-completions' } as any,
        ],
      });

      const result = resolvePiModel(registry, 'auto', 'github-copilot');
      expect(result).toBeDefined();
      expect(result!.id).toBe('auto');
      expect(result!.provider).toBe('github-copilot');
    });

    it('returns undefined when piAuthProvider has no models to use as template', () => {
      const registry = createMockRegistry({
        'github-copilot': [],
      });

      const result = resolvePiModel(registry, 'unknown-model', 'github-copilot');
      expect(result).toBeUndefined();
    });
  });

  describe('fallback chain', () => {
    it('falls through getAll scan when no exact match', () => {
      const registry = createMockRegistry({
        google: [{ id: 'gemini-pro', name: 'Gemini Pro', provider: 'google' }],
      });

      const result = resolvePiModel(registry, 'gemini-pro');
      expect(result).toBeDefined();
      expect(result!.id).toBe('gemini-pro');
    });

    it('tries common providers in fallback list (custom-endpoint first)', () => {
      // Model not in getAll by id/name match, but findable via provider lookup
      const registry = {
        find(provider: string, modelId: string) {
          if (provider === 'custom-endpoint' && modelId === 'my-model') {
            return { id: 'my-model', name: 'My Model', provider: 'custom-endpoint' };
          }
          return undefined;
        },
        getAll() {
          return [];
        },
      } as any;

      const result = resolvePiModel(registry, 'my-model');
      expect(result).toBeDefined();
      expect(result!.provider).toBe('custom-endpoint');
    });

    it('returns undefined when model not found anywhere', () => {
      const registry = createMockRegistry({
        anthropic: [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6' }],
      });

      const result = resolvePiModel(registry, 'nonexistent-model');
      expect(result).toBeUndefined();
    });
  });
});
