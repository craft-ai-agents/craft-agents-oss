/**
 * Chunked RPC — send large payloads over WebSocket in small pieces.
 *
 * Splits a single large RPC argument into base64 chunks (~2.7MB each),
 * sends them via the transfer:start/chunk/commit protocol, and the
 * remote server reassembles and executes the original RPC handler.
 *
 * Each chunk is retried up to 3 times on failure to handle transient
 * connection issues through proxies/tunnels.
 */

import type { WsRpcClient } from '../transport/client'

/**
 * 2MB raw → ~2.7MB after base64 encoding.
 * Larger chunks = fewer round trips (a 250MB payload = ~125 chunks instead of 651).
 * Still well under Cloudflare's per-message limits.
 */
const CHUNK_SIZE = 2 * 1024 * 1024

/** Threshold above which we switch from direct RPC to chunked transfer. */
export const CHUNKED_TRANSFER_THRESHOLD = 5 * 1024 * 1024  // 5MB

/** Max retries per chunk before giving up. */
const MAX_CHUNK_RETRIES = 3

/** Delay between chunk retries (ms). */
const CHUNK_RETRY_DELAY = 1000

/**
 * Send a large RPC call in chunks over the existing WebSocket connection.
 *
 * @param client      Connected WsRpcClient to the remote server
 * @param channel     The original RPC channel (e.g. 'sessions:import')
 * @param args        The original arguments array
 * @param largeArgIndex  Which argument is the large payload (will be chunked)
 * @returns           The result from the remote handler (same as a direct invoke)
 */
export async function invokeChunked(
  client: WsRpcClient,
  channel: string,
  args: any[],
  largeArgIndex: number,
): Promise<any> {
  // 1. Serialize the large argument to JSON, then to raw bytes
  const json = JSON.stringify(args[largeArgIndex])
  const bytes = Buffer.from(json, 'utf-8')

  // 2. Split into base64 chunks
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(bytes.subarray(i, i + CHUNK_SIZE).toString('base64'))
  }

  // 3. Build deferred args (replace large arg with null placeholder)
  const deferredArgs = [...args]
  deferredArgs[largeArgIndex] = null

  // 4. Start transfer
  const payloadMB = (bytes.length / (1024 * 1024)).toFixed(1)
  console.log(`[ChunkedRPC] Starting transfer: ${chunks.length} chunks, ${payloadMB}MB, channel: ${channel}`)
  const { transferId } = await client.invoke('transfer:start', {
    totalBytes: bytes.length,
    chunkCount: chunks.length,
    channel,
    args: deferredArgs,
    largeArgIndex,
  }) as { transferId: string }
  console.log(`[ChunkedRPC] Transfer started: ${transferId}`)

  // 5. Send chunks sequentially with retry
  for (let i = 0; i < chunks.length; i++) {
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      try {
        await client.invoke('transfer:chunk', {
          transferId,
          index: i,
          data: chunks[i],
        })
        lastError = null
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < MAX_CHUNK_RETRIES) {
          console.warn(`[ChunkedRPC] Chunk ${i + 1}/${chunks.length} failed (attempt ${attempt}/${MAX_CHUNK_RETRIES}): ${lastError.message}. Retrying in ${CHUNK_RETRY_DELAY}ms...`)
          await new Promise(r => setTimeout(r, CHUNK_RETRY_DELAY))
        }
      }
    }
    if (lastError) {
      throw new Error(`Chunk ${i + 1}/${chunks.length} failed after ${MAX_CHUNK_RETRIES} attempts: ${lastError.message}`)
    }

    if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
      console.log(`[ChunkedRPC] Sent chunk ${i + 1}/${chunks.length}`)
    }
  }

  // 6. Commit — returns the result of the original RPC call
  console.log(`[ChunkedRPC] All chunks sent, committing...`)
  const result = await client.invoke('transfer:commit', { transferId })
  console.log(`[ChunkedRPC] Transfer committed successfully`)
  return result
}
