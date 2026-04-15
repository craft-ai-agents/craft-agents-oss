/**
 * AcpAgent — Agent Client Protocol Backend
 *
 * Extends BaseAgent to add ACP protocol support. CraftAgents acts as the ACP
 * client; external processes (Gemini CLI, Claude CLI, etc.) act as ACP servers.
 *
 * Key design decisions (from tech-design.md):
 * - transport injected by factory (dependency injection — enables unit testing with InProcess transport)
 * - chatImpl uses EventQueue + session/update notifications (no polling)
 * - abort() sends session/cancel notification, resolves immediately; 5s fire-and-forget guard injects complete()
 * - forceAbort(): sets _transportDisposed=true FIRST, then disposes transport
 * - destroy(): sync (BaseAgent contract), fire-and-forget transport dispose
 * - queryLlm(): throws (ACP agents manage their own LLM)
 * - runMiniCompletion(): returns null (no mini-completion path for ACP)
 */

import type { AgentEvent } from '@craft-agent/core/types';
import type { FileAttachment } from '../utils/files.ts';
import { BaseAgent } from './base-agent.ts';
import type { BackendConfig, ChatOptions, PostInitResult } from './backend/types.ts';
import { AbortReason } from './backend/types.ts';
import type { LLMQueryRequest, LLMQueryResult } from './llm-tool.ts';
import { EventQueue } from './backend/event-queue.ts';
import type { AcpTransport } from './acp-transport.ts';
import { AcpEventAdapter, type AcpSessionUpdate } from './acp-event-adapter.ts';
import type { ModelDefinition } from '../config/models.ts';
import { getLlmConnection } from '../config/storage.ts';
import { getCredentialManager } from '../credentials/index.ts';

// ============================================================
// Helpers
// ============================================================

interface SessionNewResult {
  sessionId: string;
  models?: { currentModelId?: string; availableModels?: Array<{ modelId: string; name: string; description?: string }> };
  configOptions?: Array<{ id: string; category?: string; currentValue?: string; options?: Array<{ value: string; name: string; description?: string }> }>;
}

/**
 * Extract ModelDefinition list from a session/new response.
 * Supports both the legacy `models` field and the newer `configOptions[category=model]` format.
 */
function _extractModels(result: SessionNewResult): ModelDefinition[] {
  // New format: configOptions with category=model takes precedence
  if (result.configOptions) {
    const modelOption = result.configOptions.find(o => o.category === 'model' || o.id === 'model');
    if (modelOption?.options?.length) {
      return modelOption.options.map(o => ({
        id: o.value,
        name: o.name,
        shortName: o.name,
        description: o.description ?? '',
        provider: 'acp' as never,
        contextWindow: 0,
      }));
    }
  }
  // Legacy format: models.availableModels
  if (result.models?.availableModels?.length) {
    return result.models.availableModels.map(m => ({
      id: m.modelId,
      name: m.name,
      shortName: m.name,
      description: m.description ?? '',
      provider: 'acp' as never,
      contextWindow: 0,
    }));
  }
  return [];
}

// ============================================================
// Constants
// ============================================================

/**
 * Maximum number of simultaneous pending permission requests.
 * Exceeding this limit causes new requests to be denied immediately (allowed: false)
 * to prevent a malicious or misbehaving ACP server from exhausting process memory
 * by sending an unbounded stream of permission/request messages.
 */
const MAX_PENDING_PERMISSIONS = 100;

// ============================================================
// AcpAgent
// ============================================================

export class AcpAgent extends BaseAgent {
  protected override backendName = 'acp';

  // Private state
  private _isProcessing = false;
  private _activeSessionId: string | null = null;
  private _transportDisposed = false;
  private _pendingPermissions = new Map<
    string | number,
    (result: { allowed: boolean }) => void
  >();
  private _eventQueue = new EventQueue();

  /**
   * Accumulated text from text_delta events during the current turn.
   * Some ACP servers (e.g. Cursor in native ACP mode) signal completion
   * only via session/prompt's stopReason without sending a text_complete
   * event. This buffer allows us to synthesize text_complete at that point.
   * Reset at the start of each chatImpl turn.
   */
  private _textBuffer = '';

