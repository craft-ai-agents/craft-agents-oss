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

import { appendFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Type alias for fetch's HeadersInit (not in ESNext lib, but available at runtime via Bun)
// Using string[][] instead of [string, string][] to match RequestInit.headers type
type HeadersInitType = Headers | Record<string, string> | string[][];

const DEBUG = process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1';
const LOG_FILE = '/tmp/craft-debug.log';
const CONFIG_FILE = join(homedir(), '.craft-agent', 'config.json');

/**
 * Store the last API error for the error handler to access.
 * This allows us to capture the actual HTTP status code (e.g., 402 Payment Required)
 * before the SDK wraps it in a generic error message.
 *
 * Uses file-based storage to reliably share across process boundaries
 * (the SDK may run in a subprocess with separate memory space).
 */
export interface LastApiError {
  status: number;
  statusText: string;
  message: string;
  timestamp: number;
}

// File-based storage for cross-process sharing
const ERROR_FILE = join(homedir(), '.craft-agent', 'api-error.json');
const MAX_ERROR_AGE_MS = 5 * 60 * 1000; // 5 minutes

function getStoredError(): LastApiError | null {
  try {
    if (!existsSync(ERROR_FILE)) return null;
    const content = readFileSync(ERROR_FILE, 'utf-8');
    const error = JSON.parse(content) as LastApiError;
    // Pop: delete after reading
    try {
      unlinkSync(ERROR_FILE);
      debugLog(`[getStoredError] Popped error file`);
    } catch {
      // Ignore delete errors
    }
    return error;
  } catch {
    return null;
  }
}

function setStoredError(error: LastApiError | null): void {
  try {
    if (error) {
      writeFileSync(ERROR_FILE, JSON.stringify(error));
      debugLog(`[setStoredError] Wrote error to file: ${error.status} ${error.message}`);
    } else {
      // Clear the file
      try {
        unlinkSync(ERROR_FILE);
      } catch {
        // File might not exist
      }
    }
  } catch (e) {
    debugLog(`[setStoredError] Failed to write: ${e}`);
  }
}

export function getLastApiError(): LastApiError | null {
  const error = getStoredError();
  if (error) {
    const age = Date.now() - error.timestamp;
    if (age < MAX_ERROR_AGE_MS) {
      debugLog(`[getLastApiError] Found error (age ${age}ms): ${error.status}`);
      return error;
    }
    debugLog(`[getLastApiError] Error too old (${age}ms > ${MAX_ERROR_AGE_MS}ms)`);
  }
  return null;
}

export function clearLastApiError(): void {
  setStoredError(null);
}

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

/**
 * Check if URL is Anthropic API (for cache TTL modification)
 */
function isAnthropicMessagesUrl(url: string): boolean {
  return url.includes('api.anthropic.com') && url.includes('/messages');
}

/**
 * Add _intent field to all MCP tool schemas in Anthropic API request.
 * Only modifies tools that start with "mcp__" (MCP tools from SDK).
 * Returns the modified request body object.
 */
function addIntentToMcpTools(body: Record<string, unknown>): Record<string, unknown> {
  const tools = body.tools as Array<{
    name?: string;
    input_schema?: {
      properties?: Record<string, unknown>;
      required?: string[];
    };
  }> | undefined;

  if (!tools || !Array.isArray(tools)) {
    return body;
  }

  let modifiedCount = 0;
  for (const tool of tools) {
    // Only modify MCP tools (prefixed with mcp__)
    if (tool.name?.startsWith('mcp__') && tool.input_schema?.properties) {
      // Don't add if already present
      if (!('_intent' in tool.input_schema.properties)) {
        tool.input_schema.properties._intent = {
          type: 'string',
          description: 'REQUIRED: Describe what you are trying to accomplish with this tool call (1-2 sentences)',
        };
        // Actually enforce it by adding to required array (not just in description)
        tool.input_schema.required = [
          ...(tool.input_schema.required || []),
          '_intent',
        ];
        modifiedCount++;
      }
    }
  }

  if (modifiedCount > 0) {
    debugLog(`[Intent Schema] Added _intent to ${modifiedCount} MCP tools`);
  }

  return body;
}

/**
 * Check if URL should have API errors captured (includes Craft Gateway)
 */
function shouldCaptureApiErrors(url: string): boolean {
  const isAnthropicDirect = url.includes('api.anthropic.com') && url.includes('/messages');
  const isCraftGateway = url.includes('api.craft.do/ai-gateway/anthropic') && url.includes('/messages');
  return isAnthropicDirect || isCraftGateway;
}

const originalFetch = globalThis.fetch.bind(globalThis);

/**
 * Convert headers to cURL -H flags, redacting sensitive values
 */
function headersToCurl(headers: HeadersInitType | undefined): string {
  if (!headers) return '';

  const headerObj: Record<string, string> =
    headers instanceof Headers
      ? Object.fromEntries(Array.from(headers as unknown as Iterable<[string, string]>))
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
  const headers = headersToCurl(init?.headers as HeadersInitType | undefined);

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
 * Clone response and log its body (handles streaming responses).
 * Also captures API errors (4xx/5xx) for the error handler.
 */
async function logResponse(response: Response, url: string, startTime: number): Promise<Response> {
  const duration = Date.now() - startTime;

  // Capture API errors (runs regardless of DEBUG mode)
  if (shouldCaptureApiErrors(url) && response.status >= 400) {
    debugLog(`  [Attempting to capture error for ${response.status} response]`);
    // Clone to read body without consuming the original
    const errorClone = response.clone();
    try {
      const errorText = await errorClone.text();
      let errorMessage = response.statusText;

      // Try to parse JSON error response
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage = errorJson.error.message;
        } else if (errorJson.message) {
          errorMessage = errorJson.message;
        }
      } catch {
        // Use raw text if not JSON
        if (errorText) errorMessage = errorText;
      }

      setStoredError({
        status: response.status,
        statusText: response.statusText,
        message: errorMessage,
        timestamp: Date.now(),
      });
      debugLog(`  [Captured API error: ${response.status} ${errorMessage}]`);
    } catch (e) {
      // Still capture basic info even if body read fails
      debugLog(`  [Error reading body, capturing basic info: ${e}]`);
      setStoredError({
        status: response.status,
        statusText: response.statusText,
        message: response.statusText,
        timestamp: Date.now(),
      });
    }
  }

  if (!DEBUG) return response;

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
        let parsed = JSON.parse(body);
        const model = parsed.model as string | undefined;

        // Add _intent to MCP tool schemas (always, regardless of cache config)
        parsed = addIntentToMcpTools(parsed);

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
