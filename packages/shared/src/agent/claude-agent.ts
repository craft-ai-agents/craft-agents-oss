import { query, createSdkMcpServer, tool, AbortError, type Query, type SDKUserMessage, type SDKAssistantMessageError, type Options, type SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions, resetClaudeConfigCheck } from './options.ts';
// Local type for SDK user message content blocks (text, image, document)
// Replaces import from @anthropic-ai/sdk/resources — keeps SDK as agent-only dependency
type ContentBlockParam =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };
import { z } from 'zod';
import { getSystemPrompt } from '../prompts/system.ts';
import { BaseAgent, type MiniAgentConfig, MINI_AGENT_TOOLS, MINI_AGENT_MCP_KEYS } from './base-agent.ts';
import type { BackendConfig, PostInitResult, PermissionRequestType, SdkMcpServerConfig } from './backend/types.ts';
// Plan types are used by UI components; not needed in craft-agent.ts since Safe Mode is user-controlled
import { parseError, type AgentError } from './errors.ts';
import { runErrorDiagnostics } from './diagnostics.ts';
import { loadStoredConfig, loadConfigDefaults, type Workspace, type AuthType, getDefaultLlmConnection, getLlmConnection } from '../config/storage.ts';
import { getValidClaudeOAuthToken } from '../auth/state.ts';
import { resolveAuthEnvVars } from '../config/llm-connections.ts';
import type { McpClientPool } from '../mcp/mcp-pool.ts';
import { loadPlanFromPath, type SessionConfig as Session } from '../sessions/storage.ts';
import { DEFAULT_MODEL, isClaudeModel, getDefaultSummarizationModel } from '../config/models.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { loadPreferences, formatPreferencesForPrompt } from '../config/preferences.ts';
import type { FileAttachment } from '../utils/files.ts';
import type { LLMQueryRequest, LLMQueryResult } from './llm-tool.ts';
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
import { type AutomationSystem, type SdkAutomationCallbackMatcher } from '../automations/index.ts';
import {
  getPermissionMode,
  setPermissionMode,
  cyclePermissionMode,
  initializeModeState,
  cleanupModeState,
  blockWithReason,
  type PermissionMode,
  PERMISSION_MODE_CONFIG,
  SAFE_MODE_CONFIG,
} from './mode-manager.ts';
import { getSessionPlansPath, getSessionPath } from '../sessions/storage.ts';
import { extractWorkspaceSlug } from '../utils/workspace.ts';
import {
  ConfigWatcher,
  createConfigWatcher,
  type ConfigWatcherCallbacks,
} from '../config/watcher.ts';
// Centralized PreToolUse pipeline
import {
  runPreToolUseChecks,
  type PreToolUseCheckResult,
  BUILT_IN_TOOLS,
} from './core/pre-tool-use.ts';
import { type ThinkingLevel, getThinkingTokens, DEFAULT_THINKING_LEVEL } from './thinking-levels.ts';
import type { LoadedSource } from '../sources/types.ts';
import { sourceNeedsAuthentication } from '../sources/credential-manager.ts';
import type {
  AgentBackend,
  ChatOptions,
  PermissionCallback,
  PlanCallback,
  AuthCallback,
  SourceChangeCallback,
  SourceActivationCallback,
} from './backend/types.ts';

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

// Stateless tool matching — pure functions for SDK message → AgentEvent conversion
import { ToolIndex } from './tool-matching.ts';

// Claude event adapter — extracts SDK message → AgentEvent conversion into testable class
import { ClaudeEventAdapter, buildWindowsSkillsDirError as buildWindowsSkillsDirErrorFn } from './backend/claude/event-adapter.ts';

// Re-export types for UI components
export type { LoadedSource } from '../sources/types.ts';

// Import and re-export AbortReason and RecoveryMessage from core module (single source of truth)
// Re-exported for backwards compatibility with existing imports from claude-agent.ts
import { AbortReason, type RecoveryMessage } from './core/index.ts';
export { AbortReason, type RecoveryMessage };

export interface ClaudeAgentConfig {
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
  /** System prompt preset for mini agents ('default' | 'mini' or custom string) */
  systemPromptPreset?: 'default' | 'mini' | string;
  /** Workspace-level AutomationSystem instance (shared across all agents in the workspace) */
  automationSystem?: AutomationSystem;
  /**
   * Per-session environment variable overrides for the SDK subprocess.
   * Used to pass connection-specific config like ANTHROPIC_BASE_URL that
   * must not be clobbered by concurrent sessions.
   */
  envOverrides?: Record<string, string>;
  /** Mini/utility model for summarization, title generation, and mini completions. */
  miniModel?: string;
  /** Centralized MCP client pool for source tool execution. */
  mcpPool?: McpClientPool;
  /** LLM connection slug for credential lookup in postInit(). */
  connectionSlug?: string;
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

/**
 * Create an in-process MCP server that proxies source tool calls through the McpClientPool.
 * This replaces direct MCP connections — the pool owns all source connections centrally.
 *
 * Returns a McpSdkServerConfigWithInstance that can be added to Options.mcpServers.
 */
function jsonPropToZod(prop: any): z.ZodTypeAny {
  if (prop.enum) return z.enum(prop.enum as [string, ...string[]]);
  switch (prop.type) {
    case 'string': return z.string();
    case 'number': case 'integer': return z.number();
    case 'boolean': return z.boolean();
    case 'array': return z.array(z.unknown());
    case 'object': return z.record(z.string(), z.unknown());
    default: return z.unknown();
  }
}

function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const properties = (schema.properties as Record<string, any>) || {};
  const required = new Set((schema.required as string[]) || []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType = jsonPropToZod(prop);
    if (prop.description) zodType = zodType.describe(prop.description);
    if (!required.has(key)) zodType = zodType.optional();
    shape[key] = zodType;
  }

  return shape;
}

