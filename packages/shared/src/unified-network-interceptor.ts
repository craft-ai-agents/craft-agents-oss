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
 * - Fast mode support for Anthropic (Opus 4.7)
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
  isExtendedPromptCacheEnabled,
  is1MContextEnabled,
  setStoredError,
  toolMetadataStore,
  displayNameSchema,
  intentSchema,
} from './interceptor-common.ts';
import { FEATURE_FLAGS } from './feature-flags.ts';
import { resolveRequestContext } from './interceptor-request-utils.ts';

// Type alias for fetch's HeadersInit
type HeadersInitType = Headers | Record<string, string> | string[][];

/**
 * When `CRAFT_DEBUG_SSE_RAW=1`, the OpenAI strip streams dump every raw SSE
 * line they see (in) and emit (out) to interceptor.log. Used to diagnose
 * upstream SSE shape issues (e.g. DeepSeek's two-phase tool_call emission).
 * Independent of the broader DEBUG flag — opt-in only because raw chunks are
 * verbose and may contain user prompts/tool args.
 */
const DEBUG_SSE_RAW = process.env.CRAFT_DEBUG_SSE_RAW === '1';

// ============================================================================
// PROXY CONFIGURATION (from env vars injected by parent process)
// ============================================================================

const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy || '';
const NO_PROXY = process.env.NO_PROXY || process.env.no_proxy || '';

/** Strip credentials from a proxy URL, returning only scheme://host:port */
function redactProxyUrl(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '(invalid proxy URL)';
  }
}

/** Parse NO_PROXY into hostname patterns for bypass matching. */
const noProxyPatterns: string[] = NO_PROXY
  ? NO_PROXY.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  : [];

/** Check if a URL should bypass the proxy based on NO_PROXY rules. */
function shouldBypassProxy(url: string): boolean {
  if (noProxyPatterns.length === 0) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return noProxyPatterns.some(pattern => {
      if (pattern === '*') return true;
      // .example.com matches any subdomain of example.com
      if (pattern.startsWith('.')) return hostname.endsWith(pattern);
      // exact match or subdomain match
      return hostname === pattern || hostname.endsWith('.' + pattern);
    });
  } catch {
    return false;
  }
}

/** Get the proxy URL for a given request URL, or undefined to go direct. */
function getProxyForUrl(url: string): string | undefined {
  if (!PROXY_URL || shouldBypassProxy(url)) return undefined;
  return PROXY_URL;
}

if (PROXY_URL) {
  debugLog(`[proxy] Configured: ${redactProxyUrl(PROXY_URL)}${NO_PROXY ? `, NO_PROXY: ${NO_PROXY}` : ''}`);
}

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
  /**
   * Optional pre-flight validation of the outgoing body. Adapters that opt in
   * throw {@link MalformedBodyError} when the body would cause a deterministic
   * upstream 400 (duplicate tool_call_id, missing call_id, etc.). The
   * interceptor turns the throw into a synthetic 400 response so the SDK
   * surfaces a clear error instead of dying on an opaque upstream failure.
   */
  validateOutgoingBody?(body: Record<string, unknown>): void;
}

// ============================================================================
// MALFORMED BODY ERROR
// ============================================================================

/**
 * Thrown by {@link ApiAdapter.validateOutgoingBody} when the request body would
 * be rejected by the upstream API for a structural reason we can detect locally
 * (duplicate `tool_call_id`, missing `call_id`, orphaned tool result, etc.).
 *
 * The interceptor catches this and turns it into a synthetic 400 response with
 * a structured error body that the SDK treats as a normal API error — far more
 * useful than the opaque `400 status code (no body)` users see today.
 */
export class MalformedBodyError extends Error {
  /** Stable error code for telemetry/UX */
  readonly code: 'duplicate_tool_call_id' | 'missing_tool_call_id' | 'missing_call_id' | 'orphaned_function_call_output' | 'empty_tool_name';
  /** Human-readable detail to show in logs and surface to the user */
  readonly detail: string;
  /** Adapter name (for diagnostics) */
  readonly adapter: string;

  constructor(args: {
    code: MalformedBodyError['code'];
    detail: string;
    adapter: string;
  }) {
    super(`[${args.adapter}] Outgoing body rejected: ${args.code} — ${args.detail}`);
    this.name = 'MalformedBodyError';
    this.code = args.code;
    this.detail = args.detail;
    this.adapter = args.adapter;
  }
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

/**
 * Best-effort regex removal of metadata fields from raw JSON string.
 * Used as fallback when JSON.parse fails — ensures _intent/_displayName
 * never leak to the SDK even with malformed JSON.
 *
 * Exported for focused unit tests.
 */
export function stripMetadataFieldsFromRawJson(json: string): string {
  return json
    .replace(/"_intent"\s*:\s*"(?:[^"\\]|\\.)*"\s*,?\s*/g, '')
    .replace(/"_displayName"\s*:\s*"(?:[^"\\]|\\.)*"\s*,?\s*/g, '')
    .replace(/,\s*}/g, '}');
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
 * Strip explicit TTL from all ephemeral cache_control blocks.
 *
 * When extendedPromptCache is disabled, the SDK may still send ttl: "1h"
 * natively (via prompt-caching-scope beta). This function removes the ttl
 * field so blocks fall back to the API default (5 min).
 */
