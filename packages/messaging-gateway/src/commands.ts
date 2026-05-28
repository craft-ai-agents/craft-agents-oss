/**
 * Commands — handles chat commands from unbound or bound channels.
 */

import type { ISessionManager } from '@craft-agent/server-core/handlers'
import {
  evaluatePreBindingAccess,
  executeRejection,
  readPlatformAccessMode,
  readPlatformOwners,
  type AccessRejectReason,
} from './access-control'
import type { BindingStore } from './binding-store'
import type { PendingSendersStore } from './pending-senders'
import type {
  IncomingMessage,
  MessagingConfig,
  MessagingLogger,
  PlatformAdapter,
  PlatformOwner,
  PlatformType,
} from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

export type PairingConsumeResult = { kind: 'session'; workspaceId: string; sessionId: string }

export interface PairingCodeConsumer {
  canConsume(platform: PlatformType, senderId: string): boolean
  consume(platform: PlatformType, code: string): PairingConsumeResult | null
}

export interface AccessControlDeps {
  getWorkspaceConfig: () => MessagingConfig
  seedOwnerOnFirstPair: (
    platform: PlatformType,
    candidate: PlatformOwner,
  ) => Promise<PlatformOwner[]>
  pendingStore?: PendingSendersStore
}

const ALWAYS_ALLOWED_COMMANDS = new Set(['/pair', '/help'])

export function parseCommand(text: string): { cmd: string; args: string } {
  const trimmed = text.trim()
  const m = trimmed.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i)
  if (!m) return { cmd: '', args: '' }
  return { cmd: '/' + m[1]!.toLowerCase(), args: (m[2] ?? '').trim() }
}

