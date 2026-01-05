/**
 * Dynamic API Tool Factory
 *
 * Creates a single flexible MCP tool per API configuration.
 * Each tool accepts { path, method, params } and auto-injects authentication.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ApiConfig } from './types.ts';
import { debug } from '../utils/debug.ts';
import { estimateTokens, summarizeLargeResult, TOKEN_LIMIT } from '../utils/summarize.ts';

/**
 * Credential for HTTP Basic Authentication
 */
export interface BasicAuthCredential {
  username: string;
  password: string;
}

/**
 * API credential - either a simple string (API key/token) or basic auth credentials
 */
export type ApiCredential = string | BasicAuthCredential;

/**
 * Type guard to check if credential is BasicAuthCredential
 */
function isBasicAuthCredential(cred: ApiCredential): cred is BasicAuthCredential {
  return typeof cred === 'object' && cred !== null && 'username' in cred && 'password' in cred;
}


/**
 * Build headers for an API request, injecting authentication and default headers
 */
function buildHeaders(
  auth: ApiConfig['auth'],
  credential: ApiCredential,
  defaultHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Merge default headers (e.g., beta feature flags)
    ...defaultHeaders,
  };

  // Add custom headers first (can be overridden by auth)
  if (customHeaders) {
    for (const [key, value] of Object.entries(customHeaders)) {
      headers[key] = value;
    }
    debug(`[api-tools.buildHeaders] Added custom headers:`, Object.keys(customHeaders));
  }

  // No auth needed for type='none' or missing auth
  if (!auth || auth.type === 'none') {
    debug(`[api-tools.buildHeaders] No auth needed, final headers:`, Object.keys(headers));
    return headers;
  }

  debug(`[api-tools.buildHeaders] Auth type: ${auth.type}, authScheme: "${auth.authScheme}"`);

  // Basic auth requires username:password credential
  if (auth.type === 'basic') {
    if (isBasicAuthCredential(credential)) {
      const encoded = Buffer.from(`${credential.username}:${credential.password}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
      debug(`[api-tools.buildHeaders] Set Basic auth header`);
    }
    return headers;
  }

  // Other types use string credential (API key/token)
  const apiKey = typeof credential === 'string' ? credential : '';
  if (!apiKey) {
    debug(`[api-tools.buildHeaders] WARNING: No API key available`);
    return headers;
  }

  debug(`[api-tools.buildHeaders] API key length: ${apiKey.length}, first 10 chars: ${apiKey.substring(0, 10)}...`);

  if (auth.type === 'header') {
    const headerName = auth.headerName || 'x-api-key';
    headers[headerName] = apiKey;
    debug(`[api-tools.buildHeaders] Set custom header: ${headerName}`);
  } else if (auth.type === 'bearer') {
    // If authScheme is explicitly empty string, use just the API key
    // If undefined, default to "Bearer"
    const scheme = auth.authScheme === '' ? '' : (auth.authScheme || 'Bearer');
    headers['Authorization'] = scheme ? `${scheme} ${apiKey}` : apiKey;
    debug(`[api-tools.buildHeaders] Set Authorization header with scheme: "${scheme}", value starts with: ${headers['Authorization'].substring(0, 20)}...`);
  }
  // Query type is handled in buildUrl

  debug(`[api-tools.buildHeaders] Final headers:`, Object.keys(headers));
  return headers;
}

/**
 * Build the full URL for an API request
 */
function buildUrl(
  baseUrl: string,
  path: string,
  method: string,
  params: Record<string, unknown> | undefined,
  auth: ApiConfig['auth'],
  credential: ApiCredential
): string {
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${baseUrl}${normalizedPath}`;

  // Handle query param auth (only for string credentials)
  const apiKey = typeof credential === 'string' ? credential : '';
  if (auth?.type === 'query' && auth.queryParam && apiKey) {
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}${auth.queryParam}=${encodeURIComponent(apiKey)}`;
  }

  // Handle GET params in query string
  if (method === 'GET' && params && Object.keys(params).length > 0) {
    const urlParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        // Handle arrays and objects
        if (typeof value === 'object') {
          urlParams.append(key, JSON.stringify(value));
        } else {
          urlParams.append(key, String(value));
        }
      }
    }
    const queryString = urlParams.toString();
    if (queryString) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}${queryString}`;
    }
  }

  return url;
}

/**
 * Build tool description from API config
 */
