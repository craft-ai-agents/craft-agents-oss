import { query, createSdkMcpServer, tool, AbortError, type Query, type SDKMessage, type SDKUserMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from './options.ts';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { z } from 'zod';
import { getSystemPrompt, getDateTimeContext, getWorkingDirectoryContext } from '../prompts/system.ts';
// Plan types are used by UI components; not needed in craft-agent.ts since Safe Mode is user-controlled
import { parseError, type AgentError } from './errors.ts';
import { runErrorDiagnostics } from './diagnostics.ts';
import { shouldUseExtendedCacheTtl, loadStoredConfig, getDefaultPermissionMode, type Workspace } from '../config/storage.ts';
import { isLocalMcpEnabled } from '../workspaces/storage.ts';
import { loadPlanFromPath, type SessionConfig as Session } from '../sessions/storage.ts';
import { DEFAULT_MODEL } from '../config/models.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { updatePreferences, loadPreferences, formatPreferencesForPrompt, type UserPreferences } from '../config/preferences.ts';
import type { FileAttachment } from '../utils/files.ts';
import { debug } from '../utils/debug.ts';
import { estimateTokens, summarizeLargeResult, TOKEN_LIMIT } from '../utils/summarize.ts';
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
import type { PermissionsContext } from './permissions-config.ts';
import { getSessionPlansPath } from '../sessions/storage.ts';
import { expandPath } from '../utils/paths.ts';
import {
  ConfigWatcher,
  createConfigWatcher,
  type ConfigWatcherCallbacks,
} from '../config/watcher.ts';
import type { ValidationIssue } from '../config/validators.ts';
import type { LoadedSource } from '../sources/types.ts';

// Re-export permission mode functions for TUI/Electron usage
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
}

export interface CraftAgentConfig {
  workspace: Workspace;
  session?: Session;           // Current session (primary isolation boundary)
  mcpToken?: string;           // Override token (for testing)
  model?: string;
  onSdkSessionIdUpdate?: (sdkSessionId: string) => void;  // Callback when SDK session ID is captured
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

/**
 * Detects internal SDK errors that should NOT be shown to users.
 *
 * ## Why This Exists
 *
 * The Claude Agent SDK runs as a subprocess and handles various internal operations
 * like telemetry, event logging, and analytics. When these internal systems fail
 * (e.g., network issues, rate limits, server errors), the SDK propagates these
 * errors through its event stream.
 *
 * These errors are NOT user-actionable - they're internal SDK plumbing that users
 * cannot fix or do anything about. Showing them in the UI:
 * 1. Confuses users with technical jargon ("1P event logging", "export failed")
 * 2. Makes the app appear broken when it's actually functioning normally
 * 3. Pollutes the conversation history with irrelevant error messages
 *
 * ## Known Internal Error Patterns
 *
 * - "1P event logging: X events failed to export" - Anthropic's first-party
 *   telemetry system failed to send usage/analytics data. Does not affect
 *   the actual AI conversation.
 *
 * - "Failed to export N events" - Generic export failure, usually telemetry.
 *
 * ## Maintenance Note
 *
 * When new internal SDK errors are discovered appearing in the UI, add them
 * to the patterns array below. Always log filtered errors to debug so they
 * can still be investigated when troubleshooting with --debug flag.
 */
function isInternalSDKError(message: string): boolean {
  // Patterns that indicate internal SDK errors (not user-facing issues)
  const internalErrorPatterns = [
    '1p event logging',       // Anthropic's first-party telemetry system
    'events failed to export', // Telemetry export failures
    'failed to export',       // Generic export failures (case variations)
  ];

  const lowerMsg = message.toLowerCase();
  return internalErrorPatterns.some((pattern) => lowerMsg.includes(pattern));
}

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

// Handler set by TUI to receive permission requests
let globalPermissionHandler: ((request: { requestId: string; toolName: string; command: string; description: string }) => void) | null = null;

/**
 * Set the global permission request handler (called by TUI)
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
 * Resolve a pending global permission request (called by TUI)
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
  // Map tool_use_id → explicit intent from _intent field (for summarization and UI display)
  private toolIntents: Map<string, string> = new Map();
  // Map tool_use_id → display name from _displayName field (for UI tool name display)
  private toolDisplayNames: Map<string, string> = new Map();
  // Safe mode state - user-controlled read-only exploration mode
  private safeMode: boolean = false;
  // SDK tools list (captured from init message)
  private sdkTools: string[] = [];
  // Ultrathink mode - when enabled, sets maxThinkingTokens for extended reasoning
  private ultrathinkMode: boolean = false;
  // Config file watcher for hot-reloading source changes
  private configWatcher: ConfigWatcher | null = null;
  // Pinned system prompt components (captured on first chat, used for consistency after compaction)
  private pinnedPreferencesPrompt: string | null = null;
  // Track if preference drift notification has been shown this session
  private preferencesDriftNotified: boolean = false;
  // Captured stderr from SDK subprocess (for error diagnostics when process exits with code 1)
  private lastStderrOutput: string[] = [];

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

  // Callback for permission requests - set by TUI to receive permission prompts
  public onPermissionRequest: ((request: { requestId: string; toolName: string; command: string; description: string; type?: 'bash' }) => void) | null = null;

  // Debug callback for status messages
  public onDebug: ((message: string) => void) | null = null;

  /** Callback when permission mode changes */
  public onPermissionModeChange: ((mode: PermissionMode) => void) | null = null;