export class Commands {
  private readonly access: AccessControlDeps
  private readonly recentRejectReplies = new Map<string, number>()

  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly bindingStore: BindingStore,
    private readonly workspaceId: string,
    private readonly pairingConsumer?: PairingCodeConsumer,
    private readonly log: MessagingLogger = NOOP_LOGGER,
    access: AccessControlDeps = {
      getWorkspaceConfig: () => ({ enabled: false, platforms: {} }),
      seedOwnerOnFirstPair: async () => [],
    },
  ) {
    this.access = access
  }

  async handle(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const { cmd } = parseCommand(msg.text)
    const skipsGate = cmd && ALWAYS_ALLOWED_COMMANDS.has(cmd)
    if (!skipsGate) {
      const verdict = evaluatePreBindingAccess({
        msg,
        workspaceConfig: this.access.getWorkspaceConfig(),
      })
      if (!verdict.allow) {
        await this.sendRejection(adapter, msg, verdict.reason)
        return
      }
    }

    if (cmd && await this.dispatch(adapter, msg, cmd)) return

    await adapter.sendText(
      msg.channelId,
      'No session bound to this chat.\n\n' +
        '/new [name] - start a new session\n' +
        '/bind - connect to an existing session\n' +
        '/pair <code> - redeem a pairing code from the app\n' +
        '/help - show all commands',
    )
  }

  async handleCommand(adapter: PlatformAdapter, msg: IncomingMessage): Promise<boolean> {
    const { cmd } = parseCommand(msg.text)
    if (!cmd) return false

    this.log.info('handling chat command', {
      event: 'command_received',
      workspaceId: this.workspaceId,
      platform: adapter.platform,
      channelId: msg.channelId,
      senderId: msg.senderId,
      command: cmd,
    })

    if (!ALWAYS_ALLOWED_COMMANDS.has(cmd)) {
      const verdict = evaluatePreBindingAccess({
        msg,
        workspaceConfig: this.access.getWorkspaceConfig(),
      })
      if (!verdict.allow) {
        await this.sendRejection(adapter, msg, verdict.reason)
        return true
      }
    }

    return this.dispatch(adapter, msg, cmd)
  }

  private async dispatch(adapter: PlatformAdapter, msg: IncomingMessage, cmd: string): Promise<boolean> {
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

  private async sendRejection(
    adapter: PlatformAdapter,
    msg: IncomingMessage,
    reason: AccessRejectReason,
  ): Promise<void> {
    await executeRejection(
      adapter,
      msg,
      reason,
      {
        recentRejectReplies: this.recentRejectReplies,
        ...(this.access.pendingStore ? { pendingStore: this.access.pendingStore } : {}),
      },
      this.log,
    )
  }

  private async handleNew(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const name = parseCommand(msg.text).args || undefined
    try {
      const session = await this.sessionManager.createSession(this.workspaceId, { name })
      this.bindingStore.bind(this.workspaceId, session.id, adapter.platform, msg.channelId, msg.senderName)
      await adapter.sendText(
        msg.channelId,
        `Created "${session.name || session.id}" - you're connected. Just type to start.`,
      )
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      await adapter.sendText(msg.channelId, `Failed to create session: ${errorMsg}`)
    }
  }

  private async handleBind(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const bindArg = parseCommand(msg.text).args
    const recent = this.getRecentSessions()

    if (bindArg) {
      const session = await this.resolveBindTarget(bindArg, recent)
      if (!session) {
        await adapter.sendText(msg.channelId, `Session not found: ${bindArg}`)
        return
      }
      this.bindingStore.bind(this.workspaceId, session.id, adapter.platform, msg.channelId, msg.senderName)
      await adapter.sendText(msg.channelId, `Bound to "${session.name || session.id}"`)
      return
    }

    if (recent.length === 0) {
      await adapter.sendText(msg.channelId, 'No sessions found. Use /new to create one.')
      return
    }

    if (adapter.capabilities.inlineButtons) {
      const buttons = recent.slice(0, adapter.capabilities.maxButtons).map((s) => ({
        id: `bind:${s.id}`,
        label: (s.name || s.id.slice(0, 8)).slice(0, 30),
        data: s.id,
      }))
      await adapter.sendButtons(msg.channelId, 'Recent sessions:', buttons)
      return
    }

    const lines = recent.map((s, i) => {
      const name = s.name || s.id.slice(0, 8)
      return `${i + 1}. ${name} (${s.id.slice(0, 8)})`
    })
    await adapter.sendText(
      msg.channelId,
      'Recent sessions:\n' + lines.join('\n') + '\n\nUse /bind <number> to connect, or /bind <session-id> if you already know it.',
    )
  }

  private async handlePair(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    if (!this.pairingConsumer) {
      await adapter.sendText(msg.channelId, 'Pairing is not available in this build.')
      return
    }

    if (!this.pairingConsumer.canConsume(adapter.platform, msg.senderId)) {
      await adapter.sendText(msg.channelId, 'Too many pairing attempts. Try again in a minute.')
      return
    }

    const code = parseCommand(msg.text).args.replace(/\s+/g, '')
    if (!/^\d{6}$/.test(code)) {
      await adapter.sendText(msg.channelId, 'Usage: /pair <6-digit code>')
      return
    }

    const wsConfig = this.access.getWorkspaceConfig()
    const wsMode = readPlatformAccessMode(wsConfig, adapter.platform)
    const owners = readPlatformOwners(wsConfig, adapter.platform)
    if (
      wsMode === 'owner-only' &&
      owners.length > 0 &&
      !owners.some((o) => o.userId === msg.senderId)
    ) {
      await adapter.sendText(
        msg.channelId,
        'Only existing bot owners can redeem pairing codes. Ask an owner to add you in the MDP app.',
      )
      return
    }

    const entry = this.pairingConsumer.consume(adapter.platform, code)
    if (!entry) {
      await adapter.sendText(msg.channelId, 'Invalid or expired pairing code.')
      return
    }

    await this.access.seedOwnerOnFirstPair(adapter.platform, {
      userId: msg.senderId,
      ...(msg.senderName ? { displayName: msg.senderName } : {}),
      ...(msg.senderUsername ? { username: msg.senderUsername } : {}),
      addedAt: Date.now(),
    }).catch((err) => {
      this.log.warn('seedOwnerOnFirstPair failed (non-fatal)', {
        event: 'pairing_owner_seed_failed',
        workspaceId: this.workspaceId,
        platform: adapter.platform,
        senderId: msg.senderId,
        error: err,
      })
    })

    const session = await this.sessionManager.getSession(entry.sessionId)
    if (!session) {
      await adapter.sendText(msg.channelId, 'Session no longer exists.')
      return
    }

    this.bindingStore.bind(entry.workspaceId, entry.sessionId, adapter.platform, msg.channelId, msg.senderName)
    await adapter.sendText(
      msg.channelId,
      `Paired with "${session.name || session.id}". You can start chatting now.`,
    )
  }

  private async handleUnbind(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const removed = this.bindingStore.unbind(adapter.platform, msg.channelId)
    await adapter.sendText(
      msg.channelId,
      removed ? 'Disconnected from session.' : 'No session is bound to this chat.',
    )
  }

  private async handleStatus(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const binding = this.bindingStore.findByChannel(adapter.platform, msg.channelId)
    if (!binding) {
      await adapter.sendText(msg.channelId, 'No session bound. Use /bind, /new, or /pair.')
      return
    }

    const session = await this.sessionManager.getSession(binding.sessionId)
    const name = session?.name || binding.sessionId.slice(0, 8)
    await adapter.sendText(
      msg.channelId,
      `Bound to "${name}"\nApproval: ${binding.config.approvalChannel}\nResponse mode: ${binding.config.responseMode}`,
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
        '/new [name] - create and bind new session\n' +
        '/bind - pick from recent sessions\n' +
        '/bind <id> - bind to specific session\n' +
        '/pair <code> - redeem an app-generated pairing code\n' +
        '/unbind - disconnect this chat\n' +
        '/status - show current binding\n' +
        '/stop - abort current agent run\n' +
        '/help - show this message',
    )
  }

  private getRecentSessions(): ReturnType<ISessionManager['getSessions']> {
    return this.sessionManager.getSessions(this.workspaceId)
      .filter((s) => !s.isArchived)
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .slice(0, 10)
  }

  private async resolveBindTarget(
    bindArg: string,
    recent: ReturnType<ISessionManager['getSessions']>,
  ): Promise<Awaited<ReturnType<ISessionManager['getSession']>> | undefined> {
    if (/^\d+$/.test(bindArg)) {
      const index = Number(bindArg)
      if (index >= 1 && index <= recent.length) return recent[index - 1]
    }
    return this.sessionManager.getSession(bindArg)
  }
}
