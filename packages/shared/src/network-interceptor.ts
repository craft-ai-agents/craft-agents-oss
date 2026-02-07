/**
 * Fetch interceptor for Anthropic API requests.
 *
 * Loaded via bunfig.toml preload to run BEFORE any modules are evaluated.
 * This ensures we patch globalThis.fetch before the SDK captures it.
 *
 * Features:
 * - Captures API errors for error handler (4xx/5xx responses)
 * - Adds _intent and _displayName metadata to all tool schemas (request)
 * - Strips _intent and _displayName from tool_use responses (response)
 * - Stores extracted metadata in toolMetadataStore for UI consumption
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Type alias for fetch's HeadersInit (not in ESNext lib, but available at runtime via Bun)
// Using string[][] instead of [string, string][] to match RequestInit.headers type
type HeadersInitType = Headers | Record<string, string> | string[][];

const DEBUG = process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1';

// Log file for debug output (avoids console spam)
const LOG_DIR = join(homedir(), '.craft-agent', 'logs');
const LOG_FILE = join(LOG_DIR, 'interceptor.log');

// Ensure log directory exists at module load
try {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // Ignore - logging will silently fail if dir can't be created
}

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

// ============================================================================
// TOOL METADATA STORE (File-based for cross-context sharing)
// ============================================================================

/**
 * Store for tool metadata extracted from Claude's responses.
 * Keyed by tool_use_id, stores the _intent and _displayName that Claude provided.
 *
 * Uses FILE-BASED storage to share data between the preloaded interceptor
 * and the agent module (which may run in different contexts/isolates).
 *
 * Entries are cleaned up after 5 minutes to prevent stale data.
 */
export interface ToolMetadata {
  intent?: string;
  displayName?: string;
  timestamp: number;
}

const METADATA_DIR = join(homedir(), '.craft-agent', 'tool-metadata');
const METADATA_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

// Ensure metadata directory exists
try {
  if (!existsSync(METADATA_DIR)) {
    mkdirSync(METADATA_DIR, { recursive: true });
  }
} catch {
  // Ignore - operations will fail gracefully
}

/**
 * File-based metadata store that works across process boundaries.
 * Each tool_use_id gets its own file for atomic read/write.
 */
export const toolMetadataStore = {
  set(toolUseId: string, metadata: ToolMetadata): void {
    try {
      const filePath = join(METADATA_DIR, `${toolUseId}.json`);
      writeFileSync(filePath, JSON.stringify(metadata));
    } catch {
      // Silently fail
    }
  },

  get(toolUseId: string): ToolMetadata | undefined {
    try {
      const filePath = join(METADATA_DIR, `${toolUseId}.json`);
      if (!existsSync(filePath)) return undefined;

      const content = readFileSync(filePath, 'utf-8');
      const metadata = JSON.parse(content) as ToolMetadata;

      // POP: Delete file after reading (each metadata is only needed once)
      try { unlinkSync(filePath); } catch { /* ignore */ }

      // Check if expired (safety check)
      if (Date.now() - metadata.timestamp > METADATA_MAX_AGE_MS) {
        return undefined;
      }

      return metadata;
    } catch {
      return undefined;
    }
  },

  delete(toolUseId: string): void {
    try {
      const filePath = join(METADATA_DIR, `${toolUseId}.json`);
      unlinkSync(filePath);
    } catch {
      // Silently fail
    }
  },

  get size(): number {
    try {
      const files = require('fs').readdirSync(METADATA_DIR);
      return files.filter((f: string) => f.endsWith('.json')).length;
    } catch {
      return 0;
    }
  },
};

// Clean up old metadata files periodically
function cleanupMetadataFiles(): void {
  try {
    const files = require('fs').readdirSync(METADATA_DIR);
    const now = Date.now();

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const filePath = join(METADATA_DIR, file);
        const content = readFileSync(filePath, 'utf-8');
        const metadata = JSON.parse(content) as ToolMetadata;
        if (now - metadata.timestamp > METADATA_MAX_AGE_MS) {
          unlinkSync(filePath);
        }
      } catch {
        // Ignore individual file errors
      }
    }
  } catch {
    // Silently fail
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupMetadataFiles, METADATA_MAX_AGE_MS);

function debugLog(...args: unknown[]) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  const message = `${timestamp} [interceptor] ${args.map((a) => {
    if (typeof a === 'object') {
      try {
        return JSON.stringify(a);
      } catch (e) {
        const keys = a && typeof a === 'object' ? Object.keys(a as object).join(', ') : 'unknown';
        return `[CYCLIC STRUCTURE, keys: ${keys}] (error: ${e})`;
      }
    }
    return String(a);
  }).join(' ')}`;
  // Write to log file instead of stderr to avoid console spam
  try {
    appendFileSync(LOG_FILE, message + '\n');
  } catch {
    // Silently fail if can't write to log file
  }
}


/**
 * Get the configured API base URL at request time.
 * Reads from env var (set by auth/sessions before SDK starts) with Anthropic default fallback.
 */
function getConfiguredBaseUrl(): string {
  return process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';
}

