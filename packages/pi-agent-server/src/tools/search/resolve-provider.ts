/**
 * Resolves the best web search provider based on the user's LLM connection.
 *
 * Priority:
 *   1. Provider-native search (OpenAI, ChatGPT, OpenRouter, Google) — best quality
 *   2. DuckDuckGo — universal fallback, no API key required
 *
 * A credential only goes to the origin the user configured for it. Custom
 * (OpenAI/Anthropic-compatible) endpoints carry a vendor's provider id ('openai',
 * 'anthropic') for the Pi SDK's request format, so the id alone never picks a host:
 * when the connection has a base URL, provider-native search runs only if its origin
 * is one of that provider's official API origins (exact `URL.origin` match).
 * Anything else searches with DuckDuckGo, which gets no credential.
 *
 * To add a new Responses API-compatible provider:
 *   1. Add its official origins to OFFICIAL_SEARCH_ORIGINS
 *   2. Add a case here with the provider name and apiBase URL
 *   3. The ResponsesApiSearchProvider handles the rest
 */

import type { WebSearchProvider } from './types.ts';
import { ResponsesApiSearchProvider } from './providers/openai.ts';
import { ChatGPTBackendSearchProvider, extractChatGptAccountId } from './providers/chatgpt.ts';
import { GoogleSearchProvider } from './providers/google.ts';
import { DDGSearchProvider } from './providers/ddg.ts';
import { stripPiPrefix } from '../../custom-endpoint-models.ts';

export type SearchProviderCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; access: string; refresh: string; expires: number }
  | { type: string; key?: string; access?: string };

export interface SearchProviderAuthConfig {
  provider?: string;
  credential?: SearchProviderCredential;
}

function getApiKey(piAuth?: SearchProviderAuthConfig): string | undefined {
  if (piAuth?.credential?.type !== 'api_key') return undefined;
  return typeof piAuth.credential.key === 'string' && piAuth.credential.key.length > 0
    ? piAuth.credential.key
    : undefined;
}

function getOAuthAccess(piAuth?: SearchProviderAuthConfig): string | undefined {
  if (piAuth?.credential?.type !== 'oauth') return undefined;
  const access = (piAuth.credential as { access?: string }).access;
  return typeof access === 'string' && access.length > 0 ? access : undefined;
}

/**
 * openai-codex tokens may arrive as either:
 *  - oauth.access (legacy/explicit oauth shape), or
 *  - api_key.key (current runtime shape for ChatGPT Plus OAuth bearer token)
 */
function getOpenAiCodexAccessToken(piAuth?: SearchProviderAuthConfig): string | undefined {
  if (piAuth?.provider !== 'openai-codex') return undefined;
  return getOAuthAccess(piAuth) ?? getApiKey(piAuth);
}

/**
 * Official API origins of the providers with native search, default first. The OpenAI
 * entries include the data-residency hosts the connection setup offers.
 */
const OFFICIAL_SEARCH_ORIGINS = {
  openai: ['https://api.openai.com', 'https://eu.api.openai.com', 'https://us.api.openai.com'],
  openrouter: ['https://openrouter.ai'],
  google: ['https://generativelanguage.googleapis.com'],
} as const satisfies Record<string, readonly string[]>;

/**
 * The origin to send a provider-native search to, or null when the credential must
 * stay away from that provider's API:
 * - no base URL (or a blank one): the provider's default origin;
 * - a base URL on one of the provider's official origins: that origin;
 * - anything else (a custom endpoint, a look-alike host, http, an unparseable URL): null.
 */
function nativeSearchOrigin(
  provider: keyof typeof OFFICIAL_SEARCH_ORIGINS,
  baseUrl: string | undefined,
): string | null {
  const official: readonly string[] = OFFICIAL_SEARCH_ORIGINS[provider];
  const configured = baseUrl?.trim();
  if (!configured) return official[0]!;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return null;
  }
  // A blob: URL reports its inner URL's origin, so check the scheme itself as well.
  if (url.protocol !== 'https:') return null;
  return official.includes(url.origin) ? url.origin : null;
}

export interface ResolveSearchProviderOptions {
  piAuth?: SearchProviderAuthConfig;
  /**
   * Bare (no `pi/` prefix) model ID of the active session/connection. Used by the ChatGPT
   * backend provider to search with a model the account actually supports, instead of a
   * hardcoded one that may have been retired (craft-agents-oss#1023).
   */
  activeModel?: string;
  /**
   * Base URL of the connection the credential belongs to. Set for custom endpoints, whose
   * key must never reach a provider's official API.
   */
  baseUrl?: string;
}

export function resolveSearchProvider({ piAuth, activeModel, baseUrl }: ResolveSearchProviderOptions = {}): WebSearchProvider {
  const provider = piAuth?.provider;
  const apiKey = getApiKey(piAuth);
  const openAiCodexAccess = getOpenAiCodexAccessToken(piAuth);

  // OpenAI with API key → standard Responses API, on the official host the user configured
  if (provider === 'openai' && apiKey) {
    const origin = nativeSearchOrigin('openai', baseUrl);
    if (origin) {
      return new ResponsesApiSearchProvider({
        apiBase: `${origin}/v1`,
        apiKey,
      });
    }
    // A custom endpoint (or anything not on an official origin) → fall through to DDG
  }

  // ChatGPT Plus (OpenAI OAuth bearer token) → ChatGPT backend endpoint
  // Supports both oauth.access and api_key.key token shapes. The base URL plays no part:
  // the token is only valid for chatgpt.com, the backend it goes to.
  if (provider === 'openai-codex' && openAiCodexAccess) {
    const accountId = extractChatGptAccountId(openAiCodexAccess);
    if (accountId) {
      return new ChatGPTBackendSearchProvider(
        openAiCodexAccess,
        accountId,
        activeModel ? { model: activeModel } : undefined,
      );
    }
    // Can't extract accountId (malformed/non-JWT token) → fall through to DDG
  }

  // OpenRouter → same Responses API format, different base URL
  if (provider === 'openrouter' && apiKey && nativeSearchOrigin('openrouter', baseUrl)) {
    return new ResponsesApiSearchProvider({
      apiBase: 'https://openrouter.ai/api/v1',
      apiKey,
      model: 'openai/gpt-4o-mini',
    });
  }

  // Google → Gemini API with native Google Search grounding
  if (provider === 'google' && apiKey && nativeSearchOrigin('google', baseUrl)) {
    return new GoogleSearchProvider(apiKey);
  }

  // Vercel AI Gateway is currently not wired to provider-native search routing.
  // It intentionally falls back to DDG until we add an explicit Responses API mapping.

  // Universal fallback — no API key required
  return new DDGSearchProvider();
}

/** The connection fields web search is routed by. */
export interface SearchConnectionConfig {
  piAuth?: SearchProviderAuthConfig;
  /** Craft model id of the active session (`pi/` prefix allowed). */
  model?: string;
  baseUrl?: string;
}

/**
 * A search provider that resolves the backend again on every call from the current
 * connection config, so a token refresh, a model switch or a runtime config update
 * (which replaces the config object) takes effect without recreating the session.
 */
export function createLiveSearchProvider(
  getConfig: () => SearchConnectionConfig | null | undefined,
): WebSearchProvider {
  const current = (): WebSearchProvider => {
    const config = getConfig();
    return resolveSearchProvider({
      piAuth: config?.piAuth,
      activeModel: config?.model ? stripPiPrefix(config.model) : undefined,
      baseUrl: config?.baseUrl,
    });
  };
  return {
    get name() {
      return current().name;
    },
    search: (query, count) => current().search(query, count),
  };
}
