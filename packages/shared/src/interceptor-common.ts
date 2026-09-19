/**
 * Shared infrastructure for the unified network interceptor.
 *
 * The interceptor runs as a preload script in SDK subprocesses (Claude, Copilot, Pi).
 * This module provides the common pieces:
 * - toolMetadataStore (file-based cross-process sharing)
 * - LastApiError (error capture for error handler)
 * - Logging utilities
 * - Config reading (richToolDescriptions, extendedPromptCache settings)
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, appendFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Packaged apps run from inside an app.asar archive */
export const IS_PACKAGED = process.argv.some(arg => arg.includes('app.asar'));

/** Enable interceptor logging in dev mode (not packaged), disable in production */
export const INTERCEPTOR_LOGGING_ENABLED = !IS_PACKAGED;

export const DEBUG = INTERCEPTOR_LOGGING_ENABLED &&
  (process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1');

/** Config file path for reading settings in the SDK subprocess */
export const CONFIG_FILE = join(homedir(), '.craft-agent', 'config.json');

/** Session directory — set by env var (subprocess) or setSessionDir() (main process) */
let _sessionDir: string | null = process.env.CRAFT_SESSION_DIR || null;

// ============================================================================
// LOGGING
// ============================================================================

export const LOG_DIR = join(homedir(), '.craft-agent', 'logs');
export const LOG_FILE = join(LOG_DIR, 'interceptor.log');

/** Rotate the active log once it reaches this size. */
export const MAX_LOG_FILE_BYTES = 32 * 1024 * 1024;

/** Also rotate a log that has not been written to for this long. */
const MAX_LOG_AGE_MS = 24 * 60 * 60 * 1000;

/** Hard cap on a single entry, so one oversized entry can't dominate the file. */
export const MAX_LOG_ENTRY_CHARS = 4 * 1024 * 1024;

/** Cap applied to request bodies on the `CRAFT_DEBUG_FULL_BODIES` opt-in path. */
export const MAX_LOGGED_BODY_CHARS = 2 * 1024 * 1024;

/**
 * When `CRAFT_DEBUG_FULL_BODIES=1`, request bodies are written to interceptor.log
 * instead of being replaced by a size placeholder. Opt-in only — bodies carry user
 * prompts, tool arguments and base64 image payloads.
 */
export const DEBUG_FULL_BODIES = process.env.CRAFT_DEBUG_FULL_BODIES === '1';

interface LogLimits {
  maxBytes: number;
  maxAgeMs: number;
  checkIntervalMs: number;
  checkChars: number;
}

const DEFAULT_LOG_LIMITS: LogLimits = {
  maxBytes: MAX_LOG_FILE_BYTES,
  maxAgeMs: MAX_LOG_AGE_MS,
  // Rotation is checked at most once per interval, unless enough characters
  // accumulated in the meantime — a statSync per log line would be its own I/O problem.
  checkIntervalMs: 1000,
  checkChars: 1024 * 1024,
};

const _limits: LogLimits = { ...DEFAULT_LOG_LIMITS };

/** Mutable so tests can redirect writes away from the real user log. */
let _logFile = LOG_FILE;
let _charsSinceCheck = 0;
let _lastRotateCheck = 0;

/** Rename the active log to `<log>.prev`, replacing any previous rotation. */
function rotateLogFile(filePath: string): void {
  const prev = filePath + '.prev';
  try {
    // renameSync refuses to clobber an existing target on Windows.
    unlinkSync(prev);
  } catch {
    // No previous rotation to replace.
  }
  renameSync(filePath, prev);
}

/**
 * Rotate `filePath` when it exceeds the size or age limit. Consults the real file
 * rather than a per-process byte counter, so concurrent subprocess writers that
 * share this log degrade gracefully — overshoot is bounded by one check interval.
 */
function rotateLogIfNeeded(filePath: string): void {
  const now = Date.now();
  if (now - _lastRotateCheck < _limits.checkIntervalMs && _charsSinceCheck < _limits.checkChars) return;
  _lastRotateCheck = now;
  _charsSinceCheck = 0;

  try {
    const stat = statSync(filePath);
    if (stat.size >= _limits.maxBytes || now - stat.mtimeMs > _limits.maxAgeMs) {
      rotateLogFile(filePath);
    }
  } catch {
    // ENOENT — nothing to rotate.
  }
}

/**
 * Create the log directory and prepare the log file: reclaim an oversized log,
 * otherwise rotate a stale one. Best-effort — never throws.
 */
export function initLogFile(filePath: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // Ignore - logging will silently fail if dir can't be created
  }

  try {
    const stat = statSync(filePath);
    if (stat.size >= _limits.maxBytes) {
      // A debug log is disposable: truncating reclaims the space immediately,
      // where rotating a multi-gigabyte file would keep it around as `.prev`.
      writeFileSync(filePath, '');
    } else if (Date.now() - stat.mtimeMs > _limits.maxAgeMs) {
      rotateLogFile(filePath);
    }
  } catch {
    // ENOENT, or the rotation failed — best-effort either way.
  }
}

