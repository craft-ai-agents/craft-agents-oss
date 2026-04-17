/**
 * WhatsAppAdapter — out-of-process adapter that spawns the
 * `@craft-agent/messaging-whatsapp-worker` subprocess.
 *
 * WhatsApp has no official bot API usable by us. Baileys reimplements the
 * WA multi-device protocol — it runs in a child process so that:
 *   (a) a Baileys crash/segfault can't take down the Electron main process,
 *   (b) Baileys can run under Node even when the host runtime is Bun,
 *   (c) memory isolation: auth state, signal ratchets, etc.
 *
 * The worker contract is defined in @craft-agent/messaging-whatsapp-worker.
 * This adapter owns the process lifecycle + translates events to the
 * PlatformAdapter interface.
 *
 * Unofficial API disclaimer: Baileys is not endorsed by WhatsApp/Meta and
 * may stop working at any time. Account bans are possible.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import {
  encodeMessage,
  parseFrames,
  type WorkerCommand,
  type WorkerEvent,
} from '@craft-agent/messaging-whatsapp-worker'
import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterCapabilities,
  IncomingMessage,
  SentMessage,
  InlineButton,
  ButtonPress,
} from '../../types'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WhatsAppConfig extends PlatformConfig {
  /** Directory Baileys persists multi-file auth state into. Required. */
  authStateDir: string
  /** Absolute path to the worker entry script. Required. */
  workerEntry: string
  /** Node binary path. Defaults to 'node'. */
  nodeBin?: string
  /** Pairing flow: 'qr' (default) or 'code' (phone-number based 8-char code). */
  pairingMode?: 'qr' | 'code'
}

// ---------------------------------------------------------------------------
// Event bus (adapter-level, surfaced via registry)
// ---------------------------------------------------------------------------

export type WhatsAppEvent =
  | { type: 'qr'; qr: string }
  | { type: 'pairing_code'; code: string }
  | { type: 'connected'; jid?: string; name?: string }
  | { type: 'disconnected'; loggedOut: boolean; reason?: string }
  | { type: 'unavailable'; reason: string; message: string }
  | { type: 'error'; message: string }

