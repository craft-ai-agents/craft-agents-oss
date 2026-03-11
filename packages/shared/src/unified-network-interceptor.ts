/**
 * Unified fetch interceptor for all AI API requests (Anthropic + OpenAI format).
 *
 * Loaded via --preload (Bun) or --require (Node) into SDK subprocesses.
 * Patches globalThis.fetch before any SDK captures it.
 *
 * Features:
 * - Adds _intent and _displayName metadata to all tool schemas (request)
 * - Re-injects stored metadata into conversation history (request)
 * - Processes SSE response streams per API format:
 *   - Anthropic: STRIPS metadata from stream (SDK validates immediately)
 *   - OpenAI: CAPTURES metadata passthrough (hook strips before execution)
 * - Captures API errors (4xx/5xx) for error handler
 * - Fast mode support for Anthropic (Opus 4.6)
 *
 * Auto-detects API format based on request URL:
 * - Anthropic: baseUrl + /messages
 * - OpenAI: /chat/completions
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
import { FEATURE_FLAGS } from './feature-flags.ts';
import { resolveRequestContext } from './interceptor-request-utils.ts';

// Type alias for fetch's HeadersInit
type HeadersInitType = Headers | Record<string, string> | string[][];

// ============================================================================
// API ADAPTER INTERFACE
// ============================================================================

/**
 * Adapter interface for API-format-specific behavior.
 * Each adapter handles the differences between Anthropic and OpenAI API formats.
 */
interface ApiAdapter {
  name: string;
  shouldIntercept(url: string): boolean;
  addMetadataToTools(body: Record<string, unknown>): Record<string, unknown>;
  injectMetadataIntoHistory(body: Record<string, unknown>): Record<string, unknown>;
  createSseProcessor(): TransformStream<Uint8Array, Uint8Array>;
  /** Whether SSE processing strips metadata (Anthropic) or passes through (OpenAI) */
  stripsSseMetadata: boolean;
  /** Optional request modifications (e.g., fast mode headers) */
  modifyRequest?(url: string, init: RequestInit, body: Record<string, unknown>): { init: RequestInit; body: Record<string, unknown> };
}

// ============================================================================
// SHARED HELPERS
// ============================================================================

/**
 * Inject _displayName and _intent into a tool's properties object.
 * Shared by both Anthropic and OpenAI adapters (same logic, different schema paths).
 */
function injectMetadataFields(
  properties: Record<string, unknown>,
  required: string[] | undefined,
): { properties: Record<string, unknown>; required: string[] } {
  const { _displayName, _intent, ...rest } = properties as {
    _displayName?: unknown;
    _intent?: unknown;
    [key: string]: unknown;
  };
  const newProperties = {
    _displayName: _displayName || displayNameSchema,
    _intent: _intent || intentSchema,
    ...rest,
  };
  const otherRequired = (required || []).filter(r => r !== '_displayName' && r !== '_intent');
  return { properties: newProperties, required: ['_displayName', '_intent', ...otherRequired] };
}

/**
 * Normalize a tool schema so metadata can always be injected, including zero-arg
 * tools whose schema may be `{ type: "object" }` without a `properties` key.
 *
 * Exported for focused unit tests.
 */
export function injectMetadataIntoToolSchema<T extends {
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}>(
  schema: T,
): T & { properties: Record<string, unknown>; required: string[] } {
  const normalizedProperties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const normalizedRequired = Array.isArray(schema.required) ? schema.required : [];
  const result = injectMetadataFields(normalizedProperties, normalizedRequired);
  return {
    ...schema,
    properties: result.properties,
    required: result.required,
  };
}

/**
 * Extract _intent/_displayName from a parsed tool input and store in toolMetadataStore.
 * Shared by both SSE processors (Anthropic strips, OpenAI captures).
 *
 * @returns true if metadata was found and stored
 */
