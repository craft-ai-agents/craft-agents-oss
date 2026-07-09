/**
 * DiscordAdapter — out-of-process adapter that spawns the
 * `@craft-agent/messaging-discord-worker` subprocess.
 *
 * Discord has an official Bot API (discord.js), but we still run it in a
 * child process, mirroring the WhatsApp adapter, so that:
 *   (a) a discord.js crash can't take down the Electron main process,
 *   (b) discord.js runs under Node even when the host runtime is Bun,
 *   (c) memory isolation for the gateway WebSocket + caches.
 *
 * The worker contract is defined in @craft-agent/messaging-discord-worker.
 * This adapter owns the process lifecycle + translates events to the
 * PlatformAdapter interface. Unlike WhatsApp, Discord supports message
 * editing and inline buttons, so those methods are real (not no-ops).
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import {
  encodeMessage,
  parseFrames,
  type WorkerCommand,
  type WorkerEvent,
} from '@craft-agent/messaging-discord-worker'
import type {
  PlatformAdapter,
  PlatformConfig,
  AdapterCapabilities,
  IncomingMessage,
  IncomingAttachment,
  SendOptions,
  SentMessage,
  InlineButton,
  ButtonPress,
  MessagingLogger,
} from '../../types'
import { formatForDiscord } from './format'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

/**
 * Hard ceiling for send/edit awaits. If the worker wedges between command
 * dispatch and `send_result` we surface a real error instead of hanging the
 * renderer indefinitely. Tests pass a much smaller value.
 */
const DEFAULT_SEND_TIMEOUT_MS = 30_000

type PendingEntry = {
  resolve: (r: { ok: boolean; messageId?: string; error?: string }) => void
  timer: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface DiscordConfig extends PlatformConfig {
  /** Discord bot token. Required. */
  token: string
  /** Absolute path to the worker entry script. Required. */
  workerEntry: string
  /** Node binary path. Defaults to process.execPath. */
  nodeBin?: string
  /** Override the default per-send timeout (30s). Used by tests. */
  sendTimeoutMs?: number
}

// ---------------------------------------------------------------------------
// Credentials (persisted as JSON in the messaging_bearer credential row)
// ---------------------------------------------------------------------------

export interface DiscordCredentials {
  token: string
}

/**
 * Parse the JSON credential blob stored for a Discord bot. Throws when the
 * shape is wrong so the registry can surface a clear error.
 */
export function parseDiscordCredentials(raw: string): DiscordCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Discord credentials are not valid JSON')
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { token?: unknown }).token !== 'string' ||
    (parsed as { token: string }).token.length === 0
  ) {
    throw new Error('Discord credentials must include a non-empty "token"')
  }
  return { token: (parsed as { token: string }).token }
}

// ---------------------------------------------------------------------------
// Event bus (adapter-level, surfaced via registry)
// ---------------------------------------------------------------------------

export type DiscordEvent =
  | { type: 'connected'; botId: string; username: string }
  | { type: 'disconnected'; loggedOut: boolean; reason?: string }
  | { type: 'unavailable'; reason: string; message: string }
  | { type: 'error'; message: string }