  // Callback when a plan is submitted - set by TUI to display plan message
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


  constructor(config: CraftAgentConfig) {
    this.config = config;
    this.isHeadless = config.isHeadless ?? false;

    // Initialize sessionId from session config for conversation resumption
    if (config.session?.sdkSessionId) {
      this.sessionId = config.session.sdkSessionId;
    }

    // Initialize permission mode state with callbacks
    const sessionId = this.modeSessionId;
    // Get initial mode: from session, or from global default
    const initialMode: PermissionMode = config.session?.permissionMode ?? getDefaultPermissionMode();

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
   * Enable or disable ultrathink mode
   * When enabled, maxThinkingTokens will be set for extended reasoning
   */
  setUltrathinkMode(enabled: boolean): void {
    this.ultrathinkMode = enabled;
    this.onDebug?.(`[CraftAgent] Ultrathink mode: ${enabled ? 'ENABLED' : 'disabled'}`);
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

      // Notify TUI of permission request via callback (not event yield)
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

      // Clear intent and display name maps for new turn
      this.toolIntents.clear();
      this.toolDisplayNames.clear();

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

      // Block SDK's plan mode tools (we don't use them - safe mode is user-controlled)
      const disallowedTools: string[] = ['EnterPlanMode', 'ExitPlanMode'];

      // Build MCP servers config - always use HTTP (SDK handles sources efficiently)
      // Filter out stdio servers if local MCP is disabled
      const sourceMcpResult = this.getSourceMcpServersFiltered();

      debug('[chat] sourceMcpServers:', sourceMcpResult.servers);
      debug('[chat] sourceApiServers:', this.sourceApiServers);

      const mcpServers: Options['mcpServers'] = {
        preferences: getPreferencesServer(false),
        // Session-scoped tools (SubmitPlan, source_test, etc.)
        session: getSessionScopedTools(sessionId, this.workspaceRootPath),
        // Add user-defined source servers (MCP and API, filtered by local MCP setting)
        // Note: Craft MCP server is now added via sources system
        ...sourceMcpResult.servers,
        ...this.sourceApiServers,
      };
      
      // Configure SDK options
      const model = this.config.model || DEFAULT_MODEL;
      const useExtendedCache = shouldUseExtendedCacheTtl(model);

      // Determine maxThinkingTokens based on model when ultrathink is enabled
      // Opus/Sonnet support up to 128k, Haiku up to 8k
      const getUltrathinkTokens = (modelName: string): number => {
        const lowerModel = modelName.toLowerCase();
        if (lowerModel.includes('haiku')) return 8000;
        return 64000; // Opus and Sonnet
      };

      // NOTE: Parent-child tracking for subagents is documented below (search for
      // "PARENT-CHILD TOOL TRACKING"). The SDK's parent_tool_use_id is authoritative.

      // Clear stderr buffer at start of each query
      this.lastStderrOutput = [];

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
        // Enable extended prompt cache TTL (1 hour instead of 5 minutes) when configured
        // The actual TTL injection happens in src/cache-ttl-interceptor.ts
        ...(useExtendedCache ? { betas: ['extended-cache-ttl-2025-04-11'] as any } : {}),
        // Extended thinking: set tokens based on model when ultrathink mode is active, otherwise 0
        maxThinkingTokens: this.ultrathinkMode ? getUltrathinkTokens(model) : 0,
        // Option A: Append to Claude Code's system prompt (recommended by docs)
        // Use pinned values for consistency after compaction (SDK expects stable system prompt)
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: getSystemPrompt(
            this.pinnedPreferencesPrompt ?? undefined,
            this.config.debugMode,
            this.workspaceRootPath
          ),
        },
        cwd: this.config.session?.workingDirectory ?? process.cwd(),
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
              // SOURCE BLOCKING: Block tools from disabled sources
              // Sources can be disabled mid-conversation, so we check
              // against the current active source set on each tool call
              // ============================================================
              if (input.tool_name.startsWith('mcp__')) {
                // Extract server name from tool name (mcp__<server>__<tool>)
                const parts = input.tool_name.split('__');
                const serverName = parts[1];
                if (parts.length >= 3 && serverName) {
                  // Built-in MCP servers that are always available (session-scoped tools)
                  const builtInMcpServers = new Set(['preferences', 'session']);

                  // Check if this is a source server (not built-in)
                  if (!builtInMcpServers.has(serverName)) {
                    // Check if source server is active
                    const isActive = this.activeSourceServerNames.has(serverName);
                    if (!isActive) {
                      this.onDebug?.(`BLOCKED source tool: ${input.tool_name} (source "${serverName}" is no longer available)`);
                      return {
                        continue: false,
                        decision: 'block' as const,
                        reason: `Source "${serverName}" is no longer available. The source may have been disabled or its credentials expired. Please check the source status and re-enable it if needed.`,
                      };
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

              // Built-in SDK tools (don't extract _intent from these)
              const builtInTools = new Set([
                'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
                'WebFetch', 'WebSearch', 'Task', 'TaskOutput',
                'TodoWrite', 'MultiEdit', 'NotebookEdit', 'KillShell',
                'SubmitPlan', 'Skill', 'SlashCommand',
              ]);

              // Extract _intent and _displayName from MCP tool inputs (not built-in SDK tools)
              if (!builtInTools.has(input.tool_name)) {
                const toolInput = input.tool_input as Record<string, unknown>;
                const intent = toolInput._intent as string | undefined;
                const displayName = toolInput._displayName as string | undefined;

                // Store metadata if present
                if (intent) {
                  this.toolIntents.set(input.tool_use_id, intent);
                  this.onDebug?.(`Extracted intent for ${input.tool_use_id}: ${intent}`);
                }
                if (displayName) {
                  this.toolDisplayNames.set(input.tool_use_id, displayName);
                  this.onDebug?.(`Extracted displayName for ${input.tool_use_id}: ${displayName}`);
                }

                // Strip metadata fields before forwarding to MCP server
                if (intent || displayName) {
                  const { _intent, _displayName, ...cleanInput } = toolInput;

                  // Return with updatedInput to strip metadata before forwarding to MCP
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
                const isReadOnly = SAFE_MODE_CONFIG.readOnlyBashPatterns.some(pattern => pattern.test(commandStr.trim()));
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
          // PostToolUse hook to summarize large MCP tool results
          PostToolUse: [{
            hooks: [async (input) => {
              // Only handle PostToolUse events
              if (input.hook_event_name !== 'PostToolUse') {
                return { continue: true };
              }

              // Note: EnterPlanMode/ExitPlanMode are disallowed (line ~811) since Safe Mode is user-controlled.
              // The agent uses SubmitPlan (universal) to submit plans at any time.

              // Skip built-in SDK tools (they have their own context management)
              const builtInTools = new Set([
                'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
                'WebFetch', 'WebSearch', 'Task',
                'TodoWrite', 'MultiEdit', 'NotebookEdit', 'KillShell',
                'SubmitPlan', 'Skill', 'SlashCommand',
              ]);

              // Skip in-process MCP tools (preferences)
              const inProcessTools = new Set([
                'update_user_preferences',
              ]);

              // Skip API tools - they already handle summarization internally
              if (builtInTools.has(input.tool_name) ||
                  inProcessTools.has(input.tool_name) ||
                  input.tool_name.startsWith('api_')) {
                return { continue: true };
              }

              // For MCP tools, always clean up stored intent after processing
              // Use try/finally to ensure cleanup even on early returns or errors
              try {
                // Check if response is large enough to warrant summarization
                const response = input.tool_response;
                let responseStr: string;
                try {
                  responseStr = typeof response === 'string'
                    ? response
                    : JSON.stringify(response);
                } catch {
                  // Response has circular references or can't be stringified
                  // Skip summarization for non-serializable responses
                  return { continue: true };
                }

                const tokens = estimateTokens(responseStr);
                if (tokens <= TOKEN_LIMIT) {
                  return { continue: true };
                }

                this.onDebug?.(`PostToolUse: ${input.tool_name} response too large (~${tokens} tokens), summarizing...`);

                // Get explicit intent for this tool call (from _intent field, extracted by PreToolUse hook)
                const explicitIntent = this.toolIntents.get(input.tool_use_id);
                this.onDebug?.(`PostToolUse: Using intent for summarization: ${explicitIntent || '(none - will use tool params)'}`);

                try {
                  const summary = await summarizeLargeResult(responseStr, {
                    toolName: input.tool_name,
                    input: input.tool_input as Record<string, unknown>,
                    // Use explicit intent if available - otherwise summarizer uses tool name/params
                    modelIntent: explicitIntent,
                  });

                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PostToolUse' as const,
                      updatedMCPToolOutput: `[Large result (~${tokens} tokens) was summarized to fit context. ` +
                        `If key details are missing, consider re-calling with more specific filters or pagination.]\n\n${summary}`,
                    },
                  };
                } catch (error) {
                  debug(`[PostToolUse] Summarization failed for ${input.tool_name}: ${error}`);
                  // On error, truncate rather than fail
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PostToolUse' as const,
                      updatedMCPToolOutput: responseStr.substring(0, 40000) + '\n\n[Result truncated due to size]',
                    },
                  };
                }
              } finally {
                // Always clean up stored metadata for MCP tools to prevent memory leak
                this.toolIntents.delete(input.tool_use_id);
                this.toolDisplayNames.delete(input.tool_use_id);
              }
            }],
          }],
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
        // Custom permission handler for Bash commands
        canUseTool: async (toolName, input, toolOptions) => {
          // Debug: show what tools are being called
          this.onDebug?.(`canUseTool: ${toolName}`);

          // Bash commands require user permission
          if (toolName === 'Bash') {
            const result = await this.checkToolPermission(toolName, input as Record<string, unknown>, toolOptions.toolUseID);
            if (result.allowed) {
              return { behavior: 'allow' as const, updatedInput: result.updatedInput };
            } else {
              return { behavior: 'deny' as const, message: 'User denied permission' };
            }
          }

          // Auto-approve MCP tools and other allowed tools
          // Note: SDK plan mode tools (EnterPlanMode/ExitPlanMode) are blocked via disallowedTools
          // We use safe mode instead, which is user-controlled via UI (not agent-controlled)
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

      // Create the query - use AsyncIterable for messages with binary attachments
      if (hasBinaryAttachments) {
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
      try {
        for await (const message of this.currentQuery) {
          // Capture session ID for conversation continuity
          if ('session_id' in message && message.session_id) {
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
            if (event.type === 'complete') {
              receivedComplete = true;
            }
            yield event;
          }
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
          // Auth errors should surface immediately, not retry
          // Parse to typed error using the captured/processed error message
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
          errorMsg.includes('insufficient credits') ||
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
          if (isSessionExpired && wasResuming && !_isRetry) {
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

          // Run diagnostics to identify specific cause (2s timeout)
          const storedConfig = loadStoredConfig();
          const diagnostics = await runErrorDiagnostics({
            authType: storedConfig?.authType,
            workspaceId: this.config.workspace?.id,
            rawError: stderrContext || rawErrorMsg,
          });

          // Get recovery actions based on diagnostic code
          const actions = diagnostics.code === 'credits_exhausted'
            ? [
                { key: 'c', label: 'Top up credits', command: '/credits', action: 'credits' as const },
                { key: 's', label: 'Switch to API key', command: '/settings', action: 'settings' as const },
              ]
            : diagnostics.code === 'token_expired' || diagnostics.code === 'mcp_unreachable'
            ? [
                { key: 'w', label: 'Open workspace menu', command: '/workspace' },
                { key: 'r', label: 'Retry', action: 'retry' as const },
              ]
            : diagnostics.code === 'invalid_credentials'
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
              canRetry: diagnostics.code !== 'credits_exhausted' && diagnostics.code !== 'invalid_credentials',
              retryDelayMs: 1000,
              originalError: stderrContext || rawErrorMsg,
            },
          };
          yield { type: 'complete' };
          return;
        }

        // Session-related retry: only if we were resuming and haven't retried yet
        if (wasResuming && !_isRetry) {
          this.sessionId = null;
          // Clear pinned state so retry captures fresh values
          this.pinnedPreferencesPrompt = null;
          this.preferencesDriftNotified = false;

          // Provide context-aware message (conservative: only match explicit session/resume terms)
          const isSessionError =
            errorMsg.includes('session') ||
            errorMsg.includes('resume');

          const statusMessage = isSessionError
            ? 'Conversation sync failed, starting fresh...'
            : 'Request failed, retrying without history...';

          // Use 'info' instead of 'status' to show message without spinner
          yield { type: 'info', message: statusMessage };
          // Recursively call with isRetry=true (yield* delegates all events)
          yield* this.chat(userMessage, attachments, true);
          return;
        }

        // Retry also failed, or wasn't resuming - show generic error
        // (Auth, billing, and rate limit errors are handled above)
        const rawMessage = sdkError instanceof Error ? sdkError.message : String(sdkError);

        // Filter out internal SDK errors that shouldn't be shown to users.
        // These are internal SDK plumbing errors (telemetry, analytics, etc.) that:
        // 1. Users cannot fix or take action on
        // 2. Don't affect the actual AI conversation functionality
        // 3. Would only confuse users with technical internal error messages
        //
        // We still log them to debug for troubleshooting purposes.
        // See isInternalSDKError() for detailed documentation on what gets filtered.
        if (isInternalSDKError(rawMessage)) {
          debug(`[CraftAgent] Filtered internal SDK error: ${rawMessage}`);
          // Don't emit error event - silently complete
          // The agent can still function normally despite these internal failures
          yield { type: 'complete' };
          return;
        }

        yield { type: 'error', message: rawMessage };
        yield { type: 'complete' };
        return;
      }

    } catch (error) {
      // Debug: log outer catch trigger (stderr to avoid SDK JSON pollution)
      console.error(`[CraftAgent] OUTER CATCH triggered: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`[CraftAgent] Error stack: ${error instanceof Error ? error.stack : 'no stack'}`);

      // Extract error message for filtering check
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Filter out internal SDK errors that shouldn't be shown to users.
      // See isInternalSDKError() for detailed documentation on what gets filtered.
      if (isInternalSDKError(errorMessage)) {
        debug(`[CraftAgent] Filtered internal SDK error (outer catch): ${errorMessage}`);
        // Don't emit error event - silently complete
        yield { type: 'complete' };
        return;
      }

      // Check if this is a recognizable error type
      const typedError = parseError(error);
      if (typedError.code !== 'unknown_error') {
        // Known error type - show user-friendly message with recovery actions
        yield { type: 'typed_error', error: typedError };
      } else {
        // Unknown error - show raw message
        yield { type: 'error', message: errorMessage };
      }
      // emit complete even on error so TUI knows we're done
      yield { type: 'complete' };
    } finally {
      this.currentQuery = null;
      // Reset ultrathink mode after query completes (single-shot activation)
      this.ultrathinkMode = false;
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
    if (inactiveSources.length > 0) {
      const inactiveList = inactiveSources.map((s) => {
        const reason = !s.config.enabled
          ? 'disabled'
          : !s.config.isAuthenticated
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

    // Inject service knowledge for active sources (from bundled guides)
    // Only inject for sources not yet seen this session to avoid repetition
    if (unseenSources.length > 0) {
      const { getSourceKnowledge } = require('../docs/source-guides.ts');
      for (const s of unseenSources) {
        // Only inject for active sources
        if (this.intendedActiveSlugs.has(s.config.slug)) {
          const knowledge = getSourceKnowledge(s.config);
          if (knowledge) {
            output += `\n\n<source_context source="${s.config.slug}">\n${knowledge}\n</source_context>`;
          }
        }
      }
    }

    return output;
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

    // Add working directory context if set
    const workingDirContext = getWorkingDirectoryContext(this.config.session?.workingDirectory);
    if (workingDirContext) {
      parts.push(workingDirContext);
    }

    // Add file attachments with stored path info
    if (attachments) {
      for (const attachment of attachments) {
        // Always include path info for files with storedPath
        if (attachment.storedPath) {
          let pathInfo = `[Attached file: ${attachment.name}]`;
          pathInfo += `\n[Stored at: ${attachment.storedPath}]`;
          if (attachment.markdownPath) {
            pathInfo += `\n[Markdown version: ${attachment.markdownPath}]`;
          }
          parts.push(pathInfo);
        }

        // Also include inline content for text files
        if (attachment.type === 'text' && attachment.text) {
          parts.push(`\`\`\`\n${attachment.text}\n\`\`\``);
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

    // Add working directory context if set
    const workingDirContext = getWorkingDirectoryContext(this.config.session?.workingDirectory);
    if (workingDirContext) {
      contentBlocks.push({ type: 'text', text: workingDirContext });
    }

    // Add attachments with stored path info
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
        } else if (attachment.type === 'text' && attachment.text) {
          // Send text files as document blocks (not inline text) to:
          // - Avoid context overflow for large files
          // - Enable citation support (char_location)
          // - Consistent handling with PDFs
          // Include stored path in title for reference
          const titleWithPath = attachment.storedPath
            ? `${attachment.name} (stored at: ${attachment.storedPath})`
            : attachment.name;
          contentBlocks.push({
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: attachment.text,
            },
            title: titleWithPath,
          });
        }
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
      session_id: this.sessionId || '',
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
        // Skip replayed messages when resuming a session - they're historical
        if ('isReplay' in message && message.isReplay) {
          break;
        }

        // Full assistant message with content blocks
        const content = message.message.content;
        let textContent = '';

        for (const block of content) {
          if (block.type === 'text') {
            textContent += block.text;
          } else if (block.type === 'tool_use') {
            // Extract intent and displayName from the tool_use input for UI display
            // Note: PreToolUse hook also extracts and stores these for summarization
            // We only extract here for emitting in tool_start events (UI display)
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

        // Build usage info with all token types
        // Total input = input_tokens + cache_creation + cache_read
        const cacheRead = message.usage.cache_read_input_tokens ?? 0;
        const cacheCreation = message.usage.cache_creation_input_tokens ?? 0;
        const usage = {
          inputTokens: message.usage.input_tokens + cacheRead + cacheCreation,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          costUsd: message.total_cost_usd,
        };

        if (message.subtype === 'success') {
          events.push({ type: 'complete', usage });
        } else {
          // Error result - emit error then complete with whatever usage we have
          const errorMsg = 'errors' in message ? message.errors.join(', ') : 'Query failed';
          events.push({ type: 'error', message: errorMsg });
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
   * Called by Electron/TUI to provide full source list including disabled sources
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