  /**
   * Inactivity timer for ACP servers that never send a terminal event.
   *
   * Some ACP implementations (e.g. @zed-industries/claude-agent-acp) stream
   * text via agent_message_chunk notifications but never respond to
   * session/prompt and never send a status="completed" notification.
   * The only observable end-of-turn signal is silence after the last chunk.
   *
   * After receiving any text content, we arm a 3-second inactivity timer.
   * Each new text chunk resets the timer. When the timer fires, we flush
   * any buffered text and synthesize a text_complete + complete event.
   */
  private _inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly INACTIVITY_TIMEOUT_MS = 3_000;

  /** Models discovered from the last session/new response. Set after first chat. */
  private _discoveredModels: ModelDefinition[] = [];

  /** Optional custom FS read handler (injected in tests or by factory) */
  private _fsReadHandler: ((path: string) => Promise<string>) | null = null;

  constructor(
    config: BackendConfig,
    private readonly transport: AcpTransport,
  ) {
    // ACP agents have no fixed model or context window (managed by external process)
    super(config, config.model ?? '', undefined);
    this._setupTransportHandlers();
  }

  // ============================================================
  // Transport handler setup
  // ============================================================

  /**
   * Reset the inactivity timer after each text chunk.
   * When the timer fires (3s of silence), synthesize text_complete + complete.
   */
  private _resetInactivityTimer(): void {
    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer);
    }
    this._inactivityTimer = setTimeout(() => {
      this._inactivityTimer = null;
      // Only fire if we're still mid-turn and queue is not already closed
      if (!this._isProcessing || this._eventQueue.isComplete) return;
      // Flush accumulated text as text_complete
      if (this._textBuffer) {
        this._eventQueue.enqueue({ type: 'text_complete', text: this._textBuffer });
        this._textBuffer = '';
      }
      this._eventQueue.enqueue({ type: 'complete' });
      this._eventQueue.complete();
    }, AcpAgent.INACTIVITY_TIMEOUT_MS);
  }

  private _setupTransportHandlers(): void {
    // Incoming notifications: session/update → adapt → enqueue
    this.transport.onNotification((method, params) => {
      if (method === 'session/update') {
        // Handle two ACP wire formats:
        //   Standard: params = { status, content, ... }
        //   Cursor:   params = { sessionId, update: { sessionUpdate, content, ... } }
        const raw = params as Record<string, unknown>;
        const update: AcpSessionUpdate = (raw.update && typeof raw.update === 'object')
          ? raw.update as AcpSessionUpdate
          : raw as AcpSessionUpdate;
        const events = AcpEventAdapter.adapt(update);
        for (const event of events) {
          // Accumulate text from text_delta events for potential text_complete synthesis
          if (event.type === 'text_delta' && 'text' in event) {
            const deltaText = (event as any).text as string;
            this._textBuffer += deltaText;
            // Arm/reset the inactivity timer — for ACP servers that never send
            // a terminal event (e.g. @zed-industries/claude-agent-acp), silence
            // after the last chunk is the only end-of-turn signal we can observe.
            // Only arm on non-empty text to avoid false triggers from start-of-
            // response markers (some servers send text: "" as a stream-open signal).
            if (deltaText) {
              this._resetInactivityTimer();
            }
          }
          // text_complete resets the buffer (server sent explicit completion)
          if (event.type === 'text_complete') {
            this._textBuffer = '';
            if (this._inactivityTimer) {
              clearTimeout(this._inactivityTimer);
              this._inactivityTimer = null;
            }
          }
          this._eventQueue.enqueue(event);
          // Terminal events close the queue
          if (event.type === 'complete' || event.type === 'typed_error') {
            if (this._inactivityTimer) {
              clearTimeout(this._inactivityTimer);
              this._inactivityTimer = null;
            }
            this._eventQueue.complete();
          }
        }
      }
      // Other notifications are silently ignored
    });

    // Incoming requests: fs/read_text_file etc. (ACP client-capability callbacks)
    this.transport.onRequest(async (method, params, id) => {
      if (method === 'fs/read_text_file') {
        const p = (params as any)?.path as string ?? '';
        if (this._fsReadHandler) {
          const content = await this._fsReadHandler(p);
          return { content };
        }
        // Default: return empty content (safe fallback)
        return { content: '' };
      }

      // Permission requests (respondToPermission flow)
      if (method === 'permission/request') {
        const requestId = (params as any)?.requestId as string | number ?? id;

        // Guard: deny immediately if the pending-permissions map is at capacity.
        // This prevents a malicious ACP server from flooding the map and causing OOM.
        if (this._pendingPermissions.size >= MAX_PENDING_PERMISSIONS) {
          return { allowed: false };
        }

        return new Promise<unknown>((resolve) => {
          const timeout = setTimeout(() => {
            this._pendingPermissions.delete(requestId);
            resolve({ allowed: false });
          }, 30_000);

          this._pendingPermissions.set(requestId, (result) => {
            clearTimeout(timeout);
            this._pendingPermissions.delete(requestId);
            resolve(result);
          });
        });
      }

      // Unknown request — return empty result (don't crash)
      return {};
    });
  }

  // ============================================================
  // Test / factory hook
  // ============================================================

  /** Register a custom FS read handler (for testing or ACP callback support) */
  setFsReadHandler(handler: (path: string) => Promise<string>): void {
    this._fsReadHandler = handler;
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Inject credentials into process.env before the subprocess spawns.
   *
   * The ACP subprocess spawns lazily on the first sendRequest() call, so this
   * runs before any child process exists. For connections with authType='api_key',
   * the stored API key is injected as ANTHROPIC_API_KEY so that ACP agents like
   * claude-agent-acp can authenticate with the Anthropic API.
   */
  override async postInit(): Promise<PostInitResult> {
    const slug = this.config.connectionSlug;
    if (!slug) return { authInjected: false };

    const connection = getLlmConnection(slug);
    if (!connection) return { authInjected: false };

    // Only inject for api_key auth — other auth types (none, environment) don't
    // require explicit injection since environment variables are already in place.
    if (connection.authType !== 'api_key') return { authInjected: false };

    try {
      const manager = getCredentialManager();
      const apiKey = await manager.getLlmApiKey(slug);
      if (!apiKey) return { authInjected: false, authWarning: `No API key stored for ACP connection: ${slug}` };

      // Inject into process.env so the lazily-spawned subprocess inherits it.
      // For ACP agents backed by Claude (claude-agent-acp, acpx, etc.) this
      // provides the ANTHROPIC_API_KEY they need. Users can override this by
      // setting acpEnv on the connection config.
      process.env.ANTHROPIC_API_KEY = apiKey;
      return { authInjected: true };
    } catch {
      return { authInjected: false };
    }
  }

  // ============================================================
  // BaseAgent abstract method implementations
  // ============================================================

  protected override async *chatImpl(
    message: string,
    _attachments?: FileAttachment[],
    _options?: ChatOptions,
  ): AsyncGenerator<AgentEvent> {
    this._isProcessing = true;
    this._eventQueue.reset();
    this._textBuffer = '';
    // Clear any lingering inactivity timer from a previous turn
    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer);
      this._inactivityTimer = null;
    }

    try {
      // 1. Initialize (protocol handshake) — protocolVersion is an integer per ACP spec
      await this.transport.sendRequest('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: false } },
        clientInfo: { name: 'craft-agents', version: '1.0.0' },
      });

      // 2. Create a new session; response may include available models
      const sessionResult = await this.transport.sendRequest('session/new', {
        cwd: (typeof process !== 'undefined' ? process.cwd() : undefined),
        mcpServers: [],
      }) as {
        sessionId: string;
        models?: { currentModelId?: string; availableModels?: Array<{ modelId: string; name: string; description?: string }> };
        configOptions?: Array<{ id: string; category?: string; currentValue?: string; options?: Array<{ value: string; name: string; description?: string }> }>;
      };
      this._activeSessionId = sessionResult.sessionId;

      // Cache discovered models so the factory can expose them to the UI
      this._discoveredModels = _extractModels(sessionResult);

      // 3. Send the user prompt as fire-and-forget — start drain() immediately.
      //
      // Two completion styles exist across ACP implementations:
      //   • Standard ACP (claude-agent-acp, Gemini CLI, etc.): session/prompt
      //     returns {} (or never returns) and completion arrives as a
      //     session/update notification with status="completed".
      //   • Cursor ACP: session/prompt itself resolves with {stopReason}
      //     once the turn is done; session/update notifications carry the stream.
      //
      // We fire session/prompt without blocking so drain() can consume
      // session/update events even while the JSON-RPC response is still pending.
      // The .then()/.catch() handlers close the queue when the response arrives.
      void this.transport.sendRequest('session/prompt', {
        sessionId: this._activeSessionId,
        prompt: [{ type: 'text', text: message }],
      }).then((result) => {
        const promptResult = result as { stopReason?: string } | null | undefined;
        if (promptResult && typeof promptResult === 'object' && 'stopReason' in promptResult) {
          // Cursor ACP style: session/prompt response carries stopReason.
          // Flush any buffered text and close the queue if not already done.
          if (!this._eventQueue.isComplete) {
            if (this._textBuffer) {
              this._eventQueue.enqueue({ type: 'text_complete', text: this._textBuffer });
              this._textBuffer = '';
            }
            this._eventQueue.enqueue({ type: 'complete' });
            this._eventQueue.complete();
          }
        }
        // If no stopReason, completion comes via session/update notifications — no action needed.
      }).catch((err) => {
        // session/prompt failed (process died, transport error, etc.)
        if (!this._eventQueue.isComplete) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this._eventQueue.enqueue({ type: 'error', message: `ACP session/prompt error: ${errMsg}` });
          this._eventQueue.enqueue({ type: 'complete' });
          this._eventQueue.complete();
        }
      });

      // 4. Drain event queue — events arrive via session/update notifications
      //    or via the session/prompt response handler above.
      //
      // Timeout guard: if no terminal event arrives within 120s, close the queue
      // with an error so the UI doesn't spin forever. This catches cases where the
      // ACP server hangs (e.g. missing API key, network issues).
      const timeoutId = setTimeout(() => {
        if (!this._eventQueue.isComplete) {
          this._eventQueue.enqueue({ type: 'error', message: 'ACP session timed out (no response after 120s). Check that the agent process has the required credentials and network access.' });
          this._eventQueue.enqueue({ type: 'complete' });
          this._eventQueue.complete();
        }
      }, 120_000);

      try {
        yield* this._eventQueue.drain();
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      // Transport error (process died, disposed, etc.)
      const msg = err instanceof Error ? err.message : String(err);
      if (!this._transportDisposed) {
        yield { type: 'error', message: `ACP transport error: ${msg}` };
      }
      yield { type: 'complete' };
    } finally {
      this._isProcessing = false;
      this._activeSessionId = null;
    }
  }

  override async abort(reason?: string): Promise<void> {
    if (!this._isProcessing) return;

    // Fire-and-forget session/cancel — resolve abort() immediately
    // The server is expected to respond with session/update { status: 'cancelled' }
    if (this._activeSessionId) {
      void this.transport.sendRequest('session/cancel', {
        sessionId: this._activeSessionId,
        reason: reason ?? 'user_stop',
      }).catch(() => {
        // If the request fails, the 5s guard will force-close the queue
      });
    }

    // 5-second background guard: if server doesn't send a terminal session/update,
    // force-close the queue to unblock chatImpl's drain().
    setTimeout(() => {
      if (this._isProcessing) {
        this._eventQueue.complete();
      }
    }, 5_000);
  }

  override forceAbort(reason: AbortReason): void {
    if (this._transportDisposed) return;

    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer);
      this._inactivityTimer = null;
    }

    // Set flag BEFORE calling dispose to prevent double-disposal race
    this._transportDisposed = true;
    void this.transport.dispose();

    this._isProcessing = false;
    this._eventQueue.complete();
  }

  override destroy(): void {
    super.destroy();
    if (this._inactivityTimer) {
      clearTimeout(this._inactivityTimer);
      this._inactivityTimer = null;
    }
    if (!this._transportDisposed) {
      this._transportDisposed = true;
      void this.transport.dispose();
    }
  }

  override isProcessing(): boolean {
    return this._isProcessing;
  }

  /**
   * Returns models discovered from the last session/new response.
   * Empty until the first chat completes session/new successfully.
   */
  getDiscoveredModels(): ModelDefinition[] {
    return this._discoveredModels;
  }

  override respondToPermission(
    requestId: string,
    allowed: boolean,
    _alwaysAllow?: boolean,
  ): void {
    const resolver = this._pendingPermissions.get(requestId);
    if (resolver) {
      resolver({ allowed });
    }
    // Silently ignore unknown requestIds
  }

  override async runMiniCompletion(_prompt: string): Promise<string | null> {
    // ACP agents handle their own LLM — no mini-completion path available
    return null;
  }

  override async queryLlm(_request: LLMQueryRequest): Promise<LLMQueryResult> {
    throw new Error('queryLlm is not supported for ACP provider — ACP agents manage their own LLM');
  }
}
