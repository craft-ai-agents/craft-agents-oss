import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { buildCustomEndpointModelDef, type CustomEndpointApi } from '../custom-endpoint-models.ts';

export const TEST_ENDPOINT_URL = 'https://llm.example.com/v1';
export const TEST_ENDPOINT_ORIGIN = 'https://llm.example.com';
export const TEST_ENDPOINT_KEY = 'sk-test-endpoint-key';

/**
 * A real in-memory Pi runtime + registry, built like index.ts createAuthenticatedRuntime:
 * the full built-in catalog, plus a 'custom-endpoint' provider when `endpointModels`
 * are given.
 */
export async function createTestPiRuntime(options: {
  credentials?: InMemoryCredentialStore;
  api?: CustomEndpointApi;
  endpointModels?: string[];
} = {}) {
  const credentials = options.credentials ?? new InMemoryCredentialStore();
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    modelsStore: new InMemoryModelsStore(),
  });
  const modelRegistry = new ModelRegistry(modelRuntime);
  if (options.endpointModels?.length) {
    const api = options.api ?? 'openai-completions';
    modelRegistry.registerProvider('custom-endpoint', {
      baseUrl: TEST_ENDPOINT_URL,
      apiKey: TEST_ENDPOINT_KEY,
      api,
      authHeader: true,
      models: options.endpointModels.map(id => buildCustomEndpointModelDef(id, undefined, undefined, api)),
    });
  }
  return { credentials, modelRuntime, modelRegistry };
}
