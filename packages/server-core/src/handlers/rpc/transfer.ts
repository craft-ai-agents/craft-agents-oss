/**
 * Chunked Transfer RPC Handlers
 *
 * Enables large-payload RPC calls (e.g. sessions:import, resources:import)
 * to be split across multiple small WebSocket messages. This works behind
 * proxies and tunnels (Cloudflare, nginx) that have message-size limits.
 *
 * Protocol:
 *   1. transfer:start  → allocate temp dir, return transferId
 *   2. transfer:chunk  → write one chunk to temp file (repeat N times)
 *   3. transfer:commit → reassemble, execute deferred RPC, clean up
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, HandlerFn } from '../../transport/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferState {
  /** Unique transfer ID */
  id: string
  /** Temp directory holding chunk files */
  dir: string
  /** Total expected bytes (for validation) */
  totalBytes: number
  /** Number of expected chunks */
  chunkCount: number
  /** Set of received chunk indices */
  received: Set<number>
  /** The original RPC channel to invoke on commit */
  channel: string
  /** The original RPC args (with a null placeholder for the large arg) */
  args: any[]
  /** Index in args where the reassembled payload goes */
  largeArgIndex: number
  /** Cleanup timer */
  timer: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRANSFER_TTL_MS = 5 * 60 * 1000  // 5 minutes

// ---------------------------------------------------------------------------
// State (module-scoped, shared across all connections)
// ---------------------------------------------------------------------------

const activeTransfers = new Map<string, TransferState>()