type EventHandler = (event: DiscordEvent) => void

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = 'discord' as const
  readonly capabilities: AdapterCapabilities = {
    messageEditing: true,
    inlineButtons: true,
    maxButtons: 5,
    maxMessageLength: 2000,
    markdown: 'discord',
    webhookSupport: false,
  }

  private proc: ChildProcess | null = null
  private stdoutBuffer = ''
  private connected = false
  private started = false
  private log: MessagingLogger = NOOP_LOGGER
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private buttonHandler: ((press: ButtonPress) => Promise<void>) | null = null
  private eventHandlers = new Set<EventHandler>()
  private pending = new Map<string, PendingEntry>()
  private nextCmdId = 1
  private sendTimeoutMs = DEFAULT_SEND_TIMEOUT_MS

  async initialize(config: PlatformConfig): Promise<void> {
    const cfg = config as DiscordConfig
    if (!cfg.workerEntry) throw new Error('Discord: workerEntry path is required')
    if (!cfg.token) throw new Error('Discord: token is required')

    if (this.proc) {
      throw new Error('Discord adapter already initialized')
    }

    this.log = (cfg.logger ?? NOOP_LOGGER).child({
      component: 'discord-adapter',
      platform: 'discord',
    })

    if (cfg.sendTimeoutMs !== undefined && cfg.sendTimeoutMs > 0) {
      this.sendTimeoutMs = cfg.sendTimeoutMs
    }

    const nodeBin = cfg.nodeBin ?? process.execPath
    this.log.info('starting Discord worker', {
      event: 'discord_worker_starting',
      workerEntry: cfg.workerEntry,
      nodeBin,
    })

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
      const lines = chunk.toString('utf8').split('\n').filter(Boolean)
      for (const line of lines) {
        this.log.warn('Discord worker stderr', {
          event: 'discord_worker_stderr',
          line,
        })
      }
    })

    this.proc.on('exit', (code, signal) => {
      this.connected = false
      this.started = false
      this.proc = null
      this.drainPending(
        `worker exited with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`,
      )
      this.log.warn('Discord worker exited', {
        event: 'discord_worker_exited',
        code,
        signal,
      })
      if (code !== 0) {
        this.fireEvent({
          type: 'error',
          message: `Worker exited with code ${code ?? 'null'}`,
        })
      }
    })

    const startCmd: WorkerCommand = { type: 'start', token: cfg.token }
    this.sendCommand(startCmd)
    this.started = true
  }

  async destroy(): Promise<void> {
    if (!this.proc) return
    this.log.info('shutting down Discord worker', { event: 'discord_worker_shutdown' })
    try {
      this.sendCommand({ type: 'shutdown' })
    } catch (err) {
      this.log.warn('failed to send shutdown to Discord worker', {
        event: 'discord_worker_shutdown_signal_failed',
        error: err,
      })
    }
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
    this.drainPending('adapter destroyed')
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

  /** Subscribe to adapter-level events (connected, unavailable, errors). */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  async sendText(channelId: string, text: string, _opts?: SendOptions): Promise<SentMessage> {
    const id = String(this.nextCmdId++)
    const result = await this.sendWithResult({
      id,
      type: 'send_text',
      channelId,
      text: formatForDiscord(text),
    })
    if (!result.ok) throw new Error(result.error ?? 'Send failed')
    return { platform: 'discord', channelId, messageId: result.messageId ?? id }
  }

  async editMessage(
    channelId: string,
    messageId: string,
    text: string,
    _opts?: SendOptions,
  ): Promise<void> {
    const id = String(this.nextCmdId++)
    const result = await this.sendWithResult({
      id,
      type: 'edit_message',
      channelId,
      messageId,
      text: formatForDiscord(text),
    })
    if (!result.ok) throw new Error(result.error ?? 'Edit failed')
  }

  async sendButtons(
    channelId: string,
    text: string,
    buttons: InlineButton[],
    _opts?: SendOptions,
  ): Promise<SentMessage> {
    const id = String(this.nextCmdId++)
    const result = await this.sendWithResult({
      id,
      type: 'send_buttons',
      channelId,
      text: formatForDiscord(text),
      buttons: buttons.map((b) => ({ id: b.id, label: b.label, data: b.data })),
    })
    if (!result.ok) throw new Error(result.error ?? 'Send failed')
    return { platform: 'discord', channelId, messageId: result.messageId ?? id }
  }

  async clearButtons(channelId: string, messageId: string, _opts?: SendOptions): Promise<void> {
    const id = String(this.nextCmdId++)
    // Best-effort — swallow errors (message may be deleted / uneditable).
    await this.sendWithResult({ id, type: 'clear_buttons', channelId, messageId })
  }

  async sendTyping(channelId: string, _opts?: SendOptions): Promise<void> {
    try {
      this.sendCommand({ type: 'send_typing', channelId })
    } catch {
      // Non-fatal — typing indicators are cosmetic.
    }
  }

  async sendFile(
    channelId: string,
    file: Buffer,
    filename: string,
    caption?: string,
    _opts?: SendOptions,
  ): Promise<SentMessage> {
    const id = String(this.nextCmdId++)
    const result = await this.sendWithResult({
      id,
      type: 'send_file',
      channelId,
      dataBase64: file.toString('base64'),
      filename,
      caption: caption !== undefined ? formatForDiscord(caption) : undefined,
    })
    if (!result.ok) throw new Error(result.error ?? 'Send failed')
    return { platform: 'discord', channelId, messageId: result.messageId ?? id }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private sendCommand(cmd: WorkerCommand): void {
    if (!this.proc || !this.proc.stdin?.writable) {
      throw new Error('Discord worker is not running')
    }
    this.proc.stdin.write(encodeMessage(cmd))
  }

  private sendWithResult(
    cmd: Extract<WorkerCommand, { id: string }>,
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(cmd.id)) {
          this.log.warn('Discord send timed out', {
            event: 'discord_send_timeout',
            commandId: cmd.id,
            commandType: cmd.type,
            timeoutMs: this.sendTimeoutMs,
          })
          resolve({ ok: false, error: `send timed out after ${this.sendTimeoutMs}ms` })
        }
      }, this.sendTimeoutMs)
      this.pending.set(cmd.id, { resolve, timer })
      try {
        this.sendCommand(cmd)
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(cmd.id)
        this.log.error('failed to send command to Discord worker', {
          event: 'discord_worker_command_failed',
          commandType: cmd.type,
          error: err,
        })
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  }

  /**
   * Resolve all pending sends with a failure. Called from `proc.on('exit')`
   * and from `destroy()` so callers never hang waiting for a dead worker.
   */
  private drainPending(reason: string): void {
    if (this.pending.size === 0) return
    this.log.warn('draining pending Discord sends', {
      event: 'discord_pending_drain',
      count: this.pending.size,
      reason,
    })
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.resolve({ ok: false, error: reason })
    }
    this.pending.clear()
  }

  private fireEvent(event: DiscordEvent): void {
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
        this.log.info('Discord worker ready', {
          event: 'discord_worker_ready',
          discordJsVersion: ev.discordJsVersion,
          buildId: ev.buildId,
          gitSha: ev.gitSha,
        })
        return
      case 'connected':
        this.connected = true
        this.log.info('Discord connected', {
          event: 'discord_connected',
          botId: ev.botId,
          username: ev.username,
        })
        this.fireEvent({ type: 'connected', botId: ev.botId, username: ev.username })
        return
      case 'disconnected':
        this.connected = false
        this.log.warn('Discord disconnected', {
          event: 'discord_disconnected',
          loggedOut: ev.loggedOut,
          reason: ev.reason,
        })
        this.fireEvent({ type: 'disconnected', loggedOut: ev.loggedOut, reason: ev.reason })
        return
      case 'incoming': {
        // Drop bot-authored traffic before it reaches the router.
        if (ev.senderIsBot) return
        if (this.messageHandler) {
          const attachments: IncomingAttachment[] | undefined = ev.attachments?.map((a) => ({
            type: a.type,
            fileId: ev.messageId,
            fileName: a.fileName,
            mimeType: a.mimeType,
            fileSize: a.fileSize,
            localPath: a.localPath,
          }))
          const msg: IncomingMessage = {
            platform: 'discord',
            channelId: ev.channelId,
            messageId: ev.messageId,
            senderId: ev.senderId,
            senderName: ev.senderName,
            senderIsBot: ev.senderIsBot,
            isDM: ev.isDM,
            mentionedBot: ev.mentionedBot,
            text: ev.text,
            attachments,
            timestamp: ev.timestamp,
            raw: ev,
          }
          void this.messageHandler(msg)
        }
        return
      }
      case 'button_press': {
        if (this.buttonHandler) {
          const press: ButtonPress = {
            platform: 'discord',
            channelId: ev.channelId,
            messageId: ev.messageId,
            senderId: ev.senderId,
            senderName: ev.senderName,
            buttonId: ev.buttonId,
            data: ev.data,
          }
          void this.buttonHandler(press)
        }
        return
      }
      case 'send_result': {
        const entry = this.pending.get(ev.id)
        if (entry) {
          clearTimeout(entry.timer)
          this.pending.delete(ev.id)
          entry.resolve({ ok: ev.ok, messageId: ev.messageId, error: ev.error })
        }
        if (!ev.ok) {
          this.log.error('Discord send failed', {
            event: 'discord_send_failed',
            commandId: ev.id,
            error: ev.error,
          })
        }
        return
      }
      case 'error':
        this.log.error('Discord worker reported error', {
          event: 'discord_worker_error',
          error: ev.message,
        })
        this.fireEvent({ type: 'error', message: ev.message })
        return
      case 'unavailable':
        this.connected = false
        this.log.error('Discord unavailable', {
          event: 'discord_unavailable',
          reason: ev.reason,
          error: ev.message,
        })
        this.fireEvent({ type: 'unavailable', reason: ev.reason, message: ev.message })
        return
    }
  }
}
