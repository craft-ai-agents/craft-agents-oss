/**
 * Codex App-Server Client
 *
 * JSON-RPC client for communicating with the Codex app-server.
 * The app-server provides a structured API for managing conversations with pre-tool approval support.
 *
 * Protocol:
 * - Spawns `codex app-server` subprocess
 * - Reads JSONL from stdout
 * - Writes JSON-RPC requests/responses to stdin
 * - Routes by message structure: { id, method } = request, { id } = response, { method } = notification
 *
 * Key features over exec mode:
 * - Pre-tool approval (blocking permission requests before execution)
 * - Thread persistence (resume conversations across app restarts)
 * - Built-in auth handling (OAuth flow via account/login/start)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

// Import generated types from codex-types package
import type {
  ClientRequest,
  ServerRequest,
  ServerNotification,
  EventMsg,
  InitializeParams,
  InitializeResponse,
  RequestId,
  // Legacy notifications (non-v2)
  AuthStatusChangeNotification,
  LoginChatGptCompleteNotification,
  SessionConfiguredNotification,
} from '@craft-agent/codex-types';

import type {
  ThreadStartParams,
  ThreadStartResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  LoginAccountParams,
  LoginAccountResponse,
  GetAccountParams,
  GetAccountResponse,
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  CommandExecutionApprovalDecision,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  FileChangeApprovalDecision,
  // Existing notifications
  ItemStartedNotification,
  ItemCompletedNotification,
  AgentMessageDeltaNotification,
  TurnStartedNotification,
  TurnCompletedNotification,
  TurnPlanUpdatedNotification,
  ThreadStartedNotification,
  ThreadTokenUsageUpdatedNotification,
  // Kept notifications (used)
  ErrorNotification,
  ContextCompactedNotification,
  FileChangeOutputDeltaNotification,
  McpToolCallProgressNotification,
  TerminalInteractionNotification,
  ConfigWarningNotification,
  WindowsWorldWritableWarningNotification,
} from '@craft-agent/codex-types/v2';

// ============================================================
// Types
// ============================================================

/**
 * ChatGPT auth tokens for the `chatgptAuthTokens` login mode.
 * These types extend the generated codex-types since `chatgptAuthTokens`
 * may not be in older type definitions.
 */
export interface ChatGptAuthTokensLoginParams {
  type: 'chatgptAuthTokens';
  idToken: string;
  accessToken: string;
}

/**
 * API key login params for direct OpenAI API key authentication.
 * Uses Codex's `apiKey` login mode instead of OAuth.
 */
export interface ApiKeyLoginParams {
  type: 'apiKey';
  apiKey: string;
}

/**
 * Token refresh request params from Codex app-server.
 * Sent when the server receives a 401 and needs fresh tokens.
 */
export interface ChatGptTokenRefreshRequestParams {
  reason: 'unauthorized' | 'expired' | string;
  previousAccountId?: string;
}

/**
 * Token refresh response to send back to the server.
 */
export interface ChatGptTokenRefreshResponse {
  idToken: string;
  accessToken: string;
}

// ============================================================
// CRAFT AGENTS: PreToolUse Hook Types
// ============================================================

/**
 * Tool type enum for PreToolUse hook.
 * Matches the Rust ToolCallType enum in the fork.
 */
export type ToolCallType =
  | 'bash'
  | 'fileWrite'
  | 'fileEdit'
  | 'mcp'
  | 'custom'
  | 'function'
  | 'localShell';

/**
 * Parameters for PreToolUse hook request.
 * Sent BEFORE tool execution to allow client to block/modify/allow.
 */
export interface ToolCallPreExecuteParams {
  threadId: string;
  turnId: string;
  itemId: string;       // call_id for matching
  toolType: ToolCallType;
  toolName: string;
  input: unknown;       // JSON value of tool input
  mcpServer?: string;   // For MCP tools
  mcpTool?: string;     // For MCP tools
}

/**
 * Type of permission prompt to display when decision is AskUser.
 */
export type PermissionPromptType = 'bash' | 'file_write' | 'mcp_mutation' | 'api_mutation';

