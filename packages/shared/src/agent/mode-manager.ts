/**
 * Centralized Mode Manager
 *
 * Manages agent operational modes (Safe Mode, and future modes).
 * Each session has its own mode state - no global state contamination.
 *
 * Safe Mode: Read-only exploration mode. The agent can:
 * - Read files, search, explore the codebase
 * - Make MCP read-only calls (blocks_read, search, etc.)
 * - Make API GET requests
 * - Ask questions and have conversations
 *
 * Safe Mode blocks:
 * - File writes/edits (Write, Edit, Bash)
 * - MCP write operations (blocks_add, blocks_update, etc.)
 * - API mutations (POST, PUT, DELETE)
 *
 * The user explicitly toggles Safe Mode via UI (Ctrl+S or badge toggle).
 * The agent cannot enter/exit Safe Mode - only the user can.
 */

import { debug } from '../utils/debug.ts';

// ============================================================
// Mode State Types
// ============================================================

/**
 * State for a single session's modes
 */
export interface ModeState {
  /** Session ID */
  sessionId: string;
  /** Whether Safe Mode is active (read-only exploration) */
  safeMode: boolean;
  /** Callback when mode state changes */
  onStateChange?: (state: ModeState) => void;
}

/**
 * Callbacks for mode changes
 */
export interface ModeCallbacks {
  onStateChange?: (state: ModeState) => void;
}

// ============================================================
// Mode Manager Class
// ============================================================

/**
 * Manager for per-session mode state.
 * Each session has its own state - NO GLOBAL STATE.
 */
class ModeManager {
  private states: Map<string, ModeState> = new Map();
  private callbacks: Map<string, ModeCallbacks> = new Map();

  /**
   * Get or create state for a session
   */
  getState(sessionId: string): ModeState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        safeMode: false,
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  /**
   * Set state for a session (merges with existing state)
   */
  setState(sessionId: string, updates: Partial<ModeState>): void {
    const existing = this.getState(sessionId);
    const newState = { ...existing, ...updates, sessionId };
    this.states.set(sessionId, newState);

    // Notify callbacks
    const callbacks = this.callbacks.get(sessionId);
    if (callbacks?.onStateChange) {
      callbacks.onStateChange(newState);
    }
  }

  /**
   * Register callbacks for a session
   */
  registerCallbacks(sessionId: string, callbacks: ModeCallbacks): void {
    this.callbacks.set(sessionId, callbacks);
  }

  /**
   * Unregister callbacks for a session
   */
  unregisterCallbacks(sessionId: string): void {
    this.callbacks.delete(sessionId);
  }

  /**
   * Clean up a session's state
   */
  cleanupSession(sessionId: string): void {
    this.states.delete(sessionId);
    this.callbacks.delete(sessionId);
  }
}

// Singleton manager instance
export const modeManager = new ModeManager();

// ============================================================
// Safe Mode API
// ============================================================

/**
 * Check if Safe Mode is active for a session
 */
export function isSafeModeActive(sessionId: string): boolean {
  return modeManager.getState(sessionId).safeMode;
}

/**
 * Enter Safe Mode for a session (called by UI)
 */
export function enterSafeMode(sessionId: string): void {
  debug(`[SafeMode] Entering safe mode for session ${sessionId}`);
  modeManager.setState(sessionId, { safeMode: true });
}

/**
 * Exit Safe Mode for a session (called by UI)
 */
export function exitSafeMode(sessionId: string): void {
  debug(`[SafeMode] Exiting safe mode for session ${sessionId}`);
  modeManager.setState(sessionId, { safeMode: false });
}

/**
 * Toggle Safe Mode for a session (called by UI)
 */
export function toggleSafeMode(sessionId: string): boolean {
  const current = isSafeModeActive(sessionId);
  if (current) {
    exitSafeMode(sessionId);
  } else {
    enterSafeMode(sessionId);
  }
  return !current;
}

/**
 * Get mode state for a session
 */
export function getModeState(sessionId: string): ModeState {
  return modeManager.getState(sessionId);
}

/**
 * Initialize mode state for a session with callbacks
 */