function captureMetadataFromInput(toolId: string, toolName: string, parsed: Record<string, unknown>): boolean {
  const intent = typeof parsed._intent === 'string' ? parsed._intent : undefined;
  const displayName = typeof parsed._displayName === 'string' ? parsed._displayName : undefined;
  if (intent || displayName) {
    toolMetadataStore.set(toolId, { intent, displayName, timestamp: Date.now() });
    debugLog(`[SSE] Stored metadata for ${toolName} (${toolId}): intent=${!!intent}, displayName=${!!displayName}`);
    return true;
  }
  return false;
}

// ============================================================================
// ANTHROPIC ADAPTER
// ============================================================================

/**
 * Get the configured API base URL at request time.
 * Reads from env var (set by auth/sessions before SDK starts) with Anthropic default fallback.
 */
function getConfiguredBaseUrl(): string {
  return process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';
}

const FAST_MODE_BETA = 'fast-mode-2026-02-01';

/**
 * Strip cache_control from empty text blocks in API request bodies.
 *
 * The Claude Agent SDK's auto-mode classifier can assign cache_control to
 * content blocks without checking whether their text is empty. The Anthropic
 * API rejects this with "cache_control cannot be set for empty text blocks".
 *
 * Exported for focused unit tests.
 */
export function sanitizeEmptyTextCacheControl(body: Record<string, unknown>): number {
  const messages = body.messages as Array<{ content?: Array<Record<string, unknown>> }> | undefined;
  if (!messages) return 0;

  let stripped = 0;
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (
        block.type === 'text' &&
        block.cache_control &&
        (typeof block.text !== 'string' || !block.text.trim())
      ) {
        delete block.cache_control;
        stripped++;
      }
    }
  }

  if (stripped > 0) {
    debugLog(`[Anthropic] Stripped cache_control from ${stripped} empty text block(s)`);
  }
  return stripped;
}

/**
 * Check if fast mode should be enabled for this request.
 * Only activates for Opus 4.6 on Anthropic's API when the feature flag is on.
 */
function shouldEnableFastMode(model: unknown): boolean {
  if (!FEATURE_FLAGS.fastMode) return false;
  return typeof model === 'string' && model === 'claude-opus-4-6';
}

/**
 * Append a beta value to the anthropic-beta header, preserving existing values.
 */
function appendBetaHeader(headers: HeadersInitType | undefined, beta: string): Record<string, string> {
  let headerObj: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { headerObj[key] = value; });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      headerObj[key as string] = value as string;
    }
  } else if (headers) {
    headerObj = { ...headers };
  }

  const existing = headerObj['anthropic-beta'];
  headerObj['anthropic-beta'] = existing ? `${existing},${beta}` : beta;

  return headerObj;
}

/** State for a tracked tool_use block during Anthropic SSE streaming */
interface TrackedToolBlock {
  id: string;
  name: string;
  index: number;
  bufferedJson: string;
}

const SSE_EVENT_RE = /^event:\s*(.+)$/;
const SSE_DATA_RE = /^data:\s*(.+)$/;

/**
 * Creates a TransformStream that intercepts Anthropic SSE events,
 * buffers tool_use input deltas, extracts _intent/_displayName into the metadata
 * store, and re-emits clean events without those fields.
 */
export function createAnthropicSseStrippingStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const trackedBlocks = new Map<number, TrackedToolBlock>();
  let lineBuffer = '';
  let currentEventType = '';
  let currentData = '';
  let eventCount = 0;

  function processEvent(eventType: string, dataStr: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    eventCount++;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataStr);
    } catch {
      emitSseEvent(eventType, dataStr, controller);
      return;
    }

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
      emitSseEvent(eventType, dataStr, controller);
      return;
    }

    if (eventType === 'content_block_delta') {
      const index = data.index as number;
      const delta = data.delta as { type?: string; partial_json?: string } | undefined;

      if (delta?.type === 'input_json_delta' && trackedBlocks.has(index)) {
        const block = trackedBlocks.get(index)!;
        block.bufferedJson += delta.partial_json ?? '';
        return;
      }
      emitSseEvent(eventType, dataStr, controller);
      return;
    }

    if (eventType === 'content_block_stop') {
      const index = data.index as number;
      const block = trackedBlocks.get(index);

      if (block) {
        trackedBlocks.delete(index);
        emitBufferedBlock(block, index, controller);
        emitSseEvent(eventType, dataStr, controller);
        return;
      }
      emitSseEvent(eventType, dataStr, controller);
      return;
    }

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

      captureMetadataFromInput(block.id, block.name, parsed);
      delete parsed._intent;
      delete parsed._displayName;

      const cleanJson = JSON.stringify(parsed);

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
      const lines = text.split('\n');
      lineBuffer = lines.pop() ?? '';

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
          currentData = currentData ? `${currentData}\n${dataMatch[1]!}` : dataMatch[1]!;
          continue;
        }
      }
    },

    flush(controller) {
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
            currentData = currentData ? `${currentData}\n${dataMatch[1]!}` : dataMatch[1]!;
          }
        }

        if (currentEventType && currentData) {
          processEvent(currentEventType, currentData, controller);
        }
      }

      for (const [index, block] of trackedBlocks) {
        emitBufferedBlock(block, index, controller);
      }
      trackedBlocks.clear();
      lineBuffer = '';
      debugLog(`[SSE] Stream flush complete. Total events processed: ${eventCount}`);
    },
  });
}

const anthropicAdapter: ApiAdapter = {
  name: 'anthropic',

  shouldIntercept(url: string): boolean {
    const baseUrl = getConfiguredBaseUrl();
    return url.startsWith(baseUrl) && url.includes('/messages');
  },

  addMetadataToTools(body: Record<string, unknown>): Record<string, unknown> {
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
      // MCP tools always get metadata regardless of the feature flag — they're
      // lower-volume than built-in tools and the metadata drives source-specific
      // UI (tool intents, display names in the sidebar).
      const isMcpTool = tool.name?.startsWith('mcp__');
      if (!richDescriptions && !isMcpTool) {
        continue;
      }

      if (!tool.input_schema || typeof tool.input_schema !== 'object') {
        continue;
      }

      const updatedSchema = injectMetadataIntoToolSchema(tool.input_schema);
      tool.input_schema.properties = updatedSchema.properties;
      tool.input_schema.required = updatedSchema.required;
      // External MCP servers may set additionalProperties: false which would
      // cause the API to reject _intent/_displayName in tool inputs.
      if ((tool.input_schema as Record<string, unknown>).additionalProperties === false) {
        delete (tool.input_schema as Record<string, unknown>).additionalProperties;
      }
      modifiedCount++;
    }

    if (modifiedCount > 0) {
      debugLog(`[Anthropic Schema] Added _intent and _displayName to ${modifiedCount} tools`);
    }

    return body;
  },

  injectMetadataIntoHistory(body: Record<string, unknown>): Record<string, unknown> {
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

        const hasIntent = '_intent' in block.input;
        const hasDisplayName = '_displayName' in block.input;
        if (hasIntent && hasDisplayName) continue;

        const stored = toolMetadataStore.get(block.id);
        if (stored) {
          const newInput: Record<string, unknown> = {};
          if (!hasDisplayName && stored.displayName) newInput._displayName = stored.displayName;
          if (!hasIntent && stored.intent) newInput._intent = stored.intent;
          if (Object.keys(newInput).length > 0) {
            Object.assign(newInput, block.input);
            block.input = newInput;
            injectedCount++;
          }
        }
      }
    }

    if (injectedCount > 0) {
      debugLog(`[Anthropic History] Re-injected metadata into ${injectedCount} tool_use blocks`);
    }

    return body;
  },

  createSseProcessor(): TransformStream<Uint8Array, Uint8Array> {
    return createAnthropicSseStrippingStream();
  },

  stripsSseMetadata: true,

  modifyRequest(_url: string, init: RequestInit, body: Record<string, unknown>): { init: RequestInit; body: Record<string, unknown> } {
    sanitizeEmptyTextCacheControl(body);

    const fastMode = shouldEnableFastMode(body.model);
    if (fastMode) {
      body.speed = 'fast';
      debugLog(`[Fast Mode] Enabled for model=${body.model}`);
      return {
        init: {
          ...init,
          headers: appendBetaHeader(init?.headers as HeadersInitType | undefined, FAST_MODE_BETA),
        },
        body,
      };
    }
    return { init, body };
  },
};