/**
 * Metadata for displaying a permission prompt when decision is AskUser.
 */
export interface PermissionPromptMetadata {
  promptType: PermissionPromptType;
  description: string;
  command?: string;     // For bash
  filePath?: string;    // For file operations
  toolName?: string;    // For MCP/API
}

/**
 * User's decision on a permission prompt.
 */
export type UserPermissionDecision = 'approved' | 'denied' | 'timedOut';

/**
 * Decision for PreToolUse hook response.
 */
export type ToolCallPreExecuteDecision =
  | { type: 'allow' }
  | { type: 'block'; reason: string }
  | { type: 'modify'; input: unknown }
  | { type: 'askUser'; prompt: PermissionPromptMetadata }
  | { type: 'userResponse'; decision: UserPermissionDecision; acceptForSession?: boolean };

/**
 * Response for PreToolUse hook.
 */
export interface ToolCallPreExecuteResponse {
  decision: ToolCallPreExecuteDecision;
}

/**
 * JSON-RPC message types
 */
interface JsonRpcRequest {
  jsonrpc?: '2.0';
  id: RequestId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: '2.0';
  id: RequestId;
  result?: unknown;
  error?: JsonRpcError;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcNotification {
  jsonrpc?: '2.0';
  method: string;
  params?: unknown;
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/**
 * Pending request tracker with deferred promise
 */
interface PendingRequest<T = unknown> {
  method: string;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
}

/**
 * App server connection options
 */
export interface AppServerOptions {
  /** Working directory for the server */
  workDir: string;
  /** Path to codex binary (defaults to 'codex' in PATH) */
  codexPath?: string;
  /** Request timeout in ms (default: 30000) */
  requestTimeout?: number;
  /** Debug callback for logging */
  onDebug?: (message: string) => void;
  /**
   * Custom environment variables to pass to the codex process.
   * These are merged with process.env (custom values take precedence).
   *
   * Use CODEX_HOME to set a per-session config directory:
   * { CODEX_HOME: '/path/to/session/.codex-home' }
   */
  env?: Record<string, string>;
}

/**
 * Event types emitted by the client
 */
export interface AppServerEvents {
  // Server notifications (v2 protocol) - Core
  'thread/started': ThreadStartedNotification;
  'thread/tokenUsage/updated': ThreadTokenUsageUpdatedNotification;
  'turn/started': TurnStartedNotification;
  'turn/completed': TurnCompletedNotification;
  'turn/plan/updated': TurnPlanUpdatedNotification;
  'item/started': ItemStartedNotification;
  'item/completed': ItemCompletedNotification;
  'item/agentMessage/delta': AgentMessageDeltaNotification;
  'item/commandExecution/outputDelta': { threadId: string; turnId: string; itemId: string; delta: string };
  'item/reasoning/textDelta': { threadId: string; turnId: string; itemId: string; delta: string };

  // Server notifications (v2 protocol) - Extended coverage (kept)
  'codex/error': ErrorNotification;
  'thread/compacted': ContextCompactedNotification;
  'item/fileChange/outputDelta': FileChangeOutputDeltaNotification;
  'item/mcpToolCall/progress': McpToolCallProgressNotification;
  'item/commandExecution/terminalInteraction': TerminalInteractionNotification;

  // Server notifications - Warnings
  'configWarning': ConfigWarningNotification;
  'windows/worldWritableWarning': WindowsWorldWritableWarningNotification;

  // Server notifications - Legacy auth (debug only)
  'authStatusChange': AuthStatusChangeNotification;
  'loginChatGptComplete': LoginChatGptCompleteNotification;
  'sessionConfigured': SessionConfiguredNotification;

  // Server requests (approval)
  'item/commandExecution/requestApproval': CommandExecutionRequestApprovalParams & { requestId: RequestId };
  'item/fileChange/requestApproval': FileChangeRequestApprovalParams & { requestId: RequestId };

  // CRAFT AGENTS: PreToolUse hook request
  // Sent BEFORE tool execution to allow client to block/modify/allow
  'item/toolCall/preExecute': ToolCallPreExecuteParams & { requestId: RequestId };

  // Server requests (auth)
  // Token refresh request - server asks us to provide fresh ChatGPT tokens
  'account/chatgptAuthTokens/refresh': ChatGptTokenRefreshRequestParams & { requestId: RequestId };

  // Auth notifications
  'account/login/completed': { loginId: string | null; success: boolean; error: string | null };
  'account/updated': { authMode: 'apikey' | 'chatgpt' | 'chatgptAuthTokens' | null };

  // Legacy EventMsg events (for compatibility)
  'event': EventMsg;

  // Connection events
  'connected': void;
  'disconnected': { code: number | null; signal: string | null };
  'error': Error;
}

// ============================================================
// AppServerClient
// ============================================================

/**
 * Client for communicating with Codex app-server via JSON-RPC over stdio.
 *
 * Usage:
 * ```typescript
 * const client = new AppServerClient({ workDir: '/path/to/project' });
 * await client.connect();
 *
 * // Start a new thread
 * const { threadId } = await client.threadStart({ model: 'codex' });
 *
 * // Listen for events
 * client.on('item/started', (item) => console.log('Tool started:', item));
 * client.on('item/commandExecution/requestApproval', async (params) => {
 *   // Show permission dialog, then respond
 *   await client.respondToCommandApproval(params.requestId, 'accept');
 * });
 *
 * // Send a message
 * await client.turnStart({ threadId, input: [{ type: 'text', text: 'Hello!' }] });
 *
 * await client.disconnect();
 * ```
 */
/**
 * Connection state for preventing race conditions.
 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

export class AppServerClient extends EventEmitter {
  private options: Required<AppServerOptions>;
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private nextRequestId: number = 1;
  private initialized: boolean = false;

  // Connection state machine to prevent race conditions
  private connectionState: ConnectionState = 'disconnected';

  // Write queue for backpressure handling
  private writeQueue: Array<{ data: string; resolve: () => void; reject: (err: Error) => void }> = [];
  private isWriting: boolean = false;

  constructor(options: AppServerOptions) {
    super();
    this.options = {
      workDir: options.workDir,
      codexPath: options.codexPath || 'codex',
      requestTimeout: options.requestTimeout || 30000,
      onDebug: options.onDebug || (() => {}),
      env: options.env || {},
    };
  }

  // ============================================================
  // Connection Lifecycle
  // ============================================================

  /**
   * Connect to the app-server by spawning the process.
   */
  async connect(): Promise<void> {
    // State machine guard - prevent double connect or connect during disconnect
    if (this.connectionState !== 'disconnected') {
      throw new Error(`Cannot connect: state is ${this.connectionState}`);
    }
    this.connectionState = 'connecting';

    this.debug('Spawning codex app-server...');

    // Spawn the app-server process
    // Custom env vars (e.g., CODEX_HOME for per-session config) take precedence
    this.process = spawn(this.options.codexPath, ['app-server'], {
      cwd: this.options.workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Ensure we get proper exit codes
        FORCE_COLOR: '0',
        // Custom env vars (e.g., CODEX_HOME) override defaults
        ...this.options.env,
      },
    });

    // Handle process errors
    this.process.on('error', (err) => {
      this.debug(`Process error: ${err.message}`);
      this.emit('error', err);
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.debug(`Process exited with code ${code}, signal ${signal}`);
      this.cleanup();
      this.emit('disconnected', { code, signal });
    });

    // Set up readline for stdout (JSONL parsing)
    if (this.process.stdout) {
      this.readline = createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      this.readline.on('line', (line) => {
        this.handleLine(line);
      });
    }

    // Log stderr output for debugging
    if (this.process.stderr) {
      this.process.stderr.on('data', (data) => {
        const text = data.toString().trim();
        if (text) {
          this.debug(`stderr: ${text}`);
        }
      });
    }

    // Perform initialization handshake
    await this.initialize();

    this.connectionState = 'connected';
    this.emit('connected', undefined as unknown as void);
    this.debug('Connected to app-server');
  }

