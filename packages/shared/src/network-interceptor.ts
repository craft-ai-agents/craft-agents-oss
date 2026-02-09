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

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Type alias for fetch's HeadersInit (not in ESNext lib, but available at runtime via Bun)
// Using string[][] instead of [string, string][] to match RequestInit.headers type
type HeadersInitType = Headers | Record<string, string> | string[][];

// Feature flags
const TOOL_METADATA_FOR_ALL_TOOLS = false; // When false, only add metadata to MCP tools
const INTERCEPTOR_LOGGING_ENABLED = false; // When false, disable all debug logging

const DEBUG = INTERCEPTOR_LOGGING_ENABLED &&
  (process.argv.includes('--debug') || process.env.G4OS_DEBUG === '1');

// Log file for debug output (avoids console spam)
const LOG_DIR = join(homedir(), '.g4os', 'logs');
const LOG_FILE = join(LOG_DIR, 'interceptor.log');

// Ensure log directory exists at module load
try {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // Ignore - logging will silently fail if dir can't be created
}

// Rotate log file if older than 1 day
const MAX_LOG_AGE_MS = 24 * 60 * 60 * 1000;
try {
  if (existsSync(LOG_FILE)) {
    const stat = statSync(LOG_FILE);
    if (Date.now() - stat.mtimeMs > MAX_LOG_AGE_MS) {
      // Keep one previous log for debugging, overwrite any older backup
      const prevLog = LOG_FILE + '.prev';
      renameSync(LOG_FILE, prevLog);
    }
  }
} catch {
  // Ignore — rotation is best-effort
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
const ERROR_FILE = join(homedir(), '.g4os', 'api-error.json');
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
// TOOL METADATA STORE
// ============================================================================

/**
 * Metadata extracted from tool_use inputs by the SSE stripping stream.
 * Keyed by tool_use_id, consumed by tool-matching.ts.
 */
export interface ToolMetadata {
  intent?: string;
  displayName?: string;
  timestamp: number;
}

/**
 * Session-scoped, file-based metadata store for cross-process sharing.
 *
 * The interceptor runs in the SDK subprocess (via --preload), while
 * tool-matching.ts runs in the Electron main process. These are separate
 * OS processes — globalThis, module-level Maps, etc. are NOT shared.
 *
 * Solution: a single `tool-metadata.json` file in the session directory.
 * - set() writes to both in-memory Map AND merges into {sessionDir}/tool-metadata.json
 * - get() checks in-memory Map first (same-process), then reads from file
 * - No cleanup needed: file lives with the session, deleted when session is deleted
 * - Survives subprocess restarts (session resume) via file persistence
 *
 * The session directory is determined by:
 * - SDK subprocess: G4OS_SESSION_DIR env var (set by main process before spawn)
 * - Main process: toolMetadataStore.setSessionDir(path) called during agent creation
 */

// Session directory — set by env var (subprocess) or setSessionDir() (main process)
let _sessionDir: string | null = process.env.G4OS_SESSION_DIR || null;

function getMetadataFilePath(): string | null {
  return _sessionDir ? join(_sessionDir, 'tool-metadata.json') : null;
}

// In-memory Map for same-process lookups (tests, Codex backend, etc.)
const _metadataMap = new Map<string, ToolMetadata>();

// File cache — shadows what's been written to disk by this process.
// Avoids redundant readFileSync on every set() call (subprocess is sole writer).
// Reset on setSessionDir() so the main process loads fresh data per session.
let _fileCache: Record<string, ToolMetadata> | null = null;

/** Read the entire metadata file from disk, returning a Record keyed by toolUseId */
function readMetadataFile(): Record<string, ToolMetadata> {
  const filePath = getMetadataFilePath();
  if (!filePath) return {};
  try {
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as Record<string, ToolMetadata>;
  } catch {
    return {};
  }
}

/** Write the entire metadata object to the session file (atomic via temp+rename) */
function writeMetadataFile(allMetadata: Record<string, ToolMetadata>): void {
  const filePath = getMetadataFilePath();
  if (!filePath) return;
  try {
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(allMetadata));
    renameSync(tmpPath, filePath);
  } catch {
    // Ignore write errors — in-memory still works for same-process
  }
}

export const toolMetadataStore = {
  /**
   * Set session directory and pre-populate in-memory map from file.
   * Called by main process (where set() is never called) so all subsequent
   * get() calls are O(1) memory lookups instead of file reads.
   */
  setSessionDir(dir: string): void {
    _sessionDir = dir;
    _fileCache = null; // Reset file cache for new session
    // Pre-populate in-memory map from file (enables O(1) get() in main process)
    _metadataMap.clear();
    const all = readMetadataFile();
    for (const [id, meta] of Object.entries(all)) {
      _metadataMap.set(id, meta);
    }
  },

  /** Store metadata — writes to in-memory Map + cached file (write-only, no redundant reads) */
  set(toolUseId: string, metadata: ToolMetadata): void {
    _metadataMap.set(toolUseId, metadata);
    // Initialize file cache once (picks up pre-existing data on session resume), then write-only
    if (!_fileCache) _fileCache = readMetadataFile();
    _fileCache[toolUseId] = metadata;
    writeMetadataFile(_fileCache);
  },

  /** Read metadata — checks in-memory first, then session file. No pop semantics. */
  get(toolUseId: string): ToolMetadata | undefined {
    // 1. Same-process: check in-memory Map (always hits after setSessionDir or set)
    const inMemory = _metadataMap.get(toolUseId);
    if (inMemory) {
      return inMemory;
    }

    // 2. Cross-process fallback: check session file (only needed if setSessionDir wasn't called)
    const all = readMetadataFile();
    return all[toolUseId];
  },

  delete(toolUseId: string): void {
    _metadataMap.delete(toolUseId);
    if (!_fileCache) _fileCache = readMetadataFile();
    delete _fileCache[toolUseId];
    writeMetadataFile(_fileCache);
  },

  get size(): number {
    return _metadataMap.size;
  },
};

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
    // Skip non-MCP tools when feature flag is disabled
    const isMcpTool = tool.name?.startsWith('mcp__');
    if (!TOOL_METADATA_FOR_ALL_TOOLS && !isMcpTool) {
      continue;
    }

    // Add metadata fields to tools with input schemas
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
  // Lazy file read: only load from disk once if any block misses the in-memory map
  // (normally all entries are in _metadataMap; file fallback only matters on session resume)
  let fileMetadata: Record<string, ToolMetadata> | null = null;

  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (block.type !== 'tool_use' || !block.id || !block.input) continue;

      // Skip if already has metadata (e.g., first few calls before stripping takes effect)
      if ('_intent' in block.input || '_displayName' in block.input) continue;

      // Look up stored metadata: in-memory Map first, then single file read fallback
      let stored = _metadataMap.get(block.id);
      if (!stored) {
        if (!fileMetadata) fileMetadata = readMetadataFile();
        stored = fileMetadata[block.id];
      }
      if (stored) {
        if (stored.intent) block.input._intent = stored.intent;
        if (stored.displayName) block.input._displayName = stored.displayName;
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