function stripPromptCacheTtl(body: Record<string, unknown>): number {
  let stripped = 0;

  const system = body.system as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(system)) {
    for (const block of system) {
      const cc = block.cache_control as Record<string, unknown> | undefined;
      if (cc?.type === 'ephemeral' && 'ttl' in cc) {
        delete cc.ttl;
        stripped++;
      }
    }
  }

  const messages = body.messages as Array<{ content?: unknown }> | undefined;
  if (messages) {
    for (const message of messages) {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content as Array<Record<string, unknown>>) {
        const cc = block.cache_control as Record<string, unknown> | undefined;
        if (cc?.type === 'ephemeral' && 'ttl' in cc) {
          delete cc.ttl;
          stripped++;
        }
      }
    }
  }

  const topLevel = body.cache_control as Record<string, unknown> | undefined;
  if (topLevel?.type === 'ephemeral' && 'ttl' in topLevel) {
    delete topLevel.ttl;
    stripped++;
  }

  if (stripped > 0) {
    debugLog(`[Anthropic] Stripped TTL from ${stripped} cache_control block(s) (extendedPromptCache=false)`);
  }
  return stripped;
}

/**
 * Upgrade all cache_control blocks from 5m (default) to 1h TTL.
 * Only active when extendedPromptCache is enabled in config.
 * When disabled, actively strips any SDK-injected TTL so blocks
 * fall back to the API default (5 min).
 *
 * Walks system prompt blocks, message content blocks, and the top-level
 * cache_control field (auto-caching mode). Only upgrades blocks with
 * type: "ephemeral" — leaves other types untouched.
 *
 * Exported for focused unit tests.
 */
export function upgradePromptCacheTtl(body: Record<string, unknown>): number {
  if (!isExtendedPromptCacheEnabled()) return stripPromptCacheTtl(body);

  let upgraded = 0;

  // Upgrade system prompt cache_control
  const system = body.system as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(system)) {
    for (const block of system) {
      if (block.cache_control && (block.cache_control as Record<string, unknown>).type === 'ephemeral') {
        (block.cache_control as Record<string, unknown>).ttl = '1h';
        upgraded++;
      }
    }
  }

  // Upgrade message content cache_control
  const messages = body.messages as Array<{ content?: unknown }> | undefined;
  if (messages) {
    for (const message of messages) {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content as Array<Record<string, unknown>>) {
        if (block.cache_control && (block.cache_control as Record<string, unknown>).type === 'ephemeral') {
          (block.cache_control as Record<string, unknown>).ttl = '1h';
          upgraded++;
        }
      }
    }
  }

  // Upgrade top-level cache_control (auto-caching mode)
  const topLevel = body.cache_control as Record<string, unknown> | undefined;
  if (topLevel?.type === 'ephemeral') {
    topLevel.ttl = '1h';
    upgraded++;
  }

  if (upgraded > 0) {
    debugLog(`[Anthropic] Upgraded ${upgraded} cache_control block(s) to 1h TTL`);
  }
  return upgraded;
}

/**
 * Check if fast mode should be enabled for this request.
 * Only activates for Opus 4.7 on Anthropic's API when the feature flag is on.
 */
