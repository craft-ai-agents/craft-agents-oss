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
  /** Tools that are always blocked in this mode (Write, Edit, etc.) */
  blockedTools: Set<string>;
  /** Read-only Bash command patterns (commands matching these are allowed) */
  readOnlyBashPatterns: RegExp[];
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
    // Tools that are always blocked (no read-only variant)
    blockedTools: new Set([
      'Write',
      'Edit',
      'MultiEdit',
      'NotebookEdit',
    ]),
    // Read-only Bash commands that are safe to run
    readOnlyBashPatterns: [
      // File listing and inspection
      /^ls\b/,
      /^ll\b/,
      /^la\b/,
      /^tree\b/,
      /^file\b/,
      /^stat\b/,
      /^du\b/,
      /^df\b/,
      /^wc\b/,
      /^head\b/,
      /^tail\b/,
      /^cat\b/,
      /^less\b/,
      /^more\b/,
      /^bat\b/,

      // Search and find
      /^find\b/,
      /^locate\b/,
      /^which\b/,
      /^whereis\b/,
      /^type\b/,
      /^grep\b/,
      /^rg\b/,
      /^ag\b/,
      /^ack\b/,
      /^fd\b/,
      /^fzf\b/,

      // Git read operations
      /^git\s+(status|log|diff|show|branch|tag|remote|stash\s+list|describe|rev-parse|config\s+--get|config\s+-l|ls-files|ls-tree|shortlog|blame|annotate|reflog|cherry|whatchanged|ls-remote)\b/,

      // GitHub CLI read operations
      /^gh\s+(pr|issue|repo|release|run|workflow|gist|project)\s+(view|list|status|diff|checks|comments)\b/,
      /^gh\s+api\b.*--method\s+GET\b/,
      /^gh\s+api\b(?!.*--method)/,  // gh api without method defaults to GET
      /^gh\s+auth\s+status\b/,
      /^gh\s+config\s+(get|list)\b/,

      // Package manager read operations
      /^npm\s+(ls|list|view|info|show|outdated|audit|search|explain|why|config\s+get|config\s+list)\b/,
      /^yarn\s+(list|info|why|outdated|audit)\b/,
      /^pnpm\s+(list|ls|why|outdated|audit)\b/,
      /^bun\s+(pm\s+ls)\b/,
      /^pip\s+(list|show|freeze|check)\b/,
      /^pip3\s+(list|show|freeze|check)\b/,
      /^cargo\s+(tree|metadata|pkgid|verify-project)\b/,
      /^go\s+(list|mod\s+graph|mod\s+why|version)\b/,
      /^composer\s+(show|info|outdated|licenses)\b/,
      /^gem\s+(list|info|dependency|environment)\b/,
      /^bundle\s+(list|info|outdated)\b/,

      // System info
      /^pwd\b/,
      /^whoami\b/,
      /^id\b/,
      /^groups\b/,
      /^uname\b/,
      /^hostname\b/,
      /^date\b/,
      /^uptime\b/,
      /^env\b/,
      /^printenv\b/,
      /^echo\s+\$/,  // echo $VAR (reading env vars)
      /^ps\b/,
      /^top\s+-[lb]/,  // batch/list mode only
      /^htop\b/,
      /^free\b/,
      /^vmstat\b/,
      /^iostat\b/,
      /^lscpu\b/,
      /^lsmem\b/,
      /^lsblk\b/,
      /^lsusb\b/,
      /^lspci\b/,

      // Docker read operations
      /^docker\s+(ps|images|logs|inspect|stats|top|port|diff|history|version|info|system\s+info|system\s+df|network\s+ls|network\s+inspect|volume\s+ls|volume\s+inspect|container\s+ls|image\s+ls)\b/,
      /^docker-compose\s+(ps|logs|config|images|top|version)\b/,
      /^docker\s+compose\s+(ps|logs|config|images|top|version)\b/,

      // Kubernetes read operations
      /^kubectl\s+(get|describe|logs|top|explain|api-resources|api-versions|cluster-info|config\s+view|config\s+get-contexts|version)\b/,

      // Text processing (read-only)
      /^awk\b/,
      /^sed\s+-n\b/,  // sed -n (print only, no editing)
      /^sort\b/,
      /^uniq\b/,
      /^cut\b/,
      /^tr\b/,
      /^column\b/,
      /^jq\b/,
      /^yq\b/,
      /^xq\b/,
      /^xmllint\b/,
      /^json_pp\b/,
      /^python\s+-m\s+json\.tool\b/,

      // Network diagnostics (read-only)
      /^ping\b/,
      /^traceroute\b/,
      /^tracepath\b/,
      /^mtr\b/,
      /^dig\b/,
      /^nslookup\b/,
      /^host\b/,
      /^netstat\b/,
      /^ss\b/,
      /^ip\s+(addr|link|route|neigh)\s*(show)?\b/,
      /^ifconfig\b/,

      // Version checks
      /^node\s+(--version|-v)\b/,
      /^npm\s+(--version|-v)\b/,
      /^yarn\s+(--version|-v)\b/,
      /^pnpm\s+(--version|-v)\b/,
      /^bun\s+(--version|-v)\b/,
      /^python\s+(--version|-V)\b/,
      /^python3\s+(--version|-V)\b/,
      /^ruby\s+(--version|-v)\b/,
      /^go\s+version\b/,
      /^rustc\s+(--version|-V)\b/,
      /^cargo\s+(--version|-V)\b/,
      /^java\s+(-version|--version)\b/,
      /^dotnet\s+--version\b/,
      /^php\s+(--version|-v)\b/,
      /^perl\s+(--version|-v)\b/,

      // Help commands
      /^man\b/,
      /--help\b/,
      /-h\b$/,
    ],
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
  private subscribers: Map<string, Set<() => void>> = new Map();

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

    // Notify callbacks (for CraftAgent internal sync)
    const callbacks = this.callbacks.get(sessionId);
    if (callbacks?.onStateChange) {
      callbacks.onStateChange(newState);
    }

    // Notify React subscribers (for useSyncExternalStore)
    this.subscribers.get(sessionId)?.forEach(cb => cb());
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
    this.subscribers.delete(sessionId);
  }

  /**
   * Subscribe to mode changes for a session (for React useSyncExternalStore)
   * Returns an unsubscribe function
   */
  subscribe(sessionId: string, callback: () => void): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
    }
    this.subscribers.get(sessionId)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(sessionId)?.delete(callback);
    };
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
 * Subscribe to mode changes for a session (for React useSyncExternalStore)
 * Returns an unsubscribe function
 */
