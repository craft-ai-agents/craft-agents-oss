/**
 * Centralized Mode Manager
 *
 * Manages agent operational modes (Safe Mode, and future modes).
 * Each session has its own mode state - no global state contamination.
 *
 * Available Modes:
 * - 'safe': Read-only exploration mode (no writes/edits)
 *
 * Future modes could include:
 * - 'plan': Planning mode (research before execution)
 * - 'explore': Deep codebase exploration
 * - 'debug': Debug/investigation mode
 */

import { debug } from '../utils/debug.ts';

// ============================================================
// Mode Types
// ============================================================

/**
 * Available operational modes
 */
export type Mode = 'safe';

/**
 * State for a single session's modes
 */
export interface ModeState {
  /** Session ID */
  sessionId: string;
  /** Active modes (can have multiple active at once in future) */
  activeModes: Set<Mode>;
  /** Callback when mode state changes */
  onStateChange?: (state: ModeState) => void;
}

/**
 * Callbacks for mode changes
 */
export interface ModeCallbacks {
  onStateChange?: (state: ModeState) => void;
}

/**
 * Mode configuration - defines behavior for each mode
 */
export interface ModeConfig {
  /** Tools that are blocked in this mode */
  blockedTools: Set<string>;
  /** Read-only MCP patterns (tools matching these are allowed) */
  readOnlyMcpPatterns: RegExp[];
  /** Read-only API methods */
  readOnlyApiMethods: Set<string>;
  /** User-friendly name */
  displayName: string;
  /** Keyboard shortcut hint */
  shortcutHint: string;
}

// ============================================================
// Mode Configurations
// ============================================================

/**
 * Configuration for each mode
 */
