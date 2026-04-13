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
      // 1. Initialize (protocol handshake)
      await this.transport.sendRequest('initialize', {
        protocolVersion: '0.1.0',
        capabilities: { fileSystem: { read: true, write: false } },
        clientInfo: { name: 'craft-agents', version: '1.0.0' },
      });

      // 2. Create a new session
      const sessionResult = await this.transport.sendRequest('session/new', {}) as { sessionId: string };
      this._activeSessionId = sessionResult.sessionId;

      // 3. Send the user prompt (response comes via notifications)
      await this.transport.sendRequest('session/prompt', {
        sessionId: this._activeSessionId,
        message,
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
