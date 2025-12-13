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

const DEBUG = process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1';
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

/**
 * Convert headers to cURL -H flags, redacting sensitive values
 */
function headersToCurl(headers: HeadersInit | undefined): string {
  if (!headers) return '';

  const headerObj: Record<string, string> =
    headers instanceof Headers
      ? Object.fromEntries(headers.entries())
      : Array.isArray(headers)
        ? Object.fromEntries(headers)
        : (headers as Record<string, string>);

  const sensitiveKeys = ['x-api-key', 'authorization', 'cookie'];

  return Object.entries(headerObj)
    .map(([key, value]) => {
      const redacted = sensitiveKeys.includes(key.toLowerCase())
        ? '[REDACTED]'
        : value;
      return `-H '${key}: ${redacted}'`;
    })
    .join(' \\\n  ');
}

/**
 * Format a fetch request as a cURL command
 */
function toCurl(url: string, init?: RequestInit): string {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const headers = headersToCurl(init?.headers);

  let curl = `curl -X ${method}`;
  if (headers) {
    curl += ` \\\n  ${headers}`;
  }
  if (init?.body && typeof init.body === 'string') {
    // Escape single quotes in body for shell safety
    const escapedBody = init.body.replace(/'/g, "'\\''");
    curl += ` \\\n  -d '${escapedBody}'`;
  }
  curl += ` \\\n  '${url}'`;

  return curl;
}

/**
 * Clone response and log its body (handles streaming responses)
 */
async function logResponse(response: Response, url: string, startTime: number): Promise<Response> {
  if (!DEBUG) return response;

  const duration = Date.now() - startTime;
  debugLog(`\n← RESPONSE ${response.status} ${response.statusText} (${duration}ms)`);
  debugLog(`  URL: ${url}`);

  // Log response headers
  const respHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    respHeaders[key] = value;
  });
  debugLog('  Headers:', respHeaders);

  // For streaming responses, we can't easily log the body without consuming it
  // For non-streaming, clone and log
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    debugLog('  Body: [SSE stream - not logged]');
    return response;
  }

  // Clone the response so we can read the body without consuming it
  const clone = response.clone();
  try {
    const text = await clone.text();
    // Limit logged response size to prevent huge logs
    const maxLogSize = 5000;
    if (text.length > maxLogSize) {
      debugLog(`  Body (truncated to ${maxLogSize} chars):\n${text.substring(0, maxLogSize)}...`);
    } else {
      debugLog(`  Body:\n${text}`);
    }
  } catch (e) {
    debugLog('  Body: [failed to read]', e);
  }

  return response;
}

async function interceptedFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const startTime = Date.now();

  // Log all requests as cURL commands
  if (DEBUG) {
    debugLog('\n' + '='.repeat(80));
    debugLog('→ REQUEST');
    debugLog(toCurl(url, init));
  }

  // Skip cache TTL modification if explicitly disabled
  if (EXTENDED_CACHE_CONFIG === false) {
    const response = await originalFetch(input, init);
    return logResponse(response, url, startTime);
  }

  if (
    isAnthropicMessagesUrl(url) &&
    init?.method?.toUpperCase() === 'POST' &&
    init?.body
  ) {
    try {
      let headers = init?.headers;
      let newUrl = new URL(url);
      if (process.env.USE_CRAFT_AI_GATEWAY === 'true' && process.env.CRAFT_API_GATEWAY_TOKEN != null) {
        newUrl.hostname = 'api.craft.do';
        newUrl.pathname = '/ai-gateway/anthropic' + newUrl.pathname;
        headers = {
          ...JSON.parse(JSON.stringify(headers)),
          'authorization': `${process.env.CRAFT_API_GATEWAY_TOKEN}`,
        };
        debugLog('  [Redirecting to Craft AI Gateway]');
      }
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

        if (shouldApply) {
          debugLog('  [Applying 1h cache TTL]');
        }

        const modified = shouldApply ? addCacheTtl(parsed) : parsed;
        const modifiedInit = {
          ...init,
          body: JSON.stringify(modified),
          headers: headers,
        };

        // Log the modified request if it differs
        if (DEBUG && (shouldApply || newUrl.toString() !== url)) {
          debugLog('\n→ MODIFIED REQUEST');
          debugLog(toCurl(newUrl.toString(), modifiedInit));
        }

        const response = await originalFetch(newUrl.toString(), modifiedInit);
        return logResponse(response, newUrl.toString(), startTime);
      }
    } catch (e) {
      debugLog('FETCH modification failed:', e);
    }
  }

  const response = await originalFetch(input, init);
  return logResponse(response, url, startTime);
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
