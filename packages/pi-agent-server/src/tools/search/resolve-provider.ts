/**
 * Resolves the web search provider used by the Pi runtime.
 * WebSearch is intentionally pinned to SearXNG so evaluation results do not
 * silently change source/ranking when another provider fails.
 */

import type { WebSearchProvider } from './types.ts';
import { SearXNGSearchProvider } from './providers/searxng.ts';

export type SearchProviderCredential =
  | { type: 'api_key'; key: string }
  | { type: 'oauth'; access: string; refresh: string; expires: number }
  | { type: string; key?: string; access?: string };

export interface SearchProviderAuthConfig {
  provider?: string;
  credential?: SearchProviderCredential;
}

export function resolveSearchProvider(_piAuth?: SearchProviderAuthConfig): WebSearchProvider {
  const searxngUrl = process.env.SEARXNG_URL?.trim() || 'http://127.0.0.1:8080';
  return new SearXNGSearchProvider(searxngUrl);
}