  /**
   * Disconnect from the app-server.
   */
  async disconnect(): Promise<void> {
    // State machine guard - only disconnect if connected, ignore if already disconnecting/disconnected
    if (this.connectionState !== 'connected') {
      this.debug(`Disconnect skipped: state is ${this.connectionState}`);
      return;
    }
    this.connectionState = 'disconnecting';

    this.debug('Disconnecting from app-server...');

    // Reject any pending writes
    for (const pending of this.writeQueue) {
      pending.reject(new Error('Connection closing'));
    }
    this.writeQueue = [];

    if (!this.process) {
      this.cleanup();
      return;
    }

    // Kill the process gracefully
    // On Windows, SIGTERM/SIGKILL don't exist - use default termination
    if (process.platform === 'win32') {
      this.process.kill();
    } else {
      this.process.kill('SIGTERM');
    }

    // Wait briefly for graceful shutdown, then force kill
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          // Force kill if still running
          if (process.platform === 'win32') {
            this.process.kill();
          } else {
            this.process.kill('SIGKILL');
          }
        }
        resolve();
      }, 1000);

      if (this.process) {
        this.process.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });

    this.cleanup();
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.process !== null && this.initialized;
  }

  // ============================================================
  // JSON-RPC Protocol
  // ============================================================

  /**
   * Send a request and wait for response.
   */
  async request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Not connected');
    }

    const id = String(this.nextRequestId++);

    // Set up timeout and tracking first
    // On timeout, reject the promise so callers aren't left hanging forever
    // (e.g., when the app-server process is stuck due to API quota errors)
    const timeoutId = setTimeout(() => {
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        pending.reject(new Error(`Request timeout: ${method} (${id}) did not receive a response within ${this.options.requestTimeout}ms`));
      }
    }, this.options.requestTimeout);

    const resultPromise = new Promise<T>((resolve, reject) => {
      const originalReject = reject;
      const wrappedReject = (err: Error) => {
        clearTimeout(timeoutId);
        originalReject(err);
      };

      // Track pending request
      this.pendingRequests.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject: wrappedReject,
        timeoutId,
      });
    });

    // Build and send request with backpressure handling
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const json = JSON.stringify(request);
    this.debug(`→ ${method} (${id}): ${json.slice(0, 200)}${json.length > 200 ? '...' : ''}`);

    try {
      await this.writeWithBackpressure(json + '\n');
    } catch (err) {
      this.pendingRequests.delete(id);
      clearTimeout(timeoutId);
      throw err;
    }

    return resultPromise;
  }

  /**
   * Send a notification (no response expected).
   */
  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Not connected');
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const json = JSON.stringify(notification);
    this.debug(`→ ${method} (notify): ${json.slice(0, 200)}${json.length > 200 ? '...' : ''}`);
    await this.writeWithBackpressure(json + '\n');
  }

  /**
   * Respond to a server request (approval request, user input request).
   */
  async respond(id: RequestId, result: unknown): Promise<void> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Not connected');
    }

    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };

    const json = JSON.stringify(response);
    this.debug(`→ response (${id}): ${json.slice(0, 200)}${json.length > 200 ? '...' : ''}`);
    await this.writeWithBackpressure(json + '\n');
  }

  // ============================================================
  // High-Level API Methods
  // ============================================================

  /**
   * Start a new thread (conversation).
   */
  async threadStart(params: Partial<ThreadStartParams>): Promise<ThreadStartResponse> {
    // Build full params with defaults
    const fullParams: ThreadStartParams = {
      model: params.model ?? null,
      modelProvider: params.modelProvider ?? null,
      cwd: params.cwd ?? this.options.workDir,
      approvalPolicy: params.approvalPolicy ?? 'on-failure',
      sandbox: params.sandbox ?? 'danger-full-access',
      config: params.config ?? null,
      baseInstructions: params.baseInstructions ?? null,
      developerInstructions: params.developerInstructions ?? null,
      personality: params.personality ?? null,
      ephemeral: params.ephemeral ?? null,
      experimentalRawEvents: params.experimentalRawEvents ?? false,
    };

    return this.request<ThreadStartResponse>('thread/start', fullParams);
  }

  /**
   * Resume an existing thread.
   */
  async threadResume(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return this.request<ThreadResumeResponse>('thread/resume', params);
  }

  /**
   * Start a turn (send user message).
   */
  async turnStart(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.request<TurnStartResponse>('turn/start', params);
  }

  /**
   * Interrupt the current turn.
   */
  async turnInterrupt(params: TurnInterruptParams): Promise<TurnInterruptResponse> {
    return this.request<TurnInterruptResponse>('turn/interrupt', params);
  }

  /**
   * Get account/auth status.
   */
  async accountRead(params?: GetAccountParams): Promise<GetAccountResponse> {
    return this.request<GetAccountResponse>('account/read', params ?? {});
  }

  /**
   * Start OAuth login flow.
   */
  async accountLoginStart(params?: LoginAccountParams): Promise<LoginAccountResponse> {
    return this.request<LoginAccountResponse>('account/login/start', params ?? {});
  }

  /**
   * Log out.
   */
  async accountLogout(): Promise<void> {
    return this.request<void>('account/logout', undefined);
  }

  /**
   * Login with ChatGPT external tokens (chatgptAuthTokens mode).
   *
   * This allows Craft Agent to own the OAuth flow and inject tokens into Codex.
   * The tokens are stored in memory only - Codex will request refresh via
   * the `account/chatgptAuthTokens/refresh` server request when needed.
   *
   * @param tokens - The idToken and accessToken from ChatGPT OAuth
   */
  async accountLoginWithChatGptTokens(tokens: {
    idToken: string;
    accessToken: string;
  }): Promise<LoginAccountResponse> {
    const params: ChatGptAuthTokensLoginParams = {
      type: 'chatgptAuthTokens',
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
    };
    return this.request<LoginAccountResponse>('account/login/start', params);
  }

  /**
   * Login with OpenAI API key (apiKey mode).
   *
   * This allows using a direct OpenAI Platform API key instead of ChatGPT OAuth.
   * API key usage is billed through the OpenAI Platform account at standard rates.
   *
   * Note: Some Codex features (cloud threads) may not be available with API key auth.
   *
   * @param apiKey - The OpenAI API key from platform.openai.com/api-keys
   */
  async accountLoginWithApiKey(apiKey: string): Promise<LoginAccountResponse> {
    const params: ApiKeyLoginParams = {
      type: 'apiKey',
      apiKey,
    };
    return this.request<LoginAccountResponse>('account/login/start', params);
  }

  /**
   * Respond to a ChatGPT token refresh request.
   *
   * Called when the server receives a 401 and needs fresh tokens.
   * The application should refresh the tokens and call this method with the new values.
   *
   * @param requestId - The request ID from the refresh request event
   * @param tokens - The refreshed idToken and accessToken
   */
  async respondToTokenRefresh(
    requestId: RequestId,
    tokens: ChatGptTokenRefreshResponse
  ): Promise<void> {
    await this.respond(requestId, tokens);
  }

  /**
   * Respond to a failed token refresh (e.g., refresh token expired).
   *
   * This tells Codex that we couldn't refresh the tokens and it should
   * emit an auth error.
   *
   * @param requestId - The request ID from the refresh request event
   * @param error - Error message explaining why refresh failed
   */
  async respondToTokenRefreshError(
    requestId: RequestId,
    error: string
  ): Promise<void> {
    // Send JSON-RPC error response
    if (!this.process?.stdin?.writable) {
      throw new Error('Not connected');
    }

    const response = {
      jsonrpc: '2.0' as const,
      id: requestId,
      error: {
        code: -32000,
        message: error,
      },
    };

    const json = JSON.stringify(response);
    this.debug(`→ error response (${requestId}): ${error}`);
    await this.writeWithBackpressure(json + '\n');
  }

  /**
   * Respond to a command execution approval request.
   */
  async respondToCommandApproval(
    requestId: RequestId,
    decision: CommandExecutionApprovalDecision
  ): Promise<void> {
    const response: CommandExecutionRequestApprovalResponse = { decision };
    await this.respond(requestId, response);
  }

  /**
   * Respond to a file change approval request.
   */
  async respondToFileChangeApproval(
    requestId: RequestId,
    decision: FileChangeApprovalDecision
  ): Promise<void> {
    const response: FileChangeRequestApprovalResponse = { decision };
    await this.respond(requestId, response);
  }

  /**
   * CRAFT AGENTS: Respond to a PreToolUse hook request.
   *
   * This is called BEFORE tool execution. The decision can:
   * - Allow: Continue with original tool execution
   * - Block: Return error to model with reason (guides retry behavior)
   * - Modify: Continue with modified input (path expansion, skill qualification)
   *
   * @param requestId - The request ID from the preExecute event
   * @param decision - Allow, Block (with reason), or Modify (with new input)
   */
  async respondToToolCallPreExecute(
    requestId: RequestId,
    decision: ToolCallPreExecuteDecision
  ): Promise<void> {
    // Transform TS discriminated union to serde externally-tagged format.
    // Rust's serde default enum representation uses external tags:
    //   Unit variant  → "allow"
    //   Struct variant → { "block": { "reason": "..." } }
    // TS uses { type: "block", reason: "..." } which doesn't match.
    const serdeDecision = this.toSerdeExternallyTagged(decision);
    const response = { decision: serdeDecision };
    await this.respond(requestId, response);
  }

  /**
   * Convert a TS discriminated union (internally tagged with `type`) to
   * serde's default externally-tagged JSON representation.
   */
  private toSerdeExternallyTagged(decision: ToolCallPreExecuteDecision): unknown {
    switch (decision.type) {
      case 'allow':
        return 'allow';
      case 'block':
        return { block: { reason: decision.reason } };
      case 'modify':
        return { modify: { input: decision.input } };
      case 'askUser':
        return { askUser: { prompt: decision.prompt } };
      case 'userResponse':
        return {
          userResponse: {
            decision: decision.decision,
            accept_for_session: decision.acceptForSession ?? false,
          },
        };
    }
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Perform initialization handshake.
   */
  private async initialize(): Promise<void> {
    const params: InitializeParams = {
      clientInfo: {
        name: 'Craft Agent',
        title: null,
        version: '0.3.1', // TODO: Get from package.json
      },
    };

    const response = await this.request<InitializeResponse>('initialize', params);
    this.debug(`Initialized: ${JSON.stringify(response)}`);

    // Send initialized notification
    this.notify('initialized', {});

    this.initialized = true;
  }

  /**
   * Handle an incoming line (JSONL message).
   */
  private handleLine(line: string): void {
    if (!line.trim()) return;

    try {
      const message = JSON.parse(line) as JsonRpcMessage;
      this.routeMessage(message);
    } catch (err) {
      this.debug(`Failed to parse line: ${line}`);
    }
  }

  /**
   * Route an incoming message based on its structure.
   */
  private routeMessage(message: JsonRpcMessage): void {
    // Check if it's a response (has id but no method)
    if ('id' in message && !('method' in message)) {
      this.handleResponse(message as JsonRpcResponse);
      return;
    }

    // Check if it's a server request (has id and method)
    if ('id' in message && 'method' in message) {
      this.handleServerRequest(message as JsonRpcRequest);
      return;
    }

    // Otherwise it's a notification
    if ('method' in message) {
      this.handleNotification(message as JsonRpcNotification);
      return;
    }

    this.debug(`Unknown message format: ${JSON.stringify(message)}`);
  }

  /**
   * Handle a response to a pending request.
   */
  private handleResponse(response: JsonRpcResponse): void {
    const id = String(response.id);
    const pending = this.pendingRequests.get(id);

    if (!pending) {
      this.debug(`Received response for unknown request: ${id}`);
      return;
    }

    // Clean up
    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(id);

    // Handle error or success
    if (response.error) {
      this.debug(`← error (${id}): ${response.error.message}`);
      pending.reject(new Error(response.error.message));
    } else {
      this.debug(`← ${pending.method} (${id}): ${JSON.stringify(response.result).slice(0, 200)}`);
      pending.resolve(response.result);
    }
  }

  /**
   * Handle a server request (approval request, user input request).
   */
  private handleServerRequest(request: JsonRpcRequest): void {
    this.debug(`← request ${request.method} (${request.id})`);

    // Emit the request with its ID so the application can respond
    switch (request.method) {
      case 'item/commandExecution/requestApproval':
        this.emit('item/commandExecution/requestApproval', {
          ...(request.params as CommandExecutionRequestApprovalParams),
          requestId: request.id,
        });
        break;

      case 'item/fileChange/requestApproval':
        this.emit('item/fileChange/requestApproval', {
          ...(request.params as FileChangeRequestApprovalParams),
          requestId: request.id,
        });
        break;

      // ChatGPT token refresh request (chatgptAuthTokens mode)
      // Server asks us to provide fresh tokens after receiving 401
      case 'account/chatgptAuthTokens/refresh':
        this.emit('account/chatgptAuthTokens/refresh', {
          ...(request.params as ChatGptTokenRefreshRequestParams),
          requestId: request.id,
        });
        break;

      // CRAFT AGENTS: PreToolUse hook request
      // Sent BEFORE tool execution to allow client to block/modify/allow
      case 'item/toolCall/preExecute':
        this.emit('item/toolCall/preExecute', {
          ...(request.params as ToolCallPreExecuteParams),
          requestId: request.id,
        });
        break;

      // Legacy approval methods (v1 protocol)
      case 'execCommandApproval':
      case 'applyPatchApproval':
        // Map to v2 events
        this.debug(`Legacy approval request: ${request.method}`);
        break;

      default:
        this.debug(`Unknown server request: ${request.method}`);
    }
  }

  /**
   * Handle a server notification.
   */
  private handleNotification(notification: JsonRpcNotification): void {
    const method = notification.method;
    const params = notification.params;

    this.debug(`← ${method}: ${JSON.stringify(params).slice(0, 200)}`);

    // Emit typed events for v2 notifications
    switch (method) {
      case 'thread/started':
        this.emit('thread/started', params as ThreadStartedNotification);
        break;

      case 'turn/started':
        this.emit('turn/started', params as TurnStartedNotification);
        break;

      case 'turn/completed':
        this.emit('turn/completed', params as TurnCompletedNotification);
        break;

      case 'item/started':
        this.emit('item/started', params as ItemStartedNotification);
        break;

      case 'item/completed':
        this.emit('item/completed', params as ItemCompletedNotification);
        break;

      case 'item/agentMessage/delta':
        this.emit('item/agentMessage/delta', params as AgentMessageDeltaNotification);
        break;

      case 'item/commandExecution/outputDelta':
        this.emit('item/commandExecution/outputDelta', params as { threadId: string; turnId: string; itemId: string; delta: string });
        break;

      case 'item/reasoning/textDelta':
        this.emit('item/reasoning/textDelta', params as { threadId: string; turnId: string; itemId: string; delta: string });
        break;

      case 'turn/plan/updated':
        this.emit('turn/plan/updated', params as TurnPlanUpdatedNotification);
        break;

      // Auth notifications
      case 'account/login/completed':
        this.emit('account/login/completed', params as { loginId: string | null; success: boolean; error: string | null });
        break;

      case 'account/updated':
        this.emit('account/updated', params as { authMode: 'apikey' | 'chatgpt' | 'chatgptAuthTokens' | null });
        break;

      // Token usage notifications
      case 'thread/tokenUsage/updated':
        this.emit('thread/tokenUsage/updated', params as ThreadTokenUsageUpdatedNotification);
        break;

      // Error notifications (critical)
      case 'error':
        this.emit('codex/error', params as ErrorNotification);
        break;

      // Context management
      case 'thread/compacted':
        this.emit('thread/compacted', params as ContextCompactedNotification);
        break;

      // File change streaming (debug only)
      case 'item/fileChange/outputDelta':
        this.emit('item/fileChange/outputDelta', params as FileChangeOutputDeltaNotification);
        break;

      // MCP tool progress
      case 'item/mcpToolCall/progress':
        this.emit('item/mcpToolCall/progress', params as McpToolCallProgressNotification);
        break;

      // Terminal interaction (future feature)
      case 'item/commandExecution/terminalInteraction':
        this.emit('item/commandExecution/terminalInteraction', params as TerminalInteractionNotification);
        break;

      // Warnings
      case 'configWarning':
        this.emit('configWarning', params as ConfigWarningNotification);
        break;

      case 'windows/worldWritableWarning':
        this.emit('windows/worldWritableWarning', params as WindowsWorldWritableWarningNotification);
        break;

      // Legacy auth notifications (debug only)
      case 'authStatusChange':
        this.emit('authStatusChange', params as AuthStatusChangeNotification);
        break;

      case 'loginChatGptComplete':
        this.emit('loginChatGptComplete', params as LoginChatGptCompleteNotification);
        break;

      case 'sessionConfigured':
        this.emit('sessionConfigured', params as SessionConfiguredNotification);
        break;

      default:
        // Emit as generic event for unknown notifications
        this.debug(`Unknown notification: ${method}`);
    }
  }

  /**
   * Clean up resources.
   */
  private cleanup(): void {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    // Reject any pending writes
    for (const pending of this.writeQueue) {
      pending.reject(new Error('Connection closed'));
    }
    this.writeQueue = [];
    this.isWriting = false;

    // Close readline
    this.readline?.close();
    this.readline = null;

    // Clear process reference
    this.process = null;
    this.initialized = false;

    // Reset state machine
    this.connectionState = 'disconnected';
  }

  /**
   * Debug logging.
   */
  private debug(message: string): void {
    this.options.onDebug(`[AppServer] ${message}`);
  }

  /**
   * Write to stdin with backpressure handling.
   * Queues writes and waits for drain events when buffer is full.
   */
  private async writeWithBackpressure(data: string): Promise<void> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Not connected');
    }
    // Allow writes during 'connecting' (for initialization handshake) and 'connected' states
    if (this.connectionState !== 'connected' && this.connectionState !== 'connecting') {
      throw new Error(`Cannot write: state is ${this.connectionState}`);
    }

    return new Promise<void>((resolve, reject) => {
      this.writeQueue.push({ data, resolve, reject });
      this.processWriteQueue();
    });
  }

  /**
   * Process the write queue, respecting backpressure.
   */
  private processWriteQueue(): void {
    if (this.isWriting || this.writeQueue.length === 0) {
      return;
    }
    if (!this.process?.stdin?.writable) {
      // Connection lost, reject all pending
      for (const pending of this.writeQueue) {
        pending.reject(new Error('Connection lost'));
      }
      this.writeQueue = [];
      return;
    }

    this.isWriting = true;
    const pending = this.writeQueue.shift()!;

    const canContinue = this.process.stdin.write(pending.data);
    pending.resolve();

    if (canContinue) {
      // Buffer not full, process next immediately
      this.isWriting = false;
      this.processWriteQueue();
    } else {
      // Buffer full, wait for drain
      this.process.stdin.once('drain', () => {
        this.isWriting = false;
        this.processWriteQueue();
      });
    }
  }
}

// ============================================================
// Type-safe event emitter interface
// ============================================================

// Extend EventEmitter typing for better TypeScript support
export interface AppServerClient {
  on<K extends keyof AppServerEvents>(event: K, listener: (data: AppServerEvents[K]) => void): this;
  once<K extends keyof AppServerEvents>(event: K, listener: (data: AppServerEvents[K]) => void): this;
  emit<K extends keyof AppServerEvents>(event: K, data: AppServerEvents[K]): boolean;
  off<K extends keyof AppServerEvents>(event: K, listener: (data: AppServerEvents[K]) => void): this;
}
