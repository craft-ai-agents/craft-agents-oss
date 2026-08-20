/**
 * Wire protocol types for the WS-based RPC layer.
 *
 * Shared between server (main process / headless) and client (renderer / Node).
 */

// ---------------------------------------------------------------------------
// Message envelope
// ---------------------------------------------------------------------------

export type MessageType =
  | 'handshake'
  | 'handshake_ack'
  | 'request'
  | 'response'
  | 'event'
  | 'error'
  | 'sequence_ack'

export interface MessageEnvelope {
  /** Correlation ID. UUIDv4 for requests; echoed in responses. */
  id: string
  type: MessageType
  /** Required for request / response / event / error. */
  channel?: string
  /** Request args or event payload. */
  args?: unknown[]
  /** Response payload. */
  result?: unknown
  /** Structured error. */
  error?: WireError
  /** Sent on handshake / handshake_ack. */
  protocolVersion?: string
  /** Sent on handshake by the client. */
  workspaceId?: string
  /** Sent on handshake for remote auth. */
  token?: string
  /** Assigned by server in handshake_ack. */
  clientId?: string
  /** Server identity stamp on outgoing events. For MultiClient source disambiguation. */
  serverId?: string
  /** Electron webContents.id, sent on handshake by local clients. */
  webContentsId?: number
  /**
   * Ephemeral proof issued by Electron main for its own local renderer.
   * It is accepted only by a server-side trusted binding resolver and is never
   * retained, logged, or used as a general authentication credential.
   */
  localClientProof?: string
  /** Client capabilities advertised on handshake. */
  clientCapabilities?: string[]
  /** Server-registered channels, sent in handshake_ack. Clients use this to avoid calling unavailable channels. */
  registeredChannels?: string[]

  // -- Reliable delivery fields --

  /** Per-client monotonic delivery sequence number, assigned when an event is targeted to that client. */
  seq?: number
  /** Client's last processed per-client seq — sent in sequence_ack and reconnect handshake. */
  lastSeq?: number
  /** Previous clientId — sent by client on reconnect handshake. */
  reconnectClientId?: string
  /** True when handshake_ack is for a reconnection (vs fresh connect). */
  reconnected?: boolean
  /** True when server buffer was evicted — client must do a full state refresh. */
  stale?: boolean
  /** Server app version, sent in handshake_ack. Clients can use this for compatibility checks. */
  serverVersion?: string
}

export interface WireError {
  code: ErrorCode
  message: string
  data?: unknown
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'HANDLER_ERROR'
  | 'CHANNEL_NOT_FOUND'
  | 'AUTH_FAILED'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'SESSION_NOT_IDLE'
  | 'SESSION_ID_CONFLICT'
  | 'ARTIFACT_NOT_PORTABLE'
  | 'TRANSFER_TOO_LARGE'
  | 'TRANSFER_TIMEOUT'
  | 'TRANSFER_VERIFICATION_FAILED'
  | 'REQUEST_TIMEOUT'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CLIENT_DISCONNECTED'
  | 'CLIENT_REQUEST_TIMEOUT'
  | 'BROWSER_NO_CAPABLE_CLIENT'
  | 'BROWSER_INSTANCE_NOT_OWNED'
  | 'BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED'
  | 'BROWSER_REMOTE_EVALUATE_BLOCKED'
  | 'TOOL_NOT_IN_MANIFEST'
  | 'MARKETPLACE_ENTRY_NOT_FOUND'
  | 'MARKETPLACE_ENTRY_NOT_INSTALLED'
  | 'MARKETPLACE_OPERATION_IN_FLIGHT'
  | 'MARKETPLACE_TOOL_INSTALL_FAILED'
  // Knowledge provider (P1 read-only), spec 03 §3.2 KnowledgeErrorCode
  | 'CONNECTION_UNAVAILABLE'
  | 'UNSUPPORTED_OPERATION'
  | 'NOT_FOUND'
  | 'HASH_CONFLICT'
  | 'INVALID_REF'
  | 'CAPABILITY_DISABLED'
  | 'PROVIDER_ERROR'

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'HANDLER_ERROR',
  'CHANNEL_NOT_FOUND',
  'AUTH_FAILED',
  'PROTOCOL_VERSION_UNSUPPORTED',
  'SESSION_NOT_IDLE',
  'SESSION_ID_CONFLICT',
  'ARTIFACT_NOT_PORTABLE',
  'TRANSFER_TOO_LARGE',
  'TRANSFER_TIMEOUT',
  'TRANSFER_VERIFICATION_FAILED',
  'REQUEST_TIMEOUT',
  'CAPABILITY_UNAVAILABLE',
  'CLIENT_DISCONNECTED',
  'CLIENT_REQUEST_TIMEOUT',
  'BROWSER_NO_CAPABLE_CLIENT',
  'BROWSER_INSTANCE_NOT_OWNED',
  'BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED',
  'BROWSER_REMOTE_EVALUATE_BLOCKED',
  'TOOL_NOT_IN_MANIFEST',
  'MARKETPLACE_ENTRY_NOT_FOUND',
  'MARKETPLACE_ENTRY_NOT_INSTALLED',
  'MARKETPLACE_OPERATION_IN_FLIGHT',
  'MARKETPLACE_TOOL_INSTALL_FAILED',
  'CONNECTION_UNAVAILABLE',
  'UNSUPPORTED_OPERATION',
  'NOT_FOUND',
  'HASH_CONFLICT',
  'INVALID_REF',
  'CAPABILITY_DISABLED',
  'PROVIDER_ERROR',
])

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && KNOWN_ERROR_CODES.has(value)
}

/**
 * Sender-side helper for throwing transport errors with a typed `code`.
 *
 * Class identity is lost across the wire — the transport reconstructs a plain
 * `Error` with `.code` on the receiving side. Receivers MUST branch on
 * `err.code === 'X'`, never `err instanceof CodedError`.
 */
export class CodedError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'CodedError'
  }
}

// ---------------------------------------------------------------------------
// Push target (server → clients)
// ---------------------------------------------------------------------------

export type PushTarget =
  | { to: 'all'; exclude?: string }
  | { to: 'workspace'; workspaceId: string; exclude?: string }
  | { to: 'client'; clientId: string }

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = '1.0'

/** Heartbeat interval in ms. Server pings every 30s. */
export const HEARTBEAT_INTERVAL_MS = 30_000

/** Client that misses this many pongs gets terminated. */
export const HEARTBEAT_MAX_MISSED = 2

/** Default request timeout in ms. */
export const REQUEST_TIMEOUT_MS = 30_000

// -- Reliable delivery constants --

/** Max events to retain per client in the ring buffer. */
export const EVENT_BUFFER_MAX_SIZE = 500

/** Events older than this are evicted from the buffer. */
export const EVENT_BUFFER_TTL_MS = 30_000

/** How long to retain a disconnected client's buffer for potential reconnect. */
export const DISCONNECTED_CLIENT_TTL_MS = 60_000

/** Client sends a sequence_ack every N ms. */
export const SEQUENCE_ACK_INTERVAL_MS = 5_000
