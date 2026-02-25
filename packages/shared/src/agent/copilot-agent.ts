/**
 * Copilot Backend (GitHub Copilot SDK)
 *
 * Agent backend implementation using the @github/copilot-sdk.
 * Wraps the Copilot CLI via JSON-RPC over stdio — architecturally similar
 * to our Codex integration but with native pre/post-tool hooks and MCP support.
 *
 * Auth is GitHub OAuth. Tokens stored at `llm_oauth::copilot`.
 */

import http from 'node:http';
import type { AgentEvent } from '@craft-agent/core/types';
import type { FileAttachment } from '../utils/files.ts';
import type { ThinkingLevel } from './thinking-levels.ts';
import type { PermissionMode } from './mode-manager.ts';

import type {
  BackendConfig,
  ChatOptions,
  SdkMcpServerConfig,
} from './backend/types.ts';
import { AbortReason } from './backend/types.ts';
import { getBackendRuntime } from './backend/internal/driver-types.ts';

// Import models from centralized registry
import { getModelById, getDefaultSummarizationModel } from '../config/models.ts';

/**
 * Validate that a model ID is a known Copilot model.
 * Returns the model ID as-is — Copilot models are dynamic (from listModels()),
 * not in the static registry, so we trust the connection's model list.
 */
export function resolveCopilotModelId(modelId: string): string {
  return modelId;
}

// BaseAgent provides common functionality
import { BaseAgent } from './base-agent.ts';
import type { Workspace } from '../config/storage.ts';

// Copilot SDK
import { CopilotClient, CopilotSession } from '@github/copilot-sdk';
import type {
  SessionConfig as CopilotSessionConfig,
  ResumeSessionConfig as CopilotResumeConfig,
  MCPServerConfig as CopilotMCPServerConfig,
  SessionEvent,
  PermissionRequest as CopilotPermissionRequest,
  PermissionRequestResult,
  ToolResultObject,
} from '@github/copilot-sdk';

// Hook types are defined in types.d.ts but not re-exported from the package entry.
// We define local interfaces matching the SDK's shape.
interface PreToolUseHookInput {
  timestamp: number;
  cwd: string;
  toolName: string;
  toolArgs: unknown;
  toolCallId?: string;
  metadata?: {
    intent?: string;
    displayName?: string;
  };
}

interface PreToolUseHookOutput {
  permissionDecision?: 'allow' | 'deny' | 'ask';
  permissionDecisionReason?: string;
  modifiedArgs?: unknown;
  additionalContext?: string;
  suppressOutput?: boolean;
}

interface PostToolUseHookInput {
  timestamp: number;
  cwd: string;
  toolName: string;
  toolArgs: unknown;
  toolResult: ToolResultObject;
}

interface PostToolUseHookOutput {
  modifiedResult?: ToolResultObject;
}

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

// Event adapter
import { CopilotEventAdapter } from './backend/copilot/event-adapter.ts';
import { EventQueue } from './backend/event-queue.ts';

// Centralized PreToolUse pipeline
import {
  runPreToolUseChecks,
  type PreToolUseCheckResult,
} from './core/pre-tool-use.ts';

// Large response handling
import { handleLargeResponse, estimateTokens, TOKEN_LIMIT } from '../utils/large-response.ts';

// System prompt for Craft Agent context
import { getSystemPrompt } from '../prompts/system.ts';

// Credential manager for token storage
import { getCredentialManager } from '../credentials/manager.ts';

// Session-scoped tool callbacks (for SubmitPlan, source auth, etc.)
import {
  registerSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
} from './session-scoped-tools.ts';
import { toolMetadataStore } from '../interceptor-common.ts';

// Path utilities
import { join } from 'path';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'os';

// Session storage (plans folder path)
import { getSessionPlansPath, getSessionPath } from '../sessions/storage.ts';

// Bridge utilities for API source config
import { writeBridgeSourceFiles } from '../codex/bridge-utils.ts';
import type { PostInitResult, BridgeUpdateContext } from './backend/types.ts';

// Error typing
import { parseError, type AgentError } from './errors.ts';

// LLM tool types and helpers for call_llm PreToolUse intercept
import {
  withTimeout,
  LLM_QUERY_TIMEOUT_MS,
  type LLMQueryRequest,
  type LLMQueryResult,
} from './llm-tool.ts';

// GitHub OAuth types
import type { GithubTokens } from '../auth/github-oauth.ts';

// ============================================================
// Constants
// ============================================================

/**
 * Map thinking levels to Copilot reasoning effort.
 */
const THINKING_TO_EFFORT: Record<ThinkingLevel, ReasoningEffort> = {
  off: 'low',
  think: 'medium',
  max: 'high',
};

/**
 * Guardrails against indefinite Copilot hangs.
 * Uses the same 2-minute timeout as call_llm/mini-completion for consistency.
 * - send timeout: message never gets accepted by the SDK/CLI
 * - turn timeout: turn never reaches session.idle (missing terminal event)
 */
const COPILOT_SESSION_TIMEOUT_MS = LLM_QUERY_TIMEOUT_MS;
const COPILOT_SEND_TIMEOUT_MS = LLM_QUERY_TIMEOUT_MS;
const COPILOT_TURN_TIMEOUT_MS = LLM_QUERY_TIMEOUT_MS;

/**
 * Map Copilot CLI lowercase tool names to PascalCase names used by our permission system.
 * The Copilot CLI emits lowercase tool names (e.g., 'glob', 'bash') but
 * ALWAYS_ALLOWED_TOOLS and shouldAllowToolInMode expect PascalCase (e.g., 'Glob', 'Bash').
 *
 * Exported for use by CopilotEventAdapter (tool name normalization in events).
 */
export const COPILOT_TOOL_NAME_MAP: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  multi_edit: 'MultiEdit',
  glob: 'Glob',
  grep: 'Grep',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  todo_write: 'TodoWrite',
  notebook_edit: 'NotebookEdit',
  task: 'Task',
  task_output: 'TaskOutput',
  list_dir: 'Glob',
  // Native Copilot CLI tools (str_replace_editor subcommands)
  view: 'Read',
  create: 'Write',
  str_replace: 'Edit',
  insert: 'Edit',
  str_replace_editor: 'Edit',
};

// ============================================================
// CopilotAgent Implementation
// ============================================================

/**
 * Backend implementation using the @github/copilot-sdk.
 *
 * Extends BaseAgent for common functionality (permission mode, source management,
 * planning heuristics, config watching, usage tracking).
 */
export class CopilotAgent extends BaseAgent {
  protected backendName = 'Copilot';
  protected _supportsBranching = false;

  // ============================================================
  // Copilot-specific State
  // ============================================================

  // SDK client and session
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private copilotSessionId: string | null = null;

  /** Model IDs that support reasoning effort (cached from listModels) */
  private modelsWithReasoning: Set<string> = new Set();

  // State
  private _isProcessing: boolean = false;
  private abortReason?: AbortReason;

  // Event adapter
  private adapter: CopilotEventAdapter;

  // Event queue for streaming (AsyncGenerator pattern — shared with CodexAgent)
  private eventQueue = new EventQueue();

  // Pending permission requests
  private pendingPermissions: Map<string, {
    resolve: (result: PermissionRequestResult) => void;
    toolName: string;
  }> = new Map();

  // Current user message (for context in summarization)
  private currentUserMessage: string = '';