function shouldEnableFastMode(model: unknown): boolean {
  if (!FEATURE_FLAGS.fastMode) return false;
  return typeof model === 'string' && model === 'claude-opus-4-7';
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

/**
 * Remove a beta value from the anthropic-beta header, preserving other values.
 */
function stripBetaHeader(headers: HeadersInitType | undefined, beta: string): Record<string, string> {
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
  if (existing) {
    headerObj['anthropic-beta'] = existing.split(',').filter(b => b.trim() !== beta).join(',');
  }

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
      debugLog(`[SSE Strip] Failed to parse buffered JSON for ${block.name} (${block.id}), stripping via regex`);
      const stripped = stripMetadataFieldsFromRawJson(block.bufferedJson);
      const deltaEvent = {
        type: 'content_block_delta',
        index,
        delta: {
          type: 'input_json_delta',
          partial_json: stripped,
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
    upgradePromptCacheTtl(body);

    // Strip SDK-injected 1M context beta when setting disables it.
    // The SDK adds this header automatically for Opus/Sonnet 4.6 models,
    // but the user may want 200K context to conserve usage limits.
    if (!is1MContextEnabled()) {
      debugLog('[Anthropic] Stripping context-1m beta header (enable1MContext=false)');
      init = {
        ...init,
        headers: stripBetaHeader(init?.headers as HeadersInitType | undefined, 'context-1m-2025-08-07'),
      };
    }

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
  type: string;
  choiceIndex: number;
  toolIndex: number;
  /** Args accumulated from same-index deltas (partial JSON pieces). */
  arguments: string;
  /** Phase-2 args (DeepSeek-style "shifted index" chunks). Each element is
   * a complete JSON string that should be merged at the OBJECT level into
   * the final args, not concatenated as a string. */
  shiftedArgs: string[];
}

/**
 * Creates a TransformStream that intercepts OpenAI SSE events,
 * buffers tool_call argument deltas across all upstream chunks, extracts
 * `_intent` / `_displayName` into the metadata store, and emits one
 * consolidated SSE event per logical tool call with `id + name + cleanArgs`
 * together.
 *
 * Output contract — important:
 * - Each logical tool call produces EXACTLY ONE outbound SSE event with
 *   `delta.tool_calls: [{index, id, type, function: {name, arguments}}]`.
 * - We never emit args-only deltas (no id, no name). Some downstream SDKs
 *   (notably Pi SDK) treat such deltas as new tool_calls instead of merging
 *   by index, which produced duplicate empty-id entries on parallel-tool
 *   turns from DeepSeek and other relays.
 * - Non-tool events pass through immediately.
 * - All upstream tool_call chunks are suppressed; the consolidated events
 *   are emitted just before the original `[DONE]` / `finish_reason` event.
 */
export function createOpenAiSseStrippingStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const trackedCalls = new Map<string, TrackedToolCall>();
  /**
   * Per-choice fallback for relays that drop `tc.index` on argument-delta
   * chunks. We pin argument deltas to the most recently opened tool call in
   * the same choice instead of letting them collide on key 0.
   */
  const lastOpenedToolIndexByChoice = new Map<number, number>();
  let lineBuffer = '';
  /** Track whether we're currently buffering tool_call argument deltas */
  let bufferingToolCalls = false;

  function emitSseLine(dataStr: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    if (DEBUG_SSE_RAW) debugLog(`[SSE RAW OUT openai] ${dataStr.slice(0, 4000)}`);
    controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
  }

  function flushTrackedCalls(controller: TransformStreamDefaultController<Uint8Array>): void {
    // Iterate in toolIndex order so downstream sees a stable sequence.
    const sorted = Array.from(trackedCalls.values()).sort((a, b) => {
      if (a.choiceIndex !== b.choiceIndex) return a.choiceIndex - b.choiceIndex;
      return a.toolIndex - b.toolIndex;
    });

    for (const tc of sorted) {
      // Merge in this priority: phase-1 args (partial-JSON concatenation)
      // first, then any phase-2 "shifted index" args (each a complete JSON
      // object) via object spread. Phase-2 wins on key conflicts since it
      // carries the model's actual content (DeepSeek emits real args there;
      // phase-1 carries only `_intent` / `_displayName` for those calls).
      let merged: Record<string, unknown> = {};
      let parseFailed = false;

      if (tc.arguments) {
        try {
          const parsed = JSON.parse(tc.arguments);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            merged = { ...merged, ...(parsed as Record<string, unknown>) };
          }
        } catch {
          parseFailed = true;
          debugLog(`[OpenAI SSE] Failed to parse phase-1 arguments for ${tc.name} (${tc.id}), passing through raw`);
        }
      }

      for (const piece of tc.shiftedArgs) {
        try {
          const parsed = JSON.parse(piece);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            merged = { ...merged, ...(parsed as Record<string, unknown>) };
          }
        } catch {
          parseFailed = true;
          debugLog(`[OpenAI SSE] Failed to parse phase-2 arguments for ${tc.name} (${tc.id}), passing through raw`);
        }
      }

      let outArgs: string;
      if (parseFailed && !tc.shiftedArgs.length) {
        // Pure phase-1 parse failure with no phase-2 to recover from —
        // pass through the raw concatenation so downstream sees something.
        outArgs = tc.arguments;
      } else {
        captureMetadataFromInput(tc.id, tc.name, merged);
        delete merged._intent;
        delete merged._displayName;
        outArgs = JSON.stringify(merged);
      }

      // Consolidated tool_call event: id + type + name + cleanArgs together.
      // Downstream SDKs see one event per logical tool call — no merging
      // by index, no orphan args-only deltas.
      const consolidatedEvent = {
        choices: [{
          index: tc.choiceIndex,
          delta: {
            tool_calls: [{
              index: tc.toolIndex,
              id: tc.id,
              type: tc.type,
              function: { name: tc.name, arguments: outArgs },
            }],
          },
        }],
      };
      emitSseLine(JSON.stringify(consolidatedEvent), controller);
    }
    trackedCalls.clear();
    bufferingToolCalls = false;
  }

  function processDataLine(dataStr: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    if (DEBUG_SSE_RAW) debugLog(`[SSE RAW IN  openai] ${dataStr.slice(0, 4000)}`);
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

    // Buffer tool_call argument deltas (across all choices). All upstream
    // tool_call chunks are suppressed; we emit one consolidated event per
    // logical tool call at flush time — see flushTrackedCalls.
    //
    // Relay quirks handled here:
    //   - id-repeat relays (DeepSeek, some Chinese OpenAI-compat hosts) send
    //     `tc.id` on every chunk instead of only the first. We treat the
    //     second-and-later occurrences with a matching id as argument-only
    //     deltas (no new tracked entry).
    //   - index-dropping relays send argument-delta chunks without `tc.index`.
    //     We fall back to "the most recently opened tracked call for this
    //     choice" so parallel tool calls don't collide on key 0.
    //   - index-shifting relays (DeepSeek extended-thinking) emit the
    //     argument payload at a NEW `tc.index` with empty id/name. We attach
    //     those args to the matching phase-1 entry by walking the open calls
    //     in order rather than allocating a new bucket for them.
    for (const choice of choices) {
      if (!choice?.delta?.tool_calls) continue;
      handledToolCalls = true;

      const choiceIndex = choice.index ?? 0;
      for (const tc of choice.delta.tool_calls) {
        // Resolve the bucket key. If `tc.index` is missing, prefer the most
        // recently opened call in this choice so we don't collide on key 0.
        const fallbackIndex = lastOpenedToolIndexByChoice.get(choiceIndex);
        const toolIndex = tc.index ?? fallbackIndex ?? 0;
        const key = `${choiceIndex}:${toolIndex}`;

        if (tc.id) {
          const existing = trackedCalls.get(key);
          if (existing && existing.id === tc.id) {
            // Relay repeated the id on a subsequent chunk. Treat this as an
            // argument-delta only.
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
            }
            // If a later chunk carries the function name we hadn't seen yet,
            // upgrade the tracked entry rather than letting it stay 'unknown'.
            if (tc.function?.name && existing.name === 'unknown') {
              existing.name = tc.function.name;
            }
            continue;
          }

          // First chunk for a logical tool call — record id/name/type and
          // any initial args. We do NOT emit an init event; the consolidated
          // event is emitted on flush.
          trackedCalls.set(key, {
            id: tc.id,
            name: tc.function?.name || 'unknown',
            type: tc.type || 'function',
            choiceIndex,
            toolIndex,
            arguments: tc.function?.arguments || '',
            shiftedArgs: [],
          });
          lastOpenedToolIndexByChoice.set(choiceIndex, toolIndex);
          bufferingToolCalls = true;
        } else {
          // Subsequent argument delta with no id. Three patterns to handle:
          //  (a) Same `tc.index` as a phase-1 entry → append (partial JSON).
          //  (b) Missing `tc.index` → fall back to last-opened, append.
          //  (c) NEW `tc.index` past the last-opened (DeepSeek's
          //      "phase-2 args at shifted index" shape). Attach to the
          //      matching phase-1 entry by ordinal position. These chunks
          //      carry a COMPLETE JSON object, not a partial string — store
          //      them separately and merge at the object level on flush.
          const existingByKey = trackedCalls.get(key);
          if (existingByKey) {
            // (a) or (b) — partial JSON delta, append.
            if (tc.function?.arguments) {
              existingByKey.arguments += tc.function.arguments;
            }
          } else {
            // (c) — find the phase-1 entry in this choice by position.
            const phase1 = Array.from(trackedCalls.values())
              .filter(t => t.choiceIndex === choiceIndex)
              .sort((a, b) => a.toolIndex - b.toolIndex);
            const lastOpened = lastOpenedToolIndexByChoice.get(choiceIndex);
            if (
              typeof lastOpened === 'number' &&
              tc.index !== undefined &&
              tc.index > lastOpened &&
              phase1.length > 0 &&
              tc.function?.arguments
            ) {
              const ord = tc.index - (lastOpened + 1);
              if (ord >= 0 && ord < phase1.length) {
                phase1[ord]!.shiftedArgs.push(tc.function.arguments);
              }
            }
          }
        }
      }
    }

    // Suppress all upstream tool_call delta payloads. Consolidated events
    // are emitted on flush.
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
    sanitizeOpenAiHistoryInPlace(body);

    const messages = body.messages as Array<{
      role?: string;
      tool_call_id?: string;
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

  validateOutgoingBody(body: Record<string, unknown>): void {
    validateOpenAiChatBody(body);
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
    if (DEBUG_SSE_RAW) debugLog(`[SSE RAW OUT openai-responses] ${dataStr.slice(0, 4000)}`);
    controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
  }

  function processDataLine(dataStr: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    if (DEBUG_SSE_RAW) debugLog(`[SSE RAW IN  openai-responses] ${dataStr.slice(0, 4000)}`);
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

    // Pass 1: repair structurally-broken history before metadata injection.
    // Real-world cause: some Pi SDK code paths (notably DeepSeek + custom
    // OpenAI-compatible endpoints) occasionally drop `call_id` on replayed
    // function_call entries, or emit a function_call_output that doesn't
    // reference any earlier function_call. The upstream replies with an
    // opaque 400 (#613). We synthesize a deterministic id and drop true
    // orphans so the request reaches the API in a usable shape.
    repairResponsesHistoryInPlace(input);

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

  validateOutgoingBody(body: Record<string, unknown>): void {
    validateOpenAiResponsesBody(body);
  },

  createSseProcessor(): TransformStream<Uint8Array, Uint8Array> {
    return createOpenAiResponsesSseStrippingStream();
  },

  stripsSseMetadata: true,
};

/**
 * Validate an outgoing OpenAI Chat Completions body before it hits the wire.
 * Throws {@link MalformedBodyError} on the structural problems that produce
 * `400 Duplicate value for 'tool_call_id'` and similar opaque upstream
 * failures (#613). Exported for focused unit tests.
 */
/**
 * Strip `tool_calls` entries with an empty/missing `id` from assistant
 * messages, and drop orphan `role: "tool"` results that reference them.
 *
 * Recovers sessions whose history was persisted by the pre-fix strip stream
 * — that version emitted args-only SSE deltas (no id, no name) which Pi SDK
 * recorded as separate empty-id tool_calls. Without this sanitizer, every
 * replay of such history hits `validateOpenAiChatBody` with
 * `missing_tool_call_id` and the session is bricked.
 *
 * Mutates `body.messages` in place. Logs structured info if anything was
 * dropped. Exported for focused unit tests.
 */
export function sanitizeOpenAiHistoryInPlace(body: Record<string, unknown>): {
  droppedToolCalls: number;
  droppedToolResults: number;
} {
  const messages = body.messages as Array<{
    role?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  }> | undefined;
  if (!Array.isArray(messages)) {
    return { droppedToolCalls: 0, droppedToolResults: 0 };
  }

  let droppedToolCalls = 0;
  const knownIds = new Set<string>();

  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      const cleaned = message.tool_calls.filter(tc => {
        if (typeof tc.id !== 'string' || tc.id === '') {
          droppedToolCalls++;
          return false;
        }
        knownIds.add(tc.id);
        return true;
      });
      if (cleaned.length !== message.tool_calls.length) {
        if (cleaned.length === 0) {
          delete message.tool_calls;
        } else {
          message.tool_calls = cleaned;
        }
      }
    }
  }

  let droppedToolResults = 0;
  if (droppedToolCalls > 0) {
    const filtered = messages.filter(message => {
      if (message.role !== 'tool') return true;
      const tcid = typeof message.tool_call_id === 'string' ? message.tool_call_id : '';
      if (!tcid || !knownIds.has(tcid)) {
        droppedToolResults++;
        return false;
      }
      return true;
    });
    if (filtered.length !== messages.length) {
      body.messages = filtered;
    }
    debugLog(`[OpenAI History] Sanitized poisoned history: dropped ${droppedToolCalls} empty-id tool_call(s) and ${droppedToolResults} orphan tool result(s)`);
  }

  return { droppedToolCalls, droppedToolResults };
}