/**
 * Create one SDK MCP server per connected source, using original tool names.
 * The SDK adds its own `mcp__{serverKey}__` prefix, so we use the source slug
 * as the server key and original tool names to get the correct final names
 * (e.g., `mcp__linear__createIssue`).
 */
function createSourceProxyServers(pool: McpClientPool): Record<string, ReturnType<typeof createSdkMcpServer>> {
  const servers: Record<string, ReturnType<typeof createSdkMcpServer>> = {};

  for (const slug of pool.getConnectedSlugs()) {
    const mcpTools = pool.getTools(slug);
    if (mcpTools.length === 0) continue;

    const proxyTools = mcpTools.map(mcpTool => {
      const proxyName = `mcp__${slug}__${mcpTool.name}`;
      return tool(
        mcpTool.name,
        mcpTool.description || `Tool from ${slug}`,
        {
          ...jsonSchemaToZodShape((mcpTool.inputSchema as Record<string, unknown>) || {}),
          ...z.object({}).catchall(z.unknown()).shape,
        },
        async (args: Record<string, unknown>) => {
          const result = await pool.callTool(proxyName, args);
          return {
            content: [{ type: 'text' as const, text: result.content }],
            ...(result.isError ? { isError: true } : {}),
          };
        }
      );
    });

    servers[slug] = createSdkMcpServer({
      name: `source-proxy-${slug}`,
      version: '1.0.0',
      tools: proxyTools,
    });
  }

  return servers;
}

// buildWindowsSkillsDirError is now in backend/claude/event-adapter.ts (exported)
const buildWindowsSkillsDirError = buildWindowsSkillsDirErrorFn;

export class ClaudeAgent extends BaseAgent {
  protected backendName = 'Claude';
  // Note: ClaudeAgentConfig is compatible with BackendConfig, so we use the inherited this.config
  private currentQuery: Query | null = null;
  private currentQueryAbortController: AbortController | null = null;
  private lastAbortReason: AbortReason | null = null;
  private sessionId: string | null = null;
  private isHeadless: boolean = false;
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  // Permission whitelists are now managed by this.permissionManager (inherited from BaseAgent)
  // Source state tracking is now managed by this.sourceManager (inherited from BaseAgent)
  // Source MCP connections are managed by this.config.mcpPool (centralized in main process)
  // Both MCP sources and API sources are routed through the pool.
  // Safe mode state - user-controlled read-only exploration mode
  private safeMode: boolean = false;
  // Event adapter for SDK message → AgentEvent conversion (testable, pluggable)
  private eventAdapter!: ClaudeEventAdapter;
  // Thinking level and ultrathink override are now managed by BaseAgent
  // Pinned system prompt components (captured on first chat, used for consistency after compaction)
  private pinnedPreferencesPrompt: string | null = null;
  // Track if preference drift notification has been shown this session
  private preferencesDriftNotified: boolean = false;
  // Captured stderr from SDK subprocess (for error diagnostics when process exits with code 1)
  private lastStderrOutput: string[] = [];
  /** Pending steer message — injected via additionalContext on next PreToolUse */
  private pendingSteerMessage: string | null = null;

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
  public onPermissionRequest: ((request: { requestId: string; toolName: string; command?: string; description: string; type?: PermissionRequestType }) => void) | null = null;

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

  // onSourcesListChange, onConfigValidationError, and onSourceActivationRequest are inherited from BaseAgent

  // Callback when token usage is updated (for context window display).
  // Note: Full UsageTracker integration is planned for Phase 4 refactoring.
  public onUsageUpdate: ((update: { inputTokens: number; contextWindow?: number; cacheHitRate?: number }) => void) | null = null;