export function subscribeModeChanges(sessionId: string, callback: () => void): () => void {
  return modeManager.subscribe(sessionId, callback);
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

  // IMPORTANT: Register callbacks BEFORE setting modes so the initial
  // state change triggers the callback. This ensures CraftAgent.safeMode
  // is synced with the initial mode state.
  if (callbacks) {
    modeManager.registerCallbacks(sessionId, callbacks);
  }
  modeManager.setModes(sessionId, modes);
}

/**
 * Clean up mode state for a session
 */
export function cleanupModeState(sessionId: string): void {
  modeManager.cleanupSession(sessionId);
}

// ============================================================
// Tool Blocking Logic (Centralized)
// ============================================================

/**
 * Check if a Bash command is read-only in a specific mode
 */
function isReadOnlyBashCommand(command: string, mode: Mode): boolean {
  const config = MODE_CONFIGS[mode];
  // Trim and get the command (handle leading whitespace)
  const trimmedCommand = command.trim();
  return config.readOnlyBashPatterns.some(pattern => pattern.test(trimmedCommand));
}

/**
 * Check if an MCP tool is read-only in a specific mode
 */
function isReadOnlyMcpTool(toolName: string, mode: Mode): boolean {
  const config = MODE_CONFIGS[mode];
  return config.readOnlyMcpPatterns.some(pattern => pattern.test(toolName));
}

/**
 * Check if an API method is read-only in a specific mode
 */
function isReadOnlyApiMethod(method: string, mode: Mode): boolean {
  const config = MODE_CONFIGS[mode];
  return config.readOnlyApiMethods.has(method.toUpperCase());
}

/**
 * Tools that are always allowed in any mode (read-only by nature)
 */
const ALWAYS_ALLOWED_TOOLS = new Set([
  'Read', 'Glob', 'Grep',           // File reading
  'Task', 'AgentOutputTool',        // Agent orchestration
  'WebFetch', 'WebSearch',          // Web research
  'TodoWrite',                       // Task tracking
  'AskUserQuestion',                // User interaction
  'SubmitPlan',                     // Plan submission (works in any mode)
  'BashOutput',                     // Reading bash output (not executing)
]);

/**
 * Centralized check: should a tool be allowed in a specific mode?
 *
 * This is the single source of truth for tool permissions in modes.
 * Returns { allowed: true } or { allowed: false, reason: string }
 */
