import { afterEach, describe, expect, it } from 'bun:test';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import {
  BLOCKED_PI_CREDENTIAL,
  blockedPiStoreProviders,
  connectionPiProvider,
  hasCustomEndpoint,
  PI_BUILTIN_PROVIDER_IDS,
  pickCustomEndpointUtilityModel,
  sessionModelProviderError,
  shouldStoreCredentialInPiStore,
  syncPiCredentialStore,
  type CredentialRoutingConfig,
} from './credential-routing.ts';
import {
  createTestPiRuntime,
  TEST_ENDPOINT_KEY,
  TEST_ENDPOINT_ORIGIN,
  TEST_ENDPOINT_URL,
} from './test-fixtures/pi-runtime.ts';

const openAiCompatible: CredentialRoutingConfig = {
  baseUrl: TEST_ENDPOINT_URL,
  customEndpoint: { api: 'openai-completions' },
  piAuth: { provider: 'openai', credential: { type: 'api_key', key: TEST_ENDPOINT_KEY } },
};

const anthropicCompatible: CredentialRoutingConfig = {
  baseUrl: TEST_ENDPOINT_URL,
  customEndpoint: { api: 'anthropic-messages' },
  piAuth: { provider: 'anthropic', credential: { type: 'api_key', key: TEST_ENDPOINT_KEY } },
};

/** A connection to OpenAI itself: the official base URL, no custom endpoint. */
const openAiConnection: CredentialRoutingConfig = {
  baseUrl: 'https://api.openai.com/v1',
  piAuthProvider: 'openai',
  piAuth: { provider: 'openai', credential: { type: 'api_key', key: TEST_ENDPOINT_KEY } },
};

const noop = () => {};

describe('hasCustomEndpoint', () => {
  it('needs both a base URL and the endpoint protocol', () => {
    expect(hasCustomEndpoint(openAiCompatible)).toBe(true);
    expect(hasCustomEndpoint({ ...openAiCompatible, baseUrl: '  ' })).toBe(false);
    expect(hasCustomEndpoint({ ...openAiCompatible, customEndpoint: undefined })).toBe(false);
    expect(hasCustomEndpoint(null)).toBe(false);
    expect(shouldStoreCredentialInPiStore(openAiCompatible)).toBe(false);
    expect(shouldStoreCredentialInPiStore({ piAuth: openAiCompatible.piAuth })).toBe(true);
  });
});

describe('connectionPiProvider', () => {
  it('is the provider of the credential, else the one the connection names, else the legacy key\'s', () => {
    expect(connectionPiProvider(openAiConnection)).toBe('openai');
    expect(connectionPiProvider({ piAuthProvider: 'amazon-bedrock' })).toBe('amazon-bedrock');
    expect(connectionPiProvider({ apiKey: 'sk-legacy' })).toBe('anthropic');
    expect(connectionPiProvider({ apiKey: 'sk-legacy', piAuthProvider: 'amazon-bedrock' })).toBe('amazon-bedrock');
  });

  it('is undefined for a custom endpoint and for a connection that names no provider', () => {
    expect(connectionPiProvider(openAiCompatible)).toBeUndefined();
    expect(connectionPiProvider({})).toBeUndefined();
    expect(connectionPiProvider(null)).toBeUndefined();
  });
});

describe('blockedPiStoreProviders', () => {
  const builtins = ['openai', 'anthropic', 'google', 'amazon-bedrock'];

  it('blocks every built-in provider but the connection\'s own', () => {
    expect(blockedPiStoreProviders(openAiConnection, builtins)).toEqual(['anthropic', 'google', 'amazon-bedrock']);
    // `environment` auth sends no credential, only the provider.
    expect(blockedPiStoreProviders({ piAuthProvider: 'amazon-bedrock' }, builtins)).toEqual(['openai', 'anthropic', 'google']);
  });

  it('blocks every built-in provider, plus the id its credential is labelled with, for a custom endpoint', () => {
    expect(blockedPiStoreProviders(openAiCompatible, builtins)).toEqual(builtins);
    expect(blockedPiStoreProviders({
      ...openAiCompatible,
      piAuth: { provider: 'some-gateway', credential: { type: 'api_key', key: TEST_ENDPOINT_KEY } },
    }, builtins)).toEqual([...builtins, 'some-gateway']);
    // Keyless local endpoints (no piAuth) get the same protection.
    expect(blockedPiStoreProviders({ ...openAiCompatible, piAuth: undefined }, builtins)).toEqual(builtins);
  });

  it('blocks every built-in provider when the connection\'s provider is one the Pi SDK doesn\'t know', () => {
    expect(blockedPiStoreProviders({ piAuthProvider: 'not-a-pi-provider' }, builtins)).toEqual(builtins);
  });

  it('blocks nothing when the connection names no provider', () => {
    expect(blockedPiStoreProviders({}, builtins)).toEqual([]);
  });

  it('defaults to every provider the Pi SDK has built in', () => {
    expect(PI_BUILTIN_PROVIDER_IDS).toContain('openai');
    expect(PI_BUILTIN_PROVIDER_IDS).toContain('anthropic');
    expect(PI_BUILTIN_PROVIDER_IDS).toContain('openai-codex');
    expect(blockedPiStoreProviders(openAiConnection)).toEqual(PI_BUILTIN_PROVIDER_IDS.filter(id => id !== 'openai'));
  });
});

