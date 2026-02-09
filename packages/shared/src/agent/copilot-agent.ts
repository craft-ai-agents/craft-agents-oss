/**
 * Copilot Backend (GitHub Copilot SDK)
 *
 * Agent backend implementation using the @github/copilot-sdk.
 * Wraps the Copilot CLI via JSON-RPC over stdio — architecturally similar
 * to our Codex integration but with native pre/post-tool hooks and MCP support.
 *
 * Auth is GitHub OAuth. Tokens stored at `llm_oauth::copilot`.
 */

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
import { getModelById } from '../config/models.ts';

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

// PreToolUse utilities
import {
  expandToolPaths,
  qualifySkillName,
  stripToolMetadata,
  validateConfigWrite,
} from './core/pre-tool-use.ts';

// Summarization for large results
import { summarizeLargeResult, estimateTokens, TOKEN_LIMIT } from '../utils/summarize.ts';

// System prompt for Craft Agent context
import { getSystemPrompt } from '../prompts/system.ts';

// Credential manager for token storage
import { getCredentialManager } from '../credentials/manager.ts';

// Error typing
import { parseError, type AgentError } from './errors.ts';

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
 */
const COPILOT_TOOL_NAME_MAP: Record<string, string> = {
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

  // Event queue for streaming (AsyncGenerator pattern — same as CodexAgent)
  private eventQueue: AgentEvent[] = [];
  private eventResolvers: Array<(done: boolean) => void> = [];
  private turnComplete: boolean = false;

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

    this.client = new CopilotClient({
      useStdio: true,
      cwd: this.workingDirectory,
      autoStart: true,
      autoRestart: true,
      logLevel: this.config.debugMode?.enabled ? 'debug' : 'error',
      // Disable the CLI's native sandboxing — our onPreToolUse hook handles all permission logic.
      // --allow-all = --allow-all-tools --allow-all-paths --allow-all-urls
      cliArgs: ['--allow-all'],
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
    this.turnComplete = false;
    this.eventQueue = [];
    this.eventResolvers = [];
    this.currentUserMessage = message;
    this.adapter.startTurn();

    try {
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
            workingDirectory: this.workingDirectory,
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
          workingDirectory: this.workingDirectory,
          configDir: this.config.copilotConfigDir,
          streaming: true,
        };
        this.session = await client.createSession(sessionConfig);
        this.copilotSessionId = this.session.sessionId;
        this.config.onSdkSessionIdUpdate?.(this.session.sessionId);
        this.debug(`Created new Copilot session: ${this.session.sessionId}`);
      }

      // Wire up event handler
      if (this.unsubscribeEvents) {
        this.unsubscribeEvents();
      }
      this.unsubscribeEvents = this.session.on((event: SessionEvent) => {
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

      // Build full message with source context and attachments
      const messageParts = [
        sourceContext,
        ...attachmentParts,
        message,
      ].filter(Boolean);
      const fullMessage = messageParts.join('\n\n');

      // Send message
      await this.session.send({ prompt: fullMessage });

      // Yield events from queue
      while (!this.turnComplete || this.eventQueue.length > 0) {
        if (this.eventQueue.length > 0) {
          const event = this.eventQueue.shift()!;
          yield event;

          // Check if this was a complete event
          if (event.type === 'complete') {
            break;
          }
        } else {
          // Wait for more events
          const done = await this.waitForEvent();
          if (done) break;
        }
      }

      // Yield any remaining events
      while (this.eventQueue.length > 0) {
        yield this.eventQueue.shift()!;
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
        this.enqueueEvent({
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

    // Adapt event to AgentEvents
    for (const agentEvent of this.adapter.adaptEvent(event)) {
      this.enqueueEvent(agentEvent);
    }

    // Check for session idle (turn complete)
    if (event.type === 'session.idle') {
      this.signalTurnComplete();
    }
  }

  /**
   * Enqueue an event for the AsyncGenerator to yield.
   */
  private enqueueEvent(event: AgentEvent): void {
    this.eventQueue.push(event);
    // Wake up any waiting consumer
    const resolver = this.eventResolvers.shift();
    if (resolver) resolver(false);
  }

  /**
   * Wait for the next event in the queue.
   * Returns true if turn is complete and no more events.
   */
  private waitForEvent(): Promise<boolean> {
    if (this.eventQueue.length > 0) return Promise.resolve(false);
    if (this.turnComplete) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.eventResolvers.push(resolve);
    });
  }

  /**
   * Signal that the turn is complete.
   */
  private signalTurnComplete(): void {
    this.turnComplete = true;
    // Wake up all waiting consumers
    for (const resolver of this.eventResolvers) {
      resolver(true);
    }
    this.eventResolvers = [];
  }

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
    const inputObj = (toolArgs as Record<string, unknown>) || {};
    const permissionMode = this.getPermissionMode();

    // Map Copilot tool names to SDK tool names for permission checking
    const sdkToolName = this.mapCopilotToolName(toolName, inputObj);

    // Check permission mode
    const check = shouldAllowToolInMode(sdkToolName, inputObj, permissionMode, {
      plansFolderPath: this.config.session?.workingDirectory,
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
      const sourceSlug = parts[1];
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
            this.enqueueEvent({
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
   * Post-tool-use hook — large result summarization.
   */
  private async onPostToolUse(input: PostToolUseHookInput): Promise<PostToolUseHookOutput | void> {
    const { toolName, toolArgs, toolResult } = input;
    const resultText = toolResult.textResultForLlm || '';

    // Check if result is large enough to summarize
    const tokenCount = estimateTokens(resultText);
    if (tokenCount <= TOKEN_LIMIT) return;

    try {
      const inputObj = (toolArgs as Record<string, unknown>) || {};
      const summarized = await summarizeLargeResult(resultText, {
        toolName,
        input: inputObj,
        userRequest: this.currentUserMessage,
      });

      return {
        modifiedResult: {
          ...toolResult,
          textResultForLlm: summarized,
        },
      };
    } catch (error) {
      this.debug(`Summarization failed: ${error instanceof Error ? error.message : String(error)}`);
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
    this.signalTurnComplete();
  }

  forceAbort(reason: AbortReason): void {
    this.abortReason = reason;
    this.turnComplete = true;
    this._isProcessing = false;

    // Reject all pending permissions
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({
        kind: 'denied-interactively-by-user',
      });
    }
    this.pendingPermissions.clear();

    // Wake up all waiting consumers
    for (const resolver of this.eventResolvers) {
      resolver(true);
    }
    this.eventResolvers = [];

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

  destroy(): void {
    this.stopConfigWatcher();

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
  // Debug
  // ============================================================

  protected override debug(message: string): void {
    this.onDebug?.(`[copilot] ${message}`);
  }
}

// Alias for consistency with CodexBackend naming
export { CopilotAgent as CopilotBackend };