  // Pool server URL (HTTP MCP server in main process exposing all source tools)
  private poolServerUrl?: string;

  // Per-session config directory (set in postInit, used by session creation/resume)
  private copilotConfigDir: string | undefined;

  // Session event unsubscribe function
  private unsubscribeEvents: (() => void) | null = null;

  // Map toolCallId → { mcpToolName, arguments } for pending session MCP tool calls.
  //
  // WHY: Copilot SDK splits tool lifecycle across two events:
  //   tool.execution_start (has tool name + args)
  //   tool.execution_complete (has success/failure)
  //
  // We capture the tool details on start and fire the callback on completion.
  // This enables the centralized BaseAgent.handleSessionMcpToolCompletion()
  // to trigger onPlanSubmitted/onAuthRequest — which the external MCP server
  // subprocess cannot do cross-process.
  private pendingSessionToolCalls = new Map<string, {
    mcpToolName: string;
    arguments: Record<string, unknown>;
  }>();

  // Generation counter to invalidate stale event handlers.
  // The Copilot SDK's session.on() unsubscribe doesn't reliably remove listeners,
  // so old handlers accumulate. Each handler checks its generation against the
  // current value — stale handlers become no-ops.
  private handlerGeneration: number = 0;

  // HTTP callback server for call_llm — the Copilot CLI doesn't fire
  // onPreToolUse/onPostToolUse for MCP tools, so the session MCP server
  // can't get _precomputedResult injected. Instead, it calls back to this
  // localhost HTTP server to execute the LLM query with full Copilot auth.
  private _callbackServer: http.Server | null = null;
  private _callbackPort: number = 0;

  // ============================================================
  // Copilot-specific Callbacks
  // ============================================================

  /**
   * @deprecated Use onBackendAuthRequired (inherited from BaseAgent) instead.
   * Kept as a getter/setter alias for backward compatibility.
   */
  get onGithubAuthRequired(): ((reason: string) => void) | null {
    return this.onBackendAuthRequired;
  }
  set onGithubAuthRequired(cb: ((reason: string) => void) | null) {
    this.onBackendAuthRequired = cb;
  }

  // ============================================================
  // Constructor
  // ============================================================

  constructor(config: BackendConfig) {
    const resolvedModel = resolveCopilotModelId(config.model || '');
    const modelDef = getModelById(resolvedModel);
    super({ ...config, model: resolvedModel }, resolvedModel, modelDef?.contextWindow);

    this.copilotSessionId = config.session?.sdkSessionId || null;
    this.poolServerUrl = config.poolServerUrl;
    this.adapter = new CopilotEventAdapter();

    // Set session dir on adapter for concurrent-safe toolMetadataStore lookups
    if (config.session?.id && config.workspace.rootPath) {
      this.adapter.setSessionDir(join(config.workspace.rootPath, 'sessions', config.session.id));
    }

    if (!config.isHeadless) {
      this.startConfigWatcher();
    }
  }

  /**
   * Post-construction initialization.
   * 1. Create per-session config directory
   * 2. Inject stored GitHub token
   * 3. Set up initial sources (bridge config + setSourceServers)
   */
  override async postInit(): Promise<PostInitResult> {
    // Step 1: Create per-session config directory
    const sessionPath = this.getSessionStoragePath();
    if (sessionPath) {
      this.copilotConfigDir = join(sessionPath, '.copilot-config');
      await mkdir(this.copilotConfigDir, { recursive: true });
    }

    // Step 2: Auth injection
    const injected = await this.tryInjectStoredGithubToken();

    // Step 3: Initial source setup (if sources were provided)
    const initial = this.config.initialSources;
    if (initial && sessionPath) {
      const hasSources = Object.keys(initial.mcpServers).length > 0
                      || Object.keys(initial.apiServers).length > 0;
      if (hasSources) {
        if (this.copilotConfigDir) {
          await this.applyBridgeUpdates({
            sessionPath,
            enabledSources: initial.enabledSources,
            mcpServers: initial.mcpServers,
            sessionId: this.config.session?.id ?? '',
            workspaceRootPath: this.config.workspace.rootPath,
            context: 'initial setup',
            poolServerUrl: this.config.poolServerUrl,
          });
        }
        await this.setSourceServers(initial.mcpServers, initial.apiServers, initial.enabledSlugs);
      }
    }

    return {
      authInjected: injected,
      authWarning: injected ? undefined : 'No GitHub token available. Please authenticate with GitHub Copilot.',
      authWarningLevel: 'warning',
    };
  }

