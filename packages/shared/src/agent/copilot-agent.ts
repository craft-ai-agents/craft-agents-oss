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
import { type PermissionMode, shouldAllowToolInMode } from './mode-manager.ts';

import type {
  BackendConfig,
  ChatOptions,
  SdkMcpServerConfig,
} from './backend/types.ts';
import { AbortReason } from './backend/types.ts';

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

// PreToolUse utilities
import {
  expandToolPaths,
  qualifySkillName,
  stripToolMetadata,
  validateConfigWrite,
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

// Path utilities
import { join } from 'path';
import { homedir } from 'os';

// Session storage (plans folder path)
import { getSessionPlansPath, getSessionPath } from '../sessions/storage.ts';

// Error typing
import { parseError, type AgentError } from './errors.ts';

// LLM tool types and helpers for call_llm PreToolUse intercept
import { buildCallLlmRequest, withTimeout, type LLMQueryRequest, type LLMQueryResult } from './llm-tool.ts';

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

  // Source MCP server configs
  private sourceMcpServers: Record<string, SdkMcpServerConfig> = {};
  private sourceApiServers: Record<string, unknown> = {};

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

  /** Called when GitHub auth is required (token expired, not authenticated) */
  onGithubAuthRequired: ((reason: string) => void) | null = null;

  // ============================================================
  // Constructor
  // ============================================================

  constructor(config: BackendConfig) {
    const resolvedModel = resolveCopilotModelId(config.model || '');
    const modelDef = getModelById(resolvedModel);
    super({ ...config, model: resolvedModel }, resolvedModel, modelDef?.contextWindow);

    this.copilotSessionId = config.session?.sdkSessionId || null;
    this.adapter = new CopilotEventAdapter();

    if (!config.isHeadless) {
      this.startConfigWatcher();
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
      if (req.method !== 'POST' || req.url !== '/call-llm') {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;

        this.debug(`[CallbackServer] Received call_llm request`);
        const result = await this.preExecuteCallLlm(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.debug(`[CallbackServer] call_llm failed: ${msg}`);
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
    if (this.config.copilotInterceptorPath) {
      const existing = clientEnv.NODE_OPTIONS || '';
      clientEnv.NODE_OPTIONS = `${existing} --require ${this.config.copilotInterceptorPath}`.trim();
    }

    // Session dir for cross-process toolMetadataStore
    if (process.env.CRAFT_SESSION_DIR) {
      clientEnv.CRAFT_SESSION_DIR = process.env.CRAFT_SESSION_DIR;
    }

    // Propagate debug mode
    clientEnv.CRAFT_DEBUG = (process.argv.includes('--debug') || process.env.CRAFT_DEBUG === '1') ? '1' : '0';

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
      ...(this.config.copilotCliPath ? { cliPath: this.config.copilotCliPath } : {}),
    });

    await this.client.start();
    this.debug('Copilot client started');

    // Cache which models support reasoning effort
    try {
      const models = await this.client.listModels();
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
            configDir: this.config.copilotConfigDir,
            streaming: true,
          };
          this.session = await client.resumeSession(this.copilotSessionId, resumeConfig);
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
          configDir: this.config.copilotConfigDir,
          streaming: true,
        };
        this.session = await client.createSession(sessionConfig);
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

      // Send message
      await this.session.send({ prompt: fullMessage });

      // Yield events from queue until turn completes
      yield* this.eventQueue.drain();
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
        this.onGithubAuthRequired?.(`Authentication failed: ${errorObj.message}`);
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
        this.onGithubAuthRequired?.(`Authentication failed: ${data.message}`);
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
      this.eventQueue.enqueue(agentEvent);
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
   * Pre-tool-use hook — unified permission handling.
   * Reuses the same permission logic as ClaudeAgent/CodexAgent.
   */
  private async onPreToolUse(input: PreToolUseHookInput): Promise<PreToolUseHookOutput | void> {
    const { toolName, toolArgs } = input;

    // Parse toolArgs defensively — may arrive as JSON string or parsed object.
    // See parseCopilotToolArgs() for full explanation of why this is needed.
    let inputObj = this.parseCopilotToolArgs(toolArgs);
    const permissionMode = this.getPermissionMode();

    // Log the raw type for debugging — helps diagnose future format issues
    // without needing to add temporary logging each time.
    this.debug(`PreToolUse: ${toolName}, toolArgs type: ${typeof toolArgs}, keys: [${Object.keys(inputObj).join(', ')}]`);

    // Map Copilot tool names to SDK tool names for permission checking.
    // Copilot CLI uses lowercase (e.g., "bash") but our permission system
    // expects PascalCase (e.g., "Bash"). See COPILOT_TOOL_NAME_MAP.
    const sdkToolName = this.mapCopilotToolName(toolName, inputObj);

    // ============================================================
    // CALL_LLM INTERCEPT: Pre-execute LLM request and inject result.
    // The session-mcp-server runs as a subprocess and can't access
    // Copilot auth, so we execute the LLM call here via ephemeral
    // session and inject the result into _precomputedResult.
    // Same pattern as CodexAgent (codex-agent.ts ~line 1044).
    // ============================================================
    if (sdkToolName === 'mcp__session__call_llm') {
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

    // Normalize Copilot-native arg names before permission check.
    //
    // WHY: Copilot CLI's native tools (str_replace_editor subcommands like
    // "view", "create") use `path` as the file path parameter name.
    // Our permission system (shouldAllowToolInMode in mode-manager.ts) expects
    // `file_path` — it checks `input.file_path` to evaluate the plans folder
    // exception and allowedWritePaths rules. Without this remapping, `file_path`
    // is undefined and the permission check falls through to a generic block.
    //
    // MATCHES: event-adapter.ts normalizeToolArgs() does the same for display events.
    if ((sdkToolName === 'Write' || sdkToolName === 'Edit' || sdkToolName === 'Read')
        && inputObj.path && !inputObj.file_path) {
      inputObj = { ...inputObj, file_path: inputObj.path };
    }

    // Check permission mode
    const check = shouldAllowToolInMode(sdkToolName, inputObj, permissionMode, {
      plansFolderPath: getSessionPlansPath(this.config.workspace.rootPath, this._sessionId),
      permissionsContext: {
        workspaceRootPath: this.workingDirectory,
        activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
      },
    });

    if (!check.allowed) {
      // Tool blocked by permission mode
      this.debug(`Tool blocked by mode: ${sdkToolName} - ${check.reason}`);
      this.adapter.setBlockReason(sdkToolName, check.reason);
      return {
        permissionDecision: 'deny',
        permissionDecisionReason: check.reason,
      };
    }

    // Check for source blocking (MCP tools from inactive sources)
    // Copilot uses `mcp__server__tool` format for MCP tool names
    if (toolName.startsWith('mcp__')) {
      const parts = toolName.split('__');
      const sourceSlug = this.extractSourceSlugFromMcpTool(parts[1], parts[2]);
      if (sourceSlug && !this.sourceManager.isSourceActive(sourceSlug)) {
        this.debug(`PreToolUse: MCP tool from inactive source "${sourceSlug}", attempting activation...`);

        if (this.onSourceActivationRequest) {
          try {
            const activated = await this.onSourceActivationRequest(sourceSlug);
            if (!activated) {
              const sourceExists = this.sourceManager
                .getAllSources()
                .some((s) => s.config.slug === sourceSlug);
              const reason = sourceExists
                ? `Source "${sourceSlug}" is not active. Activate it by @mentioning it in your message or via the source icon at the bottom of the input field.`
                : `Source "${sourceSlug}" is not available yet. It needs to be created and configured first.`;
              this.adapter.setBlockReason(sdkToolName, reason);
              return {
                permissionDecision: 'deny',
                permissionDecisionReason: reason,
              };
            }
            this.debug(`PreToolUse: Source "${sourceSlug}" activated successfully`);
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
            this.adapter.setBlockReason(sdkToolName, reason);
            return {
              permissionDecision: 'deny',
              permissionDecisionReason: reason,
            };
          }
        }
      }
    }

    // Path expansion
    const pathResult = expandToolPaths(sdkToolName, inputObj, (msg) => this.debug(msg));

    // Config validation
    const configResult = validateConfigWrite(
      sdkToolName,
      pathResult.modified ? pathResult.input : inputObj,
      this.workingDirectory,
      (msg) => this.debug(msg)
    );
    if (!configResult.valid) {
      return {
        permissionDecision: 'deny',
        permissionDecisionReason: configResult.error || 'Invalid config write',
      };
    }

    // Skill qualification
    const skillResult = qualifySkillName(
      pathResult.modified ? pathResult.input : inputObj,
      this.config.workspace.id,
      this.config.workspace.rootPath,
      this.config.session?.workingDirectory,
      (msg) => this.debug(msg)
    );

    // Metadata stripping
    const currentInput = skillResult.modified ? skillResult.input
      : pathResult.modified ? pathResult.input
      : inputObj;
    const metaResult = stripToolMetadata(sdkToolName, currentInput, (msg) => this.debug(msg));

    // Build modified args if any transformations happened
    const wasModified = pathResult.modified || skillResult.modified || metaResult.modified;
    const finalInput = metaResult.modified ? metaResult.input
      : skillResult.modified ? skillResult.input
      : pathResult.modified ? pathResult.input
      : undefined;

    // If permission mode requires asking, emit permission request
    if (check.requiresPermission) {
      const requestId = `copilot-perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Emit permission request to UI
      this.onPermissionRequest?.({
        requestId,
        toolName: sdkToolName,
        command: typeof inputObj.command === 'string' ? inputObj.command : undefined,
        description: check.description,
        type: this.getPermissionType(sdkToolName),
      });

      // Wait for user response
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
    }

    return {
      permissionDecision: 'allow',
      modifiedArgs: wasModified ? finalInput : undefined,
    };
  }

  /**
   * Post-tool-use hook — large result save + summarization.
   * Saves full result to long_responses/ and replaces with summary + file reference.
   */
  private async onPostToolUse(input: PostToolUseHookInput): Promise<PostToolUseHookOutput | void> {
    const { toolName, toolArgs, toolResult } = input;
    const resultText = toolResult.textResultForLlm || '';

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

  override setSourceServers(
    mcpServers: Record<string, SdkMcpServerConfig>,
    apiServers: Record<string, unknown>,
    intendedSlugs?: string[]
  ): void {
    super.setSourceServers(mcpServers, apiServers, intendedSlugs);
    this.sourceMcpServers = mcpServers;
    this.sourceApiServers = apiServers;
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

    for (const [slug, server] of Object.entries(this.sourceMcpServers)) {
      if (server.type === 'http' || server.type === 'sse') {
        config[slug] = {
          type: server.type,
          url: server.url,
          headers: server.headers,
          tools: ['*'],
        };
      } else if (server.type === 'stdio') {
        config[slug] = {
          type: 'local',
          command: server.command,
          args: server.args || [],
          env: server.env,
          cwd: server.cwd,
          tools: ['*'],
        };
      }
    }

    // Add session-scoped MCP server (provides SubmitPlan, config_validate, source_test, etc.)
    if (this.config.sessionServerPath) {
      const sessionId = this.config.session?.id;
      const workspaceRootPath = this.config.workspace.rootPath;
      if (sessionId && workspaceRootPath) {
        const nodePath = this.config.nodePath || 'bun';
        const plansFolderPath = join(workspaceRootPath, 'sessions', sessionId, 'plans');
        const sessionArgs = [
          this.config.sessionServerPath,
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

    // Add bridge MCP server for API sources (REST API → MCP bridge)
    // The bridge server exposes API sources as api_{slug} tools via stdio MCP.
    // Bridge config JSON and credential caches are written by the main process
    // (setupCopilotBridgeConfig in sessions.ts) before session creation.
    if (Object.keys(this.sourceApiServers).length > 0 && this.config.bridgeServerPath && this.config.copilotConfigDir) {
      const nodePath = this.config.nodePath || 'bun';
      const bridgeConfigPath = join(this.config.copilotConfigDir, 'bridge-config.json');
      const workspaceId = this.config.workspace.id;
      const sessionId = this.config.session?.id;
      const sessionPath = sessionId
        ? join(this.config.workspace.rootPath, 'sessions', sessionId)
        : undefined;

      const bridgeArgs = [this.config.bridgeServerPath, '--config', bridgeConfigPath];
      if (sessionPath) bridgeArgs.push('--session', sessionPath);
      if (workspaceId) bridgeArgs.push('--workspace', workspaceId);

      config['api-bridge'] = {
        type: 'local',
        command: nodePath,
        args: bridgeArgs,
        tools: ['*'],
      };
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
   * Built-in MCP servers that are always available (not user sources).
   * Must match the set in codex-agent.ts to keep behavior consistent.
   */
  private static readonly BUILT_IN_MCP_SERVERS = new Set([
    'preferences',
    'session',
    'craft-agents-docs',
    'api-bridge',
  ]);

  /**
   * Extract source slug from MCP tool name parts.
   * Returns null for built-in MCP servers (session, preferences, etc.)
   * so that PreToolUse doesn't try to activate them as user sources.
   *
   * Special case: api-bridge is a built-in server that proxies API sources.
   * The real source slug is embedded in the tool name (e.g., "api_gmail" → "gmail").
   */
  private extractSourceSlugFromMcpTool(mcpServer?: string, mcpTool?: string): string | null {
    if (!mcpServer) return null;
    // api-bridge proxies API sources — resolve the real source slug from the tool name
    if (mcpServer === 'api-bridge') {
      if (mcpTool?.startsWith('api_')) {
        return mcpTool.slice(4);
      }
      return null;
    }
    if (CopilotAgent.BUILT_IN_MCP_SERVERS.has(mcpServer)) {
      return null;
    }
    return mcpServer;
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

  /**
   * Get permission request type for a tool name.
   */
  private getPermissionType(toolName: string): 'bash' | 'file_write' | 'mcp_mutation' | 'api_mutation' {
    if (toolName === 'Bash') return 'bash';
    if (toolName === 'Write' || toolName === 'Edit') return 'file_write';
    if (toolName.startsWith('mcp__')) return 'mcp_mutation';
    return 'bash'; // Default
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
  // LLM Tool Pre-Execution (call_llm via PreToolUse intercept)
  // ============================================================

  /**
   * Pre-execute a call_llm request: process attachments, resolve model,
   * build prompt with structured output injection, and run via ephemeral session.
   */
  private async preExecuteCallLlm(input: Record<string, unknown>): Promise<LLMQueryResult> {
    const request = await buildCallLlmRequest(input, { backendName: 'Copilot' });
    return this.queryLlm(request);
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

      // 30s timeout
      await withTimeout(completionPromise, 30000, 'queryLlm timed out after 30s');

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
    try {
      const result = await this.queryLlm({ prompt });
      const text = result.text || null;
      this.debug(`[runMiniCompletion] Result: ${text ? `"${text.slice(0, 200)}"` : 'null'}`);
      return text;
    } catch (error) {
      this.debug(`[runMiniCompletion] Failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
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
