import { query, createSdkMcpServer, tool, AbortError, type Query, type SDKMessage, type SDKUserMessage, type SDKAssistantMessageError, type Options } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from './options.ts';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { z } from 'zod';
import { getSystemPrompt, getDateTimeContext, getWorkingDirectoryContext } from '../prompts/system.ts';
// Plan types are used by UI components; not needed in craft-agent.ts since Safe Mode is user-controlled
import { parseError, type AgentError } from './errors.ts';
import { runErrorDiagnostics } from './diagnostics.ts';
import { loadStoredConfig, loadConfigDefaults, getAnthropicBaseUrl, resolveModelId, type Workspace } from '../config/storage.ts';
import { isLocalMcpEnabled } from '../workspaces/storage.ts';
import { loadPlanFromPath, type SessionConfig as Session } from '../sessions/storage.ts';
import { DEFAULT_MODEL, isClaudeModel } from '../config/models.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { updatePreferences, loadPreferences, formatPreferencesForPrompt, type UserPreferences } from '../config/preferences.ts';
import type { FileAttachment } from '../utils/files.ts';
import { debug } from '../utils/debug.ts';
import {
  getSessionPlansDir,
  getLastPlanFilePath,
  clearPlanFileState,
  registerSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
  getSessionScopedTools,
  cleanupSessionScopedTools,
  type AuthRequest,
} from './session-scoped-tools.ts';
import {
  getPermissionMode,
  setPermissionMode,
  cyclePermissionMode,
  initializeModeState,
  cleanupModeState,
  formatSessionState,
  shouldAllowToolInMode,
  blockWithReason,
  isApiEndpointAllowed,
  type PermissionMode,
  PERMISSION_MODE_CONFIG,
  SAFE_MODE_CONFIG,
} from './mode-manager.ts';
import { type PermissionsContext, permissionsConfigCache } from './permissions-config.ts';
import { getSessionPlansPath, getSessionPath } from '../sessions/storage.ts';
import { readFileSync } from 'fs';
import { expandPath } from '../utils/paths.ts';
import {
  ConfigWatcher,
  createConfigWatcher,
  type ConfigWatcherCallbacks,
} from '../config/watcher.ts';
import type { ValidationIssue } from '../config/validators.ts';
import { detectConfigFileType, validateConfigFileContent, formatValidationResult } from '../config/validators.ts';
import { type ThinkingLevel, getThinkingTokens, DEFAULT_THINKING_LEVEL } from './thinking-levels.ts';
import type { LoadedSource } from '../sources/types.ts';
import { sourceNeedsAuthentication } from '../sources/credential-manager.ts';

// Re-export permission mode functions for application usage
export {
  // Permission mode API
  getPermissionMode,
  setPermissionMode,
  cyclePermissionMode,
  subscribeModeChanges,
  type PermissionMode,
  PERMISSION_MODE_ORDER,
  PERMISSION_MODE_CONFIG,
} from './mode-manager.ts';
// Documentation is served via local files at ~/.craft-agent/docs/

// Import and re-export AgentEvent from core (single source of truth)
import type { AgentEvent } from '@craft-agent/core/types';
export type { AgentEvent };

// Re-export types for UI components
export type { LoadedSource } from '../sources/types.ts';

/**
 * Reason for aborting agent execution.
 * Used to distinguish user-initiated stops from internal aborts.
 */
export enum AbortReason {
  /** User clicked stop button */
  UserStop = 'user_stop',
  /** Agent submitted a plan and is awaiting review */
  PlanSubmitted = 'plan_submitted',
  /** Agent requested authentication and is awaiting user input */
  AuthRequest = 'auth_request',
  /** New message sent while processing (silent redirect) */
  Redirect = 'redirect',
  /** Source was auto-activated mid-turn (silent, auto-retry follows) */
  SourceActivated = 'source_activated',
}

/**
 * Message type for recovery context building.
 * Simplified from StoredMessage - only what's needed for context injection.
 */
export interface RecoveryMessage {
  type: 'user' | 'assistant';
  content: string;
}

export interface CraftAgentConfig {
  workspace: Workspace;
  session?: Session;           // Current session (primary isolation boundary)
  mcpToken?: string;           // Override token (for testing)
  model?: string;
  thinkingLevel?: ThinkingLevel; // Initial thinking level (defaults to 'think')
  onSdkSessionIdUpdate?: (sdkSessionId: string) => void;  // Callback when SDK session ID is captured
  onSdkSessionIdCleared?: () => void;  // Callback when SDK session ID is cleared (e.g., after failed resume)
  /**
   * Callback to get recent messages for recovery context.
   * Called when SDK resume fails and we need to inject previous conversation context into retry.
   * Returns last N user/assistant message pairs for context injection.
   */
  getRecoveryMessages?: () => RecoveryMessage[];
  isHeadless?: boolean;        // Running in headless mode (disables interactive tools)
  debugMode?: {                // Debug mode configuration (when running in dev)
    enabled: boolean;          // Whether debug mode is active
    logFilePath?: string;      // Path to the log file for querying
  };
}

// Permission request tracking
interface PendingPermission {
  resolve: (allowed: boolean, alwaysAllow?: boolean) => void;
  toolName: string;
  command: string;
  baseCommand: string;
  type?: 'bash' | 'safe_mode';  // Type of permission request
}

// Dangerous commands that should always require permission (never auto-allow)
const DANGEROUS_COMMANDS = new Set([
  'rm', 'rmdir', 'sudo', 'su', 'chmod', 'chown', 'chgrp',
  'mv', 'cp', 'dd', 'mkfs', 'fdisk', 'parted',
  'kill', 'killall', 'pkill',
  'reboot', 'shutdown', 'halt', 'poweroff',
  'curl', 'wget', 'ssh', 'scp', 'rsync',
  'git push', 'git reset', 'git rebase', 'git checkout',
]);

// ============================================================
// Global Tool Permission System
// Used by both bash commands (via agent instance) and MCP tools (via global functions)
// ============================================================

interface GlobalPendingPermission {
  resolve: (allowed: boolean) => void;
  toolName: string;
  command: string;
}

const globalPendingPermissions = new Map<string, GlobalPendingPermission>();

// Handler set by application to receive permission requests
let globalPermissionHandler: ((request: { requestId: string; toolName: string; command: string; description: string }) => void) | null = null;

/**
 * Set the global permission request handler (called by application)
 */
export function setGlobalPermissionHandler(
  handler: ((request: { requestId: string; toolName: string; command: string; description: string }) => void) | null
): void {
  globalPermissionHandler = handler;
}

/**
 * Request permission for a tool operation (used by MCP tools)
 * Returns a promise that resolves to true if allowed, false if denied
 */
export function requestToolPermission(
  toolName: string,
  command: string,
  description: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const requestId = `perm-${toolName}-${Date.now()}`;

    globalPendingPermissions.set(requestId, {
      resolve,
      toolName,
      command,
    });

    if (globalPermissionHandler) {
      globalPermissionHandler({ requestId, toolName, command, description });
    } else {
      // No handler - deny by default
      globalPendingPermissions.delete(requestId);
      resolve(false);
    }
  });
}

/**
 * Resolve a pending global permission request (called by application)
 */
export function resolveGlobalPermission(requestId: string, allowed: boolean): void {
  const pending = globalPendingPermissions.get(requestId);
  if (pending) {
    pending.resolve(allowed);
    globalPendingPermissions.delete(requestId);
  }
}

/**
 * Clear all pending global permissions (called on workspace switch)
 */
export function clearGlobalPermissions(): void {
  globalPendingPermissions.clear();
}

// Handle preferences update (extracted for use in MCP tool)
function handleUpdatePreferences(input: Record<string, unknown>): string {
  const updates: Partial<UserPreferences> = {};

  if (input.name && typeof input.name === 'string') {
    updates.name = input.name;
  }
  if (input.timezone && typeof input.timezone === 'string') {
    updates.timezone = input.timezone;
  }
  if (input.language && typeof input.language === 'string') {
    updates.language = input.language;
  }

  // Handle location fields
  if (input.city || input.region || input.country) {
    updates.location = {};
    if (input.city && typeof input.city === 'string') {
      updates.location.city = input.city;
    }
    if (input.region && typeof input.region === 'string') {
      updates.location.region = input.region;
    }
    if (input.country && typeof input.country === 'string') {
      updates.location.country = input.country;
    }
  }

  // Handle notes (append to existing)
  if (input.notes && typeof input.notes === 'string') {
    const current = loadPreferences();
    const existingNotes = current.notes || '';
    const newNote = input.notes;
    updates.notes = existingNotes
      ? `${existingNotes}\n- ${newNote}`
      : `- ${newNote}`;
  }

  // Check if anything was actually updated
  const fields = Object.keys(updates).filter(k => k !== 'location');
  if (updates.location) {
    fields.push(...Object.keys(updates.location).map(k => `location.${k}`));
  }

  if (fields.length === 0) {
    return 'No preferences were updated (no valid fields provided)';
  }

  updatePreferences(updates);
  return `Updated user preferences: ${fields.join(', ')}`;
}


// Base tool: update_user_preferences (always available)
const updateUserPreferencesTool = tool(
  'update_user_preferences',
  `Update stored user preferences. Use this when you learn information about the user that would be helpful to remember for future conversations. This includes their name, timezone, location, preferred language, or any other relevant notes. Only update fields you have confirmed information about - don't guess.`,
  {
    name: z.string().optional().describe("The user's preferred name or how they'd like to be addressed"),
    timezone: z.string().optional().describe("The user's timezone in IANA format (e.g., 'America/New_York', 'Europe/London')"),
    city: z.string().optional().describe("The user's city"),
    region: z.string().optional().describe("The user's state/region/province"),
    country: z.string().optional().describe("The user's country"),
    language: z.string().optional().describe("The user's preferred language for responses"),
    notes: z.string().optional().describe('Additional notes about the user that would be helpful to remember (preferences, context, etc.). This appends to existing notes.'),
  },
  async (args) => {
    try {
      const result = handleUpdatePreferences(args);
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: `Failed to update preferences: ${message}` }],
        isError: true,
      };
    }
  }
);

// Cached MCP server for preferences
let cachedPrefToolsServer: ReturnType<typeof createSdkMcpServer> | null = null;

// Preferences MCP server - user preferences tool
function getPreferencesServer(_unused?: boolean): ReturnType<typeof createSdkMcpServer> {
  if (!cachedPrefToolsServer) {
    cachedPrefToolsServer = createSdkMcpServer({
      name: 'preferences',
      version: '1.0.0',
      tools: [updateUserPreferencesTool],
    });
  }
  return cachedPrefToolsServer;
}

/**
 * SDK-compatible MCP server configuration.
 * Supports HTTP/SSE (remote) and stdio (local subprocess) transports.
 */
export type SdkMcpServerConfig =
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> };

/**
 * Detect the Windows ENOENT .claude/skills directory error from the Claude Code SDK.
 * The SDK scans C:\ProgramData\ClaudeCode\.claude\skills for managed/enterprise skills
 * but crashes if the directory doesn't exist. This is an upstream SDK bug.
 * See: https://github.com/anthropics/claude-code/issues/20571
 *
 * Returns a typed_error event with user-friendly instructions, or null if not this error.
 */
function buildWindowsSkillsDirError(errorText: string): { type: 'typed_error'; error: AgentError } | null {
  if (!errorText.includes('ENOENT') || !errorText.includes('skills')) {
    return null;
  }

  const pathMatch = errorText.match(/scandir\s+'([^']+)'/);
  const missingPath = pathMatch?.[1] || 'C:\\ProgramData\\ClaudeCode\\.claude\\skills';

  return {
    type: 'typed_error',
    error: {
      code: 'unknown_error',
      title: 'Windows Setup Required',
      message: `The SDK requires a directory that doesn't exist: ${missingPath} — Create this folder in File Explorer, then restart the app.`,
      details: [
        `PowerShell (run as Administrator):`,
        `New-Item -ItemType Directory -Force -Path "${missingPath}"`,
      ],
      actions: [],
      canRetry: true,
      originalError: errorText,
    },
  };
}