// Gated on DEBUG: the file is only ever written when debug logging is on, and the
// prep below truncates an oversized log — not something an unrelated import should do.
if (DEBUG) initLogFile(LOG_FILE);

/** Serialize debug args into one log line (without timestamp). */
function formatLogEntry(args: unknown[]): string {
  return args.map((a) => {
    if (typeof a === 'object') {
      try {
        return JSON.stringify(a);
      } catch (e) {
        const keys = a && typeof a === 'object' ? Object.keys(a as object).join(', ') : 'unknown';
        return `[CYCLIC STRUCTURE, keys: ${keys}] (error: ${e})`;
      }
    }
    return String(a);
  }).join(' ');
}

/** Append one timestamped, size-bounded entry. Never throws. */
export function appendLogEntry(message: string): void {
  const clipped = message.length > MAX_LOG_ENTRY_CHARS
    ? `${message.slice(0, MAX_LOG_ENTRY_CHARS)}... [ENTRY TRUNCATED at ${MAX_LOG_ENTRY_CHARS} chars]`
    : message;
  // Truncate before stamping so the timestamp is never clipped.
  const line = `${new Date().toISOString()} [interceptor] ${clipped}\n`;
  try {
    rotateLogIfNeeded(_logFile);
    appendFileSync(_logFile, line);
    _charsSinceCheck += line.length;
  } catch {
    // Silently fail if can't write to log file
  }
}

export function debugLog(...args: unknown[]) {
  if (!DEBUG) return;
  appendLogEntry(formatLogEntry(args));
}

/** Redirect log writes and reset rotation state. Tests only. */
export function _setLogFileForTesting(filePath: string): void {
  _logFile = filePath;
  _charsSinceCheck = 0;
  _lastRotateCheck = 0;
}

/** Override rotation limits. Tests only. */
export function _setLogLimitsForTesting(limits: Partial<LogLimits>): void {
  Object.assign(_limits, limits);
}

/** Restore the default log path and limits, clearing rotation state. Tests only. */
export function _resetLogStateForTesting(): void {
  _logFile = LOG_FILE;
  Object.assign(_limits, DEFAULT_LOG_LIMITS);
  _charsSinceCheck = 0;
  _lastRotateCheck = 0;
}

// ============================================================================
// CONFIG READING
// ============================================================================

/**
 * Read and cache config.json for the duration of a single request cycle.
 * Multiple interceptor functions can call this without redundant file reads.
 * Cache expires after 100ms to pick up changes between requests.
 */
let _cachedConfig: Record<string, unknown> | null = null;
let _cacheTimestamp = 0;
const CONFIG_CACHE_TTL_MS = 100;

function getInterceptorConfig(): Record<string, unknown> | null {
  const now = Date.now();
  if (_cachedConfig && (now - _cacheTimestamp) < CONFIG_CACHE_TTL_MS) return _cachedConfig;
  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    _cachedConfig = JSON.parse(content);
    _cacheTimestamp = now;
    return _cachedConfig;
  } catch {
    return null;
  }
}

/** Reset the config cache. Used by tests to ensure fresh reads after writing config. */
export function _resetConfigCacheForTesting(): void {
  _cachedConfig = null;
  _cacheTimestamp = 0;
}

/**
 * Check if rich tool descriptions are enabled (adds _intent/_displayName to all tools).
 * Reads from config.json via shared cache — the file is small and this runs once per API request.
 * Defaults to true if config is unreadable or field is not set.
 */
export function isRichToolDescriptionsEnabled(): boolean {
  const config = getInterceptorConfig();
  if (config?.richToolDescriptions !== undefined) {
    return config.richToolDescriptions as boolean;
  }
  return true;
}