export function initializeModeState(
  sessionId: string,
  initialSafeMode: boolean,
  callbacks?: ModeCallbacks
): void {
  modeManager.setState(sessionId, { safeMode: initialSafeMode });
  if (callbacks) {
    modeManager.registerCallbacks(sessionId, callbacks);
  }
}

/**
 * Clean up mode state for a session
 */
export function cleanupModeState(sessionId: string): void {
  modeManager.cleanupSession(sessionId);
}

// ============================================================
// Tool Blocking Logic (for PreToolUse hook)
// ============================================================

/**
 * Tools that are always blocked in Safe Mode
 */
export const SAFE_MODE_BLOCKED_TOOLS = new Set([
  'Bash',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
]);

/**
 * Read-only MCP tool patterns (allowed in Safe Mode)
 */
const READ_ONLY_MCP_PATTERNS = [
  // Craft MCP - read operations
  /blocks_read/,
  /blocks_list/,
  /blocks_get/,
  /document_get/,
  /document_list/,
  /spaces_list/,
  /folders_list/,
  /search/,
  /list/,
  /get/,
  /read/,
  // Docs MCP - all operations are read-only
  /^mcp__docs__/,
];

/**
 * Check if an MCP tool is read-only (allowed in Safe Mode)
 */
export function isReadOnlyMcpTool(toolName: string): boolean {
  return READ_ONLY_MCP_PATTERNS.some(pattern => pattern.test(toolName));
}

/**
 * Check if an API method is read-only (allowed in Safe Mode)
 */
export function isReadOnlyApiMethod(method: string): boolean {
  return method.toUpperCase() === 'GET';
}

/**
 * Check if a tool is blocked in Safe Mode
 * Returns true if the tool should be blocked
 */
export function isToolBlockedInSafeMode(toolName: string): boolean {
  return SAFE_MODE_BLOCKED_TOOLS.has(toolName);
}

/**
 * Check if an MCP tool is allowed in Safe Mode
 * Returns true if the MCP tool is read-only
 */
export function isMcpToolAllowedInSafeMode(toolName: string): boolean {
  return isReadOnlyMcpTool(toolName);
}

/**
 * Check if an API call is allowed in Safe Mode
 * Returns true if the method is GET
 */
export function isApiCallAllowedInSafeMode(method: string): boolean {
  return isReadOnlyApiMethod(method);
}

/**
 * Get a user-friendly message explaining why a tool is blocked
 */
export function getSafeModeBlockReason(toolName: string): string {
  if (toolName === 'Bash') {
    return 'Bash commands are blocked in Safe Mode. Exit Safe Mode (Ctrl+S) to run commands.';
  }
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    return 'File modifications are blocked in Safe Mode. Exit Safe Mode (Ctrl+S) to make changes.';
  }
  if (toolName.startsWith('mcp__')) {
    return 'MCP write operations are blocked in Safe Mode. Exit Safe Mode (Ctrl+S) to make changes.';
  }
  if (toolName.startsWith('api_')) {
    return 'API mutations are blocked in Safe Mode. Exit Safe Mode (Ctrl+S) to make changes.';
  }
  return `${toolName} is blocked in Safe Mode. Exit Safe Mode (Ctrl+S) to use this tool.`;
}

// ============================================================
// Safe Mode Context (for user messages)
// ============================================================

/**
 * Generate Safe Mode context to inject into user messages.
 * Returns null if Safe Mode is not active.
 */
export function getSafeModeContext(sessionId: string): string | null {
  if (!isSafeModeActive(sessionId)) {
    return null;
  }

  const parts: string[] = [];
  parts.push('<safe_mode_active>');
  parts.push('You are in **SAFE MODE** (read-only exploration).');
  parts.push('');
  parts.push('**Allowed:**');
  parts.push('- Reading files, searching, exploring the codebase');
  parts.push('- MCP read operations (blocks_read, search, etc.)');
  parts.push('- API GET requests');
  parts.push('- Asking questions, having conversations');
  parts.push('');
  parts.push('**Blocked:**');
  parts.push('- File writes/edits (Write, Edit, Bash)');
  parts.push('- MCP write operations');
  parts.push('- API mutations (POST, PUT, DELETE)');
  parts.push('');
  parts.push('The user can exit Safe Mode via Ctrl+S or the UI toggle.');
  parts.push('</safe_mode_active>');

  return parts.join('\n');
}