function cleanupTransfer(transferId: string): void {
  const transfer = activeTransfers.get(transferId)
  if (!transfer) return

  clearTimeout(transfer.timer)
  activeTransfers.delete(transferId)

  // Remove temp directory
  try {
    if (existsSync(transfer.dir)) {
      rmSync(transfer.dir, { recursive: true, force: true })
    }
  } catch {
    // Best effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

/**
 * Map of channel → handler that the transfer system can delegate to on commit.
 * Populated by calling `setTransferableHandler()` for each channel that supports
 * chunked transfer (e.g. 'sessions:import', 'resources:import').
 */
const transferableHandlers = new Map<string, HandlerFn>()

/**
 * Register a handler that can be invoked via chunked transfer.
 * Call this alongside the normal `server.handle()` registration.
 */
export function setTransferableHandler(channel: string, handler: HandlerFn): void {
  transferableHandlers.set(channel, handler)
}

export function registerTransferHandlers(server: RpcServer): void {
  // ── transfer:start ──
  server.handle(RPC_CHANNELS.transfer.START, async (_ctx, opts: {
    totalBytes: number
    chunkCount: number
    channel: string
    args: any[]
    largeArgIndex: number
  }) => {
    if (!opts || typeof opts.chunkCount !== 'number' || opts.chunkCount < 1) {
      throw new Error('Invalid chunkCount')
    }
    if (!opts.channel || typeof opts.channel !== 'string') {
      throw new Error('Missing target channel')
    }
    if (!transferableHandlers.has(opts.channel)) {
      throw new Error(`Channel ${opts.channel} does not support chunked transfer`)
    }
    if (typeof opts.largeArgIndex !== 'number') {
      throw new Error('Missing largeArgIndex')
    }

    const transferId = randomUUID()
    const dir = join(tmpdir(), `craft-transfer-${transferId}`)
    mkdirSync(dir, { recursive: true })

    const timer = setTimeout(() => {
      console.warn(`[Transfer:server] TTL expired for transfer ${transferId} — cleaning up`)
      cleanupTransfer(transferId)
    }, TRANSFER_TTL_MS)

    activeTransfers.set(transferId, {
      id: transferId,
      dir,
      totalBytes: opts.totalBytes,
      chunkCount: opts.chunkCount,
      received: new Set(),
      channel: opts.channel,
      args: opts.args,
      largeArgIndex: opts.largeArgIndex,
      timer,
    })

    const totalMB = (opts.totalBytes / (1024 * 1024)).toFixed(1)
    console.log(`[Transfer:server] Started transfer ${transferId}: ${opts.chunkCount} chunks, ${totalMB}MB, channel: ${opts.channel}`)

    return { transferId }
  })

  // ── transfer:chunk ──
  server.handle(RPC_CHANNELS.transfer.CHUNK, async (_ctx, opts: {
    transferId: string
    index: number
    data: string
  }) => {
    const transfer = activeTransfers.get(opts.transferId)
    if (!transfer) {
      console.error(`[Transfer:server] Unknown transfer: ${opts.transferId}`)
      throw new Error(`Unknown transfer: ${opts.transferId}`)
    }
    if (typeof opts.index !== 'number' || opts.index < 0 || opts.index >= transfer.chunkCount) {
      throw new Error(`Invalid chunk index: ${opts.index}`)
    }
    if (typeof opts.data !== 'string') {
      throw new Error('Missing chunk data')
    }

    // Write chunk to temp file
    const chunkPath = join(transfer.dir, `chunk-${String(opts.index).padStart(6, '0')}`)
    writeFileSync(chunkPath, opts.data, 'utf-8')
    transfer.received.add(opts.index)

    if ((opts.index + 1) % 10 === 0 || opts.index === transfer.chunkCount - 1) {
      console.log(`[Transfer:server] Received chunk ${opts.index + 1}/${transfer.chunkCount} for ${transfer.id.slice(0, 8)}`)
    }

    return { received: opts.index }
  })

  // ── transfer:commit ──
  server.handle(RPC_CHANNELS.transfer.COMMIT, async (ctx, opts: {
    transferId: string
  }) => {
    const transfer = activeTransfers.get(opts.transferId)
    if (!transfer) {
      console.error(`[Transfer:server] Commit failed — unknown transfer: ${opts.transferId}`)
      throw new Error(`Unknown transfer: ${opts.transferId}`)
    }

    console.log(`[Transfer:server] Committing transfer ${transfer.id.slice(0, 8)}: ${transfer.received.size}/${transfer.chunkCount} chunks received`)

    // Validate all chunks received
    if (transfer.received.size !== transfer.chunkCount) {
      const missing = []
      for (let i = 0; i < transfer.chunkCount; i++) {
        if (!transfer.received.has(i)) missing.push(i)
      }
      throw new Error(`Missing ${missing.length} chunk(s): [${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}]`)
    }

    // Reassemble chunks into the original payload
    const parts: string[] = []
    for (let i = 0; i < transfer.chunkCount; i++) {
      const chunkPath = join(transfer.dir, `chunk-${String(i).padStart(6, '0')}`)
      parts.push(readFileSync(chunkPath, 'utf-8'))
    }
    const concatenated = parts.join('')

    // Decode: chunks are base64-encoded raw bytes of the JSON payload
    const jsonString = Buffer.from(concatenated, 'base64').toString('utf-8')
    let payload: any
    try {
      payload = JSON.parse(jsonString)
    } catch {
      cleanupTransfer(transfer.id)
      throw new Error('Failed to parse reassembled payload')
    }

    // Execute the deferred RPC handler
    const handler = transferableHandlers.get(transfer.channel)
    if (!handler) {
      cleanupTransfer(transfer.id)
      throw new Error(`No handler for channel: ${transfer.channel}`)
    }

    const reassembledMB = (jsonString.length / (1024 * 1024)).toFixed(1)
    console.log(`[Transfer:server] Reassembled ${reassembledMB}MB payload for ${transfer.channel} — executing handler`)

    // Reconstruct the original args with the reassembled payload
    const args = [...transfer.args]
    args[transfer.largeArgIndex] = payload

    // Clean up temp files before executing (we have the payload in memory now)
    cleanupTransfer(transfer.id)

    // Execute with the original request context
    try {
      const result = await handler(ctx, ...args)
      console.log(`[Transfer:server] Handler ${transfer.channel} completed successfully`)
      return result
    } catch (err) {
      console.error(`[Transfer:server] Handler ${transfer.channel} failed:`, err)
      throw err
    }
  })
}