  constructor(config: ClaudeAgentConfig) {
    // Resolve model: prioritize session model > config model (caller must provide via connection)
    const model = config.session?.model ?? config.model!;

    // Build BackendConfig for BaseAgent
    // Context window for Anthropic models is 200k tokens
    const CLAUDE_CONTEXT_WINDOW = 200_000;
    const backendConfig: BackendConfig = {
      provider: 'anthropic',
      workspace: config.workspace,
      session: config.session,
      model,
      thinkingLevel: config.thinkingLevel,
      mcpToken: config.mcpToken,
      isHeadless: config.isHeadless,
      debugMode: config.debugMode,
      systemPromptPreset: config.systemPromptPreset,
      onSdkSessionIdUpdate: config.onSdkSessionIdUpdate,
      onSdkSessionIdCleared: config.onSdkSessionIdCleared,
      getRecoveryMessages: config.getRecoveryMessages,
      envOverrides: config.envOverrides,
      miniModel: config.miniModel,
      mcpPool: config.mcpPool,
      connectionSlug: config.connectionSlug,
      automationSystem: config.automationSystem,
    };

    // Call BaseAgent constructor - initializes model, thinkingLevel, permissionManager, sourceManager, etc.
    // The inherited this.config is set by super() and compatible with ClaudeAgentConfig
    super(backendConfig, DEFAULT_MODEL, CLAUDE_CONTEXT_WINDOW);

    this.isHeadless = config.isHeadless ?? false;
    this.automationSystem = config.automationSystem;

    // Initialize event adapter for SDK message → AgentEvent conversion
    this.eventAdapter = new ClaudeEventAdapter({
      onDebug: (msg) => this.onDebug?.(msg),
      mapSDKError: (errorCode) => this.mapSDKErrorToTypedError(errorCode),
    });

    // Log which model is being used (helpful for debugging custom models)
    this.debug(`Using model: ${model}`);

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
        this.onDebug?.(`[ClaudeAgent] onPlanSubmitted received: ${planPath}`);
        this.onPlanSubmitted?.(planPath);
      },
      onAuthRequest: (request) => {
        this.onDebug?.(`[ClaudeAgent] onAuthRequest received: ${request.sourceSlug} (type: ${request.type})`);
        this.onAuthRequest?.(request);
      },
      queryFn: (request) => this.queryLlm(request),
      spawnSessionFn: (input) => this.preExecuteSpawnSession(input),
    });

    // Start config watcher for hot-reloading source changes
    // Only start in non-headless mode to avoid overhead in batch/script scenarios
    if (!this.isHeadless) {
      this.startConfigWatcher();
    }
  }

  /**
   * Post-construction auth setup.
   * Fetches credentials and sets process.env before the SDK subprocess spawns.
   * The subprocess spawns lazily on first chat(), so postInit() is early enough.
   */
  override async postInit(): Promise<PostInitResult> {
    const slug = this.config.connectionSlug;
    if (!slug) {
      return { authInjected: false, authWarning: 'No connection slug available', authWarningLevel: 'error' };
    }

    const connection = getLlmConnection(slug);
    if (!connection) {
      return { authInjected: false, authWarning: `Connection not found: ${slug}`, authWarningLevel: 'error' };
    }

    // Clear all auth env vars first for clean state
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;

    // Resolve auth env vars via shared utility
    const manager = getCredentialManager();
    const result = await resolveAuthEnvVars(connection, slug, manager, getValidClaudeOAuthToken);

    if (!result.success) {
      return { authInjected: false, authWarning: result.warning, authWarningLevel: 'error' };
    }

    // Apply env vars to process.env (for SDK subprocess) and envOverrides (per-session isolation)
    for (const [key, value] of Object.entries(result.envVars)) {
      process.env[key] = value;
    }

    return { authInjected: true };
  }

  // Config watcher methods (startConfigWatcher, stopConfigWatcher) are now inherited from BaseAgent
  // Thinking level methods (setThinkingLevel, getThinkingLevel, setUltrathinkOverride) are now inherited from BaseAgent

  // Permission command utilities (getBaseCommand, isDangerousCommand, extractDomainFromNetworkCommand)
  // are now available via this.permissionManager

  /**
   * Respond to a pending permission request.
   * Uses permissionManager for whitelisting.
   */
  respondToPermission(requestId: string, allowed: boolean, alwaysAllow: boolean = false): void {
    this.debug(`respondToPermission: ${requestId}, allowed=${allowed}, alwaysAllow=${alwaysAllow}, pending=${this.pendingPermissions.has(requestId)}`);
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      this.debug(`Resolving permission promise for ${requestId}`);

      // If "always allow" was selected, remember it (with special handling for curl/wget)
      if (alwaysAllow && allowed) {
        if (['curl', 'wget'].includes(pending.baseCommand)) {
          // For curl/wget, whitelist the domain instead of the command
          const domain = this.permissionManager.extractDomainFromNetworkCommand(pending.command);
          if (domain) {
            this.permissionManager.whitelistDomain(domain);
            this.debug(`Added domain "${domain}" to always-allowed domains`);
          }
        } else if (!this.permissionManager.isDangerousCommand(pending.baseCommand)) {
          this.permissionManager.whitelistCommand(pending.baseCommand);
          this.debug(`Added "${pending.baseCommand}" to always-allowed commands`);
        }
      }

      pending.resolve(allowed);
      this.pendingPermissions.delete(requestId);
    } else {
      this.debug(`No pending permission found for ${requestId}`);
    }
  }

  // isInSafeMode() is now inherited from BaseAgent

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

  protected async *chatImpl(
    userMessage: string,
    attachments?: FileAttachment[],
    options?: ChatOptions
  ): AsyncGenerator<AgentEvent> {
    // Extract options (ChatOptions interface from AgentBackend)
    const _isRetry = options?.isRetry ?? false;

    // Clear any leftover steer from a previous turn (safety net — should already be null)
    this.pendingSteerMessage = null;

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

      // Get centralized mini agent configuration (from BaseAgent)
      // This ensures Claude and Codex agents use the same detection and constants
      const miniConfig = this.getMiniAgentConfig();

      // Block SDK tools that require UI we don't have:
      // - EnterPlanMode/ExitPlanMode: We use safe mode instead (user-controlled via UI)
      // - AskUserQuestion: Requires interactive UI to show question options to user
      // Note: Mini agents use a minimal tool list directly, so no additional blocking needed
      const disallowedTools: string[] = ['EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion', 'Skill'];

      // Build MCP servers config
      // Mini agents: only session tools (config_validate) to minimize token usage
      // Regular agents: full set including preferences, docs, and user sources

      // Build per-source proxy servers from centralized MCP pool (if available)
      const sourceProxies = this.config.mcpPool ? createSourceProxyServers(this.config.mcpPool) : {};
      const sourceProxyCount = Object.keys(sourceProxies).length;
      if (sourceProxyCount > 0) {
        debug('[chat] Source proxy servers created for', sourceProxyCount, 'sources');
      }

      // Build full MCP servers set first, then filter for mini agents
      const fullMcpServers: Options['mcpServers'] = {
        // Session-scoped tools (SubmitPlan, source_test, update_user_preferences, transform_data, etc.)
        session: getSessionScopedTools(sessionId, this.workspaceRootPath),
        // Craft Agents documentation - always available for searching setup guides
        // This is a public Mintlify MCP server, no auth needed
        'craft-agents-docs': {
          type: 'http',
          url: 'https://agents.craft.do/docs/mcp',
        },
        // Per-source proxy servers from centralized MCP pool (MCP + API sources)
        // Each source gets its own SDK server keyed by slug (e.g., 'linear', 'github', 'gmail')
        // so the SDK produces correct tool names: mcp__{slug}__{toolName}
        ...sourceProxies,
      };

      // Mini agents: filter to minimal set using centralized keys
      // Regular agents: use full set including docs and user sources
      const mcpServers: Options['mcpServers'] = miniConfig.enabled
        ? this.filterMcpServersForMiniAgent(fullMcpServers, miniConfig.mcpServerKeys)
        : fullMcpServers;
      
      // Configure SDK options
      // Model is always set by caller via connection config
      const model = this._model;

      // Log provider context for diagnostics (custom base URL = third-party provider)
      const defaultConnSlug = getDefaultLlmConnection();
      const defaultConn = defaultConnSlug ? getLlmConnection(defaultConnSlug) : null;
      const activeBaseUrl = defaultConn?.baseUrl;
      if (activeBaseUrl) {
        debug(`[chat] Custom provider: baseUrl=${activeBaseUrl}, model=${model}, hasApiKey=${!!process.env.ANTHROPIC_API_KEY}`);
      }

      // Determine effective thinking level: ultrathink override boosts to max for this message
      // Uses inherited protected fields from BaseAgent
      const effectiveThinkingLevel: ThinkingLevel = this._ultrathinkOverride ? 'max' : this._thinkingLevel;
      const thinkingTokens = getThinkingTokens(effectiveThinkingLevel, model);
      debug(`[chat] Thinking: level=${this._thinkingLevel}, override=${this._ultrathinkOverride}, effective=${effectiveThinkingLevel}, tokens=${thinkingTokens}`);

      // NOTE: Parent-child tracking for subagents is documented below (search for
      // "PARENT-CHILD TOOL TRACKING"). The SDK's parent_tool_use_id is authoritative.

      // Clear stderr buffer at start of each query
      this.lastStderrOutput = [];

      // Detect if resolved model is Claude — non-Claude models (via OpenRouter/Ollama) don't
      // support Anthropic-specific betas or extended thinking parameters
      const isClaude = isClaudeModel(model);

      // Log mini agent mode details (using centralized config)
      if (miniConfig.enabled) {
        debug('[ClaudeAgent] 🤖 MINI AGENT mode - optimized for quick config edits');
        debug('[ClaudeAgent] Mini agent optimizations:', {
          model,
          tools: miniConfig.tools,
          mcpServers: miniConfig.mcpServerKeys,
          thinking: 'disabled',
          systemPrompt: 'lean (no Claude Code preset)',
        });
      }

      const options: Options = {
        ...getDefaultOptions(this.config.envOverrides),
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
        // Extended thinking: tokens based on effective thinking level (session level + ultrathink override)
        // Non-Claude models don't support extended thinking, so pass 0 to disable
        // Mini agents also disable thinking for efficiency (quick config edits don't need deep reasoning)
        maxThinkingTokens: miniConfig.minimizeThinking ? 0 : (isClaude ? thinkingTokens : 0),
        // System prompt configuration:
        // - Mini agents: Use custom (lean) system prompt without Claude Code preset
        // - Normal agents: Append to Claude Code's system prompt (recommended by docs)
        systemPrompt: miniConfig.enabled
          ? this.getMiniSystemPrompt()
          : {
              type: 'preset' as const,
              preset: 'claude_code' as const,
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
        // Tools configuration:
        // - Mini agents: minimal set for quick config edits (reduces token count ~70%)
        // - Regular agents: full Claude Code toolset
        tools: (() => {
          const toolsValue = miniConfig.enabled
            ? [...miniConfig.tools]  // Use centralized tool list
            : { type: 'preset' as const, preset: 'claude_code' as const };
          debug('[ClaudeAgent] 🔧 Tools configuration:', JSON.stringify(toolsValue));
          return toolsValue;
        })(),
        // Bypass SDK's built-in permission system - we handle all permissions via PreToolUse hook
        // This allows Safe Mode to properly allow read-only bash commands without SDK interference
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // User hooks from automations.json are merged with internal hooks
        hooks: (() => {
          // Build user-defined hooks from automations.json using the workspace-level AutomationSystem
          const userHooks: Partial<Record<string, SdkAutomationCallbackMatcher[]>> = this.automationSystem?.buildSdkHooks() ?? {};
          if (Object.keys(userHooks).length > 0) {
            debug('[CraftAgent] User SDK hooks loaded:', Object.keys(userHooks).join(', '));
          }

          // Internal hooks for permission handling and logging
          const internalHooks: Record<string, SdkAutomationCallbackMatcher[]> = {
          PreToolUse: [{
            hooks: [async (_hookInput) => {
              // Only handle PreToolUse events
              if (_hookInput.hook_event_name !== 'PreToolUse') {
                return { continue: true };
              }
              // Validate the fields we depend on are actually present
              if (!_hookInput.tool_name || !_hookInput.tool_use_id) {
                return { continue: true };
              }
              const input = _hookInput as Required<Pick<typeof _hookInput, 'tool_name' | 'tool_use_id'>> & typeof _hookInput;

              // Track Read tool calls for prerequisite checking
              if (input.tool_name === 'Read') {
                this.prerequisiteManager.trackReadTool(input.tool_input as Record<string, unknown>);
              }

              // Get current permission mode (single source of truth)
              const permissionMode = getPermissionMode(sessionId);
              this.onDebug?.(`PreToolUse hook: ${input.tool_name} (permissionMode=${permissionMode})`);

              const toolInput = input.tool_input as Record<string, unknown>;

              // Run centralized PreToolUse checks
              const checkResult = runPreToolUseChecks({
                toolName: input.tool_name,
                input: toolInput,
                permissionMode,
                workspaceRootPath: this.workspaceRootPath,
                workspaceId: extractWorkspaceSlug(this.workspaceRootPath, this.config.workspace.id),
                plansFolderPath: sessionId ? getSessionPlansPath(this.workspaceRootPath, sessionId) : undefined,
                workingDirectory: this.config.session?.workingDirectory,
                activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
                allSourceSlugs: this.sourceManager.getAllSources().map(s => s.config.slug),
                hasSourceActivation: !!this.onSourceActivationRequest,
                permissionManager: this.permissionManager,
                prerequisiteManager: this.prerequisiteManager,
                onDebug: (msg) => this.onDebug?.(msg),
              });

              // Consume pending steer message (if any) — will be injected via additionalContext
              const steerMsg = this.pendingSteerMessage;
              if (steerMsg) {
                this.pendingSteerMessage = null;
                this.debug(`Injecting steer via additionalContext on ${input.tool_name}`);
              }

              // Translate result to SDK format
              switch (checkResult.type) {
                case 'allow':
                  if (steerMsg) {
                    return {
                      continue: true,
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse' as const,
                        additionalContext: `The user just sent a new message while you were working. Stop what you are currently doing and address their message instead:\n\n${steerMsg}`,
                      },
                    };
                  }
                  return { continue: true };

                case 'modify':
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      updatedInput: checkResult.input,
                      ...(steerMsg ? { additionalContext: `The user just sent a new message while you were working. Stop what you are currently doing and address their message instead:\n\n${steerMsg}` } : {}),
                    },
                  };

                case 'block':
                  return blockWithReason(checkResult.reason);

                case 'source_activation_needed': {
                  const { sourceSlug, sourceExists } = checkResult;
                  if (sourceExists && this.onSourceActivationRequest) {
                    this.onDebug?.(`Source "${sourceSlug}" not active, attempting auto-enable...`);
                    try {
                      const activated = await this.onSourceActivationRequest(sourceSlug);
                      if (activated) {
                        this.onDebug?.(`Source "${sourceSlug}" auto-enabled successfully, tools available next turn`);
                        return {
                          continue: false,
                          decision: 'block' as const,
                          reason: `STOP. Source "${sourceSlug}" has been activated successfully. The tools will be available on the next turn. Do NOT try other tool names or approaches. Respond to the user now: tell them the source is now active and ask them to send their request again.`,
                        };
                      } else {
                        return {
                          continue: false,
                          decision: 'block' as const,
                          reason: `Source "${sourceSlug}" could not be activated. It may require authentication. Please check the source status and authenticate if needed.`,
                        };
                      }
                    } catch (error) {
                      return {
                        continue: false,
                        decision: 'block' as const,
                        reason: `Failed to activate source "${sourceSlug}": ${error instanceof Error ? error.message : 'Unknown error'}`,
                      };
                    }
                  } else if (sourceExists) {
                    return {
                      continue: false,
                      decision: 'block' as const,
                      reason: `Source "${sourceSlug}" is available but not enabled for this session. Please enable it in the sources panel.`,
                    };
                  } else {
                    return {
                      continue: false,
                      decision: 'block' as const,
                      reason: `Source "${sourceSlug}" could not be connected. It may need re-authentication, or the server may be unreachable. Check the source in the sidebar for details.`,
                    };
                  }
                }

                case 'call_llm_intercept':
                case 'spawn_session_intercept':
                  // Claude's session tools run in-process via SDK — just allow
                  return { continue: true };

                case 'prompt': {
                  const requestId = `perm-${input.tool_use_id}`;
                  const command = checkResult.command || '';
                  const baseCommand = this.permissionManager.getBaseCommand(command);

                  debug(`[PreToolUse] Requesting permission for ${input.tool_name}: ${command}`);

                  const permissionPromise = new Promise<boolean>((resolve) => {
                    this.pendingPermissions.set(requestId, {
                      resolve,
                      toolName: input.tool_name,
                      command,
                      baseCommand,
                    });
                  });

                  if (this.onPermissionRequest) {
                    this.onPermissionRequest({
                      requestId,
                      toolName: input.tool_name,
                      command,
                      description: checkResult.description,
                      type: checkResult.promptType,
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

                  // User approved — return with modified input if transforms were applied
                  if (checkResult.modifiedInput) {
                    return {
                      continue: true,
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse' as const,
                        updatedInput: checkResult.modifiedInput,
                      },
                    };
                  }
                  return { continue: true };
                }
              }
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
              debug(`[ClaudeAgent] SubagentStart: agent_id=${typedInput.agent_id}, type=${typedInput.agent_type}`);
              return { continue: true };
            }],
          }],
          SubagentStop: [{
            hooks: [async (input, _toolUseID) => {
              const typedInput = input as { agent_id?: string };
              debug(`[ClaudeAgent] SubagentStop: agent_id=${typedInput.agent_id}`);
              return { continue: true };
            }],
          }],
          };

          // Merge internal hooks with user hooks from automations.json
          // Internal hooks run first (permissions), then user hooks
          const mergedHooks: Record<string, SdkAutomationCallbackMatcher[]> = { ...internalHooks };
          for (const [event, matchers] of Object.entries(userHooks) as [string, SdkAutomationCallbackMatcher[]][]) {
            if (!matchers) continue;
            if (mergedHooks[event]) {
              // Append user hooks after internal hooks
              mergedHooks[event] = [...mergedHooks[event]!, ...matchers];
            } else {
              // Add new event hooks
              mergedHooks[event] = matchers;
            }
          }

          return mergedHooks;
        })(),
        // Continue from previous session if we have one (enables conversation history & auto compaction)
        // Skip resume on retry (after session expiry) to start fresh
        ...(!_isRetry && this.sessionId ? { resume: this.sessionId } : {}),
        mcpServers,
        // NOTE: This callback is NOT called by the SDK because we set `permissionMode: 'bypassPermissions'` above.
        // All permission logic is handled via the PreToolUse hook instead (see hooks.PreToolUse above).
        // Bash permission logic is in PreToolUse where it actually executes.
        canUseTool: async (_toolName, input) => {
          return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
        },
        // Selectively disable tools - file tools are disabled (use MCP), web/code controlled by settings
        disallowedTools,
        // No plugins — skills are handled by BaseAgent.chat() via read-before-execute
        // (the model reads SKILL.md files directly, enforced by PrerequisiteManager)
        plugins: [],
      };

      // Track whether we're trying to resume a session (for error handling)
      const wasResuming = !_isRetry && !!this.sessionId;

      // Log resume attempt for debugging session failures
      if (wasResuming) {
        console.error(`[ClaudeAgent] Attempting to resume SDK session: ${this.sessionId}`);
        debug(`[ClaudeAgent] Attempting to resume SDK session: ${this.sessionId}`);
      } else {
        console.error(`[ClaudeAgent] Starting fresh SDK session (no resume)`);
        debug(`[ClaudeAgent] Starting fresh SDK session (no resume)`);
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

      // Initialize event adapter for this turn
      // Session directory prevents race condition when concurrent sessions clobber toolMetadataStore.
      const metadataSessionDir = getSessionPath(this.workspaceRootPath, sessionId);
      this.eventAdapter.updateSessionDir(metadataSessionDir);
      this.eventAdapter.startTurn();

      // Process SDK messages and convert to AgentEvents
      let receivedComplete = false;
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

          const events = await this.eventAdapter.adapt(message);
          for (const event of events) {
            // Check for tool-not-found errors on inactive sources and attempt auto-activation
            const inactiveSourceError = this.detectInactiveSourceToolError(event, this.eventAdapter.getToolIndex());

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
                    toolName: toolResultEvent.toolName,
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

            // Reset prerequisite state on compaction (LLM loses guide content)
            if (event.type === 'info' && event.message === 'Compacted Conversation') {
              this.resetPrerequisiteState();
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
          yield* this.chat(messageWithContext, attachments, { isRetry: true });
          return;
        }

        // Defensive: flush any pending text that wasn't emitted
        // This can happen if the SDK sends an assistant message with text but skips the
        // message_delta event that normally triggers text_complete (e.g., in some ultrathink scenarios)
        const flushedEvent = this.eventAdapter.flushPending();
        if (flushedEvent) {
          yield flushedEvent;
        }

        // Defensive: emit complete if SDK didn't send result message
        if (!receivedComplete) {
          yield { type: 'complete' };
        }
      } catch (sdkError) {
        // Debug: log inner catch trigger (stderr to avoid SDK JSON pollution)
        console.error(`[ClaudeAgent] INNER CATCH triggered: ${sdkError instanceof Error ? sdkError.message : String(sdkError)}`);

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

        // Check for .claude.json corruption — the SDK subprocess crashes if this file
        // is empty, BOM-encoded, or contains invalid JSON. Two error patterns:
        //   1. "CLI output was not valid JSON" — CLI wrote plain-text error to stdout
        //   2. "process exited with code 1" with stderr mentioning config corruption
        // See: claude-code#14442 (BOM), #2593 (empty file), #18998 (race condition)
        const stderrForConfigCheck = this.lastStderrOutput.join('\n').toLowerCase();
        const isConfigCorruption =
          (errorMsg.includes('not valid json') && (errorMsg.includes('claude') || errorMsg.includes('configuration'))) ||
          (errorMsg.includes('process exited with code') && (
            stderrForConfigCheck.includes('claude.json') ||
            stderrForConfigCheck.includes('configuration file') ||
            stderrForConfigCheck.includes('corrupted')
          ));

        if (isConfigCorruption && !_isRetry) {
          debug('[ClaudeAgent] Detected .claude.json corruption, repairing and retrying...');
          // Reset the once-per-process guard so ensureClaudeConfig() runs again
          // on the retry — it will repair the file before the next subprocess spawn
          resetClaudeConfigCheck();
          yield { type: 'info', message: 'Repairing configuration file...' };
          yield* this.chat(userMessage, attachments, { isRetry: true });
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
            console.error('[ClaudeAgent] SDK session expired server-side, clearing and retrying fresh');
            debug('[ClaudeAgent] SDK session expired server-side, clearing and retrying fresh');
            this.sessionId = null;
            // Clear pinned state so retry captures fresh values
            this.pinnedPreferencesPrompt = null;
            this.preferencesDriftNotified = false;
            // Use 'info' instead of 'status' to show message without spinner
            yield { type: 'info', message: 'Session expired, restoring context...' };
            // Recursively call with isRetry=true (yield* delegates all events)
            yield* this.chat(userMessage, attachments, { isRetry: true });
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
          // Derive authType from the default LLM connection
          const { getDefaultLlmConnection, getLlmConnection } = await import('../config/storage.ts');
          const defaultConnSlug = getDefaultLlmConnection();
          const connection = defaultConnSlug ? getLlmConnection(defaultConnSlug) : null;
          // Map connection authType to legacy AuthType format for diagnostics
          let diagnosticAuthType: AuthType | undefined;
          if (connection) {
            if (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint' || connection.authType === 'bearer_token') {
              diagnosticAuthType = 'api_key';
            } else if (connection.authType === 'oauth') {
              diagnosticAuthType = 'oauth_token';
            }
          }
          const diagnostics = await runErrorDiagnostics({
            authType: diagnosticAuthType,
            workspaceId: this.config.workspace?.id,
            rawError: stderrContext || rawErrorMsg,
            providerType: this.config.providerType || connection?.providerType,
            baseUrl: connection?.baseUrl,
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
          yield* this.chat(userMessage, attachments, { isRetry: true });
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
      console.error(`[ClaudeAgent] OUTER CATCH triggered: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`[ClaudeAgent] Error stack: ${error instanceof Error ? error.stack : 'no stack'}`);

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
      this._ultrathinkOverride = false;

      // If a steer message was never delivered (no PreToolUse fired), notify the session
      // layer so it can re-queue the message for the next turn.
      const undeliveredSteer = this.pendingSteerMessage;
      if (undeliveredSteer) {
        this.pendingSteerMessage = null;
        this.debug(`Steer message was not delivered (no tool call fired) — emitting steer_undelivered`);
        yield { type: 'steer_undelivered' as const, message: undeliveredSteer };
      }
    }
  }

  // formatSourceState() and getAuthToolName() are now delegated to this.sourceManager

  // buildRecoveryContext() is now inherited from BaseAgent
  // formatWorkspaceCapabilities() is now in PromptBuilder

  /**
   * Build a simple text prompt with embedded text file contents (for text-only messages)
   * Prepends date/time context for prompt caching optimization (keeps system prompt static)
   * Injects session state (including mode state) for every message
   */
  private buildTextPrompt(text: string, attachments?: FileAttachment[]): string {
    const parts: string[] = [];

    // Add context parts using centralized PromptBuilder
    // This includes: date/time, session state (with plansFolderPath),
    // workspace capabilities, and working directory context
    const contextParts = this.promptBuilder.buildContextParts(
      { plansFolderPath: getSessionPlansPath(this.workspaceRootPath, this.modeSessionId) },
      this.sourceManager.formatSourceState()
    );

    parts.push(...contextParts);

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

    // Add context parts using centralized PromptBuilder
    // This includes: date/time, session state (with plansFolderPath),
    // workspace capabilities, and working directory context
    const contextParts = this.promptBuilder.buildContextParts(
      { plansFolderPath: getSessionPlansPath(this.workspaceRootPath, this.modeSessionId) },
      this.sourceManager.formatSourceState()
    );

    for (const part of contextParts) {
      contentBlocks.push({ type: 'text', text: part });
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
   * Parse actual API error from SDK debug log file.
   * The SDK logs errors like: [ERROR] Error in non-streaming fallback: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Could not process image"},"request_id":"req_..."}
   * These go to ~/.claude/debug/{sessionId}.txt, NOT to stderr.
   *
   * Uses async retries with non-blocking delays to handle race condition where
   * SDK may still be writing to the debug file when the error event is received.
   */
  private async parseApiErrorFromDebugLog(): Promise<{ errorType: string; message: string; requestId?: string } | null> {
    if (!this.sessionId) return null;

    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const debugFilePath = path.join(os.homedir(), '.claude', 'debug', `${this.sessionId}.txt`);

    // Helper for non-blocking delay
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Retry up to 3 times with 50ms delays to handle race condition
    // where SDK emits error event before finishing debug file write
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!fs.existsSync(debugFilePath)) {
          // File doesn't exist yet, wait and retry
          if (attempt < 2) {
            await delay(50);
            continue;
          }
          return null;
        }

        // Read the file and get last 50 lines to find recent errors
        const content = fs.readFileSync(debugFilePath, 'utf-8');
        const lines = content.split('\n').slice(-50);

        // Search backwards for the most recent [ERROR] line with JSON
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          // Match [ERROR] lines containing JSON with error details
          const errorMatch = line.match(/\[ERROR\].*?(\{.*\})/);
          if (errorMatch && errorMatch[1]) {
            try {
              const parsed = JSON.parse(errorMatch[1]);
              if (parsed?.error?.message) {
                return {
                  errorType: parsed.error.type || 'error',
                  message: parsed.error.message,
                  requestId: parsed.request_id,
                };
              }
            } catch {
              // Not valid JSON, continue searching
            }
          }
        }

        // File exists but no error found yet, wait and retry
        if (attempt < 2) {
          await delay(50);
        }
      } catch {
        // File read error, wait and retry
        if (attempt < 2) {
          await delay(50);
        }
      }
    }
    return null;
  }

  /**
   * Map SDK assistant message error codes to typed error events with user-friendly messages.
   * Reads from SDK debug log file to extract actual API error details.
   */
  private async mapSDKErrorToTypedError(
    errorCode: SDKAssistantMessageError
  ): Promise<{ type: 'typed_error'; error: AgentError }> {
    // Try to extract actual error message from SDK debug log file
    const actualError = await this.parseApiErrorFromDebugLog();
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
        code: 'invalid_request',
        title: 'Invalid Request',
        message: 'The API rejected this request.',
        details: [
          ...(actualError ? [
            `Error: ${actualError.message}`,
            `Type: ${actualError.errorType}`,
            ...(actualError.requestId ? [`Request ID: ${actualError.requestId}`] : []),
          ] : []),
          'Try removing any attachments and resending',
          'Check if images are in a supported format (PNG, JPEG, GIF, WebP)',
        ],
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
        message: 'An unexpected error occurred.',
        details: [
          ...(actualError ? [
            `Error: ${actualError.message}`,
            `Type: ${actualError.errorType}`,
            ...(actualError.requestId ? [`Request ID: ${actualError.requestId}`] : []),
          ] : []),
          'This may be a temporary issue',
          'Check your network connection',
        ],
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

  /**
   * Check if a tool result error indicates a "tool not found" for an inactive source.
   * This is used to detect when Claude tries to call a tool from a source that exists
   * but isn't currently active, so we can auto-activate and retry.
   *
   * @returns The source slug, tool name, and input if this is an inactive source error, null otherwise
   */
  private detectInactiveSourceToolError(
    event: AgentEvent,
    toolIndex: ToolIndex
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

    // Fallback: try toolIndex if we couldn't extract from error
    if (!toolName) {
      const name = toolIndex.getName(event.toolUseId);
      if (name) {
        toolName = name;
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
    const sourceExists = this.sourceManager.getAllSources().some((s) => s.config.slug === sourceSlug);
    const isActive = this.sourceManager.isSourceActive(sourceSlug);

    if (sourceExists && !isActive) {
      // Get input from toolIndex
      const input = toolIndex.getInput(event.toolUseId);
      return { sourceSlug, toolName, input: input ?? {} };
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
   * Redirect mid-stream via additionalContext injection.
   * Stores the message; the next PreToolUse hook injects it into the conversation.
   * If no tool call fires before the turn ends, yields steer_undelivered so the
   * session layer can re-queue the message.
   */
  override redirect(message: string): boolean {
    if (!this.currentQuery || !this.currentQueryAbortController) {
      // Not actively streaming — fall back to abort + queue
      this.forceAbort(AbortReason.Redirect);
      return false;
    }
    this.debug(`Steering mid-stream: "${message.slice(0, 100)}"`);
    this.pendingSteerMessage = message;
    return true;
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
    this.pendingSteerMessage = null; // Clear any undelivered steer
    if (this.currentQueryAbortController) {
      this.currentQueryAbortController.abort(reason);
      this.currentQueryAbortController = null;
    }
    this.currentQuery = null;
  }

  getModel(): string {
    return this._model;
  }

  /**
   * Get the list of SDK tools (captured from init message)
   */
  getSdkTools(): string[] {
    return this.eventAdapter.sdkTools;
  }

  setModel(model: string): void {
    this.config.model = model;
    // Note: Model change takes effect on the next query
  }

  // ============================================================
  // Mini Agent Mode (uses centralized constants from BaseAgent)
  // ============================================================

  /**
   * Check if running in mini agent mode.
   * Uses centralized detection for consistency with CodexAgent.
   */
  isMiniAgent(): boolean {
    return this.config.systemPromptPreset === 'mini';
  }

  /**
   * Get mini agent configuration for provider-specific application.
   * Returns centralized config from BaseAgent constants.
   */
  getMiniAgentConfig(): MiniAgentConfig {
    const enabled = this.isMiniAgent();
    return {
      enabled,
      tools: enabled ? MINI_AGENT_TOOLS : [],
      mcpServerKeys: enabled ? MINI_AGENT_MCP_KEYS : [],
      minimizeThinking: enabled,
    };
  }

  // getMiniSystemPrompt() and filterMcpServersForMiniAgent() are inherited from BaseAgent

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

  // isSourceServerActive, getActiveSourceServerNames, setAllSources, getAllSources, markSourceUnseen
  // are now inherited from BaseAgent and delegate to this.sourceManager

  // setTemporaryClarifications is now inherited from BaseAgent

  async close(): Promise<void> {
    this.forceAbort();
  }

  // ============================================================
  // AgentBackend Interface Methods
  // ============================================================

  /**
   * Abort current query (async interface for AgentBackend compatibility).
   * Wraps forceAbort() in a Promise.
   */
  async abort(reason?: string): Promise<void> {
    this.forceAbort();
  }

  /**
   * Destroy the agent and clean up resources.
   * Calls super.destroy() for base cleanup, then Claude-specific cleanup.
   */
  destroy(): void {
    // Claude-specific cleanup first
    this.currentQueryAbortController?.abort();
    this.pendingPermissions.clear();

    // Clear pinned system prompt state
    this.pinnedPreferencesPrompt = null;
    this.preferencesDriftNotified = false;

    // Clear Claude-specific callbacks (not handled by BaseAgent)
    this.onSourcesListChange = null;
    this.onConfigValidationError = null;
    this.onUsageUpdate = null;

    // Clean up session-specific state
    const configSessionId = this.config.session?.id;
    if (configSessionId) {
      clearPlanFileState(configSessionId);
      unregisterSessionScopedToolCallbacks(configSessionId);
      cleanupSessionScopedTools(configSessionId);
      cleanupModeState(configSessionId);
    }

    // Clear session
    this.sessionId = null;

    // Base cleanup (stops config watcher, clears whitelists, resets source trackers)
    super.destroy();
  }

  /**
   * Check if currently processing a query.
   */
  isProcessing(): boolean {
    return this.currentQuery !== null;
  }

  /**
   * Get current permission mode.
   */
  getPermissionMode(): PermissionMode {
    return getPermissionMode(this.modeSessionId);
  }

  /**
   * Set permission mode.
   */
  setPermissionMode(mode: PermissionMode): void {
    setPermissionMode(this.modeSessionId, mode);
  }

  /**
   * Cycle to next permission mode.
   */
  cyclePermissionMode(): PermissionMode {
    return cyclePermissionMode(this.modeSessionId);
  }

  // getActiveSourceSlugs() is now inherited from BaseAgent

  // ============================================================
  // Mini Completion (for title generation and other quick tasks)
  // ============================================================

  /**
   * Run a simple text completion using Claude SDK.
   * No tools, empty system prompt - just text in → text out.
   * Uses the same auth infrastructure as the main agent.
   */
  async runMiniCompletion(prompt: string): Promise<string | null> {
    if (!this.config.miniModel) {
      throw new Error('ClaudeAgent.runMiniCompletion: config.miniModel is required');
    }
    const model = this.config.miniModel;

    const options = {
      ...getDefaultOptions(this.config.envOverrides),
      model,
      maxTurns: 1,
      systemPrompt: 'Reply with ONLY the requested text. No explanation.', // Minimal - no Claude Code preset
    };

    let result = '';
    for await (const msg of query({ prompt, options })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            result += block.text;
          }
        }
      }
    }

    return result.trim() || null;
  }

  // ============================================================
  // queryLlm — Agent-native LLM query for call_llm tool (OAuth path)
  // ============================================================

  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    const model = request.model ?? this.config.miniModel ?? getDefaultSummarizationModel();

    const options = {
      ...getDefaultOptions(this.config.envOverrides),
      model,
      maxTurns: 1,
      systemPrompt: request.systemPrompt ?? 'Reply with ONLY the requested text. No explanation.',
      ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.outputSchema ? {
        outputFormat: { type: 'json_schema' as const, schema: request.outputSchema },
      } : {}),
    };

    let result = '';
    let structuredOutput: unknown = undefined;

    for await (const msg of query({ prompt: request.prompt, options })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            result += block.text;
          }
        }
      }
      // Extract structured output from SDK result message
      if (msg.type === 'result' && (msg as SDKResultSuccess).subtype === 'success') {
        structuredOutput = (msg as SDKResultSuccess).structured_output;
      }
    }

    // Prefer structured output when available
    if (structuredOutput !== undefined) {
      return { text: JSON.stringify(structuredOutput, null, 2) };
    }
    return { text: result.trim() };
  }

  // ============================================================
}

// ============================================================
// Backward Compatibility Exports
// ============================================================
// These aliases allow gradual migration from CraftAgent to ClaudeAgent.
// Once all consumers are updated, these can be removed.

/** @deprecated Use ClaudeAgent instead */
export { ClaudeAgent as CraftAgent };

/** @deprecated Use ClaudeAgentConfig instead */
export type { ClaudeAgentConfig as CraftAgentConfig };
