import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  createLiveSearchProvider,
  resolveSearchProvider,
  type SearchConnectionConfig,
  type SearchProviderAuthConfig,
} from './resolve-provider.ts';
import { ResponsesApiSearchProvider } from './providers/openai.ts';
import { ChatGPTBackendSearchProvider } from './providers/chatgpt.ts';
import { GoogleSearchProvider } from './providers/google.ts';
import { DDGSearchProvider } from './providers/ddg.ts';
import type { WebSearchProvider } from './types.ts';

/** Build a minimal JWT with a chatgpt_account_id claim. */
function makeJwt(accountId: string): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: accountId },
    }),
  );
  return `${header}.${payload}.fakesig`;
}

describe('resolveSearchProvider', () => {
  // --- OpenAI (API key) ---

  it('selects ResponsesApiSearchProvider for openai + api_key', () => {
    const provider = resolveSearchProvider({
      piAuth: { provider: 'openai', credential: { type: 'api_key', key: 'sk-test' } },
    });

    expect(provider).toBeInstanceOf(ResponsesApiSearchProvider);
    expect(provider.name).toBe('OpenAI');
  });

  // --- ChatGPT Plus (OAuth) ---

  it('selects ChatGPTBackendSearchProvider for openai-codex + oauth with valid JWT', () => {
    const provider = resolveSearchProvider({
      piAuth: {
        provider: 'openai-codex',
        credential: {
          type: 'oauth',
          access: makeJwt('acc_123'),
          refresh: 'r',
          expires: Date.now() + 60_000,
        },
      },
    });

    expect(provider).toBeInstanceOf(ChatGPTBackendSearchProvider);
    expect(provider.name).toBe('ChatGPT');
  });

  it('selects ChatGPTBackendSearchProvider for openai-codex + api_key with valid JWT token', () => {
    const provider = resolveSearchProvider({
      piAuth: { provider: 'openai-codex', credential: { type: 'api_key', key: makeJwt('acc_999') } },
    });

    expect(provider).toBeInstanceOf(ChatGPTBackendSearchProvider);
    expect(provider.name).toBe('ChatGPT');
  });

  it('falls back to DDG for openai-codex + oauth with malformed JWT', () => {
    const provider = resolveSearchProvider({
      piAuth: {
        provider: 'openai-codex',
        credential: {
          type: 'oauth',
          access: 'not-a-jwt',
          refresh: 'r',
          expires: Date.now() + 60_000,
        },
      },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG for openai-codex + api_key with malformed non-JWT token', () => {
    const provider = resolveSearchProvider({
      piAuth: { provider: 'openai-codex', credential: { type: 'api_key', key: 'not-a-jwt' } },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  // --- OpenRouter ---

  it('selects ResponsesApiSearchProvider for openrouter + api_key', () => {
    const provider = resolveSearchProvider({
      piAuth: { provider: 'openrouter', credential: { type: 'api_key', key: 'sk-or-test' } },
    });

    expect(provider).toBeInstanceOf(ResponsesApiSearchProvider);
    expect(provider.name).toBe('OpenRouter');
  });

  // --- Google ---

  it('selects Google provider for google + api_key', () => {
    const provider = resolveSearchProvider({
      piAuth: { provider: 'google', credential: { type: 'api_key', key: 'g-test' } },
    });

    expect(provider).toBeInstanceOf(GoogleSearchProvider);
  });

  // --- Fallback cases ---

  it('falls back to DDG for openai + oauth (no ChatGPT backend for plain openai)', () => {
    const provider = resolveSearchProvider({
      piAuth: {
        provider: 'openai',
        credential: {
          type: 'oauth',
          access: 'a',
          refresh: 'r',
          expires: Date.now() + 60_000,
        },
      },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG when provider is unknown', () => {
    const provider = resolveSearchProvider({
      piAuth: { provider: 'unknown', credential: { type: 'api_key', key: 'x' } },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG when key is empty', () => {
    const provider = resolveSearchProvider({
      piAuth: { provider: 'openai', credential: { type: 'api_key', key: '' } },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG when no piAuth is provided', () => {
    expect(resolveSearchProvider()).toBeInstanceOf(DDGSearchProvider);
    expect(resolveSearchProvider({})).toBeInstanceOf(DDGSearchProvider);
    expect(resolveSearchProvider({ piAuth: undefined })).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG for github-copilot (no search API available)', () => {
    const provider = resolveSearchProvider({
      piAuth: {
        provider: 'github-copilot',
        credential: {
          type: 'oauth',
          access: 'ghu_token',
          refresh: 'r',
          expires: Date.now() + 60_000,
        },
      },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to DDG for vercel-ai-gateway (not yet wired for provider-native search)', () => {
    const provider = resolveSearchProvider({
      piAuth: { provider: 'vercel-ai-gateway', credential: { type: 'api_key', key: 'vercel-test-key' } },
    });

    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });
});

// --- Credential routing: a key only goes to the origin configured for it ---

const KEY = 'sk-test-endpoint-key';
const CUSTOM_BASE_URL = 'https://llm.example.com/v1';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface CredentialRequest {
  url: string;
  origin: string;
  credential: string;
}

function apiKeyAuth(provider: string, key = KEY): SearchProviderAuthConfig {
  return { provider, credential: { type: 'api_key', key } };
}

function fakeSearchResponse(url: URL): Response {
  const body = url.origin === 'https://generativelanguage.googleapis.com'
    ? {
      candidates: [{
        content: { parts: [{ text: 'Craft Agents' }] },
        groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/', title: 'Example' } }] },
      }],
    }
    : {
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: 'Craft Agents',
          annotations: [{ type: 'url_citation', url: 'https://example.com/', title: 'Example' }],
        }],
      }],
    };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Runs one search with fetch stubbed and returns every request that carried a credential
 * (bearer token or Google API key header). DuckDuckGo takes no credential; it is stubbed
 * so the tests never reach the network.
 */
async function credentialRequestsOf(provider: WebSearchProvider): Promise<CredentialRequest[]> {
  const requests: CredentialRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const credential = headers.get('authorization')?.replace(/^Bearer /, '') ?? headers.get('x-goog-api-key');
    if (credential) requests.push({ url: url.href, origin: url.origin, credential });
    return fakeSearchResponse(url);
  }) as typeof fetch;
  const ddgSearch = spyOn(DDGSearchProvider.prototype, 'search').mockResolvedValue([]);
  try {
    await provider.search('craft agents', 3);
  } finally {
    ddgSearch.mockRestore();
  }
  return requests;
}

describe('resolveSearchProvider credential routing', () => {
  it('searches with DuckDuckGo, never OpenAI, for an OpenAI-compatible custom endpoint', async () => {
    const provider = resolveSearchProvider({ piAuth: apiKeyAuth('openai'), baseUrl: CUSTOM_BASE_URL });

    expect(await credentialRequestsOf(provider)).toEqual([]);
    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it.each([
    ['no base URL', undefined],
    ['a blank base URL', '   '],
    ['the official API', 'https://api.openai.com/v1'],
    ['the official API without a path', 'https://api.openai.com'],
  ])('searches OpenAI natively with %s', async (_label, baseUrl) => {
    const provider = resolveSearchProvider({ piAuth: apiKeyAuth('openai'), baseUrl });

    expect(await credentialRequestsOf(provider)).toEqual([
      { url: 'https://api.openai.com/v1/responses', origin: 'https://api.openai.com', credential: KEY },
    ]);
  });

  it.each([
    'https://eu.api.openai.com/v1',
    'https://us.api.openai.com/v1',
  ])('keeps OpenAI search on the data-residency host %s', async (baseUrl) => {
    const origin = new URL(baseUrl).origin;
    const provider = resolveSearchProvider({ piAuth: apiKeyAuth('openai'), baseUrl });

    expect(await credentialRequestsOf(provider)).toEqual([
      { url: `${origin}/v1/responses`, origin, credential: KEY },
    ]);
  });

  it.each([
    ['a look-alike host', 'https://api.openai.com.evil.example/v1'],
    ['the official host as a path', 'https://evil.example/api.openai.com/v1'],
    ['plain http', 'http://api.openai.com/v1'],
    ['a blob: URL around the official host', 'blob:https://api.openai.com/v1'],
    ['another port', 'https://api.openai.com:8443/v1'],
    ['an unparseable URL', 'api.openai.com is not a url'],
  ])('falls back to DuckDuckGo for %s', async (_label, baseUrl) => {
    const provider = resolveSearchProvider({ piAuth: apiKeyAuth('openai'), baseUrl });

    expect(await credentialRequestsOf(provider)).toEqual([]);
    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  it.each([
    ['openrouter', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/responses'],
    [
      'google',
      'https://generativelanguage.googleapis.com/v1beta',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    ],
  ])('searches %s natively on its official base URL', async (providerId, baseUrl, searchUrl) => {
    const provider = resolveSearchProvider({ piAuth: apiKeyAuth(providerId), baseUrl });

    expect(await credentialRequestsOf(provider)).toEqual([
      { url: searchUrl, origin: new URL(searchUrl).origin, credential: KEY },
    ]);
  });

  it.each(['openrouter', 'google'])('falls back to DuckDuckGo for %s with a custom base URL', async (providerId) => {
    const provider = resolveSearchProvider({ piAuth: apiKeyAuth(providerId), baseUrl: CUSTOM_BASE_URL });

    expect(await credentialRequestsOf(provider)).toEqual([]);
    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });

  // openai-codex is deliberately unaffected by the base URL: its ChatGPT sign-in token is
  // only valid for chatgpt.com, the backend it is already sent to.
  it('keeps the ChatGPT token on chatgpt.com whatever the base URL', async () => {
    const token = makeJwt('acc_123');
    const provider = resolveSearchProvider({ piAuth: apiKeyAuth('openai-codex', token), baseUrl: CUSTOM_BASE_URL });

    expect(await credentialRequestsOf(provider)).toEqual([
      { url: 'https://chatgpt.com/backend-api/codex/responses', origin: 'https://chatgpt.com', credential: token },
    ]);
  });

  it('never sends a non-JWT openai-codex key anywhere', async () => {
    const provider = resolveSearchProvider({ piAuth: apiKeyAuth('openai-codex', 'not-a-jwt'), baseUrl: CUSTOM_BASE_URL });

    expect(await credentialRequestsOf(provider)).toEqual([]);
    expect(provider).toBeInstanceOf(DDGSearchProvider);
  });
});

describe('createLiveSearchProvider', () => {
  it("routes by the connection's base URL", async () => {
    const config: SearchConnectionConfig = {
      piAuth: apiKeyAuth('openai'),
      model: 'pi/endpoint-model',
      baseUrl: CUSTOM_BASE_URL,
    };

    expect(await credentialRequestsOf(createLiveSearchProvider(() => config))).toEqual([]);
  });

  it('follows a replaced config on the next call', async () => {
    let config: SearchConnectionConfig | null = { piAuth: apiKeyAuth('openai'), baseUrl: 'https://api.openai.com/v1' };
    const provider = createLiveSearchProvider(() => config);
    expect(provider.name).toBe('OpenAI');

    // update_runtime_config replaces initConfig rather than mutating it
    config = { ...config, baseUrl: CUSTOM_BASE_URL };
    expect(provider.name).toBe('DuckDuckGo');
    expect(await credentialRequestsOf(provider)).toEqual([]);

    config = null;
    expect(provider.name).toBe('DuckDuckGo');
  });

  it('searches the ChatGPT backend with the active model, without its pi/ prefix', async () => {
    const config: SearchConnectionConfig = {
      piAuth: apiKeyAuth('openai-codex', makeJwt('acc_123')),
      model: 'pi/gpt-test-model',
    };
    let requestedModel: unknown;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestedModel = JSON.parse(String(init?.body)).model;
      return fakeSearchResponse(new URL('https://chatgpt.com/backend-api/codex/responses'));
    }) as typeof fetch;

    await createLiveSearchProvider(() => config).search('craft agents', 3);
    expect(requestedModel).toBe('gpt-test-model');
  });
});
