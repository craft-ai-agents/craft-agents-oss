/**
 * Codex Backend (App-Server Mode)
 *
 * Agent backend implementation using the Codex app-server protocol.
 * This backend spawns `codex app-server` and communicates via JSON-RPC over stdio.
 *
 * Key benefits over exec mode:
 * - Pre-tool approval (blocking permission requests BEFORE execution)
 * - Thread persistence (resume conversations across app restarts)
 * - Built-in auth handling (OAuth flow via account/login/start)
 * - Auto-generated types from the Rust binary
 *
 * The app-server handles the agent loop internally, emitting notifications
 * for UI events and server requests for approval prompts.
 */

import type { AgentEvent } from '@craft-agent/core/types';
import type { FileAttachment } from '../utils/files.ts';
import { extractWorkspaceSlug } from '../utils/workspace.ts';
import type { ThinkingLevel } from './thinking-levels.ts';
import type { AuthRequest } from '@craft-agent/session-tools-core';
import { type PermissionMode, shouldAllowToolInMode } from './mode-manager.ts';
import type { LoadedSource } from '../sources/types.ts';

import type {
  BackendConfig,
  ChatOptions,
  SdkMcpServerConfig,
} from './backend/types.ts';
import { AbortReason } from './backend/types.ts';
import type { Workspace } from '../config/storage.ts';

// Import models from centralized registry
import { DEFAULT_CODEX_MODEL, getModelById, getModelIdByShortName, getModelProvider, MODEL_REGISTRY, getDefaultSummarizationModel } from '../config/models.ts';

// LLM tool types and helpers for call_llm PreToolUse intercept
import { buildCallLlmRequest, withTimeout, type LLMQueryRequest, type LLMQueryResult } from './llm-tool.ts';

// BaseAgent provides common functionality
import { BaseAgent } from './base-agent.ts';

// App-server client
import {
  AppServerClient,
  type AppServerOptions,
  type ChatGptTokenRefreshRequestParams,
  type ToolCallPreExecuteParams,
  type ToolCallPreExecuteDecision,
  type ToolCallType,
  type PermissionPromptMetadata,
  type PermissionPromptType,
} from '../codex/app-server-client.ts';

// Codex binary resolver
import { resolveCodexBinary } from '../codex/binary-resolver.ts';

// ChatGPT OAuth for token refresh and API key exchange
import { refreshChatGptTokens, type ChatGptTokens } from '../auth/chatgpt-oauth.ts';

// Credential manager for stored tokens
import { getCredentialManager } from '../credentials/index.ts';


// Event adapter
import { CodexEventAdapter } from './backend/codex/event-adapter.ts';
import { EventQueue } from './backend/event-queue.ts';

// Error parsing for typed errors
import { parseError, type AgentError } from './errors.ts';

// Debug logging
import { debug } from '../utils/debug.ts';

// Session storage for plans folder path
import { getSessionPlansPath } from '../sessions/storage.ts';