export function validateOpenAiChatBody(body: Record<string, unknown>): void {
  const messages = body.messages as Array<{
    role?: string;
    tool_call_id?: unknown;
    tool_calls?: Array<{
      id?: unknown;
      type?: string;
      function?: { name?: unknown };
    }>;
  }> | undefined;
  if (!Array.isArray(messages)) return;

  // Track every tool_call id we've seen on assistant messages. Duplicates
  // across messages are also illegal — OpenAI requires globally unique ids
  // within a single request.
  const seenIds = new Set<string>();
  const knownIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const id = typeof tc.id === 'string' ? tc.id : '';
        if (!id) {
          throw new MalformedBodyError({
            code: 'missing_tool_call_id',
            detail: `messages[${i}].tool_calls[*] missing id`,
            adapter: 'openai',
          });
        }
        if (seenIds.has(id)) {
          throw new MalformedBodyError({
            code: 'duplicate_tool_call_id',
            detail: `messages[${i}].tool_calls[*] reuses id "${id}" already seen earlier`,
            adapter: 'openai',
          });
        }
        seenIds.add(id);
        knownIds.add(id);

        const fnName = typeof tc.function?.name === 'string' ? tc.function.name.trim() : '';
        if (!fnName) {
          throw new MalformedBodyError({
            code: 'empty_tool_name',
            detail: `messages[${i}].tool_calls[*] (id="${id}") has empty function.name`,
            adapter: 'openai',
          });
        }
      }
    }

    if (msg.role === 'tool') {
      const tcid = typeof msg.tool_call_id === 'string' ? msg.tool_call_id : '';
      if (!tcid) {
        throw new MalformedBodyError({
          code: 'missing_tool_call_id',
          detail: `messages[${i}] (role=tool) missing tool_call_id`,
          adapter: 'openai',
        });
      }
      if (!knownIds.has(tcid)) {
        // Tool result references an id that no preceding assistant message
        // emitted — usually the symptom of a failed reassembly.
        throw new MalformedBodyError({
          code: 'orphaned_function_call_output',
          detail: `messages[${i}] (role=tool) references unknown tool_call_id "${tcid}"`,
          adapter: 'openai',
        });
      }
    }
  }
}