describe('sessionModelProviderError', () => {
  it('accepts a model of the connection\'s provider, or of the endpoint for a custom endpoint', () => {
    expect(sessionModelProviderError('openai', openAiConnection)).toBeUndefined();
    expect(sessionModelProviderError('custom-endpoint', openAiCompatible)).toBeUndefined();
    expect(sessionModelProviderError(undefined, openAiConnection)).toBeUndefined();
    expect(sessionModelProviderError('anthropic', {})).toBeUndefined();
  });

  it('refuses a model of any other provider', () => {
    expect(sessionModelProviderError('anthropic', openAiConnection)).toContain('may only use openai');
    expect(sessionModelProviderError('openai', openAiCompatible)).toContain('may only use custom-endpoint');
  });
});

describe('syncPiCredentialStore', () => {
  it('keeps a custom endpoint key out of the store and blocks the vendors instead', async () => {
    const store = new InMemoryCredentialStore();
    await syncPiCredentialStore(store, openAiCompatible, noop);

    expect(await store.read('openai')).toBe(BLOCKED_PI_CREDENTIAL);
    expect(await store.read('anthropic')).toBe(BLOCKED_PI_CREDENTIAL);
    expect(JSON.stringify(await store.list())).not.toContain(TEST_ENDPOINT_KEY);
  });

  it('overwrites a key stored before the endpoint was configured (update_runtime_config)', async () => {
    const store = new InMemoryCredentialStore();
    await syncPiCredentialStore(store, { piAuth: openAiCompatible.piAuth }, noop);
    expect(await store.read('openai')).toEqual({ type: 'api_key', key: TEST_ENDPOINT_KEY });

    await syncPiCredentialStore(store, openAiCompatible, noop);
    expect(await store.read('openai')).toBe(BLOCKED_PI_CREDENTIAL);
  });

  it('stores the credential of a connection without a custom endpoint, as before', async () => {
    const store = new InMemoryCredentialStore();
    await syncPiCredentialStore(store, { piAuth: openAiCompatible.piAuth }, noop);
    expect(await store.read('openai')).toEqual({ type: 'api_key', key: TEST_ENDPOINT_KEY });

    const legacy = new InMemoryCredentialStore();
    await syncPiCredentialStore(legacy, { apiKey: 'sk-legacy' }, noop);
    expect(await legacy.read('anthropic')).toEqual({ type: 'api_key', key: 'sk-legacy' });
  });

  it('blocks every other provider of a connection without a custom endpoint', async () => {
    const store = new InMemoryCredentialStore();
    await syncPiCredentialStore(store, openAiConnection, noop);

    expect(await store.read('anthropic')).toBe(BLOCKED_PI_CREDENTIAL);
    expect(await store.read('openai-codex')).toBe(BLOCKED_PI_CREDENTIAL);
    expect(await store.read('openai')).toEqual({ type: 'api_key', key: TEST_ENDPOINT_KEY });
  });

  it('stores the legacy key only for a connection whose provider is Anthropic', async () => {
    const store = new InMemoryCredentialStore();
    await syncPiCredentialStore(store, { apiKey: 'sk-legacy', piAuthProvider: 'amazon-bedrock' }, noop);

    expect(await store.read('anthropic')).toBe(BLOCKED_PI_CREDENTIAL);
    expect(await store.read('amazon-bedrock')).toBeUndefined();
    expect(JSON.stringify(await store.list())).not.toContain('sk-legacy');
  });
});