/**
 * Check if extended prompt cache (1h TTL) is enabled.
 * When enabled, the interceptor upgrades all cache_control blocks from 5m to 1h TTL.
 * Defaults to false if config is unreadable or field is not set.
 */
export function isExtendedPromptCacheEnabled(): boolean {
  const config = getInterceptorConfig();
  return config?.extendedPromptCache === true;
}

/**
 * Check if 1M context window is enabled.
 * When disabled, the interceptor strips the context-1m beta header.
 * Defaults to false — the 1M beta requires Anthropic Tier 4+, so it's opt-in
 * to avoid 400 "Invalid Request" on lower-tier API keys (issue #567).
 * Must stay in sync with getEnable1MContext() in config/storage.ts.
 */
export function is1MContextEnabled(): boolean {
  const config = getInterceptorConfig();
  return config?.enable1MContext === true;
}

// ============================================================================
// LAST API ERROR
// ============================================================================

/**
 * Store the last API error for the error handler to access.
 * Uses file-based storage to reliably share across process boundaries.
 */
export interface LastApiError {
  status: number;
  statusText: string;
  message: string;
  timestamp: number;
}

const MAX_ERROR_AGE_MS = 5 * 60 * 1000; // 5 minutes

function getErrorFilePath(): string {
  // Prefer session-scoped file to avoid cross-session error consumption.
  if (_sessionDir) return join(_sessionDir, 'api-error.json');
  // Fallback for legacy/non-session contexts.
  return join(homedir(), '.craft-agent', 'api-error.json');
}

function getStoredError(sessionDir?: string): LastApiError | null {
  const errorFile = sessionDir ? join(sessionDir, 'api-error.json') : getErrorFilePath();
  try {
    if (!existsSync(errorFile)) return null;
    const content = readFileSync(errorFile, 'utf-8');
    const error = JSON.parse(content) as LastApiError;
    try {
      unlinkSync(errorFile);
      debugLog(`[getStoredError] Popped error file`);
    } catch {
      // Ignore delete errors
    }
    return error;
  } catch {
    return null;
  }
}

export function setStoredError(error: LastApiError | null): void {
  const errorFile = getErrorFilePath();
  try {
    if (error) {
      writeFileSync(errorFile, JSON.stringify(error));
      debugLog(`[setStoredError] Wrote error to file: ${error.status} ${error.message}`);
    } else {
      try {
        unlinkSync(errorFile);
      } catch {
        // File might not exist
      }
    }
  } catch (e) {
    debugLog(`[setStoredError] Failed to write: ${e}`);
  }
}

