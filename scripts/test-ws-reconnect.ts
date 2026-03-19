#!/usr/bin/env bun
/**
 * Manual smoke test for WebSocket reliable delivery.
 *
 * Tests the full reconnect/replay flow against a running server:
 *   1. Connect with auth
 *   2. Create a session + send a message (triggers streaming events)
 *   3. Track seq numbers as events arrive
 *   4. Force-kill the WS mid-stream
 *   5. Reconnect with previousClientId + lastSeq
 *   6. Verify replayed events arrive (or stale signal if buffer evicted)
 *
 * Usage:
 *   bun scripts/test-ws-reconnect.ts <host> <port> <token> [--kill-after=N] [--tls]
 *
 * Example:
 *   bun scripts/test-ws-reconnect.ts 113.30.189.1 9000 my-secret-2026-craft --kill-after=5
 *   bun scripts/test-ws-reconnect.ts example.com 443 my-token --kill-after=5 --tls
 */

import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'

// Allow self-signed TLS certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// ─── Config ───────────────────────────────────────────────────────────────────

const [,, host, port, token, ...flags] = process.argv
if (!host || !port || !token) {
  console.error('Usage: bun scripts/test-ws-reconnect.ts <host> <port> <token> [--kill-after=N]')
  process.exit(1)
}

const KILL_AFTER_EVENTS = parseInt(flags.find(f => f.startsWith('--kill-after='))?.split('=')[1] ?? '5', 10)
const useTls = flags.includes('--tls')
const PROTOCOL_VERSION = '1.0'
const url = `${useTls ? 'wss' : 'ws'}://${host}:${port}`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serialize(envelope: Record<string, unknown>): string {
  return JSON.stringify(envelope)
}

function deserialize(raw: string): Record<string, any> {
  return JSON.parse(raw)
}

function log(tag: string, ...args: any[]) {
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[${ts}] [${tag}]`, ...args)
}

function logEvent(seq: number | undefined, channel: string | undefined, type: string) {
  const seqStr = seq !== undefined ? `seq=${seq}` : 'no-seq'
  console.log(`  ← event ${seqStr}  channel=${channel ?? '?'}  eventType=${type}`)
}

// ─── State ────────────────────────────────────────────────────────────────────

let lastSeenSeq = 0
let clientId: string | null = null
let previousClientId: string | null = null
let eventCount = 0
let sessionId: string | null = null
let killed = false
let ws: WebSocket | null = null

// ─── Phase 1: Initial Connect ─────────────────────────────────────────────────

function connect(isReconnect: boolean): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    log('CONN', isReconnect ? `Reconnecting (previousClientId=${previousClientId}, lastSeq=${lastSeenSeq})` : 'Connecting...')

    const socket = new WebSocket(url, { rejectUnauthorized: false })
    ws = socket

    socket.on('open', () => {
      log('CONN', 'WebSocket open, sending handshake...')
      const handshake: Record<string, unknown> = {
        id: randomUUID(),
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        token,
        reconnectClientId: isReconnect ? previousClientId : undefined,
        lastSeq: isReconnect && previousClientId ? lastSeenSeq : undefined,
      }
      socket.send(serialize(handshake))
    })

    socket.on('message', (raw) => {
      const envelope = deserialize(raw.toString())

      if (envelope.type === 'handshake_ack') {
        clientId = envelope.clientId
        log('CONN', `Handshake ACK — clientId=${clientId}`)
        if (envelope.reconnected) {
          log('CONN', `  ✓ Server recognized reconnect! stale=${!!envelope.stale}`)
          if (envelope.stale) {
            log('CONN', '  ⚠ Buffer evicted — would need full refresh')
          }
        } else if (isReconnect) {
          log('CONN', '  ⚠ Server did NOT recognize reconnect (old server or clientId expired)')
        }
        resolve(socket)
        return
      }

      if (envelope.type === 'event') {
        const seq = envelope.seq as number | undefined
        const args = envelope.args as any[] | undefined
        const eventType = args?.[0]?.type ?? '?'
        const evtSessionId = args?.[0]?.sessionId ?? '?'

        if (seq !== undefined) {
          if (lastSeenSeq > 0 && seq > lastSeenSeq + 1) {
            log('GAP', `⚠ SEQUENCE GAP: expected ${lastSeenSeq + 1}, got ${seq} (${seq - lastSeenSeq - 1} events lost)`)
          }
          lastSeenSeq = seq
        }

        eventCount++
        const seqStr = seq !== undefined ? `seq=${seq}` : 'no-seq'
        console.log(`  ← event #${eventCount} ${seqStr}  ch=${envelope.channel}  type=${eventType}  session=${evtSessionId}`)

        // Kill connection after N events to simulate mid-stream drop
        if (!killed && eventCount >= KILL_AFTER_EVENTS) {
          killed = true
          log('KILL', `Reached ${KILL_AFTER_EVENTS} events — force-terminating WebSocket`)
          previousClientId = clientId
          clientId = null
          socket.terminate()
        }
      } else if (envelope.type === 'error') {
        log('ERR', `Server error: ${envelope.error?.message} (${envelope.error?.code})`)
      } else if (envelope.type !== 'handshake_ack' && envelope.type !== 'response') {
        log('MSG', `type=${envelope.type} ${JSON.stringify(envelope).substring(0, 200)}`)
      }
    })

    socket.on('close', (code, reason) => {
      log('CONN', `WebSocket closed (code=${code}, reason=${reason?.toString() || 'none'})`)
      if (killed) {
        // Schedule reconnect
        const delay = 2000
        log('CONN', `Reconnecting in ${delay}ms...`)
        setTimeout(() => {
          runReconnect()
        }, delay)
      }
    })

    socket.on('error', (err) => {
      log('ERR', `WebSocket error: ${err.message}`)
      if (!isReconnect) reject(err)
    })
  })
}