export class CraftAgent {
  private config: CraftAgentConfig;
  private currentQuery: Query | null = null;
  private currentQueryAbortController: AbortController | null = null;
  private lastAbortReason: AbortReason | null = null;
  private sessionId: string | null = null;
  private isHeadless: boolean = false;
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private alwaysAllowedCommands: Set<string> = new Set(); // Base commands allowed for this session (e.g., "ls", "cat")
  private alwaysAllowedDomains: Set<string> = new Set(); // Domains allowed for curl/wget (session-scoped)
  // Pre-built source server configs (user-defined sources, separate from agent)
  // Supports both HTTP/SSE and stdio transports
  private sourceMcpServers: Record<string, SdkMcpServerConfig> = {};
  // In-process MCP servers for source API integrations
  private sourceApiServers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};
  // Set of active source server names (for blocking disabled sources)
  private activeSourceServerNames: Set<string> = new Set();
  // Set of intended active source slugs (what UI shows as active, may differ from activeSourceServerNames if build fails)
  private intendedActiveSlugs: Set<string> = new Set();
  // Full list of all sources in workspace (for context injection)
  private allSources: LoadedSource[] = [];
  // Sources already introduced to agent this session (for incremental context)
  private knownSourceSlugs: Set<string> = new Set();
  // Temporary clarifications (not yet saved to Craft document)
  private temporaryClarifications: string | null = null;
  // Safe mode state - user-controlled read-only exploration mode
  private safeMode: boolean = false;
  // SDK tools list (captured from init message)
  private sdkTools: string[] = [];
  // Session-level thinking level ('off', 'think', 'max') - sticky, persisted
  private thinkingLevel: ThinkingLevel = 'think';
  // Ultrathink override - when true, boosts to max thinking for one message (resets after query)
  private ultrathinkOverride: boolean = false;
  // Config file watcher for hot-reloading source changes
  private configWatcher: ConfigWatcher | null = null;
  // Pinned system prompt components (captured on first chat, used for consistency after compaction)
  private pinnedPreferencesPrompt: string | null = null;
  // Track if preference drift notification has been shown this session
  private preferencesDriftNotified: boolean = false;
  // Captured stderr from SDK subprocess (for error diagnostics when process exits with code 1)
  private lastStderrOutput: string[] = [];
  // Last assistant message usage (for accurate context window display)
  // result.modelUsage is cumulative across the session (for billing), but we need per-message usage
  // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/66
  private lastAssistantUsage: {
    input_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  } | null = null;
  // Cached context window size from modelUsage (for real-time usage_update events)
  // This is captured from the first result message and reused for subsequent usage updates
  private cachedContextWindow?: number;

  /**
   * Get the session ID for mode operations.
   * Returns a temp ID if no session is configured (shouldn't happen in practice).
   */
  private get modeSessionId(): string {
    return this.config.session?.id || `temp-${Date.now()}`;
  }

  /**
   * Get the workspace root path for workspace-scoped operations.
   */
  private get workspaceRootPath(): string {
    return this.config.workspace.rootPath;
  }

  // Callback for permission requests - set by application to receive permission prompts
  public onPermissionRequest: ((request: { requestId: string; toolName: string; command: string; description: string; type?: 'bash' }) => void) | null = null;

  // Debug callback for status messages
  public onDebug: ((message: string) => void) | null = null;

  /** Callback when permission mode changes */
  public onPermissionModeChange: ((mode: PermissionMode) => void) | null = null;

  // Callback when a plan is submitted - set by application to display plan message
  public onPlanSubmitted: ((planPath: string) => void) | null = null;

  // Callback when authentication is requested (unified auth flow)
  // This follows the SubmitPlan pattern:
  // 1. Tool calls onAuthRequest
  // 2. Session manager creates auth-request message and calls forceAbort
  // 3. User completes auth in UI
  // 4. Auth result is sent as a "faked user message"
  // 5. Agent resumes and processes the result
  public onAuthRequest: ((request: AuthRequest) => void) | null = null;

  // Callback when a source config changes (hot-reload from file watcher)
  public onSourceChange: ((slug: string, source: LoadedSource | null) => void) | null = null;

  // Callback when the sources list changes (add/remove)
  public onSourcesListChange: ((sources: LoadedSource[]) => void) | null = null;

  // Callback when config file validation fails
  public onConfigValidationError: ((file: string, errors: ValidationIssue[]) => void) | null = null;

  // Callback when a source tool is called but the source isn't enabled in the session.
  // The callback should enable the source and return true if successful, false otherwise.
  // This enables auto-enabling sources when the agent tries to use their tools.
  public onSourceActivationRequest: ((sourceSlug: string) => Promise<boolean>) | null = null;

  constructor(config: CraftAgentConfig) {
    // Resolve model: prioritize session model > config model > DEFAULT_MODEL
    const model = config.session?.model ?? config.model ?? DEFAULT_MODEL;
    this.config = { ...config, model };
    this.isHeadless = config.isHeadless ?? false;

    // Log which model is being used (helpful for debugging custom models)
    debug(`[CraftAgent] Using model: ${model}`);

    // Initialize thinking level from config (defaults to 'think' from class initialization)
    if (config.thinkingLevel) {
      this.thinkingLevel = config.thinkingLevel;
    }

    // Initialize sessionId from session config for conversation resumption
    if (config.session?.sdkSessionId) {
      this.sessionId = config.session.sdkSessionId;
    }

    // Initialize permission mode state with callbacks
    const sessionId = this.modeSessionId;
    // Get initial mode: from session, or from global default
    const globalDefaults = loadConfigDefaults();
    const initialMode: PermissionMode = config.session?.permissionMode ?? globalDefaults.workspaceDefaults.permissionMode;

    initializeModeState(sessionId, initialMode, {
      onStateChange: (state) => {
        // Sync permission mode state with agent
        this.safeMode = state.permissionMode === 'safe';
        // Notify UI of permission mode changes
        this.onPermissionModeChange?.(state.permissionMode);
      },
    });

    // Register session-scoped tool callbacks
    registerSessionScopedToolCallbacks(sessionId, {
      onPlanSubmitted: (planPath) => {
        this.onDebug?.(`[CraftAgent] onPlanSubmitted received: ${planPath}`);
        this.onPlanSubmitted?.(planPath);
      },
      onAuthRequest: (request) => {
        this.onDebug?.(`[CraftAgent] onAuthRequest received: ${request.sourceSlug} (type: ${request.type})`);
        this.onAuthRequest?.(request);
      },
    });

    // Start config watcher for hot-reloading source changes
    // Only start in non-headless mode to avoid overhead in batch/script scenarios
    if (!this.isHeadless) {
      this.startConfigWatcher();
    }
  }

  /**
   * Start the config file watcher for hot-reloading changes.
   */
  private startConfigWatcher(): void {
    if (this.configWatcher) {
      return; // Already running
    }

    this.configWatcher = createConfigWatcher(this.workspaceRootPath, {
      onSourceChange: (slug, source) => {
        debug('[CraftAgent] Source changed:', slug, source ? 'updated' : 'deleted');
        this.onSourceChange?.(slug, source);
      },
      onSourcesListChange: (sources) => {
        debug('[CraftAgent] Sources list changed:', sources.length);
        this.onSourcesListChange?.(sources);
      },
      onValidationError: (file, result) => {
        debug('[CraftAgent] Config validation error:', file, result.errors);
        this.onConfigValidationError?.(file, result.errors);
      },
      onError: (file, error) => {
        debug('[CraftAgent] Config file error:', file, error.message);
      },
    });

    debug('[CraftAgent] Config watcher started');
  }

  /**
   * Stop the config file watcher.
   */
  private stopConfigWatcher(): void {
    if (this.configWatcher) {
      this.configWatcher.stop();
      this.configWatcher = null;
      debug('[CraftAgent] Config watcher stopped');
    }
  }

  /**
   * Handle a source config update from the file watcher.
   * Updates internal MCP/API server state when a source changes.
   */
  private handleSourceUpdate(slug: string, source: LoadedSource | null): void {
    if (!source) {
      // Source was deleted - remove from active servers
      delete this.sourceMcpServers[slug];
      delete this.sourceApiServers[slug];
      this.activeSourceServerNames.delete(slug);
      debug('[CraftAgent] Removed source:', slug);
      return;
    }

    // Source was updated - check if we need to update server state
    if (!source.config.enabled) {
      // Disabled - remove from active servers
      delete this.sourceMcpServers[slug];
      delete this.sourceApiServers[slug];
      this.activeSourceServerNames.delete(slug);
      debug('[CraftAgent] Disabled source:', slug);
    } else {
      // Enabled - add to active servers (will be rebuilt on next query)
      this.activeSourceServerNames.add(slug);
      debug('[CraftAgent] Enabled source:', slug);
      // Note: Actual MCP/API server configs are rebuilt in getOptions()
      // This just marks the source as active for the next run
    }
  }

  /**
   * Set the session-level thinking level.
   * This is sticky and persisted across messages.
   */
  setThinkingLevel(level: ThinkingLevel): void {
    this.thinkingLevel = level;
    this.onDebug?.(`[CraftAgent] Thinking level: ${level}`);
  }

  /**
   * Get the current session-level thinking level.
   */
  getThinkingLevel(): ThinkingLevel {
    return this.thinkingLevel;
  }

  /**
   * Enable or disable ultrathink override (per-message boost to max thinking).
   * When enabled, overrides thinkingLevel to 'max' for one message only.
   * Resets to false after query completes.
   */
  setUltrathinkOverride(enabled: boolean): void {
    this.ultrathinkOverride = enabled;
    this.onDebug?.(`[CraftAgent] Ultrathink override: ${enabled ? 'ENABLED' : 'disabled'}`);
  }

  /**
   * Extract the base command from a bash command string
   * e.g., "ls -la /tmp" -> "ls", "git push origin main" -> "git push"
   */
  private getBaseCommand(command: string): string {
    const trimmed = command.trim();

    // Handle git subcommands specially (git push, git reset, etc.)
    if (trimmed.startsWith('git ')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        return `${parts[0]} ${parts[1]}`;
      }
    }

    // For other commands, just take the first word
    const firstWord = trimmed.split(/\s+/)[0] || trimmed;
    return firstWord;
  }

  /**
   * Check if a command is dangerous (should never be auto-allowed)
   */
  private isDangerousCommand(baseCommand: string): boolean {
    return DANGEROUS_COMMANDS.has(baseCommand);
  }

  /**
   * Extract domain from a curl/wget command
   * e.g., curl https://api.example.com/path -> "api.example.com"
   */
  private extractDomainFromNetworkCommand(command: string): string | null {
    const urlMatch = command.match(/https?:\/\/([^\/\s"']+)/i);
    return urlMatch?.[1] ?? null;
  }

  /**
   * Respond to a pending permission request
   */
  respondToPermission(requestId: string, allowed: boolean, alwaysAllow: boolean = false): void {
    this.onDebug?.(`respondToPermission: ${requestId}, allowed=${allowed}, alwaysAllow=${alwaysAllow}, pending=${this.pendingPermissions.has(requestId)}`);
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      this.onDebug?.(`Resolving permission promise for ${requestId}`);

      // If "always allow" was selected, remember it (with special handling for curl/wget)
      if (alwaysAllow && allowed) {
        if (['curl', 'wget'].includes(pending.baseCommand)) {
          // For curl/wget, whitelist the domain instead of the command
          const domain = this.extractDomainFromNetworkCommand(pending.command);
          if (domain) {
            this.alwaysAllowedDomains.add(domain);
            this.onDebug?.(`Added domain "${domain}" to always-allowed domains`);
          }
        } else if (!this.isDangerousCommand(pending.baseCommand)) {
          this.alwaysAllowedCommands.add(pending.baseCommand);
          this.onDebug?.(`Added "${pending.baseCommand}" to always-allowed commands`);
        }
      }

      pending.resolve(allowed);
      this.pendingPermissions.delete(requestId);
    } else {
      this.onDebug?.(`No pending permission found for ${requestId}`);
    }
  }

  // ============================================
  // Safe Mode Methods
  // ============================================

  /**
   * Check if currently in safe mode (read-only exploration)
   * Uses modeManager as single source of truth.
   */
  isInSafeMode(): boolean {
    return getPermissionMode(this.modeSessionId) === 'safe';
  }

  /**
   * Check if a task should trigger planning (heuristic)
   * Returns true for complex tasks that would benefit from planning
   */
  shouldSuggestPlanning(userMessage: string): boolean {
    const message = userMessage.toLowerCase();

    // Keywords that suggest complex tasks
    const complexKeywords = [
      'implement', 'create', 'build', 'develop', 'design',
      'refactor', 'migrate', 'upgrade', 'restructure',
      'add feature', 'new feature', 'integrate',
      'set up', 'setup', 'configure', 'install',
      'multiple', 'several', 'all', 'entire', 'whole',
    ];

    // Check for complex keywords
    const hasComplexKeyword = complexKeywords.some(keyword => message.includes(keyword));

    // Check message length (longer messages often indicate complex tasks)
    const isLongMessage = message.length > 200;

    // Check for multiple sentences (indicates multi-step task)
    const sentenceCount = message.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    const hasMultipleSentences = sentenceCount > 2;

    return hasComplexKeyword || isLongMessage || hasMultipleSentences;
  }

  /**
   * Check if a tool requires permission and handle it
   * Returns true if allowed, false if denied
   */
  private async checkToolPermission(
    toolName: string,
    input: Record<string, unknown>,
    toolUseId: string
  ): Promise<{ allowed: boolean; updatedInput: Record<string, unknown> }> {
    // Bash commands require permission
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : JSON.stringify(input);
      const baseCommand = command.trim().split(/\s+/)[0] || command;
      const requestId = `perm-${toolUseId}`;

      // Create a promise that will be resolved when user responds
      const permissionPromise = new Promise<boolean>((resolve) => {
        this.pendingPermissions.set(requestId, {
          resolve,
          toolName,
          command,
          baseCommand,
        });
      });

      // Notify application of permission request via callback (not event yield)
      if (this.onPermissionRequest) {
        this.onPermissionRequest({
          requestId,
          toolName,
          command,
          description: `Execute bash command: ${command}`,
        });
      } else {
        // No permission handler - deny by default for safety
        this.pendingPermissions.delete(requestId);
        return { allowed: false, updatedInput: input };
      }

      // Wait for user response
      const allowed = await permissionPromise;
      return { allowed, updatedInput: input };
    }

    // All other tools are auto-approved
    return { allowed: true, updatedInput: input };
  }

  private async getToken(): Promise<string | null> {
    // Only return token if explicitly provided via config
    // Sources handle their own authentication
    return this.config.mcpToken ?? null;
  }

  async *chat(
    userMessage: string,
    attachments?: FileAttachment[],
    _isRetry: boolean = false // Internal flag for session expiry retry
  ): AsyncGenerator<AgentEvent> {
    try {
      const sessionId = this.config.session?.id || `temp-${Date.now()}`;

      // Pin system prompt components on first chat() call for consistency after compaction
      // The SDK's resume mechanism expects system prompt consistency within a session
      const currentPreferencesPrompt = formatPreferencesForPrompt();

      if (this.pinnedPreferencesPrompt === null) {
        // First chat in this session - pin current values
        this.pinnedPreferencesPrompt = currentPreferencesPrompt;
        debug('[chat] Pinned system prompt components for session consistency');
      } else {
        // Detect drift: warn user if context has changed since session started
        const preferencesDrifted = currentPreferencesPrompt !== this.pinnedPreferencesPrompt;

        if (preferencesDrifted && !this.preferencesDriftNotified) {
          yield {
            type: 'info',
            message: `Note: Your preferences changed since this session started. Start a new session to apply changes.`,
          };
          this.preferencesDriftNotified = true;
          debug(`[chat] Detected drift in: preferences`);
        }
      }

      // Check if we have binary attachments that need the AsyncIterable interface
      const hasBinaryAttachments = attachments?.some(a => a.type === 'image' || a.type === 'pdf');

      // Validate we have something to send
      if (!userMessage.trim() && (!attachments || attachments.length === 0)) {
        yield { type: 'error', message: 'Cannot send empty message' };
        yield { type: 'complete' };
        return;
      }

      // Block SDK tools that require UI we don't have:
      // - EnterPlanMode/ExitPlanMode: We use safe mode instead (user-controlled via UI)
      // - AskUserQuestion: Requires interactive UI to show question options to user
      const disallowedTools: string[] = ['EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion'];

      // Build MCP servers config - always use HTTP (SDK handles sources efficiently)
      // Filter out stdio servers if local MCP is disabled
      const sourceMcpResult = this.getSourceMcpServersFiltered();

      debug('[chat] sourceMcpServers:', sourceMcpResult.servers);
      debug('[chat] sourceApiServers:', this.sourceApiServers);

      const mcpServers: Options['mcpServers'] = {
        preferences: getPreferencesServer(false),
        // Session-scoped tools (SubmitPlan, source_test, etc.)
        session: getSessionScopedTools(sessionId, this.workspaceRootPath),
        // Craft Agents documentation - always available for searching setup guides
        // This is a public Mintlify MCP server, no auth needed
        'craft-agents-docs': {
          type: 'http',
          url: 'https://agents.craft.do/docs/mcp',
        },
        // Add user-defined source servers (MCP and API, filtered by local MCP setting)
        // Note: Craft MCP server is now added via sources system
        ...sourceMcpResult.servers,
        ...this.sourceApiServers,
      };
      
      // Configure SDK options
      // Resolve model: use tier name when using custom API (OpenRouter), else specific version
      const modelConfig = this.config.model || DEFAULT_MODEL;
      const model = resolveModelId(modelConfig);

      // Log provider context for diagnostics (custom base URL = third-party provider)
      const activeBaseUrl = getAnthropicBaseUrl();
      if (activeBaseUrl) {
        debug(`[chat] Custom provider: baseUrl=${activeBaseUrl}, model=${model}, hasApiKey=${!!process.env.ANTHROPIC_API_KEY}`);
      }

      // Determine effective thinking level: ultrathink override boosts to max for this message
      const effectiveThinkingLevel: ThinkingLevel = this.ultrathinkOverride ? 'max' : this.thinkingLevel;
      const thinkingTokens = getThinkingTokens(effectiveThinkingLevel, modelConfig);
      debug(`[chat] Thinking: level=${this.thinkingLevel}, override=${this.ultrathinkOverride}, effective=${effectiveThinkingLevel}, tokens=${thinkingTokens}`);

      // NOTE: Parent-child tracking for subagents is documented below (search for
      // "PARENT-CHILD TOOL TRACKING"). The SDK's parent_tool_use_id is authoritative.

      // Clear stderr buffer at start of each query
      this.lastStderrOutput = [];

      // Detect if resolved model is Claude — non-Claude models (via OpenRouter/Ollama) don't
      // support Anthropic-specific betas or extended thinking parameters
      const isClaude = isClaudeModel(model);
      const useAnthropicBetas = isClaude;

      const options: Options = {
        ...getDefaultOptions(),
        model,
        // Capture stderr from SDK subprocess for error diagnostics
        // This helps identify why sessions fail with "process exited with code 1"
        stderr: (data: string) => {
          // Log to both debug file AND console for visibility
          debug('[SDK stderr]', data);
          console.error('[SDK stderr]', data);
          // Keep last 20 lines to avoid unbounded memory growth
          this.lastStderrOutput.push(data);
          if (this.lastStderrOutput.length > 20) {
            this.lastStderrOutput.shift();
          }
        },
        // Beta features (only when using direct Anthropic API, not OpenRouter/etc.)
        // - advanced-tool-use-2025-11-20: Enhanced tool use capabilities
        ...(useAnthropicBetas ? { betas: ['advanced-tool-use-2025-11-20'] as any } : {}),
        // Extended thinking: tokens based on effective thinking level (session level + ultrathink override)
        // Non-Claude models don't support extended thinking, so pass 0 to disable
        maxThinkingTokens: isClaude ? thinkingTokens : 0,
        // Option A: Append to Claude Code's system prompt (recommended by docs)
        // Use pinned values for consistency after compaction (SDK expects stable system prompt)
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          // Working directory included for monorepo context file discovery
          append: getSystemPrompt(
            this.pinnedPreferencesPrompt ?? undefined,
            this.config.debugMode,
            this.workspaceRootPath,
            this.config.session?.workingDirectory
          ),
        },
        // Use sdkCwd for SDK session storage - this is set once at session creation and never changes.
        // This ensures SDK can always find session transcripts regardless of workingDirectory changes.
        // Note: workingDirectory is still used for context injection and shown to the agent.
        cwd: this.config.session?.sdkCwd ??
          (sessionId ? getSessionPath(this.workspaceRootPath, sessionId) : this.workspaceRootPath),
        includePartialMessages: true,
        // Enable the full Claude Code toolset
        tools: { type: 'preset', preset: 'claude_code' },
        // Bypass SDK's built-in permission system - we handle all permissions via PreToolUse hook
        // This allows Safe Mode to properly allow read-only bash commands without SDK interference
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Use PreToolUse hook to intercept tool calls (plan mode blocking happens here)
        hooks: {
          PreToolUse: [{
            hooks: [async (input) => {
              // Only handle PreToolUse events
              if (input.hook_event_name !== 'PreToolUse') {
                return { continue: true };
              }

              // Get current permission mode (single source of truth)
              const permissionMode = getPermissionMode(sessionId);
              this.onDebug?.(`PreToolUse hook: ${input.tool_name} (permissionMode=${permissionMode})`);

              // ============================================================
              // PERMISSION MODE HANDLING
              // - 'safe': Block writes entirely (read-only mode)
              // - 'ask': Prompt for dangerous operations
              // - 'allow-all': Everything allowed, no prompts
              // ============================================================

              // Build permissions context for loading custom permissions.json files
              const permissionsContext: PermissionsContext = {
                workspaceRootPath: this.workspaceRootPath,
                activeSourceSlugs: Array.from(this.activeSourceServerNames),
              };

              // In 'allow-all' mode, still check for explicitly blocked tools
              if (permissionMode === 'allow-all') {
                const plansFolderPath = sessionId ? getSessionPlansPath(this.workspaceRootPath, sessionId) : undefined;
                const result = shouldAllowToolInMode(
                  input.tool_name,
                  input.tool_input,
                  'allow-all',
                  { plansFolderPath, permissionsContext }
                );

                if (!result.allowed) {
                  // Tool is explicitly blocked in permissions.json
                  this.onDebug?.(`Allow-all mode: blocking explicitly blocked tool ${input.tool_name}`);
                  return blockWithReason(result.reason);
                }

                this.onDebug?.(`Allow-all mode: allowing ${input.tool_name}`);
                // Fall through to source blocking and other checks below
              }

              // In 'ask' mode, still check for explicitly blocked tools
              if (permissionMode === 'ask') {
                const plansFolderPath = sessionId ? getSessionPlansPath(this.workspaceRootPath, sessionId) : undefined;
                const result = shouldAllowToolInMode(
                  input.tool_name,
                  input.tool_input,
                  'ask',
                  { plansFolderPath, permissionsContext }
                );

                if (!result.allowed) {
                  // Tool is explicitly blocked in permissions.json
                  this.onDebug?.(`Ask mode: blocking explicitly blocked tool ${input.tool_name}`);
                  return blockWithReason(result.reason);
                }
                // Don't return here - fall through to other checks (like prompting for permission)
              }

              // In 'safe' mode, check against read-only allowlist
              if (permissionMode === 'safe') {
                const plansFolderPath = sessionId ? getSessionPlansPath(this.workspaceRootPath, sessionId) : undefined;
                const result = shouldAllowToolInMode(
                  input.tool_name,
                  input.tool_input,
                  'safe',
                  { plansFolderPath, permissionsContext }
                );

                if (!result.allowed) {
                  // In safe mode, always block without prompting
                  this.onDebug?.(`Safe mode: blocking ${input.tool_name}`);
                  return blockWithReason(result.reason);
                }

                this.onDebug?.(`Allowed in safe mode: ${input.tool_name}`);
                // Fall through to source blocking and other checks below
              }

              // ============================================================
              // SOURCE BLOCKING & AUTO-ENABLE: Handle tools from sources
              // Sources can be disabled mid-conversation, so we check
              // against the current active source set on each tool call.
              // If a source exists but isn't enabled, try to auto-enable it.
              // ============================================================
              if (input.tool_name.startsWith('mcp__')) {
                // Extract server name from tool name (mcp__<server>__<tool>)
                const parts = input.tool_name.split('__');
                const serverName = parts[1];
                if (parts.length >= 3 && serverName) {
                  // Built-in MCP servers that are always available (not user sources)
                  // - preferences: user preferences storage
                  // - session: session-scoped tools (SubmitPlan, source_test, etc.)
                  // - craft-agents-docs: always-available documentation search
                  const builtInMcpServers = new Set(['preferences', 'session', 'craft-agents-docs']);

                  // Check if this is a source server (not built-in)
                  if (!builtInMcpServers.has(serverName)) {
                    // Check if source server is active
                    const isActive = this.activeSourceServerNames.has(serverName);
                    if (!isActive) {
                      // Check if this source exists in workspace (just not enabled in session)
                      const sourceExists = this.allSources.some(s => s.config.slug === serverName);

                      if (sourceExists && this.onSourceActivationRequest) {
                        // Try to auto-enable the source
                        this.onDebug?.(`Source "${serverName}" not active, attempting auto-enable...`);
                        try {
                          const activated = await this.onSourceActivationRequest(serverName);
                          if (activated) {
                            this.onDebug?.(`Source "${serverName}" auto-enabled successfully, tools available next turn`);
                            // Source was activated but the SDK was started with old server list.
                            // The tools will only be available on the NEXT chat() call.
                            // Return an imperative message to make the model stop and respond.
                            return {
                              continue: false,
                              decision: 'block' as const,
                              reason: `STOP. Source "${serverName}" has been activated successfully. The tools will be available on the next turn. Do NOT try other tool names or approaches. Respond to the user now: tell them the source is now active and ask them to send their request again.`,
                            };
                          } else {
                            // Activation failed (e.g., needs auth)
                            this.onDebug?.(`Source "${serverName}" auto-enable failed (may need authentication)`);
                            return {
                              continue: false,
                              decision: 'block' as const,
                              reason: `Source "${serverName}" could not be activated. It may require authentication. Please check the source status and authenticate if needed.`,
                            };
                          }
                        } catch (error) {
                          this.onDebug?.(`Source "${serverName}" auto-enable error: ${error}`);
                          return {
                            continue: false,
                            decision: 'block' as const,
                            reason: `Failed to activate source "${serverName}": ${error instanceof Error ? error.message : 'Unknown error'}`,
                          };
                        }
                      } else if (sourceExists) {
                        // Source exists but no activation handler - just inform
                        this.onDebug?.(`BLOCKED source tool: ${input.tool_name} (source "${serverName}" exists but is not enabled)`);
                        return {
                          continue: false,
                          decision: 'block' as const,
                          reason: `Source "${serverName}" is available but not enabled for this session. Please enable it in the sources panel.`,
                        };
                      } else {
                        // Source doesn't exist or can't be connected
                        this.onDebug?.(`BLOCKED source tool: ${input.tool_name} (source "${serverName}" does not exist)`);
                        return {
                          continue: false,
                          decision: 'block' as const,
                          reason: `Source "${serverName}" could not be connected. It may need re-authentication, or the server may be unreachable. Check the source in the sidebar for details.`,
                        };
                      }
                    }
                  }
                }
              }

              // ============================================================
              // PATH EXPANSION: Expand ~ in file paths for SDK file tools
              // Node.js fs doesn't expand ~ so we must do it ourselves
              // ============================================================
              const filePathTools = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'NotebookEdit']);
              if (filePathTools.has(input.tool_name)) {
                const toolInput = input.tool_input as Record<string, unknown>;
                let updatedInput: Record<string, unknown> | null = null;

                // Expand file_path if present and starts with ~
                if (typeof toolInput.file_path === 'string' && toolInput.file_path.startsWith('~')) {
                  const expandedPath = expandPath(toolInput.file_path);
                  this.onDebug?.(`Expanding path: ${toolInput.file_path} → ${expandedPath}`);
                  updatedInput = { ...toolInput, file_path: expandedPath };
                }

                // Expand notebook_path if present and starts with ~
                if (typeof toolInput.notebook_path === 'string' && toolInput.notebook_path.startsWith('~')) {
                  const expandedPath = expandPath(toolInput.notebook_path);
                  this.onDebug?.(`Expanding notebook path: ${toolInput.notebook_path} → ${expandedPath}`);
                  updatedInput = { ...(updatedInput || toolInput), notebook_path: expandedPath };
                }

                // Expand path if present and starts with ~ (for Glob, Grep)
                if (typeof toolInput.path === 'string' && toolInput.path.startsWith('~')) {
                  const expandedPath = expandPath(toolInput.path);
                  this.onDebug?.(`Expanding search path: ${toolInput.path} → ${expandedPath}`);
                  updatedInput = { ...(updatedInput || toolInput), path: expandedPath };
                }

                // ============================================================
                // CONFIG FILE VALIDATION: For Write/Edit to workspace config files,
                // validate the content before allowing the write to proceed.
                // This prevents invalid configs from ever reaching disk.
                // Validates: sources/*/config.json, skills/*/SKILL.md,
                //            statuses/config.json, permissions.json
                // ============================================================
                const configWriteTools = new Set(['Write', 'Edit']);
                if (configWriteTools.has(input.tool_name)) {
                  // Resolve the final file path (after any ~ expansion)
                  const resolvedPath = (updatedInput?.file_path ?? toolInput.file_path) as string | undefined;

                  if (resolvedPath) {
                    const detection = detectConfigFileType(resolvedPath, this.workspaceRootPath);

                    if (detection) {
                      let contentToValidate: string | null = null;

                      if (input.tool_name === 'Write') {
                        // For Write, the full file content is in tool_input.content
                        contentToValidate = toolInput.content as string;
                      } else if (input.tool_name === 'Edit') {
                        // For Edit, simulate the replacement on the current file content
                        try {
                          const currentContent = readFileSync(resolvedPath, 'utf-8');
                          const oldString = toolInput.old_string as string;
                          const newString = toolInput.new_string as string;
                          const replaceAll = toolInput.replace_all as boolean | undefined;
                          contentToValidate = replaceAll
                            ? currentContent.replaceAll(oldString, newString)
                            : currentContent.replace(oldString, newString);
                        } catch {
                          // File doesn't exist yet or can't be read — skip validation
                          // (Write tool will create it; Edit will fail on its own)
                        }
                      }

                      if (contentToValidate) {
                        const validationResult = validateConfigFileContent(detection, contentToValidate);
                        if (validationResult && !validationResult.valid) {
                          this.onDebug?.(`Config validation blocked ${input.tool_name} to ${detection.displayFile}: ${validationResult.errors.length} errors`);
                          return {
                            continue: false,
                            decision: 'block' as const,
                            reason: `Cannot write invalid config to ${detection.displayFile}.\n\n${formatValidationResult(validationResult)}\n\nFix the errors above and try again.`,
                          };
                        }
                      }
                    }
                  }
                }

                // If any path was expanded, return updated input
                if (updatedInput) {
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      updatedInput,
                    },
                  };
                }
              }

              // ============================================================
              // SKILL QUALIFICATION: Ensure skill names are fully-qualified (workspaceId:slug)
              // The SDK requires fully-qualified names to resolve skills. If the agent
              // calls a skill with just the short slug, we prefix it here.
              // Phase 1 (UI layer) should already inject the full name in rawText, but this
              // provides defense-in-depth for edge cases where agent calls Skill directly.
              // ============================================================
              if (input.tool_name === 'Skill') {
                const toolInput = input.tool_input as { skill?: string; args?: string };
                if (toolInput.skill && !toolInput.skill.includes(':')) {
                  // Short name detected - prepend workspaceId
                  const workspaceId = this.config.workspace.id;
                  const qualifiedSkill = `${workspaceId}:${toolInput.skill}`;
                  this.onDebug?.(`Skill tool: qualified "${toolInput.skill}" → "${qualifiedSkill}"`);
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      updatedInput: { ...toolInput, skill: qualifiedSkill },
                    },
                  };
                }
              }

              // Built-in SDK tools (don't extract _intent from these)
              const builtInTools = new Set([
                'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
                'WebFetch', 'WebSearch', 'Task', 'TaskOutput',
                'TodoWrite', 'MultiEdit', 'NotebookEdit', 'KillShell',
                'SubmitPlan', 'Skill', 'SlashCommand',
              ]);

              // Strip _intent and _displayName metadata from MCP tool inputs before forwarding
              // These fields are for UI display only, not for the actual MCP server
              if (!builtInTools.has(input.tool_name)) {
                const toolInput = input.tool_input as Record<string, unknown>;
                const hasMetadata = '_intent' in toolInput || '_displayName' in toolInput;

                if (hasMetadata) {
                  const { _intent, _displayName, ...cleanInput } = toolInput;
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      updatedInput: cleanInput,
                    },
                  };
                }
              }

              // ============================================================
              // ASK MODE: Prompt for permission on dangerous operations
              // In 'safe' mode, these are blocked by shouldAllowToolInMode above
              // In 'allow-all' mode, permission checks are skipped entirely
              // ============================================================

              // Helper to request permission and wait for response
              const requestPermission = async (
                toolUseId: string,
                toolName: string,
                command: string,
                baseCommand: string,
                description: string
              ): Promise<{ allowed: boolean }> => {
                const requestId = `perm-${toolUseId}`;
                debug(`[PreToolUse] Requesting permission for ${toolName}: ${command}`);

                const permissionPromise = new Promise<boolean>((resolve) => {
                  this.pendingPermissions.set(requestId, {
                    resolve,
                    toolName,
                    command,
                    baseCommand,
                  });
                });

                if (this.onPermissionRequest) {
                  this.onPermissionRequest({
                    requestId,
                    toolName,
                    command,
                    description,
                  });
                } else {
                  this.pendingPermissions.delete(requestId);
                  return { allowed: false };
                }

                const allowed = await permissionPromise;
                return { allowed };
              };

              // For file write operations in 'ask' mode, prompt for permission
              const fileWriteTools = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
              if (fileWriteTools.has(input.tool_name) && permissionMode === 'ask') {
                const toolInput = input.tool_input as Record<string, unknown>;
                const filePath = (toolInput.file_path as string) || (toolInput.notebook_path as string) || 'unknown';

                // Check if this tool type is already allowed for this session
                if (this.alwaysAllowedCommands.has(input.tool_name)) {
                  this.onDebug?.(`Auto-allowing "${input.tool_name}" (previously approved)`);
                  return { continue: true };
                }

                const result = await requestPermission(
                  input.tool_use_id,
                  input.tool_name,
                  filePath,
                  input.tool_name,
                  `${input.tool_name}: ${filePath}`
                );

                if (!result.allowed) {
                  return {
                    continue: false,
                    decision: 'block' as const,
                    reason: 'User denied permission',
                  };
                }
              }

              // For MCP mutation tools in 'ask' mode, prompt for permission
              if (input.tool_name.startsWith('mcp__') && permissionMode === 'ask') {
                // Check if this is a mutation tool by testing against safe mode's read-only patterns
                const plansFolderPath = sessionId ? getSessionPlansPath(this.workspaceRootPath, sessionId) : undefined;
                const safeModeResult = shouldAllowToolInMode(
                  input.tool_name,
                  input.tool_input,
                  'safe',
                  { plansFolderPath }
                );

                // If it would be blocked in safe mode, it's a mutation and needs permission
                if (!safeModeResult.allowed) {
                  const serverAndTool = input.tool_name.replace('mcp__', '').replace(/__/g, '/');

                  // Check if this tool is already allowed for this session
                  if (this.alwaysAllowedCommands.has(input.tool_name)) {
                    this.onDebug?.(`Auto-allowing "${input.tool_name}" (previously approved)`);
                    return { continue: true };
                  }

                  const result = await requestPermission(
                    input.tool_use_id,
                    'MCP Tool',
                    serverAndTool,
                    input.tool_name,
                    `MCP: ${serverAndTool}`
                  );

                  if (!result.allowed) {
                    return {
                      continue: false,
                      decision: 'block' as const,
                      reason: 'User denied permission',
                    };
                  }
                }
              }

              // For API mutation calls in 'ask' mode, prompt for permission
              if (input.tool_name.startsWith('api_') && permissionMode === 'ask') {
                const toolInput = input.tool_input as Record<string, unknown>;
                const method = ((toolInput?.method as string) || 'GET').toUpperCase();
                const path = toolInput?.path as string | undefined;

                // Only prompt for mutation methods (not GET)
                if (method !== 'GET') {
                  const apiDescription = `${method} ${path || ''}`;

                  // Check if this API endpoint is whitelisted in permissions.json
                  if (isApiEndpointAllowed(method, path, permissionsContext)) {
                    this.onDebug?.(`Auto-allowing API "${apiDescription}" (whitelisted in permissions.json)`);
                    return { continue: true };
                  }

                  // Check if this API pattern is already allowed (session whitelist)
                  if (this.alwaysAllowedCommands.has(apiDescription)) {
                    this.onDebug?.(`Auto-allowing API "${apiDescription}" (previously approved)`);
                    return { continue: true };
                  }

                  const result = await requestPermission(
                    input.tool_use_id,
                    'API Call',
                    apiDescription,
                    apiDescription,
                    `API: ${apiDescription}`
                  );

                  if (!result.allowed) {
                    return {
                      continue: false,
                      decision: 'block' as const,
                      reason: 'User denied permission',
                    };
                  }
                }
              }

              // For Bash in 'ask' mode, check if we need permission
              if (input.tool_name === 'Bash' && permissionMode === 'ask') {
                // Extract command and base command
                const command = typeof input.tool_input === 'object' && input.tool_input !== null
                  ? (input.tool_input as Record<string, unknown>).command
                  : JSON.stringify(input.tool_input);
                const commandStr = String(command);
                const baseCommand = this.getBaseCommand(commandStr);

                // Auto-allow read-only commands (same ones allowed in Explore mode)
                // Use merged config to get actual patterns from default.json (SAFE_MODE_CONFIG has empty arrays)
                const mergedConfig = permissionsConfigCache.getMergedConfig(permissionsContext);
                const isReadOnly = mergedConfig.readOnlyBashPatterns.some(pattern => pattern.regex.test(commandStr.trim()));
                if (isReadOnly) {
                  this.onDebug?.(`Auto-allowing read-only command: ${baseCommand}`);
                  return { continue: true };
                }

                // Check if this base command is already allowed (and not dangerous)
                if (this.alwaysAllowedCommands.has(baseCommand) && !this.isDangerousCommand(baseCommand)) {
                  this.onDebug?.(`Auto-allowing "${baseCommand}" (previously approved)`);
                  return { continue: true };
                }

                // For curl/wget, check if the domain is whitelisted
                if (['curl', 'wget'].includes(baseCommand)) {
                  const domain = this.extractDomainFromNetworkCommand(commandStr);
                  if (domain && this.alwaysAllowedDomains.has(domain)) {
                    this.onDebug?.(`Auto-allowing ${baseCommand} to "${domain}" (domain whitelisted)`);
                    return { continue: true };
                  }
                }

                // Ask for permission
                const requestId = `perm-${input.tool_use_id}`;
                debug(`[PreToolUse] Requesting permission for Bash command: ${commandStr}`);

                const permissionPromise = new Promise<boolean>((resolve) => {
                  this.pendingPermissions.set(requestId, {
                    resolve,
                    toolName: input.tool_name,
                    command: commandStr,
                    baseCommand,
                  });
                });

                if (this.onPermissionRequest) {
                  this.onPermissionRequest({
                    requestId,
                    toolName: input.tool_name,
                    command: commandStr,
                    description: `Execute: ${commandStr}`,
                  });
                } else {
                  this.pendingPermissions.delete(requestId);
                  return {
                    continue: false,
                    decision: 'block' as const,
                    reason: 'No permission handler available',
                  };
                }

                const allowed = await permissionPromise;
                if (!allowed) {
                  return {
                    continue: false,
                    decision: 'block' as const,
                    reason: 'User denied permission',
                  };
                }
              }

              return { continue: true };
            }],
          }],
          // NOTE: PostToolUse hook was removed because updatedMCPToolOutput is not a valid SDK output field.
          // For API tools (api_*), summarization happens in api-tools.ts.
          // For external MCP servers (stdio/HTTP), we cannot modify their output - they're responsible
          // for their own size management via pagination or filtering.

          // ═══════════════════════════════════════════════════════════════════════════
          // SUBAGENT HOOKS: Logging only - parent tracking uses SDK's parent_tool_use_id
          // ═══════════════════════════════════════════════════════════════════════════
          SubagentStart: [{
            hooks: [async (input, _hookToolUseID) => {
              const typedInput = input as { agent_id?: string; agent_type?: string };
              console.log(`[CraftAgent] SubagentStart: agent_id=${typedInput.agent_id}, type=${typedInput.agent_type}`);
              return { continue: true };
            }],
          }],
          SubagentStop: [{
            hooks: [async (input, _toolUseID) => {
              const typedInput = input as { agent_id?: string };
              console.log(`[CraftAgent] SubagentStop: agent_id=${typedInput.agent_id}`);
              return { continue: true };
            }],
          }],
        },
        // Continue from previous session if we have one (enables conversation history & auto compaction)
        // Skip resume on retry (after session expiry) to start fresh
        ...(!_isRetry && this.sessionId ? { resume: this.sessionId } : {}),
        mcpServers,
        // NOTE: This callback is NOT called by the SDK because we set `permissionMode: 'bypassPermissions'` above.
        // All permission logic is handled via the PreToolUse hook instead (see hooks.PreToolUse above).
        // Skill qualification and Bash permission logic are in PreToolUse where they actually execute.
        canUseTool: async (_toolName, input) => {
          return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
        },
        // Selectively disable tools - file tools are disabled (use MCP), web/code controlled by settings
        disallowedTools,
        // Load workspace as SDK plugin (enables skills, commands, agents from workspace)
        plugins: [{ type: 'local' as const, path: this.workspaceRootPath }],
      };

      // Track whether we're trying to resume a session (for error handling)
      const wasResuming = !_isRetry && !!this.sessionId;

      // Log resume attempt for debugging session failures
      if (wasResuming) {
        console.error(`[CraftAgent] Attempting to resume SDK session: ${this.sessionId}`);
        debug(`[CraftAgent] Attempting to resume SDK session: ${this.sessionId}`);
      } else {
        console.error(`[CraftAgent] Starting fresh SDK session (no resume)`);
        debug(`[CraftAgent] Starting fresh SDK session (no resume)`);
      }

      // Create AbortController for this query - allows force-stopping via forceAbort()
      this.currentQueryAbortController = new AbortController();
      const optionsWithAbort = {
        ...options,
        abortController: this.currentQueryAbortController,
      };

      // Known SDK slash commands that bypass context wrapping.
      // These are sent directly to the SDK without date/session/source context.
      // Currently only 'compact' is supported - add more here as needed.
      const SDK_SLASH_COMMANDS = ['compact'] as const;

      // Detect SDK slash commands - must be sent directly without context wrapping.
      // Pattern: /command or /command <instructions>
      const trimmedMessage = userMessage.trim();
      const commandMatch = trimmedMessage.match(/^\/([a-z]+)(\s|$)/i);
      const commandName = commandMatch?.[1]?.toLowerCase();
      const isSlashCommand = commandName &&
        SDK_SLASH_COMMANDS.includes(commandName as typeof SDK_SLASH_COMMANDS[number]) &&
        !attachments?.length;

      // Create the query - handle slash commands, binary attachments, or regular messages
      if (isSlashCommand) {
        // Send slash commands directly to SDK without context wrapping.
        // The SDK processes these as internal commands (e.g., /compact triggers compaction).
        debug(`[chat] Detected SDK slash command: ${trimmedMessage}`);
        this.currentQuery = query({ prompt: trimmedMessage, options: optionsWithAbort });
      } else if (hasBinaryAttachments) {
        const sdkMessage = this.buildSDKUserMessage(userMessage, attachments);
        async function* singleMessage(): AsyncIterable<SDKUserMessage> {
          yield sdkMessage;
        }
        this.currentQuery = query({ prompt: singleMessage(), options: optionsWithAbort });
      } else {
        // Simple string prompt for text-only messages (may include text file contents)
        const prompt = this.buildTextPrompt(userMessage, attachments);
        this.currentQuery = query({ prompt, options: optionsWithAbort });
      }

      // Track tool uses for mapping results and preventing duplicates
      const pendingToolUses = new Map<string, { name: string; input: Record<string, unknown> }>();
      // SDK emits tool_use in both stream_event (partial) and assistant (complete) messages
      // Track emitted tool_starts to avoid duplicate UI updates
      const emittedToolStarts = new Set<string>();
      // Track tool IDs that have been matched to results (but not yet deleted from pendingToolUses)
      // This prevents the FIFO fallback from matching multiple results to the same tool
      const matchedToolIds = new Set<string>();

      // ═══════════════════════════════════════════════════════════════════════════
      // PARENT-CHILD TOOL TRACKING (for Task/TaskOutput subagent tools)
      // ═══════════════════════════════════════════════════════════════════════════
      //
      // PURPOSE: Track which tools are children of which parent (Task/TaskOutput)
      // for correct UI hierarchy display and result matching.
      //
      // ─────────────────────────────────────────────────────────────────────────────
      // HOW IT WORKS: SDK's parent_tool_use_id
      // ─────────────────────────────────────────────────────────────────────────────
      //
      // The Claude Agent SDK provides `parent_tool_use_id` on ALL message types:
      // - SDKAssistantMessage, SDKPartialAssistantMessage, SDKToolProgressMessage, SDKUserMessage
      //
      // For tools running INSIDE a subagent (Task), this field points to the parent Task's ID.
      // This is the AUTHORITATIVE source for parent-child relationships.
      //
      // ─────────────────────────────────────────────────────────────────────────────
      // PARENT ASSIGNMENT PATHS (at tool_start time)
      // ─────────────────────────────────────────────────────────────────────────────
      //
      // 1. SINGLE PARENT: When only one Task is active, assign child to it (unambiguous)
      //    → Log: "CHILD REGISTERED (assistant/single-parent)"
      //
      // 2. MULTIPLE PARENTS + SDK PARENT: Use SDK's parent_tool_use_id (authoritative)
      //    → Log: "CHILD REGISTERED (assistant/sdk-parent)" or "(stream/sdk-parent)"
      //
      // 3. FIFO FALLBACK: If SDK doesn't provide parent (edge case), use first active parent
      //    → Log: "CHILD REGISTERED (assistant/fifo-fallback)" or "(stream/fifo-fallback)"
      //    → This should rarely happen now that we use SDK's parent_tool_use_id
      //
      // ─────────────────────────────────────────────────────────────────────────────
      // RESULT MATCHING (at tool_result time)
      // ─────────────────────────────────────────────────────────────────────────────
      //
      // When a tool_result arrives with parent_tool_use_id pointing to a PARENT tool:
      // - The result is for a CHILD of that parent, not the parent itself
      // - Match to children in FIFO order using parentToChildren map
      // - This handles: Task(A) → Grep, Read → results come back with parent=A
      //
      // ─────────────────────────────────────────────────────────────────────────────
      // DATA STRUCTURES
      // ─────────────────────────────────────────────────────────────────────────────
      //
      // PARENT_TOOL_NAMES: Tools that can spawn children (Task, TaskOutput)
      // activeParentTools: Set of currently running parent tool IDs
      // parentToChildren:  Map<parentId, childIds[]> - ordered for FIFO result matching
      // childToParent:     Map<childId, parentId> - for UI hierarchy lookup
      //
      // ─────────────────────────────────────────────────────────────────────────────
      // RELATED CODE
      // ─────────────────────────────────────────────────────────────────────────────
      //
      // - SubagentStart/SubagentStop hooks (line ~1345): Logging only, not for mapping
      // - apps/electron/src/main/sessions.ts: Similar tracking at session manager level
      //   (uses parentToolStack as fallback, but prefers event.parentToolUseId from here)
      //
      // ═══════════════════════════════════════════════════════════════════════════
      // Only Task is a parent tool (spawns subagent children)
      // TaskOutput just retrieves results from background tasks - it doesn't spawn children
      const PARENT_TOOL_NAMES = ['Task'];
      const activeParentTools = new Set<string>();                    // Currently running parent tool IDs
      const parentToChildren = new Map<string, string[]>();           // parentId → [childIds...] (FIFO order)
      const childToParent = new Map<string, string>();                // childId → parentId (for hierarchy)

      // Process SDK messages and convert to AgentEvents
      let receivedComplete = false;
      // Track text waiting for stop_reason from message_delta
      let pendingTextForStopReason: string | null = null;
      // Track current turn ID from message_start (correlation ID for grouping events)
      let currentTurnId: string | null = null;
      // Track whether we received any assistant content (for empty response detection)
      // When SDK returns empty response (e.g., failed resume), we need to detect and recover
      let receivedAssistantContent = false;
      try {
        for await (const message of this.currentQuery) {
          // Track if we got any text content from assistant
          if ('type' in message && message.type === 'assistant' && 'message' in message) {
            const assistantMsg = message.message as { content?: unknown[] };
            if (assistantMsg.content && Array.isArray(assistantMsg.content) && assistantMsg.content.length > 0) {
              receivedAssistantContent = true;
            }
          }
          // Also track text_delta events as assistant content (nested in stream_event)
          if ('type' in message && message.type === 'stream_event' && 'event' in message) {
            const event = (message as { event: { type: string } }).event;
            if (event.type === 'content_block_delta' || event.type === 'message_start') {
              receivedAssistantContent = true;
            }
          }

          // Capture session ID for conversation continuity (only when it changes)
          if ('session_id' in message && message.session_id && message.session_id !== this.sessionId) {
            this.sessionId = message.session_id;
            // Notify caller of new SDK session ID (for immediate persistence)
            this.config.onSdkSessionIdUpdate?.(message.session_id);
          }

          const events = this.convertSDKMessage(
            message,
            pendingToolUses,
            emittedToolStarts,
            matchedToolIds,
            { PARENT_TOOL_NAMES, activeParentTools, parentToChildren, childToParent },
            pendingTextForStopReason,
            (text) => { pendingTextForStopReason = text; },
            currentTurnId,
            (id) => { currentTurnId = id; }
          );
          for (const event of events) {
            // Check for tool-not-found errors on inactive sources and attempt auto-activation
            const inactiveSourceError = this.detectInactiveSourceToolError(event, pendingToolUses);

            if (inactiveSourceError && this.onSourceActivationRequest) {
              const { sourceSlug, toolName } = inactiveSourceError;

              this.onDebug?.(`Detected tool call to inactive source "${sourceSlug}", attempting activation...`);

              try {
                const activated = await this.onSourceActivationRequest(sourceSlug);

                if (activated) {
                  this.onDebug?.(`Source "${sourceSlug}" activated successfully, interrupting turn for auto-retry`);

                  // Yield source_activated event immediately for auto-retry
                  yield {
                    type: 'source_activated' as const,
                    sourceSlug,
                    originalMessage: userMessage,
                  };

                  // Interrupt the turn - no point letting the model continue without the tools
                  // The abort will cause the loop to exit and emit 'complete'
                  this.forceAbort(AbortReason.SourceActivated);
                  return; // Exit the generator
                } else {
                  this.onDebug?.(`Source "${sourceSlug}" activation failed (may need auth)`);
                  // Let the original error through, but with more context
                  const toolResultEvent = event as Extract<AgentEvent, { type: 'tool_result' }>;
                  yield {
                    type: 'tool_result' as const,
                    toolUseId: toolResultEvent.toolUseId,
                    result: `Source "${sourceSlug}" could not be activated. It may require authentication. Please check the source status in the sources panel.`,
                    isError: true,
                    input: toolResultEvent.input,
                    turnId: toolResultEvent.turnId,
                    parentToolUseId: toolResultEvent.parentToolUseId,
                  };
                  continue;
                }
              } catch (error) {
                this.onDebug?.(`Source "${sourceSlug}" activation error: ${error}`);
                // Let original error through
              }
            }

            if (event.type === 'complete') {
              receivedComplete = true;
            }
            yield event;
          }
        }

        // Detect empty response when resuming - SDK silently fails resume if session is invalid
        // In this case, we got a new session ID but no assistant content
        debug('[SESSION_DEBUG] Post-loop check: wasResuming=', wasResuming, 'receivedAssistantContent=', receivedAssistantContent, '_isRetry=', _isRetry);
        if (wasResuming && !receivedAssistantContent && !_isRetry) {
          debug('[SESSION_DEBUG] >>> DETECTED EMPTY RESPONSE - triggering recovery');
          // SDK resume failed silently - clear session and retry with context
          this.sessionId = null;
          // Notify that we're clearing the session ID (for persistence)
          this.config.onSdkSessionIdCleared?.();
          // Clear pinned state for fresh start
          this.pinnedPreferencesPrompt = null;
          this.preferencesDriftNotified = false;

          // Build recovery context from previous messages to inject into retry
          const recoveryContext = this.buildRecoveryContext();
          const messageWithContext = recoveryContext
            ? recoveryContext + userMessage
            : userMessage;

          yield { type: 'info', message: 'Restoring conversation context...' };
          // Retry with fresh session, injecting conversation history into the message
          yield* this.chat(messageWithContext, attachments, true);
          return;
        }

        // Defensive: flush any pending text that wasn't emitted
        // This can happen if the SDK sends an assistant message with text but skips the
        // message_delta event that normally triggers text_complete (e.g., in some ultrathink scenarios)
        if (pendingTextForStopReason) {
          yield { type: 'text_complete', text: pendingTextForStopReason, isIntermediate: false, turnId: currentTurnId || undefined };
          pendingTextForStopReason = null;
        }

        // Defensive: emit complete if SDK didn't send result message
        if (!receivedComplete) {
          yield { type: 'complete' };
        }
      } catch (sdkError) {
        // Debug: log inner catch trigger (stderr to avoid SDK JSON pollution)
        console.error(`[CraftAgent] INNER CATCH triggered: ${sdkError instanceof Error ? sdkError.message : String(sdkError)}`);

        // Handle user interruption
        if (sdkError instanceof AbortError) {
          const reason = this.lastAbortReason;
          this.lastAbortReason = null;  // Clear for next time

          // If interrupted before receiving any assistant content AND this was the first message,
          // clear session ID to prevent broken resume state where SDK session file is empty/invalid.
          // For later messages (messageCount > 0), keep the session ID to preserve conversation history.
          // The SDK session file should have valid previous turns we can resume from.
          if (!receivedAssistantContent && this.sessionId) {
            // Check if there are previous messages (completed turns) in this session
            // If yes, keep the session ID to preserve history on resume
            const hasCompletedTurns = this.config.getRecoveryMessages && this.config.getRecoveryMessages().length > 0;

            if (!hasCompletedTurns) {
              // First message was interrupted before any response - SDK session is empty/corrupt
              debug('[SESSION_DEBUG] First message interrupted before assistant content - clearing sdkSessionId:', this.sessionId);
              this.sessionId = null;
              this.config.onSdkSessionIdCleared?.();
            } else {
              // Later message interrupted - SDK session has valid history, keep it for resume
              debug('[SESSION_DEBUG] Later message interrupted - keeping sdkSessionId for history preservation:', this.sessionId);
            }
          }

          // Only emit "Interrupted" status for user-initiated stops
          // Plan submissions and redirects should be silent
          if (reason === AbortReason.UserStop) {
            yield { type: 'status', message: 'Interrupted' };
          }
          yield { type: 'complete' };
          return;
        }

        // Get error message regardless of error type
        // Note: SDK text errors like "API Error: 402..." are primarily handled in useAgent.ts
        // via text_complete event. This is a fallback for errors that don't emit text first.
        // parseError() will detect status codes (402, 401, etc.) in the raw message.
        const rawErrorMsg = sdkError instanceof Error ? sdkError.message : String(sdkError);
        const errorMsg = rawErrorMsg.toLowerCase();

        // Debug logging - always log the actual error and context
        this.onDebug?.(`Error in chat: ${rawErrorMsg}`);
        this.onDebug?.(`Context: wasResuming=${wasResuming}, isRetry=${_isRetry}`);

        // Check for auth errors - these won't be fixed by clearing session
        const isAuthError =
          errorMsg.includes('unauthorized') ||
          errorMsg.includes('401') ||
          errorMsg.includes('authentication failed') ||
          errorMsg.includes('invalid api key') ||
          errorMsg.includes('invalid x-api-key');

        if (isAuthError) {
          // Auth errors surface immediately - session manager handles retry by recreating agent
          const typedError = parseError(new Error(rawErrorMsg));
          yield { type: 'typed_error', error: typedError };
          yield { type: 'complete' };
          return;
        }

        // Rate limit errors - don't retry immediately, surface to user
        const isRateLimitError =
          errorMsg.includes('429') ||
          errorMsg.includes('rate limit') ||
          errorMsg.includes('too many requests');

        if (isRateLimitError) {
          // Parse to typed error using the captured/processed error message
          const typedError = parseError(new Error(rawErrorMsg));
          yield { type: 'typed_error', error: typedError };
          yield { type: 'complete' };
          return;
        }

        // Check for billing/payment errors (402) - don't retry these
        const isBillingError =
          errorMsg.includes('402') ||
          errorMsg.includes('payment required') ||
          errorMsg.includes('billing');

        if (isBillingError) {
          // Parse to typed error using the captured/processed error message, not the original SDK error
          // This ensures parseError sees "402 Payment required" instead of "process exited with code 1"
          const typedError = parseError(new Error(rawErrorMsg));
          yield { type: 'typed_error', error: typedError };
          yield { type: 'complete' };
          return;
        }

        // Check for SDK process errors - these often wrap underlying billing/auth issues
        // The SDK's internal Claude Code process exits with code 1 for various API errors
        const isProcessError = errorMsg.includes('process exited with code');

        // [SESSION_DEBUG] Comprehensive logging for session recovery investigation
        debug('[SESSION_DEBUG] === ERROR HANDLER ENTRY ===');
        debug('[SESSION_DEBUG] errorMsg:', errorMsg);
        debug('[SESSION_DEBUG] rawErrorMsg:', rawErrorMsg);
        debug('[SESSION_DEBUG] isProcessError:', isProcessError);
        debug('[SESSION_DEBUG] wasResuming:', wasResuming);
        debug('[SESSION_DEBUG] _isRetry:', _isRetry);
        debug('[SESSION_DEBUG] this.sessionId:', this.sessionId);
        debug('[SESSION_DEBUG] lastStderrOutput length:', this.lastStderrOutput.length);
        debug('[SESSION_DEBUG] lastStderrOutput:', this.lastStderrOutput.join('\n'));

        if (isProcessError) {
          // Include captured stderr in diagnostics - this is often where the real error is
          const stderrContext = this.lastStderrOutput.length > 0
            ? this.lastStderrOutput.join('\n')
            : undefined;
          if (stderrContext) {
            debug('[SDK process error] Captured stderr:', stderrContext);
          }

          // Check for expired session error - SDK session no longer exists server-side
          // This happens when sessions expire (TTL) or are cleaned up by Anthropic
          const isSessionExpired = stderrContext?.includes('No conversation found with session ID');
          debug('[SESSION_DEBUG] isSessionExpired:', isSessionExpired);

          if (isSessionExpired && wasResuming && !_isRetry) {
            debug('[SESSION_DEBUG] >>> TAKING PATH: Session expired recovery');
            console.error('[CraftAgent] SDK session expired server-side, clearing and retrying fresh');
            debug('[CraftAgent] SDK session expired server-side, clearing and retrying fresh');
            this.sessionId = null;
            // Clear pinned state so retry captures fresh values
            this.pinnedPreferencesPrompt = null;
            this.preferencesDriftNotified = false;
            // Use 'info' instead of 'status' to show message without spinner
            yield { type: 'info', message: 'Session expired, restoring context...' };
            // Recursively call with isRetry=true (yield* delegates all events)
            yield* this.chat(userMessage, attachments, true);
            return;
          }

          // Check for Windows SDK setup error (missing .claude/skills directory)
          const windowsSkillsError = buildWindowsSkillsDirError(stderrContext || rawErrorMsg);
          if (windowsSkillsError) {
            yield windowsSkillsError;
            yield { type: 'complete' };
            return;
          }

          debug('[SESSION_DEBUG] >>> TAKING PATH: Run diagnostics (not session expired)');

          // Run diagnostics to identify specific cause (2s timeout)
          const storedConfig = loadStoredConfig();
          const diagnostics = await runErrorDiagnostics({
            authType: storedConfig?.authType,
            workspaceId: this.config.workspace?.id,
            rawError: stderrContext || rawErrorMsg,
          });

          debug('[SESSION_DEBUG] diagnostics.code:', diagnostics.code);
          debug('[SESSION_DEBUG] diagnostics.title:', diagnostics.title);
          debug('[SESSION_DEBUG] diagnostics.message:', diagnostics.message);

          // Get recovery actions based on diagnostic code
          const actions = diagnostics.code === 'token_expired' || diagnostics.code === 'mcp_unreachable'
            ? [
                { key: 'w', label: 'Open workspace menu', command: '/workspace' },
                { key: 'r', label: 'Retry', action: 'retry' as const },
              ]
            : diagnostics.code === 'invalid_credentials' || diagnostics.code === 'billing_error'
            ? [
                { key: 's', label: 'Update credentials', command: '/settings', action: 'settings' as const },
              ]
            : [
                { key: 'r', label: 'Retry', action: 'retry' as const },
                { key: 's', label: 'Check settings', command: '/settings', action: 'settings' as const },
              ];

          yield {
            type: 'typed_error',
            error: {
              code: diagnostics.code,
              title: diagnostics.title,
              message: diagnostics.message,
              // Include stderr in details if we captured any useful output
              details: stderrContext
                ? [...(diagnostics.details || []), `SDK stderr: ${stderrContext}`]
                : diagnostics.details,
              actions,
              canRetry: diagnostics.code !== 'billing_error' && diagnostics.code !== 'invalid_credentials',
              retryDelayMs: 1000,
              originalError: stderrContext || rawErrorMsg,
            },
          };
          yield { type: 'complete' };
          return;
        }

        // Session-related retry: only if we were resuming and haven't retried yet
        debug('[SESSION_DEBUG] isProcessError=false, checking wasResuming fallback');
        if (wasResuming && !_isRetry) {
          debug('[SESSION_DEBUG] >>> TAKING PATH: wasResuming fallback retry');
          this.sessionId = null;
          // Clear pinned state so retry captures fresh values
          this.pinnedPreferencesPrompt = null;
          this.preferencesDriftNotified = false;

          // Provide context-aware message (conservative: only match explicit session/resume terms)
          const isSessionError =
            errorMsg.includes('session') ||
            errorMsg.includes('resume');

          debug('[SESSION_DEBUG] isSessionError (for message):', isSessionError);

          const statusMessage = isSessionError
            ? 'Conversation sync failed, starting fresh...'
            : 'Request failed, retrying without history...';

          // Use 'info' instead of 'status' to show message without spinner
          yield { type: 'info', message: statusMessage };
          // Recursively call with isRetry=true (yield* delegates all events)
          yield* this.chat(userMessage, attachments, true);
          return;
        }

        debug('[SESSION_DEBUG] >>> TAKING PATH: Final fallback (show generic error)');
        // Retry also failed, or wasn't resuming - show generic error
        // (Auth, billing, and rate limit errors are handled above)
        const rawMessage = sdkError instanceof Error ? sdkError.message : String(sdkError);

        yield { type: 'error', message: rawMessage };
        yield { type: 'complete' };
        return;
      }

    } catch (error) {
      // Debug: log outer catch trigger (stderr to avoid SDK JSON pollution)
      console.error(`[CraftAgent] OUTER CATCH triggered: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`[CraftAgent] Error stack: ${error instanceof Error ? error.stack : 'no stack'}`);

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this is a recognizable error type
      const typedError = parseError(error);
      if (typedError.code !== 'unknown_error') {
        // Known error type - show user-friendly message with recovery actions
        yield { type: 'typed_error', error: typedError };
      } else {
        // Unknown error - show raw message
        yield { type: 'error', message: errorMessage };
      }
      // emit complete even on error so application knows we're done
      yield { type: 'complete' };
    } finally {
      this.currentQuery = null;
      // Reset ultrathink override after query completes (single-shot per-message boost)
      // Note: thinkingLevel is NOT reset - it's sticky for the session
      this.ultrathinkOverride = false;
    }
  }

  /**
   * Format source state as a lightweight XML block for injection into user messages.
   * Shows active sources, inactive sources, and introduces new sources with taglines.
   * New sources (not seen before this session) include descriptions to help agent understand usage.
   *
   * Active sources are determined by intendedActiveSlugs (what UI shows as active).
   * If a source is intended-active but has no working tools (build failed), we note the issue.
   */
  private formatSourceState(): string {
    // Use intended active slugs (what UI shows) rather than just what built successfully
    const activeSlugs = [...this.intendedActiveSlugs].sort();

    // Find inactive sources (in allSources but not intended-active)
    const inactiveSources = this.allSources.filter(
      (s) => !this.intendedActiveSlugs.has(s.config.slug)
    );

    // Find sources not yet seen this session
    const unseenSources = this.allSources.filter(
      (s) => !this.knownSourceSlugs.has(s.config.slug)
    );

    // Find active sources that need attention (needs_auth or failed status)
    const activeSources = this.allSources.filter(
      (s) => this.intendedActiveSlugs.has(s.config.slug)
    );
    const sourcesNeedingAttention = activeSources.filter(
      (s) => s.config.connectionStatus === 'needs_auth' || s.config.connectionStatus === 'failed'
    );

    // Check if this is the first message (no sources known yet)
    const isFirstMessage = this.knownSourceSlugs.size === 0;

    // Mark all current sources as known for next message
    this.allSources.forEach((s) => this.knownSourceSlugs.add(s.config.slug));

    // Build output parts
    const parts: string[] = [];

    // Active sources line - include warning for sources with failed builds
    if (activeSlugs.length > 0) {
      const activeWithStatus = activeSlugs.map((slug) => {
        const hasWorkingTools = this.activeSourceServerNames.has(slug);
        return hasWorkingTools ? slug : `${slug} (no tools)`;
      });
      parts.push(`Active: ${activeWithStatus.join(', ')}`);
    } else {
      parts.push('Active: none');
    }

    // Inactive sources with reason
    // Use sourceNeedsAuthentication() to correctly check if auth is required,
    // not just whether isAuthenticated is set. Sources with authType: "none"
    // should show "inactive" not "needs auth".
    if (inactiveSources.length > 0) {
      const inactiveList = inactiveSources.map((s) => {
        const reason = !s.config.enabled
          ? 'disabled'
          : sourceNeedsAuthentication(s)
            ? 'needs auth'
            : 'inactive';
        return `${s.config.slug} (${reason})`;
      });
      parts.push(`Inactive: ${inactiveList.join(', ')}`);
    }

    // Source descriptions (shown once per session when first introduced)
    if (unseenSources.length > 0) {
      parts.push('');
      // Only show "New:" header for mid-conversation additions, not first message
      if (!isFirstMessage) {
        parts.push('New:');
      }
      for (const s of unseenSources) {
        const tagline = s.config.tagline || s.config.provider;
        parts.push(`- ${s.config.slug}: ${tagline}`);
      }
    }

    let output = `<sources>\n${parts.join('\n')}\n</sources>`;

    // Inject issue context for sources needing attention (auth failed, etc.)
    // These are ALWAYS shown, regardless of "seen" status, to ensure agent can troubleshoot
    for (const s of sourcesNeedingAttention) {
      const status = s.config.connectionStatus;
      output += `\n\n<source_issue source="${s.config.slug}" status="${status}">`;

      if (s.config.connectionError) {
        output += `\nError: ${s.config.connectionError}`;
      }

      // Provide context-aware fix instructions based on auth type and transport
      const authTool = this.getAuthToolName(s);
      if (authTool) {
        // Auth-based source - likely revoked or expired token
        output += `\n\nThis source requires re-authentication. The user may have revoked access or the token expired.`;
        output += `\nTo fix: Re-authenticate using ${authTool}.`;
      } else if (s.config.mcp?.transport === 'stdio') {
        // Local stdio server - process may have crashed or isn't installed
        output += `\n\nThis is a local MCP server that is not responding. The server process may need to be restarted.`;
        output += `\nTo fix: Check if the server command/path is correct and the process can start.`;
      } else {
        // Remote no-auth source - server unreachable or URL changed
        output += `\n\nThis source's server is unreachable. It may be down or the URL may have changed.`;
        output += `\nTo fix: Check the server URL and network connectivity. Use WebSearch to verify the endpoint is correct.`;
      }
      output += `\n</source_issue>`;
    }

    return output;
  }

  /**
   * Get the correct authentication tool name for a source, or null if no auth is needed.
   * Tool names are based on source type and provider, not the source slug.
   */
  private getAuthToolName(source: LoadedSource): string | null {
    const { type, provider, mcp, api } = source.config;

    // MCP sources
    if (type === 'mcp') {
      if (mcp?.authType === 'oauth') {
        return 'source_oauth_trigger';
      }
      if (mcp?.authType === 'bearer') {
        return 'source_credential_prompt';
      }
      // authType: 'none' or undefined (stdio) - no auth needed
      return null;
    }

    // API sources: check provider for specific OAuth triggers
    if (type === 'api') {
      // Check for no-auth APIs first
      if (api?.authType === 'none' || api?.authType === undefined) {
        return null;
      }

      // OAuth providers have specific triggers
      switch (provider) {
        case 'google':
          return 'source_google_oauth_trigger';
        case 'slack':
          return 'source_slack_oauth_trigger';
        case 'microsoft':
          return 'source_microsoft_oauth_trigger';
        default:
          // Non-OAuth API sources (api key, bearer, header, query) use credential prompt
          return 'source_credential_prompt';
      }
    }

    // Local sources or unknown - no auth
    return null;
  }

  /**
   * Format workspace capabilities for prompt injection.
   * Informs the agent about what features are available in this workspace.
   */
  private formatWorkspaceCapabilities(): string {
    const capabilities: string[] = [];

    // Check local MCP server capability
    const localMcpEnabled = isLocalMcpEnabled(this.workspaceRootPath);
    if (localMcpEnabled) {
      capabilities.push('local-mcp: enabled (stdio subprocess servers supported)');
    } else {
      capabilities.push('local-mcp: disabled (only HTTP/SSE servers)');
    }

    return `<workspace_capabilities>\n${capabilities.join('\n')}\n</workspace_capabilities>`;
  }

  /**
   * Build recovery context from previous messages when SDK resume fails.
   * Called when we detect an empty response during resume - we need to inject
   * the previous conversation context so the agent can continue naturally.
   *
   * Returns a formatted string to prepend to the user message, or null if no context available.
   */
  private buildRecoveryContext(): string | null {
    const messages = this.config.getRecoveryMessages?.();
    if (!messages || messages.length === 0) {
      return null;
    }

    // Format messages as a conversation block the agent can understand
    const formattedMessages = messages.map(m => {
      const role = m.type === 'user' ? 'User' : 'Assistant';
      // Truncate very long messages to avoid bloating context (max ~1000 chars each)
      const content = m.content.length > 1000
        ? m.content.slice(0, 1000) + '...[truncated]'
        : m.content;
      return `[${role}]: ${content}`;
    }).join('\n\n');

    return `<conversation_recovery>
This session was interrupted and is being restored. Here is the recent conversation context:

${formattedMessages}

Please continue the conversation naturally from where we left off.
</conversation_recovery>

`;
  }

  /**
   * Build a simple text prompt with embedded text file contents (for text-only messages)
   * Prepends date/time context for prompt caching optimization (keeps system prompt static)
   * Injects session state (including mode state) for every message
   */
  private buildTextPrompt(text: string, attachments?: FileAttachment[]): string {
    const parts: string[] = [];

    // Add date/time context first (moved from system prompt to enable caching)
    parts.push(getDateTimeContext());

    // Add session state (always includes all modes with true/false state)
    // This lightweight format replaces the verbose mode context
    // Include plans folder path so agent knows where to write plans in safe mode
    const plansFolderPath = getSessionPlansPath(this.workspaceRootPath, this.modeSessionId);
    parts.push(formatSessionState(this.modeSessionId, { plansFolderPath }));

    // Add source state (always included to inform agent about available sources)
    parts.push(this.formatSourceState());

    // Add workspace capabilities (local MCP enabled/disabled, etc.)
    parts.push(this.formatWorkspaceCapabilities());

    // Add working directory context
    // Calculate effective working directory (same logic as cwd parameter)
    const effectiveWorkingDir = this.config.session?.workingDirectory ??
      (this.modeSessionId ? getSessionPath(this.workspaceRootPath, this.modeSessionId) : undefined);
    const isSessionRoot = !this.config.session?.workingDirectory && !!this.modeSessionId;
    // Pass sdkCwd so agent knows if bash runs from a different directory than workingDirectory
    const workingDirContext = getWorkingDirectoryContext(effectiveWorkingDir, isSessionRoot, this.config.session?.sdkCwd);
    if (workingDirContext) {
      parts.push(workingDirContext);
    }

    // Add file attachments with stored path info (agent uses Read tool to access content)
    // Text files are NOT embedded inline to prevent context overflow from large files
    if (attachments) {
      for (const attachment of attachments) {
        if (attachment.storedPath) {
          let pathInfo = `[Attached file: ${attachment.name}]`;
          pathInfo += `\n[Stored at: ${attachment.storedPath}]`;
          if (attachment.markdownPath) {
            pathInfo += `\n[Markdown version: ${attachment.markdownPath}]`;
          }
          parts.push(pathInfo);
        }
      }
    }

    // Add user's message
    if (text) {
      parts.push(text);
    }

    return parts.join('\n\n');
  }

  /**
   * Build an SDK user message with proper content blocks for binary attachments
   * Prepends date/time context for prompt caching optimization (keeps system prompt static)
   * Injects session state (including mode state) for every message
   */
  private buildSDKUserMessage(text: string, attachments?: FileAttachment[]): SDKUserMessage {
    const contentBlocks: ContentBlockParam[] = [];

    // Add date/time context first (moved from system prompt to enable caching)
    contentBlocks.push({ type: 'text', text: getDateTimeContext() });

    // Add session state (always includes all modes with true/false state)
    // This lightweight format replaces the verbose mode context
    // Include plans folder path so agent knows where to write plans in safe mode
    const plansFolderPath = getSessionPlansPath(this.workspaceRootPath, this.modeSessionId);
    contentBlocks.push({ type: 'text', text: formatSessionState(this.modeSessionId, { plansFolderPath }) });

    // Add source state (always included to inform agent about available sources)
    contentBlocks.push({ type: 'text', text: this.formatSourceState() });

    // Add workspace capabilities (local MCP enabled/disabled, etc.)
    contentBlocks.push({ type: 'text', text: this.formatWorkspaceCapabilities() });

    // Add working directory context
    // Calculate effective working directory (same logic as cwd parameter)
    const effectiveWorkingDirSdk = this.config.session?.workingDirectory ??
      (this.modeSessionId ? getSessionPath(this.workspaceRootPath, this.modeSessionId) : undefined);
    const isSessionRootSdk = !this.config.session?.workingDirectory && !!this.modeSessionId;
    // Pass sdkCwd so agent knows if bash runs from a different directory than workingDirectory
    const workingDirContextSdk = getWorkingDirectoryContext(effectiveWorkingDirSdk, isSessionRootSdk, this.config.session?.sdkCwd);
    if (workingDirContextSdk) {
      contentBlocks.push({ type: 'text', text: workingDirContextSdk });
    }

    // Add attachments - images/PDFs are uploaded inline, text files are path-only
    // Text files are NOT embedded to prevent context overflow; agent uses Read tool
    if (attachments) {
      for (const attachment of attachments) {
        // Add path info text block so the agent knows where the file is stored
        // This enables the agent to use the Read tool to access text/office files
        if (attachment.storedPath) {
          let pathInfo = `[Attached file: ${attachment.name}]\n[Stored at: ${attachment.storedPath}]`;
          if (attachment.markdownPath) {
            pathInfo += `\n[Markdown version: ${attachment.markdownPath}]`;
          }
          contentBlocks.push({
            type: 'text',
            text: pathInfo,
          });
        }

        // Only images and PDFs are uploaded inline (agent cannot read these with Read tool)
        if (attachment.type === 'image' && attachment.base64) {
          const mediaType = this.mapImageMediaType(attachment.mimeType);
          if (mediaType) {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: attachment.base64,
              },
            });
          }
        } else if (attachment.type === 'pdf' && attachment.base64) {
          contentBlocks.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: attachment.base64,
            },
          });
        }
        // Text files: path info already added above, agent uses Read tool to access content
      }
    }

    // Add user's text message
    if (text.trim()) {
      contentBlocks.push({ type: 'text', text });
    }

    return {
      type: 'user',
      message: {
        role: 'user',
        content: contentBlocks,
      },
      parent_tool_use_id: null,
      // Session resumption is handled by options.resume, not here
      // Setting session_id here with resume option causes SDK to return empty response
      session_id: '',
    } as SDKUserMessage;
  }

  /**
   * Map file MIME types to SDK-supported image types
   */
  private mapImageMediaType(mimeType?: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | null {
    if (!mimeType) return null;
    const supported: Record<string, 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'> = {
      'image/jpeg': 'image/jpeg',
      'image/png': 'image/png',
      'image/gif': 'image/gif',
      'image/webp': 'image/webp',
    };
    return supported[mimeType] || null;
  }

  /**
   * Map SDK assistant message error codes to typed error events with user-friendly messages.
   */
  private mapSDKErrorToTypedError(errorCode: SDKAssistantMessageError): { type: 'typed_error'; error: AgentError } {
    const errorMap: Record<SDKAssistantMessageError, AgentError> = {
      'authentication_failed': {
        code: 'invalid_api_key',
        title: 'Authentication Failed',
        message: 'Unable to authenticate with Anthropic. Your API key may be invalid or expired.',
        details: ['Check your API key in settings', 'Ensure your API key has not been revoked'],
        actions: [
          { key: 's', label: 'Settings', action: 'settings' },
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 1000,
      },
      'billing_error': {
        code: 'billing_error',
        title: 'Billing Error',
        message: 'Your account has a billing issue.',
        details: ['Check your Anthropic account billing status'],
        actions: [
          { key: 's', label: 'Update credentials', action: 'settings' },
        ],
        canRetry: false,
      },
      'rate_limit': {
        code: 'rate_limited',
        title: 'Rate Limit Exceeded',
        message: 'Too many requests. Please wait a moment before trying again.',
        details: ['Rate limits reset after a short period', 'Consider upgrading your plan for higher limits'],
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 5000,
      },
      'invalid_request': {
        code: 'unknown_error',
        title: 'Invalid Request',
        message: 'The request was invalid.',
        details: ['Try sending a new message', 'Report this issue if it persists'],
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 1000,
      },
      'server_error': {
        code: 'network_error',
        title: 'Connection Error',
        message: 'Unable to connect to the API server. Check your internet connection.',
        details: [
          'Verify your network connection is active',
          'Check if the API endpoint is accessible',
          'Firewall or VPN may be blocking the connection',
        ],
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 2000,
      },
      'unknown': {
        code: 'unknown_error',
        title: 'Unknown Error',
        message: 'An unexpected error occurred while connecting to Anthropic.',
        details: ['This may be a temporary issue', 'Check your network connection'],
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 2000,
      },
    };

    const error = errorMap[errorCode];
    return {
      type: 'typed_error',
      error,
    };
  }

  private convertSDKMessage(
    message: SDKMessage,
    pendingToolUses: Map<string, { name: string; input: Record<string, unknown> }>,
    emittedToolStarts: Set<string>,
    matchedToolIds: Set<string>,
    parentChildTracking: {
      PARENT_TOOL_NAMES: string[];
      activeParentTools: Set<string>;
      parentToChildren: Map<string, string[]>;
      childToParent: Map<string, string>;
    },
    pendingText: string | null,
    setPendingText: (text: string | null) => void,
    turnId: string | null,
    setTurnId: (id: string | null) => void
  ): AgentEvent[] {
    const events: AgentEvent[] = [];

    // Debug: log all SDK message types to understand MCP tool result flow
    if (this.onDebug) {
      const msgInfo = message.type === 'user' && 'tool_use_result' in message
        ? `user (tool_result for ${(message as any).parent_tool_use_id})`
        : message.type;
      this.onDebug(`SDK message: ${msgInfo}`);
    }

    switch (message.type) {
      case 'assistant': {
        // Check for SDK-level errors FIRST (auth, network, rate limits, etc.)
        // These errors are set by the SDK when API calls fail
        if ('error' in message && message.error) {
          const errorEvent = this.mapSDKErrorToTypedError(message.error);
          events.push(errorEvent);
          // Don't process content blocks when there's an error
          break;
        }

        // Skip replayed messages when resuming a session - they're historical
        if ('isReplay' in message && message.isReplay) {
          break;
        }

        // Track usage from non-sidechain assistant messages for accurate context window display
        // Skip sidechain messages (from subagents) - only main chain affects primary context
        const isSidechain = message.parent_tool_use_id !== null;
        if (!isSidechain && message.message.usage) {
          this.lastAssistantUsage = {
            input_tokens: message.message.usage.input_tokens,
            cache_read_input_tokens: message.message.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: message.message.usage.cache_creation_input_tokens ?? 0,
          };

          // Emit real-time usage update for context display
          // inputTokens = context size actually sent to API (includes cache tokens)
          const currentInputTokens =
            this.lastAssistantUsage.input_tokens +
            this.lastAssistantUsage.cache_read_input_tokens +
            this.lastAssistantUsage.cache_creation_input_tokens;

          events.push({
            type: 'usage_update',
            usage: {
              inputTokens: currentInputTokens,
              // contextWindow comes from modelUsage in result - use cached value if available
              contextWindow: this.cachedContextWindow,
            },
          });
        }

        // Full assistant message with content blocks
        const content = message.message.content;
        let textContent = '';

        for (const block of content) {
          if (block.type === 'text') {
            textContent += block.text;
          } else if (block.type === 'tool_use') {
            // Extract intent and displayName from the tool_use input for UI display
            // Note: PreToolUse hook strips these before forwarding to MCP servers
            const toolInput = block.input as Record<string, unknown>;
            let intent: string | undefined = toolInput._intent as string | undefined;
            const displayName: string | undefined = toolInput._displayName as string | undefined;

            // Debug: log tool input to see if metadata is present
            debug(`[convertSDKMessage] tool_use ${block.name}: _intent=${intent}, _displayName=${displayName}, input keys=${Object.keys(toolInput).join(', ')}`);

            // For Bash, use its description field instead of intent
            if (!intent && block.name === 'Bash') {
              const bashInput = block.input as { description?: string };
              intent = bashInput.description;
            }

            // Only emit if not already emitted via stream_event
            if (!emittedToolStarts.has(block.id)) {
              emittedToolStarts.add(block.id);
              pendingToolUses.set(block.id, {
                name: block.name,
                input: block.input as Record<string, unknown>,
              });

              // Register tool in parent-child hierarchy (see main docs above)
              const { PARENT_TOOL_NAMES, activeParentTools, parentToChildren, childToParent } = parentChildTracking;
              const isParentTool = PARENT_TOOL_NAMES.includes(block.name);

              let parentToolUseId: string | undefined;
              if (isParentTool) {
                // This is a parent tool (Task, TaskOutput) - it can spawn children
                activeParentTools.add(block.id);
                parentToChildren.set(block.id, []);
                this.onDebug?.(`Parent tool started: ${block.name} (${block.id})`);
              } else if (activeParentTools.size === 1) {
                // Single active parent - unambiguous, assign directly
                const parentId = Array.from(activeParentTools)[0]!;
                parentToChildren.get(parentId)?.push(block.id);
                childToParent.set(block.id, parentId);
                parentToolUseId = parentId;
                console.log(`[CraftAgent] CHILD REGISTERED (assistant/single-parent): ${block.name} (${block.id}) under parent ${parentId}`);
              } else if (activeParentTools.size > 1) {
                // Multiple active parents - use SDK's parent_tool_use_id (authoritative source)
                // Messages from subagent context include parent_tool_use_id pointing to the Task
                const sdkParentId = (message as { parent_tool_use_id?: string | null }).parent_tool_use_id;
                if (sdkParentId && activeParentTools.has(sdkParentId)) {
                  parentToChildren.get(sdkParentId)?.push(block.id);
                  childToParent.set(block.id, sdkParentId);
                  parentToolUseId = sdkParentId;
                  console.log(`[CraftAgent] CHILD REGISTERED (assistant/sdk-parent): ${block.name} (${block.id}) → Task (${sdkParentId})`);
                } else {
                  // Fallback: FIFO if SDK doesn't provide parent
                  const parentId = Array.from(activeParentTools)[0]!;
                  parentToChildren.get(parentId)?.push(block.id);
                  childToParent.set(block.id, parentId);
                  parentToolUseId = parentId;
                  console.log(`[CraftAgent] CHILD REGISTERED (assistant/fifo-fallback): ${block.name} (${block.id}) → ${parentId} (sdk_parent=${sdkParentId})`);
                }
              }
              // else: no active parents - tool is top-level, no parent needed

              events.push({
                type: 'tool_start',
                toolName: block.name,
                toolUseId: block.id,
                input: block.input as Record<string, unknown>,
                intent,
                displayName,
                turnId: turnId || undefined,
                parentToolUseId, // Include parent for hierarchy tracking
              });
            } else {
              // Update input if we have more complete data now
              const existing = pendingToolUses.get(block.id);
              const newInput = block.input as Record<string, unknown>;
              const hasNewInput = Object.keys(newInput).length > 0;
              const hadEmptyInput = existing && Object.keys(existing.input).length === 0;

              if (hasNewInput && hadEmptyInput) {
                pendingToolUses.set(block.id, {
                  name: block.name,
                  input: newInput,
                });
                // Emit another tool_start with the full input, intent, and displayName
                events.push({
                  type: 'tool_start',
                  toolName: block.name,
                  toolUseId: block.id,
                  input: newInput,
                  intent,
                  displayName,
                  turnId: turnId || undefined,
                });
              }
            }
          }
        }

        if (textContent) {
          // Don't emit text_complete yet - wait for message_delta to get actual stop_reason
          // The assistant message arrives with stop_reason: null during streaming
          // The actual stop_reason comes in the message_delta event
          setPendingText(textContent);
        }
        break;
      }

      case 'stream_event': {
        // Streaming partial message
        const event = message.event;
        // Debug: log all stream events to understand tool result flow
        if (this.onDebug && event.type !== 'content_block_delta') {
          this.onDebug(`stream_event: ${event.type}, content_type=${(event as any).content_block?.type || (event as any).delta?.type || 'n/a'}`);
        }
        // Capture turn ID from message_start (arrives before any content events)
        // This ID correlates all events in an assistant turn
        if (event.type === 'message_start') {
          const messageId = (event as any).message?.id;
          if (messageId) {
            setTurnId(messageId);
          }
        }
        // message_delta contains the actual stop_reason - emit pending text now
        if (event.type === 'message_delta') {
          const stopReason = (event as any).delta?.stop_reason;
          if (pendingText) {
            const isIntermediate = stopReason === 'tool_use';
            events.push({ type: 'text_complete', text: pendingText, isIntermediate, turnId: turnId || undefined });
            setPendingText(null);
          }
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          events.push({ type: 'text_delta', text: event.delta.text, turnId: turnId || undefined });
        } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          const toolBlock = event.content_block;
          // Only emit if not already emitted
          if (!emittedToolStarts.has(toolBlock.id)) {
            emittedToolStarts.add(toolBlock.id);
            pendingToolUses.set(toolBlock.id, {
              name: toolBlock.name,
              input: {},
            });

            // Register tool in parent-child hierarchy (see main docs above)
            // Must happen here (stream_event) because it arrives before assistant message
            const { PARENT_TOOL_NAMES, activeParentTools, parentToChildren, childToParent } = parentChildTracking;
            const isParentTool = PARENT_TOOL_NAMES.includes(toolBlock.name);

            // SDK provides parent_tool_use_id on stream events for tools running inside Task
            // This is the authoritative source - use it when available
            const sdkParentId = message.parent_tool_use_id;

            // Debug: log what SDK provides for parent tracking
            console.log(`[CraftAgent] TOOL START: ${toolBlock.name} (${toolBlock.id}), sdk_parent=${sdkParentId}, activeParents=[${Array.from(activeParentTools).join(',')}]`);

            let parentToolUseId: string | undefined;
            if (isParentTool) {
              // This is a parent tool (Task, TaskOutput) - it can spawn children
              activeParentTools.add(toolBlock.id);
              parentToChildren.set(toolBlock.id, []);
              console.log(`[CraftAgent] PARENT REGISTERED (stream): ${toolBlock.name} (${toolBlock.id})`);
            } else if (sdkParentId && activeParentTools.has(sdkParentId)) {
              // SDK provides correct parent for subagent tools - use it
              parentToolUseId = sdkParentId;
              parentToChildren.get(sdkParentId)?.push(toolBlock.id);
              childToParent.set(toolBlock.id, sdkParentId);
              console.log(`[CraftAgent] CHILD REGISTERED (stream/sdk): ${toolBlock.name} (${toolBlock.id}) under parent ${sdkParentId}`);
            } else if (activeParentTools.size === 1) {
              // Single active parent - unambiguous, assign directly
              const parentId = Array.from(activeParentTools)[0]!;
              parentToChildren.get(parentId)?.push(toolBlock.id);
              childToParent.set(toolBlock.id, parentId);
              parentToolUseId = parentId;
              console.log(`[CraftAgent] CHILD REGISTERED (stream/single-parent): ${toolBlock.name} (${toolBlock.id}) under parent ${parentId}`);
            } else if (activeParentTools.size > 1) {
              // Multiple active parents - use SDK's parent_tool_use_id (authoritative source)
              // sdkParentId is already extracted above from message.parent_tool_use_id
              if (sdkParentId && activeParentTools.has(sdkParentId)) {
                parentToChildren.get(sdkParentId)?.push(toolBlock.id);
                childToParent.set(toolBlock.id, sdkParentId);
                parentToolUseId = sdkParentId;
                console.log(`[CraftAgent] CHILD REGISTERED (stream/sdk-parent): ${toolBlock.name} (${toolBlock.id}) → Task (${sdkParentId})`);
              } else {
                // Fallback: FIFO if SDK doesn't provide parent
                const parentId = Array.from(activeParentTools)[0]!;
                parentToChildren.get(parentId)?.push(toolBlock.id);
                childToParent.set(toolBlock.id, parentId);
                parentToolUseId = parentId;
                console.log(`[CraftAgent] CHILD REGISTERED (stream/fifo-fallback): ${toolBlock.name} (${toolBlock.id}) → ${parentId} (sdk_parent=${sdkParentId})`);
              }
            }
            // else: no active parents - tool is top-level, no parent needed

            events.push({
              type: 'tool_start',
              toolName: toolBlock.name,
              toolUseId: toolBlock.id,
              input: {},
              turnId: turnId || undefined,
              parentToolUseId,
            });
          }
        }
        break;
      }

      case 'user': {
        // Skip replayed messages when resuming a session - they're historical
        if ('isReplay' in message && message.isReplay) {
          break;
        }

        // Debug: log user message structure for tool results
        if (this.onDebug && 'parent_tool_use_id' in message) {
          const hasResult = 'tool_use_result' in message && message.tool_use_result !== undefined;
          this.onDebug(`User message for tool ${message.parent_tool_use_id}: hasResult=${hasResult}, pendingTools=${pendingToolUses.size}`);
        }

        // ─────────────────────────────────────────────────────────────────────────
        // TOOL RESULT MATCHING
        // ─────────────────────────────────────────────────────────────────────────
        // Three cases to handle:
        //
        // Case 1: parent_tool_use_id is a PARENT tool (Task, TaskOutput)
        //   → Result is for a CHILD of that parent, match using FIFO
        //
        // Case 2: parent_tool_use_id is a regular tool ID
        //   → Result is for that tool directly
        //
        // Case 3: parent_tool_use_id is null (in-process MCP tools)
        //   → Use FIFO fallback with matchedToolIds to avoid double-matching
        // ─────────────────────────────────────────────────────────────────────────
        if (message.tool_use_result !== undefined) {
          let toolUseId = message.parent_tool_use_id;
          let toolUse: { name: string; input: Record<string, unknown> } | undefined;

          const { activeParentTools, parentToChildren, childToParent } = parentChildTracking;

          if (toolUseId && activeParentTools.has(toolUseId)) {
            // Case 1: parent_tool_use_id points to a PARENT tool (Task, TaskOutput)
            // This result is for a CHILD of that parent, not the parent itself
            // Match to the first unmatched child in FIFO order
            const children = parentToChildren.get(toolUseId);
            console.log(`[CraftAgent] RESULT MATCHING: parent=${toolUseId}, children.length=${children?.length || 0}`);
            if (children && children.length > 0) {
              const firstChild = children.shift()!; // Remove first child (FIFO)
              console.log(`[CraftAgent] MATCHED TO CHILD: ${firstChild}`);
              this.onDebug?.(`Matched child result: parent=${toolUseId}, child=${firstChild}`);
              toolUseId = firstChild;
              toolUse = pendingToolUses.get(toolUseId);
              // Clean up child-to-parent mapping
              childToParent.delete(firstChild);
            } else {
              // No more children in FIFO queue. But check if there are late-registered
              // children in childToParent that haven't received results yet.
              // This handles the race condition where children start after results arrive.
              const pendingChildId = Array.from(childToParent.entries())
                .find(([_, parentId]) => parentId === toolUseId)?.[0];

              if (pendingChildId) {
                // Match to a pending late-started child
                console.log(`[CraftAgent] MATCHED TO LATE CHILD: ${pendingChildId} (parent=${toolUseId})`);
                this.onDebug?.(`Matched late child result: parent=${toolUseId}, child=${pendingChildId}`);
                toolUseId = pendingChildId;
                toolUse = pendingToolUses.get(toolUseId);
                childToParent.delete(pendingChildId);
              } else {
                // Truly no more children - this is the parent's own result
                console.log(`[CraftAgent] NO CHILDREN LEFT - treating as parent's own result: ${toolUseId}`);
                this.onDebug?.(`Parent tool completing: ${toolUseId} (no more children)`);
                toolUse = pendingToolUses.get(toolUseId);
                // Clean up parent tracking
                activeParentTools.delete(toolUseId);
                parentToChildren.delete(toolUseId);
              }
            }
          } else if (toolUseId) {
            // Case 2: parent_tool_use_id points to a tool we don't recognize as a parent
            // This could be: (a) a regular tool's own result, or
            // (b) a child result for a parent that already completed
            // First check if this is a child result for a completed parent
            const pendingChildId = Array.from(childToParent.entries())
              .find(([_, parentId]) => parentId === toolUseId)?.[0];

            if (pendingChildId) {
              // This is a child result for a completed parent - match to the pending child
              console.log(`[CraftAgent] MATCHED TO ORPHANED CHILD: ${pendingChildId} (parent=${toolUseId})`);
              this.onDebug?.(`Matched orphaned child result: parent=${toolUseId}, child=${pendingChildId}`);
              toolUseId = pendingChildId;
              toolUse = pendingToolUses.get(toolUseId);
              childToParent.delete(pendingChildId);
            } else {
              // Regular tool result - parent_tool_use_id is the tool's own ID
              toolUse = pendingToolUses.get(toolUseId);
            }
          } else if (pendingToolUses.size > 0) {
            // Case 3: parent_tool_use_id is null (in-process MCP tools)
            // Match with first pending tool not yet matched (FIFO)
            for (const [id, use] of pendingToolUses.entries()) {
              if (!matchedToolIds.has(id)) {
                toolUseId = id;
                toolUse = use;
                matchedToolIds.add(id);
                this.onDebug?.(`Matched null parent_tool_use_id to pending tool: ${toolUseId} (${toolUse.name})`);
                break;
              }
            }
          }

          if (toolUseId) {
            // Safely stringify result, handling circular references
            let resultStr: string;
            if (typeof message.tool_use_result === 'string') {
              resultStr = message.tool_use_result;
            } else {
              try {
                resultStr = JSON.stringify(message.tool_use_result, null, 2);
              } catch {
                resultStr = '[Result contains non-serializable data]';
              }
            }

            // Check if result indicates an error
            const isError = this.isToolResultError(message.tool_use_result);

            events.push({
              type: 'tool_result',
              toolUseId,
              result: resultStr,
              isError,
              input: toolUse?.input,
              turnId: turnId || undefined,
              // Include original parent_tool_use_id for parent-child tracking
              parentToolUseId: message.parent_tool_use_id || undefined,
            });

            // Clean up activeParentTools when a Task completes.
            // This is critical: Task results arrive with parent_tool_use_id=null (main agent level),
            // so they enter Case 3 (FIFO matching), not Case 1 where cleanup normally happens.
            // Without this, the Task stays in activeParentTools and subsequent main-agent tools
            // get incorrectly assigned as children of the completed Task.
            if (toolUse?.name === 'Task' && toolUseId) {
              activeParentTools.delete(toolUseId);
              parentToChildren.delete(toolUseId);
              console.log(`[CraftAgent] PARENT CLEANED UP (task-result): ${toolUseId}`);
            }

            // Detect background task start - Task tool with agent_id in result
            if (toolUse?.name === 'Task' && !isError && resultStr) {
              const agentIdMatch = resultStr.match(/agentId:\s*([a-zA-Z0-9_-]+)/);
              if (agentIdMatch && agentIdMatch[1]) {
                const taskId = agentIdMatch[1];
                // Extract intent from tool input if available
                const intentValue = toolUse.input._intent;
                const event: AgentEvent = intentValue && typeof intentValue === 'string'
                  ? {
                      type: 'task_backgrounded',
                      toolUseId,
                      taskId,
                      intent: intentValue,
                      turnId: turnId || undefined,
                    }
                  : {
                      type: 'task_backgrounded',
                      toolUseId,
                      taskId,
                      turnId: turnId || undefined,
                    };
                events.push(event);
              }
            }

            // Detect background shell start - Bash tool with shell_id or backgroundTaskId in result
            if (toolUse?.name === 'Bash' && !isError && resultStr) {
              // Match both old format (shell_id: xxx) and new JSON format ("backgroundTaskId": "xxx")
              const shellIdMatch = resultStr.match(/shell_id:\s*([a-zA-Z0-9_-]+)/)
                || resultStr.match(/"backgroundTaskId":\s*"([a-zA-Z0-9_-]+)"/);
              if (shellIdMatch && shellIdMatch[1]) {
                const shellId = shellIdMatch[1];
                // Extract intent from tool input if available
                const intentValue = (typeof toolUse.input._intent === 'string' && toolUse.input._intent)
                  || (typeof toolUse.input.description === 'string' && toolUse.input.description)
                  || undefined;
                // Extract command for process killing
                const commandValue = typeof toolUse.input.command === 'string' ? toolUse.input.command : undefined;
                const event: AgentEvent = {
                  type: 'shell_backgrounded',
                  toolUseId,
                  shellId,
                  turnId: turnId || undefined,
                  ...(intentValue && { intent: intentValue }),
                  ...(commandValue && { command: commandValue }),
                };
                events.push(event);
              }
            }

            // Detect shell killed - KillShell tool was called (success or "not found" both mean shell is gone)
            if (toolUse?.name === 'KillShell') {
              const shellId = toolUse.input.shell_id as string;
              if (shellId) {
                events.push({
                  type: 'shell_killed',
                  shellId,
                  turnId: turnId || undefined,
                });
              }
            }

            pendingToolUses.delete(toolUseId);
            matchedToolIds.delete(toolUseId);
          }
        }
        break;
      }

      case 'tool_progress': {
        // tool_progress events are emitted for subagent child tools
        // These contain the correct parent_tool_use_id for tracking hierarchy
        const progress = message as {
          tool_use_id: string;
          tool_name: string;
          parent_tool_use_id: string | null;
          elapsed_time_seconds?: number;
        };

        // Debug: log tool_progress structure
        console.log(`[CraftAgent] tool_progress: tool=${progress.tool_name} (${progress.tool_use_id}), parent=${progress.parent_tool_use_id}, elapsed=${progress.elapsed_time_seconds}`);

        // Forward elapsed time to UI for live progress updates
        // Use parent_tool_use_id if this is a child tool, so progress updates the parent Task
        if (progress.elapsed_time_seconds !== undefined) {
          events.push({
            type: 'task_progress',
            toolUseId: progress.parent_tool_use_id || progress.tool_use_id,
            elapsedSeconds: progress.elapsed_time_seconds,
            turnId: turnId || undefined,
          });
        }

        // Check if this is a child tool we haven't seen yet
        if (!emittedToolStarts.has(progress.tool_use_id)) {
          emittedToolStarts.add(progress.tool_use_id);
          pendingToolUses.set(progress.tool_use_id, {
            name: progress.tool_name,
            input: {},
          });

          // Track parent-child relationship using SDK's parent_tool_use_id (authoritative source)
          const { PARENT_TOOL_NAMES, activeParentTools, parentToChildren, childToParent } = parentChildTracking;
          const isParentTool = PARENT_TOOL_NAMES.includes(progress.tool_name);

          let parentToolUseId: string | undefined;
          if (!isParentTool && progress.parent_tool_use_id && activeParentTools.has(progress.parent_tool_use_id)) {
            // This is a child tool with correct parent from SDK
            parentToolUseId = progress.parent_tool_use_id;
            parentToChildren.get(progress.parent_tool_use_id)?.push(progress.tool_use_id);
            childToParent.set(progress.tool_use_id, progress.parent_tool_use_id);
            console.log(`[CraftAgent] CHILD REGISTERED (tool_progress/sdk): ${progress.tool_name} (${progress.tool_use_id}) → ${progress.parent_tool_use_id}`);
          }

          // Emit tool_start for this child tool
          events.push({
            type: 'tool_start',
            toolName: progress.tool_name,
            toolUseId: progress.tool_use_id,
            input: {},
            turnId: turnId || undefined,
            parentToolUseId,
          });
        }
        break;
      }

      case 'result': {
        // Debug: log result message details (stderr to avoid SDK JSON pollution)
        console.error(`[CraftAgent] result message: subtype=${message.subtype}, errors=${'errors' in message ? JSON.stringify((message as any).errors) : 'none'}`);

        // Get contextWindow from modelUsage (this is correct - it's the model's context window size)
        const modelUsageEntries = Object.values(message.modelUsage || {});
        const primaryModelUsage = modelUsageEntries[0];

        // Cache contextWindow for real-time usage_update events in subsequent turns
        if (primaryModelUsage?.contextWindow) {
          this.cachedContextWindow = primaryModelUsage.contextWindow;
        }

        // Use lastAssistantUsage for context window display (per-message, not cumulative)
        // result.modelUsage is cumulative across the entire session (for billing)
        // but we need the actual current context size from the last assistant message
        // See: https://github.com/anthropics/claude-agent-sdk-typescript/issues/66
        let inputTokens: number;
        let cacheRead: number;
        let cacheCreation: number;

        if (this.lastAssistantUsage) {
          // Use tracked per-message usage (correct for context display)
          inputTokens = this.lastAssistantUsage.input_tokens +
                        this.lastAssistantUsage.cache_read_input_tokens +
                        this.lastAssistantUsage.cache_creation_input_tokens;
          cacheRead = this.lastAssistantUsage.cache_read_input_tokens;
          cacheCreation = this.lastAssistantUsage.cache_creation_input_tokens;
        } else {
          // Fallback to result.usage if no assistant message was tracked
          cacheRead = message.usage.cache_read_input_tokens ?? 0;
          cacheCreation = message.usage.cache_creation_input_tokens ?? 0;
          inputTokens = message.usage.input_tokens + cacheRead + cacheCreation;
        }

        const usage = {
          inputTokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          costUsd: message.total_cost_usd,
          contextWindow: primaryModelUsage?.contextWindow,
        };

        if (message.subtype === 'success') {
          events.push({ type: 'complete', usage });
        } else {
          // Error result - emit error then complete with whatever usage we have
          const errorMsg = 'errors' in message ? message.errors.join(', ') : 'Query failed';

          // Check for Windows SDK setup error (missing .claude/skills directory)
          const windowsError = buildWindowsSkillsDirError(errorMsg);
          if (windowsError) {
            events.push(windowsError);
          } else {
            events.push({ type: 'error', message: errorMsg });
          }
          events.push({ type: 'complete', usage });
        }
        break;
      }

      case 'system': {
        // System messages (init, compaction, status)
        if (message.subtype === 'init') {
          // Capture tools list from SDK init message
          if ('tools' in message && Array.isArray(message.tools)) {
            this.sdkTools = message.tools;
            this.onDebug?.(`SDK init: captured ${this.sdkTools.length} tools`);
          }
        } else if (message.subtype === 'compact_boundary') {
          events.push({
            type: 'info',
            message: 'Compacted Conversation',
          });
        } else if (message.subtype === 'status' && message.status === 'compacting') {
          events.push({ type: 'status', message: 'Compacting conversation...' });
        }
        break;
      }

      case 'auth_status': {
        if (message.error) {
          events.push({ type: 'error', message: `Auth error: ${message.error}. Try running /auth to re-authenticate.` });
        }
        break;
      }

      default: {
        // Log unhandled message types for debugging
        if (this.onDebug) {
          this.onDebug(`Unhandled SDK message type: ${(message as any).type}`);
        }
        break;
      }
    }

    return events;
  }

  /**
   * Check if a tool result indicates an error
   */
  private isToolResultError(result: unknown): boolean {
    if (result === null || result === undefined) {
      return false;
    }

    // Check for common error patterns in the result
    if (typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      // MCP error format
      if (obj.isError === true) return true;
      if (obj.error !== undefined) return true;
      // Content array with error type
      if (Array.isArray(obj.content)) {
        for (const item of obj.content) {
          if (typeof item === 'object' && item !== null) {
            const contentItem = item as Record<string, unknown>;
            if (contentItem.type === 'error') return true;
          }
        }
      }
    }

    // Check string results for error indicators
    if (typeof result === 'string') {
      const lower = result.toLowerCase();
      if (lower.startsWith('error:') || lower.startsWith('failed:')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a tool result error indicates a "tool not found" for an inactive source.
   * This is used to detect when Claude tries to call a tool from a source that exists
   * but isn't currently active, so we can auto-activate and retry.
   *
   * @returns The source slug, tool name, and input if this is an inactive source error, null otherwise
   */
  private detectInactiveSourceToolError(
    event: AgentEvent,
    pendingToolUses: Map<string, { name: string; input: unknown }>
  ): { sourceSlug: string; toolName: string; input: unknown } | null {
    if (event.type !== 'tool_result' || !event.isError) return null;

    const resultStr = typeof event.result === 'string' ? event.result : '';

    // Try to extract tool name from error message patterns:
    // - "No such tool available: mcp__slack__api_slack"
    // - "Error: Tool 'mcp__slack__api_slack' not found"
    let toolName: string | null = null;

    // Pattern 1: "No such tool available: {toolName}" or "No tool available: {toolName}"
    // Note: SDK wraps in XML tags like "</tool_use_error>", so we stop at '<' to avoid capturing the tag
    const noSuchToolMatch = resultStr.match(/No (?:such )?tool available:\s*([^\s<]+)/i);
    if (noSuchToolMatch?.[1]) {
      toolName = noSuchToolMatch[1];
    }

    // Pattern 2: "Tool '{toolName}' not found" or "Tool `{toolName}` not found"
    if (!toolName) {
      const toolNotFoundMatch = resultStr.match(/Tool\s+['"`]([^'"`]+)['"`]\s+not found/i);
      if (toolNotFoundMatch?.[1]) {
        toolName = toolNotFoundMatch[1];
      }
    }

    // Fallback: try pendingToolUses if we couldn't extract from error
    if (!toolName) {
      const toolUse = pendingToolUses.get(event.toolUseId);
      if (toolUse) {
        toolName = toolUse.name;
      }
    }

    if (!toolName) return null;

    // Check if it's an MCP tool (mcp__{slug}__{toolname})
    if (!toolName.startsWith('mcp__')) return null;

    const parts = toolName.split('__');
    if (parts.length < 3) return null;

    // parts[1] is guaranteed to exist since we checked parts.length >= 3
    const sourceSlug = parts[1]!;

    // Check if source exists but is inactive
    const sourceExists = this.allSources.some((s) => s.config.slug === sourceSlug);
    const isActive = this.activeSourceServerNames.has(sourceSlug);

    if (sourceExists && !isActive) {
      // Get input from pendingToolUses
      const toolUse = pendingToolUses.get(event.toolUseId);
      return { sourceSlug, toolName, input: toolUse?.input ?? {} };
    }

    return null;
  }

  clearHistory(): void {
    // Clear session to start fresh conversation
    this.sessionId = null;
    // Clear pinned state so next chat() will capture fresh values
    this.pinnedPreferencesPrompt = null;
    this.preferencesDriftNotified = false;
  }

  /**
   * Force-abort the current query using the SDK's AbortController.
   * This immediately stops processing (SIGTERM/SIGKILL) without waiting for graceful shutdown.
   * Use this when you need instant termination (e.g., queuing a new message).
   *
   * @param reason - Why the abort is happening (affects UI feedback)
   */
  forceAbort(reason: AbortReason = AbortReason.UserStop): void {
    this.lastAbortReason = reason;
    if (this.currentQueryAbortController) {
      this.currentQueryAbortController.abort(reason);
      this.currentQueryAbortController = null;
    }
    this.currentQuery = null;
  }

  getModel(): string {
    return this.config.model || DEFAULT_MODEL;
  }

  /**
   * Get the list of SDK tools (captured from init message)
   */
  getSdkTools(): string[] {
    return this.sdkTools;
  }

  setModel(model: string): void {
    this.config.model = model;
    // Note: Model change takes effect on the next query
  }

  getWorkspace(): Workspace {
    return this.config.workspace;
  }

  setWorkspace(workspace: Workspace): void {
    this.config.workspace = workspace;
    // Clear session when switching workspaces - caller should set session separately if needed
    this.sessionId = null;
    // Note: MCP proxy needs to be reinitialized by the caller (useAgent hook)
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  /**
   * Update the working directory for this agent's session.
   * Called when user changes the working directory in the UI.
   */
  updateWorkingDirectory(path: string): void {
    if (this.config.session) {
      this.config.session.workingDirectory = path;
    }
  }

  /**
   * Set source servers (user-defined sources)
   * These are MCP servers and API tools added via the source selector UI
   * @param mcpServers Pre-built MCP server configs with auth headers
   * @param apiServers In-process MCP servers for REST APIs
   * @param intendedSlugs Optional list of source slugs that should be considered active
   *                      (what the UI shows as active, even if build failed)
   */
  setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, ReturnType<typeof createSdkMcpServer>>,
    intendedSlugs?: string[]
  ): void {
    this.sourceMcpServers = mcpServers;
    this.sourceApiServers = apiServers;

    // Update the set of active source server names for tool blocking
    this.activeSourceServerNames = new Set([
      ...Object.keys(mcpServers),
      ...Object.keys(apiServers),
    ]);

    // Update intended active slugs (defaults to what actually built if not specified)
    this.intendedActiveSlugs = new Set(intendedSlugs ?? [...this.activeSourceServerNames]);

    this.onDebug?.(`Active source servers: ${[...this.activeSourceServerNames].join(', ') || 'none'}`);
    if (intendedSlugs && intendedSlugs.length !== this.activeSourceServerNames.size) {
      const failed = intendedSlugs.filter(s => !this.activeSourceServerNames.has(s));
      if (failed.length > 0) {
        this.onDebug?.(`Sources with failed builds: ${failed.join(', ')}`);
      }
    }
  }

  /**
   * Check if a source server is currently active (enabled and authenticated)
   * Used by PreToolUse hook to block tools from disabled sources
   */
  isSourceServerActive(serverName: string): boolean {
    return this.activeSourceServerNames.has(serverName);
  }

  /**
   * Get the set of active source server names
   * Used to inform the agent about available sources
   */
  getActiveSourceServerNames(): Set<string> {
    return this.activeSourceServerNames;
  }

  /**
   * Set all sources in the workspace (for context injection)
   * Called by Electron to provide full source list including disabled sources
   */
  setAllSources(sources: LoadedSource[]): void {
    this.allSources = sources;
  }

  /**
   * Get all sources in the workspace
   */
  getAllSources(): LoadedSource[] {
    return this.allSources;
  }

  /**
   * Mark a source as unseen so its guide will be re-injected on next message.
   * Call this after re-authentication or when source state changes significantly.
   */
  markSourceUnseen(slug: string): void {
    this.knownSourceSlugs.delete(slug);
  }

  /**
   * Set temporary clarifications that are injected into the system prompt
   * but not yet persisted to the Craft document
   */
  setTemporaryClarifications(text: string | null): void {
    this.temporaryClarifications = text;
  }

  /**
   * Get filtered source MCP servers based on local MCP setting
   * @returns Object with filtered servers and names of any skipped stdio servers
   */
  private getSourceMcpServersFiltered(): { servers: Record<string, SdkMcpServerConfig>; skipped: string[] } {
    return this.filterMcpServersByLocalEnabled(this.sourceMcpServers);
  }

  /**
   * Filter MCP servers based on whether local (stdio) MCP is enabled for this workspace.
   * When local MCP is disabled, stdio servers are filtered out.
   *
   * @returns Object with filtered servers and names of any skipped stdio servers
   */
  private filterMcpServersByLocalEnabled(
    servers: Record<string, SdkMcpServerConfig>
  ): { servers: Record<string, SdkMcpServerConfig>; skipped: string[] } {
    const localEnabled = isLocalMcpEnabled(this.workspaceRootPath);

    if (localEnabled) {
      // Local MCP is enabled, return all servers
      return { servers, skipped: [] };
    }

    // Local MCP is disabled, filter out stdio servers
    const filtered: Record<string, SdkMcpServerConfig> = {};
    const skipped: string[] = [];
    for (const [name, config] of Object.entries(servers)) {
      if (config.type !== 'stdio') {
        filtered[name] = config;
      } else {
        debug(`[filterMcpServers] Filtering out stdio server "${name}" (local MCP disabled)`);
        skipped.push(name);
      }
    }
    return { servers: filtered, skipped };
  }

  async close(): Promise<void> {
    this.forceAbort();
  }

  /**
   * Dispose the agent instance and clean up all resources.
   * Called when the session ends (component unmount).
   * Clears all instance state and module-level callbacks that reference this instance.
   */
  dispose(): void {
    // Stop any running query
    this.forceAbort();

    // Clear pending operations
    this.pendingPermissions.clear();

    // Clear security whitelists
    this.alwaysAllowedCommands.clear();
    this.alwaysAllowedDomains.clear();

    // Clear pinned system prompt state
    this.pinnedPreferencesPrompt = null;
    this.preferencesDriftNotified = false;

    // Clear callbacks
    this.onPermissionRequest = null;
    this.onDebug = null;
    this.onPlanSubmitted = null;
    this.onAuthRequest = null;
    this.onSourceChange = null;
    this.onSourcesListChange = null;
    this.onConfigValidationError = null;
    this.onSourceActivationRequest = null;

    // Stop config watcher
    this.stopConfigWatcher();

    // Clean up session-specific state
    const configSessionId = this.config.session?.id;
    if (configSessionId) {
      cleanupModeState(configSessionId);
      cleanupSessionScopedTools(configSessionId);
    }

    // Clear session
    this.sessionId = null;
  }
}
