/**
 * WsRpcClient — WebSocket-based RPC client.
 *
 * Used in both renderer (browser WebSocket) and Node.js contexts.
 * Handles handshake, request/response correlation, event subscriptions,
 * and automatic reconnection with exponential backoff.
 */

import {
  PROTOCOL_VERSION,
  REQUEST_TIMEOUT_MS,
  type MessageEnvelope,
} from '@craft-agent/shared/protocol'
import type { RpcClient } from './types'
import { serializeEnvelope, deserializeEnvelope } from './codec'

// ---------------------------------------------------------------------------
// Pending request state
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface WsRpcClientOptions {
  /** Workspace ID sent on handshake. */
  workspaceId?: string
  /** Electron webContents.id, sent on handshake for local clients. */
  webContentsId?: number
  /** Bearer token for remote auth. */
  token?: string
  /** Request timeout in ms. Default: 30_000 */
  requestTimeout?: number
  /** Max reconnection backoff in ms. Default: 30_000 */
  maxReconnectDelay?: number
  /** Whether to auto-reconnect on disconnect. Default: true */
  autoReconnect?: boolean
  /** Capabilities to advertise on handshake. Handlers must be registered via handleCapability(). */
  clientCapabilities?: string[]
}

// ---------------------------------------------------------------------------
// WsRpcClient
// ---------------------------------------------------------------------------

export class WsRpcClient implements RpcClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private listeners = new Map<string, Set<(...args: any[]) => void>>()
  private capabilityHandlers = new Map<string, (...args: any[]) => Promise<any> | any>()
  private clientId: string | null = null
  private connected = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  private readonly url: string
  private readonly workspaceId: string | undefined
  private readonly webContentsId: number | undefined
  private readonly token: string | undefined
  private readonly clientCapabilities: string[]
  private readonly requestTimeout: number
  private readonly maxReconnectDelay: number
  private readonly autoReconnect: boolean

  constructor(url: string, opts?: WsRpcClientOptions) {
    this.url = url
    this.workspaceId = opts?.workspaceId
    this.webContentsId = opts?.webContentsId
    this.token = opts?.token
    this.clientCapabilities = opts?.clientCapabilities ?? []
    this.requestTimeout = opts?.requestTimeout ?? REQUEST_TIMEOUT_MS
    this.maxReconnectDelay = opts?.maxReconnectDelay ?? 30_000
    this.autoReconnect = opts?.autoReconnect ?? true
  }

  // -------------------------------------------------------------------------
  // RpcClient interface
  // -------------------------------------------------------------------------

  invoke(channel: string, ...args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws) {
        reject(new Error(`Not connected (channel: ${channel})`))
        return
      }

      const id = crypto.randomUUID()
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timeout: ${channel} (${this.requestTimeout}ms)`))
      }, this.requestTimeout)

      this.pending.set(id, { resolve, reject, timeout })

      const envelope: MessageEnvelope = {
        id,
        type: 'request',
        channel,
        args,
      }

      this.ws.send(serializeEnvelope(envelope))
    })
  }

  on(channel: string, callback: (...args: any[]) => void): () => void {
    let set = this.listeners.get(channel)
    if (!set) {
      set = new Set()
      this.listeners.set(channel, set)
    }
    set.add(callback)

    return () => {
      set!.delete(callback)
      if (set!.size === 0) {
        this.listeners.delete(channel)
      }
    }
  }

  handleCapability(channel: string, handler: (...args: any[]) => Promise<any> | any): void {
    this.capabilityHandlers.set(channel, handler)
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  connect(): void {
    if (this.destroyed) return
    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      // Send handshake
      const handshake: MessageEnvelope = {
        id: crypto.randomUUID(),
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        workspaceId: this.workspaceId,
        webContentsId: this.webContentsId,
        token: this.token,
        clientCapabilities: this.clientCapabilities.length > 0 ? this.clientCapabilities : undefined,
      }
      this.ws!.send(serializeEnvelope(handshake))
    }

    this.ws.onmessage = (event) => {
      this.onMessage(typeof event.data === 'string' ? event.data : event.data.toString())
    }

    this.ws.onclose = () => {
      this.onDisconnect()
    }

    this.ws.onerror = () => {
      // Error is followed by close event, handled there
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    // Reject all pending requests
    for (const [id, req] of this.pending) {
      clearTimeout(req.timeout)
      req.reject(new Error('Client destroyed'))
    }
    this.pending.clear()
    this.ws?.close()
    this.ws = null
    this.connected = false
  }

  get isConnected(): boolean {
    return this.connected
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  private onMessage(raw: string): void {
    let envelope: MessageEnvelope
    try {
      envelope = deserializeEnvelope(raw)
    } catch {
      return
    }

    switch (envelope.type) {
      case 'handshake_ack':
        this.clientId = envelope.clientId ?? null
        this.connected = true
        this.reconnectAttempt = 0
        break

      case 'response': {
        const req = this.pending.get(envelope.id)
        if (req) {
          this.pending.delete(envelope.id)
          clearTimeout(req.timeout)
          if (envelope.error) {
            const err = new Error(envelope.error.message)
            ;(err as any).code = envelope.error.code
            ;(err as any).data = envelope.error.data
            req.reject(err)
          } else {
            req.resolve(envelope.result)
          }
        }
        break
      }

      case 'error': {
        // Protocol-level error (handshake rejection, version mismatch).
        // No pending request — connection is about to close.
        break
      }

      case 'request': {
        // Server→client capability invocation
        if (envelope.channel) {
          this.onServerRequest(envelope)
        }
        break
      }

      case 'event': {
        if (envelope.channel) {
          const set = this.listeners.get(envelope.channel)
          if (set) {
            for (const cb of set) {
              try {
                cb(...(envelope.args ?? []))
              } catch {
                // Listener errors shouldn't break the client
              }
            }
          }
        }
        break
      }
    }
  }

  private async onServerRequest(envelope: MessageEnvelope): Promise<void> {
    const handler = this.capabilityHandlers.get(envelope.channel!)
    if (!handler) {
      const response: MessageEnvelope = {
        id: envelope.id,
        type: 'response',
        channel: envelope.channel,
        error: { code: 'CHANNEL_NOT_FOUND', message: `No handler for: ${envelope.channel}` },
      }
      this.ws?.send(serializeEnvelope(response))
      return
    }

    try {
      const result = await handler(...(envelope.args ?? []))
      const response: MessageEnvelope = {
        id: envelope.id,
        type: 'response',
        channel: envelope.channel,
        result,
      }
      this.ws?.send(serializeEnvelope(response))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const response: MessageEnvelope = {
        id: envelope.id,
        type: 'response',
        channel: envelope.channel,
        error: { code: 'HANDLER_ERROR', message },
      }
      this.ws?.send(serializeEnvelope(response))
    }
  }

  // -------------------------------------------------------------------------
  // Reconnection
  // -------------------------------------------------------------------------

  private onDisconnect(): void {
    const wasConnected = this.connected
    this.connected = false
    this.clientId = null

    // Reject all pending requests
    if (wasConnected) {
      for (const [id, req] of this.pending) {
        clearTimeout(req.timeout)
        req.reject(new Error('Connection lost'))
      }
      this.pending.clear()
    }

    if (!this.destroyed && this.autoReconnect) {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelay,
    )
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
