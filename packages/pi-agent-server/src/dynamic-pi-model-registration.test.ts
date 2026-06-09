import { describe, expect, it } from 'bun:test';

/**
 * Integration tests for the dynamic Pi model registration pattern.
 *
 * When users add models not yet in the Pi SDK registry (e.g. glm-5.1, glm-5-turbo),
 * resolvePiModel() returns undefined. The registerDynamicPiModel() helper in index.ts
 * fixes this by cloning a reference model from the same provider and registering the
 * unknown model via registerProvider().
 *
 * These tests validate the pattern using the real Pi SDK ModelRegistry.
 */

// Use the actual Pi SDK's AuthStorage and ModelRegistry.
// Dynamic require avoids ESM/CJS resolution issues — these are JS-compiled modules.
import { join } from 'node:path';
const piCodingAgent = await import(join(import.meta.dir, '../node_modules/@mariozechner/pi-coding-agent/dist/index.js'));
const { AuthStorage, ModelRegistry } = piCodingAgent;

type PiModelRegistry = InstanceType<typeof ModelRegistry>;

/**
 * Replicate the registerDynamicPiModel pattern from index.ts for testing.
 * In production, this logic lives inside the pi-agent-server subprocess.
 */
function registerDynamicPiModel(
  registry: PiModelRegistry,
  bareId: string,
  piAuthProvider: string,
  apiKey: string,
): ReturnType<PiModelRegistry['find']> | undefined {
  const existing = registry.getAll().filter((m: any) => m.provider === piAuthProvider);
  if (existing.length === 0) return undefined;

  const ref = existing[0];

  const allModels = existing.map((m: any) => ({
    id: m.id, name: m.name, reasoning: m.reasoning,
    input: m.input, cost: m.cost, contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    ...(m.compat ? { compat: m.compat } : {}),
  }));
  allModels.push({
    id: bareId, name: bareId, reasoning: ref.reasoning,
    input: [...ref.input], cost: { ...ref.cost },
    contextWindow: ref.contextWindow, maxTokens: ref.maxTokens,
    ...(ref.compat ? { compat: ref.compat } : {}),
  });

  registry.registerProvider(piAuthProvider, {
    baseUrl: ref.baseUrl,
    api: ref.api,
    apiKey,
    models: allModels,
  });

  return registry.find(piAuthProvider, bareId) ?? undefined;
}

describe('dynamic Pi model registration', () => {
  function createZaiRegistry() {
    const authStorage = AuthStorage.inMemory();
    authStorage.set('zai', { type: 'api_key', key: 'test-key' });
    return new ModelRegistry(authStorage) as PiModelRegistry;
  }

  it('registers an unknown model under an existing provider', () => {
    const registry = createZaiRegistry();
    const before = registry.getAll().filter((m: any) => m.provider === 'zai');
    expect(before.length).toBeGreaterThan(0);

    // glm-5.1 is not in the SDK registry
    expect(registry.find('zai', 'glm-5.1')).toBeUndefined();

    const result = registerDynamicPiModel(registry, 'glm-5.1', 'zai', 'test-key');

    expect(result).toBeDefined();
    expect(result!.id).toBe('glm-5.1');
    expect(result!.provider).toBe('zai');
  });

  it('preserves existing models after dynamic registration', () => {
    const registry = createZaiRegistry();
    const existingIds = registry.getAll()
      .filter((m: any) => m.provider === 'zai')
      .map((m: any) => m.id);

    registerDynamicPiModel(registry, 'glm-5.1', 'zai', 'test-key');

    // All original models should still be findable
    for (const id of existingIds) {
      expect(registry.find('zai', id)).toBeDefined();
    }
  });

  it('inherits API type and base URL from reference model', () => {
    const registry = createZaiRegistry();
    const ref = registry.getAll().find((m: any) => m.provider === 'zai');

    const result = registerDynamicPiModel(registry, 'glm-5-turbo', 'zai', 'test-key');

    expect(result).toBeDefined();
    expect(result!.api).toBe(ref.api);
    expect(result!.baseUrl).toBe(ref.baseUrl);
  });

  it('inherits compat settings from reference model', () => {
    const registry = createZaiRegistry();
    const ref = registry.getAll().find((m: any) => m.provider === 'zai');

    const result = registerDynamicPiModel(registry, 'glm-5.1', 'zai', 'test-key');

    expect(result).toBeDefined();
    if (ref.compat) {
      expect(result!.compat).toEqual(ref.compat);
    }
  });

  it('returns undefined when provider has no existing models', () => {
    const registry = createZaiRegistry();

    // 'nonexistent-provider' has no models registered
    const result = registerDynamicPiModel(registry, 'some-model', 'nonexistent-provider', 'test-key');

    expect(result).toBeUndefined();
  });

  it('can register multiple unknown models sequentially', () => {
    const registry = createZaiRegistry();

    const r1 = registerDynamicPiModel(registry, 'glm-5.1', 'zai', 'test-key');
    const r2 = registerDynamicPiModel(registry, 'glm-5-turbo', 'zai', 'test-key');

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();

    // Both should be findable
    expect(registry.find('zai', 'glm-5.1')).toBeDefined();
    expect(registry.find('zai', 'glm-5-turbo')).toBeDefined();

    // Original models also preserved
    expect(registry.find('zai', 'glm-5')).toBeDefined();
    expect(registry.find('zai', 'glm-4.7')).toBeDefined();
  });

  it('resolves API key for dynamically registered model', async () => {
    const registry = createZaiRegistry();

    const result = registerDynamicPiModel(registry, 'glm-5.1', 'zai', 'test-key');
    expect(result).toBeDefined();

    const apiKey = await registry.getApiKey(result!);
    expect(apiKey).toBe('test-key');
  });
});