/**
 * Check if URL is a messages endpoint for the configured API provider.
 * Works with Anthropic, OpenRouter, and any custom baseUrl.
 */
function isApiMessagesUrl(url: string): boolean {
  const baseUrl = getConfiguredBaseUrl();
  return url.startsWith(baseUrl) && url.includes('/messages');
}

/**
 * Add _intent and _displayName fields to all tool schemas in Anthropic API request.
 * Returns the modified request body object.
 *
 * - _intent: 1-2 sentence description of what the tool call accomplishes (for UI activity descriptions)
 * - _displayName: 2-4 word human-friendly action name (for UI tool name display)
 *
 * These fields are extracted for UI display in tool-matching.ts, then stripped
 * before execution in pre-tool-use.ts to avoid SDK validation errors.
 */
function addMetadataToAllTools(body: Record<string, unknown>): Record<string, unknown> {
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
    // Add metadata fields to ALL tools with input schemas
    if (tool.input_schema?.properties) {
      let modified = false;

      // Add _intent if not present
      if (!('_intent' in tool.input_schema.properties)) {
        tool.input_schema.properties._intent = {
          type: 'string',
          description: 'REQUIRED: Describe what you are trying to accomplish with this tool call (1-2 sentences)',
        };
        modified = true;
      }

      // Add _displayName if not present
      if (!('_displayName' in tool.input_schema.properties)) {
        tool.input_schema.properties._displayName = {
          type: 'string',
          description: 'REQUIRED: Human-friendly name for this action (2-4 words, e.g., "List Folders", "Search Documents", "Create Task")',
        };
        modified = true;
      }

      // Add both to required array if we modified anything
      if (modified) {
        const currentRequired = tool.input_schema.required || [];
        const newRequired = [...currentRequired];
        if (!currentRequired.includes('_intent')) {
          newRequired.push('_intent');
        }
        if (!currentRequired.includes('_displayName')) {
          newRequired.push('_displayName');
        }
        tool.input_schema.required = newRequired;
        modifiedCount++;
      }
    }
  }

  if (modifiedCount > 0) {
    debugLog(`[Tool Schema] Added _intent and _displayName to ${modifiedCount} tools`);
  }

  return body;
}

/**
 * Extract and strip _intent/_displayName from tool_use blocks in API response.
 * Stores extracted metadata in toolMetadataStore for later retrieval.
 * Returns the modified response body with metadata stripped from tool inputs.
 *
 * This runs BEFORE the SDK sees the response, so the SDK won't reject
 * the "unexpected parameters".
 */
function stripToolMetadataFromResponse(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;

  const response = body as Record<string, unknown>;
  const content = response.content as Array<{
    type: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }> | undefined;

  if (!content || !Array.isArray(content)) return body;

  let modifiedCount = 0;

  for (const block of content) {
    if (block.type === 'tool_use' && block.id && block.input) {
      const { _intent, _displayName, ...cleanInput } = block.input;

      // Store metadata if we found any
      if (_intent || _displayName) {
        toolMetadataStore.set(block.id, {
          intent: _intent as string | undefined,
          displayName: _displayName as string | undefined,
          timestamp: Date.now(),
        });
        debugLog(`[Response] Extracted metadata for ${block.name} (${block.id}): intent=${!!_intent}, displayName=${!!_displayName}`);

        // Replace input with cleaned version
        block.input = cleanInput;
        modifiedCount++;
      }
    }
  }

  if (modifiedCount > 0) {
    debugLog(`[Response] Stripped metadata from ${modifiedCount} tool_use blocks`);
  }

  return body;
}

/**
 * Check if URL should have API errors captured.
 * Uses the configured base URL so error capture works with any provider.
 */
function shouldCaptureApiErrors(url: string): boolean {
  return isApiMessagesUrl(url);
}

/**
 * Create a TransformStream that modifies SSE events to strip tool metadata.
 *
 * SSE events for tool_use come as:
 * 1. content_block_start: {"type":"tool_use","id":"...","name":"...","input":{}}
 * 2. content_block_delta (multiple): {"delta":{"type":"input_json_delta","partial_json":"..."}}
 * 3. content_block_stop: end of block
 *
 * We buffer input_json_delta for tool_use blocks, then emit modified content
 * when the block completes.
 */
function createSseTransformStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // Buffer for incomplete SSE data
  let buffer = '';

  // Track tool_use blocks: index -> { id, inputBuffer }
  const toolBlocks = new Map<number, { id: string; name: string; inputBuffer: string }>();

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      // Process complete events (separated by \n\n)
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || ''; // Keep incomplete part

      for (const part of parts) {
        if (!part.trim()) {
          controller.enqueue(encoder.encode('\n\n'));
          continue;
        }

        // Parse SSE event
        const lines = part.split('\n');
        let eventType = '';
        let data = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            data = line.slice(5).trim();
          }
        }

        // Try to process tool_use related events
        if (data) {
          try {
            const parsed = JSON.parse(data);

            // Track content_block_start for tool_use
            if (parsed.type === 'content_block_start' &&
                parsed.content_block?.type === 'tool_use') {
              const block = parsed.content_block;
              toolBlocks.set(parsed.index, {
                id: block.id,
                name: block.name,
                inputBuffer: '',
              });
              debugLog(`[SSE] Tracking tool_use block ${block.id} at index ${parsed.index}`);
            }

            // Buffer input_json_delta for tool_use blocks
            if (parsed.type === 'content_block_delta' &&
                parsed.delta?.type === 'input_json_delta' &&
                toolBlocks.has(parsed.index)) {
              const block = toolBlocks.get(parsed.index)!;
              block.inputBuffer += parsed.delta.partial_json;
              debugLog(`[SSE] Buffered delta for ${block.name} (${block.id}), buffer length: ${block.inputBuffer.length}`);
              // Don't emit - we'll emit modified version on content_block_stop
              continue;
            }

            // On content_block_stop, emit modified input and clean up
            if (parsed.type === 'content_block_stop') {
              debugLog(`[SSE] content_block_stop for index ${parsed.index}, tracked: ${toolBlocks.has(parsed.index)}`);
            }
            if (parsed.type === 'content_block_stop' && toolBlocks.has(parsed.index)) {
              const block = toolBlocks.get(parsed.index)!;
              toolBlocks.delete(parsed.index);

              try {
                // Parse the complete input
                const input = JSON.parse(block.inputBuffer);
                debugLog(`[SSE] Parsed input for ${block.name} (${block.id}), keys: ${Object.keys(input).join(', ')}`);
                const { _intent, _displayName, ...cleanInput } = input;

                // Store metadata if we found any
                if (_intent || _displayName) {
                  toolMetadataStore.set(block.id, {
                    intent: _intent,
                    displayName: _displayName,
                    timestamp: Date.now(),
                  });
                  debugLog(`[SSE] Extracted metadata for ${block.name} (${block.id}): intent=${!!_intent}, displayName=${!!_displayName}`);

                  // Emit modified input as a single delta
                  const modifiedDelta = {
                    type: 'content_block_delta',
                    index: parsed.index,
                    delta: {
                      type: 'input_json_delta',
                      partial_json: JSON.stringify(cleanInput),
                    },
                  };
                  controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(modifiedDelta)}\n\n`));
                } else {
                  debugLog(`[SSE] No metadata found in ${block.name} (${block.id}) - _intent: ${!!_intent}, _displayName: ${!!_displayName}`);
                  // No metadata to strip - emit original buffered content
                  const originalDelta = {
                    type: 'content_block_delta',
                    index: parsed.index,
                    delta: {
                      type: 'input_json_delta',
                      partial_json: block.inputBuffer,
                    },
                  };
                  controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(originalDelta)}\n\n`));
                }
              } catch (parseErr) {
                debugLog(`[SSE] Failed to parse buffered input for ${block.id}:`, parseErr);
                // Emit original on error
                const originalDelta = {
                  type: 'content_block_delta',
                  index: parsed.index,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: block.inputBuffer,
                  },
                };
                controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(originalDelta)}\n\n`));
              }
            }
          } catch {
            // Not JSON or parsing failed - pass through
          }
        }

        // Emit the original event
        controller.enqueue(encoder.encode(part + '\n\n'));
      }
    },

    flush(controller) {
      // Emit any remaining buffer
      if (buffer.trim()) {
        controller.enqueue(encoder.encode(buffer));
      }
    },
  });
}

/**
 * Intercept and modify an API response to strip tool metadata.
 * Handles both streaming (SSE) and non-streaming (JSON) responses.
 */
async function interceptApiResponse(response: Response): Promise<Response> {
  if (!response.ok) return response;

  const contentType = response.headers.get('content-type') ?? '';

  // Handle SSE streaming responses
  if (contentType.includes('text/event-stream')) {
    if (!response.body) return response;

    debugLog('[SSE] Intercepting streaming response');
    const transformedBody = response.body.pipeThrough(createSseTransformStream());

    return new Response(transformedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  // Handle non-streaming JSON responses
  try {
    const clone = response.clone();
    const text = await clone.text();

    if (!text) return response;

    const parsed = JSON.parse(text);
    const modified = stripToolMetadataFromResponse(parsed);

    if (modified !== parsed) {
      const newBody = JSON.stringify(modified);
      return new Response(newBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return response;
  } catch (e) {
    debugLog(`[Response interception failed]:`, e);
    return response;
  }
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

  if (
    isApiMessagesUrl(url) &&
    init?.method?.toUpperCase() === 'POST' &&
    init?.body
  ) {
    try {
      const body = typeof init.body === 'string' ? init.body : undefined;
      if (body) {
        let parsed = JSON.parse(body);

        // Add _intent and _displayName to all tool schemas (REQUEST modification)
        parsed = addMetadataToAllTools(parsed);

        const modifiedInit = {
          ...init,
          body: JSON.stringify(parsed),
        };

        let response = await originalFetch(url, modifiedInit);

        // Strip _intent and _displayName from tool_use blocks (RESPONSE modification)
        // This runs BEFORE SDK validation, storing metadata in toolMetadataStore
        response = await interceptApiResponse(response);

        return logResponse(response, url, startTime);
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
debugLog('Fetch interceptor installed');