export function getLastApiError(sessionDir?: string): LastApiError | null {
  const error = getStoredError(sessionDir);
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
 * Metadata extracted from tool_use inputs by the SSE stripping/capture stream.
 * Keyed by tool_use_id, consumed by tool-matching.ts / event-adapter.ts.
 */
export interface ToolMetadata {
  intent?: string;
  displayName?: string;
  timestamp: number;
}

/**
 * Session-scoped, file-based metadata store for cross-process sharing.
 *
 * The interceptor runs in the SDK subprocess (via --preload / --require),
 * while tool-matching.ts / event-adapter.ts run in the Electron main process.
 * These are separate OS processes — globalThis, module-level Maps, etc. are NOT shared.
 *
 * Solution: a single `tool-metadata.json` file in the session directory.
 * - set() writes to both in-memory Map AND merges into {sessionDir}/tool-metadata.json
 * - get() checks in-memory Map first (same-process), then reads from file
 * - No cleanup needed: file lives with the session, deleted when session is deleted
 * - Survives subprocess restarts (session resume) via file persistence
 *
 * The session directory is determined by:
 * - SDK subprocess: CRAFT_SESSION_DIR env var (set by main process before spawn)
 * - Main process: toolMetadataStore.setSessionDir(path) called during agent creation
 *
 * IMPORTANT: Multiple sessions can run concurrently in the main process (parallel chats,
 * title generation, etc.). The singleton _sessionDir gets clobbered by whichever session
 * calls setSessionDir() last. To handle this, get() accepts an explicit sessionDir
 * parameter, and setSessionDir() merges (not replaces) the in-memory map so entries
 * from all sessions coexist safely (tool_use_ids are globally unique UUIDs).
 */

function getMetadataFilePath(): string | null {
  return _sessionDir ? join(_sessionDir, 'tool-metadata.json') : null;
}

/** Read metadata from a specific session directory's file */
function readMetadataFileFromDir(dir: string): Record<string, ToolMetadata> {
  try {
    const filePath = join(dir, 'tool-metadata.json');
    const data = readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as Record<string, ToolMetadata>;
  } catch (error) {
    debugLog(`[toolMetadataStore.read] Failed for dir=${dir}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

// In-memory Map for same-process lookups (accumulates entries across all sessions)
const _metadataMap = new Map<string, ToolMetadata>();

/** Read the entire metadata file from disk (uses current _sessionDir) */
function readMetadataFile(): Record<string, ToolMetadata> {
  if (!_sessionDir) return {};
  return readMetadataFileFromDir(_sessionDir);
}

/** Write the entire metadata object to the session file (atomic via temp+rename) */
function writeMetadataFile(allMetadata: Record<string, ToolMetadata>): void {
  const filePath = getMetadataFilePath();
  if (!filePath) return;
  try {
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(allMetadata));
    renameSync(tmpPath, filePath);
  } catch (error) {
    // Keep non-throwing behavior, but log for diagnostics.
    debugLog(`[toolMetadataStore.write] Failed for file=${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Merge an updater into the latest on-disk metadata and write atomically.
 * Retries once to reduce lost updates under concurrent writers.
 */
function mergeAndWriteMetadata(
  updater: (all: Record<string, ToolMetadata>) => void,
  retries: number = 1,
): void {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const all = readMetadataFile();
      updater(all);
      writeMetadataFile(all);
      return;
    } catch (error) {
      debugLog(`[toolMetadataStore.merge] Attempt ${attempt + 1}/${retries + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt === retries) return;
    }
  }
}

export const toolMetadataStore = {
  /**
   * Set session directory and pre-populate in-memory map from file.
   * Called by main process so subsequent get() calls are O(1) memory lookups.
   * Does NOT clear the map — entries from other sessions are preserved since
   * tool_use_ids are globally unique UUIDs and won't conflict.
   */
  setSessionDir(dir: string): void {
    _sessionDir = dir;
    // Merge, don't clear — concurrent sessions share this singleton and
    // clearing would discard metadata from other active sessions.
    const all = readMetadataFile();
    for (const [id, meta] of Object.entries(all)) {
      _metadataMap.set(id, meta);
    }
  },

  /** Store metadata — writes to in-memory Map + cached file */
  set(toolUseId: string, metadata: ToolMetadata): void {
    _metadataMap.set(toolUseId, metadata);
    mergeAndWriteMetadata((all) => {
      all[toolUseId] = metadata;
    });
  },

  /**
   * Read metadata — checks in-memory first, then session file.
   * Accepts an explicit sessionDir to read from the correct file even when
   * _sessionDir has been clobbered by a concurrent session's setSessionDir().
   */
  get(toolUseId: string, sessionDir?: string): ToolMetadata | undefined {
    const inMemory = _metadataMap.get(toolUseId);
    if (inMemory) return inMemory;

    // Read from explicit sessionDir if provided, otherwise fall back to _sessionDir
    const dir = sessionDir || _sessionDir;
    if (!dir) return undefined;

    const all = readMetadataFileFromDir(dir);
    const entry = all[toolUseId];
    if (entry) {
      // Cache in memory for O(1) subsequent lookups
      _metadataMap.set(toolUseId, entry);
    }
    return entry;
  },

  delete(toolUseId: string): void {
    _metadataMap.delete(toolUseId);
    mergeAndWriteMetadata((all) => {
      delete all[toolUseId];
    });
  },

  get size(): number {
    return _metadataMap.size;
  },

  /** Clear all in-memory entries. Used by tests to prevent cross-file state leaks. */
  _clearForTesting(): void {
    _metadataMap.clear();
  },
};

// ============================================================================
// METADATA SCHEMA DEFINITIONS
// ============================================================================

/** Schema for _displayName field added to tool definitions */
export const displayNameSchema = {
  type: 'string',
  description: 'REQUIRED: Human-friendly name for this action (2-4 words, e.g., "List Folders", "Search Documents", "Create Task")',
};

/** Schema for _intent field added to tool definitions */
export const intentSchema = {
  type: 'string',
  description: 'REQUIRED: Describe what you are trying to accomplish with this tool call (1-2 sentences)',
};