export const MODE_CONFIGS: Record<Mode, ModeConfig> = {
  safe: {
    blockedTools: new Set([
      'Bash',
      'Write',
      'Edit',
      'MultiEdit',
      'NotebookEdit',
    ]),
    readOnlyMcpPatterns: [
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
    ],
    readOnlyApiMethods: new Set(['GET']),
    displayName: 'Safe Mode',
    shortcutHint: 'SHIFT+TAB',
  },
};

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
        activeModes: new Set(),
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  /**
   * Set modes for a session
   */
  setModes(sessionId: string, activeModes: Set<Mode>): void {
    const existing = this.getState(sessionId);
    const newState = { ...existing, activeModes: new Set(activeModes) };
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
// Generic Mode API
// ============================================================

/**
 * Check if a mode is active for a session
 */
export function isModeActive(sessionId: string, mode: Mode): boolean {
  return modeManager.getState(sessionId).activeModes.has(mode);
}

/**
 * Enter a mode for a session (called by UI)
 */
export function enterMode(sessionId: string, mode: Mode): void {
  debug(`[Mode] Entering ${mode} mode for session ${sessionId}`);
  const state = modeManager.getState(sessionId);
  const newModes = new Set(state.activeModes);
  newModes.add(mode);
  modeManager.setModes(sessionId, newModes);
}

/**
 * Exit a mode for a session (called by UI)
 */
export function exitMode(sessionId: string, mode: Mode): void {
  debug(`[Mode] Exiting ${mode} mode for session ${sessionId}`);
  const state = modeManager.getState(sessionId);
  const newModes = new Set(state.activeModes);
  newModes.delete(mode);
  modeManager.setModes(sessionId, newModes);
}

/**
 * Toggle a mode for a session (called by UI)
 * Returns the new state (true = active, false = inactive)
 */
export function toggleMode(sessionId: string, mode: Mode): boolean {
  if (isModeActive(sessionId, mode)) {
    exitMode(sessionId, mode);
    return false;
  } else {
    enterMode(sessionId, mode);
    return true;
  }
}

/**
 * Get all active modes for a session
 */
export function getActiveModes(sessionId: string): Mode[] {
  return Array.from(modeManager.getState(sessionId).activeModes);
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
  initialModes: Mode[] | { safeMode?: boolean },
  callbacks?: ModeCallbacks
): void {
  // Support both new array format and legacy { safeMode: boolean } format
  let modes: Set<Mode>;
  if (Array.isArray(initialModes)) {
    modes = new Set(initialModes);
  } else {
    // Legacy format
    modes = new Set<Mode>();
    if (initialModes.safeMode) {
      modes.add('safe');
    }
  }

  modeManager.setModes(sessionId, modes);
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
// Tool Blocking Logic (Generic)
// ============================================================

/**
 * Check if a tool is blocked in a specific mode
 */
export function isToolBlockedInMode(toolName: string, mode: Mode): boolean {
  const config = MODE_CONFIGS[mode];
  return config.blockedTools.has(toolName);
}

/**
 * Check if an MCP tool is read-only in a specific mode
 */
export function isReadOnlyMcpToolForMode(toolName: string, mode: Mode): boolean {
  const config = MODE_CONFIGS[mode];
  return config.readOnlyMcpPatterns.some(pattern => pattern.test(toolName));
}

/**
 * Check if an API method is read-only in a specific mode
 */
export function isReadOnlyApiMethodForMode(method: string, mode: Mode): boolean {
  const config = MODE_CONFIGS[mode];
  return config.readOnlyApiMethods.has(method.toUpperCase());
}

/**
 * Check if a tool is blocked in ANY active mode for a session
 */
export function isToolBlockedInAnyMode(sessionId: string, toolName: string): boolean {
  const activeModes = getActiveModes(sessionId);
  return activeModes.some(mode => isToolBlockedInMode(toolName, mode));
}

/**
 * Get a user-friendly message explaining why a tool is blocked
 */
export function getBlockReason(toolName: string, mode: Mode): string {
  const config = MODE_CONFIGS[mode];
  const displayName = config.displayName;
  const shortcut = config.shortcutHint;

  if (toolName === 'Bash') {
    return `Bash commands are blocked in ${displayName}. Exit ${displayName} (${shortcut}) to run commands.`;
  }
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    return `File modifications are blocked in ${displayName}. Exit ${displayName} (${shortcut}) to make changes.`;
  }
  if (toolName.startsWith('mcp__')) {
    return `MCP write operations are blocked in ${displayName}. Exit ${displayName} (${shortcut}) to make changes.`;
  }
  if (toolName.startsWith('api_')) {
    return `API mutations are blocked in ${displayName}. Exit ${displayName} (${shortcut}) to make changes.`;
  }
  return `${toolName} is blocked in ${displayName}. Exit ${displayName} (${shortcut}) to use this tool.`;
}

// ============================================================
// Mode Context (for user messages)
// ============================================================

/**
 * Generate context for all active modes to inject into user messages.
 * Returns null if no modes are active.
 */
export function getModeContext(sessionId: string): string | null {
  const activeModes = getActiveModes(sessionId);
  if (activeModes.length === 0) {
    return null;
  }

  const parts: string[] = [];

  for (const mode of activeModes) {
    const config = MODE_CONFIGS[mode];
    parts.push(`<${mode}_mode_active>`);
    parts.push(`You are in **${config.displayName.toUpperCase()}** (read-only exploration).`);
    parts.push('');
    parts.push('**Allowed:**');
    parts.push('- Reading files, searching, exploring the codebase');
    parts.push('- MCP read operations (blocks_read, search, etc.)');
    parts.push('- API GET requests');
    parts.push('- Asking questions, having conversations');
    parts.push('- Write/Edit to plans folder (for SubmitPlan)');
    parts.push('');
    parts.push('**Blocked:**');
    parts.push(`- ${Array.from(config.blockedTools).join(', ')} (except plans folder)`);
    parts.push('- MCP write operations');
    parts.push('- API mutations (POST, PUT, DELETE)');
    parts.push('');
    parts.push(`The user can exit ${config.displayName} via ${config.shortcutHint} or the UI toggle.`);
    parts.push(`</${mode}_mode_active>`);
  }

  return parts.join('\n');
}

// ============================================================
// System Prompt Documentation (generated from MODE_CONFIGS)
// ============================================================

/**
 * Generate the Safe Mode documentation section for the system prompt.
 * This is generated from MODE_CONFIGS to ensure consistency.
 *
 * SINGLE SOURCE OF TRUTH: The blocked tools list comes from MODE_CONFIGS.safe.blockedTools
 */
export function getSafeModeDocumentation(): string {
  const config = MODE_CONFIGS.safe;
  const blockedTools = Array.from(config.blockedTools).join(', ');

  return `## Safe Mode

Safe Mode is a read-only exploration mode the user can toggle. When active, you can read, search, and explore but cannot make changes.

You will know you're in Safe Mode when you see the \`<safe_mode_active>\` section in your context.

### When Safe Mode is Active

| Operation | Allowed? | Notes |
|-----------|----------|-------|
| Ask user questions | ✅ | Normal conversation |
| Read Craft documents | ✅ | blocks_read, document_get, search |
| List Craft structure | ✅ | spaces_list, folders_list |
| File exploration | ✅ | Read, Glob, Grep |
| Web search/fetch | ✅ | WebSearch, WebFetch |
| API GET requests | ✅ | Read-only API calls |
| **Plans folder** | ✅ | Write/Edit allowed to session plans folder |
| File writes/edits | ❌ | ${blockedTools} blocked (except plans folder) |
| Craft modifications | ❌ | blocks_add, blocks_update blocked |
| API mutations | ❌ | POST, PUT, DELETE blocked |

### Plans Folder Exception

You CAN use Write, Edit, and MultiEdit to create/modify files in the session's plans folder (\`~/.craft-agent/sessions/{sessionId}/plans/\`). This allows SubmitPlan to work in Safe Mode for creating structured plans.

### Exiting Safe Mode

The user toggles Safe Mode via the UI (${config.shortcutHint} or badge). You cannot enter or exit Safe Mode - only the user can.

When the user exits Safe Mode, you can proceed with any operations they've requested.`;
}

