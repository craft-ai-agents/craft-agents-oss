/**
 * Pi Backend (Subprocess RPC Client)
 *
 * Thin subprocess client for the Pi coding agent. Spawns a pi-agent-server
 * subprocess and communicates via JSONL over stdin/stdout.
 *
 * The subprocess runs the Pi SDK (@mariozechner/pi-coding-agent) in-process,
 * handles tool wrapping, permission enforcement, and LLM queries.
 * This file manages subprocess lifecycle, JSONL protocol, event forwarding,
 * and proxy tool routing for MCP/API sources.
 *
 * Auth is API key based. Keys are retrieved from the credential manager
 * and passed to the subprocess during initialization.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { AgentEvent } from '@craft-agent/core/types';
import type { FileAttachment } from '../utils/files.ts';

import type {
  BackendConfig,
  ChatOptions,
  SdkMcpServerConfig,
} from './backend/types.ts';
import { AbortReason } from './backend/types.ts';

import type { PermissionMode } from './mode-manager.ts';

// Import models from centralized registry
import { getModelById } from '../config/models.ts';

// BaseAgent provides common functionality
import { BaseAgent } from './base-agent.ts';
import type { Workspace } from '../config/storage.ts';

// Event adapter
import { PiEventAdapter } from './backend/pi/event-adapter.ts';
import { EventQueue } from './backend/event-queue.ts';

// System prompt for Craft Agent context
import { getSystemPrompt } from '../prompts/system.ts';

// Credential manager for token storage
import { getCredentialManager } from '../credentials/manager.ts';

// Session-scoped tool callbacks (for SubmitPlan, source auth, etc.)
import {
  registerSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
  setLastPlanFilePath,
} from './session-scoped-tools.ts';

// Session tool proxy definitions (for registering with subprocess)
import { getSessionToolProxyDefs, SESSION_TOOL_NAMES } from './backend/pi/session-tool-defs.ts';

// Session tool registry (for executing proxy tool calls)
import {
  SESSION_TOOL_REGISTRY,
  type ToolResult as SessionToolResult,
} from '@craft-agent/session-tools-core';
import { createClaudeContext, type SessionToolContext } from './claude-context.ts';

// call_llm pre-execution pipeline
import { buildCallLlmRequest } from './llm-tool.ts';

// MCP client for source tool proxying
import { CraftMcpClient, type McpClientConfig } from '../mcp/client.ts';

// Path utilities
import { join } from 'path';
import { homedir } from 'os';

// Session storage (plans folder path)
import { getSessionPlansPath } from '../sessions/storage.ts';

// Error typing
import { parseError, type AgentError } from './errors.ts';

// LLM tool types
import type { LLMQueryRequest, LLMQueryResult } from './llm-tool.ts';

// ============================================================
// PiAgent Implementation
// ============================================================

/**
 * Backend implementation using the Pi coding agent SDK via subprocess.
 *
 * Spawns a pi-agent-server subprocess and communicates via JSONL protocol.
 * Extends BaseAgent for common functionality (permission mode, source management,
 * planning heuristics, config watching, usage tracking).
 */
export class PiAgent extends BaseAgent {
  // ============================================================
  // Subprocess State
  // ============================================================

  // Subprocess process handle
  private subprocess: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private subprocessReady: Promise<void> | null = null;
  private subprocessReadyResolve: (() => void) | null = null;

  // Pi session ID (managed by subprocess, reported back)
  private piSessionId: string | null = null;

  // Callback server port (managed by subprocess)
  private callbackPort: number = 0;

  // State
  private _isProcessing: boolean = false;
  private abortReason?: AbortReason;

  // Event adapter
  private adapter: PiEventAdapter;

  // Event queue for streaming (AsyncGenerator pattern -- shared with CodexAgent/CopilotAgent)
  private eventQueue = new EventQueue();

  // Pending permission requests (correlation map for subprocess permission_request -> UI -> permission_response)
  private pendingPermissions: Map<string, {
    resolve: (allowed: boolean) => void;
    toolName: string;
  }> = new Map();

  // Pending tool executions (correlation map for subprocess tool_execute_request -> main process -> tool_execute_response)
  private pendingToolExecutions: Map<string, {
    resolve: (result: { content: string; isError: boolean }) => void;
    reject: (error: Error) => void;
  }> = new Map();

  // Pending mini completions (correlation map for subprocess mini_completion_result)
  private pendingMiniCompletions: Map<string, {
    resolve: (text: string | null) => void;
  }> = new Map();

  // Current user message (for context in summarization)
  private currentUserMessage: string = '';

  // Source server configs for proxy tool routing
  private sourceMcpServers: Record<string, SdkMcpServerConfig> = {};
  private sourceApiServers: Record<string, unknown> = {};