/**
 * Validate an outgoing OpenAI Responses-API body before it hits the wire.
 * Throws {@link MalformedBodyError} on the structural problems that produce
 * `400 Missing required parameter: input[N].call_id` (#613). Run after
 * {@link repairResponsesHistoryInPlace}, which fixes the recoverable cases.
 * Exported for focused unit tests.
 */
export function validateOpenAiResponsesBody(body: Record<string, unknown>): void {
  const input = body.input as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(input)) return;

  const seenCallIds = new Set<string>();
  const knownCallIds = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const entry = input[i];
    if (!entry) continue;
    if (entry.type === 'function_call') {
      const callId = typeof entry.call_id === 'string' ? entry.call_id : '';
      if (!callId) {
        throw new MalformedBodyError({
          code: 'missing_call_id',
          detail: `input[${i}] (type=function_call) missing call_id`,
          adapter: 'openai-responses',
        });
      }
      if (seenCallIds.has(callId)) {
        throw new MalformedBodyError({
          code: 'duplicate_tool_call_id',
          detail: `input[${i}] (type=function_call) reuses call_id "${callId}"`,
          adapter: 'openai-responses',
        });
      }
      seenCallIds.add(callId);
      knownCallIds.add(callId);

      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name) {
        throw new MalformedBodyError({
          code: 'empty_tool_name',
          detail: `input[${i}] (type=function_call, call_id="${callId}") has empty name`,
          adapter: 'openai-responses',
        });
      }
    } else if (entry.type === 'function_call_output') {
      const callId = typeof entry.call_id === 'string' ? entry.call_id : '';
      if (!callId) {
        throw new MalformedBodyError({
          code: 'missing_call_id',
          detail: `input[${i}] (type=function_call_output) missing call_id`,
          adapter: 'openai-responses',
        });
      }
      if (!knownCallIds.has(callId)) {
        throw new MalformedBodyError({
          code: 'orphaned_function_call_output',
          detail: `input[${i}] (type=function_call_output) references unknown call_id "${callId}"`,
          adapter: 'openai-responses',
        });
      }
    }
  }
}