// Path utilities for cross-platform normalization
import { join, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

// System prompt for Craft Agent context
import { getSystemPrompt } from '../prompts/system.ts';

// PreToolUse utilities
import {
  expandToolPaths,
  qualifySkillName,
  stripToolMetadata,
  validateConfigWrite,
  BUILT_IN_TOOLS,
} from './core/pre-tool-use.ts';

// Import types from generated codex-types
import type {
  RequestId,
  ReasoningEffort,
} from '@craft-agent/codex-types';
import type {
  AskForApproval,
  SandboxMode,
  UserInput,
  CommandExecutionApprovalDecision,
  FileChangeApprovalDecision,
  ThreadTokenUsageUpdatedNotification,
} from '@craft-agent/codex-types/v2';

// ============================================================
// Constants
// ============================================================

// Models and DEFAULT_CODEX_MODEL imported from centralized registry (config/models.ts)

/**
 * Resolve Codex model IDs to the correct versioned slug.
 *
 * With dynamic model discovery (model/list), the app-server returns only models
 * appropriate for the current auth type. Manual API-key downgrades are no longer needed.
 *
 * This function still handles:
 * - Backward compat: old abstract IDs (codex, codex-mini) from existing sessions
 */
function resolveCodexModelId(modelId: string, _authType?: string): string {
  // Registry-based model IDs (derived, not hardcoded)
  const codexModelId = getModelIdByShortName('Codex');
  const codexMiniModelId = getModelIdByShortName('Codex Mini');

  // Backward compat: map old abstract IDs to real registry slugs
  const legacyMap: Record<string, string> = {
    'codex': codexModelId,
    'codex-mini': codexMiniModelId,
  };
  const legacy = legacyMap[modelId];
  if (legacy) return legacy;

  return modelId;
}

/**
 * Map thinking levels to Codex reasoning effort.
 */
const THINKING_TO_EFFORT: Record<ThinkingLevel, ReasoningEffort> = {
  off: 'low',
  think: 'medium',
  max: 'high',
};

// ============================================================
// CodexAgent Implementation
// ============================================================

/**
 * Backend implementation using the Codex app-server protocol.
 *
 * Extends BaseAgent for common functionality (permission mode, source management,
 * planning heuristics, config watching, usage tracking).
 *
 * The app-server provides a structured JSON-RPC API that:
 * 1. Manages thread lifecycle (start, resume, archive)
 * 2. Handles turns with proper approval workflows
 * 3. Emits notifications for streaming events
 * 4. Sends server requests for approval prompts
 */
export class CodexAgent extends BaseAgent {
  // ============================================================
  // Codex-specific State (not in BaseAgent)
  // ============================================================

  // App-server client
  private client: AppServerClient | null = null;
  private clientConnecting: Promise<void> | null = null;

  // Deferred ChatGPT tokens — cached by tryInjectStoredChatGptTokens(),
  // injected after ensureClient() connects (avoids 30s timeout during agent creation)
  private _pendingChatGptTokens: { idToken: string; accessToken: string } | null = null;

  // State
  private _isProcessing: boolean = false;
  private _pendingReconnect: boolean = false;
  /** Resolves when the deferred reconnect completes. Multiple queueReconnect() calls
   *  reuse the same promise so no resolver is orphaned. */
  private _reconnectPromise: Promise<void> | null = null;
  private _resolveReconnectPromise: (() => void) | null = null;
  private abortReason?: AbortReason;
  private codexThreadId: string | null = null; // For session resume
  private currentTurnId: string | null = null;

  // Event adapter
  private adapter: CodexEventAdapter;

  // Event queue for streaming (AsyncGenerator pattern)
  private eventQueue = new EventQueue();

  // Track in-flight async item/completed handlers to prevent race with turn/completed.
  // turn/completed is sync and calls eventQueue.complete() immediately, but item/completed
  // is async (may await source activation). If turn/completed fires before all item/completed
  // handlers finish, their events are enqueued into a dead queue.
  private inflightItemHandlers = 0;
  private turnCompletedPending = false;

  // Ephemeral thread isolation — queryLlm, generateTitle, and runMiniCompletion start
  // ephemeral threads on the same AppServerClient. Without filtering, ALL event handlers
  // process their events too: polluting the main event queue, overwriting codexThreadId,
  // and calling eventQueue.complete() prematurely.
  private _ephemeralThreadIds = new Set<string>();
  private _startingEphemeralThread = false;

  // Pending approval requests (legacy approval handlers)
  private pendingApprovals: Map<string, {
    type: 'command' | 'fileChange';
    command?: string; // Original command for whitelisting
    resolve: (decision: CommandExecutionApprovalDecision | FileChangeApprovalDecision) => void;
  }> = new Map();

  // Pending permission requests for unified PreToolUse flow
  private pendingPermissions: Map<string, {
    resolve: (result: { allowed: boolean; acceptForSession: boolean }) => void;
    toolName: string;
    command?: string;
  }> = new Map();

  // Current user message (for source_activated event's originalMessage)
  private currentUserMessage: string = '';

  // Mutex for token refresh to prevent race conditions with concurrent refresh requests
  private tokenRefreshInProgress: Promise<void> | null = null;

  // ============================================================
  // Codex-specific Callbacks
  // ============================================================

  /**
   * Callback for when ChatGPT authentication is required.
   * Called when:
   * 1. No stored ChatGPT tokens exist and they're needed
   * 2. Token refresh fails (refresh token expired)
   *
   * The UI should trigger the ChatGPT OAuth flow and then call
   * `injectChatGptTokens()` with the new tokens.
   */
  onChatGptAuthRequired: ((reason: string) => void) | null = null;

  /**
   * Callback when a plan is submitted via SubmitPlan MCP tool.
   * Called when the session-mcp-server sends plan_submitted callback.
   * The UI should display the plan and pause execution.
   */
  onPlanSubmitted: ((planPath: string) => void) | null = null;

  /**
   * Callback when authentication is requested via session MCP tools.
   * Called when OAuth or credential prompt tools trigger auth flow.
   * The UI should show auth dialog and pause execution.
   */
  onAuthRequest: ((request: AuthRequest) => void) | null = null;

  /**
   * Resolve the connection slug for credential routing.
   * Uses connectionSlug from config (set by factory), falls back to session's llmConnection.
   */
  private get credentialSlug(): string {
    const slug = this.config.connectionSlug ?? this.config.session?.llmConnection;
    if (!slug) {
      throw new Error('CodexAgent: connectionSlug is required for credential routing');
    }
    return slug;
  }

  constructor(config: BackendConfig) {
    // Get context window from model definitions for base class
    const modelDef = getModelById(config.model!);

    // Call BaseAgent constructor - handles all core module initialization (model from connection)
    super(config, DEFAULT_CODEX_MODEL, modelDef?.contextWindow);

    // Codex-specific initialization
    // Restore thread ID from previous session (for resume)
    this.codexThreadId = config.session?.sdkSessionId || null;

    // Initialize event adapter
    this.adapter = new CodexEventAdapter();

    // Start config watcher for hot-reloading source changes (non-headless only)
    if (!config.isHeadless) {
      this.startConfigWatcher();
    }

    this.debug(`Codex backend initialized (app-server mode)${this.codexThreadId ? ` (will resume thread ${this.codexThreadId})` : ''}`);
  }

  /**
   * Override debug to add Codex prefix.
   */
  protected override debug(message: string): void {
    this.onDebug?.(`[Codex] ${message}`);
  }

  /**
   * Safely respond to PreToolUse request, handling disconnection gracefully.
   * Logs warning if disconnected instead of silently failing.
   */
  private async safeRespondToPreToolUse(requestId: RequestId, decision: ToolCallPreExecuteDecision): Promise<void> {
    if (!this.client?.isConnected()) {
      this.debug(`Cannot respond to PreToolUse (${requestId}) - client disconnected`);
      return;
    }
    try {
      await this.client.respondToToolCallPreExecute(requestId, decision);
    } catch (err) {
      this.debug(`Failed to respond to PreToolUse (${requestId}): ${err}`);
    }
  }

  // ============================================================
  // Client Management
  // ============================================================

  /**
   * Ensure the app-server client is connected.
   */
  private async ensureClient(): Promise<AppServerClient> {
    if (this.client?.isConnected()) {
      return this.client;
    }

    // Wait if already connecting
    if (this.clientConnecting) {
      await this.clientConnecting;
      if (this.client?.isConnected()) {
        return this.client;
      }
    }

    // Create and connect new client
    // Resolve Codex binary path using the binary resolver
    // Priority: CODEX_PATH env var > bundled binary > local dev fork > system PATH
    const { path: codexPath, source: codexSource } = resolveCodexBinary();

    // Build environment variables for the Codex process
    // CODEX_HOME enables per-session configuration (MCP servers, etc.)
    const env: Record<string, string> = {};
    if (this.config.codexHome) {
      env.CODEX_HOME = this.config.codexHome;
      this.debug(`Using custom CODEX_HOME: ${this.config.codexHome}`);
    }

    const options: AppServerOptions = {
      workDir: this.workingDirectory,
      codexPath,
      onDebug: (msg) => this.debug(msg),
      env: Object.keys(env).length > 0 ? env : undefined,
    };

    this.client = new AppServerClient(options);
    this.debug(`Using codex binary: ${codexPath} (${codexSource})`);

    // Set up event handlers
    this.setupClientEventHandlers();

    // Connect
    this.clientConnecting = this.client.connect();
    await this.clientConnecting;
    this.clientConnecting = null;

    this.debug('App-server client connected');

    // Inject auth tokens for the new client to avoid 401 errors after interrupts.
    // This is needed whenever a fresh client is created (e.g., after forceAbort with UserStop).
    //
    // First, check for deferred tokens cached by tryInjectStoredChatGptTokens() during
    // agent creation — this avoids the 30s timeout that would occur if we called
    // tryInjectStoredChatGptTokens() before the client existed.
    if (this._pendingChatGptTokens) {
      this.debug('Injecting deferred ChatGPT tokens...');
      try {
        await this.client.accountLoginWithChatGptTokens(this._pendingChatGptTokens);
        this.debug('Deferred ChatGPT tokens injected successfully');
      } catch (err) {
        this.debug(`Failed to inject deferred ChatGPT tokens: ${err}`);
      }
      this._pendingChatGptTokens = null;
    } else {
      // No deferred tokens — fall back to loading from credential store
      // (handles reconnect after forceAbort, etc.)
      const normalizedAuthType =
        this.config.authType ??
        (this.config.legacyAuthType === 'api_key'
          ? 'api_key'
          : this.config.legacyAuthType === 'oauth_token'
            ? 'oauth'
            : undefined);

      if (normalizedAuthType === 'oauth') {
        this.debug('Injecting stored ChatGPT tokens for new client...');
        const injected = await this.tryInjectStoredChatGptTokens();
        if (!injected) {
          this.debug('No stored ChatGPT tokens available - auth may be required');
          // Don't throw here - let the chat() method handle auth requirements
          // via the onChatGptAuthRequired callback when the server responds with 401
        }
      } else if (normalizedAuthType === 'api_key' || normalizedAuthType === 'api_key_with_endpoint') {
        this.debug('Injecting stored API key for new client...');
        await this.tryInjectStoredApiKey();
      }
    }

    return this.client;
  }

  /**
   * Set up event handlers for the app-server client.
   */
  private setupClientEventHandlers(): void {
    if (!this.client) return;

    // Thread started - capture thread ID (skip ephemeral threads from queryLlm etc.)
    this.client.on('thread/started', (notification) => {
      if (this._startingEphemeralThread) return;
      const threadId = notification.thread?.id;
      if (threadId && threadId !== this.codexThreadId) {
        this.codexThreadId = threadId;
        this.debug(`Thread ID captured: ${threadId}`);
        this.config.onSdkSessionIdUpdate?.(threadId);
      }
    });

    // Turn started (skip ephemeral threads)
    this.client.on('turn/started', (notification) => {
      if (this._ephemeralThreadIds.has(notification.threadId)) return;
      this.currentTurnId = notification.turn?.id || null;
      for (const event of this.adapter.adaptTurnStarted(notification)) {
        this.eventQueue.enqueue(event);
      }
    });

    // Turn completed (skip ephemeral threads)
    // IMPORTANT: Defer eventQueue.complete() if async item/completed handlers are still in flight.
    // Without this, tool_result and text_complete events from item/completed can be enqueued
    // after complete(), causing lost tool results and truncated assistant messages.
    this.client.on('turn/completed', (notification) => {
      if (this._ephemeralThreadIds.has(notification.threadId)) return;
      for (const event of this.adapter.adaptTurnCompleted(notification)) {
        this.eventQueue.enqueue(event);
      }
      if (this.inflightItemHandlers > 0) {
        this.debug(`turn/completed: deferring complete() — ${this.inflightItemHandlers} item handlers in flight`);
        this.turnCompletedPending = true;
      } else {
        this.eventQueue.complete();
      }
    });

    // Turn plan updated - Codex's native task list
    // Emits synthetic TodoWrite tool events (tool_start + tool_result) for TurnCard
    this.client.on('turn/plan/updated', (notification) => {
      for (const event of this.adapter.adaptTurnPlanUpdated(notification)) {
        this.eventQueue.enqueue(event);
      }
    });

    // Item started (skip ephemeral threads)
    this.client.on('item/started', (notification) => {
      if (this._ephemeralThreadIds.has(notification.threadId)) return;
      for (const event of this.adapter.adaptItemStarted(notification)) {
        this.eventQueue.enqueue(event);
      }
    });

    // Item completed (skip ephemeral threads)
    // NOTE: This handler is async (may await source activation). We track in-flight
    // handlers so turn/completed can defer eventQueue.complete() until they finish.
    this.client.on('item/completed', async (notification) => {
      if (this._ephemeralThreadIds.has(notification.threadId)) return;
      this.inflightItemHandlers++;
      try {
        const events = this.adapter.adaptItemCompleted(notification);
        for (const event of events) {
          // Check for session MCP tool completions that need callbacks.
          // Session MCP tools run in an external subprocess that can't trigger
          // callbacks cross-process. Detect from events and use the centralized
          // BaseAgent.handleSessionMcpToolCompletion() to fire them.
          if (event.type === 'tool_result' && !event.isError) {
            const item = notification.item;
            if (item?.type === 'mcpToolCall' && item.server === 'session') {
              const args = (item.arguments ?? {}) as Record<string, unknown>;
              this.handleSessionMcpToolCompletion(item.tool, args);
            }
          }

          // Check for inactive source tool errors and attempt auto-activation
          if (event.type === 'tool_result' && event.isError) {
            const inactiveSourceError = this.detectInactiveSourceToolError(event);
            if (inactiveSourceError && this.onSourceActivationRequest) {
              const { sourceSlug, toolName } = inactiveSourceError;

              this.debug(`Detected tool call to inactive source "${sourceSlug}", attempting activation...`);

              try {
                const activated = await this.onSourceActivationRequest(sourceSlug);

                if (activated) {
                  this.debug(`Source "${sourceSlug}" activated successfully`);

                  // Emit source_activated event for UI to auto-retry
                  this.eventQueue.enqueue({
                    type: 'source_activated' as const,
                    sourceSlug,
                    originalMessage: this.currentUserMessage,
                  });
                } else {
                  this.debug(`Failed to activate source "${sourceSlug}"`);
                }
              } catch (err) {
                this.debug(`Error activating source "${sourceSlug}": ${err}`);
              }
            }
          }
          this.eventQueue.enqueue(event);
        }
      } finally {
        this.inflightItemHandlers--;
        // If turn/completed arrived while we were processing, complete now
        if (this.turnCompletedPending && this.inflightItemHandlers === 0) {
          this.debug('item/completed: last handler done, firing deferred complete()');
          this.turnCompletedPending = false;
          this.eventQueue.complete();
        }
      }
    });

    // Agent message delta (streaming text, skip ephemeral threads)
    this.client.on('item/agentMessage/delta', (notification) => {
      if (this._ephemeralThreadIds.has(notification.threadId)) return;
      for (const event of this.adapter.adaptAgentMessageDelta(notification)) {
        this.eventQueue.enqueue(event);
      }
    });

    // Reasoning delta (streaming thinking, skip ephemeral threads)
    this.client.on('item/reasoning/textDelta', (notification) => {
      if (this._ephemeralThreadIds.has(notification.threadId)) return;
      for (const event of this.adapter.adaptReasoningDelta(notification)) {
        this.eventQueue.enqueue(event);
      }
    });

    // Command output delta (accumulate for tool result, skip ephemeral threads)
    this.client.on('item/commandExecution/outputDelta', (notification) => {
      if (this._ephemeralThreadIds.has(notification.threadId)) return;
      this.adapter.adaptCommandOutputDelta(notification);
    });

    // Command execution approval request
    this.client.on('item/commandExecution/requestApproval', async (params) => {
      await this.handleCommandApproval(params);
    });

    // File change approval request
    this.client.on('item/fileChange/requestApproval', async (params) => {
      await this.handleFileChangeApproval(params);
    });

    // CRAFT AGENTS: PreToolUse hook - intercept ALL tools before execution
    // This is the unified permission checking for Codex backend (requires fork)
    this.client.on('item/toolCall/preExecute', async (params) => {
      this.debug(`[PreToolUse EVENT] Received: toolName=${params.toolName} toolType=${params.toolType} mcpServer=${params.mcpServer} mcpTool=${params.mcpTool}`);
      await this.handleToolCallPreExecute(params);
    });

    // Error handling - parse errors and emit typed errors when possible
    this.client.on('error', (err) => {
      this.debug(`Client error: ${err.message}`);
      const typedError = this.parseCodexError(err);
      if (typedError && typedError.code !== 'unknown_error') {
        // Known error type - emit typed error with recovery actions
        this.eventQueue.enqueue({ type: 'typed_error', error: typedError });
      } else {
        // Unknown error - emit raw error message
        this.eventQueue.enqueue({ type: 'error', message: err.message });
      }
    });

    // Disconnection
    this.client.on('disconnected', ({ code, signal }) => {
      this.debug(`Client disconnected: code=${code}, signal=${signal}`);

      // Clear pending permissions to prevent orphaned promises
      for (const [id, pending] of this.pendingPermissions) {
        pending.resolve({ allowed: false, acceptForSession: false });
      }
      this.pendingPermissions.clear();

      // Clear legacy approvals too
      this.pendingApprovals.clear();

      if (this._isProcessing) {
        this.eventQueue.enqueue({ type: 'error', message: 'Connection to Codex lost' });
        this.eventQueue.complete();
      }
    });

    // ChatGPT token refresh request (chatgptAuthTokens mode)
    // Server asks us to provide fresh tokens after receiving 401
    this.client.on('account/chatgptAuthTokens/refresh', async (params) => {
      await this.handleTokenRefreshRequest(params);
    });

    // Auth notifications
    this.client.on('account/login/completed', (notification) => {
      if (notification.success) {
        this.debug('ChatGPT login completed successfully');
      } else {
        this.debug(`ChatGPT login failed: ${notification.error}`);
      }
    });

    this.client.on('account/updated', (notification) => {
      this.debug(`Auth mode updated: ${notification.authMode}`);
    });

    // Token usage updates for context display in UI
    // Emits usage_update events so FreeFormInput can show "45k / 155k" context usage
    this.client.on('thread/tokenUsage/updated', (notification: ThreadTokenUsageUpdatedNotification) => {
      const usage = notification.tokenUsage;
      if (usage) {
        // Use latest-turn usage for context size; include cached tokens to match OpenAI convention
        const inputTokens = usage.last.inputTokens + usage.last.cachedInputTokens;
        this.eventQueue.enqueue({
          type: 'usage_update',
          usage: {
            inputTokens,
            contextWindow: usage.modelContextWindow ?? undefined,
          },
        });
      }
    });

    // ============================================================
    // Extended Protocol Coverage
    // ============================================================

    // Error notifications (critical - surface server errors)
    this.client.on('codex/error', (notification) => {
      this.debug(`[codex] Server error: ${notification.error?.message}`);
      for (const event of this.adapter.adaptError(notification)) {
        this.eventQueue.enqueue(event);
      }
    });

    // Context compaction (auto-compaction complete)
    this.client.on('thread/compacted', (notification) => {
      this.debug(`[codex] Context compacted for thread ${notification.threadId}`);
      for (const event of this.adapter.adaptContextCompacted(notification)) {
        this.eventQueue.enqueue(event);
      }
    });

    // File change output delta (debug only)
    this.client.on('item/fileChange/outputDelta', (notification) => {
      this.debug(`[codex] File change delta: ${notification.delta?.slice(0, 50)}...`);
    });

    // MCP tool progress
    this.client.on('item/mcpToolCall/progress', (notification) => {
      this.debug(`[codex] MCP progress: ${notification.message}`);
      for (const event of this.adapter.adaptMcpToolCallProgress(notification)) {
        this.eventQueue.enqueue(event);
      }
    });

    // Terminal interaction (future feature)
    this.client.on('item/commandExecution/terminalInteraction', (notification) => {
      this.debug(`[codex] Terminal interaction: ${notification.stdin}`);
    });

    // Warnings → info messages
    this.client.on('configWarning', (notification) => {
      this.debug(`[codex] Config warning: ${notification.summary}`);
      for (const event of this.adapter.adaptConfigWarning(notification)) {
        this.eventQueue.enqueue(event);
      }
    });

    this.client.on('windows/worldWritableWarning', (notification) => {
      this.debug(`[codex] Windows security warning: ${notification.samplePaths.length} paths`);
      for (const event of this.adapter.adaptWindowsWarning(notification)) {
        this.eventQueue.enqueue(event);
      }
    });

    // Legacy auth notifications (debug only)
    this.client.on('authStatusChange', (notification) => {
      this.debug(`[codex] Auth status change: ${notification.authMethod}`);
    });

    this.client.on('loginChatGptComplete', (_notification) => {
      this.debug(`[codex] Legacy login complete`);
    });

    this.client.on('sessionConfigured', (_notification) => {
      this.debug(`[codex] Session configured`);
    });

  }

  // ============================================================
  // Approval Handling
  // ============================================================

  /**
   * Handle command execution approval request.
   * This is called BEFORE the command is executed (pre-tool approval).
   * Uses PermissionManager for permission evaluation and whitelisting.
   */
  private async handleCommandApproval(params: {
    threadId: string;
    turnId: string;
    itemId: string;
    reason: string | null;
    command?: string;
    cwd?: string;
    requestId: RequestId;
  }): Promise<void> {
    const permissionMode = this.permissionManager.getPermissionMode();
    const command = params.command || '';

    // In execute mode, auto-approve
    if (permissionMode === 'allow-all') {
      this.debug('Auto-approving command (execute mode)');
      this.client?.respondToCommandApproval(params.requestId, 'accept');
      return;
    }

    // In explore mode, use proper permission checking instead of blanket decline.
    // This allows read-only commands and plans folder writes through,
    // while still blocking unsafe operations.
    if (permissionMode === 'safe') {
      const sessionId = this.config.session?.id;
      const plansFolderPath = sessionId
        ? getSessionPlansPath(this.config.workspace.rootPath ?? this.workingDirectory, sessionId)
        : undefined;

      const permissionsContext = {
        workspaceRootPath: this.workingDirectory,
        activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
      };

      const result = shouldAllowToolInMode(
        'Bash',
        { command },
        permissionMode,
        { plansFolderPath, permissionsContext }
      );

      if (result.allowed) {
        this.debug('Allowing command in explore mode (passed permission check)');
        this.client?.respondToCommandApproval(params.requestId, 'accept');
      } else {
        this.debug(`Rejecting command in explore mode: ${result.reason}`);
        this.client?.respondToCommandApproval(params.requestId, 'decline');
      }
      return;
    }

    // In ask mode, check if command is whitelisted
    const baseCommand = this.permissionManager.getBaseCommand(command);
    if (this.permissionManager.isCommandWhitelisted(baseCommand)) {
      this.debug(`Auto-approving whitelisted command: ${baseCommand}`);
      this.client?.respondToCommandApproval(params.requestId, 'accept');
      return;
    }

    // Check for whitelisted domain (curl, wget, ssh, etc.)
    const domain = this.permissionManager.extractDomainFromNetworkCommand(command);
    if (domain && this.permissionManager.isDomainWhitelisted(domain)) {
      this.debug(`Auto-approving whitelisted domain: ${domain}`);
      this.client?.respondToCommandApproval(params.requestId, 'accept');
      return;
    }

    // Emit permission request and wait for user response
    const requestId = String(params.requestId);
    this.debug(`Requesting command approval: ${command}`);

    // Emit permission request to UI
    if (this.onPermissionRequest) {
      this.onPermissionRequest({
        requestId,
        toolName: 'Bash',
        command,
        description: params.reason || 'Execute command',
        type: 'bash',
      });

      // Store resolver and command info for when respondToPermission is called
      return new Promise((resolve) => {
        this.pendingApprovals.set(requestId, {
          type: 'command',
          command, // Store command for whitelisting
          resolve: (decision: CommandExecutionApprovalDecision | FileChangeApprovalDecision) => {
            this.client?.respondToCommandApproval(
              params.requestId,
              decision as CommandExecutionApprovalDecision
            );
            resolve();
          },
        });
      });
    }

    // No permission handler - decline by default
    this.debug('No permission handler - declining');
    this.client?.respondToCommandApproval(params.requestId, 'decline');
  }

  /**
   * Handle file change approval request.
   * Uses PermissionManager for permission mode evaluation.
   */
  private async handleFileChangeApproval(params: {
    threadId: string;
    turnId: string;
    itemId: string;
    reason: string | null;
    grantRoot: string | null;
    requestId: RequestId;
  }): Promise<void> {
    const permissionMode = this.permissionManager.getPermissionMode();

    // Expand path for display (resolve ~)
    const displayPath = params.grantRoot
      ? this.pathProcessor.expandTilde(params.grantRoot)
      : '';

    // In execute mode, auto-approve
    if (permissionMode === 'allow-all') {
      this.debug('Auto-approving file change (execute mode)');
      this.client?.respondToFileChangeApproval(params.requestId, 'accept');
      return;
    }

    // In explore mode, check if targeting plans folder (allow plans, reject others)
    if (permissionMode === 'safe') {
      const sessionId = this.config.session?.id;
      const plansFolderPath = sessionId
        ? getSessionPlansPath(this.config.workspace.rootPath ?? this.workingDirectory, sessionId)
        : undefined;

      // Check if file change targets plans folder
      if (plansFolderPath && displayPath) {
        // Normalize paths - resolve to absolute, use forward slashes, and lowercase on Windows
        const normalizePath = (p: string) => {
          const normalized = resolve(p).replace(/\\/g, '/');
          return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
        };
        const normalizedPath = normalizePath(displayPath);
        const normalizedPlansDir = normalizePath(plansFolderPath);

        if (normalizedPath.startsWith(normalizedPlansDir)) {
          this.debug('Allowing file change to plans folder (explore mode)');
          this.client?.respondToFileChangeApproval(params.requestId, 'accept');
          return;
        }
      }

      this.debug('Auto-rejecting file change (explore mode)');
      this.client?.respondToFileChangeApproval(params.requestId, 'decline');
      return;
    }

    // In ask mode, emit permission request
    const requestId = String(params.requestId);
    this.debug(`Requesting file change approval: ${displayPath}`);

    if (this.onPermissionRequest) {
      this.onPermissionRequest({
        requestId,
        toolName: 'Edit',
        command: displayPath,
        description: params.reason || 'Modify files',
      });

      return new Promise((resolve) => {
        this.pendingApprovals.set(requestId, {
          type: 'fileChange',
          resolve: (decision: CommandExecutionApprovalDecision | FileChangeApprovalDecision) => {
            this.client?.respondToFileChangeApproval(
              params.requestId,
              decision as FileChangeApprovalDecision
            );
            resolve();
          },
        });
      });
    }

    // No permission handler - decline by default
    this.client?.respondToFileChangeApproval(params.requestId, 'decline');
  }

  /**
   * CRAFT AGENTS: Handle PreToolUse hook request.
   *
   * This is called BEFORE ANY tool execution (from Codex fork).
   * Uses the centralized shouldAllowToolInMode for permission checking,
   * providing the same permission behavior as ClaudeAgent.
   *
   * Decisions:
   * - Allow: Continue with tool execution
   * - Block: Return error to model with reason (guides retry)
   * - Modify: Continue with modified input (path expansion, etc.)
   */
  private async handleToolCallPreExecute(params: ToolCallPreExecuteParams & { requestId: RequestId }): Promise<void> {
    const permissionMode = this.permissionManager.getPermissionMode();
    const { toolType, toolName, input, mcpServer, mcpTool, requestId, itemId } = params;

    this.debug(`PreToolUse: ${toolName} (${toolType}) - mode: ${permissionMode} | mcpServer=${mcpServer} mcpTool=${mcpTool}`);

    // Map tool type to SDK tool name for shouldAllowToolInMode
    const sdkToolName = this.mapToolTypeToSdkName(toolType, toolName, mcpServer, mcpTool);
    this.debug(`PreToolUse: mapped sdkToolName="${sdkToolName}" (from toolType=${toolType}, toolName=${toolName})`);

    // Build permissions context for loading custom permissions.json files
    const permissionsContext = {
      workspaceRootPath: this.workingDirectory,
      activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
    };

    // Compute plans folder path from session ID (if available)
    const sessionId = this.config.session?.id;
    const plansFolderPath = sessionId
      ? getSessionPlansPath(this.config.workspace.rootPath ?? this.workingDirectory, sessionId)
      : undefined;

    // Use centralized permission checking (same logic as ClaudeAgent)
    const result = shouldAllowToolInMode(
      sdkToolName,
      input,
      permissionMode,
      {
        plansFolderPath,
        permissionsContext,
      }
    );

    if (!result.allowed) {
      // Block the tool with the reason
      this.debug(`PreToolUse: Blocking ${toolName} - ${result.reason}`);

      // Store the block reason for the event adapter to use in tool_result
      this.adapter.setBlockReason(itemId, result.reason);

      const decision: ToolCallPreExecuteDecision = {
        type: 'block',
        reason: result.reason,
      };
      await this.safeRespondToPreToolUse(requestId, decision);
      return;
    }

    // ============================================================
    // ASK MODE: Prompt user for permission on potentially dangerous operations
    // ============================================================
    if (permissionMode === 'ask') {
      const promptInfo = this.shouldPromptForPermission(sdkToolName, input as Record<string, unknown>);

      if (promptInfo && this.onPermissionRequest) {
        const permRequestId = String(requestId);
        this.debug(`PreToolUse: Prompting user for ${sdkToolName} - ${promptInfo.description}`);

        // Create promise for user response with timeout
        const permissionPromise = new Promise<{ allowed: boolean; acceptForSession: boolean }>((resolve) => {
          this.pendingPermissions.set(permRequestId, {
            resolve,
            toolName: sdkToolName,
            command: promptInfo.command,
          });
        });

        // Create timeout promise (30 seconds)
        const timeoutPromise = new Promise<{ allowed: boolean; acceptForSession: boolean; timedOut: true }>((resolve) => {
          setTimeout(() => {
            resolve({ allowed: false, acceptForSession: false, timedOut: true });
          }, 30000);
        });

        // Emit permission request to UI
        this.onPermissionRequest({
          requestId: permRequestId,
          toolName: sdkToolName,
          command: promptInfo.command,
          description: promptInfo.description,
          type: promptInfo.type,
        });

        // Wait for user response or timeout
        const result = await Promise.race([permissionPromise, timeoutPromise]);

        // Clean up pending permission
        this.pendingPermissions.delete(permRequestId);

        if ('timedOut' in result && result.timedOut) {
          this.debug('PreToolUse: Permission request timed out, blocking');
          this.adapter.setBlockReason(itemId, 'Permission request timed out. Retry the command or switch to Execute mode.');
          const decision: ToolCallPreExecuteDecision = {
            type: 'userResponse',
            decision: 'timedOut',
          };
          await this.safeRespondToPreToolUse(requestId, decision);
          return;
        }

        if (!result.allowed) {
          this.debug('PreToolUse: User denied permission');
          this.adapter.setBlockReason(itemId, 'Permission denied by user.');
          const decision: ToolCallPreExecuteDecision = {
            type: 'userResponse',
            decision: 'denied',
          };
          await this.safeRespondToPreToolUse(requestId, decision);
          return;
        }

        // User approved - continue with tool execution
        this.debug(`PreToolUse: User approved (acceptForSession=${result.acceptForSession})`);
        // If acceptForSession, we could whitelist the command here
        // For now, just continue
      }
    }

    // Check for source blocking (MCP tools from inactive sources)
    if (toolType === 'mcp' && mcpServer) {
      const sourceSlug = this.extractSourceSlugFromMcpServer(mcpServer, mcpTool);
      if (sourceSlug && !this.sourceManager.isSourceActive(sourceSlug)) {
        // Source is inactive - attempt auto-activation
        this.debug(`PreToolUse: MCP tool from inactive source "${sourceSlug}", attempting activation...`);

        if (this.onSourceActivationRequest) {
          try {
            const activated = await this.onSourceActivationRequest(sourceSlug);
            if (!activated) {
              // Block if activation failed - distinguish not-installed vs inactive
              const sourceExists = this.sourceManager
                .getAllSources()
                .some((s) => s.config.slug === sourceSlug);
              const reason = sourceExists
                ? `Source "${sourceSlug}" is not active. Activate it by @mentioning it in your message or via the source icon at the bottom of the input field.`
                : `Source "${sourceSlug}" is not available yet. It needs to be created and configured first.`;
              this.adapter.setBlockReason(itemId, reason);
              const decision: ToolCallPreExecuteDecision = {
                type: 'block',
                reason,
              };
              await this.safeRespondToPreToolUse(requestId, decision);
              return;
            }
            this.debug(`PreToolUse: Source "${sourceSlug}" activated successfully`);
            // Emit source_activated event for UI
            this.eventQueue.enqueue({
              type: 'source_activated' as const,
              sourceSlug,
              originalMessage: this.currentUserMessage,
            });
          } catch (err) {
            this.debug(`PreToolUse: Error activating source "${sourceSlug}": ${err}`);
            const sourceExists = this.sourceManager
              .getAllSources()
              .some((s) => s.config.slug === sourceSlug);
            const reason = sourceExists
              ? `Source "${sourceSlug}" could not be activated: ${err}. Try activating it by @mentioning it in your message or via the source icon at the bottom of the input field.`
              : `Source "${sourceSlug}" is not available yet. It needs to be created and configured first.`;
            this.adapter.setBlockReason(itemId, reason);
            const decision: ToolCallPreExecuteDecision = {
              type: 'block',
              reason,
            };
            await this.safeRespondToPreToolUse(requestId, decision);
            return;
          }
        }
      }
    }

    // ============================================================
    // CALL_LLM INTERCEPT: Pre-execute LLM request and inject result
    // The session-mcp-server can't access Codex auth, so we execute
    // the LLM call here via ephemeral thread and inject the result
    // into the tool input as _precomputedResult.
    // ============================================================
    this.debug(`PreToolUse: call_llm check — sdkToolName="${sdkToolName}" === "mcp__session__call_llm" → ${sdkToolName === 'mcp__session__call_llm'}`);
    if (sdkToolName === 'mcp__session__call_llm') {
      const inputObj = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
      this.debug('PreToolUse: Intercepting call_llm for pre-execution');
      try {
        const result = await this.preExecuteCallLlm(inputObj);
        const decision: ToolCallPreExecuteDecision = {
          type: 'modify',
          input: { ...inputObj, model: result.model ?? inputObj.model, _precomputedResult: JSON.stringify(result) },
        };
        await this.safeRespondToPreToolUse(requestId, decision);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.debug(`PreToolUse: call_llm pre-execution failed: ${errorMsg}`);
        const decision: ToolCallPreExecuteDecision = {
          type: 'modify',
          input: { ...inputObj, _precomputedResult: JSON.stringify({ error: errorMsg }) },
        };
        await this.safeRespondToPreToolUse(requestId, decision);
      }
      return;
    }

    // Track modifications to input
    let modifiedInput: Record<string, unknown> | null = null;
    const inputObj = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

    // ============================================================
    // PATH EXPANSION: Expand ~ in file paths for all file tools
    // ============================================================
    const pathResult = expandToolPaths(sdkToolName, inputObj, (msg) => this.debug(`PreToolUse: ${msg}`));
    if (pathResult.modified) {
      modifiedInput = pathResult.input;
    }

    // ============================================================
    // CONFIG FILE VALIDATION: Validate config writes before they happen
    // ============================================================
    const configResult = validateConfigWrite(
      sdkToolName,
      modifiedInput || inputObj,
      this.workingDirectory,
      (msg) => this.debug(`PreToolUse: ${msg}`)
    );
    if (!configResult.valid) {
      const reason = configResult.error ?? 'Config validation failed';
      this.adapter.setBlockReason(itemId, reason);
      const decision: ToolCallPreExecuteDecision = {
        type: 'block',
        reason,
      };
      await this.safeRespondToPreToolUse(requestId, decision);
      return;
    }

    // ============================================================
    // SKILL QUALIFICATION: Ensure skill names are fully-qualified
    // SDK expects "workspaceSlug:skillSlug" format, NOT UUID
    // ============================================================
    if (sdkToolName === 'Skill') {
      const rootPath = this.config.workspace.rootPath ?? this.workingDirectory;
      const workspaceSlug = extractWorkspaceSlug(rootPath, this.config.workspace.id);
      const skillResult = qualifySkillName(
        modifiedInput || inputObj,
        workspaceSlug,
        rootPath,
        this.config.session?.workingDirectory,
        (msg) => this.debug(`PreToolUse: ${msg}`)
      );
      if (skillResult.modified) {
        modifiedInput = skillResult.input;
      }
    }

    // ============================================================
    // TOOL METADATA STRIPPING: Remove _intent/_displayName from ALL tools
    // (extracted for UI in tool-matching.ts, stripped here before execution)
    // ============================================================
    const metadataResult = stripToolMetadata(
      sdkToolName,
      modifiedInput || inputObj,
      (msg) => this.debug(`PreToolUse: ${msg}`)
    );
    if (metadataResult.modified) {
      modifiedInput = metadataResult.input;
    }

    // If any modifications were made, return modified decision
    if (modifiedInput) {
      this.debug(`PreToolUse: Modifying input for ${toolName}`);
      const decision: ToolCallPreExecuteDecision = {
        type: 'modify',
        input: modifiedInput,
      };
      await this.safeRespondToPreToolUse(requestId, decision);
      return;
    }

    // Allow the tool to proceed
    this.debug(`PreToolUse: Allowing ${toolName}`);
    const decision: ToolCallPreExecuteDecision = { type: 'allow' };
    await this.safeRespondToPreToolUse(requestId, decision);
  }

  /**
   * Map Codex tool type to SDK tool name for shouldAllowToolInMode.
   */
  private mapToolTypeToSdkName(
    toolType: ToolCallType,
    toolName: string,
    mcpServer?: string,
    mcpTool?: string
  ): string {
    switch (toolType) {
      case 'bash':
      case 'localShell':
        return 'Bash';
      case 'fileWrite':
        return 'Write';
      case 'fileEdit':
        return 'Edit';
      case 'mcp':
        // MCP tools follow the pattern mcp__<server>__<tool>
        if (mcpServer && mcpTool) {
          return `mcp__${mcpServer}__${mcpTool}`;
        }
        return toolName;
      case 'function':
      case 'custom':
      default:
        return toolName;
    }
  }

  /**
   * Built-in MCP servers that are always available (not user sources).
   * Must match the set in claude-agent.ts to keep behavior consistent.
   */
  private static readonly BUILT_IN_MCP_SERVERS = new Set([
    'preferences',
    'session',
    'craft-agents-docs',
    'api-bridge',
  ]);

  /**
   * Extract source slug from MCP server name.
   * Returns null for built-in MCP servers (session, preferences, etc.)
   * so that PreToolUse doesn't try to activate them as user sources.
   *
   * Special case: api-bridge is a built-in server that proxies API sources.
   * The real source slug is embedded in the tool name (e.g., "api_slack" → "slack").
   */
  private extractSourceSlugFromMcpServer(mcpServer: string, mcpTool?: string): string | null {
    if (!mcpServer) return null;
    // api-bridge proxies API sources — resolve the real source slug from the tool name
    if (mcpServer === 'api-bridge') {
      if (mcpTool?.startsWith('api_')) {
        return mcpTool.slice(4);
      }
      return null;
    }
    if (CodexAgent.BUILT_IN_MCP_SERVERS.has(mcpServer)) {
      return null;
    }
    return mcpServer;
  }

  /**
   * Determine if the tool needs a permission prompt in ask mode.
   * Returns null if no prompt needed, otherwise returns metadata for the prompt.
   */
  private shouldPromptForPermission(
    toolName: string,
    input: Record<string, unknown>
  ): { type: PermissionPromptType; description: string; command?: string } | null {
    // File writes
    if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
      const filePath = (input.file_path || input.notebook_path) as string | undefined;
      // Check if already whitelisted (use toolName as base for file operations)
      if (!this.permissionManager.isCommandWhitelisted(toolName)) {
        return {
          type: 'file_write',
          description: filePath ? `Write to ${filePath}` : `Modify file`,
          command: filePath,
        };
      }
    }

    // Bash commands
    if (toolName === 'Bash') {
      const command = input.command as string | undefined;
      if (command) {
        const baseCommand = this.permissionManager.getBaseCommand(command);
        if (!this.permissionManager.isCommandWhitelisted(baseCommand)) {
          return {
            type: 'bash',
            description: command.length > 100 ? command.slice(0, 100) + '...' : command,
            command,
          };
        }
      }
    }

    // MCP mutations (non-read-only MCP tools)
    if (toolName.startsWith('mcp__')) {
      // For MCP tools, check if it's whitelisted
      if (!this.permissionManager.isCommandWhitelisted(toolName)) {
        return {
          type: 'mcp_mutation',
          description: toolName.replace('mcp__', '').replace('__', ' → '),
          command: toolName,
        };
      }
    }

    return null;
  }

  // ============================================================
  // ChatGPT Token Management
  // ============================================================

  /**
   * Handle a token refresh request from Codex app-server.
   *
   * This is called when the server receives a 401 and needs fresh tokens.
   * We attempt to refresh using the stored refresh token, and if that fails,
   * we notify the UI that re-authentication is required.
   *
   * Uses a mutex to prevent race conditions when multiple concurrent requests arrive.
   */
  private async handleTokenRefreshRequest(params: ChatGptTokenRefreshRequestParams & { requestId: RequestId }): Promise<void> {
    this.debug(`Token refresh requested: reason=${params.reason}`);

    // Use mutex to prevent race conditions with concurrent refresh requests
    if (this.tokenRefreshInProgress) {
      this.debug('Token refresh already in progress, waiting...');
      try {
        // Add timeout to prevent indefinite hang if refresh promise never resolves
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Token refresh wait timeout (30s)')), 30000)
        );
        await Promise.race([this.tokenRefreshInProgress, timeoutPromise]);

        // After waiting, try to get fresh tokens and respond
        const credentialManager = getCredentialManager();
        const storedCreds = await credentialManager.getLlmOAuth(this.credentialSlug);
        if (storedCreds?.idToken && storedCreds?.accessToken) {
          await this.client?.respondToTokenRefresh(params.requestId, {
            idToken: storedCreds.idToken,
            accessToken: storedCreds.accessToken,
          });
          this.debug('Responded with tokens from concurrent refresh');
          return;
        }
      } catch (err) {
        // Previous refresh failed or timed out, let this request try again
        this.debug(`Token refresh wait failed: ${err}`);
      }
    }

    // Start the actual refresh
    this.tokenRefreshInProgress = this._doTokenRefresh(params);
    try {
      await this.tokenRefreshInProgress;
    } finally {
      this.tokenRefreshInProgress = null;
    }
  }

  /**
   * Internal: perform the actual token refresh.
   * Separated to allow mutex pattern in handleTokenRefreshRequest.
   */
  private async _doTokenRefresh(params: ChatGptTokenRefreshRequestParams & { requestId: RequestId }): Promise<void> {
    try {
      // Get stored credentials
      const credentialManager = getCredentialManager();
      const storedCreds = await credentialManager.getLlmOAuth(this.credentialSlug);

      if (!storedCreds?.refreshToken) {
        this.debug('No refresh token available, requesting re-authentication');
        this.client?.respondToTokenRefreshError(params.requestId, 'No refresh token available');
        this.onChatGptAuthRequired?.('No refresh token - please sign in again');
        return;
      }

      // Attempt to refresh tokens
      this.debug('Refreshing ChatGPT tokens...');
      const newTokens = await refreshChatGptTokens(storedCreds.refreshToken);

      // Store both tokens properly - idToken and accessToken are separate!
      // OpenAI OIDC returns both: idToken (JWT for identity) and accessToken (for API access)
      await credentialManager.setLlmOAuth(this.credentialSlug, {
        accessToken: newTokens.accessToken,  // Store actual accessToken
        idToken: newTokens.idToken,           // Store idToken separately
        refreshToken: newTokens.refreshToken,
        expiresAt: newTokens.expiresAt,
      });

      // Respond to the server with fresh tokens
      this.client?.respondToTokenRefresh(params.requestId, {
        idToken: newTokens.idToken,
        accessToken: newTokens.accessToken,
      });

      this.debug('Token refresh successful');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.debug(`Token refresh failed: ${message}`);

      // Respond with error
      this.client?.respondToTokenRefreshError(params.requestId, message);

      // Notify UI that re-authentication is required
      this.onChatGptAuthRequired?.(`Token refresh failed: ${message}`);
    }
  }

  /**
   * Inject ChatGPT tokens into the Codex app-server.
   *
   * Call this after completing the ChatGPT OAuth flow to authenticate
   * with Codex using the `chatgptAuthTokens` mode.
   *
   * @param tokens - The tokens from the OAuth flow
   */
  async injectChatGptTokens(tokens: ChatGptTokens): Promise<void> {
    const client = await this.ensureClient();

    // Store both tokens properly in credential manager
    // OpenAI OIDC returns both: idToken (JWT for identity) and accessToken (for API access)
    const credentialManager = getCredentialManager();
    await credentialManager.setLlmOAuth(this.credentialSlug, {
      accessToken: tokens.accessToken,  // Store actual accessToken
      idToken: tokens.idToken,           // Store idToken separately
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    // Inject into Codex
    await client.accountLoginWithChatGptTokens({
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
    });

    this.debug('ChatGPT tokens injected successfully');
  }

  /**
   * Check if we have valid ChatGPT credentials stored.
   * Optionally injects them into Codex if available.
   *
   * @returns true if valid credentials exist and were injected
   */
  async tryInjectStoredChatGptTokens(): Promise<boolean> {
    try {
      const credentialManager = getCredentialManager();
      const storedCreds = await credentialManager.getLlmOAuth(this.credentialSlug);

      if (!storedCreds) {
        this.debug('No stored ChatGPT credentials found');
        return false;
      }

      // Check if expired (with 5-minute buffer)
      if (storedCreds.expiresAt && Date.now() > storedCreds.expiresAt - 5 * 60 * 1000) {
        // Try to refresh
        if (storedCreds.refreshToken) {
          this.debug('Stored tokens expired, attempting refresh...');
          const newTokens = await refreshChatGptTokens(storedCreds.refreshToken);

          // Store refreshed tokens in credential manager
          const credMgr = getCredentialManager();
          await credMgr.setLlmOAuth(this.credentialSlug, {
            accessToken: newTokens.accessToken,
            idToken: newTokens.idToken,
            refreshToken: newTokens.refreshToken,
            expiresAt: newTokens.expiresAt,
          });

          // If client is already connected (reconnect scenario), inject directly.
          // Otherwise cache for deferred injection during ensureClient().
          if (this.client?.isConnected()) {
            await this.client.accountLoginWithChatGptTokens({
              idToken: newTokens.idToken,
              accessToken: newTokens.accessToken,
            });
            this.debug('Refreshed ChatGPT tokens injected directly');
          } else {
            this._pendingChatGptTokens = {
              idToken: newTokens.idToken,
              accessToken: newTokens.accessToken,
            };
            this.debug('Refreshed ChatGPT tokens cached for deferred injection');
          }
          return true;
        }
        this.debug('Stored tokens expired and no refresh token available');
        return false;
      }

      // Need both idToken and accessToken to inject
      if (!storedCreds.idToken || !storedCreds.accessToken) {
        this.debug('Stored credentials missing idToken or accessToken');
        return false;
      }

      // If client is already connected (reconnect scenario), inject directly.
      // Otherwise cache for deferred injection during ensureClient() — avoids
      // spawning the app-server process here which can hang for 30s on timeout.
      if (this.client?.isConnected()) {
        await this.client.accountLoginWithChatGptTokens({
          idToken: storedCreds.idToken,
          accessToken: storedCreds.accessToken,
        });
        this.debug('Stored ChatGPT tokens injected directly');
      } else {
        this._pendingChatGptTokens = {
          idToken: storedCreds.idToken,
          accessToken: storedCreds.accessToken,
        };
        this.debug('ChatGPT tokens cached for deferred injection');
      }
      return true;
    } catch (error) {
      this.debug(`Failed to inject stored ChatGPT tokens: ${error}`);
      return false;
    }
  }

  // ============================================================
  // OpenAI API Key Authentication
  // ============================================================

  /**
   * Inject OpenAI API key into the Codex app-server.
   *
   * Alternative to OAuth flow for users with OpenAI Platform API keys.
   * API key usage is billed through the OpenAI Platform account at standard rates.
   *
   * Note: Some Codex features (cloud threads) may not be available with API key auth.
   *
   * @param apiKey - The OpenAI API key from platform.openai.com/api-keys
   */
  async injectApiKey(apiKey: string): Promise<void> {
    const client = await this.ensureClient();

    // Store API key in credential manager for persistence
    const credentialManager = getCredentialManager();
    await credentialManager.setLlmApiKey(this.credentialSlug, apiKey);

    // Inject into Codex app-server
    await client.accountLoginWithApiKey(apiKey);

    this.debug('OpenAI API key injected successfully');
  }

  /**
   * Check if we have a stored OpenAI API key and inject it.
   *
   * Called on startup if the connection uses api_key auth type.
   *
   * @returns true if valid API key was found and injected
   */
  async tryInjectStoredApiKey(): Promise<boolean> {
    try {
      const credentialManager = getCredentialManager();
      const apiKey = await credentialManager.getLlmApiKey(this.credentialSlug);

      if (!apiKey) {
        this.debug('No stored OpenAI API key found');
        return false;
      }

      const client = await this.ensureClient();
      await client.accountLoginWithApiKey(apiKey);

      this.debug('Stored OpenAI API key injected successfully');
      return true;
    } catch (error) {
      this.debug(`Failed to inject stored API key: ${error}`);
      return false;
    }
  }

  // ============================================================
  // Event Queue Management (AsyncGenerator Pattern)
  // ============================================================

  // Event queue methods now provided by EventQueue class

  // ============================================================
  // Title Generation (via app-server)
  // ============================================================

  /**
   * Generate a title by routing through the Codex app-server.
   * Uses the cheapest model (Codex Mini) with an ephemeral thread.
   * Falls back to null on failure — caller should fall back to Claude.
   */
  async generateTitle(prompt: string): Promise<string | null> {
    const client = await this.ensureClient();

    if (!this.config.miniModel) {
      throw new Error('CodexAgent.generateTitle: config.miniModel is required');
    }
    const model = resolveCodexModelId(this.config.miniModel, this.config.authType);

    this.debug(`[generateTitle] Starting ephemeral thread with model=${model}`);

    // Start an ephemeral thread (not persisted, no tools).
    // Mark as ephemeral so main event handlers ignore its events.
    this._startingEphemeralThread = true;
    const response = await client.threadStart({
      model,
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      baseInstructions: 'Reply with ONLY the requested text. No explanation.',
    });
    this._startingEphemeralThread = false;
    const threadId = response.thread.id;
    this._ephemeralThreadIds.add(threadId);

    this.debug(`[generateTitle] Thread started: ${threadId}`);

    // Send the title prompt
    await client.turnStart({
      threadId,
      input: [{ type: 'text', text: prompt, text_elements: [] }],
      cwd: null,
      approvalPolicy: null,
      sandboxPolicy: null,
      model: null,
      effort: null,
      summary: null,
      personality: null,
      outputSchema: null,
      collaborationMode: null,
    });

    // Collect text from agentMessage/delta events until turn completes.
    // Filter by threadId to avoid interference with the main chat thread.
    let title = '';
    const result = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(title); // resolve with whatever we have
      }, 15000);

      const onDelta = (ev: { threadId: string; delta: string }) => {
        if (ev.threadId === threadId) {
          title += ev.delta;
        }
      };
      const onTurnComplete = (ev: { threadId: string }) => {
        if (ev.threadId === threadId) {
          clearTimeout(timeout);
          cleanup();
          resolve(title);
        }
      };
      const onCodexError = (ev: { threadId: string; error: { message?: string } }) => {
        if (ev.threadId === threadId) {
          clearTimeout(timeout);
          cleanup();
          reject(new Error(ev.error?.message ?? 'Codex title generation failed'));
        }
      };
      const onProcessError = (err: Error) => {
        // If a main chat turn is active, this error likely belongs to it — not to title gen
        if (this.currentTurnId) {
          this.debug(`[generateTitle] Ignoring process error during active turn: ${err.message}`);
          return;
        }
        clearTimeout(timeout);
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        client.off('item/agentMessage/delta', onDelta);
        client.off('turn/completed', onTurnComplete);
        client.off('codex/error', onCodexError);
        client.off('error', onProcessError);
      };

      client.on('item/agentMessage/delta', onDelta);
      client.on('turn/completed', onTurnComplete);
      client.on('codex/error', onCodexError);
      client.on('error', onProcessError);
    });

    this._ephemeralThreadIds.delete(threadId);

    const trimmed = result.trim();
    this.debug(`[generateTitle] Result: "${trimmed}"`);
    return (trimmed.length > 0 && trimmed.length < 100) ? trimmed : null;
  }

  // ============================================================
  // Chat & Lifecycle
  // ============================================================

  /**
   * Main chat method - runs the Codex agent loop via app-server.
   */
  async *chat(
    message: string,
    attachments?: FileAttachment[],
    _options?: ChatOptions
  ): AsyncGenerator<AgentEvent> {
    // Wait for any in-flight reconnect to complete before starting the new turn.
    // This prevents the race where auth completes mid-turn, queueReconnect defers,
    // and the next turn starts before the reconnect finishes.
    // Timeout after 30s to avoid deadlocking the session if reconnect hangs.
    if (this._reconnectPromise) {
      this.debug('Waiting for pending reconnect before starting turn...');
      const timeout = new Promise<void>(resolve =>
        setTimeout(() => {
          this.debug('Pending reconnect timed out after 30s, proceeding anyway');
          resolve();
        }, 30_000)
      );
      await Promise.race([this._reconnectPromise, timeout]);
      // Clean up stale state in case timeout won
      this._reconnectPromise = null;
      this._resolveReconnectPromise = null;
      this._pendingReconnect = false;
      this.debug('Pending reconnect resolved, proceeding with turn');
    }

    this._isProcessing = true;
    this.abortReason = undefined;
    this.eventQueue.reset();
    this.inflightItemHandlers = 0;
    this.turnCompletedPending = false;
    this._ephemeralThreadIds.clear();
    this._startingEphemeralThread = false;
    this.adapter.startTurn();
    this.currentUserMessage = message; // Store for source_activated events

    // Get centralized mini agent configuration (from BaseAgent)
    // This ensures Claude and Codex agents use the same detection and constants
    const miniConfig = this.getMiniAgentConfig();

    // Log mini agent mode details
    if (miniConfig.enabled) {
      this.debug('🤖 MINI AGENT mode - optimized for quick config edits');
      this.debug(`Mini agent optimizations: model=codex-mini, effort=low, baseInstructions=custom`);
    }

    try {
      // Ensure client is connected
      const client = await this.ensureClient();

      // Start or resume thread
      const permissionMode = this.permissionManager.getPermissionMode();

      // Mini agent model selection: use last model from connection (mini/summarization model)
      // resolveCodexModelId maps abstract IDs to actual versioned slugs based on auth type
      const model = resolveCodexModelId(
        miniConfig.enabled ? (this.config.miniModel ?? DEFAULT_CODEX_MODEL) : this._model,
        this.config.authType,
      );
      if (this.codexThreadId) {
        // Resume existing thread from disk
        try {
          await client.threadResume({
            threadId: this.codexThreadId,
            history: null,
            path: null,
            // Mini agent: use last model from connection for resumed threads too
            model: miniConfig.enabled ? resolveCodexModelId(this.config.miniModel ?? DEFAULT_CODEX_MODEL, this.config.authType) : null,
            modelProvider: null,
            cwd: null,
            approvalPolicy: null,
            sandbox: null,
            config: null,
            // Inject Craft Agent system prompt on resume (mini or full)
            baseInstructions: miniConfig.enabled
              ? this.getMiniSystemPrompt()
              : getSystemPrompt(
                  undefined, // preferences formatted fresh
                  this.config.debugMode,
                  this.config.workspace.rootPath,
                  this.config.session?.workingDirectory,
                  undefined, // preset (default)
                  'Codex' // backend name
                ),
            developerInstructions: null,
            personality: null,
          });
          this.debug(`Resumed thread: ${this.codexThreadId}`);
        } catch (err) {
          // Thread not found or corrupted - fall back to new thread with recovery context
          this.debug(
            `Failed to resume thread ${this.codexThreadId}, starting new with recovery: ${err instanceof Error ? err.message : err}`
          );

          // Clear old session and notify
          this.clearSessionForRecovery();

          // Build recovery context from previous messages (inherited from BaseAgent)
          const recoveryContext = this.buildRecoveryContext();
          if (recoveryContext) {
            // Prepend recovery context to message for injection below
            message = recoveryContext + message;
            this.debug('Injected recovery context into message');
          }

          const response = await client.threadStart({
            model,
            cwd: this.workingDirectory,
            approvalPolicy: this.getApprovalPolicy(permissionMode),
            sandbox: this.getSandboxMode(permissionMode),
            // Inject Craft Agent system prompt (mini or full)
            baseInstructions: miniConfig.enabled
              ? this.getMiniSystemPrompt()
              : getSystemPrompt(
                  undefined, // preferences formatted fresh
                  this.config.debugMode,
                  this.config.workspace.rootPath,
                  this.config.session?.workingDirectory,
                  undefined, // preset (default)
                  'Codex' // backend name
                ),
          });
          this.codexThreadId = response.thread.id;
          this.debug(`Started new thread: ${this.codexThreadId}`);
          this.config.onSdkSessionIdUpdate?.(this.codexThreadId);
        }
      } else {
        // Start new thread
        const response = await client.threadStart({
          model,
          cwd: this.workingDirectory,
          approvalPolicy: this.getApprovalPolicy(permissionMode),
          sandbox: this.getSandboxMode(permissionMode),
          // Inject Craft Agent system prompt (mini or full)
          baseInstructions: miniConfig.enabled
            ? this.getMiniSystemPrompt()
            : getSystemPrompt(
                undefined, // preferences formatted fresh
                this.config.debugMode,
                this.config.workspace.rootPath,
                this.config.session?.workingDirectory,
                undefined, // preset (default)
                'Codex' // backend name
              ),
        });
        this.codexThreadId = response.thread.id;
        this.debug(`Started new thread: ${this.codexThreadId}`);
        this.config.onSdkSessionIdUpdate?.(this.codexThreadId);
      }

      // Build user input
      const input = this.buildUserInput(message, attachments);

      // Start turn
      const inputSummary = input.map(i => i.type === 'skill' ? `skill:${(i as any).name}` : i.type === 'text' ? `text(${(i as any).text?.length ?? 0} chars)` : i.type).join(', ');
      this.debug(`Starting turn with ${input.length} input items: [${inputSummary}]`);
      await client.turnStart({
        threadId: this.codexThreadId!,
        input,
        cwd: null,
        approvalPolicy: null,
        sandboxPolicy: null,
        model: null,
        effort: this.getReasoningEffort(),
        summary: null,
        personality: null,
        outputSchema: null,
        collaborationMode: null,
      });

      // Yield events from queue until turn completes
      yield* this.eventQueue.drain();

      // Emit complete if not already emitted by the adapter
      if (!this.eventQueue.isComplete) {
        yield { type: 'complete' };
      }

    } catch (error) {
      if (error instanceof Error && error.message.includes('abort')) {
        // Check abort reason
        if (this.abortReason === AbortReason.PlanSubmitted) {
          return;
        }
        if (this.abortReason === AbortReason.AuthRequest) {
          return;
        }
        return;
      }

      // Parse error and emit typed error if possible
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const typedError = this.parseCodexError(errorObj);

      if (typedError.code !== 'unknown_error') {
        // Known error type - emit typed error with recovery actions
        yield { type: 'typed_error', error: typedError };
      } else {
        // Unknown error - emit raw error message
        yield {
          type: 'error',
          message: errorObj.message,
        };
      }

      // Emit complete even on error so application knows we're done
      yield { type: 'complete' };
    } finally {
      this._isProcessing = false;

      // Execute deferred reconnect if one was queued during this turn
      if (this._pendingReconnect) {
        this._pendingReconnect = false;
        this.debug('Executing deferred reconnect...');
        try {
          await this.reconnect();
          this.debug('Deferred reconnect completed');
        } catch (err) {
          this.debug(`Deferred reconnect failed: ${err instanceof Error ? err.stack ?? err.message : err}`);
        } finally {
          // Resolve the promise so waiters (next chat() turn) can proceed
          this._resolveReconnectPromise?.();
          this._reconnectPromise = null;
          this._resolveReconnectPromise = null;
        }
      }
    }
  }

  /**
   * Check if a tool result error indicates a "tool not found" for an inactive source.
   * Uses SourceManager to detect when Codex tries to call a tool from a source
   * that exists but isn't currently active, so we can auto-activate and retry.
   *
   * @param event - The tool_result event to check
   * @returns The source slug and tool name if this is an inactive source error, null otherwise
   */
  private detectInactiveSourceToolError(
    event: AgentEvent
  ): { sourceSlug: string; toolName: string } | null {
    if (event.type !== 'tool_result' || !event.isError) return null;

    const resultStr = typeof event.result === 'string' ? event.result : '';

    // Use SourceManager's detection method which handles all the pattern matching
    // and checks against allSources and activeSlugs
    return this.sourceManager.detectInactiveSourceToolError(
      event.toolName ?? '',
      resultStr
    );
  }

  /**
   * Parse a Codex error into a typed AgentError.
   * Uses the shared parseError function to handle common error patterns,
   * with Codex-specific overrides for auth and rate limit errors.
   *
   * @param error - The error to parse
   * @returns Typed AgentError with recovery actions
   */
  private parseCodexError(error: Error): AgentError {
    const errorMessage = error.message.toLowerCase();

    // Codex-specific error patterns
    // OAuth errors (Codex uses ChatGPT Plus OAuth via app-server)
    if (
      errorMessage.includes('not logged in') ||
      errorMessage.includes('login required') ||
      errorMessage.includes('auth') && errorMessage.includes('fail')
    ) {
      return {
        code: 'invalid_credentials',
        title: 'Authentication Required',
        message: 'You need to authenticate with your OpenAI account. Run "codex login" in terminal or check your ~/.codex/auth.json file.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        originalError: error.message,
      };
    }

    // App-server initialization timeout (process started but didn't respond)
    if (errorMessage.includes('request timeout') && errorMessage.includes('initialize')) {
      return {
        code: 'network_error',
        title: 'Codex Failed to Start',
        message: 'The Codex app-server started but did not respond. This may be caused by an expired OpenAI quota or network issue. Check your OpenAI billing at platform.openai.com.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        originalError: error.message,
      };
    }

    // App-server connection errors
    if (
      errorMessage.includes('failed to connect') ||
      errorMessage.includes('codex') && errorMessage.includes('not found') ||
      errorMessage.includes('spawn') && errorMessage.includes('enoent')
    ) {
      return {
        code: 'network_error',
        title: 'Codex Not Found',
        message: 'Could not start the Codex app-server. Make sure Codex is installed and accessible in your PATH.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        originalError: error.message,
      };
    }

    // OpenAI quota exhaustion (insufficient_quota / exceeded quota)
    if (errorMessage.includes('quota') || errorMessage.includes('insufficient_quota')) {
      return {
        code: 'rate_limited',
        title: 'OpenAI Quota Exceeded',
        message: 'Your OpenAI API quota has been exceeded. Check your plan and billing at platform.openai.com.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        originalError: error.message,
      };
    }

    // OpenAI rate limiting
    if (errorMessage.includes('rate') || errorMessage.includes('429')) {
      return {
        code: 'rate_limited',
        title: 'Rate Limited',
        message: 'Too many requests to OpenAI. Please wait a moment before trying again.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 5000,
        originalError: error.message,
      };
    }

    // Fall back to shared error parsing
    return parseError(error);
  }

  /**
   * Build user input from message and attachments.
   * Mirrors ClaudeAgent's buildSDKUserMessage() for full context parity.
   *
   * Also extracts [skill:...] mentions from the message and adds them as
   * skill UserInput items, which is how Codex discovers and loads skills.
   */
  private buildUserInput(
    message: string,
    attachments?: FileAttachment[]
  ): UserInput[] {
    const input: UserInput[] = [];

    // ============================================================
    // SKILL MENTION EXTRACTION (delegated to BaseAgent)
    // ============================================================
    const { skillContents, cleanMessage: effectiveMessage } = this.extractSkillContent(message);

    // ============================================================
    // CONTEXT INJECTION (matching ClaudeAgent)
    // ============================================================

    // Build context parts using centralized PromptBuilder
    // This includes: date/time, session state (with plansFolderPath),
    // workspace capabilities, and working directory context
    const workspaceRoot = this.config.workspace.rootPath ?? this.workingDirectory;
    const contextParts = this.promptBuilder.buildContextParts(
      {
        plansFolderPath: getSessionPlansPath(
          workspaceRoot,
          this._sessionId
        ),
      },
      this.sourceManager.formatSourceState()
    );

    // ============================================================
    // FILE ATTACHMENTS (text files as path references)
    // ============================================================

    const attachmentParts: string[] = [];
    const imageAttachments: FileAttachment[] = [];

    for (const att of attachments || []) {
      if (att.mimeType?.startsWith('image/') && (att.storedPath || att.path)) {
        // Images: collect for separate UserInput items (localImage type)
        imageAttachments.push(att);
      } else if (att.mimeType === 'application/pdf' && att.storedPath) {
        // PDFs: add as path reference - Codex can use Read tool to access
        // (Read tool supports PDFs with page-by-page extraction)
        const pathInfo = `[Attached PDF: ${att.name}]\n[Stored at: ${att.storedPath}]`;
        attachmentParts.push(pathInfo);
      } else if (att.storedPath) {
        // Text/other files: add as path references (like Claude does)
        let pathInfo = `[Attached file: ${att.name}]`;
        pathInfo += `\n[Stored at: ${att.storedPath}]`;
        if (att.markdownPath) {
          pathInfo += `\n[Markdown version: ${att.markdownPath}]`;
        }
        attachmentParts.push(pathInfo);
      }
    }

    // ============================================================
    // COMBINE INTO MESSAGE
    // ============================================================

    // Combine: skill instructions + context + attachments + user message
    const allParts = [
      ...skillContents,
      ...contextParts,
      ...attachmentParts,
      effectiveMessage,
    ].filter(Boolean);

    const fullMessage = allParts.join('\n\n');

    if (fullMessage) {
      input.push({ type: 'text', text: fullMessage, text_elements: [] });
    }

    // ============================================================
    // IMAGE ATTACHMENTS (as localImage type)
    // ============================================================

    for (const att of imageAttachments) {
      input.push({ type: 'localImage', path: att.storedPath || att.path });
    }

    return input;
  }

  /**
   * Get Codex approval policy from permission mode.
   * Valid values: "untrusted" | "on-failure" | "on-request" | "never"
   */
  private getApprovalPolicy(_mode: PermissionMode): AskForApproval {
    // Use 'never' for all modes.
    // Our PreToolUse hook handles ALL permission logic:
    // - Explore: blocks everything except plans folder (via shouldAllowToolInMode)
    // - Ask: prompts user for approval
    // - Execute: auto-approves
    // Codex's built-in approval would interfere with our logic.
    return 'never';
  }

  /**
   * Get Codex sandbox mode from permission mode.
   * Valid values: "read-only" | "workspace-write" | "danger-full-access"
   */
  private getSandboxMode(_mode: PermissionMode): SandboxMode {
    // Use danger-full-access for all modes.
    // Our PreToolUse hook handles all permission logic:
    // - Explore: blocks everything except plans folder
    // - Ask: prompts for approval
    // - Execute: auto-approves
    return 'danger-full-access';
  }

  /**
   * Get reasoning effort from thinking level.
   * Mini agents force 'low' effort for faster responses.
   */
  private getReasoningEffort(): ReasoningEffort {
    // Mini agents use minimal reasoning for efficiency (quick config edits don't need deep reasoning)
    if (this.getMiniAgentConfig().minimizeThinking) {
      return 'low';
    }
    const level = this._ultrathinkOverride ? 'max' : this._thinkingLevel;
    return THINKING_TO_EFFORT[level] || 'medium';
  }

  // ============================================================
  // Abort & Lifecycle
  // ============================================================

  async abort(reason?: string): Promise<void> {
    if (this.client?.isConnected() && this.codexThreadId && this.currentTurnId) {
      try {
        await this.client.turnInterrupt({
          threadId: this.codexThreadId,
          turnId: this.currentTurnId,
        });
      } catch (e) {
        this.debug(`Failed to interrupt turn: ${e}`);
      }
    }
    this.eventQueue.complete();
    this.debug(`Aborted: ${reason || 'user stop'}`);
  }

  forceAbort(reason: AbortReason): void {
    this.abortReason = reason;
    this.eventQueue.complete();
    this.debug(`Force aborting: ${reason}`);

    // Clear pending permission/approval promises
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({ allowed: false, acceptForSession: false });
    }
    this.pendingPermissions.clear();
    this.pendingApprovals.clear();

    // For PlanSubmitted and AuthRequest, just interrupt the turn - don't disconnect
    // The user will respond (approve plan, complete auth) and we need to continue in the same session
    if (reason === AbortReason.PlanSubmitted || reason === AbortReason.AuthRequest) {
      if (this.client?.isConnected() && this.codexThreadId && this.currentTurnId) {
        this.client.turnInterrupt({
          threadId: this.codexThreadId,
          turnId: this.currentTurnId,
        }).catch((e) => this.debug(`Failed to interrupt turn: ${e}`));
      }
      return;
    }

    // For other reasons (context switch, shutdown, etc.), disconnect fully
    if (this.client) {
      this.client.disconnect().catch(() => {});
      this.client = null;
      this.clientConnecting = null;
    }
  }

  /**
   * Clean up Codex-specific resources.
   * Calls super.destroy() for base cleanup.
   */
  override destroy(): void {
    // Codex-specific cleanup
    this.client?.disconnect().catch(() => {});
    this.client = null;

    // Clear all pending permission/approval promises
    for (const [id, pending] of this.pendingPermissions) {
      pending.resolve({ allowed: false, acceptForSession: false });
    }
    this.pendingPermissions.clear();
    this.pendingApprovals.clear();

    // Base cleanup (stops config watcher, clears whitelists, resets trackers)
    super.destroy();
  }

  isProcessing(): boolean {
    return this._isProcessing;
  }

  /**
   * Reconnect to the app-server with potentially updated configuration.
   *
   * Use this when:
   * - Sources are toggled (config.toml was regenerated)
   * - CODEX_HOME contents changed
   *
   * The method disconnects the current client, spawns a new app-server process,
   * and resumes the existing thread to preserve conversation context.
   *
   * @throws Error if called during active processing
   */
  async reconnect(): Promise<void> {
    if (this._isProcessing) {
      throw new Error('Cannot reconnect while processing - wait for turn to complete');
    }

    const threadId = this.codexThreadId;
    this.debug(`Reconnecting app-server${threadId ? ` (will resume thread ${threadId})` : ''}`);

    // Disconnect existing client
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (error) {
        this.debug(`Disconnect error (ignoring): ${error}`);
      }
      this.client = null;
      this.clientConnecting = null;
    }

    // Connect new client (will read updated config.toml)
    const client = await this.ensureClient();

    // Resume thread if we had one
    if (threadId) {
      try {
        // Ensure auth tokens are injected before resuming to avoid 401 loops after interrupts
        const normalizedAuthType =
          this.config.authType ??
          (this.config.legacyAuthType === 'api_key'
            ? 'api_key'
            : this.config.legacyAuthType === 'oauth_token'
              ? 'oauth'
              : undefined);

        if (normalizedAuthType === 'oauth') {
          this.debug('Attempting ChatGPT token injection before thread resume...');
          const injected = await this.tryInjectStoredChatGptTokens();
          if (!injected) {
            this.debug('ChatGPT token injection failed after reconnect; skipping thread resume');
            this.onChatGptAuthRequired?.('Missing or expired ChatGPT tokens after reconnect');
            return;
          }
          this.debug('ChatGPT token injection succeeded before thread resume');
        } else if (normalizedAuthType === 'api_key' || normalizedAuthType === 'api_key_with_endpoint') {
          this.debug('Attempting API key injection before thread resume...');
          const injected = await this.tryInjectStoredApiKey();
          if (!injected) {
            this.debug('API key injection failed after reconnect; skipping thread resume');
            return;
          }
          this.debug('API key injection succeeded before thread resume');
        } else {
          this.debug(`Auth type ${normalizedAuthType ?? 'unknown'} - skipping explicit auth injection`);
        }

        // Get mini agent config to determine which system prompt to use
        const miniConfig = this.getMiniAgentConfig();

        await client.threadResume({
          threadId,
          history: null,
          path: null,
          model: null,
          modelProvider: null,
          cwd: null,
          approvalPolicy: null,
          sandbox: null,
          config: null,
          // Re-inject Craft Agent system prompt after reconnect
          baseInstructions: miniConfig.enabled
            ? this.getMiniSystemPrompt()
            : getSystemPrompt(
                undefined, // preferences formatted fresh
                this.config.debugMode,
                this.config.workspace.rootPath,
                this.config.session?.workingDirectory,
                undefined, // preset (default)
                'Codex' // backend name
              ),
          developerInstructions: null,
          personality: null,
        });
        this.debug(`Thread ${threadId} resumed successfully`);
      } catch (error) {
        // Thread resume failed - might be a fresh CODEX_HOME
        // Clear the thread ID and let the next message start a new thread
        this.debug(`Thread resume failed (will start new thread): ${error}`);
        this.codexThreadId = null;
        this.config.onSdkSessionIdCleared?.();
      }
    }
  }

  /**
   * Queue a reconnect. If not processing, reconnects immediately.
   * If processing, defers until the current turn completes.
   * Safe to call multiple times — reuses the same deferred promise.
   */
  async queueReconnect(): Promise<void> {
    if (this._isProcessing) {
      this._pendingReconnect = true;
      // Reuse the existing promise if one is already queued, so multiple callers
      // all wait on the same reconnect and no resolver is orphaned.
      if (!this._reconnectPromise) {
        this._reconnectPromise = new Promise(resolve => {
          this._resolveReconnectPromise = resolve;
        });
        this.debug('Reconnect queued (will execute after turn completes)');
      } else {
        this.debug('Reconnect already queued, reusing existing promise');
      }
      return;
    }
    await this.reconnect();
  }

  // ============================================================
  // Codex-specific Methods
  // ============================================================

  /**
   * Get the list of available SDK tools.
   * For Codex backend, tools are managed by the app-server internally.
   * Returns empty array as tool discovery isn't exposed via the app-server API.
   */
  getSdkTools(): string[] {
    // Codex app-server manages tools internally and doesn't expose them via API
    // Return empty array for interface compatibility
    return [];
  }

  respondToPermission(requestId: string, allowed: boolean, alwaysAllow?: boolean): void {
    // Check unified PreToolUse permissions first
    const unifiedPending = this.pendingPermissions.get(requestId);
    if (unifiedPending) {
      // Handle whitelisting for acceptForSession
      if (allowed && alwaysAllow && unifiedPending.command) {
        const baseCommand = this.permissionManager.getBaseCommand(unifiedPending.command);

        // Check for network commands - whitelist domain instead
        const domain = this.permissionManager.extractDomainFromNetworkCommand(unifiedPending.command);
        if (domain) {
          this.permissionManager.whitelistDomain(domain);
          this.debug(`Whitelisted domain: ${domain}`);
        } else if (!this.permissionManager.isDangerousCommand(baseCommand)) {
          this.permissionManager.whitelistCommand(baseCommand);
          this.debug(`Whitelisted command: ${baseCommand}`);
        }
      }

      unifiedPending.resolve({ allowed, acceptForSession: alwaysAllow ?? false });
      this.pendingPermissions.delete(requestId);
      return;
    }

    // Fall back to legacy approval handlers
    const pending = this.pendingApprovals.get(requestId);
    if (pending) {
      let decision: CommandExecutionApprovalDecision | FileChangeApprovalDecision;

      if (allowed) {
        decision = alwaysAllow ? 'acceptForSession' : 'accept';

        // Whitelist command for future auto-approval in this session
        if (alwaysAllow && pending.type === 'command' && pending.command) {
          const baseCommand = this.permissionManager.getBaseCommand(pending.command);

          // Check for network commands - whitelist domain instead
          const domain = this.permissionManager.extractDomainFromNetworkCommand(pending.command);
          if (domain) {
            this.permissionManager.whitelistDomain(domain);
            this.debug(`Whitelisted domain: ${domain}`);
          } else if (!this.permissionManager.isDangerousCommand(baseCommand)) {
            // Only whitelist non-dangerous commands
            this.permissionManager.whitelistCommand(baseCommand);
            this.debug(`Whitelisted command: ${baseCommand}`);
          }
        }
      } else {
        decision = 'decline';
      }

      pending.resolve(decision);
      this.pendingApprovals.delete(requestId);
    }
  }

  /**
   * Override to return Codex thread ID (used for session resume).
   */
  override getSessionId(): string | null {
    return this.codexThreadId;
  }

  /**
   * Override to set Codex thread ID.
   */
  override setSessionId(sessionId: string | null): void {
    this.codexThreadId = sessionId;
  }

  /**
   * Override to clear thread when switching workspaces.
   */
  override setWorkspace(workspace: Workspace): void {
    super.setWorkspace(workspace);
    // Clear thread when switching workspaces - caller should set session separately if needed
    this.codexThreadId = null;
  }

  /**
   * Override to clear Codex-specific state.
   * Resets thread ID so next chat() starts a new thread.
   */
  override clearHistory(): void {
    this.codexThreadId = null;
    this.currentTurnId = null;
    super.clearHistory();
    this.debug('History cleared - next chat will start new thread');
  }

  // ============================================================
  // Source Management (Codex-specific override)
  // ============================================================

  /**
   * Override to add Codex-specific warnings about MCP server configuration.
   * In app-server mode, MCP servers must be configured via ~/.codex/config.toml.
   */
  override setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, unknown>,
    intendedSlugs?: string[]
  ): void {
    // Call base implementation for SourceManager state tracking
    super.setSourceServers(mcpServers, apiServers, intendedSlugs);

    // Note: App-server mode uses ~/.codex/config.toml for MCP server configuration
    // Runtime injection is not supported in the same way as exec mode
    // Users should configure MCP servers in their Codex config file
    const mcpServerCount = Object.keys(mcpServers).length;
    if (mcpServerCount > 0) {
      this.debug(
        `MCP servers (${mcpServerCount}) should be configured in ~/.codex/config.toml for app-server mode. ` +
        `Runtime injection is not supported. Servers: ${Object.keys(mcpServers).join(', ')}`
      );
    }

    const apiServerCount = Object.keys(apiServers).length;
    if (apiServerCount > 0) {
      this.debug(
        `API servers (${apiServerCount}) are not supported in Codex backend. ` +
        `Servers: ${Object.keys(apiServers).join(', ')}`
      );
    }
  }

  // ============================================================
  // LLM Tool Pre-Execution (call_llm via PreToolUse intercept)
  // ============================================================

  /**
   * Pre-execute a call_llm request: process attachments, resolve model,
   * build prompt with structured output injection, and run via ephemeral thread.
   */
  private async preExecuteCallLlm(input: Record<string, unknown>): Promise<LLMQueryResult> {
    const request = await buildCallLlmRequest(input, {
      backendName: 'Codex',
      validateModel: (modelId) => {
        const provider = getModelProvider(modelId);
        if (provider && provider !== 'openai') {
          this.debug(`preExecuteCallLlm: model "${modelId}" is ${provider}, falling back to miniModel`);
          return undefined;
        }
        return modelId;
      },
    });
    return this.queryLlm(request);
  }

  /**
   * Execute an LLM query via ephemeral thread.
   * Same pattern as runMiniCompletion but with configurable system prompt and model.
   */
  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    this.debug('[CodexAgent.queryLlm] Starting');

    const client = await this.ensureClient();
    const rawModel = request.model ?? this.config.miniModel ?? getDefaultSummarizationModel();
    const model = resolveCodexModelId(rawModel, this.config.authType);

    this.debug(`[CodexAgent.queryLlm] Using model: ${model}`);

    // Start an ephemeral thread with the system prompt.
    // Mark as ephemeral so main event handlers ignore its events.
    this._startingEphemeralThread = true;
    const threadResponse = await client.threadStart({
      model,
      cwd: this.workingDirectory,
      baseInstructions: request.systemPrompt ?? 'Reply with ONLY the requested text. No explanation.',
      ephemeral: true,
    });
    this._startingEphemeralThread = false;
    const threadId = threadResponse.thread.id;
    this._ephemeralThreadIds.add(threadId);
    this.debug(`[CodexAgent.queryLlm] Started ephemeral thread: ${threadId}`);

    // Collect response text from deltas
    let result = '';
    let completionResolve: () => void;
    const completionPromise = new Promise<void>((resolve) => {
      completionResolve = resolve;
    });

    const textHandler = (notification: { threadId: string; delta?: string }) => {
      if (notification.threadId === threadId && notification.delta) {
        result += notification.delta;
      }
    };

    const completionHandler = (notification: { threadId: string }) => {
      if (notification.threadId === threadId) {
        completionResolve();
      }
    };

    client.on('item/agentMessage/delta', textHandler);
    client.on('turn/completed', completionHandler);

    try {
      await client.turnStart({
        threadId,
        input: [{ type: 'text', text: request.prompt, text_elements: [] }],
        cwd: null,
        approvalPolicy: null,
        sandboxPolicy: null,
        model: null,
        effort: null,
        summary: null,
        personality: null,
        outputSchema: null,
        collaborationMode: null,
      });

      // 30s timeout matching runMiniCompletion
      await withTimeout(completionPromise, 30000, 'call_llm timed out after 30s');

      this.debug(`[CodexAgent.queryLlm] Result length: ${result.trim().length}`);
      return { text: result.trim(), model };
    } finally {
      client.off('item/agentMessage/delta', textHandler);
      client.off('turn/completed', completionHandler);
      this._ephemeralThreadIds.delete(threadId);
    }
  }

  // ============================================================
  // Mini Completion (for title generation and other quick tasks)
  // ============================================================

  /**
   * Run a simple text completion using the Codex app-server.
   * No tools, empty system prompt - just text in → text out.
   * Uses the same auth infrastructure as the main agent.
   *
   * Creates an ephemeral thread for the completion so it doesn't
   * interfere with the main conversation thread.
   */
  async runMiniCompletion(prompt: string): Promise<string | null> {
    this.debug(`[runMiniCompletion] Starting`);

    try {
      // Ensure client is connected (includes auth injection)
      const client = await this.ensureClient();
      this.debug(`[runMiniCompletion] Client connected`);

      if (!this.config.miniModel) {
        throw new Error('CodexAgent.runMiniCompletion: config.miniModel is required');
      }
      const model = this.config.miniModel;
      this.debug(`[runMiniCompletion] Using model: ${model}`);

      // Start an ephemeral thread with no system prompt.
      // Mark as ephemeral so main event handlers ignore its events.
      this.debug(`[runMiniCompletion] Starting ephemeral thread...`);
      this._startingEphemeralThread = true;
      const threadResponse = await client.threadStart({
        model,
        cwd: this.workingDirectory,
        baseInstructions: '', // Empty - no system prompt
        ephemeral: true, // Don't persist this thread
      });
      this._startingEphemeralThread = false;
      const threadId = threadResponse.thread.id;
      this._ephemeralThreadIds.add(threadId);
      this.debug(`[runMiniCompletion] Started ephemeral thread: ${threadId}`);

      // Set up Promise-based completion tracking
      let result = '';
      let completionResolve: () => void;
      const completionPromise = new Promise<void>((resolve) => {
        completionResolve = resolve;
      });

      // Collect response text from deltas
      const textHandler = (notification: { threadId: string; delta?: string }) => {
        if (notification.threadId === threadId && notification.delta) {
          result += notification.delta;
          this.debug(`[runMiniCompletion] Delta: ${notification.delta}`);
        }
      };

      // Resolve when turn completes
      const completionHandler = (notification: { threadId: string }) => {
        if (notification.threadId === threadId) {
          this.debug(`[runMiniCompletion] Turn completed`);
          completionResolve();
        }
      };

      // Set up listeners
      client.on('item/agentMessage/delta', textHandler);
      client.on('turn/completed', completionHandler);

      try {
        // Start the turn with our prompt
        this.debug(`[runMiniCompletion] Starting turn...`);
        await client.turnStart({
          threadId,
          input: [{ type: 'text', text: prompt, text_elements: [] }],
          cwd: null,
          approvalPolicy: null,
          sandboxPolicy: null,
          model: null,
          effort: null,
          summary: null,
          personality: null,
          outputSchema: null,
          collaborationMode: null,
        });
        this.debug(`[runMiniCompletion] Turn started`);

        // Wait for turn completion with timeout
        try {
          await withTimeout(completionPromise, 30000, 'runMiniCompletion timed out after 30s');
        } catch (e) {
          this.debug(`[runMiniCompletion] Timeout waiting for completion`);
        }

        const text = result.trim() || null;
        this.debug(`[runMiniCompletion] Result: ${text ? `"${text.slice(0, 200)}"` : 'null'}`);
        return text;
      } finally {
        // Clean up listeners and ephemeral thread tracking
        client.off('item/agentMessage/delta', textHandler);
        client.off('turn/completed', completionHandler);
        this._ephemeralThreadIds.delete(threadId);
      }
    } catch (error) {
      this.debug(`[runMiniCompletion] Failed: ${error}`);
      return null;
    }
  }
}

// ============================================================
// Backward Compatibility Export
// ============================================================
// This alias allows gradual migration from CodexBackend to CodexAgent.
// Once all consumers are updated, this can be removed.

/** @deprecated Use CodexAgent instead */
export { CodexAgent as CodexBackend };
