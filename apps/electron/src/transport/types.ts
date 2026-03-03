/**
 * Transport-layer interfaces for the WS-based RPC.
 *
 * RpcServer and RpcClient are the ONLY abstractions handlers and the renderer
 * interact with. The WebSocket implementation is hidden behind these.
 */

import type { PushTarget } from '@craft-agent/shared/protocol'

// ---------------------------------------------------------------------------
// Request context (provided to every handler by the server)
// ---------------------------------------------------------------------------

export interface RequestContext {
  /** Unique ID assigned on handshake. */
  clientId: string
  /** Workspace the client declared on handshake (null if not set). */
  workspaceId: string | null
  /** Electron webContents.id, null for headless clients. */
  webContentsId: number | null
}

// ---------------------------------------------------------------------------
// Server interface
// ---------------------------------------------------------------------------

export type HandlerFn = (ctx: RequestContext, ...args: any[]) => Promise<any> | any

export interface RpcServer {
  /** Register an RPC handler for a channel. */
  handle(channel: string, handler: HandlerFn): void
  /** Push an event to matching clients. */
  push(channel: string, target: PushTarget, ...args: any[]): void
  /** Invoke a capability on a specific client and await the response. */
  invokeClient(clientId: string, channel: string, ...args: any[]): Promise<any>
  /** Update a client's workspace binding (keeps push routing correct after workspace switch). */
  updateClientWorkspace?(clientId: string, workspaceId: string): void
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

export interface RpcClient {
  /** Send an RPC request and wait for the response. */
  invoke(channel: string, ...args: any[]): Promise<any>
  /** Subscribe to server-pushed events. Returns an unsubscribe function. */
  on(channel: string, callback: (...args: any[]) => void): () => void
  /** Register a capability handler for server→client invocations. */
  handleCapability(channel: string, handler: (...args: any[]) => Promise<any> | any): void
}

// ---------------------------------------------------------------------------
// EventSink — how SessionManager (and other services) push events
// ---------------------------------------------------------------------------

export type EventSink = (channel: string, target: PushTarget, ...args: any[]) => void

// ---------------------------------------------------------------------------
// pushTyped — compile-time typed wrapper around server.push()
// ---------------------------------------------------------------------------

import type { BroadcastEventMap } from '../shared/types'

/** Type-safe push. Constrains args against BroadcastEventMap at compile time. */
export function pushTyped<K extends keyof BroadcastEventMap & string>(
  server: RpcServer,
  channel: K,
  target: PushTarget,
  ...args: BroadcastEventMap[K]
): void {
  server.push(channel, target, ...args)
}
