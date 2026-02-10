/**
 * Fetch interceptor for Copilot CLI (OpenAI API format).
 *
 * Loaded via NODE_OPTIONS="--require ..." into the Copilot CLI subprocess.
 * Patches globalThis.fetch before the OpenAI SDK captures it.
 *
 * Features:
 * - Adds _intent and _displayName metadata to all tool schemas (request)
 * - Re-injects stored metadata into tool_calls history (request)
 * - Captures _intent/_displayName from SSE streaming tool call arguments (response)
 *   → stored in toolMetadataStore for UI consumption by event-adapter.ts
 *
 * Unlike the Anthropic interceptor, this is CAPTURE-ONLY for responses:
 * SSE data passes through unchanged. The Copilot preToolUse hook handles
 * stripping metadata via stripToolMetadata() before tool execution.
 */

import {
  debugLog,
  isRichToolDescriptionsEnabled,
  setStoredError,
  toolMetadataStore,
  displayNameSchema,
  intentSchema,
} from './interceptor-common.ts';

// ============================================================================
// URL DETECTION
// ============================================================================

/**
 * Check if URL is a chat completion endpoint.
 * Works with OpenAI, Azure, GitHub Copilot, and custom endpoints.
 */
function isChatCompletionUrl(url: string): boolean {
  return url.includes('/chat/completions');
}

// ============================================================================
// REQUEST MODIFICATION: SCHEMA INJECTION
// ============================================================================

/**
 * Add _intent and _displayName fields to all tool schemas in OpenAI API request.
 *
 * OpenAI format: tools[].function.parameters.properties
 * (vs Anthropic: tools[].input_schema.properties)
 *
 * Properties ordered: _displayName first, _intent second, then original.
 * This ensures consistent schema structure for cache stability.
 */
function addMetadataToAllTools(body: Record<string, unknown>): Record<string, unknown> {
  const tools = body.tools as Array<{
    type?: string;
    function?: {
      name?: string;
      parameters?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
    };
  }> | undefined;

  if (!tools || !Array.isArray(tools)) {
    return body;
  }

  const richDescriptions = isRichToolDescriptionsEnabled();
  let modifiedCount = 0;

  for (const tool of tools) {
    if (tool.type !== 'function' || !tool.function?.parameters?.properties) continue;

    // Skip non-MCP tools when rich tool descriptions is disabled
    const isMcpTool = tool.function.name?.startsWith('mcp__');
    if (!richDescriptions && !isMcpTool) {
      continue;
    }

    const params = tool.function.parameters;
    const { _displayName, _intent, ...restProperties } = params.properties as {
      _displayName?: unknown;
      _intent?: unknown;
      [key: string]: unknown;
    };

    // Reconstruct with metadata FIRST for cache stability
    params.properties = {
      _displayName: _displayName || displayNameSchema,
      _intent: _intent || intentSchema,
      ...restProperties,
    };

    // Reconstruct required array with metadata fields first
    const currentRequired = params.required || [];
    const otherRequired = currentRequired.filter(r => r !== '_displayName' && r !== '_intent');
    params.required = ['_displayName', '_intent', ...otherRequired];

    modifiedCount++;
  }

  if (modifiedCount > 0) {
    debugLog(`[Copilot Schema] Added _intent and _displayName to ${modifiedCount} tools`);
  }

  return body;
}

// ============================================================================
// REQUEST MODIFICATION: HISTORY INJECTION
// ============================================================================

/**
 * Re-inject stored _intent/_displayName metadata into tool_calls in conversation history.
 *
 * OpenAI format: messages[].tool_calls[].function.arguments (JSON string)
 * (vs Anthropic: messages[].content[].input (object))
 *
 * Without this, the model sees its previous tool calls without metadata and
 * stops including the fields — a self-defeating feedback loop.
 */
function injectMetadataIntoHistory(body: Record<string, unknown>): Record<string, unknown> {
  const messages = body.messages as Array<{
    role?: string;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  }> | undefined;

  if (!messages) return body;

  let injectedCount = 0;

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;

    for (const tc of message.tool_calls) {
      if (!tc.id || !tc.function?.arguments) continue;

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        continue;
      }

      // Skip if already has metadata
      if ('_intent' in args || '_displayName' in args) continue;

      // Look up stored metadata
      const stored = toolMetadataStore.get(tc.id);
      if (stored) {
        // Reconstruct with metadata FIRST to match schema order
        const newArgs: Record<string, unknown> = {};
        if (stored.displayName) newArgs._displayName = stored.displayName;
        if (stored.intent) newArgs._intent = stored.intent;
        Object.assign(newArgs, args);
        tc.function.arguments = JSON.stringify(newArgs);
        injectedCount++;
      }
    }
  }

  if (injectedCount > 0) {
    debugLog(`[Copilot History] Re-injected metadata into ${injectedCount} tool_calls`);
  }

  return body;
}

// ============================================================================
// RESPONSE: SSE METADATA CAPTURE (passthrough — no modification)
// ============================================================================

/** Tracked tool call during SSE streaming */
interface TrackedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Creates a TransformStream that passes ALL SSE data through unchanged
 * while capturing tool call metadata from the stream.
 *
 * When tool arguments are complete (finish_reason === "tool_calls" or "stop"),
 * parses the accumulated JSON and stores _intent/_displayName in toolMetadataStore.
 *
 * This is simpler than the Anthropic interceptor because we don't need to
 * strip metadata — the preToolUse hook handles that.
 */
function createSseMetadataCaptureStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Track active tool calls by index
  const trackedCalls = new Map<number, TrackedToolCall>();
  // Buffer for incomplete lines across chunk boundaries
  let lineBuffer = '';

  function processDataLine(dataStr: string): void {
    if (dataStr === '[DONE]') {
      flushTrackedCalls();
      return;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return;
    }

    const choices = data.choices as Array<{
      index?: number;
      delta?: {
        tool_calls?: Array<{
          index?: number;
          id?: string;
          type?: string;
          function?: {
            name?: string;
            arguments?: string;
          };
        }>;
      };
      finish_reason?: string | null;
    }> | undefined;

    if (!choices || choices.length === 0) return;

    const choice = choices[0];
    if (!choice) return;

    // Buffer tool call arguments
    if (choice.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index ?? 0;

        // First chunk for this tool call — has id and name
        if (tc.id) {
          trackedCalls.set(idx, {
            id: tc.id,
            name: tc.function?.name || 'unknown',
            arguments: tc.function?.arguments || '',
          });
        } else {
          // Subsequent chunks — accumulate arguments
          const existing = trackedCalls.get(idx);
          if (existing && tc.function?.arguments) {
            existing.arguments += tc.function.arguments;
          }
        }
      }
    }

    // On finish, extract metadata from accumulated arguments
    if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
      flushTrackedCalls();
    }
  }

  function flushTrackedCalls(): void {
    for (const [, tc] of trackedCalls) {
      if (!tc.arguments) continue;

      try {
        const parsed = JSON.parse(tc.arguments);
        const intent = typeof parsed._intent === 'string' ? parsed._intent : undefined;
        const displayName = typeof parsed._displayName === 'string' ? parsed._displayName : undefined;

        if (intent || displayName) {
          toolMetadataStore.set(tc.id, {
            intent,
            displayName,
            timestamp: Date.now(),
          });
          debugLog(`[Copilot SSE] Stored metadata for ${tc.name} (${tc.id}): intent=${!!intent}, displayName=${!!displayName}`);
        }
      } catch {
        debugLog(`[Copilot SSE] Failed to parse arguments for ${tc.name} (${tc.id})`);
      }
    }
    trackedCalls.clear();
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // ALWAYS pass through unchanged — capture only
      controller.enqueue(chunk);

      // Parse SSE lines to extract tool call data
      const text = lineBuffer + decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          processDataLine(trimmed.slice(6));
        }
      }
    },

    flush(controller) {
      // Process any remaining buffered data
      if (lineBuffer.trim()) {
        const trimmed = lineBuffer.trim();
        if (trimmed.startsWith('data: ')) {
          processDataLine(trimmed.slice(6));
        }
      }
      // Flush any remaining tracked calls
      flushTrackedCalls();
      lineBuffer = '';
    },
  });
}

/**
 * Capture metadata from non-streaming response.
 */
function captureNonStreamingMetadata(response: Response): Response {
  // For non-streaming, we'd need to clone and read the body.
  // Non-streaming Copilot responses are rare (streaming is default).
  // The preToolUse hook captures metadata as a fallback.
  return response;
}

// ============================================================================
// ERROR CAPTURE
// ============================================================================

/**
 * Capture API errors from responses for the error handler.
 */
async function captureApiError(response: Response, url: string): Promise<void> {
  if (response.status < 400) return;

  const errorClone = response.clone();
  try {
    const errorText = await errorClone.text();
    let errorMessage = response.statusText;

    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      } else if (errorJson.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      if (errorText) errorMessage = errorText;
    }

    setStoredError({
      status: response.status,
      statusText: response.statusText,
      message: errorMessage,
      timestamp: Date.now(),
    });
    debugLog(`[Copilot Error] Captured: ${response.status} ${errorMessage}`);
  } catch (e) {
    setStoredError({
      status: response.status,
      statusText: response.statusText,
      message: response.statusText,
      timestamp: Date.now(),
    });
    debugLog(`[Copilot Error] Body read failed, captured basic info: ${e}`);
  }
}

// ============================================================================
// FETCH INTERCEPTION
// ============================================================================

const originalFetch = globalThis.fetch.bind(globalThis);

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

  if (
    isChatCompletionUrl(url) &&
    init?.method?.toUpperCase() === 'POST' &&
    init?.body
  ) {
    try {
      const body = typeof init.body === 'string' ? init.body : undefined;
      if (body) {
        let parsed = JSON.parse(body);

        // Add _intent and _displayName to all tool schemas
        parsed = addMetadataToAllTools(parsed);
        // Re-inject stored metadata into tool_calls history
        parsed = injectMetadataIntoHistory(parsed);

        const modifiedInit = {
          ...init,
          body: JSON.stringify(parsed),
        };

        debugLog(`[Copilot Fetch] Intercepted chat completion request to ${url}`);
        const response = await originalFetch(url, modifiedInit);

        // Capture API errors
        await captureApiError(response, url);

        // Pipe SSE through capture stream (passthrough + metadata extraction)
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('text/event-stream') && response.body) {
          debugLog(`[Copilot Fetch] Creating SSE capture stream`);
          const captureStream = createSseMetadataCaptureStream();
          return new Response(response.body.pipeThrough(captureStream), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }

        // Non-streaming: capture from complete response
        return captureNonStreamingMetadata(response);
      }
    } catch (e) {
      debugLog(`[Copilot Fetch] Modification failed: ${e}`);
    }
  }

  return originalFetch(input, init);
}

// Create proxy to handle both function calls and static properties
const fetchProxy = new Proxy(interceptedFetch, {
  apply(target, thisArg, args) {
    return Reflect.apply(target, thisArg, args);
  },
  get(target, prop, receiver) {
    if (prop in originalFetch) {
      return (originalFetch as unknown as Record<string | symbol, unknown>)[prop];
    }
    return Reflect.get(target, prop, receiver);
  },
});

(globalThis as unknown as { fetch: unknown }).fetch = fetchProxy;
debugLog('[Copilot] Fetch interceptor installed');