  // MCP clients for source tool execution (slug -> client)
  private mcpClients: Map<string, CraftMcpClient> = new Map();
  // MCP tool name -> source slug mapping (e.g., "linear__get_viewer" -> "linear")
  private mcpToolToSlug: Map<string, string> = new Map();
  // MCP tool name -> original tool name (e.g., "linear__get_viewer" -> "get_viewer")
  private mcpToolToOriginal: Map<string, string> = new Map();
  // Cached MCP proxy tool defs (for re-registration when subprocess respawns)
  private mcpProxyDefs: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];

  // Cached session tool context (lazy-created on first session tool call)
  private _sessionToolContext: SessionToolContext | null = null;

  // RPC request counter for unique IDs
  private rpcIdCounter: number = 0;

  // ============================================================
  // Constructor
  // ============================================================

  constructor(config: BackendConfig) {
    const resolvedModel = config.model || '';
    const modelDef = getModelById(resolvedModel);
    super(config, resolvedModel, modelDef?.contextWindow);

    this.piSessionId = config.session?.sdkSessionId || null;
    this.adapter = new PiEventAdapter();

    if (!config.isHeadless) {
      this.startConfigWatcher();
    }
  }

  // ============================================================
  // Subprocess Management
  // ============================================================

  /**
   * Ensure the subprocess is spawned and ready.
   * Lazy initialization -- spawns on first use.
   */
  private async ensureSubprocess(): Promise<void> {
    if (this.subprocess && this.subprocessReady) {
      await this.subprocessReady;
      return;
    }

    await this.spawnSubprocess();
  }

  /**
   * Spawn the pi-agent-server subprocess and set up JSONL communication.
   */
  private async spawnSubprocess(): Promise<void> {
    const piServerPath = this.config.piServerPath;
    if (!piServerPath) {
      throw new Error('piServerPath not configured. Cannot spawn Pi subprocess.');
    }

    const nodePath = this.config.nodePath || process.execPath;
    const cwd = this.resolvedCwd();

    this.debug(`Spawning Pi subprocess: ${nodePath} ${piServerPath}`);

    // Set up ready promise before spawning
    this.subprocessReady = new Promise<void>((resolve) => {
      this.subprocessReadyResolve = resolve;
    });

    // Spawn the subprocess
    const child = spawn(nodePath, [piServerPath], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...this.config.envOverrides,
      },
    });

    this.subprocess = child;

    // Set up readline for JSONL parsing from stdout
    this.readline = createInterface({
      input: child.stdout!,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line: string) => {
      this.handleLine(line);
    });

    // Forward stderr to debug log
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        this.debug(`[subprocess stderr] ${text}`);
      }
    });

    // Handle subprocess exit
    child.on('exit', (code, signal) => {
      this.handleSubprocessExit(code, signal);
    });

    child.on('error', (error) => {
      this.debug(`Subprocess error: ${error.message}`);
      this.eventQueue.enqueue({ type: 'error', message: `Pi subprocess error: ${error.message}` });
      this.eventQueue.complete();
    });

    // Retrieve auth credentials for the subprocess
    const piAuth = await this.getPiAuth();
    const legacyApiKey = piAuth ? undefined : await this.getApiKey();

    // Build session path for the subprocess
    const sessionId = this.config.session?.id || `agent-${Date.now()}`;
    const sessionPath = this.config.session
      ? getSessionPlansPath(this.config.workspace.rootPath, sessionId).replace(/\/plans$/, '')
      : '';
    const plansFolderPath = getSessionPlansPath(this.config.workspace.rootPath, sessionId);
    const workingDirectory = this.config.session?.workingDirectory || cwd;

    // Send init command (flat structure matching subprocess InboundMessage type)
    this.send({
      type: 'init',
      apiKey: legacyApiKey || '',
      model: this._model,
      cwd,
      thinkingLevel: this._thinkingLevel,
      workspaceRootPath: this.config.workspace.rootPath,
      sessionId,
      sessionPath,
      workingDirectory,
      permissionMode: this.getPermissionMode(),
      plansFolderPath,
      activeSourceSlugs: Array.from(this.sourceManager.getActiveSlugs()),
      miniModel: this.config.miniModel,
      providerType: this.config.providerType,
      authType: this.config.authType,
      workspaceId: this.config.workspace.id,
      piAuth,
    });

    // Wait for subprocess to report ready
    await this.subprocessReady;
    this.debug('Pi subprocess is ready');

    // Register session-scoped tools as proxy tools in the subprocess.
    // These tools (SubmitPlan, config_validate, source auth, call_llm, etc.)
    // are executed in the main process when the LLM calls them.
    const sessionToolDefs = getSessionToolProxyDefs();
    this.send({
      type: 'register_tools',
      tools: sessionToolDefs,
    });
    this.debug(`Registered ${sessionToolDefs.length} session tools with subprocess`);

    // If MCP sources were set before subprocess was spawned, register their tools now.
    if (this.mcpProxyDefs.length > 0) {
      this.registerMcpToolsWithSubprocess();
    }
  }

  /**
   * Send cached MCP source tool defs to subprocess as proxy tools.
   */
  private registerMcpToolsWithSubprocess(): void {
    if (this.mcpProxyDefs.length > 0) {
      this.send({
        type: 'register_tools',
        tools: this.mcpProxyDefs,
      });
      this.debug(`Re-registered ${this.mcpProxyDefs.length} MCP source tools with new subprocess`);
    }
  }

  /**
   * Build structured Pi auth from connection config.
   * Returns a provider-aware credential object for the subprocess,
   * or null if no piAuthProvider is configured (falls back to legacy getApiKey).
   *
   * OAuth tokens from Craft (Claude Max, ChatGPT Plus, Copilot) are passed as
   * api_key type because they function as bearer tokens that the Pi SDK's provider
   * modules use directly. The OAuth exchange happens on the Craft side; by the time
   * it reaches Pi, it's just an access token.
   */
  private async getPiAuth(): Promise<{ provider: string; credential: { type: 'api_key'; key: string } | { type: 'oauth'; access: string; refresh: string; expires: number } } | null> {
    const piAuthProvider = this.config.piAuthProvider;
    if (!piAuthProvider) return null;

    try {
      const credentialManager = getCredentialManager();
      const slug = this.config.connectionSlug || 'pi';

      if (this.config.authType === 'oauth') {
        // OAuth-based connections: the OAuth exchange already happened on the Craft side.
        // Pass the resulting access token as api_key — Pi SDK providers use it as a
        // bearer token directly (same as the legacy getApiKey() behavior).
        const oauth = await credentialManager.getLlmOAuth(slug);
        if (oauth?.accessToken) {
          this.debug(`Retrieved OAuth access token for Pi provider: ${piAuthProvider}`);
          return {
            provider: piAuthProvider,
            credential: { type: 'api_key', key: oauth.accessToken },
          };
        }
      } else {
        // API key-based connections
        const apiKey = await credentialManager.getLlmApiKey(slug);
        if (apiKey) {
          this.debug(`Retrieved API key credential for Pi provider: ${piAuthProvider}`);
          return {
            provider: piAuthProvider,
            credential: { type: 'api_key', key: apiKey },
          };
        }
      }

      this.debug(`No credentials found for Pi provider: ${piAuthProvider}`);
      return null;
    } catch (error) {
      this.debug(`Failed to retrieve Pi auth: ${error}`);
      return null;
    }
  }

  /**
   * Retrieve API key from the credential manager for subprocess injection.
   * Legacy fallback when piAuthProvider is not set.
   * The subprocess expects a single API key string (passed via init.apiKey).
   */
  private async getApiKey(): Promise<string | null> {
    try {
      const credentialManager = getCredentialManager();
      const slug = this.config.connectionSlug || 'pi';

      // Try LLM OAuth first (for OAuth-based connections)
      const oauth = await credentialManager.getLlmOAuth(slug);
      if (oauth?.accessToken) {
        this.debug('Retrieved API key from LLM OAuth');
        return oauth.accessToken;
      }

      // Try Anthropic API key
      const apiKey = await credentialManager.getApiKey();
      if (apiKey) {
        this.debug('Retrieved Anthropic API key');
        return apiKey;
      }

      this.debug('No API keys found for Pi agent');
      return null;
    } catch (error) {
      this.debug(`Failed to retrieve API key: ${error}`);
      return null;
    }
  }

  /**
   * Send a JSONL command to the subprocess stdin.
   */
  private send(cmd: Record<string, unknown>): void {
    if (!this.subprocess?.stdin?.writable) {
      this.debug('Cannot send to subprocess: stdin not writable');
      return;
    }
    const line = JSON.stringify(cmd);
    this.subprocess.stdin.write(line + '\n');
  }

  /**
   * Parse a JSONL line from subprocess stdout and dispatch by type.
   */
  private handleLine(line: string): void {
    if (!line.trim()) return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      this.debug(`Invalid JSONL from subprocess: ${line.slice(0, 200)}`);
      return;
    }

    const type = msg.type as string;

    switch (type) {
      case 'ready':
        // Subprocess initialized, callback server listening
        this.callbackPort = (msg.callbackPort as number) || 0;
        if (msg.sessionId) {
          this.piSessionId = msg.sessionId as string;
          this.config.onSdkSessionIdUpdate?.(this.piSessionId!);
        }
        this.subprocessReadyResolve?.();
        break;

      case 'event':
        // Pi SDK event -- forward through PiEventAdapter
        this.handleSubprocessEvent(msg.event as Record<string, unknown>);
        break;

      case 'permission_request':
        // Subprocess needs user approval for a tool
        this.handlePermissionRequest(msg);
        break;

      case 'tool_execute_request':
        // Subprocess wants main process to execute a proxy tool (MCP/API/session)
        this.handleToolExecuteRequest(msg as {
          requestId: string;
          toolName: string;
          args: Record<string, unknown>;
        });
        break;

      case 'session_tool_completed':
        // Session MCP tool completed -- fire callbacks (SubmitPlan, auth, etc.)
        this.handleSessionToolCompleted(msg);
        break;

      case 'mini_completion_result':
        // Response to a mini_completion request
        this.handleMiniCompletionResult(msg);
        break;

      case 'session_id_update':
        // Pi session ID changed
        if (msg.sessionId) {
          this.piSessionId = msg.sessionId as string;
          this.config.onSdkSessionIdUpdate?.(this.piSessionId!);
        }
        break;

      case 'error':
        this.debug(`Subprocess error: ${msg.message}`);
        this.eventQueue.enqueue({
          type: 'error',
          message: `Pi subprocess error: ${msg.message}`,
        });
        // Note: The subprocess should follow this with a synthetic agent_end event
        // which will call eventQueue.complete(). If it doesn't, handleSubprocessExit()
        // will complete the queue when the process exits.
        break;

      default:
        this.debug(`Unknown subprocess message type: ${type}`);
    }
  }

  /**
   * Forward a Pi SDK event from the subprocess through the event adapter.
   */
  private handleSubprocessEvent(event: Record<string, unknown>): void {
    // The subprocess sends Pi SDK AgentSessionEvent objects serialized as JSON.
    // Feed them through PiEventAdapter to convert to Craft AgentEvents.

    // Detect session MCP tool completions (same pattern as in-process version)
    const eventType = event.type as string;

    if (eventType === 'tool_execution_start') {
      const toolName = event.toolName as string;
      if (toolName?.startsWith('session__') || toolName?.startsWith('mcp__session__')) {
        // Session tool tracking is handled by the subprocess; it sends
        // session_tool_completed events when appropriate.
      }
    }

    // Adapt event to CraftAgentEvents
    // The event adapter expects typed PiAgentEvent/AgentSessionEvent objects,
    // but since we're receiving plain JSON, we cast through unknown.
    for (const agentEvent of this.adapter.adaptEvent(event as any)) {
      this.eventQueue.enqueue(agentEvent);
    }

    // Check for agent end (turn complete)
    if (eventType === 'agent_end') {
      this.eventQueue.complete();
    }
  }

  /**
   * Handle a permission request from the subprocess.
   * Emits to the UI and waits for the user response.
   */
  private handlePermissionRequest(req: Record<string, unknown>): void {
    const requestId = req.requestId as string;
    const toolName = req.toolName as string;
    const command = req.command as string | undefined;
    const description = req.description as string;
    const permType = req.permissionType as 'bash' | 'file_write' | 'mcp_mutation' | 'api_mutation' | undefined;

    this.debug(`Permission request from subprocess: ${toolName} (${requestId})`);

    if (this.onPermissionRequest) {
      this.onPermissionRequest({
        requestId,
        toolName,
        command,
        description,
        type: permType,
      });
    }

    // Store pending permission for respondToPermission()
    // Note: The subprocess blocks waiting for permission_response, so we don't
    // need a Promise here -- we just forward the response when it arrives.
  }

  /**
   * Handle a tool_execute_request from the subprocess.
   * Routes proxy tool calls (MCP, API, session) to the appropriate handler.
   *
   * The subprocess expects responses in the format:
   *   { content: string; isError: boolean }
   */
  private async handleToolExecuteRequest(request: {
    requestId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<void> {
    try {
      const result = await this.routeToolCall(request.toolName, request.args);
      this.send({
        type: 'tool_execute_response',
        requestId: request.requestId,
        result,
      });
    } catch (error) {
      this.send({
        type: 'tool_execute_response',
        requestId: request.requestId,
        result: {
          content: error instanceof Error ? error.message : String(error),
          isError: true,
        },
      });
    }
  }

  /**
   * Route a proxy tool call to the appropriate handler based on tool name.
   *
   * - Session tools (SubmitPlan, config_validate, etc.) -> session-tools-core handlers
   * - call_llm -> buildCallLlmRequest + queryLlm
   * - mcp__* tools -> MCP server proxy (TODO)
   * - api_* tools -> API source proxy (TODO)
   *
   * Returns { content: string; isError: boolean } matching subprocess protocol.
   */
  private async routeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: string; isError: boolean }> {
    // Session-scoped tools — strip mcp__session__ prefix added by the Pi SDK
    // registration (tools are registered as mcp__session__SubmitPlan, etc.)
    const strippedName = toolName.startsWith('mcp__session__')
      ? toolName.slice('mcp__session__'.length)
      : toolName;

    if (SESSION_TOOL_NAMES.has(strippedName)) {
      return this.executeSessionTool(strippedName, args);
    }

    // MCP source tools — route to connected MCP client
    const sourceSlug = this.mcpToolToSlug.get(toolName);
    if (sourceSlug) {
      return this.executeMcpTool(toolName, sourceSlug, args);
    }

    // API source tools
    if (toolName.startsWith('api_')) {
      return {
        content: `API tool proxy for "${toolName}" is not yet connected. ` +
                 `The Pi backend does not yet support API source tool proxying.`,
        isError: true,
      };
    }

    // Unknown tool
    return {
      content: `Unknown proxy tool: ${toolName}`,
      isError: true,
    };
  }

  /**
   * Execute an MCP source tool via the connected MCP client.
   */
  private async executeMcpTool(
    proxyName: string,
    sourceSlug: string,
    args: Record<string, unknown>
  ): Promise<{ content: string; isError: boolean }> {
    const client = this.mcpClients.get(sourceSlug);
    if (!client) {
      return {
        content: `MCP client for source "${sourceSlug}" is not connected.`,
        isError: true,
      };
    }

    const originalToolName = this.mcpToolToOriginal.get(proxyName);
    if (!originalToolName) {
      return {
        content: `Unknown MCP tool mapping: ${proxyName}`,
        isError: true,
      };
    }

    try {
      const result = await client.callTool(originalToolName, args) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };

      // Extract text from MCP result
      const textParts = (result.content || [])
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text?: string }) => c.text || '');
      const text = textParts.join('\n') || JSON.stringify(result);

      return {
        content: text,
        isError: !!result.isError,
      };
    } catch (err) {
      return {
        content: `MCP tool "${originalToolName}" failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  /**
   * Get or create a SessionToolContext for executing session-scoped tools.
   * Cached per agent instance since the workspace/session don't change.
   */
  private getSessionToolContext(): SessionToolContext {
    if (this._sessionToolContext) return this._sessionToolContext;

    const sessionId = this.config.session?.id || '';
    const workspacePath = this.config.workspace.rootPath;
    const workspaceId = this.config.workspace.id;

    this._sessionToolContext = createClaudeContext({
      sessionId,
      workspacePath,
      workspaceId,
      onPlanSubmitted: (planPath: string) => {
        setLastPlanFilePath(sessionId, planPath);
        this.onPlanSubmitted?.(planPath);
      },
      onAuthRequest: (request: unknown) => {
        this.onAuthRequest?.(request as any);
      },
    });

    return this._sessionToolContext;
  }

  /**
   * Execute a session-scoped tool by name.
   * Uses the canonical registry from @craft-agent/session-tools-core.
   */
  private async executeSessionTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    try {
      // call_llm uses a different execution path (backend-specific)
      if (toolName === 'call_llm') {
        return this.executeCallLlm(args);
      }

      const def = SESSION_TOOL_REGISTRY.get(toolName);
      if (!def?.handler) {
        return { content: `Unknown session tool: ${toolName}`, isError: true };
      }

      const ctx = this.getSessionToolContext();
      const result: SessionToolResult = await def.handler(ctx, args);

      // Convert ToolResult to subprocess response format
      const text = result.content.map(c => c.text).join('\n');
      return { content: text, isError: !!result.isError };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.debug(`Session tool ${toolName} failed: ${msg}`);
      return { content: `Session tool error: ${msg}`, isError: true };
    }
  }

  /**
   * Execute call_llm by validating input, then routing through queryLlm.
   */
  private async executeCallLlm(
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    try {
      const request = await buildCallLlmRequest(args, { backendName: 'Pi' });
      const result = await this.queryLlm(request);
      return {
        content: result.text || '(Model returned empty response)',
        isError: false,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `call_llm failed: ${msg}`, isError: true };
    }
  }

  /**
   * Handle session_tool_completed from subprocess.
   *
   * NOTE: For proxy-executed session tools, callbacks (onPlanSubmitted, etc.)
   * are already fired by executeSessionTool() via the SessionToolContext.
   * The subprocess sends this event because handleSessionEvent() detects the
   * mcp__session__ prefix, but we intentionally skip handleSessionMcpToolCompletion()
   * here to avoid double-firing callbacks.
   */
  private handleSessionToolCompleted(msg: Record<string, unknown>): void {
    const toolName = msg.toolName as string;
    const isError = msg.isError as boolean;
    this.debug(`Session tool completed: ${toolName} (isError=${isError})`);
    // Callbacks already handled by executeSessionTool() — no-op.
  }

  /**
   * Handle mini_completion_result from subprocess.
   */
  private handleMiniCompletionResult(msg: Record<string, unknown>): void {
    const id = msg.id as string;
    const text = msg.text as string | null;
    const pending = this.pendingMiniCompletions.get(id);
    if (pending) {
      this.pendingMiniCompletions.delete(id);
      pending.resolve(text);
    }
  }

  /**
   * Handle subprocess exit.
   */
  private handleSubprocessExit(code: number | null, signal: string | null): void {
    this.debug(`Pi subprocess exited: code=${code}, signal=${signal}`);

    this.subprocess = null;
    this.readline = null;
    this.subprocessReady = null;
    this.subprocessReadyResolve = null;

    // If we were processing, emit error + complete
    if (this._isProcessing) {
      const exitReason = signal ? `signal ${signal}` : `code ${code}`;
      this.eventQueue.enqueue({
        type: 'error',
        message: `Pi subprocess exited unexpectedly (${exitReason})`,
      });
      this.eventQueue.complete();
    }

    // Reject all pending mini completions
    for (const [, pending] of this.pendingMiniCompletions) {
      pending.resolve(null);
    }
    this.pendingMiniCompletions.clear();

    // Reject all pending tool executions
    for (const [, pending] of this.pendingToolExecutions) {
      pending.reject(new Error('Pi subprocess exited'));
    }
    this.pendingToolExecutions.clear();
  }

  // ============================================================
  // Chat (AsyncGenerator with event queue -- mirrors CopilotAgent)
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
      // Ensure subprocess is spawned and ready
      try {
        await this.ensureSubprocess();
      } catch (subprocessError) {
        const errorMsg = subprocessError instanceof Error ? subprocessError.message : String(subprocessError);
        this.debug(`Failed to spawn Pi subprocess: ${errorMsg}`);

        // If resume failed, clear and try fresh
        if (this.piSessionId && !options?.isRetry) {
          this.piSessionId = null;
          this.killSubprocess();
          this.clearSessionForRecovery();

          const recoveryContext = this.buildRecoveryContext();
          if (recoveryContext) {
            message = recoveryContext + message;
            this.debug('Injected recovery context into message');
          }

          await this.ensureSubprocess();
        } else {
          throw subprocessError;
        }
      }

      // Build system prompt
      const systemPrompt = getSystemPrompt(
        undefined, // pinnedPreferencesPrompt
        this.config.debugMode,
        this.config.workspace.rootPath,
        this.config.session?.workingDirectory,
        this.config.systemPromptPreset,
        'Pi' // backendName
      );

      // Build context from sources
      const sourceContext = this.sourceManager.formatSourceState();

      // Extract skills from message
      const { skillContents, cleanMessage: effectiveMessage } = this.extractSkillContent(message);

      // Build context parts using centralized PromptBuilder
      const contextParts = this.promptBuilder.buildContextParts(
        { plansFolderPath: getSessionPlansPath(this.config.workspace.rootPath, this._sessionId) },
        sourceContext
      );

      // Process attachments
      const attachmentParts: string[] = [];
      const images: Array<{ type: string; data: string; mimeType: string }> = [];
      for (const att of attachments || []) {
        if (att.mimeType?.startsWith('image/') && att.base64) {
          images.push({
            type: 'image',
            data: att.base64,
            mimeType: att.mimeType,
          });
        } else if (att.mimeType?.startsWith('image/') && (att.storedPath || att.path)) {
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

      // For Pi, context parts go into the system prompt (not the user message).
      // Unlike Claude, other LLMs behind Pi don't know to ignore inline context
      // blocks and will echo <session_state>, <sources>, etc. back in their response.
      const fullSystemPrompt = [
        systemPrompt,
        ...skillContents,
        ...contextParts,
      ].filter(Boolean).join('\n\n');

      // User message: only attachments + the actual message
      const userParts = [
        ...attachmentParts,
        effectiveMessage,
      ].filter(Boolean);
      const userMessage = userParts.join('\n\n');

      // Send prompt to subprocess
      const turnId = `turn-${++this.rpcIdCounter}`;
      this.send({
        type: 'prompt',
        id: turnId,
        message: userMessage,
        systemPrompt: fullSystemPrompt,
        images: images.length > 0 ? images : undefined,
      });

      // Yield events as they arrive
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
      const typedError = this.parsePiError(errorObj);

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
  // Permission Handling
  // ============================================================

  /**
   * Respond to a pending permission request.
   * Forwards the response to the subprocess.
   */
  respondToPermission(requestId: string, allowed: boolean, _alwaysAllow?: boolean): void {
    // Forward to subprocess
    this.send({
      type: 'permission_response',
      requestId,
      allowed,
    });

    // Also resolve local pending permissions if any
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      this.pendingPermissions.delete(requestId);
      pending.resolve(allowed);
    }
  }

  // ============================================================
  // Permission Mode Forwarding
  // ============================================================

  override setPermissionMode(mode: PermissionMode): void {
    super.setPermissionMode(mode);
    // Forward to subprocess so it enforces the updated mode
    if (this.subprocess) {
      this.debug(`Forwarding permission mode to subprocess: ${mode}`);
      this.send({ type: 'set_permission_mode', mode });
    } else {
      this.debug(`Permission mode set to ${mode} (subprocess not spawned — will be sent on init)`);
    }
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

    // Notify subprocess of active source changes.
    if (this.subprocess) {
      this.send({
        type: 'set_active_sources',
        slugs: Array.from(this.sourceManager.getActiveSlugs()),
      });
    }

    // Connect to MCP servers and register their tools as proxy tools.
    // This runs async — tools become available once connection completes.
    this.connectMcpSources(mcpServers).catch(err => {
      this.debug(`Failed to connect MCP sources: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * Connect to MCP servers, list their tools, and register as proxy tools
   * in the subprocess so the model can call them.
   */
  private async connectMcpSources(
    mcpServers: Record<string, SdkMcpServerConfig>
  ): Promise<void> {
    // Close stale clients for removed servers
    for (const [slug, client] of this.mcpClients) {
      if (!(slug in mcpServers)) {
        await client.close().catch(() => {});
        this.mcpClients.delete(slug);
      }
    }

    // Clear tool mappings — we'll rebuild them
    this.mcpToolToSlug.clear();
    this.mcpToolToOriginal.clear();

    const allProxyDefs: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];

    for (const [slug, serverConfig] of Object.entries(mcpServers)) {
      // Skip session MCP server (handled separately via session tools)
      if (slug === 'session') continue;

      try {
        // Reuse existing client if still connected, or create new one
        let client = this.mcpClients.get(slug);
        if (!client) {
          const clientConfig = this.sdkConfigToClientConfig(slug, serverConfig);
          if (!clientConfig) continue;
          client = new CraftMcpClient(clientConfig);
          await client.connect();
          this.mcpClients.set(slug, client);
          this.debug(`Connected MCP client for source: ${slug}`);
        }

        // List tools from the MCP server
        const tools = await client.listTools();
        this.debug(`Source ${slug}: ${tools.length} tools available`);

        for (const tool of tools) {
          const proxyName = `${slug}__${tool.name}`;
          this.mcpToolToSlug.set(proxyName, slug);
          this.mcpToolToOriginal.set(proxyName, tool.name);

          allProxyDefs.push({
            name: proxyName,
            description: tool.description || `Tool from ${slug}`,
            inputSchema: (tool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
          });
        }
      } catch (err) {
        this.debug(`Failed to connect MCP source ${slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Cache for re-registration when subprocess respawns
    this.mcpProxyDefs = allProxyDefs;

    // Register MCP source tools with subprocess
    if (allProxyDefs.length > 0 && this.subprocess) {
      this.send({
        type: 'register_tools',
        tools: allProxyDefs,
      });
      this.debug(`Registered ${allProxyDefs.length} MCP source tools with subprocess`);
    }
  }

  /**
   * Convert SdkMcpServerConfig to CraftMcpClient config format.
   */
  private sdkConfigToClientConfig(
    slug: string,
    config: SdkMcpServerConfig
  ): McpClientConfig | null {
    if (config.type === 'http' || config.type === 'sse') {
      return {
        transport: 'http',
        url: config.url,
        headers: config.headers,
      };
    }
    if (config.type === 'stdio') {
      return {
        transport: 'stdio',
        command: config.command,
        args: config.args,
        env: config.env,
      };
    }
    this.debug(`Unknown MCP server type for ${slug}: ${(config as { type: string }).type}`);
    return null;
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  isProcessing(): boolean {
    return this._isProcessing;
  }

  async abort(reason?: string): Promise<void> {
    // Deny all pending permissions
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve(false);
    }
    this.pendingPermissions.clear();

    // Send abort to subprocess
    this.send({ type: 'abort' });
    this.eventQueue.complete();
  }

  forceAbort(reason: AbortReason): void {
    this.abortReason = reason;
    this._isProcessing = false;

    // Reject all pending permissions
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve(false);
    }
    this.pendingPermissions.clear();

    // Reject all pending tool executions
    for (const [, pending] of this.pendingToolExecutions) {
      pending.reject(new Error(`Force aborted: ${reason}`));
    }
    this.pendingToolExecutions.clear();

    // Signal turn complete to wake up any waiting consumers
    this.eventQueue.complete();

    // For PlanSubmitted and AuthRequest, just interrupt the turn
    if (reason === AbortReason.PlanSubmitted || reason === AbortReason.AuthRequest) {
      return;
    }

    // For other reasons, send abort to subprocess
    this.send({ type: 'abort' });
  }

  // ============================================================
  // Session ID overrides (match CopilotAgent pattern)
  // ============================================================

  override getSessionId(): string | null {
    return this.piSessionId;
  }

  override setSessionId(sessionId: string | null): void {
    this.piSessionId = sessionId;
  }

  override setWorkspace(workspace: Workspace): void {
    super.setWorkspace(workspace);
    this.piSessionId = null;
    this._sessionToolContext = null;
    this.killSubprocess();
  }

  override clearHistory(): void {
    this.piSessionId = null;
    this.killSubprocess();
    super.clearHistory();
    this.debug('History cleared - next chat will start new subprocess');
  }

  destroy(): void {
    this.stopConfigWatcher();

    // Unregister session-scoped tool callbacks
    if (this.config.session?.id) {
      unregisterSessionScopedToolCallbacks(this.config.session.id);
    }

    this._sessionToolContext = null;
    this.closeMcpClients();
    this.killSubprocess();
    this.debug('PiAgent destroyed');
  }

  /**
   * Close all MCP clients and clear tool mappings.
   */
  private closeMcpClients(): void {
    for (const [, client] of this.mcpClients) {
      client.close().catch(() => {});
    }
    this.mcpClients.clear();
    this.mcpToolToSlug.clear();
    this.mcpToolToOriginal.clear();
    this.mcpProxyDefs = [];
  }

  /**
   * Reconnect by killing subprocess -- next chat() will spawn fresh.
   */
  async reconnect(): Promise<void> {
    this.killSubprocess();
    this.debug('PiAgent reconnected (subprocess will be respawned on next chat)');
  }

  /**
   * Kill the subprocess and clean up resources.
   */
  private killSubprocess(): void {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (this.subprocess) {
      // Try graceful shutdown first
      try {
        this.send({ type: 'shutdown' });
      } catch {
        // stdin may already be closed
      }
      this.subprocess.kill('SIGTERM');
      this.subprocess = null;
    }

    this.subprocessReady = null;
    this.subprocessReadyResolve = null;
    this.callbackPort = 0;
  }

  // ============================================================
  // Mini Completion (for title generation + summarization)
  // ============================================================

  /**
   * Run a simple text completion via the subprocess.
   * Sends a mini_completion request and waits for the result.
   */
  async runMiniCompletion(prompt: string): Promise<string | null> {
    try {
      // If subprocess isn't running, spawn it
      await this.ensureSubprocess();

      const id = `mini-${++this.rpcIdCounter}`;
      const resultPromise = new Promise<string | null>((resolve) => {
        this.pendingMiniCompletions.set(id, { resolve });
      });

      this.send({ type: 'mini_completion', id, prompt });

      // 30s timeout
      const timeout = new Promise<string | null>((resolve) => {
        setTimeout(() => {
          if (this.pendingMiniCompletions.has(id)) {
            this.pendingMiniCompletions.delete(id);
            this.debug('[runMiniCompletion] Timed out after 30s');
            resolve(null);
          }
        }, 30000);
      });

      const text = await Promise.race([resultPromise, timeout]);
      this.debug(`[runMiniCompletion] Result: ${text ? `"${text.slice(0, 200)}"` : 'null'}`);
      return text;
    } catch (error) {
      this.debug(`[runMiniCompletion] Failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Execute an LLM query via the subprocess.
   * Used by session-scoped tool callbacks (call_llm).
   */
  async queryLlm(request: LLMQueryRequest): Promise<LLMQueryResult> {
    this.debug('[PiAgent.queryLlm] Starting');

    // For now, delegate to mini completion via subprocess
    const text = await this.runMiniCompletion(request.prompt);
    return {
      text: text || '',
      model: request.model || this.config.miniModel || '',
    };
  }

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Resolve working directory to an absolute path.
   * BaseAgent stores paths with tilde (~) but Node.js spawn doesn't expand tilde.
   */
  private resolvedCwd(): string {
    const wd = this.workingDirectory;
    if (wd.startsWith('~/')) return join(homedir(), wd.slice(2));
    if (wd === '~') return homedir();
    return wd;
  }

  // ============================================================
  // Error Parsing
  // ============================================================

  /**
   * Parse a Pi error into a typed AgentError.
   */
  private parsePiError(error: Error): AgentError {
    const errorMessage = error.message.toLowerCase();

    // Auth errors
    if (
      errorMessage.includes('api key') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('401') ||
      errorMessage.includes('authentication')
    ) {
      return {
        code: 'invalid_api_key',
        title: 'Invalid API Key',
        message: 'Your API key was rejected. Check your credentials in Settings.',
        actions: [
          { key: 's', label: 'Update API key', command: '/settings', action: 'settings' },
        ],
        canRetry: false,
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

    // Service errors
    if (
      errorMessage.includes('500') ||
      errorMessage.includes('502') ||
      errorMessage.includes('503') ||
      errorMessage.includes('service') ||
      errorMessage.includes('overloaded')
    ) {
      return {
        code: 'service_error',
        title: 'Service Error',
        message: 'The AI service is temporarily unavailable. Please try again.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 2000,
        originalError: error.message,
      };
    }

    // Network errors
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('fetch failed')
    ) {
      return {
        code: 'network_error',
        title: 'Connection Error',
        message: 'Could not connect to the server. Check your internet connection.',
        actions: [
          { key: 'r', label: 'Retry', action: 'retry' },
        ],
        canRetry: true,
        retryDelayMs: 1000,
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
    this.onDebug?.(`[pi] ${message}`);
  }
}

// Alias for consistency with other backend naming
export { PiAgent as PiBackend };
