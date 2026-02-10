#!/usr/bin/env node
/**
 * Bridge MCP Server
 *
 * This MCP server bridges REST API sources to Codex via stdio transport.
 * It reads API source configuration from a JSON file and exposes each
 * API source as an `api_{slug}` tool.
 *
 * Features:
 * - Automatic authentication injection (bearer, header, query, basic)
 * - Large response handling (>60KB saved to file with preview)
 * - Binary file detection and download
 * - Passive credential refresh (reads tokens from credential cache on each request)
 *
 * Usage:
 *   node bridge-mcp-server.js --config /path/to/sources.json --session /path/to/session
 *
 * The config JSON format:
 * {
 *   "sources": [{
 *     "slug": "gmail",
 *     "name": "Gmail",
 *     "baseUrl": "https://gmail.googleapis.com/gmail/v1",
 *     "authType": "bearer",
 *     "workspaceId": "xxx",
 *     "guideRaw": "..."
 *   }]
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type TextContent,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { homedir } from 'node:os';

// ============================================================
// Types
// ============================================================

interface ApiSourceConfig {
  slug: string;
  name: string;
  provider?: string;
  baseUrl: string;
  authType: 'bearer' | 'header' | 'query' | 'basic' | 'none';
  headerName?: string;
  queryParam?: string;
  authScheme?: string;
  defaultHeaders?: Record<string, string>;
  workspaceId: string;
  guideRaw?: string;
}

interface BridgeConfig {
  sources: ApiSourceConfig[];
}

interface ToolCallArgs {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  params?: Record<string, unknown>;
  _intent?: string;
}

interface StoredCredential {
  value: string;
  expiresAt?: number;
}

// ============================================================
// Credential Management
// ============================================================

/**
 * Get the path to the encrypted credentials file.
 * Note: In the bridge server, we read credentials from a decrypted cache file
 * that the main process writes for us, since we don't have access to the
 * encryption key.
 */
function getCredentialCachePath(workspaceId: string, sourceSlug: string): string {
  return join(
    homedir(),
    '.craft-agent',
    'workspaces',
    workspaceId,
    'sources',
    sourceSlug,
    '.credential-cache.json'
  );
}

/**
 * Read credential from cache file.
 * The main process writes decrypted credentials here for the bridge to use.
 */
function readCredential(workspaceId: string, sourceSlug: string): string | null {
  const cachePath = getCredentialCachePath(workspaceId, sourceSlug);
  try {
    if (!existsSync(cachePath)) {
      return null;
    }
    const content = readFileSync(cachePath, 'utf-8');
    const credential: StoredCredential = JSON.parse(content);

    // Check expiry
    if (credential.expiresAt && credential.expiresAt < Date.now()) {
      return null; // Expired
    }

    return credential.value;
  } catch {
    return null;
  }
}

// ============================================================
// HTTP Helpers
// ============================================================

/**
 * Build Authorization header value
 */
function buildAuthorizationHeader(authScheme: string | undefined, token: string): string {
  const scheme = authScheme ?? 'Bearer';
  return scheme ? `${scheme} ${token}` : token;
}

/**
 * Build headers for API request
 */
function buildHeaders(
  config: ApiSourceConfig,
  credential: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.defaultHeaders,
  };

  if (config.authType === 'none' || !credential) {
    return headers;
  }

  if (config.authType === 'bearer') {
    headers['Authorization'] = buildAuthorizationHeader(config.authScheme, credential);
  } else if (config.authType === 'header') {
    headers[config.headerName || 'X-API-Key'] = credential;
  } else if (config.authType === 'basic') {
    // Basic auth: credential may be JSON object {"username":"...","password":"..."} or "user:pass" string
    // The credential manager stores as JSON, but we support both formats
    let authString = credential;
    try {
      const parsed = JSON.parse(credential);
      if (parsed && typeof parsed === 'object' && parsed.username && parsed.password) {
        authString = `${parsed.username}:${parsed.password}`;
      }
    } catch {
      // Not JSON, assume already in "user:pass" format
    }
    const base64 = Buffer.from(authString).toString('base64');
    headers['Authorization'] = `Basic ${base64}`;
  }
  // Query auth is handled in buildUrl

  return headers;
}