/**
 * In-place repair of Responses-API `input[]` arrays that arrive with structural
 * defects we can recover from. Mutates `input` and returns the number of repairs.
 *
 * - `function_call` entries missing `call_id` get a deterministic synthesized id.
 * - `function_call_output` entries referencing an unknown `call_id` are dropped
 *   (the upstream would 400 anyway; better to lose one tool result than the turn).
 *
 * Exported for focused unit tests.
 */
export function repairResponsesHistoryInPlace(input: Array<Record<string, unknown>>): {
  synthesizedCallIds: number;
  droppedOrphans: number;
} {
  let synthesizedCallIds = 0;
  let droppedOrphans = 0;
  const knownCallIds = new Set<string>();

  // First pass: synthesize missing call_ids on function_call entries so later
  // entries can reference them.
  for (let i = 0; i < input.length; i++) {
    const entry = input[i];
    if (!entry) continue;
    if (entry.type !== 'function_call') continue;
    if (typeof entry.call_id === 'string' && entry.call_id.length > 0) {
      knownCallIds.add(entry.call_id);
      continue;
    }
    const name = typeof entry.name === 'string' ? entry.name : 'unknown';
    const argsHash = typeof entry.arguments === 'string'
      ? hashShortString(entry.arguments)
      : '0';
    const synthetic = `repaired_${i}_${name}_${argsHash}`;
    entry.call_id = synthetic;
    knownCallIds.add(synthetic);
    synthesizedCallIds++;
    debugLog(`[OpenAI Responses Repair] Synthesized call_id "${synthetic}" for input[${i}] (name=${name})`);
  }

  if (synthesizedCallIds === 0 && input.every(e => e.type !== 'function_call_output')) {
    return { synthesizedCallIds, droppedOrphans };
  }

  // Second pass: drop orphan function_call_output entries.
  for (let i = input.length - 1; i >= 0; i--) {
    const entry = input[i];
    if (!entry) continue;
    if (entry.type !== 'function_call_output') continue;
    const callId = typeof entry.call_id === 'string' ? entry.call_id : '';
    if (!callId || !knownCallIds.has(callId)) {
      input.splice(i, 1);
      droppedOrphans++;
      debugLog(`[OpenAI Responses Repair] Dropped orphan function_call_output at input[${i}] (call_id="${callId}")`);
    }
  }

  return { synthesizedCallIds, droppedOrphans };
}

