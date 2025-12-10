/**
 * Fetch interceptor to inject 1-hour TTL into Anthropic prompt caching.
 *
 * Loaded via bunfig.toml preload to run BEFORE any modules are evaluated.
 * This ensures we patch globalThis.fetch before the SDK captures it.
 *
 * Can be configured via `extendedCacheTtl` in ~/.craft-agent/config.json:
 * - Not set (default): Auto mode - 1h for Opus models, 5m for others
 * - true: Force 1h for all models
 * - false: Force 5m for all models
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEBUG = process.argv.includes('--debug');
const LOG_FILE = '/tmp/craft-debug.log';
const CONFIG_FILE = join(homedir(), '.craft-agent', 'config.json');

/**
 * Check if extended cache TTL is explicitly configured.
 * Returns: true (force enable), false (force disable), or null (auto based on model)
 */
function getExtendedCacheConfig(): boolean | null {
  try {
    if (!existsSync(CONFIG_FILE)) return null;
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content);
    if (typeof config.extendedCacheTtl === 'boolean') {
      return config.extendedCacheTtl;
    }
    return null; // Auto mode - enabled for Opus only
  } catch {
    return null;
  }
}

const EXTENDED_CACHE_CONFIG = getExtendedCacheConfig();

/**
 * Check if model is Opus (uses 1h cache by default)
 */
function isOpusModel(model: string): boolean {
  return model.includes('opus');
}

function debugLog(...args: unknown[]) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  const message = `${timestamp} [cache-interceptor] ${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`;
  try {
    appendFileSync(LOG_FILE, message);
  } catch {
    // ignore
  }
}

/**
 * Recursively find and modify all cache_control objects to add ttl: "1h"
 */
function addCacheTtl(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(addCacheTtl);

  const record = obj as Record<string, unknown>;
  if (record.type === 'ephemeral' && !('ttl' in record)) {
    return { ...record, ttl: '1h' };
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = addCacheTtl(value);
  }
  return result;
}

function isAnthropicMessagesUrl(url: string): boolean {
  return url.includes('api.anthropic.com') && url.includes('/messages');
}

const originalFetch = globalThis.fetch.bind(globalThis);

async function interceptedFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  // Skip if explicitly disabled
  if (EXTENDED_CACHE_CONFIG === false) {
    return originalFetch(input, init);
  }

  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  if (
    isAnthropicMessagesUrl(url) &&
    init?.method?.toUpperCase() === 'POST' &&
    init?.body
  ) {
    try {
      const body = typeof init.body === 'string' ? init.body : undefined;
      if (body) {
        const parsed = JSON.parse(body);
        const model = parsed.model as string | undefined;

        // Determine if we should apply 1h TTL:
        // - If explicitly enabled in config: always apply
        // - If not configured (null): only apply for Opus models
        const shouldApply =
          EXTENDED_CACHE_CONFIG === true ||
          (EXTENDED_CACHE_CONFIG === null && model && isOpusModel(model));

        if (!shouldApply) {
          debugLog('FETCH skipped (non-Opus model):', model);
          return originalFetch(input, init);
        }

        debugLog('FETCH intercepted:', url, 'model:', model);
        const modified = addCacheTtl(parsed);
        debugLog('FETCH modified body with ttl: 1h');
        return originalFetch(input, {
          ...init,
          body: JSON.stringify(modified),
        });
      }
    } catch (e) {
      debugLog('FETCH modification failed:', e);
    }
  }
  return originalFetch(input, init);
}

// Create proxy to handle both function calls and static properties (e.g., fetch.preconnect in Bun)
const fetchProxy = new Proxy(interceptedFetch, {
  apply(target, thisArg, args) {
    return Reflect.apply(target, thisArg, args);
  },
  get(target, prop, receiver) {
    if (prop in originalFetch) {
      return (originalFetch as unknown as Record<string | symbol, unknown>)[
        prop
      ];
    }
    return Reflect.get(target, prop, receiver);
  },
});

(globalThis as unknown as { fetch: unknown }).fetch = fetchProxy;
debugLog(
  'Fetch interceptor installed, extended cache TTL:',
  EXTENDED_CACHE_CONFIG === true
    ? 'enabled (1h for all models)'
    : EXTENDED_CACHE_CONFIG === false
      ? 'disabled (5m for all models)'
      : 'auto (1h for Opus, 5m for others)'
);

export {};