/**
 * Build full URL for API request
 */
function buildUrl(
  config: ApiSourceConfig,
  path: string,
  method: string,
  params: Record<string, unknown> | undefined,
  credential: string
): string {
  const baseUrl = config.baseUrl.endsWith('/')
    ? config.baseUrl.slice(0, -1)
    : config.baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${baseUrl}${normalizedPath}`;

  // Query param auth
  if (config.authType === 'query' && config.queryParam && credential) {
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}${config.queryParam}=${encodeURIComponent(credential)}`;
  }

  // GET params
  if (method === 'GET' && params && Object.keys(params).length > 0) {
    const urlParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
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

// ============================================================
// Response Handling
// ============================================================

const MAX_RESPONSE_SIZE = 60 * 1024; // 60KB - summarize responses larger than this

/**
 * Text MIME types that should be processed as text
 */
const TEXT_MIME_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
];

function isTextContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  const normalized = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (normalized.endsWith('+json') || normalized.endsWith('+xml')) {
    return true;
  }
  return TEXT_MIME_TYPES.some(t =>
    t.endsWith('/') ? normalized.startsWith(t) : normalized === t
  );
}

/**
 * Save binary response to downloads folder.
 * Returns error object if file I/O fails (prevents crashing the bridge).
 */
function saveBinaryResponse(
  sessionPath: string,
  filename: string,
  buffer: Buffer,
  mimeType: string | null
): { path: string; size: number } | { error: string } {
  try {
    const downloadsDir = join(sessionPath, 'downloads');
    mkdirSync(downloadsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = filename || `download_${timestamp}.bin`;
    const filePath = join(downloadsDir, safeName);

    writeFileSync(filePath, buffer);
    return { path: filePath, size: buffer.length };
  } catch (error) {
    return { error: `Failed to save file: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Save large text response to responses folder.
 * Returns error object if file I/O fails (prevents crashing the bridge).
 */
function saveLargeResponse(
  sessionPath: string,
  toolName: string,
  apiPath: string,
  content: string
): string | { error: string } {
  try {
    const responsesDir = join(sessionPath, 'long_responses');
    mkdirSync(responsesDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
    const safePath = apiPath.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    const filename = `${timestamp}_${toolName}_${safePath}.txt`;
    const filePath = join(responsesDir, filename);

    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  } catch (error) {
    return { error: `Failed to save response: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ============================================================
// Tool Execution
// ============================================================

// Request timeout in milliseconds (30 seconds)
const FETCH_TIMEOUT_MS = 30000;

async function executeApiTool(
  config: ApiSourceConfig,
  args: ToolCallArgs,
  sessionPath?: string
): Promise<{ content: TextContent[]; isError?: boolean }> {
  const { path, method, params } = args;

  // Get credential
  const credential = readCredential(config.workspaceId, config.slug) || '';

  if (!credential && config.authType !== 'none') {
    return {
      content: [{
        type: 'text',
        text: `Authentication required for ${config.name}. Please authenticate the source in Craft Agent settings.`,
      }],
      isError: true,
    };
  }

  const url = buildUrl(config, path, method, params, credential);
  const headers = buildHeaders(config, credential);

  // Add timeout via AbortController to prevent hanging on slow/unresponsive APIs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };

  if (method !== 'GET' && params && Object.keys(params).length > 0) {
    fetchOptions.body = JSON.stringify(params);
  }

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type');

    // Handle binary responses
    if (contentType && !isTextContentType(contentType) && sessionPath) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const result = saveBinaryResponse(sessionPath, '', buffer, contentType);

      // Handle file I/O error
      if ('error' in result) {
        return {
          content: [{ type: 'text', text: result.error }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            type: 'file_download',
            path: result.path,
            size: result.size,
            mimeType: contentType,
          }, null, 2),
        }],
      };
    }

    const text = await response.text();

    if (!response.ok) {
      return {
        content: [{
          type: 'text',
          text: `API Error ${response.status}: ${text}`,
        }],
        isError: true,
      };
    }

    // Handle large responses
    if (text.length > MAX_RESPONSE_SIZE && sessionPath) {
      const saveResult = saveLargeResponse(sessionPath, config.slug, path, text);

      // Handle file I/O error - return truncated response instead
      if (typeof saveResult === 'object' && 'error' in saveResult) {
        const preview = text.slice(0, 8000);
        return {
          content: [{
            type: 'text',
            text: `Response too large (${Math.round(text.length / 1024)}KB) and could not be saved: ${saveResult.error}\n\nTruncated response:\n${preview}...`,
          }],
        };
      }

      const preview = text.slice(0, 2000);
      const relativePath = relative(sessionPath, saveResult);
      return {
        content: [{
          type: 'text',
          text: `[Response too large (${Math.round(text.length / 1024)}KB)]\n\nFull data saved to: ${saveResult}\n- Use Read/Grep to access specific content\n- Use transform_data with inputFiles: ["${relativePath}"] for data analysis\n\nPreview:\n${preview}...`,
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text,
      }],
    };
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle timeout specifically
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        content: [{
          type: 'text',
          text: `Request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds. The API may be slow or unresponsive.`,
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      }],
      isError: true,
    };
  }
}