function buildToolDescription(config: ApiConfig): string {
  let desc = `Make authenticated requests to ${config.name} API (${config.baseUrl})\n\n`;
  desc += `Authentication is handled automatically - just specify path, method, and params.\n\n`;

  // Check for old cache format (no documentation field)
  if (!config.documentation) {
    desc += `⚠️ This API was cached with an older format. Run "/agent refresh" to get full API documentation.\n\n`;
    desc += `Until then, you can still make requests but you'll need to figure out the endpoints yourself.`;
    return desc;
  }

  // Include the rich documentation extracted from the agent definition
  desc += config.documentation;

  if (config.docsUrl) {
    desc += `\n\nOfficial docs: ${config.docsUrl}`;
  }

  return desc;
}

/**
 * Create a single flexible MCP tool for an API configuration.
 * The tool accepts { path, method, params } and handles auth automatically.
 *
 * @param config - API configuration with documentation
 * @param credential - API credential (string for API key/token, BasicAuthCredential for basic auth, empty string for public APIs)
 * @returns SDK tool that can be included in an MCP server
 */
export function createApiTool(
  config: ApiConfig,
  credential: ApiCredential
) {
  const toolName = `api_${config.name}`;
  debug(`[api-tools] Creating flexible tool: ${toolName}`);
  debug(`[api-tools] Config for ${toolName}:`, {
    baseUrl: config.baseUrl,
    authType: config.auth?.type,
    authScheme: config.auth?.authScheme,
    customHeaders: config.headers ? Object.keys(config.headers) : [],
    credentialLength: typeof credential === 'string' ? credential.length : 'BasicAuth',
  });

  const description = buildToolDescription(config);

  return tool(
    toolName,
    description,
    {
      path: z.string().describe('API endpoint path, e.g., "/search" or "/v1/completions"'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method - check documentation for correct method per endpoint'),
      params: z.record(z.string(), z.unknown()).optional().describe('Request body (POST/PUT/PATCH) or query parameters (GET)'),
      _intent: z.string().optional().describe('REQUIRED: Describe what you are trying to accomplish with this API call (1-2 sentences)'),
    },
    async (args) => {
      const { path, method, params, _intent } = args;

      try {
        const url = buildUrl(config.baseUrl, path, method, params, config.auth, credential);
        const headers = buildHeaders(config.auth, credential, config.defaultHeaders);

        debug(`[api-tools] ${config.name}: ${method} ${url}`);
        debug(`[api-tools] ${config.name} request headers:`, headers);

        const fetchOptions: RequestInit = {
          method,
          headers,
        };

        // Add body for non-GET requests
        if (method !== 'GET' && params && Object.keys(params).length > 0) {
          fetchOptions.body = JSON.stringify(params);
        }

        const response = await fetch(url, fetchOptions);
        const text = await response.text();

        // Check for error responses
        if (!response.ok) {
          debug(`[api-tools] ${config.name} error ${response.status}: ${text.substring(0, 200)}`);
          return {
            content: [{
              type: 'text' as const,
              text: `API Error ${response.status}: ${text}`,
            }],
            isError: true,
          };
        }

        debug(`[api-tools] ${config.name} success, response length: ${text.length}`);

        // Check if response is too large and needs summarization
        const estimatedTokens = estimateTokens(text);
        if (estimatedTokens > TOKEN_LIMIT) {
          debug(`[api-tools] Response too large (~${estimatedTokens} tokens), summarizing...`);
          if (_intent) {
            debug(`[api-tools] Using intent for summarization: ${_intent}`);
          }
          const summary = await summarizeLargeResult(text, {
            toolName: `api_${config.name}`,
            path,
            input: params,
            modelIntent: _intent,
          });
          return {
            content: [{
              type: 'text' as const,
              text: `[Large response (~${estimatedTokens} tokens) was summarized to fit context. ` +
                `If key details are missing, consider using more specific query parameters.]\n\n${summary}`,
            }],
          };
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        debug(`[api-tools] ${config.name} request failed: ${message}`);
        return {
          content: [{ type: 'text' as const, text: `Request failed: ${message}` }],
          isError: true,
        };
      }
    }
  );
}

/**
 * Create an in-process MCP server with a single flexible API tool.
 *
 * @param config - API configuration
 * @param credential - API credential (string for API key/token, BasicAuthCredential for basic auth, empty string for public APIs)
 * @returns SDK MCP server that can be passed to query()
 */
export function createApiServer(
  config: ApiConfig,
  credential: ApiCredential
): ReturnType<typeof createSdkMcpServer> {
  debug(`[api-tools] Creating server for ${config.name}`);

  const apiTool = createApiTool(config, credential);

  return createSdkMcpServer({
    name: `api_${config.name}`,
    version: '1.0.0',
    tools: [apiTool],
  });
}