// ============================================================================
// OPENAI ADAPTER
// ============================================================================

/** Tracked tool call during OpenAI SSE streaming */
interface TrackedToolCall {
  id: string;
  name: string;
  choiceIndex: number;
  toolIndex: number;
  arguments: string;
}

/**
 * Creates a TransformStream that intercepts OpenAI SSE events,
 * buffers tool_call argument deltas, extracts _intent/_displayName into the
 * metadata store, and re-emits clean events without those fields.
 *
 * Mirrors the Anthropic stripping stream behavior:
 * - Non-tool events pass through immediately
 * - Tool call argument deltas are suppressed and buffered
 * - On finish_reason, buffered args are parsed, metadata stripped, and
 *   re-emitted as a single argument delta per tool call
 */
export function createOpenAiSseStrippingStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const trackedCalls = new Map<string, TrackedToolCall>();
  let lineBuffer = '';
  /** Track whether we're currently buffering tool_call argument deltas */
  let bufferingToolCalls = false;

  function emitSseLine(dataStr: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
  }

  function flushTrackedCalls(controller: TransformStreamDefaultController<Uint8Array>): void {
    for (const tc of trackedCalls.values()) {
      if (!tc.arguments) continue;

      try {
        const parsed = JSON.parse(tc.arguments);
        captureMetadataFromInput(tc.id, tc.name, parsed);
        delete parsed._intent;
        delete parsed._displayName;
        const cleanArgs = JSON.stringify(parsed);

        // Re-emit as a single argument delta with the clean JSON
        const deltaEvent = {
          choices: [{
            index: tc.choiceIndex,
            delta: {
              tool_calls: [{
                index: tc.toolIndex,
                function: { arguments: cleanArgs },
              }],
            },
          }],
        };
        emitSseLine(JSON.stringify(deltaEvent), controller);
      } catch {
        debugLog(`[OpenAI SSE] Failed to parse arguments for ${tc.name} (${tc.id}), passing through`);
        // Emit original buffered arguments on parse failure
        const deltaEvent = {
          choices: [{
            index: tc.choiceIndex,
            delta: {
              tool_calls: [{
                index: tc.toolIndex,
                function: { arguments: tc.arguments },
              }],
            },
          }],
        };
        emitSseLine(JSON.stringify(deltaEvent), controller);
      }
    }
    trackedCalls.clear();
    bufferingToolCalls = false;
  }

  function processDataLine(dataStr: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    if (dataStr === '[DONE]') {
      flushTrackedCalls(controller);
      emitSseLine(dataStr, controller);
      return;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataStr);
    } catch {
      emitSseLine(dataStr, controller);
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

    if (!choices || choices.length === 0) {
      emitSseLine(dataStr, controller);
      return;
    }

    let handledToolCalls = false;

    // Buffer tool_call argument deltas (across all choices)
    for (const choice of choices) {
      if (!choice?.delta?.tool_calls) continue;
      handledToolCalls = true;

      const choiceIndex = choice.index ?? 0;
      for (const tc of choice.delta.tool_calls) {
        const toolIndex = tc.index ?? 0;
        const key = `${choiceIndex}:${toolIndex}`;

        if (tc.id) {
          // First chunk for a tool call — has id, name, maybe initial args
          trackedCalls.set(key, {
            id: tc.id,
            name: tc.function?.name || 'unknown',
            choiceIndex,
            toolIndex,
            arguments: tc.function?.arguments || '',
          });
          bufferingToolCalls = true;

          // Emit the initial tool_call event WITHOUT arguments (preserves id/name/type)
          const initEvent = {
            ...data,
            choices: [{
              ...choice,
              delta: {
                ...choice.delta,
                tool_calls: [{
                  ...tc,
                  function: {
                    name: tc.function?.name,
                    // Omit arguments from initial event — we'll emit clean args on flush
                    arguments: '',
                  },
                }],
              },
            }],
          };
          emitSseLine(JSON.stringify(initEvent), controller);
        } else {
          // Subsequent argument delta — buffer and suppress
          const existing = trackedCalls.get(key);
          if (existing && tc.function?.arguments) {
            existing.arguments += tc.function.arguments;
          }
        }
      }
    }

    // Suppress original tool_call delta payloads (we re-emit cleaned payloads later)
    if (handledToolCalls) {
      return;
    }

    // On finish, flush buffered tool calls with clean args BEFORE emitting finish event
    const hasFinish = choices.some(choice => choice?.finish_reason === 'tool_calls' || choice?.finish_reason === 'stop');
    if (hasFinish) {
      if (bufferingToolCalls) {
        flushTrackedCalls(controller);
      }
      emitSseLine(dataStr, controller);
      return;
    }

    // Non-tool events pass through
    emitSseLine(dataStr, controller);
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = lineBuffer + decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        if (trimmed.startsWith('data: ')) {
          processDataLine(trimmed.slice(6), controller);
        } else {
          // Pass through non-data SSE lines (comments, event types, etc.)
          controller.enqueue(encoder.encode(trimmed + '\n'));
        }
      }
    },

    flush(controller) {
      if (lineBuffer.trim()) {
        const trimmed = lineBuffer.trim();
        if (trimmed.startsWith('data: ')) {
          processDataLine(trimmed.slice(6), controller);
        }
      }
      // Flush any remaining tracked calls on stream end
      if (trackedCalls.size > 0) {
        flushTrackedCalls(controller);
      }
      lineBuffer = '';
    },
  });
}