// ============================================================
// MCP Server
// ============================================================

function buildToolDescription(config: ApiSourceConfig): string {
  let desc = `Make authenticated requests to ${config.name} API (${config.baseUrl})\n\n`;
  desc += `Authentication is handled automatically.\n\n`;

  if (config.guideRaw) {
    // Extract first 2000 chars of guide as context
    desc += config.guideRaw.slice(0, 2000);
    if (config.guideRaw.length > 2000) {
      desc += '\n\n[Guide truncated - see source guide.md for full documentation]';
    }
  }

  return desc;
}

function createTools(sources: ApiSourceConfig[]): Tool[] {
  return sources.map(source => ({
    name: `api_${source.slug}`,
    description: buildToolDescription(source),
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'API endpoint path, e.g., "/search" or "/v1/completions"',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          description: 'HTTP method',
        },
        params: {
          type: 'object',
          description: 'Request body (POST/PUT/PATCH) or query parameters (GET)',
          additionalProperties: true,
        },
        _intent: {
          type: 'string',
          description: 'Describe what you are trying to accomplish (1-2 sentences)',
        },
      },
      required: ['path', 'method'],
    },
  }));
}

// ============================================================
// Process Lifecycle
// ============================================================

/**
 * Set up signal handlers for graceful shutdown.
 * These ensure clean termination when the parent process (Codex) stops the bridge.
 */
function setupSignalHandlers(): void {
  const shutdown = (signal: string) => {
    console.error(`Bridge server received ${signal}, shutting down gracefully`);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Catch unhandled promise rejections to prevent silent crashes
  // Log the error but continue running - individual request failures shouldn't crash the server
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled promise rejection in bridge server:', reason);
  });
}

async function main() {
  // Set up signal handlers first
  setupSignalHandlers();

  // Parse command line arguments
  const args = process.argv.slice(2);
  let configPath: string | undefined;
  let sessionPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    } else if (args[i] === '--session' && args[i + 1]) {
      sessionPath = args[i + 1];
      i++;
    }
  }

  if (!configPath) {
    console.error('Usage: bridge-mcp-server --config <path> [--session <path>]');
    process.exit(1);
  }

  // Load configuration
  let config: BridgeConfig;
  try {
    const content = readFileSync(configPath, 'utf-8');
    config = JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load config from ${configPath}:`, error);
    process.exit(1);
  }

  if (!config.sources || config.sources.length === 0) {
    console.error('No sources configured');
    process.exit(1);
  }

  // Create MCP server
  const server = new Server(
    {
      name: 'craft-agent-api-bridge',
      version: '0.3.1',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Build source lookup map
  const sourceMap = new Map<string, ApiSourceConfig>();
  for (const source of config.sources) {
    sourceMap.set(`api_${source.slug}`, source);
  }

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: createTools(config.sources),
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;

    const source = sourceMap.get(name);
    if (!source) {
      return {
        content: [{
          type: 'text' as const,
          text: `Unknown tool: ${name}`,
        }],
        isError: true,
      };
    }

    const args = toolArgs as unknown as ToolCallArgs;
    const result = await executeApiTool(source, args, sessionPath);

    return { content: result.content, isError: result.isError };
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is for MCP protocol)
  console.error(`Bridge MCP Server started with ${config.sources.length} API sources`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
