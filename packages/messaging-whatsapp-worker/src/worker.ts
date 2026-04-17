/**
 * WhatsApp worker subprocess entry.
 *
 * Owns all Baileys state. Communicates with the main process over
 * newline-delimited JSON on stdin/stdout (see protocol.ts).
 *
 * Baileys is bundled into worker.cjs by esbuild at build time, so the
 * dynamic import below always resolves. The try/catch stays as a runtime
 * safety net — e.g. if a future Baileys version throws during module init
 * on an unsupported Node runtime we want a clean `unavailable` event
 * instead of a subprocess crash.
 *
 * Runs under Node (not Bun) when packaged with Electron so Baileys'
 * crypto deps (libsignal, curve25519) resolve correctly.
 */

import { mkdirSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import {
  encodeMessage,
  parseFrames,
  type WorkerCommand,
  type WorkerEvent,
} from './protocol'

// ---------------------------------------------------------------------------
// Send helpers
// ---------------------------------------------------------------------------

function emit(event: WorkerEvent): void {
  process.stdout.write(encodeMessage(event))
}

function log(...args: unknown[]): void {
  // stderr is reserved for logs so the main process parser doesn't confuse them.
  process.stderr.write('[wa-worker] ' + args.map(String).join(' ') + '\n')
}

// ---------------------------------------------------------------------------
// Silent logger for Baileys
//
// Baileys uses pino and by default writes to stdout — which collides with our
// NDJSON protocol. This no-op logger implements the subset of the pino API
// that Baileys actually calls, keeping the protocol stream clean.
// ---------------------------------------------------------------------------

interface SilentLogger {
  level: string
  fatal: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  trace: (...args: unknown[]) => void
  child: () => SilentLogger
}

const silentLogger: SilentLogger = {
  level: 'silent',
  fatal: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  child: () => silentLogger,
}

// ---------------------------------------------------------------------------
// Baileys lifecycle (isolated — only referenced after dynamic import succeeds)
// ---------------------------------------------------------------------------

interface BaileysModule {
  /**
   * Factory exported as both `default` and `makeWASocket`. We prefer the
   * named export because CJS→ESM interop via esbuild's `await import()` does
   * not always expose `.default` as the callable function.
   */
  default?: (config: unknown) => unknown
  makeWASocket: (config: unknown) => unknown
  useMultiFileAuthState: (dir: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>
  DisconnectReason: Record<string, number>
  Browsers: { macOS: (name: string) => [string, string, string] }
  fetchLatestBaileysVersion: () => Promise<{ version: number[]; isLatest: boolean }>
}

type BaileysSock = {
  ev: {
    on(event: 'creds.update', fn: () => void): void
    on(event: 'connection.update', fn: (u: Record<string, unknown>) => void): void
    on(event: 'messages.upsert', fn: (u: { messages: unknown[]; type: string }) => void): void
  }
  user?: { id?: string; name?: string }
  requestPairingCode(phoneNumber: string): Promise<string>
  sendMessage(jid: string, content: unknown): Promise<{ key?: { id?: string } } | undefined>
  logout(): Promise<void>
  end(err?: Error): void
}

interface SessionState {
  baileys: BaileysModule
  sock: BaileysSock
  saveCreds: () => Promise<void>
  pairingMode: 'qr' | 'code'
  authStateDir: string
}

let session: SessionState | null = null

async function loadBaileys(): Promise<BaileysModule | null> {
  try {
    // Baileys is bundled into worker.cjs at build time; the dynamic form
    // keeps this site isolated behind a try/catch for runtime init failures.
    const mod = (await import('@whiskeysockets/baileys')) as unknown as BaileysModule
    return mod
  } catch (err) {
    log('baileys load failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

async function startSession(authStateDir: string, pairingMode: 'qr' | 'code'): Promise<void> {
  if (session) {
    emit({ type: 'error', message: 'Session already started' })
    return
  }
  const baileys = await loadBaileys()
  if (!baileys) {
    emit({
      type: 'unavailable',
      reason: 'baileys_load_failed',
      message: 'WhatsApp library failed to initialize. Check the logs for details.',
    })
    process.exit(0)
  }

  try {
    mkdirSync(authStateDir, { recursive: true })
  } catch (err) {
    emit({
      type: 'unavailable',
      reason: 'auth_state_error',
      message: `Cannot create auth state dir: ${err instanceof Error ? err.message : String(err)}`,
    })
    process.exit(0)
  }

  const { state, saveCreds } = await baileys.useMultiFileAuthState(authStateDir)
  const { version } = await baileys.fetchLatestBaileysVersion().catch(() => ({ version: undefined }))

  emit({ type: 'ready', baileysVersion: version?.join('.') })

  const makeWASocket = baileys.makeWASocket ?? baileys.default
  if (typeof makeWASocket !== 'function') {
    emit({
      type: 'unavailable',
      reason: 'baileys_load_failed',
      message: 'Baileys export shape unexpected: makeWASocket not callable',
    })
    process.exit(0)
  }
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: baileys.Browsers.macOS('Craft Agent'),
    version,
    logger: silentLogger,
  }) as BaileysSock

  sock.ev.on('creds.update', () => void saveCreds())

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u as {
      connection?: string
      lastDisconnect?: { error?: { output?: { statusCode?: number } } }
      qr?: string
    }
    if (qr && pairingMode === 'qr') {
      emit({ type: 'qr', qr })
    }
    if (connection === 'open') {
      emit({ type: 'connected', jid: sock.user?.id, name: sock.user?.name })
    } else if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut = statusCode === baileys.DisconnectReason.loggedOut
      emit({
        type: 'disconnected',
        loggedOut,
        reason: loggedOut ? 'Logged out' : `statusCode=${statusCode ?? 'unknown'}`,
      })
      if (loggedOut) {
        session = null
        process.exit(0)
      }
    }
  })

  sock.ev.on('messages.upsert', (upsert) => {
    if (upsert.type !== 'notify') return
    for (const msg of upsert.messages as Array<Record<string, unknown>>) {
      const key = msg.key as { remoteJid?: string; fromMe?: boolean; id?: string } | undefined
      if (!key || key.fromMe || !key.remoteJid || !key.id) continue
      const m = msg.message as Record<string, unknown> | undefined
      const text =
        (m?.conversation as string | undefined) ??
        ((m?.extendedTextMessage as Record<string, unknown> | undefined)?.text as string | undefined) ??
        ''
      if (!text) continue
      emit({
        type: 'incoming',
        channelId: key.remoteJid,
        messageId: key.id,
        senderId: key.remoteJid,
        senderName: (msg.pushName as string | undefined) ?? undefined,
        text,
        timestamp: Number(msg.messageTimestamp) * 1000 || Date.now(),
      })
    }
  })

  session = { baileys, sock, saveCreds, pairingMode, authStateDir }
}