/** Tiny stable hash for synthesizing deterministic call_ids. Not a security primitive. */
function hashShortString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

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
    let isHtmlResponse = false;

    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
      } else if (errorJson.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      if (errorText) {
        isHtmlResponse = errorText.trimStart().startsWith('<');
        errorMessage = errorText;
      }
    }

    // An HTML response to a JSON API call means something intercepted the request —
    // a proxy, CDN, captive portal, or firewall. Never show raw HTML to the user.
    if (isHtmlResponse) {
      if (PROXY_URL) {
        errorMessage = `Received an unexpected HTML error page (HTTP ${response.status}) instead of a JSON API response. This may be caused by your network proxy (${redactProxyUrl(PROXY_URL)}). Check your proxy settings in Settings > Network.`;
      } else {
        errorMessage = `Received an unexpected HTML error page (HTTP ${response.status}) instead of a JSON API response. This could be caused by a firewall, captive portal, or network issue.`;
      }
      debugLog(`[Detected HTML error response — replaced raw HTML with clean message]`);
    }

    // Empty-body 400 (#613): some upstreams (Chinese OpenAI-compat relays,
    // misconfigured DeepSeek endpoints) return 400 with no body, leaving
    // users with `400 status code (no body)` and nothing to debug. Attach
    // a sanitized summary of the last outgoing request so the user — and
    // we — have something concrete to act on.
    if (response.status === 400 && !errorText.trim()) {
      const summary = getLastOutgoingRequest(url);
      if (summary) {
        const emptyNames = summary.toolNames.filter(n => n === '<empty>').length;
        const dupIds = summary.toolCallIds.length - new Set(summary.toolCallIds).size;
        const hints: string[] = [];
        if (emptyNames > 0) hints.push(`${emptyNames} tool call(s) with empty name`);
        if (dupIds > 0) hints.push(`${dupIds} duplicate tool_call_id(s)`);
        if (hints.length > 0) {
          errorMessage = `Endpoint rejected the request with no body. Likely cause: ${hints.join(', ')}. ` +
            `This usually means the upstream relay's tool-call streaming is broken — try a different ` +
            `model or endpoint. Last request had ${summary.toolCallIds.length} tool call(s) and ` +
            `${summary.toolResults} tool result(s) over ${summary.historyLength} history entries.`;
        } else {
          errorMessage = `Endpoint rejected the request with no body (no obvious shape problem). ` +
            `Last request: ${summary.toolCallIds.length} tool call(s), ${summary.toolResults} tool ` +
            `result(s), ${summary.historyLength} history entries. Try a different endpoint.`;
        }
        debugLog(`[Empty-body 400 enriched: ${errorMessage}]`);
      }
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
// REQUEST DIAGNOSTICS
// ============================================================================

/**
 * Sanitized snapshot of the most recent intercepted request body. Captured so
 * the empty-body 400 diagnostic can attach actionable context (which tools the
 * model tried to call) instead of letting users see "400 status code (no
 * body)" with nothing to act on.
 *
 * Tool arguments are NEVER stored — only counts, ids, and names. The data
 * never leaves this process; it's read by {@link captureApiError} and woven
 * into the stored error message.
 */
interface OutgoingRequestSummary {
  url: string;
  adapter: string;
  /** Timestamp the request was prepared (not sent). Used to expire stale entries. */
  preparedAt: number;
  /** Tool-call ids visible in the assistant tool_calls / function_call entries. */
  toolCallIds: string[];
  /** Tool names referenced. Empty strings are reported as "<empty>". */
  toolNames: string[];
  /** Number of tool result / function_call_output entries. */
  toolResults: number;
  /** Number of messages or input entries (whichever the adapter uses). */
  historyLength: number;
}

let lastOutgoingRequest: OutgoingRequestSummary | undefined;

function rememberLastOutgoingRequest(
  url: string,
  body: Record<string, unknown>,
  adapter: ApiAdapter,
): void {
  const summary: OutgoingRequestSummary = {
    url,
    adapter: adapter.name,
    preparedAt: Date.now(),
    toolCallIds: [],
    toolNames: [],
    toolResults: 0,
    historyLength: 0,
  };

  if (adapter.name === 'openai') {
    const messages = body.messages as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(messages)) {
      summary.historyLength = messages.length;
      for (const msg of messages) {
        if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls as Array<{ id?: unknown; function?: { name?: unknown } }>) {
            if (typeof tc.id === 'string') summary.toolCallIds.push(tc.id);
            const name = typeof tc.function?.name === 'string' ? tc.function.name : '';
            summary.toolNames.push(name || '<empty>');
          }
        }
        if (msg.role === 'tool') summary.toolResults++;
      }
    }
  } else if (adapter.name === 'openai-responses') {
    const input = body.input as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(input)) {
      summary.historyLength = input.length;
      for (const entry of input) {
        if (entry.type === 'function_call') {
          if (typeof entry.call_id === 'string') summary.toolCallIds.push(entry.call_id);
          const name = typeof entry.name === 'string' ? entry.name : '';
          summary.toolNames.push(name || '<empty>');
        } else if (entry.type === 'function_call_output') {
          summary.toolResults++;
        }
      }
    }
  }

  lastOutgoingRequest = summary;
}