const openAiAdapter: ApiAdapter = {
  name: 'openai',

  shouldIntercept(url: string): boolean {
    return url.includes('/chat/completions');
  },

  addMetadataToTools(body: Record<string, unknown>): Record<string, unknown> {
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
      if (tool.type !== 'function' || !tool.function?.parameters) continue;

      // MCP tools always get metadata regardless of the feature flag — they're
      // lower-volume than built-in tools and the metadata drives source-specific
      // UI (tool intents, display names in the sidebar).
      const isMcpTool = tool.function.name?.startsWith('mcp__');
      if (!richDescriptions && !isMcpTool) {
        continue;
      }

      const params = tool.function.parameters;
      const updatedSchema = injectMetadataIntoToolSchema(params);
      params.properties = updatedSchema.properties;
      params.required = updatedSchema.required;
      // External MCP servers may set additionalProperties: false which would
      // cause validation to reject _intent/_displayName in tool inputs.
      if ((params as Record<string, unknown>).additionalProperties === false) {
        delete (params as Record<string, unknown>).additionalProperties;
      }
      modifiedCount++;
    }

    if (modifiedCount > 0) {
      debugLog(`[OpenAI Schema] Added _intent and _displayName to ${modifiedCount} tools`);
    }

    return body;
  },

  injectMetadataIntoHistory(body: Record<string, unknown>): Record<string, unknown> {
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

        const hasIntent = '_intent' in args;
        const hasDisplayName = '_displayName' in args;
        if (hasIntent && hasDisplayName) continue;

        const stored = toolMetadataStore.get(tc.id);
        if (stored) {
          const newArgs: Record<string, unknown> = {};
          if (!hasDisplayName && stored.displayName) newArgs._displayName = stored.displayName;
          if (!hasIntent && stored.intent) newArgs._intent = stored.intent;
          if (Object.keys(newArgs).length > 0) {
            Object.assign(newArgs, args);
            tc.function.arguments = JSON.stringify(newArgs);
            injectedCount++;
          }
        }
      }
    }

    if (injectedCount > 0) {
      debugLog(`[OpenAI History] Re-injected metadata into ${injectedCount} tool_calls`);
    }

    return body;
  },

  createSseProcessor(): TransformStream<Uint8Array, Uint8Array> {
    return createOpenAiSseStrippingStream();
  },

  stripsSseMetadata: true,
};

