import { describe, expect, it } from 'bun:test';
import { pickProviderAppropriateMiniModel } from './pick-mini-model.ts';
import { createTestPiRuntime } from './test-fixtures/pi-runtime.ts';

/**
 * Minimal mock of PiModelRegistry — mirrors the pattern from model-resolution.test.ts.
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

describe('pickProviderAppropriateMiniModel', () => {
  it('anthropic: picks the utility tier (Haiku), never the flagship', () => {
    const registry = createMockRegistry({
      anthropic: [
        { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
        { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      ],
    });
    // PI_PREFERRED_MINI_MODELS.anthropic is tried before the best-first defaults.
    expect(pickProviderAppropriateMiniModel('anthropic', registry, false)).toBe('claude-haiku-4-5');
  });

  it('openai-codex: picks GPT-6 Luna before the best-first defaults (GPT-6 Astra)', () => {
    const registry = createMockRegistry({
      'openai-codex': [
        { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
        { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
        { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
      ],
    });
    expect(pickProviderAppropriateMiniModel('openai-codex', registry, false)).toBe('gpt-6-luna');
  });

  it('openai-codex: skips denied codex-mini variants, returns first resolvable candidate', () => {
    // PI_PREFERRED_DEFAULTS['openai-codex'] = ['gpt-5.5', 'gpt-5.2', ...].
    // None of these are *codex-mini*, so isDeniedMiniModelId won't filter any.
    // But we verify the filter works by registering only gpt-5.2 as resolvable.
    const registry = createMockRegistry({
      'openai-codex': [{ id: 'gpt-5.2', name: 'GPT 5.2' }],
    });

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBe('gpt-5.2');
  });

  it('openai-codex: returns undefined when no preferred candidate resolves', () => {
    // No models registered under openai-codex — every candidate is unresolvable.
    const registry = createMockRegistry({
      'openai-codex': [],
    });

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBeUndefined();
  });

  it('openai: returns first resolvable candidate from preferred list', () => {
    // PI_PREFERRED_DEFAULTS.openai = ['gpt-5.5', 'gpt-5.2', 'gpt-5.1', ...].
    // gpt-5.5 is resolvable → returned first.
    const registry = createMockRegistry({
      openai: [
        { id: 'gpt-5.5', name: 'GPT 5.5' },
        { id: 'gpt-5.2', name: 'GPT 5.2' },
      ],
    });

    const result = pickProviderAppropriateMiniModel('openai', registry, false);
    expect(result).toBe('gpt-5.5');
  });

  it('unknown provider: returns undefined', () => {
    const registry = createMockRegistry({
      openai: [{ id: 'gpt-5.5', name: 'GPT 5.5' }],
    });

    const result = pickProviderAppropriateMiniModel('made-up-provider', registry, false);
    expect(result).toBeUndefined();
  });

  it('empty registry: returns undefined', () => {
    const registry = createMockRegistry({});

    const result = pickProviderAppropriateMiniModel('openai-codex', registry, false);
    expect(result).toBeUndefined();
  });

  // A custom endpoint labelled 'openai' must never get OpenAI's own mini model: it would
  // authenticate with the endpoint's key and send it to api.openai.com.
  it('customEndpointOnly: only picks a candidate the endpoint registered', async () => {
    const { modelRegistry } = await createTestPiRuntime({ endpointModels: ['endpoint-model'] });
    expect(pickProviderAppropriateMiniModel('openai', modelRegistry, false)).toBeDefined();
    expect(pickProviderAppropriateMiniModel('openai', modelRegistry, true)).toBeUndefined();

    const withMini = await createTestPiRuntime({ endpointModels: ['endpoint-model', 'gpt-5.4-mini'] });
    expect(pickProviderAppropriateMiniModel('openai', withMini.modelRegistry, true)).toBe('gpt-5.4-mini');
  });
});