type EventHandler = (event: WhatsAppEvent) => void

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class WhatsAppAdapter implements PlatformAdapter {
  readonly platform = 'whatsapp' as const
  readonly capabilities: AdapterCapabilities = {
    messageEditing: false,
    inlineButtons: false,
    maxButtons: 0,
    maxMessageLength: 4096,
    markdown: 'whatsapp',
    webhookSupport: false,
  }

  private proc: ChildProcess | null = null
  private stdoutBuffer = ''
  private connected = false
  private started = false
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  // `buttonHandler` is retained to satisfy PlatformAdapter; WhatsApp has no
  // inline buttons in this adapter, but the interface is shared with Telegram.
  private buttonHandler: ((press: ButtonPress) => Promise<void>) | null = null
  private eventHandlers = new Set<EventHandler>()
  private pending = new Map<string, (r: { ok: boolean; messageId?: string; error?: string }) => void>()
  private nextCmdId = 1

  async initialize(config: PlatformConfig): Promise<void> {
    const cfg = config as WhatsAppConfig
    if (!cfg.workerEntry) throw new Error('WhatsApp: workerEntry path is required')
    if (!cfg.authStateDir) throw new Error('WhatsApp: authStateDir is required')

    if (this.proc) {
      throw new Error('WhatsApp adapter already initialized')
    }

    // Always use Node to run the worker — Baileys and its native-ish deps
    // (noise-handler, libsignal) target Node. Ship it through whatever
    // `nodeBin` resolves to (Electron's embedded node in packaged builds).
    const nodeBin = cfg.nodeBin ?? process.execPath
    this.proc = spawn(nodeBin, [cfg.workerEntry], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })

    this.proc.stdout?.setEncoding('utf8')
    this.proc.stdout?.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk
      const { messages, rest } = parseFrames<WorkerEvent>(this.stdoutBuffer)
      this.stdoutBuffer = rest
      for (const ev of messages) this.onWorkerEvent(ev)
    })

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      // Forward to main-process console so logs are visible in electron terminal.
      // Intentionally not routed through `emit` — stderr is free-form.
      const lines = chunk.toString('utf8').split('\n').filter(Boolean)
      for (const line of lines) console.error('[wa-worker]', line)
    })

    this.proc.on('exit', (code) => {
      this.connected = false
      this.started = false
      this.proc = null
      if (code !== 0) {
        this.fireEvent({
          type: 'error',
          message: `Worker exited with code ${code ?? 'null'}`,
        })
      }
    })

    const startCmd: WorkerCommand = {
      type: 'start',
      authStateDir: cfg.authStateDir,
      pairingMode: cfg.pairingMode ?? 'qr',
    }
    this.sendCommand(startCmd)
    this.started = true
  }

  async destroy(): Promise<void> {
    if (!this.proc) return
    try {
      this.sendCommand({ type: 'shutdown' })
    } catch {
      // ignore — process may already be exiting
    }
    // Grace period then kill.
    const proc = this.proc
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          // ignore
        }
        resolve()
      }, 2000)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.proc = null
    this.started = false
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  onButtonPress(handler: (press: ButtonPress) => Promise<void>): void {
    this.buttonHandler = handler
  }

  /** Subscribe to adapter-level events (QR, pairing code, unavailable, errors). */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  /** Submit a phone number to obtain an 8-char pairing code (pairingMode=code). */
  async requestPairingCode(phoneNumber: string): Promise<void> {
    if (!this.started) throw new Error('WhatsApp adapter not started')
    this.sendCommand({ type: 'submit_pairing_phone', phoneNumber })
  }

  async sendText(channelId: string, text: string): Promise<SentMessage> {
    const id = String(this.nextCmdId++)
    const result = await this.sendWithResult({ id, type: 'send_text', channelId, text })
    if (!result.ok) throw new Error(result.error ?? 'Send failed')
    return {
      platform: 'whatsapp',
      channelId,
      messageId: result.messageId ?? id,
    }
  }

  async editMessage(_channelId: string, _messageId: string, _text: string): Promise<void> {
    // WhatsApp does support message editing (introduced 2023), but Baileys
    // coverage varies. For now, fall back to sending a new message upstream.
    throw new Error('WhatsApp edit not supported in this adapter')
  }

  async sendButtons(
    channelId: string,
    text: string,
    buttons: InlineButton[],
  ): Promise<SentMessage> {
    // No inline buttons — degrade to numbered list in the text.
    const numbered = buttons
      .map((b, i) => `${i + 1}. ${b.label}`)
      .join('\n')
    const combined = numbered ? `${text}\n\n${numbered}` : text
    return this.sendText(channelId, combined)
  }

  async sendTyping(_channelId: string): Promise<void> {
    // No-op — omitting "typing" presence updates avoids an extra round-trip
    // through the worker; UX remains acceptable without it.
  }

  async sendFile(
    channelId: string,
    file: Buffer,
    filename: string,
    caption?: string,
  ): Promise<SentMessage> {
    const id = String(this.nextCmdId++)
    const result = await this.sendWithResult({
      id,
      type: 'send_file',
      channelId,
      dataBase64: file.toString('base64'),
      filename,
      caption,
    })
    if (!result.ok) throw new Error(result.error ?? 'Send failed')
    return {
      platform: 'whatsapp',
      channelId,
      messageId: result.messageId ?? id,
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private sendCommand(cmd: WorkerCommand): void {
    if (!this.proc || !this.proc.stdin?.writable) {
      throw new Error('WhatsApp worker is not running')
    }
    this.proc.stdin.write(encodeMessage(cmd))
  }

  private sendWithResult(
    cmd: Extract<WorkerCommand, { id: string }>,
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    return new Promise((resolve) => {
      this.pending.set(cmd.id, resolve)
      try {
        this.sendCommand(cmd)
      } catch (err) {
        this.pending.delete(cmd.id)
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  }

  private fireEvent(event: WhatsAppEvent): void {
    for (const h of this.eventHandlers) {
      try {
        h(event)
      } catch {
        // isolate handler errors
      }
    }
  }

  private onWorkerEvent(ev: WorkerEvent): void {
    switch (ev.type) {
      case 'ready':
        // Nothing to do — waiting for 'qr' or 'connected'.
        return
      case 'qr':
        this.fireEvent({ type: 'qr', qr: ev.qr })
        return
      case 'pairing_code':
        this.fireEvent({ type: 'pairing_code', code: ev.code })
        return
      case 'connected':
        this.connected = true
        this.fireEvent({ type: 'connected', jid: ev.jid, name: ev.name })
        return
      case 'disconnected':
        this.connected = false
        this.fireEvent({ type: 'disconnected', loggedOut: ev.loggedOut, reason: ev.reason })
        return
      case 'incoming':
        if (this.messageHandler) {
          const msg: IncomingMessage = {
            platform: 'whatsapp',
            channelId: ev.channelId,
            messageId: ev.messageId,
            senderId: ev.senderId,
            senderName: ev.senderName,
            text: ev.text,
            timestamp: ev.timestamp,
            raw: ev,
          }
          void this.messageHandler(msg)
        }
        return
      case 'send_result': {
        const resolver = this.pending.get(ev.id)
        if (resolver) {
          this.pending.delete(ev.id)
          resolver({ ok: ev.ok, messageId: ev.messageId, error: ev.error })
        }
        return
      }
      case 'error':
        this.fireEvent({ type: 'error', message: ev.message })
        return
      case 'unavailable':
        this.fireEvent({ type: 'unavailable', reason: ev.reason, message: ev.message })
        return
    }
  }
}