/**
 * Creates a TransformStream for OpenAI Responses API SSE.
 *
 * We capture metadata and strip it at the stable "done" boundaries where full
 * function-call arguments are available as JSON strings:
 * - response.function_call_arguments.done
 * - response.output_item.done (item.type === 'function_call')
 */
export function createOpenAiResponsesSseStrippingStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let lineBuffer = '';

  function emitSseLine(dataStr: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
  }

  function processDataLine(dataStr: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    if (dataStr === '[DONE]') {
      emitSseLine(dataStr, controller);
      return;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataStr);
    } catch {
      emitSseLine(dataStr, controller);
      return;
    }

    const eventType = data.type;
    if (eventType === 'response.function_call_arguments.done') {
      const callId = typeof data.call_id === 'string' ? data.call_id : undefined;
      const argsStr = typeof data.arguments === 'string' ? data.arguments : undefined;
      if (callId && argsStr) {
        try {
          const parsed = JSON.parse(argsStr) as Record<string, unknown>;
          captureMetadataFromInput(callId, 'response:function_call', parsed);
          delete parsed._intent;
          delete parsed._displayName;
          data.arguments = JSON.stringify(parsed);
        } catch {
          // pass through unchanged
        }
      }
      emitSseLine(JSON.stringify(data), controller);
      return;
    }

    if (eventType === 'response.output_item.done') {
      const item = data.item as {
        type?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
      } | undefined;

      if (item?.type === 'function_call' && typeof item.arguments === 'string') {
        const toolId = typeof item.call_id === 'string' ? item.call_id : undefined;
        const toolName = typeof item.name === 'string' ? item.name : 'response:function_call';
        if (toolId) {
          try {
            const parsed = JSON.parse(item.arguments) as Record<string, unknown>;
            captureMetadataFromInput(toolId, toolName, parsed);
            delete parsed._intent;
            delete parsed._displayName;
            item.arguments = JSON.stringify(parsed);
          } catch {
            // pass through unchanged
          }
        }
      }

      emitSseLine(JSON.stringify(data), controller);
      return;
    }

    emitSseLine(dataStr, controller);
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = lineBuffer + decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        if (trimmed.startsWith('data: ')) {
          processDataLine(trimmed.slice(6), controller);
        } else {
          controller.enqueue(encoder.encode(trimmed + '\n'));
        }
      }
    },

    flush(controller) {
      if (lineBuffer.trim()) {
        const trimmed = lineBuffer.trim();
        if (trimmed.startsWith('data: ')) {
          processDataLine(trimmed.slice(6), controller);
        }
      }
      lineBuffer = '';
    },
  });
}