export function shouldAllowToolInMode(
  toolName: string,
  toolInput: unknown,
  mode: Mode,
  options?: { plansFolderPath?: string }
): { allowed: true } | { allowed: false; reason: string } {
  const config = MODE_CONFIGS[mode];

  // Always-allowed tools (read-only by nature)
  if (ALWAYS_ALLOWED_TOOLS.has(toolName)) {
    return { allowed: true };
  }

  // Check if tool name ends with an always-allowed tool (for MCP variants like mcp__plan__SubmitPlan)
  for (const allowedTool of ALWAYS_ALLOWED_TOOLS) {
    if (toolName.endsWith(`__${allowedTool}`)) {
      return { allowed: true };
    }
  }

  // Handle Bash - check if command is read-only
  if (toolName === 'Bash') {
    const input = toolInput as Record<string, unknown> | null;
    const command = input?.command;
    if (typeof command === 'string' && isReadOnlyBashCommand(command, mode)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `This Bash command is not in the read-only allowlist for ${config.displayName}. Exit ${config.displayName} (${config.shortcutHint}) to run it.`
    };
  }

  // Handle Write/Edit/MultiEdit - allow if targeting plans folder
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    const input = toolInput as Record<string, unknown> | null;
    const filePath = input?.file_path as string | undefined;

    if (filePath && options?.plansFolderPath) {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const normalizedPlansDir = options.plansFolderPath.replace(/\\/g, '/');
      debug(`[Mode] Checking plans folder exception: path="${normalizedPath}", plansDir="${normalizedPlansDir}"`);

      if (normalizedPath.startsWith(normalizedPlansDir)) {
        debug(`[Mode] Allowing ${toolName} to plans folder`);
        return { allowed: true };
      }
    }
  }

  // Blocked tools (Write, Edit, MultiEdit, NotebookEdit)
  if (config.blockedTools.has(toolName)) {
    return {
      allowed: false,
      reason: getBlockReason(toolName, mode)
    };
  }

  // Handle MCP tools - allow read-only, block write operations
  if (toolName.startsWith('mcp__')) {
    // Always allow preferences tools
    if (toolName.startsWith('mcp__preferences__')) {
      return { allowed: true };
    }

    if (isReadOnlyMcpTool(toolName, mode)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `MCP write operations are blocked in ${config.displayName}. Exit ${config.displayName} (${config.shortcutHint}) to make changes.`
    };
  }

  // Handle API tools - allow GET, block mutations
  if (toolName.startsWith('api_')) {
    const input = toolInput as Record<string, unknown> | null;
    const method = (input?.method as string) || 'GET';
    if (isReadOnlyApiMethod(method, mode)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `API mutations are blocked in ${config.displayName}. Exit ${config.displayName} (${config.shortcutHint}) to make changes.`
    };
  }

  // Default: allow other tools not explicitly handled
  return { allowed: true };
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

/**
 * Create a hook return value that blocks a tool.
 * Returns the correct SDK format for PreToolUse hook blocking.
 *
 * @param reason - The reason for blocking (from shouldAllowToolInMode)
 */
export function blockWithReason(reason: string) {
  return {
    continue: false,
    decision: 'block' as const,
    reason,
  };
}

// ============================================================
// Mode Context (for user messages)
// ============================================================

/**
 * All possible modes - used for explicit state reporting.
 * Add new modes here as they're implemented.
 */
const ALL_MODES: Mode[] = ['safe'];

/**
 * Get the current state of all modes for a session.
 * Returns an object with all modes and their active/inactive state.
 * This ensures the model always knows the explicit state of every mode.
 */
export function getSessionState(sessionId: string): Record<Mode, boolean> {
  const activeModes = new Set(getActiveModes(sessionId));
  return Object.fromEntries(
    ALL_MODES.map(mode => [mode, activeModes.has(mode)])
  ) as Record<Mode, boolean>;
}

/**
 * Format session state as a lightweight XML block for injection into user messages.
 * Always includes all modes with their current state (true/false).
 * This replaces the verbose getModeContext() for per-message injection.
 */
export function formatSessionState(sessionId: string): string {
  const state = getSessionState(sessionId);
  const lines = Object.entries(state)
    .map(([mode, active]) => `${mode}: ${active}`)
    .join('\n');
  return `<session_state>\n${lines}\n</session_state>`;
}

/**
 * @deprecated Use formatSessionState() instead for lightweight per-message injection.
 * This verbose format is kept for backwards compatibility but should not be used.
 *
 * Generate verbose context for all active modes to inject into user messages.
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

You will know you're in Safe Mode when you see \`<session_state>\` with \`safe: true\` in your context.

### When Safe Mode is Active

| Operation | Allowed? | Notes |
|-----------|----------|-------|
| Ask user questions | ✅ | Normal conversation |
| Read Craft documents | ✅ | blocks_get, document_search, etc. |
| List Craft structure | ✅ | folders_list, documents_list |
| File exploration | ✅ | Read, Glob, Grep |
| Web search/fetch | ✅ | WebSearch, WebFetch |
| API GET requests | ✅ | Read-only API calls |
| **Plans folder** | ✅ | Write/Edit allowed to session plans folder |
| **Read-only Bash** | ✅ | ls, cat, git status, grep, etc. |
| File writes/edits | ❌ | ${blockedTools} blocked (except plans folder) |
| Craft modifications | ❌ | blocks_add, blocks_update blocked |
| API mutations | ❌ | POST, PUT, DELETE blocked |

### Bash Commands in Safe Mode

Many read-only bash commands work in Safe Mode:
- **File inspection**: ls, cat, head, tail, tree, find, grep, file, stat
- **Git read ops**: git status, git log, git diff, git branch, git show
- **System info**: pwd, whoami, date, env, ps, uname
- **Package info**: npm list, pip list, cargo tree

**If unsure whether a command is allowed, try it.** The system will block non-read-only commands and explain what happened. You don't need to ask permission first.

### Plans Folder Exception

You CAN use Write, Edit, and MultiEdit to create/modify files in the session's plans folder (\`~/.craft-agent/sessions/{sessionId}/plans/\`). This allows SubmitPlan to work in Safe Mode for creating structured plans.

### Exiting Safe Mode

The user toggles Safe Mode via the UI (${config.shortcutHint} or badge). You cannot enter or exit Safe Mode - only the user can.

When the user exits Safe Mode, you can proceed with any operations they've requested.`;
}