describe('Pi SDK requests with the synced store', () => {
  const originalFetch = globalThis.fetch;
  const ambientOpenAiKey = process.env.OPENAI_API_KEY;
  const ambientAnthropicKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('OPENAI_API_KEY', ambientOpenAiKey);
    restoreEnv('ANTHROPIC_API_KEY', ambientAnthropicKey);
  });

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  /** Every request's origin and credential; each one fails like an offline network. */
  function recordRequests(): Array<{ origin: string; credential: string }> {
    const requests: Array<{ origin: string; credential: string }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input);
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
      const credential = headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? headers.get('x-api-key') ?? '-';
      requests.push({ origin: new URL(url).origin, credential });
      throw new Error('OFFLINE_FETCH_BLOCKED');
    }) as typeof fetch;
    return requests;
  }

  async function complete(runtime: Awaited<ReturnType<typeof createTestPiRuntime>>, provider: string, modelId: string) {
    const model = runtime.modelRegistry.find(provider, modelId);
    if (!model) throw new Error(`test setup: ${provider}/${modelId} is not in the Pi catalog`);
    return runtime.modelRuntime.completeSimple(model, {
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
    });
  }

  it.each([
    ['OpenAI', openAiCompatible, 'openai', 'gpt-5.5', 'OPENAI_API_KEY'],
    ['Anthropic', anthropicCompatible, 'anthropic', 'claude-opus-4-8', 'ANTHROPIC_API_KEY'],
  ] as const)('stops a built-in %s model before any request, even with an ambient env key', async (_vendor, cfg, provider, modelId, envVar) => {
    process.env[envVar] = 'sk-test-ambient-env-key';
    // Synced before the runtime is built, as createAuthenticatedRuntime does.
    const credentials = new InMemoryCredentialStore();
    await syncPiCredentialStore(credentials, cfg, noop);
    const runtime = await createTestPiRuntime({ credentials, endpointModels: ['endpoint-model'] });
    const requests = recordRequests();

    const result = await complete(runtime, provider, modelId);

    expect(requests).toEqual([]);
    expect(result.stopReason).toBe('error');
    // Nor may the SDK offer the vendor's models when it picks a default model.
    expect(runtime.modelRuntime.getAvailableSnapshot().filter(model => model.provider === provider)).toEqual([]);
  });

  it('still sends the endpoint its own key', async () => {
    const credentials = new InMemoryCredentialStore();
    await syncPiCredentialStore(credentials, openAiCompatible, noop);
    const runtime = await createTestPiRuntime({ credentials, endpointModels: ['endpoint-model'] });
    const requests = recordRequests();

    await complete(runtime, 'custom-endpoint', 'endpoint-model');

    expect(requests[0]).toEqual({ origin: TEST_ENDPOINT_ORIGIN, credential: TEST_ENDPOINT_KEY });
  });

  it('keeps a connection\'s session off another vendor\'s ambient env key, and on its own provider', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-ambient-env-key';
    const credentials = new InMemoryCredentialStore();
    await syncPiCredentialStore(credentials, openAiConnection, noop);
    const runtime = await createTestPiRuntime({ credentials });
    const requests = recordRequests();

    const blocked = await complete(runtime, 'anthropic', 'claude-opus-4-8');
    expect(requests).toEqual([]);
    expect(blocked.stopReason).toBe('error');
    expect(new Set(runtime.modelRuntime.getAvailableSnapshot().map(model => model.provider))).toEqual(new Set(['openai']));

    await complete(runtime, 'openai', 'gpt-5.5');
    expect(requests[0]).toEqual({ origin: 'https://api.openai.com', credential: TEST_ENDPOINT_KEY });
  });

  it('lets an environment-auth connection authenticate its own provider from the environment', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-ambient-env-key';
    process.env.ANTHROPIC_API_KEY = 'sk-test-other-vendor-key';
    const credentials = new InMemoryCredentialStore();
    await syncPiCredentialStore(credentials, { piAuthProvider: 'openai' }, noop);
    const runtime = await createTestPiRuntime({ credentials });
    const requests = recordRequests();

    await complete(runtime, 'anthropic', 'claude-opus-4-8');
    expect(requests).toEqual([]);

    await complete(runtime, 'openai', 'gpt-5.5');
    expect(requests[0]).toEqual({ origin: 'https://api.openai.com', credential: 'sk-test-ambient-env-key' });
  });

  // Why a blocking entry rather than storing nothing: with nothing stored for a provider,
  // the SDK authenticates from the environment and would send the user's own vendor key.
  it('uses an ambient env key when nothing is stored for the provider (Pi SDK behaviour)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-ambient-env-key';
    const runtime = await createTestPiRuntime();
    const requests = recordRequests();

    await complete(runtime, 'openai', 'gpt-5.5');

    expect(requests[0]).toEqual({ origin: 'https://api.openai.com', credential: 'sk-test-ambient-env-key' });
  });
});

describe('pickCustomEndpointUtilityModel', () => {
  const registered = ['endpoint-model', 'endpoint-mini'];
  const cfg = { model: 'endpoint-model', miniModel: 'endpoint-mini' };

  it('keeps a requested model the endpoint has', () => {
    expect(pickCustomEndpointUtilityModel('endpoint-model', cfg, registered)).toBe('endpoint-model');
    expect(pickCustomEndpointUtilityModel('pi/endpoint-model', cfg, registered)).toBe('pi/endpoint-model');
  });

  it('falls back to the mini model, then the session model, then the first registered model', () => {
    expect(pickCustomEndpointUtilityModel('gpt-6-astra', cfg, registered)).toBe('endpoint-mini');
    expect(pickCustomEndpointUtilityModel(undefined, cfg, registered)).toBe('endpoint-mini');
    expect(pickCustomEndpointUtilityModel('gpt-6-astra', { model: 'endpoint-model', miniModel: 'claude-haiku-4-5' }, registered))
      .toBe('endpoint-model');
    expect(pickCustomEndpointUtilityModel('gpt-6-astra', { model: 'retired-model' }, registered)).toBe('endpoint-model');
  });

  it('returns undefined when the endpoint has no model', () => {
    expect(pickCustomEndpointUtilityModel('gpt-6-astra', cfg, [])).toBeUndefined();
  });
});