const openAiResponsesAdapter: ApiAdapter = {
  name: 'openai-responses',

  shouldIntercept(url: string): boolean {
    return url.includes('/responses');
  },

  addMetadataToTools(body: Record<string, unknown>): Record<string, unknown> {
    const tools = body.tools as Array<{
      type?: string;
      name?: string;
      parameters?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
    }> | undefined;

    if (!tools || !Array.isArray(tools)) return body;

    const richDescriptions = isRichToolDescriptionsEnabled();
    let modifiedCount = 0;

    for (const tool of tools) {
      if (tool.type !== 'function' || !tool.parameters) continue;

      const isMcpTool = tool.name?.startsWith('mcp__');
      if (!richDescriptions && !isMcpTool) continue;

      const params = tool.parameters;
      const updatedSchema = injectMetadataIntoToolSchema(params);
      params.properties = updatedSchema.properties;
      params.required = updatedSchema.required;
      if ((params as Record<string, unknown>).additionalProperties === false) {
        delete (params as Record<string, unknown>).additionalProperties;
      }
      modifiedCount++;
    }

    if (modifiedCount > 0) {
      debugLog(`[OpenAI Responses Schema] Added _intent and _displayName to ${modifiedCount} tools`);
    }

    return body;
  },

  injectMetadataIntoHistory(body: Record<string, unknown>): Record<string, unknown> {
    const input = body.input as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(input)) return body;

    let injectedCount = 0;

    for (const entry of input) {
      if (entry.type !== 'function_call' || typeof entry.call_id !== 'string' || typeof entry.arguments !== 'string') continue;

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(entry.arguments) as Record<string, unknown>;
      } catch {
        continue;
      }

      const hasIntent = '_intent' in args;
      const hasDisplayName = '_displayName' in args;
      if (hasIntent && hasDisplayName) continue;

      const stored = toolMetadataStore.get(entry.call_id);
      if (!stored) continue;

      const newArgs: Record<string, unknown> = {};
      if (!hasDisplayName && stored.displayName) newArgs._displayName = stored.displayName;
      if (!hasIntent && stored.intent) newArgs._intent = stored.intent;
      if (Object.keys(newArgs).length > 0) {
        Object.assign(newArgs, args);
        entry.arguments = JSON.stringify(newArgs);
        injectedCount++;
      }
    }

    if (injectedCount > 0) {
      debugLog(`[OpenAI Responses History] Re-injected metadata into ${injectedCount} function_call items`);
    }

    return body;
  },

  createSseProcessor(): TransformStream<Uint8Array, Uint8Array> {
    return createOpenAiResponsesSseStrippingStream();
  },

  stripsSseMetadata: true,
};

// ============================================================================
// ADAPTER REGISTRY
// ============================================================================

const adapters: ApiAdapter[] = [anthropicAdapter, openAiResponsesAdapter, openAiAdapter];

/**
 * Resolve Pi model API hint (if provided by pi-agent-server).
 * Example values: anthropic-messages, openai-completions, openai-responses.
 */
function getPiApiHint(): string | undefined {
  const hint = process.env.CRAFT_PI_MODEL_API?.trim();
  return hint || undefined;
}

/**
 * Map Pi API hint to adapter name.
 * Exported for focused unit testing.
 */
export function resolveAdapterNameFromPiApiHint(piApiHint?: string): 'anthropic' | 'openai' | 'openai-responses' | undefined {
  if (!piApiHint) return undefined;
  if (piApiHint === 'anthropic-messages') return 'anthropic';
  if (piApiHint === 'openai-completions') return 'openai';
  if (piApiHint === 'openai-responses' || piApiHint === 'azure-openai-responses' || piApiHint === 'openai-codex-responses') {
    return 'openai-responses';
  }
  return undefined;
}

/**
 * Find the matching adapter for a request.
 * Priority:
 * 1) Pi API hint (robust, provider-native)
 * 2) URL pattern fallback (legacy/non-Pi requests)
 */
function findAdapter(url: string): ApiAdapter | undefined {
  const piApiHint = getPiApiHint();
  const hintedAdapter = resolveAdapterNameFromPiApiHint(piApiHint);
  if (hintedAdapter === 'anthropic') return anthropicAdapter;
  if (hintedAdapter === 'openai') return openAiAdapter;
  if (hintedAdapter === 'openai-responses') return openAiResponsesAdapter;

  return adapters.find(a => a.shouldIntercept(url));
}

