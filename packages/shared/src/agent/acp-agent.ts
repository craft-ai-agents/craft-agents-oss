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
import type { BackendConfig, ChatOptions } from './backend/types.ts';
import { AbortReason } from './backend/types.ts';
import type { LLMQueryRequest, LLMQueryResult } from './llm-tool.ts';
import { EventQueue } from './backend/event-queue.ts';
import type { AcpTransport } from './acp-transport.ts';
import { AcpEventAdapter, type AcpSessionUpdate } from './acp-event-adapter.ts';
import type { ModelDefinition } from '../config/models.ts';

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

  private _setupTransportHandlers(): void {
    // Incoming notifications: session/update → adapt → enqueue
    this.transport.onNotification((method, params) => {
      if (method === 'session/update') {
        const update = params as AcpSessionUpdate;
        const events = AcpEventAdapter.adapt(update);
        for (const event of events) {
          this._eventQueue.enqueue(event);
          // Terminal events close the queue
          if (event.type === 'complete' || event.type === 'typed_error') {
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
  // BaseAgent abstract method implementations
  // ============================================================

  protected override async *chatImpl(
    message: string,
    _attachments?: FileAttachment[],
    _options?: ChatOptions,
  ): AsyncGenerator<AgentEvent> {
    this._isProcessing = true;
    this._eventQueue.reset();

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

      // 3. Send the user prompt (response comes via notifications)
      // prompt is an array of content blocks per ACP spec
      await this.transport.sendRequest('session/prompt', {
        sessionId: this._activeSessionId,
        prompt: [{ type: 'text', text: message }],
      });

      // 4. Drain event queue until complete or typed_error
      yield* this._eventQueue.drain();
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

    // Set flag BEFORE calling dispose to prevent double-disposal race
    this._transportDisposed = true;
    void this.transport.dispose();

    this._isProcessing = false;
    this._eventQueue.complete();
  }

  override destroy(): void {
    super.destroy();
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
