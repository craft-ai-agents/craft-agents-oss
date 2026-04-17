/**
 * Commands — handles chat commands from unbound or bound channels.
 *
 * /new [name]    — create session + bind
 * /bind          — list recent sessions (or by id)
 * /pair <code>   — finish a session-initiated pairing flow
 * /unbind        — disconnect channel
 * /help          — show available commands
 * /status        — show current binding
 * /stop          — abort the current agent run
 */

import type { ISessionManager } from '@craft-agent/server-core/handlers'
import type { BindingStore } from './binding-store'
import type { IncomingMessage, PlatformAdapter, PlatformType } from './types'

/**
 * Supplied by the registry. The gateway passes the consumer down to Commands so
 * /pair can redeem codes issued via the app UI. Only codes belonging to the
 * gateway's own workspace are honored.
 */
export interface PairingCodeConsumer {
  /** Returns the pending pairing (workspace + session) if the code is valid, or null. */
  consume(platform: PlatformType, code: string): { workspaceId: string; sessionId: string } | null
}

export class Commands {
  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly bindingStore: BindingStore,
    private readonly workspaceId: string,
    private readonly pairingConsumer?: PairingCodeConsumer,
  ) {}

  async handle(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const text = msg.text.trim()

    if (text.startsWith('/new')) {
      await this.handleNew(adapter, msg)
    } else if (text.startsWith('/bind')) {
      await this.handleBind(adapter, msg)
    } else if (text.startsWith('/pair')) {
      await this.handlePair(adapter, msg)
    } else if (text === '/unbind') {
      await this.handleUnbind(adapter, msg)
    } else if (text === '/help') {
      await this.handleHelp(adapter, msg)
    } else {
      await adapter.sendText(
        msg.channelId,
        'No session bound to this chat.\n\n' +
        '/new [name] — start a new session\n' +
        '/bind — connect to an existing session\n' +
        '/pair <code> — redeem a pairing code from the app\n' +
        '/help — show all commands',
      )
    }
  }

  async handleCommand(adapter: PlatformAdapter, msg: IncomingMessage): Promise<boolean> {
    const text = msg.text.trim()
    if (!text.startsWith('/')) return false

    const cmd = text.split(/\s+/)[0]!.toLowerCase()

    switch (cmd) {
      case '/new':
        await this.handleNew(adapter, msg)
        return true
      case '/bind':
        await this.handleBind(adapter, msg)
        return true
      case '/pair':
        await this.handlePair(adapter, msg)
        return true
      case '/unbind':
        await this.handleUnbind(adapter, msg)
        return true
      case '/help':
        await this.handleHelp(adapter, msg)
        return true
      case '/status':
        await this.handleStatus(adapter, msg)
        return true
      case '/stop':
        await this.handleStop(adapter, msg)
        return true
      default:
        return false
    }
  }

  // -------------------------------------------------------------------------
  // Command handlers
  // -------------------------------------------------------------------------

  private async handleNew(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const name = msg.text.replace(/^\/new\s*/, '').trim() || undefined

    try {
      const session = await this.sessionManager.createSession(this.workspaceId, { name })

      this.bindingStore.bind(
        this.workspaceId,
        session.id,
        adapter.platform,
        msg.channelId,
        msg.senderName,
      )

      const displayName = session.name || session.id
      await adapter.sendText(
        msg.channelId,
        `Created "${displayName}" — you're connected. Just type to start.`,
      )
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      await adapter.sendText(msg.channelId, `Failed to create session: ${errorMsg}`)
    }
  }

  private async handleBind(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const sessionIdArg = msg.text.replace(/^\/bind\s*/, '').trim()

    if (sessionIdArg) {
      const session = await this.sessionManager.getSession(sessionIdArg)
      if (!session) {
        await adapter.sendText(msg.channelId, `Session not found: ${sessionIdArg}`)
        return
      }

      this.bindingStore.bind(
        this.workspaceId,
        session.id,
        adapter.platform,
        msg.channelId,
        msg.senderName,
      )

      await adapter.sendText(
        msg.channelId,
        `Bound to "${session.name || session.id}"`,
      )
      return
    }

    const sessions = this.sessionManager.getSessions(this.workspaceId)
    const recent = sessions
      .filter((s) => !s.isArchived)
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .slice(0, 10)

    if (recent.length === 0) {
      await adapter.sendText(
        msg.channelId,
        'No sessions found. Use /new to create one.',
      )
      return
    }

    const lines = recent.map((s, i) => {
      const name = s.name || s.id.slice(0, 8)
      return `${i + 1}. ${name}`
    })

    if (adapter.capabilities.inlineButtons) {
      const buttons = recent.slice(0, adapter.capabilities.maxButtons).map((s) => ({
        id: `bind:${s.id}`,
        label: (s.name || s.id.slice(0, 8)).slice(0, 30),
        data: s.id,
      }))

      await adapter.sendButtons(
        msg.channelId,
        'Recent sessions:',
        buttons,
      )
    } else {
      await adapter.sendText(
        msg.channelId,
        'Recent sessions:\n' + lines.join('\n') + '\n\nUse /bind <session-id> to connect.',
      )
    }
  }

  private async handlePair(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    if (!this.pairingConsumer) {
      await adapter.sendText(msg.channelId, 'Pairing is not available in this build.')
      return
    }

    const arg = msg.text.replace(/^\/pair\s*/i, '').trim()
    const code = arg.replace(/\s+/g, '')

    if (!/^\d{6}$/.test(code)) {
      await adapter.sendText(
        msg.channelId,
        'Usage: /pair <6-digit code>\n\nGenerate a code from the session menu in the Craft Agent app.',
      )
      return
    }

    const entry = this.pairingConsumer.consume(adapter.platform, code)
    if (!entry) {
      await adapter.sendText(msg.channelId, 'Invalid or expired pairing code.')
      return
    }

    const session = await this.sessionManager.getSession(entry.sessionId)
    if (!session) {
      await adapter.sendText(msg.channelId, 'Session no longer exists.')
      return
    }

    this.bindingStore.bind(
      entry.workspaceId,
      entry.sessionId,
      adapter.platform,
      msg.channelId,
      msg.senderName,
    )

    await adapter.sendText(
      msg.channelId,
      `✅ Paired with "${session.name || session.id}". You can start chatting now.`,
    )
  }

  private async handleUnbind(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const removed = this.bindingStore.unbind(adapter.platform, msg.channelId)
    if (removed) {
      await adapter.sendText(msg.channelId, 'Disconnected from session.')
    } else {
      await adapter.sendText(msg.channelId, 'No session is bound to this chat.')
    }
  }

  private async handleStatus(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const binding = this.bindingStore.findByChannel(adapter.platform, msg.channelId)
    if (!binding) {
      await adapter.sendText(msg.channelId, 'No session bound. Use /bind, /new, or /pair.')
      return
    }

    const session = await this.sessionManager.getSession(binding.sessionId)
    const name = session?.name || binding.sessionId.slice(0, 8)
    const mode = binding.config.approvalChannel

    const responseMode =
      binding.config.responseMode ?? (binding.config.streamResponses ? 'streaming' : 'final_only')

    await adapter.sendText(
      msg.channelId,
      `Bound to "${name}"\nApproval: ${mode}\nResponse mode: ${responseMode}`,
    )
  }

  private async handleStop(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const binding = this.bindingStore.findByChannel(adapter.platform, msg.channelId)
    if (!binding) {
      await adapter.sendText(msg.channelId, 'No session bound.')
      return
    }

    try {
      await this.sessionManager.cancelProcessing(binding.sessionId)
      await adapter.sendText(msg.channelId, 'Stopped.')
    } catch {
      await adapter.sendText(msg.channelId, 'Nothing to stop.')
    }
  }

  private async handleHelp(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    await adapter.sendText(
      msg.channelId,
      'Commands:\n' +
      '/new [name] — create + bind new session\n' +
      '/bind — pick from recent sessions\n' +
      '/bind <id> — bind to specific session\n' +
      '/pair <code> — redeem an app-generated pairing code\n' +
      '/unbind — disconnect this chat\n' +
      '/status — show current binding\n' +
      '/stop — abort current agent run\n' +
      '/help — show this message',
    )
  }
}