// ─── Phase 2: Trigger streaming ───────────────────────────────────────────────

async function triggerStreaming(socket: WebSocket): Promise<void> {
  // Get workspace first
  log('TEST', 'Getting workspaces...')
  const wsResponse = await rpcInvoke(socket, 'workspaces:get', randomUUID(), [])
  const workspaces = wsResponse?.result as any[] | undefined
  const workspaceId = workspaces?.[0]?.id ?? 'default'
  log('TEST', `Using workspace: ${workspaceId}`)

  // Create a session (args: workspaceId, options?)
  log('TEST', 'Creating session...')
  const createResponse = await rpcInvoke(socket, 'sessions:create', randomUUID(), [workspaceId])

  if (createResponse?.result) {
    sessionId = (createResponse.result as any)?.id ?? null
    log('TEST', `Session created: ${sessionId}`)
  } else {
    // Fall back to existing session
    log('TEST', 'Create returned no result, fetching sessions...')
    const listResponse = await rpcInvoke(socket, 'sessions:get', randomUUID(), [])
    const sessions = listResponse?.result as any[] | undefined
    if (sessions && sessions.length > 0) {
      sessionId = sessions[0].id
      log('TEST', `Using existing session: ${sessionId}`)
    } else {
      log('TEST', '⚠ No sessions available — events may not flow. Waiting anyway...')
      return
    }
  }

  // Send a message to trigger streaming (args: sessionId, message, attachments?)
  log('TEST', `Sending message to session ${sessionId}...`)
  rpcInvoke(socket, 'sessions:sendMessage', randomUUID(), [
    sessionId,
    'Count from 1 to 50 slowly, one number per line.',
    [], // attachments
  ]).then((resp) => {
    log('TEST', `sendMessage response: ${JSON.stringify(resp?.result ?? resp?.error ?? 'ok')}`)
  }).catch((err) => {
    log('ERR', `sendMessage failed: ${err.message}`)
  })

  log('TEST', `Message sent. Watching events (will kill after ${KILL_AFTER_EVENTS})...`)
}

function rpcInvoke(socket: WebSocket, channel: string, id: string, args: unknown[]): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`RPC timeout: ${channel}`))
    }, 15_000)

    const handler = (raw: WebSocket.Data) => {
      const envelope = deserialize(raw.toString())
      if (envelope.type === 'response' && envelope.id === id) {
        clearTimeout(timeout)
        socket.off('message', handler)
        if (envelope.error) {
          reject(new Error(`RPC error: ${envelope.error.message}`))
        } else {
          resolve(envelope)
        }
      }
    }

    socket.on('message', handler)

    const envelope = {
      id,
      type: 'request',
      channel,
      args,
    }
    socket.send(serialize(envelope))
  })
}

// ─── Phase 3: Reconnect and observe ──────────────────────────────────────────

async function runReconnect() {
  const reconnectEventCountBefore = eventCount
  log('RECONNECT', `State: lastSeenSeq=${lastSeenSeq}, previousClientId=${previousClientId}`)

  try {
    const socket = await connect(true)

    // Count events for a few seconds to see replays
    log('RECONNECT', 'Listening for replayed/new events for 10s...')

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        const replayedCount = eventCount - reconnectEventCountBefore
        log('RESULT', '════════════════════════════════════════')
        log('RESULT', `Events received after reconnect: ${replayedCount}`)
        log('RESULT', `Total events seen: ${eventCount}`)
        log('RESULT', `Final seq: ${lastSeenSeq}`)
        log('RESULT', '════════════════════════════════════════')
        resolve()
      }, 10_000)
    })

    // Send a sequence_ack to test that path too
    if (lastSeenSeq > 0) {
      log('TEST', `Sending sequence_ack (lastSeq=${lastSeenSeq})`)
      socket.send(serialize({
        id: randomUUID(),
        type: 'sequence_ack',
        lastSeq: lastSeenSeq,
      }))
    }

    // Clean up
    log('TEST', 'Done. Closing connection.')
    socket.close()
    process.exit(0)
  } catch (err: any) {
    log('ERR', `Reconnect failed: ${err.message}`)
    process.exit(1)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('MAIN', `Target: ${url}`)
  log('MAIN', `Kill after ${KILL_AFTER_EVENTS} events`)
  log('MAIN', '')

  try {
    const socket = await connect(false)
    await triggerStreaming(socket)

    // Keep alive — events flow via the message handler, kill happens there
    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve())
      // Safety timeout — if no events come within 60s, give up
      setTimeout(() => {
        if (!killed) {
          log('TIMEOUT', 'No events received in 60s. Server may not have streaming activity.')
          log('TIMEOUT', 'Try sending a message in the app, or reduce --kill-after')
          process.exit(1)
        }
      }, 60_000)
    })
  } catch (err: any) {
    log('ERR', `Fatal: ${err.message}`)
    process.exit(1)
  }
}

main()
