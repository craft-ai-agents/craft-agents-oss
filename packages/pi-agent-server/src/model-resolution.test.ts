import { describe, expect, it } from 'bun:test';
import {
  resolvePiModel,
  isDeniedMiniModelId,
  isModelNotFoundError,
  isModelRejectionError,
  isModelUsableWithAuth,
} from './model-resolution.ts';
import { createTestPiRuntime } from './test-fixtures/pi-runtime.ts';

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
  describe('customEndpointOnly', () => {
    it('returns custom-endpoint model when customEndpointOnly=true and model exists in both providers', () => {
      const registry = createMockRegistry({
        'custom-endpoint': [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'custom-endpoint' }],
        anthropic: [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'anthropic' }],
      });

      const result = resolvePiModel(registry, 'claude-sonnet-4-6', 'anthropic', true);
      expect(result).toBeDefined();
      expect(result!.provider).toBe('custom-endpoint');
    });

    it('returns anthropic model when customEndpointOnly=false', () => {
      const registry = createMockRegistry({
        'custom-endpoint': [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'custom-endpoint' }],
        anthropic: [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'anthropic' }],
      });

      const result = resolvePiModel(registry, 'claude-sonnet-4-6', 'anthropic', false);
      expect(result).toBeDefined();
      expect(result!.provider).toBe('anthropic');
    });

    // The endpoint is labelled 'anthropic' only for the request format: a built-in Anthropic
    // model would authenticate with the endpoint's key and send it to api.anthropic.com.
    it('never falls through to the provider the endpoint is labelled with', () => {
      const registry = createMockRegistry({
        'custom-endpoint': [],
        anthropic: [{ id: 'claude-sonnet-4-6', name: 'claude-sonnet-4-6', provider: 'anthropic' }],
      });

      expect(resolvePiModel(registry, 'claude-sonnet-4-6', 'anthropic', true)).toBeUndefined();
    });

    it('never scans other providers either', () => {
      const registry = createMockRegistry({
        'custom-endpoint': [],
        openai: [{ id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai' }],
      });

      expect(resolvePiModel(registry, 'gpt-5.5', undefined, true)).toBeUndefined();
      expect(resolvePiModel(registry, 'GPT-5.5', 'openai', true)).toBeUndefined();
    });
  });

  describe('customEndpointOnly with the Pi SDK catalog', () => {
    it.each([
      ['openai', 'gpt-6-astra', 'https://api.openai.com/v1'],
      ['anthropic', 'claude-haiku-5-5', 'https://api.anthropic.com'],
    ])('resolves %s/%s only without a custom endpoint', async (provider, modelId, officialBaseUrl) => {
      const { modelRegistry } = await createTestPiRuntime({ endpointModels: ['endpoint-model'] });

      const builtIn = resolvePiModel(modelRegistry, modelId, provider, false);
      expect(builtIn?.provider).toBe(provider);
      expect(builtIn?.baseUrl).toBe(officialBaseUrl);

      expect(resolvePiModel(modelRegistry, modelId, provider, true)).toBeUndefined();
      expect(resolvePiModel(modelRegistry, `pi/${modelId}`, provider, true)).toBeUndefined();
      expect(resolvePiModel(modelRegistry, 'endpoint-model', provider, true)?.provider).toBe('custom-endpoint');
    });
  });

  describe('exact provider lookup', () => {
    it('returns exact match for piAuthProvider', () => {
      const registry = createMockRegistry({
        openai: [{ id: 'gpt-5.2', name: 'GPT 5.2', provider: 'openai' }],
        'azure': [{ id: 'gpt-5.2', name: 'GPT 5.2', provider: 'azure' }],
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

  describe('provider-safe fallback', () => {
    it('does not return a model from an incompatible provider via getAll fallback', () => {
      // gpt-5.4 exists under azure but NOT github-copilot.
      // With github-copilot auth, the fallback must not return the azure model.
      const registry = createMockRegistry({
        'github-copilot': [{ id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex', provider: 'github-copilot' }],
        'azure': [{ id: 'gpt-5.4', name: 'GPT-5.4', provider: 'azure' }],
      });

      const result = resolvePiModel(registry, 'gpt-5.4', 'github-copilot');
      expect(result).toBeUndefined();
    });

    it('returns same-provider model from getAll fallback when exact lookup misses', () => {
      const registry = {
        find() {
          return undefined;
        },
        getAll() {
          return [{ id: 'gpt-5.4', name: 'GPT-5.4', provider: 'github-copilot' }];
        },
      } as any;

      const result = resolvePiModel(registry, 'gpt-5.4', 'github-copilot');
      expect(result).toBeDefined();
      expect(result!.provider).toBe('github-copilot');
    });

    it('allows custom-endpoint models regardless of piAuthProvider', () => {
      const registry = createMockRegistry({
        'custom-endpoint': [{ id: 'my-model', name: 'My Model', provider: 'custom-endpoint' }],
        'github-copilot': [],
      });

      const result = resolvePiModel(registry, 'my-model', 'github-copilot');
      expect(result).toBeDefined();
      expect(result!.provider).toBe('custom-endpoint');
    });

    it('does not filter by provider when piAuthProvider is not set', () => {
      const registry = createMockRegistry({
        'azure': [{ id: 'gpt-5.4', name: 'GPT-5.4', provider: 'azure' }],
      });

      const result = resolvePiModel(registry, 'gpt-5.4');
      expect(result).toBeDefined();
      expect(result!.provider).toBe('azure');
    });

    it('skips incompatible providers in the common-provider fallback loop', () => {
      // Model findable via the 'openai' common provider, but piAuthProvider is 'github-copilot'
      const registry = {
        find(provider: string, modelId: string) {
          if (provider === 'openai' && modelId === 'gpt-5.4') {
            return { id: 'gpt-5.4', name: 'GPT-5.4', provider: 'openai' };
          }
          return undefined;
        },
        getAll() { return []; },
      } as any;

      const result = resolvePiModel(registry, 'gpt-5.4', 'github-copilot');
      expect(result).toBeUndefined();
    });
  });
});

describe('isModelUsableWithAuth', () => {
  it('accepts only custom-endpoint models with a custom endpoint', () => {
    expect(isModelUsableWithAuth('custom-endpoint', 'openai', true)).toBe(true);
    expect(isModelUsableWithAuth('openai', 'openai', true)).toBe(false);
    expect(isModelUsableWithAuth('anthropic', undefined, true)).toBe(false);
  });

  it('otherwise accepts the authenticated provider and custom-endpoint models', () => {
    expect(isModelUsableWithAuth('openai', 'openai', false)).toBe(true);
    expect(isModelUsableWithAuth('custom-endpoint', 'openai', false)).toBe(true);
    expect(isModelUsableWithAuth('azure', 'github-copilot', false)).toBe(false);
    expect(isModelUsableWithAuth('azure', undefined, false)).toBe(true);
  });

  it('rejects an unresolved model', () => {
    expect(isModelUsableWithAuth(undefined, 'openai', false)).toBe(false);
    expect(isModelUsableWithAuth(undefined, undefined, true)).toBe(false);
  });
});

describe('isDeniedMiniModelId', () => {
  it('denies codex-mini-latest regardless of auth provider', () => {
    expect(isDeniedMiniModelId('codex-mini-latest')).toBe(true);
    expect(isDeniedMiniModelId('pi/codex-mini-latest')).toBe(true);
    expect(isDeniedMiniModelId('codex-mini-latest', 'openai')).toBe(true);
    expect(isDeniedMiniModelId('codex-mini-latest', 'openai-codex')).toBe(true);
  });

  it('denies *codex-mini* variants when piAuthProvider is openai-codex (ChatGPT account)', () => {
    expect(isDeniedMiniModelId('gpt-5.1-codex-mini', 'openai-codex')).toBe(true);
    expect(isDeniedMiniModelId('pi/gpt-5.1-codex-mini', 'openai-codex')).toBe(true);
    expect(isDeniedMiniModelId('gpt-5.2-codex-mini-preview', 'openai-codex')).toBe(true);
  });

  it('allows *codex-mini* variants when piAuthProvider is a regular openai API key', () => {
    expect(isDeniedMiniModelId('gpt-5.1-codex-mini', 'openai')).toBe(false);
    expect(isDeniedMiniModelId('pi/gpt-5.1-codex-mini', 'openai')).toBe(false);
  });

  it('allows non-codex-mini models under openai-codex auth', () => {
    expect(isDeniedMiniModelId('gpt-5.1-codex', 'openai-codex')).toBe(false);
    expect(isDeniedMiniModelId('gpt-5-mini', 'openai-codex')).toBe(false);
    expect(isDeniedMiniModelId('claude-haiku-4-5', 'openai-codex')).toBe(false);
  });

  it('treats unset piAuthProvider as unrestricted (only the hardcoded denylist applies)', () => {
    expect(isDeniedMiniModelId('gpt-5.1-codex-mini')).toBe(false);
    expect(isDeniedMiniModelId('gpt-5-mini')).toBe(false);
  });
});

describe('isModelNotFoundError', () => {
  it('matches the ChatGPT-account Codex refusal', () => {
    expect(
      isModelNotFoundError(
        "The 'gpt-5.1-codex-mini' model is not supported when using Codex with a ChatGPT account.",
      ),
    ).toBe(true);
  });

  it('matches classic OpenAI model_not_found shapes', () => {
    expect(isModelNotFoundError('The model `gpt-99` does not exist')).toBe(true);
    expect(isModelNotFoundError('Error code: model_not_found')).toBe(true);
    expect(isModelNotFoundError('No such model: foo-bar')).toBe(true);
    expect(isModelNotFoundError('The requested model is not available or does not exist')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isModelNotFoundError('MODEL_NOT_FOUND')).toBe(true);
    expect(isModelNotFoundError('Is Not Supported')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isModelNotFoundError('rate limit exceeded')).toBe(false);
    expect(isModelNotFoundError('invalid api key')).toBe(false);
    expect(isModelNotFoundError('')).toBe(false);
  });
});

describe('isModelRejectionError', () => {
  it('matches the Codex refusal that quotes the requested model', () => {
    expect(
      isModelRejectionError(
        "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.",
        'gpt-5.6-sol',
      ),
    ).toBe(true);
  });

  it('does NOT match a hosted-tool refusal that also says "is not supported"', () => {
    expect(isModelRejectionError("Hosted tool 'web_search' is not supported.", 'gpt-5.6-sol')).toBe(false);
    expect(isModelRejectionError("The 'web_search_preview' tool is not supported.", 'gpt-5.6-sol')).toBe(false);
  });

  it('matches unambiguous model shapes without requiring the model id', () => {
    expect(isModelRejectionError('Error code: model_not_found', 'gpt-5.6-sol')).toBe(true);
    expect(isModelRejectionError('No such model: foo-bar', 'gpt-5.6-sol')).toBe(true);
    expect(isModelRejectionError('The requested model is not available or does not exist', 'gpt-5.6-sol')).toBe(true);
  });

  it('matches ambiguous shapes only when the message names the model (case-insensitive)', () => {
    expect(isModelRejectionError('The model `GPT-5.6-SOL` does not exist', 'gpt-5.6-sol')).toBe(true);
    expect(isModelRejectionError('The model `gpt-99` does not exist', 'gpt-5.6-sol')).toBe(false);
  });

  it('does not match unrelated errors at all', () => {
    expect(isModelRejectionError('rate limit exceeded for gpt-5.6-sol', 'gpt-5.6-sol')).toBe(false);
    expect(isModelRejectionError('', 'gpt-5.6-sol')).toBe(false);
  });
});