// ============================================================================
// ERROR CAPTURE (shared across all adapters)
// ============================================================================

/**
 * Capture API errors from responses for the error handler.
 */
async function captureApiError(response: Response, url: string): Promise<void> {
  if (response.status < 400) return;

  debugLog(`[Attempting to capture error for ${response.status} response]`);
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
    debugLog(`[Captured API error: ${response.status} ${errorMessage}]`);
  } catch (e) {
    setStoredError({
      status: response.status,
      statusText: response.statusText,
      message: response.statusText,
      timestamp: Date.now(),
    });
    debugLog(`[Error reading body, capturing basic info: ${e}]`);
  }
}

// ============================================================================
// DEBUG LOGGING (shared)
// ============================================================================

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
    const escapedBody = init.body.replace(/'/g, "'\\''");
    curl += ` \\\n  -d '${escapedBody}'`;
  }
  curl += ` \\\n  '${url}'`;

  return curl;
}

/**
 * Log response and capture API errors.
 */
async function logResponse(response: Response, url: string, startTime: number, adapter?: ApiAdapter): Promise<Response> {
  const duration = Date.now() - startTime;

  // Capture API errors (runs regardless of DEBUG mode)
  if (adapter) {
    await captureApiError(response, url);
  }

  if (!DEBUG) return response;

  debugLog(`\n\u2190 RESPONSE ${response.status} ${response.statusText} (${duration}ms)`);
  debugLog(`  URL: ${url}`);

  const respHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    respHeaders[key] = value;
  });
  debugLog('  Headers:', respHeaders);

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    debugLog('  Body: [SSE stream - not logged]');
    return response;
  }

  const clone = response.clone();
  try {
    const text = await clone.text();
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

// ============================================================================
// INTERCEPTED FETCH
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

  const startTime = Date.now();

  if (DEBUG) {
    debugLog('\n' + '='.repeat(80));
    debugLog('\u2192 REQUEST');
    debugLog(toCurl(url, init));
  }

  // Find matching adapter for this URL
  const adapter = findAdapter(url);

  if (
    adapter &&
    ((init?.method ?? (input instanceof Request ? input.method : undefined))?.toUpperCase() === 'POST')
  ) {
    try {
      const { bodyStr, normalizedInit } = await resolveRequestContext(input, init);
      if (bodyStr) {
        let parsed = JSON.parse(bodyStr);

        // Add _intent and _displayName to all tool schemas
        parsed = adapter.addMetadataToTools(parsed);
        // Re-inject stored metadata into conversation history
        parsed = adapter.injectMetadataIntoHistory(parsed);

        // Adapter-specific request modifications (e.g., fast mode)
        let modifiedInit = normalizedInit;
        if (adapter.modifyRequest) {
          const result = adapter.modifyRequest(url, normalizedInit, parsed);
          modifiedInit = result.init;
          parsed = result.body;
        }

        const finalInit = {
          ...modifiedInit,
          body: JSON.stringify(parsed),
        };

        debugLog(`[${adapter.name}] Intercepted request to ${url}`);
        const response = await originalFetch(url, finalInit);

        // Process SSE response through adapter's stream processor
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('text/event-stream') && response.body) {
          debugLog(`[${adapter.name}] Creating SSE processor (${adapter.stripsSseMetadata ? 'strip' : 'capture'})`);
          const processor = adapter.createSseProcessor();
          const processedBody = response.body.pipeThrough(processor);
          const processedResponse = new Response(processedBody, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
          return logResponse(processedResponse, url, startTime, adapter);
        }

        return logResponse(response, url, startTime, adapter);
      }
    } catch (e) {
      debugLog(`[${adapter?.name}] FETCH modification failed:`, e);
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

// Auto-install in runtime subprocesses. Tests can disable this side effect.
if (process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL !== '1') {
  (globalThis as unknown as { fetch: unknown }).fetch = fetchProxy;
  debugLog('Unified fetch interceptor installed');
}
