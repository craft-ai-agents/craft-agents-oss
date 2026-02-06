/**
 * Cloud WebSocket Connection Manager
 *
 * Manages a persistent WebSocket connection to the Cloudflare Worker.
 * Handles:
 * - Request/response correlation via requestId
 * - Reconnection with exponential backoff
 * - Broadcasting remote change events to listeners
 */

import type { WSClientMessage, WSServerMessage, WSRemoteChangeEvent, CloudConnectionState } from '@craft-agent/core/types/cloud';

type PromiseResolver = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

export class CloudConnection {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, PromiseResolver>();
  private changeListeners = new Set<(event: WSRemoteChangeEvent) => void>();
  private stateListeners = new Set<(state: CloudConnectionState) => void>();
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _state: CloudConnectionState = 'disconnected';
  private shouldReconnect = true;

  constructor(
    private baseUrl: string,
    private workspaceSlug: string,
    private apiKey: string,
  ) {}

  get state(): CloudConnectionState {
    return this._state;
  }

  // ============================================================
  // Connection Lifecycle
  // ============================================================

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    return this.doConnect();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setState('disconnected');
    this.rejectAllPending('Connection closed');
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState('connecting');

      const wsUrl = this.baseUrl.replace(/^http/, 'ws')
        + `/workspace/${this.workspaceSlug}?apiKey=${encodeURIComponent(this.apiKey)}`;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        this.ws = ws;
        this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
        this.setState('connected');
        resolve();
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data as string);
      };

      ws.onclose = (event) => {
        this.ws = null;
        if (this._state === 'connecting') {
          reject(new Error(`WebSocket connection failed: ${event.code} ${event.reason}`));
        }
        this.setState('disconnected');
        this.rejectAllPending('Connection lost');
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror
        if (this._state === 'connecting') {
          this.setState('error');
        }
      };
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.doConnect();
      } catch {
        // Exponential backoff
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
        this.scheduleReconnect();
      }
    }, this.reconnectDelay);
  }

  private setState(state: CloudConnectionState): void {
    this._state = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  // ============================================================
  // Send Message (request/response pattern)
  // ============================================================

  send<T = unknown>(message: Omit<WSClientMessage, 'requestId'>): Promise<T> {
    const requestId = crypto.randomUUID();

    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timed out: ${message.type}`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer,
      });

      this.ws.send(JSON.stringify({ ...message, requestId }));
    });
  }

  // ============================================================
  // REST Fetch (for bulk loading)
  // ============================================================

  async fetch<T = unknown>(path: string): Promise<T> {
    const url = `${this.baseUrl}/workspace/${this.workspaceSlug}${path}`;
    const res = await globalThis.fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`REST request failed: ${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<T>;
  }

  // ============================================================
  // Event Handling
  // ============================================================

  private handleMessage(raw: string): void {
    let msg: WSServerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'response') {
      const pending = this.pendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.requestId);
        if (msg.error) {
          pending.reject(new Error(msg.error));
        } else {
          pending.resolve(msg.data);
        }
      }
    } else if (msg.type === 'broadcast') {
      for (const listener of this.changeListeners) {
        listener(msg.event);
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  // ============================================================
  // Listener Registration
  // ============================================================

  onRemoteChange(callback: (event: WSRemoteChangeEvent) => void): () => void {
    this.changeListeners.add(callback);
    return () => this.changeListeners.delete(callback);
  }

  onStateChange(callback: (state: CloudConnectionState) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }
}