  /**
   * Apply bridge/config updates mid-session.
   * Writes bridge-config.json and credential cache files for API sources.
   */
  override async applyBridgeUpdates(ctx: BridgeUpdateContext): Promise<void> {
    const configDir = this.copilotConfigDir;
    if (!configDir) return;
    try {
      await writeBridgeSourceFiles(configDir, ctx.enabledSources);
      this.debug(`Copilot bridge config updated after ${ctx.context}`);
    } catch (err) {
      this.debug(`Failed to update Copilot bridge config after ${ctx.context}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================================
  // LLM Callback Server
  // ============================================================

  /**
   * Start the localhost HTTP callback server for call_llm.
   * The session MCP server POSTs to this when no _precomputedResult is available
   * (i.e., when PreToolUse hooks didn't fire — which is always for MCP tools on Copilot).
   */
  private async startCallbackServer(): Promise<void> {
    if (this._callbackServer) return;

    const server = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || (req.url !== '/call-llm' && req.url !== '/spawn-session')) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;

        if (req.url === '/call-llm') {
          this.debug(`[CallbackServer] Received call_llm request`);
          const result = await this.preExecuteCallLlm(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } else {
          this.debug(`[CallbackServer] Received spawn_session request`);
          const result = await this.preExecuteSpawnSession(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.debug(`[CallbackServer] ${req.url} failed: ${msg}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: msg }));
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        this._callbackPort = typeof addr === 'object' && addr ? addr.port : 0;
        this.debug(`[CallbackServer] Listening on 127.0.0.1:${this._callbackPort}`);
        resolve();
      });
      server.on('error', reject);
    });

    this._callbackServer = server;
  }

  private stopCallbackServer(): void {
    if (this._callbackServer) {
      this._callbackServer.close();
      this._callbackServer = null;
      this._callbackPort = 0;
    }
  }

  // ============================================================
  // Client Management
  // ============================================================

  /**
   * Lazily initialize the CopilotClient.
   */
  private async ensureClient(): Promise<CopilotClient> {
    if (this.client) return this.client;

    const githubToken = await this.getStoredGithubToken();

    // Pass token via COPILOT_GITHUB_TOKEN env var instead of githubToken option.
    // The githubToken option uses --auth-token-env which bypasses the CLI's normal
    // copilot_internal/v2/token exchange, causing 403 on model listing.
    if (githubToken) {
      process.env.COPILOT_GITHUB_TOKEN = githubToken;
    }

    // Build env for Copilot CLI subprocess
    const clientEnv: Record<string, string | undefined> = { ...process.env };

    // Preload network interceptor for tool metadata capture
    const runtime = getBackendRuntime(this.config);
    const interceptorPath = runtime.paths?.interceptor;
    if (interceptorPath) {
      const existing = clientEnv.NODE_OPTIONS || '';
      clientEnv.NODE_OPTIONS = `${existing} --require ${interceptorPath}`.trim();
    }

    // Session dir for cross-process toolMetadataStore
    // Compute from session config (not process.env which is never set in the main process)
    if (this.config.session?.id && this.config.workspace.rootPath) {
      clientEnv.CRAFT_SESSION_DIR = join(this.config.workspace.rootPath, 'sessions', this.config.session.id);
    }

    // Propagate debug mode
    clientEnv.CRAFT_DEBUG = (process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1') ? '1' : '0';

    const copilotCliPath = runtime.paths?.copilotCli;

    this.client = new CopilotClient({
      useStdio: true,
      cwd: this.resolvedCwd(),
      autoStart: true,
      autoRestart: true,
      logLevel: this.config.debugMode?.enabled ? 'debug' : 'error',
      // Disable the CLI's native sandboxing — our onPreToolUse hook handles all permission logic.
      // --allow-all = --allow-all-tools --allow-all-paths --allow-all-urls
      cliArgs: ['--allow-all'],
      env: clientEnv,
      ...(copilotCliPath ? { cliPath: copilotCliPath } : {}),
    });

    await withTimeout(
      this.client.start(),
      COPILOT_SESSION_TIMEOUT_MS,
      `Copilot client start timed out after ${Math.floor(COPILOT_SESSION_TIMEOUT_MS / 1000)}s`
    );
    this.debug('Copilot client started');

    // Cache which models support reasoning effort
    try {
      const models = await withTimeout(
        this.client.listModels(),
        COPILOT_SESSION_TIMEOUT_MS,
        `Copilot listModels timed out after ${Math.floor(COPILOT_SESSION_TIMEOUT_MS / 1000)}s`
      );
      this.modelsWithReasoning = new Set(
        models
          .filter(m => m.supportedReasoningEfforts && m.supportedReasoningEfforts.length > 0)
          .map(m => m.id)
      );
      this.debug(`Models with reasoning support: ${[...this.modelsWithReasoning].join(', ') || 'none'}`);
    } catch {
      this.debug('Failed to fetch model capabilities — reasoning effort will be omitted');
    }

    return this.client;
  }

  /**
   * Resume is only safe when Copilot persisted the session event log.
   * Missing/empty events.jsonl indicates an incomplete prior startup that can hang on resume.
   */
  private async hasResumableSessionState(sessionId: string): Promise<boolean> {
    if (!this.copilotConfigDir) return false;
    const eventsPath = join(this.copilotConfigDir, 'session-state', sessionId, 'events.jsonl');
    try {
      const file = await stat(eventsPath);
      return file.isFile() && file.size > 0;
    } catch {
      return false;
    }
  }

  // ============================================================
  // Chat (AsyncGenerator with event queue — mirrors CodexAgent)
  // ============================================================

  async *chat(
    messageParam: string,
    attachments?: FileAttachment[],
    options?: ChatOptions
  ): AsyncGenerator<AgentEvent> {
    let message = messageParam;
    // Reset state for new turn
    this._isProcessing = true;
    this.abortReason = undefined;
    this.eventQueue.reset();
    this.currentUserMessage = message;
    this.adapter.startTurn();

    // Fire UserPromptSubmit hook event (fire-and-forget)
    this.emitHookEvent('UserPromptSubmit', {
      hook_event_name: 'UserPromptSubmit',
      prompt: message,
    });

    // Register session-scoped tool callbacks (for SubmitPlan, source auth, etc.)
    const sessionId = this.config.session?.id;
    if (sessionId) {
      registerSessionScopedToolCallbacks(sessionId, {
        onPlanSubmitted: (planPath) => this.onPlanSubmitted?.(planPath),
        onAuthRequest: (request) => this.onAuthRequest?.(request),
        queryFn: (request) => this.queryLlm(request),
      });
    }

    try {
      // Start callback server for call_llm (Copilot CLI doesn't fire PreToolUse for MCP tools)
      await this.startCallbackServer();

      // Ensure client is connected
      const client = await this.ensureClient();

      // Build system prompt (positional args match getSystemPrompt signature)
      const systemPrompt = getSystemPrompt(
        undefined, // pinnedPreferencesPrompt — formatted fresh
        this.config.debugMode,
        this.config.workspace.rootPath,
        this.config.session?.workingDirectory,
        this.config.systemPromptPreset,
        'GitHub Copilot' // backendName
      );

      // Build MCP config for session
      const mcpServers = this.buildMcpConfig();

      // Build context from sources
      const sourceContext = this.sourceManager.formatSourceState();

      // Determine reasoning effort (only for models that support it)
      const thinkingLevel = options?.thinkingOverride || this._thinkingLevel;
      const reasoningEffort = this.modelsWithReasoning.has(this._model)
        ? THINKING_TO_EFFORT[thinkingLevel]
        : undefined;

      // If the persisted Copilot state is incomplete, skip resume to avoid hang.
      if (this.copilotSessionId && !options?.isRetry) {
        const resumable = await this.hasResumableSessionState(this.copilotSessionId);
        if (!resumable) {
          this.debug(`Skipping resume for ${this.copilotSessionId}: missing/empty events.jsonl`);
          this.copilotSessionId = null;
          this.clearSessionForRecovery();

          const recoveryContext = this.buildRecoveryContext();
          if (recoveryContext) {
            message = recoveryContext + message;
            this.debug('Injected recovery context into message');
          }
        }
      }

      // Create or resume session
      if (this.copilotSessionId && !options?.isRetry) {
        // Resume existing session
        try {
          const resumeConfig: CopilotResumeConfig = {
            model: this._model,
            reasoningEffort,
            mcpServers,
            systemMessage: systemPrompt ? { mode: 'append', content: systemPrompt } : undefined,
            onPermissionRequest: (request, invocation) => this.handlePermissionRequest(request, invocation.sessionId),
            hooks: this.buildHooks(),
            workingDirectory: this.resolvedCwd(),
            configDir: this.copilotConfigDir,
            streaming: true,
          };
          this.session = await withTimeout(
            client.resumeSession(this.copilotSessionId, resumeConfig),
            COPILOT_SESSION_TIMEOUT_MS,
            `Copilot session resume timed out after ${Math.floor(COPILOT_SESSION_TIMEOUT_MS / 1000)}s`
          );
          this.debug(`Resumed Copilot session: ${this.copilotSessionId}`);
        } catch (resumeError) {
          this.debug(`Failed to resume session ${this.copilotSessionId}, creating new`);
          this.copilotSessionId = null;
          this.clearSessionForRecovery();

          const recoveryContext = this.buildRecoveryContext();
          if (recoveryContext) {
            message = recoveryContext + message;
            this.debug('Injected recovery context into message');
          }
          // Fall through to create new session
        }
      }

      if (!this.session) {
        // Create new session
        const sessionConfig: CopilotSessionConfig = {
          model: this._model,
          reasoningEffort,
          mcpServers,
          systemMessage: systemPrompt ? { mode: 'append', content: systemPrompt } : undefined,
          onPermissionRequest: (request, invocation) => this.handlePermissionRequest(request, invocation.sessionId),
          hooks: this.buildHooks(),
          workingDirectory: this.resolvedCwd(),
          configDir: this.copilotConfigDir,
          streaming: true,
        };
        this.session = await withTimeout(
          client.createSession(sessionConfig),
          COPILOT_SESSION_TIMEOUT_MS,
          `Copilot session creation timed out after ${Math.floor(COPILOT_SESSION_TIMEOUT_MS / 1000)}s`
        );
        this.copilotSessionId = this.session.sessionId;
        this.config.onSdkSessionIdUpdate?.(this.session.sessionId);
        this.debug(`Created new Copilot session: ${this.session.sessionId}`);
      }

      // Wire up event handler.
      // Bump generation so any lingering old handlers become no-ops.
      // (The SDK's unsubscribe doesn't reliably remove listeners on resume.)
      this.handlerGeneration++;
      const expectedGen = this.handlerGeneration;
      if (this.unsubscribeEvents) {
        this.unsubscribeEvents();
      }
      this.unsubscribeEvents = this.session.on((event: SessionEvent) => {
        if (this.handlerGeneration !== expectedGen) return;
        this.handleSessionEvent(event);
      });

      // Process attachments
      const attachmentParts: string[] = [];
      for (const att of attachments || []) {
        if (att.mimeType?.startsWith('image/') && (att.storedPath || att.path)) {
          attachmentParts.push(`[Attached image: ${att.name}]\n[Stored at: ${att.storedPath || att.path}]`);
        } else if (att.mimeType === 'application/pdf' && att.storedPath) {
          attachmentParts.push(`[Attached PDF: ${att.name}]\n[Stored at: ${att.storedPath}]`);
        } else if (att.storedPath) {
          let pathInfo = `[Attached file: ${att.name}]\n[Stored at: ${att.storedPath}]`;
          if (att.markdownPath) {
            pathInfo += `\n[Markdown version: ${att.markdownPath}]`;
          }
          attachmentParts.push(pathInfo);
        }
      }

      // ============================================================
      // SKILL MENTION EXTRACTION (shared with CodexAgent)
      // ============================================================
      const { skillContents, cleanMessage: effectiveMessage } = this.extractSkillContent(message);

      // Build context parts using centralized PromptBuilder
      // This includes: date/time, session state (with plansFolderPath),
      // workspace capabilities, and working directory context
      const contextParts = this.promptBuilder.buildContextParts(
        { plansFolderPath: getSessionPlansPath(this.config.workspace.rootPath, this._sessionId) },
        sourceContext
      );

      // Combine: skills + context + attachments + user message
      const messageParts = [
        ...skillContents,
        ...contextParts,
        ...attachmentParts,
        effectiveMessage,
      ].filter(Boolean);
      const fullMessage = messageParts.join('\n\n');

      // Send message (bounded) so we fail fast instead of hanging indefinitely
      await withTimeout(
        this.session.send({ prompt: fullMessage }),
        COPILOT_SEND_TIMEOUT_MS,
        `Copilot send timed out after ${Math.floor(COPILOT_SEND_TIMEOUT_MS / 1000)}s`
      );

      // If Copilot never reaches session.idle, force-complete with a typed timeout error.
      const turnTimeout = setTimeout(() => {
        if (this.eventQueue.isComplete) return;
        this.debug(`Turn timed out after ${Math.floor(COPILOT_TURN_TIMEOUT_MS / 1000)}s without completion`);
        this.eventQueue.enqueue({
          type: 'typed_error',
          error: {
            code: 'network_error',
            title: 'Copilot Response Timeout',
            message: 'Copilot did not complete this request in time. The turn may be stuck; retry the prompt.',
            actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
            canRetry: true,
            retryDelayMs: 1000,
          },
        });
        this.eventQueue.complete();
        this.session?.abort().catch(() => {});
      }, COPILOT_TURN_TIMEOUT_MS);

      try {
        // Yield events from queue until turn completes
        yield* this.eventQueue.drain();
      } finally {
        clearTimeout(turnTimeout);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('abort')) {
        if (this.abortReason === AbortReason.PlanSubmitted) {
          return;
        }
        if (this.abortReason === AbortReason.AuthRequest) {
          return;
        }
        return;
      }

      const errorObj = error instanceof Error ? error : new Error(String(error));
      const typedError = this.parseCopilotError(errorObj);

      // Trigger auth callback for auth errors
      if (typedError.code === 'invalid_credentials') {
        this.onBackendAuthRequired?.(`Authentication failed: ${errorObj.message}`);
      }

      if (typedError.code !== 'unknown_error') {
        yield { type: 'typed_error', error: typedError };
      } else {
        yield { type: 'error', message: errorObj.message };
      }

      yield { type: 'complete' };
    } finally {
      this._isProcessing = false;
    }
  }

  // ============================================================
  // Event Handling
  // ============================================================

  /**
   * Handle a Copilot SDK session event.
   */
  private handleSessionEvent(event: SessionEvent): void {
    const isSessionError = event.type === 'session.error';

    // Track usage from assistant.usage events
    if (event.type === 'assistant.usage') {
      const data = event.data as Record<string, unknown>;
      this.usageTracker.recordMessageUsage({
        inputTokens: (data.inputTokens as number) || 0,
        outputTokens: (data.outputTokens as number) || 0,
        cacheReadTokens: (data.cacheReadTokens as number) || 0,
        cacheCreationTokens: (data.cacheWriteTokens as number) || 0,
      });
    }

    // Track context window from session.usage_info events
    if (event.type === 'session.usage_info') {
      const data = event.data as Record<string, unknown>;
      if (typeof data.tokenLimit === 'number') {
        this.usageTracker.setContextWindow(data.tokenLimit);
      }
    }

    // Capture shutdown metrics for final usage report
    if (event.type === 'session.shutdown') {
      const data = event.data as {
        modelMetrics?: Record<string, {
          usage: {
            inputTokens: number;
            outputTokens: number;
            cacheReadTokens: number;
            cacheWriteTokens: number;
          };
          requests: { count: number; cost: number };
        }>;
      };
      if (data.modelMetrics) {
        // Aggregate metrics across all models used in the session
        let totalInput = 0;
        let totalOutput = 0;
        let totalCost = 0;
        for (const model of Object.values(data.modelMetrics)) {
          totalInput += model.usage.inputTokens + model.usage.cacheReadTokens;
          totalOutput += model.usage.outputTokens;
          totalCost += model.requests.cost;
        }
        // Emit a final usage_update with aggregated session metrics
        this.eventQueue.enqueue({
          type: 'usage_update',
          usage: {
            inputTokens: totalInput,
          },
        });
      }
    }

    // Trigger auth callback for authentication errors
    if (event.type === 'session.error') {
      const data = event.data as { errorType: string; statusCode?: number; message: string };
      if (
        data.statusCode === 401 || data.statusCode === 403 ||
        data.errorType === 'authentication' || data.errorType === 'authorization'
      ) {
        this.onBackendAuthRequired?.(`Authentication failed: ${data.message}`);
      }
    }

    // ============================================================
    // Detect session MCP tool completions (SubmitPlan, auth tools)
    // ============================================================
    // WHY: Session-scoped tools run in an external MCP server subprocess
    // (packages/session-mcp-server) which can't trigger callbacks cross-process.
    // We detect their completion from Copilot SDK session events and call the
    // centralized BaseAgent.handleSessionMcpToolCompletion() to fire callbacks.
    // Same pattern as CodexAgent (codex-agent.ts ~line 425).

    // Step 1: Capture session MCP tool starts (stores tool name + args by toolCallId)
    if (event.type === 'tool.execution_start') {
      const data = event.data as {
        toolCallId: string;
        mcpServerName?: string;
        mcpToolName?: string;
        arguments?: Record<string, unknown>;
      };
      if (data.mcpServerName === 'session' && data.mcpToolName) {
        this.pendingSessionToolCalls.set(data.toolCallId, {
          mcpToolName: data.mcpToolName,
          arguments: (data.arguments ?? {}) as Record<string, unknown>,
        });
      }
    }

    // Step 2: On successful completion, fire the appropriate callback
    // (e.g., onPlanSubmitted for SubmitPlan, onAuthRequest for auth tools)
    if (event.type === 'tool.execution_complete') {
      const data = event.data as { toolCallId: string; success: boolean };
      const pending = this.pendingSessionToolCalls.get(data.toolCallId);
      if (pending) {
        this.pendingSessionToolCalls.delete(data.toolCallId);
        if (data.success) {
          this.handleSessionMcpToolCompletion(pending.mcpToolName, pending.arguments);
        }
      }
    }

    // Adapt event to AgentEvents
    for (const agentEvent of this.adapter.adaptEvent(event)) {
      // Track Read tool calls (including bash/PS commands classified as reads by adapter)
      if (agentEvent.type === 'tool_start' && agentEvent.toolName === 'Read') {
        this.prerequisiteManager.trackReadTool(agentEvent.input as Record<string, unknown>);
      }
      // Reset prerequisite state on compaction (LLM loses guide content)
      if (agentEvent.type === 'info' && typeof agentEvent.message === 'string' && agentEvent.message.startsWith('Compacted')) {
        this.resetPrerequisiteState();
      }
      this.eventQueue.enqueue(agentEvent);
    }

    // session.error can be terminal without a follow-up session.idle.
    // Force completion so the UI doesn't stay in a perpetual "processing" state.
    if (isSessionError) {
      this.eventQueue.complete();
    }

    // Check for session idle (turn complete)
    if (event.type === 'session.idle') {
      this.eventQueue.complete();
    }
  }

  // Event queue methods now provided by EventQueue class

  // ============================================================
  // Hooks
  // ============================================================

  /**
   * Build the session hooks configuration.
   */
  private buildHooks() {
    return {
      onPreToolUse: async (input: PreToolUseHookInput, _invocation: { sessionId: string }): Promise<PreToolUseHookOutput | void> => {
        return this.onPreToolUse(input);
      },
      onPostToolUse: async (input: PostToolUseHookInput, _invocation: { sessionId: string }): Promise<PostToolUseHookOutput | void> => {
        return this.onPostToolUse(input);
      },
    };
  }

  /**
   * Pre-tool-use hook — centralized permission handling.
   * Uses runPreToolUseChecks() pipeline shared by all agents.
   * Fixes ask-mode bug: previously relied on check.requiresPermission which was never true.
   */
  private async onPreToolUse(input: PreToolUseHookInput): Promise<PreToolUseHookOutput | void> {
    const { toolName, toolArgs, toolCallId } = input;

    // Parse toolArgs defensively — may arrive as JSON string or parsed object.
    // See parseCopilotToolArgs() for full explanation of why this is needed.
    let inputObj = this.parseCopilotToolArgs(toolArgs);
    const permissionMode = this.getPermissionMode();

    this.debug(`PreToolUse: ${toolName}, toolArgs type: ${typeof toolArgs}, keys: [${Object.keys(inputObj).join(', ')}]`);

    // Map Copilot tool names to SDK tool names (lowercase → PascalCase)
    const sdkToolName = this.mapCopilotToolName(toolName, inputObj);

    // Fire PreToolUse hook event (hooks.json) — await so hooks run before tool executes
    await this.emitHookEvent('PreToolUse', {
      hook_event_name: 'PreToolUse',
      tool_name: sdkToolName,
      tool_input: inputObj,
    });

    // Normalize Copilot-native arg names: `path` → `file_path`
    // Copilot CLI's native tools use `path` but our permission system expects `file_path`.
    if ((sdkToolName === 'Write' || sdkToolName === 'Edit' || sdkToolName === 'Read')
        && inputObj.path && !inputObj.file_path) {
      inputObj = { ...inputObj, file_path: inputObj.path };
    }

    // Track Read tool calls for prerequisite checking
    if (sdkToolName === 'Read') {
      this.prerequisiteManager.trackReadTool(inputObj);
    }

    // Extract tool metadata before pipeline strips _intent/_displayName
    const intent = input.metadata?.intent
      || (typeof inputObj._intent === 'string' ? inputObj._intent : undefined);
    const displayName = input.metadata?.displayName
      || (typeof inputObj._displayName === 'string' ? inputObj._displayName : undefined);
    if (toolCallId && (intent || displayName)) {
      toolMetadataStore.set(toolCallId, { intent, displayName, timestamp: Date.now() });
      this.debug(`PreToolUse: Captured metadata for ${toolCallId} — intent="${intent}", displayName="${displayName}"`);
    }

    // Run centralized pipeline
    const checkResult = runPreToolUseChecks({
      toolName: sdkToolName,
      input: inputObj,
      permissionMode,
      workspaceRootPath: this.workingDirectory,
      workspaceId: this.config.workspace.id,
      plansFolderPath: getSessionPlansPath(this.config.workspace.rootPath, this._sessionId),
      workingDirectory: this.config.session?.workingDirectory,
      activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
      allSourceSlugs: this.sourceManager.getAllSources().map(s => s.config.slug),
      hasSourceActivation: !!this.onSourceActivationRequest,
      permissionManager: this.permissionManager,
      prerequisiteManager: this.prerequisiteManager,
      onDebug: (msg) => this.debug(msg),
    });

    // Translate result to Copilot SDK format
    switch (checkResult.type) {
      case 'allow':
        return { permissionDecision: 'allow' };

      case 'modify':
        return { permissionDecision: 'allow', modifiedArgs: checkResult.input };

      case 'block': {
        // Prerequisite blocks: return 'allow' but set a one-time block on the pool.
        // The Copilot SDK permanently removes tools from its registry on 'deny',
        // which means the model can never retry the tool after reading guide.md.
        // Instead, we let the tool call through to the pool which returns the
        // error message and auto-clears — keeping the tool available for retry.
        if (checkResult.source === 'prerequisite' && this.config.mcpPool) {
          this.config.mcpPool.setOneTimeBlock(sdkToolName, checkResult.reason);
          return { permissionDecision: 'allow' };
        }
        this.adapter.setBlockReason(sdkToolName, checkResult.reason);
        return {
          permissionDecision: 'deny',
          permissionDecisionReason: checkResult.reason,
        };
      }

      case 'source_activation_needed': {
        const { sourceSlug, sourceExists } = checkResult;
        this.debug(`PreToolUse: Source "${sourceSlug}" not active (exists=${sourceExists}), attempting activation...`);

        if (this.onSourceActivationRequest) {
          try {
            const activated = await this.onSourceActivationRequest(sourceSlug);
            if (!activated) {
              const reason = sourceExists
                ? `Source "${sourceSlug}" is not active. Activate it by @mentioning it in your message or via the source icon at the bottom of the input field.`
                : `Source "${sourceSlug}" is not available yet. It needs to be created and configured first.`;
              this.adapter.setBlockReason(sdkToolName, reason);
              return { permissionDecision: 'deny', permissionDecisionReason: reason };
            }
            this.debug(`PreToolUse: Source "${sourceSlug}" activated successfully`);
            this.eventQueue.enqueue({
              type: 'source_activated' as const,
              sourceSlug,
              originalMessage: this.currentUserMessage,
            });
          } catch (err) {
            const reason = sourceExists
              ? `Source "${sourceSlug}" could not be activated: ${err}. Try activating it by @mentioning it in your message or via the source icon at the bottom of the input field.`
              : `Source "${sourceSlug}" is not available yet. It needs to be created and configured first.`;
            this.adapter.setBlockReason(sdkToolName, reason);
            return { permissionDecision: 'deny', permissionDecisionReason: reason };
          }
        }

        // Re-run pipeline after activation to apply remaining transforms
        const postResult = runPreToolUseChecks({
          toolName: sdkToolName,
          input: inputObj,
          permissionMode,
          workspaceRootPath: this.workingDirectory,
          workspaceId: this.config.workspace.id,
          plansFolderPath: getSessionPlansPath(this.config.workspace.rootPath, this._sessionId),
          workingDirectory: this.config.session?.workingDirectory,
          activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
          allSourceSlugs: this.sourceManager.getAllSources().map(s => s.config.slug),
          hasSourceActivation: !!this.onSourceActivationRequest,
          permissionManager: this.permissionManager,
          prerequisiteManager: this.prerequisiteManager,
          onDebug: (msg) => this.debug(msg),
        });

        if (postResult.type === 'modify') {
          return { permissionDecision: 'allow', modifiedArgs: postResult.input };
        } else if (postResult.type === 'block') {
          this.adapter.setBlockReason(sdkToolName, postResult.reason);
          return { permissionDecision: 'deny', permissionDecisionReason: postResult.reason };
        }
        return { permissionDecision: 'allow' };
      }

      case 'call_llm_intercept': {
        this.debug('PreToolUse: Intercepting call_llm for pre-execution');
        try {
          const result = await this.preExecuteCallLlm(inputObj);
          return {
            permissionDecision: 'allow',
            modifiedArgs: { ...inputObj, model: result.model ?? inputObj.model, _precomputedResult: JSON.stringify(result) },
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.debug(`PreToolUse: call_llm pre-execution failed: ${errorMsg}`);
          return {
            permissionDecision: 'allow',
            modifiedArgs: { ...inputObj, _precomputedResult: JSON.stringify({ error: errorMsg }) },
          };
        }
      }

      case 'spawn_session_intercept': {
        this.debug('PreToolUse: Intercepting spawn_session for pre-execution');
        try {
          const result = await this.preExecuteSpawnSession(inputObj);
          return {
            permissionDecision: 'allow',
            modifiedArgs: { ...inputObj, _precomputedResult: JSON.stringify(result) },
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.debug(`PreToolUse: spawn_session pre-execution failed: ${errorMsg}`);
          return {
            permissionDecision: 'allow',
            modifiedArgs: { ...inputObj, _precomputedResult: JSON.stringify({ error: errorMsg }) },
          };
        }
      }

      case 'prompt': {
        if (!this.onPermissionRequest) {
          return {
            permissionDecision: 'allow',
            modifiedArgs: checkResult.modifiedInput,
          };
        }

        const requestId = `copilot-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        this.onPermissionRequest({
          requestId,
          toolName: sdkToolName,
          command: checkResult.command,
          description: checkResult.description,
          type: checkResult.promptType,
        });

        const userResult = await new Promise<PermissionRequestResult>((resolve) => {
          this.pendingPermissions.set(requestId, {
            resolve,
            toolName: sdkToolName,
          });
        });

        if (userResult.kind !== 'approved') {
          return {
            permissionDecision: 'deny',
            permissionDecisionReason: 'Denied by user',
          };
        }

        return {
          permissionDecision: 'allow',
          modifiedArgs: checkResult.modifiedInput,
        };
      }
    }
  }

  /**
   * Post-tool-use hook — large result save + summarization.
   * Saves full result to long_responses/ and replaces with summary + file reference.
   */
  private async onPostToolUse(input: PostToolUseHookInput): Promise<PostToolUseHookOutput | void> {
    const { toolName, toolArgs, toolResult } = input;
    const resultText = toolResult.textResultForLlm || '';

    // Fire PostToolUse / PostToolUseFailure hook event (fire-and-forget)
    // ToolResultObject has resultType: "success" | "failure" | "rejected" | "denied"
    const isError = toolResult.resultType !== 'success';
    const hookEvent = isError ? 'PostToolUseFailure' : 'PostToolUse';
    const hookInput = this.parseCopilotToolArgs(toolArgs);
    this.emitHookEvent(hookEvent, {
      hook_event_name: hookEvent,
      tool_name: toolName,
      tool_input: hookInput,
      ...(isError
        ? { error: toolResult.error || resultText }
        : { tool_response: resultText }),
    });

    // Check if result is large enough to handle
    if (estimateTokens(resultText) <= TOKEN_LIMIT) return;

    try {
      const inputObj = this.parseCopilotToolArgs(toolArgs);
      const sessionPath = getSessionPath(this.config.workspace.rootPath, this._sessionId);

      const result = await handleLargeResponse({
        text: resultText,
        sessionPath,
        context: {
          toolName,
          input: inputObj,
          intent: typeof inputObj._intent === 'string' ? inputObj._intent : undefined,
          userRequest: this.currentUserMessage,
        },
        summarize: this.runMiniCompletion.bind(this),
      });

      if (result) {
        return {
          modifiedResult: {
            ...toolResult,
            textResultForLlm: result.message,
          },
        };
      }
    } catch (error) {
      this.debug(`Large response handling failed: ${error instanceof Error ? error.message : String(error)}`);
      // Fall through to return original result
    }
  }

  // ============================================================
  // Permission Handling
  // ============================================================

  /**
   * Handle SDK permission requests.
   *
   * Auto-approve all SDK-level permission requests because our onPreToolUse hook
   * already handles permission logic (mode-based blocking, user prompts).
   * Without this, tools would be double-prompted: once by our hook, once by the SDK.
   */
  private async handlePermissionRequest(
    _request: CopilotPermissionRequest,
    _sessionId: string
  ): Promise<PermissionRequestResult> {
    return { kind: 'approved' };
  }

  /**
   * Respond to a pending permission request.
   */
  respondToPermission(requestId: string, allowed: boolean, _alwaysAllow?: boolean): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      this.debug(`Permission request not found: ${requestId}`);
      return;
    }

    this.pendingPermissions.delete(requestId);
    pending.resolve({
      kind: allowed ? 'approved' : 'denied-interactively-by-user',
    });
  }

  // ============================================================
  // Source / MCP Integration
  // ============================================================

  override async setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, unknown>,
    intendedSlugs?: string[]
  ): Promise<void> {
    // BaseAgent handles SourceManager state + McpClientPool sync
    // Pool server auto-serves updated tools (reads from pool at request time)
    await super.setSourceServers(mcpServers, apiServers, intendedSlugs);
    // Copilot passes MCP config at session creation — destroy active session
    // so next chat() recreates with updated config
    if (this.session) {
      this.reconnect().catch(err => this.debug(`Reconnect after source change failed: ${err}`));
    }
  }

  /**
   * Build MCP server config for Copilot session creation.
   * Maps our SdkMcpServerConfig format to Copilot's MCPServerConfig format.
   */
  private buildMcpConfig(): Record<string, CopilotMCPServerConfig> {
    const config: Record<string, CopilotMCPServerConfig> = {};

    // MCP sources: served through centralized pool server (single HTTP endpoint)
    // The McpPoolServer in the main process manages all source connections.
    if (this.poolServerUrl) {
      config['sources'] = {
        type: 'http',
        url: this.poolServerUrl,
        tools: ['*'],
      };
    }

    // Add session-scoped MCP server (provides SubmitPlan, config_validate, source_test, etc.)
    const runtime = getBackendRuntime(this.config);
    const sessionServerPath = runtime.paths?.sessionServer;
    if (sessionServerPath) {
      const sessionId = this.config.session?.id;
      const workspaceRootPath = this.config.workspace.rootPath;
      if (sessionId && workspaceRootPath) {
        const nodePath = runtime.paths?.node || 'bun';
        const plansFolderPath = join(workspaceRootPath, 'sessions', sessionId, 'plans');
        const sessionArgs = [
          sessionServerPath,
          '--session-id', sessionId,
          '--workspace-root', workspaceRootPath,
          '--plans-folder', plansFolderPath,
        ];
        // Pass callback port as CLI arg (more reliable than env — the Copilot CLI
        // spawns MCP servers and may not forward the env field to subprocesses).
        if (this._callbackPort) {
          sessionArgs.push('--callback-port', String(this._callbackPort));
        }
        config['session'] = {
          type: 'local',
          command: nodePath,
          args: sessionArgs,
          // Also pass via env as secondary path (in case CLI does forward it)
          env: this._callbackPort ? { CRAFT_LLM_CALLBACK_PORT: String(this._callbackPort) } : undefined,
          tools: ['*'],
        };
      }
    }

    return config;
  }

  // ============================================================
  // Auth
  // ============================================================

  /**
   * Get stored GitHub token from credential manager.
   */
  private async getStoredGithubToken(): Promise<string | null> {
    try {
      const credentialManager = getCredentialManager();
      const slug = this.config.connectionSlug || 'copilot';
      const oauth = await credentialManager.getLlmOAuth(slug);
      return oauth?.accessToken || null;
    } catch {
      return null;
    }
  }

  /**
   * Try to inject stored GitHub tokens.
   * Returns true if tokens were successfully loaded.
   * Device flow tokens don't expire, so no refresh logic is needed.
   */
  async tryInjectStoredGithubToken(): Promise<boolean> {
    try {
      const credentialManager = getCredentialManager();
      const slug = this.config.connectionSlug || 'copilot';
      const storedCreds = await credentialManager.getLlmOAuth(slug);

      if (!storedCreds?.accessToken) {
        this.debug('No stored GitHub credentials found');
        return false;
      }

      this.debug('GitHub token loaded from credential store');
      return true;
    } catch (error) {
      this.debug(`Failed to inject stored GitHub tokens: ${error}`);
      return false;
    }
  }

  /**
   * Inject a new GitHub token (after OAuth flow).
   */
  async injectGithubToken(token: string): Promise<void> {
    // If client exists, we need to restart it with the new token
    if (this.client) {
      await this.client.stop();
      this.client = null;
    }
    this.debug('GitHub token injected, client will reconnect on next use');
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  isProcessing(): boolean {
    return this._isProcessing;
  }

  async abort(reason?: string): Promise<void> {
    // Fire Stop hook event (fire-and-forget)
    this.emitHookEvent('Stop', { hook_event_name: 'Stop' });

    if (this.session) {
      try {
        await this.session.abort();
      } catch (error) {
        this.debug(`Abort failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.eventQueue.complete();
  }

  forceAbort(reason: AbortReason): void {
    // Fire Stop hook event (fire-and-forget)
    this.emitHookEvent('Stop', { hook_event_name: 'Stop' });

    this.abortReason = reason;
    this._isProcessing = false;

    // Reject all pending permissions
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({
        kind: 'denied-interactively-by-user',
      });
    }
    this.pendingPermissions.clear();

    // Signal turn complete to wake up any waiting consumers
    this.eventQueue.complete();

    // For PlanSubmitted and AuthRequest, just interrupt the turn - don't abort session
    // The user will respond (approve plan, complete auth) and we need to continue in the same session
    if (reason === AbortReason.PlanSubmitted || reason === AbortReason.AuthRequest) {
      return;
    }

    // For other reasons, abort session
    if (this.session) {
      this.session.abort().catch(() => {});
    }
  }

  // ============================================================
  // Session ID overrides (match CodexAgent pattern)
  // ============================================================

  override getSessionId(): string | null {
    return this.copilotSessionId;
  }

  override setSessionId(sessionId: string | null): void {
    this.copilotSessionId = sessionId;
  }

  override setWorkspace(workspace: Workspace): void {
    super.setWorkspace(workspace);
    this.copilotSessionId = null;
    if (this.session) {
      this.session.destroy().catch(() => {});
      this.session = null;
    }
  }

  override clearHistory(): void {
    this.copilotSessionId = null;
    if (this.session) {
      this.session.destroy().catch(() => {});
      this.session = null;
    }
    super.clearHistory();
    this.debug('History cleared - next chat will start new session');
  }

  destroy(): void {
    this.stopConfigWatcher();

    // Unregister session-scoped tool callbacks
    if (this.config.session?.id) {
      unregisterSessionScopedToolCallbacks(this.config.session.id);
    }

    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }

    if (this.session) {
      this.session.destroy().catch(() => {});
      this.session = null;
    }

    if (this.client) {
      this.client.stop().catch(() => {});
      this.client = null;
    }

    this.stopCallbackServer();
    this.debug('CopilotAgent destroyed');
  }

  /**
   * Reconnect session with updated config (e.g., MCP servers changed).
   */
  async reconnect(): Promise<void> {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }

    if (this.session) {
      await this.session.destroy();
      this.session = null;
    }

    this.debug('CopilotAgent reconnected (session will be recreated on next chat)');
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Resolve working directory to an absolute path.
   * BaseAgent stores paths with tilde (~) but the Copilot SDK / Node.js spawn
   * don't expand tilde, causing the CLI to fall back to configDir as cwd.
   */
  private resolvedCwd(): string {
    const wd = this.workingDirectory;
    if (wd.startsWith('~/')) return join(homedir(), wd.slice(2));
    if (wd === '~') return homedir();
    return wd;
  }

  /**
   * Parse Copilot SDK tool arguments into a usable object.
   *
   * WHY THIS EXISTS:
   * ----------------
   * The Copilot SDK types `toolArgs` as `unknown` (see PreToolUseHookInput in
   * @github/copilot-sdk/dist/types.d.ts). In practice, the Copilot CLI may
   * send tool arguments in one of two formats:
   *
   *   1. PARSED OBJECT — e.g. { command: "ls -la ..." }
   *      This happens when the JSON-RPC layer has already deserialized the args.
   *
   *   2. JSON STRING — e.g. '{"command":"ls -la ..."}'
   *      This follows the OpenAI function calling convention where the model's
   *      tool call arguments are transmitted as a serialized JSON string.
   *      When this happens, a naive type cast like `(toolArgs as Record<string, unknown>)`
   *      gives you a string object — accessing `.command` or `.path` on it
   *      returns `undefined`, causing permission checks to fail with misleading
   *      errors like "Bash command is missing or invalid".
   *
   * WHAT THIS DOES:
   * ---------------
   * - If toolArgs is a string → JSON.parse it into an object
   * - If toolArgs is already an object → use it directly
   * - If toolArgs is undefined/null/unparseable → fall back to {}
   *
   * DOWNSTREAM EFFECTS:
   * -------------------
   * The returned object flows into:
   * - shouldAllowToolInMode() which reads `.command` for Bash, `.file_path` for Write/Edit/Read
   * - path→file_path normalization (Copilot uses `path`, our permission system expects `file_path`)
   * - expandToolPaths() for ~ expansion
   * - summarizeLargeResult() in onPostToolUse for intent extraction
   */
  private parseCopilotToolArgs(toolArgs: unknown): Record<string, unknown> {
    // Case 1: JSON string — parse it into an object
    if (typeof toolArgs === 'string') {
      try {
        const parsed = JSON.parse(toolArgs);
        // Ensure parsed result is actually an object (not a primitive like "hello")
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
        return {};
      } catch {
        // Unparseable string (shouldn't happen in practice, but be safe)
        return {};
      }
    }
    // Case 2: Already a parsed object — use directly
    if (toolArgs && typeof toolArgs === 'object' && !Array.isArray(toolArgs)) {
      return toolArgs as Record<string, unknown>;
    }
    // Case 3: undefined, null, array, or other unexpected type — empty object
    return {};
  }

  /**
   * Map Copilot tool names to SDK tool names for permission checking.
   * Copilot CLI uses lowercase tool names but our permission system expects PascalCase.
   */
  private mapCopilotToolName(toolName: string, _input: Record<string, unknown>): string {
    return COPILOT_TOOL_NAME_MAP[toolName] || toolName;
  }

  /**
   * Map permission request kind to tool name.
   */
  private mapPermissionKindToToolName(kind: string): string {
    switch (kind) {
      case 'shell': return 'Bash';
      case 'write': return 'Write';
      case 'read': return 'Read';
      case 'url': return 'WebFetch';
      case 'mcp': return 'mcp_tool';
      default: return kind;
    }
  }

  // ============================================================
  // Error Parsing
  // ============================================================

  /**
   * Parse a Copilot error into a typed AgentError.
   */
  private parseCopilotError(error: Error): AgentError {
    const errorMessage = error.message.toLowerCase();

    // Model listing / access errors (403 from model API, not auth failure)
    if (errorMessage.includes('failed to list models') || errorMessage.includes('list models')) {
      return {
        code: 'service_error',
        title: 'Model Access Denied',
        message: 'Could not access model list. Your Copilot plan may not support this feature, or the service may be temporarily unavailable.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 2000,
        originalError: error.message,
      };
    }

    // GitHub OAuth errors
    if (
      errorMessage.includes('auth') && errorMessage.includes('fail') ||
      errorMessage.includes('401') ||
      errorMessage.includes('403') ||
      errorMessage.includes('not authenticated') ||
      errorMessage.includes('login required')
    ) {
      return {
        code: 'invalid_credentials',
        title: 'Authentication Required',
        message: 'You need to authenticate with your GitHub account. Check your GitHub OAuth credentials.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        originalError: error.message,
      };
    }

    // SDK / connection errors
    if (
      errorMessage.includes('failed to connect') ||
      errorMessage.includes('copilot') && errorMessage.includes('not found') ||
      errorMessage.includes('spawn') && errorMessage.includes('enoent')
    ) {
      return {
        code: 'network_error',
        title: 'Copilot SDK Not Found',
        message: 'Could not start the Copilot SDK. Make sure it is installed and accessible.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        originalError: error.message,
      };
    }

    // Rate limiting
    if (errorMessage.includes('rate') || errorMessage.includes('429')) {
      return {
        code: 'rate_limited',
        title: 'Rate Limited',
        message: 'Too many requests. Please wait a moment before trying again.',
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

  // ============================================================
  // LLM Query (ephemeral session for call_llm + runMiniCompletion)
  // ============================================================

  /**
   * Execute an LLM query via an ephemeral CopilotSession.
   *
   * Creates a minimal session (no MCP servers, no hooks, no permission handler)
   * for one-turn completions. Collects text from `assistant.message_delta` events,
   * waits for `session.idle`, returns the accumulated result.
   *
   * Used by:
   * - call_llm tool (via queryFn callback in session-scoped-tools)
   * - runMiniCompletion (title generation, large response summarization)
   */
  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    this.debug('[CopilotAgent.queryLlm] Starting');

    const client = await this.ensureClient();
    const model = request.model ?? this.config.miniModel ?? getDefaultSummarizationModel();

    this.debug(`[CopilotAgent.queryLlm] Using model: ${model}`);

    // Create a minimal ephemeral session — no MCP servers, no hooks, no permissions
    const ephemeralConfig: CopilotSessionConfig = {
      model,
      systemMessage: request.systemPrompt
        ? { mode: 'replace', content: request.systemPrompt }
        : { mode: 'replace', content: 'Reply with ONLY the requested text. No explanation.' },
      onPermissionRequest: async () => ({ kind: 'approved' as const }),
      workingDirectory: this.resolvedCwd(),
      streaming: true,
    };

    const ephemeralSession = await client.createSession(ephemeralConfig);
    this.debug(`[CopilotAgent.queryLlm] Created ephemeral session: ${ephemeralSession.sessionId}`);

    // Collect response text from delta events
    let result = '';
    let completionResolve: () => void;
    const completionPromise = new Promise<void>((resolve) => {
      completionResolve = resolve;
    });

    const unsubscribe = ephemeralSession.on((event: SessionEvent) => {
      if (event.type === 'assistant.message_delta') {
        const data = event.data as { deltaContent?: string };
        if (data.deltaContent) {
          result += data.deltaContent;
        }
      }
      if (event.type === 'session.idle') {
        completionResolve();
      }
    });

    try {
      await ephemeralSession.send({ prompt: request.prompt });

      await withTimeout(
        completionPromise,
        LLM_QUERY_TIMEOUT_MS,
        `queryLlm timed out after ${LLM_QUERY_TIMEOUT_MS / 1000}s`
      );

      this.debug(`[CopilotAgent.queryLlm] Result length: ${result.trim().length}`);
      return { text: result.trim(), model };
    } finally {
      unsubscribe();
      ephemeralSession.destroy().catch(() => {});
    }
  }

  // ============================================================
  // Mini Completion (for title generation + summarization)
  // ============================================================

  /**
   * Run a simple text completion for title generation and large response summarization.
   * Delegates to queryLlm() which uses an ephemeral CopilotSession.
   */
  async runMiniCompletion(prompt: string): Promise<string | null> {
    const result = await this.queryLlm({ prompt });
    const text = result.text || null;
    this.debug(`[runMiniCompletion] Result: ${text ? `"${text.slice(0, 200)}"` : 'null'}`);
    return text;
  }

  // ============================================================
  // Debug
  // ============================================================

  protected override debug(message: string): void {
    this.onDebug?.(`[copilot] ${message}`);
  }
}

// Alias for consistency with CodexBackend naming
export { CopilotAgent as CopilotBackend };