/** Read by captureApiError; null when no recent request or summary is stale (>30s). */
function getLastOutgoingRequest(forUrl: string): OutgoingRequestSummary | undefined {
  if (!lastOutgoingRequest) return undefined;
  if (Date.now() - lastOutgoingRequest.preparedAt > 30_000) return undefined;
  if (lastOutgoingRequest.url !== forUrl) return undefined;
  return lastOutgoingRequest;
}

/**
 * Build a synthetic 400 Response that mimics OpenAI's error envelope so the
 * SDK surfaces the structured error instead of dying on a generic 400. Used
 * when {@link MalformedBodyError} fires before the request hits the wire.
 */
function synthesizeMalformedBodyResponse(
  err: MalformedBodyError,
  url: string,
  startTime: number,
  adapter: ApiAdapter,
): Promise<Response> {
  const body = JSON.stringify({
    error: {
      type: 'invalid_request_error',
      code: err.code,
      message: `Craft Agents blocked an outgoing request that the API would reject: ${err.detail}. ` +
        `This typically indicates a streaming-reassembly bug in the upstream endpoint or a stale ` +
        `tool history. Try starting a new session or switching to a different model/endpoint.`,
      param: 'tool_calls',
    },
  });

  debugLog(`[${adapter.name}] Outgoing body validation failed (${err.code}); synthesizing 400 response`);

  setStoredError({
    status: 400,
    statusText: 'Bad Request (blocked by Craft Agents)',
    message: err.detail,
    timestamp: Date.now(),
  });

  return logResponse(
    new Response(body, {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'content-type': 'application/json' },
    }),
    url,
    startTime,
    adapter,
  );
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
        // Re-inject stored metadata into conversation history (also runs the
        // Responses-API repair pass before metadata)
        parsed = adapter.injectMetadataIntoHistory(parsed);

        // Pre-flight validation. If the body is structurally invalid for this
        // adapter (duplicate tool_call_id, missing call_id, empty function
        // name, orphan tool result), short-circuit with a synthetic 400 the
        // SDK can surface clearly instead of dying on `400 status code (no
        // body)` from the upstream.
        if (adapter.validateOutgoingBody) {
          try {
            adapter.validateOutgoingBody(parsed);
          } catch (err) {
            if (err instanceof MalformedBodyError) {
              return synthesizeMalformedBodyResponse(err, url, startTime, adapter);
            }
            throw err;
          }
        }

        // Adapter-specific request modifications (e.g., fast mode)
        let modifiedInit = normalizedInit;
        if (adapter.modifyRequest) {
          const result = adapter.modifyRequest(url, normalizedInit, parsed);
          modifiedInit = result.init;
          parsed = result.body;
        }

        const proxy = getProxyForUrl(url);
        const finalBody = JSON.stringify(parsed);
        const finalInit = {
          ...modifiedInit,
          body: finalBody,
          ...(proxy ? { proxy } : {}),
        };

        // Cache a sanitized request summary for the 400-empty-body diagnostic
        // pathway in captureApiError. Plain-text bodies (sensitive arguments)
        // never leave this process.
        rememberLastOutgoingRequest(url, parsed, adapter);

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

        // Non-SSE response — strip metadata from JSON body if present
        if (contentType.includes('application/json') && response.body) {
          const text = await response.text();
          const stripped = stripMetadataFieldsFromRawJson(text);
          return logResponse(new Response(stripped, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }), url, startTime, adapter);
        }

        return logResponse(response, url, startTime, adapter);
      }
    } catch (e) {
      debugLog(`[${adapter?.name}] FETCH modification failed:`, e);
    }
  }

  const proxy = getProxyForUrl(url);
  const proxyInit = proxy ? { ...init, proxy } : init;
  const response = await originalFetch(input, proxyInit);
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