async function handleCommand(cmd: WorkerCommand): Promise<void> {
  switch (cmd.type) {
    case 'start': {
      await startSession(cmd.authStateDir, cmd.pairingMode ?? 'code').catch((err) => {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      })
      return
    }
    case 'submit_pairing_phone': {
      if (!session) {
        emit({ type: 'error', message: 'Not started' })
        return
      }
      try {
        const code = await session.sock.requestPairingCode(cmd.phoneNumber)
        emit({ type: 'pairing_code', code })
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      }
      return
    }
    case 'send_text': {
      if (!session) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: 'Not connected' })
        return
      }
      try {
        const res = await session.sock.sendMessage(cmd.channelId, { text: cmd.text })
        emit({ type: 'send_result', id: cmd.id, ok: true, messageId: res?.key?.id })
      } catch (err) {
        emit({
          type: 'send_result',
          id: cmd.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }
    case 'send_file': {
      if (!session) {
        emit({ type: 'send_result', id: cmd.id, ok: false, error: 'Not connected' })
        return
      }
      try {
        const buf = Buffer.from(cmd.dataBase64, 'base64')
        const res = await session.sock.sendMessage(cmd.channelId, {
          document: buf,
          fileName: cmd.filename,
          mimetype: cmd.mimeType ?? 'application/octet-stream',
          caption: cmd.caption,
        })
        emit({ type: 'send_result', id: cmd.id, ok: true, messageId: res?.key?.id })
      } catch (err) {
        emit({
          type: 'send_result',
          id: cmd.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }
    case 'shutdown': {
      if (session) {
        try {
          session.sock.end()
        } catch {
          // ignore
        }
        session = null
      }
      process.exit(0)
      return
    }
  }
}

// ---------------------------------------------------------------------------
// stdin reader
// ---------------------------------------------------------------------------

let stdinBuffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk
  const { messages, rest } = parseFrames<WorkerCommand>(stdinBuffer)
  stdinBuffer = rest
  for (const msg of messages) {
    void handleCommand(msg)
  }
})

process.stdin.on('end', () => {
  if (session) {
    try {
      session.sock.end()
    } catch {
      // ignore
    }
  }
  process.exit(0)
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
