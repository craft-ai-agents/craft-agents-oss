/**
 * Fetch interceptor for Anthropic API requests.
 *
 * Loaded via bunfig.toml preload to run BEFORE any modules are evaluated.
 * This ensures we patch globalThis.fetch before the SDK captures it.
 *
 * Features:
 * - Captures API errors for error handler (4xx/5xx responses)
 * - Adds _intent and _displayName metadata to all tool schemas (request)
 * - Strips _intent/_displayName from SSE response stream before SDK processes it
 *   (extracted into toolMetadataStore for UI consumption by tool-matching.ts)
 */

// Shared infrastructure (toolMetadataStore, error capture, logging, config)
import {
  DEBUG,
  debugLog,
  isRichToolDescriptionsEnabled,
  setStoredError,
  toolMetadataStore,
  displayNameSchema,
  intentSchema,
} from './interceptor-common.ts';

// Re-export shared types and functions for backward compatibility
// (existing code imports from this file)
export {
  toolMetadataStore,
  debugLog,
  isRichToolDescriptionsEnabled,
} from './interceptor-common.ts';
export type { LastApiError, ToolMetadata } from './interceptor-common.ts';
export { getLastApiError, clearLastApiError } from './interceptor-common.ts';

// Type alias for fetch's HeadersInit (not in ESNext lib, but available at runtime via Bun)
// Using string[][] instead of [string, string][] to match RequestInit.headers type
type HeadersInitType = Headers | Record<string, string> | string[][];


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
 *
 * IMPORTANT: Properties are always ordered with _displayName first, _intent second,
 * followed by original properties. This ensures consistent schema structure across
 * all tools for LLM input cache stability.
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

  const richDescriptions = isRichToolDescriptionsEnabled();
  let modifiedCount = 0;
  for (const tool of tools) {
    // Skip non-MCP tools when rich tool descriptions is disabled
    const isMcpTool = tool.name?.startsWith('mcp__');
    if (!richDescriptions && !isMcpTool) {
      continue;
    }

    // Add metadata fields to tools with input schemas
    if (tool.input_schema?.properties) {
      // Extract existing properties, excluding any existing metadata fields
      const { _displayName, _intent, ...restProperties } = tool.input_schema.properties as {
        _displayName?: unknown;
        _intent?: unknown;
        [key: string]: unknown;
      };

      // Reconstruct properties with metadata fields FIRST for cache stability
      // This ensures consistent ordering: _displayName, _intent, then original properties
      tool.input_schema.properties = {
        _displayName: _displayName || displayNameSchema,
        _intent: _intent || intentSchema,
        ...restProperties,
      };

      // Reconstruct required array with metadata fields first
      const currentRequired = tool.input_schema.required || [];
      const otherRequired = currentRequired.filter(r => r !== '_displayName' && r !== '_intent');
      tool.input_schema.required = ['_displayName', '_intent', ...otherRequired];

      modifiedCount++;
    }
  }

  if (modifiedCount > 0) {
    debugLog(`[Tool Schema] Added _intent and _displayName to ${modifiedCount} tools`);
  }

  return body;
}

/**
 * Re-inject stored _intent/_displayName metadata into tool_use blocks in conversation history.
 *
 * The SSE stripping stream removes metadata from responses before the SDK stores them,
 * so conversation history sent in subsequent API calls lacks _intent/_displayName.
 * Claude follows its own example from history, so if previous tool calls lack these fields,
 * Claude stops including them — creating a self-defeating feedback loop.
 *
 * This function walks the outbound messages array and injects stored metadata back into
 * assistant tool_use blocks, so Claude sees its previous calls WITH metadata and continues
 * to include the fields consistently.
 */
