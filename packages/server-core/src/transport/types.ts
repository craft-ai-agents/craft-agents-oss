/**
 * Transport-layer interfaces for the WS-based RPC.
 */

import type { PushTarget } from '@archstudio/shared/protocol'

export interface RequestContext {
  clientId: string
  workspaceId: string | null
  webContentsId: number | null
  /**
   * AbortSignal fired when the client cancels the originating request (via a
   * 'cancel' envelope) or when the server teardown (client disconnect, server
   * shutdown) means the handler's result will be discarded. Handlers can
   * ignore it, subscribe via `signal.addEventListener('abort', ...)`, or
   * wrap long-running async loops that should bail on cancellation.
   *
   * The signal is never-aborted for handlers that don't observe cancellation
   * — it's a never-fired default. This means existing handlers can adopt
   * it incrementally without behavior changes.
   */
  signal: AbortSignal
}

export type HandlerFn = (ctx: RequestContext, ...args: any[]) => Promise<any> | any

export interface RpcServer {
  handle(channel: string, handler: HandlerFn): void
  push(channel: string, target: PushTarget, ...args: any[]): void
  invokeClient(clientId: string, channel: string, ...args: any[]): Promise<any>
  updateClientWorkspace?(clientId: string, workspaceId: string): void

  /** Whether a connected client advertised the given capability on handshake. */
  hasClientCapability(clientId: string, capability: string): boolean

  /** Connected clients (optionally narrowed by workspaceId) that advertised the capability. */
  findClientsWithCapability(capability: string, opts?: { workspaceId?: string }): string[]
}

export interface RpcClient {
  invoke(channel: string, ...args: any[]): Promise<any>
  on(channel: string, callback: (...args: any[]) => void): () => void
  handleCapability(channel: string, handler: (...args: any[]) => Promise<any> | any): void
}

export type EventSink = (channel: string, target: PushTarget, ...args: any[]) => void