function injectMetadataIntoHistory(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages as Array<{
    role?: string;
    content?: Array<{
      type?: string;
      id?: string;
      input?: Record<string, unknown>;
    }>;
  }> | undefined;

  if (!messages) return body;

  let injectedCount = 0;

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (block.type !== 'tool_use' || !block.id || !block.input) continue;

      // Skip if already has metadata (e.g., first few calls before stripping takes effect)
      if ('_intent' in block.input || '_displayName' in block.input) continue;

      // Look up stored metadata (in-memory first, then file fallback)
      const stored = toolMetadataStore.get(block.id);
      if (stored) {
        // Reconstruct input with metadata FIRST to match schema order (_displayName, _intent, ...rest)
        // This ensures JSON key order matches what Claude originally generated for cache stability
        const newInput: Record<string, unknown> = {};
        if (stored.displayName) newInput._displayName = stored.displayName;
        if (stored.intent) newInput._intent = stored.intent;
        Object.assign(newInput, block.input);
        block.input = newInput;
        injectedCount++;
      }
    }
  }

  if (injectedCount > 0) {
    debugLog(`[History Inject] Re-injected metadata into ${injectedCount} tool_use blocks`);
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

// ============================================================================
// SSE METADATA STRIPPING
// ============================================================================

/** State for a tracked tool_use block during SSE streaming */
interface TrackedToolBlock {
  id: string;
  name: string;
  index: number;
  bufferedJson: string;
}

const SSE_EVENT_RE = /^event:\s*(.+)$/;
const SSE_DATA_RE = /^data:\s*(.+)$/;

/**
 * Creates a TransformStream that intercepts SSE events from the Anthropic API,
 * buffers tool_use input deltas, extracts _intent/_displayName into the metadata
 * store, and re-emits clean events without those fields.
 *
 * This prevents the SDK from seeing metadata fields in built-in tool inputs,
 * avoiding InputValidationError from the SDK's schema validation.
 */
function createSseMetadataStrippingStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Track active tool_use blocks by their content block index
  const trackedBlocks = new Map<number, TrackedToolBlock>();
  // Buffer for incomplete SSE data across chunk boundaries
  let lineBuffer = '';
  // Persist SSE event/data across chunk boundaries (event: and data: may be in different chunks)
  let currentEventType = '';
  let currentData = '';

  let eventCount = 0;

  function processEvent(eventType: string, dataStr: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    eventCount++;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataStr);
    } catch {
      // Not valid JSON, pass through
      emitSseEvent(eventType, dataStr, controller);
      return;
    }

    // content_block_start with tool_use: start tracking
    if (eventType === 'content_block_start') {
      const contentBlock = data.content_block as { type?: string; id?: string; name?: string } | undefined;
      if (contentBlock?.type === 'tool_use' && contentBlock.id && contentBlock.name != null) {
        const index = data.index as number;
        trackedBlocks.set(index, {
          id: contentBlock.id,
          name: contentBlock.name,
          index,
          bufferedJson: '',
        });
      }
      // Pass through unchanged
      emitSseEvent(eventType, dataStr, controller);
      return;
    }

    // content_block_delta with input_json_delta for a tracked block: buffer and suppress
    if (eventType === 'content_block_delta') {
      const index = data.index as number;
      const delta = data.delta as { type?: string; partial_json?: string } | undefined;

      if (delta?.type === 'input_json_delta' && trackedBlocks.has(index)) {
        const block = trackedBlocks.get(index)!;
        block.bufferedJson += delta.partial_json ?? '';
        // Suppress this event — we'll re-emit clean content at block_stop
        return;
      }
      // Not a tracked block, pass through
      emitSseEvent(eventType, dataStr, controller);
      return;
    }

    // content_block_stop for a tracked block: process buffered JSON
    if (eventType === 'content_block_stop') {
      const index = data.index as number;
      const block = trackedBlocks.get(index);

      if (block) {
        trackedBlocks.delete(index);
        emitBufferedBlock(block, index, controller);
        // Then emit the stop event
        emitSseEvent(eventType, dataStr, controller);
        return;
      }
      // Not tracked, pass through
      emitSseEvent(eventType, dataStr, controller);
      return;
    }

    // All other events pass through unchanged
    emitSseEvent(eventType, dataStr, controller);
  }

  function emitBufferedBlock(
    block: TrackedToolBlock,
    index: number,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): void {
    if (!block.bufferedJson) {
      return;
    }

    try {
      const parsed = JSON.parse(block.bufferedJson);

      // Extract metadata
      const intent = typeof parsed._intent === 'string' ? parsed._intent : undefined;
      const displayName = typeof parsed._displayName === 'string' ? parsed._displayName : undefined;

      if (intent || displayName) {
        toolMetadataStore.set(block.id, {
          intent,
          displayName,
          timestamp: Date.now(),
        });
        debugLog(`[SSE Strip] Stored metadata for ${block.name} (${block.id}): intent=${!!intent}, displayName=${!!displayName}`);
      }

      // Remove metadata fields
      delete parsed._intent;
      delete parsed._displayName;

      const cleanJson = JSON.stringify(parsed);

      // Re-emit as a single input_json_delta event
      const deltaEvent = {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'input_json_delta',
          partial_json: cleanJson,
        },
      };
      emitSseEvent('content_block_delta', JSON.stringify(deltaEvent), controller);
    } catch {
      // Parse failed — emit original buffered content unchanged as safety fallback
      debugLog(`[SSE Strip] Failed to parse buffered JSON for ${block.name} (${block.id}), passing through`);
      const deltaEvent = {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'input_json_delta',
          partial_json: block.bufferedJson,
        },
      };
      emitSseEvent('content_block_delta', JSON.stringify(deltaEvent), controller);
    }
  }

  function emitSseEvent(
    eventType: string,
    dataStr: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): void {
    const sseText = `event: ${eventType}\ndata: ${dataStr}\n\n`;
    controller.enqueue(encoder.encode(sseText));
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = lineBuffer + decoder.decode(chunk, { stream: true });
      // Split into lines; SSE events are separated by double newlines
      const lines = text.split('\n');
      // Last element may be incomplete — buffer it
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === '') {
          // Empty line = end of SSE event
          if (currentEventType && currentData) {
            processEvent(currentEventType, currentData, controller);
          }
          currentEventType = '';
          currentData = '';
          continue;
        }

        const eventMatch = trimmed.match(SSE_EVENT_RE);
        if (eventMatch) {
          currentEventType = eventMatch[1]!.trim();
          continue;
        }

        const dataMatch = trimmed.match(SSE_DATA_RE);
        if (dataMatch) {
          currentData = dataMatch[1]!;
          continue;
        }
      }
    },

    flush(controller) {
      // Process any remaining buffered line data
      if (lineBuffer.trim()) {
        const lines = lineBuffer.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '') {
            if (currentEventType && currentData) {
              processEvent(currentEventType, currentData, controller);
            }
            currentEventType = '';
            currentData = '';
            continue;
          }
          const eventMatch = trimmed.match(SSE_EVENT_RE);
          if (eventMatch) {
            currentEventType = eventMatch[1]!.trim();
            continue;
          }
          const dataMatch = trimmed.match(SSE_DATA_RE);
          if (dataMatch) {
            currentData = dataMatch[1]!;
          }
        }

        if (currentEventType && currentData) {
          processEvent(currentEventType, currentData, controller);
        }
      }

      // Emit any remaining buffered blocks
      for (const [index, block] of trackedBlocks) {
        emitBufferedBlock(block, index, controller);
      }
      trackedBlocks.clear();
      lineBuffer = '';
      debugLog(`[SSE] Stream flush complete. Total events processed: ${eventCount}`);
    },
  });
}

/**
 * Strip _intent/_displayName metadata from SSE response streams.
 * Non-streaming and error responses pass through unchanged.
 */
function stripMetadataFromResponse(response: Response): Response {
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('text/event-stream') || !response.body) {
    debugLog(`[SSE Strip] Skipping non-SSE response: content-type=${contentType}, hasBody=${!!response.body}`);
    return response;
  }

  debugLog(`[SSE Strip] Creating stripping stream for SSE response`);
  const strippingStream = createSseMetadataStrippingStream();
  const transformedBody = response.body.pipeThrough(strippingStream);

  return new Response(transformedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
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
        // Re-inject stored metadata into tool_use history so Claude keeps including fields
        parsed = injectMetadataIntoHistory(parsed);

        const modifiedInit = {
          ...init,
          body: JSON.stringify(parsed),
        };

        // Strip _intent/_displayName from SSE response before SDK sees it
        const response = await originalFetch(url, modifiedInit);
        const strippedResponse = stripMetadataFromResponse(response);
        return logResponse(strippedResponse, url, startTime);
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
