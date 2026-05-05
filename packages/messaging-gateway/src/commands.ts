/**
 * Commands — handles chat commands from unbound or bound channels.
 *
 * /new [name]    — create session + bind
 * /bind          — list recent sessions (or by id / index)
 * /pair <code>   — finish a session-initiated pairing flow
 * /unbind        — disconnect channel
 * /help          — show available commands
 * /status        — show current binding
 * /stop          — abort the current agent run
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

/**
 * Result of consuming a pairing code. The `kind` discriminator tells the
 * caller which downstream flow to run (bind a session, or register the
 * supergroup chat at the workspace level).
 */
export type PairingConsumeResult =
  | { kind: 'session'; workspaceId: string; sessionId: string }
  | { kind: 'workspace-supergroup'; workspaceId: string }

/**
 * Supplied by the registry. The gateway passes the consumer down to Commands so
 * /pair can redeem codes issued via the app UI. Only codes belonging to the
 * gateway's own workspace are honored.
 */
export interface PairingCodeConsumer {
  /**
   * Returns whether this sender may still attempt a /pair consume this minute.
   * Defence-in-depth against brute-forcing the 6-digit code. Counted on entry,
   * not after validation, so wrong guesses consume budget too.
   */
  canConsume(platform: PlatformType, senderId: string): boolean
  /** Returns the pending pairing if the code is valid, or null. */
  consume(platform: PlatformType, code: string): PairingConsumeResult | null
  /**
   * Register the supergroup that just paired itself. Invoked from
   * Commands.handlePair when the consumed code's kind is
   * `workspace-supergroup`. Performs the persistence + adapter-reconfigure
   * dance that lives in the registry.
   */
  bindWorkspaceSupergroup?(args: {
    platform: PlatformType
    chatId: string
    /** Optional fall-back display name; the registry can fetch a real one via getChat. */
    fallbackTitle?: string
  }): Promise<{ title: string }>
}

/**
 * Access-control wiring supplied by the gateway. Commands consults the
 * workspace config on every command invocation (so config edits take effect
 * without restart) and uses `seedOwnerOnFirstPair` to bootstrap ownership
 * the first time anyone redeems a pairing code.
 */
export interface AccessControlDeps {
  getWorkspaceConfig: () => MessagingConfig
  /**
   * Append the sender to the platform's owners list iff the list is currently
   * empty for that platform. Returns the updated list (or the existing list
   * if the seed didn't run). Called from `/pair` consume.
   */
  seedOwnerOnFirstPair: (
    platform: PlatformType,
    candidate: PlatformOwner,
  ) => Promise<PlatformOwner[]>
  /** Optional pending-senders store for recording rejected attempts. */
  pendingStore?: PendingSendersStore
}

/**
 * Commands the gateway lets *anyone* run, regardless of ownership. `/pair`
 * is the bootstrap exception (first sender to redeem becomes owner) and
 * `/help` is informational.
 */
const ALWAYS_ALLOWED_COMMANDS = new Set(['/pair', '/help'])

/**
 * Telegram (and other Bot-API platforms) lets users address commands to
 * specific bots in shared chats: `/pair@MyBot 123456`. Without stripping
 * the `@BotName` suffix, the cmd token doesn't match our switch cases and
 * supergroup pairing breaks for users typing the canonical group form.
 *
 * Returns `{ cmd: '', args: '' }` for non-command text. Lower-cases the
 * cmd so callsites can do exact-string comparisons.
 */
export function parseCommand(text: string): { cmd: string; args: string } {
  const trimmed = text.trim()
  const m = trimmed.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i)
  if (!m) return { cmd: '', args: '' }
  return { cmd: '/' + m[1]!.toLowerCase(), args: (m[2] ?? '').trim() }
}

export class Commands {
  private readonly log: MessagingLogger
  private readonly access: AccessControlDeps
  private readonly recentRejectReplies = new Map<string, number>()

  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly bindingStore: BindingStore,
    private readonly workspaceId: string,
    private readonly pairingConsumer?: PairingCodeConsumer,
    logger: MessagingLogger = NOOP_LOGGER,
    access: AccessControlDeps = {
      getWorkspaceConfig: () => ({ enabled: false, platforms: {} }),
      seedOwnerOnFirstPair: async () => [],
    },
  ) {
    this.log = logger
    this.access = access
  }

  async handle(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const text = msg.text.trim()
    const replyOpts = msg.threadId !== undefined ? { threadId: msg.threadId } : {}

    // Pre-binding gate: every inbound stimulus runs through the access
    // evaluator, including non-command free-form text. Without this,
    // a stranger DMing "hi" would receive the help message (revealing
    // commands) and bypass the pending-senders flow. Only `/pair`
    // (bootstrap) and `/help` (informational) skip the gate.
    const cmd = parseCommand(text).cmd
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

    // Exact-cmd dispatch (parsed; supports `/cmd@BotName`). Avoids the old
    // `text.startsWith('/new')` bug where `/newuser` would also dispatch
    // to handleNew.
    if (cmd === '/new') {
      await this.handleNew(adapter, msg)
    } else if (cmd === '/bind') {
      await this.handleBind(adapter, msg)
    } else if (cmd === '/pair') {
      await this.handlePair(adapter, msg)
    } else if (cmd === '/unbind') {
      await this.handleUnbind(adapter, msg)
    } else if (cmd === '/help') {
      await this.handleHelp(adapter, msg)
    } else {
      // Sender passed the access gate (owner or open workspace) and typed
      // free-form text into a chat with no binding. Show the help prompt.
      await adapter.sendText(
        msg.channelId,
        'No session bound to this chat.\n\n' +
        '/new [name] — start a new session\n' +
        '/bind — connect to an existing session\n' +
        '/pair <code> — redeem a pairing code from the app\n' +
        '/help — show all commands',
        replyOpts,
      )
    }
  }

  async handleCommand(adapter: PlatformAdapter, msg: IncomingMessage): Promise<boolean> {
    const text = msg.text.trim()
    if (!text.startsWith('/')) return false

    // Strip the optional `@BotName` suffix Telegram uses to disambiguate
    // commands in shared chats. Without this, `/pair@MyBot 123456` would
    // never match the switch case below.
    const { cmd } = parseCommand(text)
    if (!cmd) return false

    this.log.info('handling chat command', {
      event: 'command_received',
      workspaceId: this.workspaceId,
      platform: adapter.platform,
      channelId: msg.channelId,
      senderId: msg.senderId,
      command: cmd,
    })

    // Pre-binding gate for commands that arrive directly (i.e. typed inside
    // an already-bound chat — `gateway.wireAdapter` always tries
    // `handleCommand` before `router.route`). `/pair` and `/help` always pass.
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

  /**
   * Reject reply for pre-binding gating. Delegates to the shared
   * `executeRejection` so text and button paths emit identical output.
   */
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

  // -------------------------------------------------------------------------
  // Command handlers
  // -------------------------------------------------------------------------

  private async handleNew(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const name = parseCommand(msg.text).args || undefined
    const replyOpts = msg.threadId !== undefined ? { threadId: msg.threadId } : {}

    try {
      const session = await this.sessionManager.createSession(this.workspaceId, { name })

      this.bindingStore.bind(
        this.workspaceId,
        session.id,
        adapter.platform,
        msg.channelId,
        msg.senderName,
        undefined,
        msg.threadId,
      )

      const displayName = session.name || session.id
      await adapter.sendText(
        msg.channelId,
        `Created "${displayName}" — you're connected. Just type to start.`,
        replyOpts,
      )
      this.log.info('session created and bound from chat', {
        event: 'session_created_from_chat',
        workspaceId: this.workspaceId,
        sessionId: session.id,
        platform: adapter.platform,
        channelId: msg.channelId,
        threadId: msg.threadId,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      this.log.error('failed to create session from chat', {
        event: 'session_create_failed',
        workspaceId: this.workspaceId,
        platform: adapter.platform,
        channelId: msg.channelId,
        error: err,
      })
      await adapter.sendText(msg.channelId, `Failed to create session: ${errorMsg}`, replyOpts)
    }
  }

  private async handleBind(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const bindArg = parseCommand(msg.text).args
    const recent = this.getRecentSessions()
    const replyOpts = msg.threadId !== undefined ? { threadId: msg.threadId } : {}

    if (bindArg) {
      const session = await this.resolveBindTarget(bindArg, recent)
      if (!session) {
        await adapter.sendText(msg.channelId, `Session not found: ${bindArg}`, replyOpts)
        return
      }

      this.bindingStore.bind(
        this.workspaceId,
        session.id,
        adapter.platform,
        msg.channelId,
        msg.senderName,
        undefined,
        msg.threadId,
      )

      this.log.info('chat bound to existing session', {
        event: 'chat_bound',
        workspaceId: this.workspaceId,
        sessionId: session.id,
        platform: adapter.platform,
        channelId: msg.channelId,
        threadId: msg.threadId,
        bindArg,
      })

      await adapter.sendText(msg.channelId, `Bound to "${session.name || session.id}"`, replyOpts)
      return
    }

    if (recent.length === 0) {
      await adapter.sendText(
        msg.channelId,
        'No sessions found. Use /new to create one.',
        replyOpts,
      )
      return
    }

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
        replyOpts,
      )
      return
    }

    const lines = recent.map((s, i) => {
      const name = s.name || s.id.slice(0, 8)
      return `${i + 1}. ${name} (${s.id.slice(0, 8)})`
    })

    await adapter.sendText(
      msg.channelId,
      'Recent sessions:\n' + lines.join('\n') + '\n\nUse /bind <number> to connect, or /bind <session-id> if you already know it.',
      replyOpts,
    )
  }

  private async handlePair(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const replyOpts = msg.threadId !== undefined ? { threadId: msg.threadId } : {}

    if (!this.pairingConsumer) {
      await adapter.sendText(msg.channelId, 'Pairing is not available in this build.', replyOpts)
      return
    }

    // Throttle BEFORE format validation — otherwise an attacker gets
    // unlimited "is this a valid format" feedback that's almost as useful
    // as a code check. Every `/pair` attempt counts against the budget.
    if (!this.pairingConsumer.canConsume(adapter.platform, msg.senderId)) {
      this.log.warn('pairing consume rate limit hit', {
        event: 'pairing_consume_rate_limited',
        workspaceId: this.workspaceId,
        platform: adapter.platform,
        channelId: msg.channelId,
        senderId: msg.senderId,
      })
      await adapter.sendText(
        msg.channelId,
        '⏳ Too many pairing attempts. Try again in a minute.',
        replyOpts,
      )
      return
    }

    // Use the centralized parser so `/pair@MyBot 123456` works the same
    // as `/pair 123456` — Telegram routes commands by bot suffix in
    // group chats and many users will type the canonical form.
    const { args } = parseCommand(msg.text)
    const code = args.replace(/\s+/g, '')

    if (!/^\d{6}$/.test(code)) {
      await adapter.sendText(
        msg.channelId,
        'Usage: /pair <6-digit code>\n\nGenerate a code from the session menu or the Telegram supergroup setup in the Craft Agent app.',
        replyOpts,
      )
      return
    }

    // Pre-consume access gate. Bootstrap rule: when the platform has zero
    // owners, ANY successful redeem seeds the first owner (the user who
    // typed `/pair`). Once owners exist, only existing owners may redeem
    // further codes — without this, an attacker who steals or guesses a
    // code becomes an owner.
    const wsConfig = this.access.getWorkspaceConfig()
    const wsMode = readPlatformAccessMode(wsConfig, adapter.platform)
    const owners = readPlatformOwners(wsConfig, adapter.platform)
    if (
      wsMode === 'owner-only' &&
      owners.length > 0 &&
      !owners.some((o) => o.userId === msg.senderId)
    ) {
      this.log.info('pairing redeem blocked: sender is not an owner', {
        event: 'pairing_redeem_not_owner',
        workspaceId: this.workspaceId,
        platform: adapter.platform,
        senderId: msg.senderId,
      })
      await adapter.sendText(
        msg.channelId,
        'Only existing bot owners can redeem pairing codes. Ask an owner to add you in the Craft Agent app.',
        replyOpts,
      )
      return
    }

    const entry = this.pairingConsumer.consume(adapter.platform, code)
    if (!entry) {
      await adapter.sendText(msg.channelId, 'Invalid or expired pairing code.', replyOpts)
      return
    }

    // Seed the first owner. The seeder is a no-op when the list is already
    // populated, so it's safe to call unconditionally on every successful
    // redeem. Failures are logged but never block the pair itself — losing
    // the seed only means the operator has to add the user manually later.
    try {
      await this.access.seedOwnerOnFirstPair(adapter.platform, {
        userId: msg.senderId,
        ...(msg.senderName ? { displayName: msg.senderName } : {}),
        ...(msg.senderUsername ? { username: msg.senderUsername } : {}),
        addedAt: Date.now(),
      })
    } catch (err) {
      this.log.warn('seedOwnerOnFirstPair failed (non-fatal)', {
        event: 'pairing_owner_seed_failed',
        workspaceId: this.workspaceId,
        platform: adapter.platform,
        senderId: msg.senderId,
        error: err,
      })
    }

    if (entry.kind === 'workspace-supergroup') {
      await this.handleSupergroupPair(adapter, msg, entry, replyOpts)
      return
    }

    // entry.kind === 'session'
    const session = await this.sessionManager.getSession(entry.sessionId)
    if (!session) {
      await adapter.sendText(msg.channelId, 'Session no longer exists.', replyOpts)
      return
    }

    this.bindingStore.bind(
      entry.workspaceId,
      entry.sessionId,
      adapter.platform,
      msg.channelId,
      msg.senderName,
      undefined,
      msg.threadId,
    )

    this.log.info('pairing code redeemed', {
      event: 'pairing_redeemed',
      kind: 'session',
      workspaceId: entry.workspaceId,
      sessionId: entry.sessionId,
      platform: adapter.platform,
      channelId: msg.channelId,
      threadId: msg.threadId,
    })

    const topicHint = msg.threadId !== undefined
      ? ` (topic #${msg.threadId})`
      : ''
    await adapter.sendText(
      msg.channelId,
      `✅ Paired with "${session.name || session.id}"${topicHint}. You can start chatting now.`,
      replyOpts,
    )
  }

  /**
   * Workspace-supergroup pairing: a `/pair <code>` typed in a Telegram
   * supergroup with a workspace-supergroup-kind code. We register the
   * supergroup's chat_id at the workspace level so the adapter starts
   * accepting messages from it (in addition to DMs).
   */
  private async handleSupergroupPair(
    adapter: PlatformAdapter,
    msg: IncomingMessage,
    entry: { workspaceId: string },
    replyOpts: { threadId?: number },
  ): Promise<void> {
    if (adapter.platform !== 'telegram') {
      await adapter.sendText(
        msg.channelId,
        'Workspace-supergroup pairing is only supported on Telegram.',
        replyOpts,
      )
      return
    }

    if (!this.pairingConsumer?.bindWorkspaceSupergroup) {
      await adapter.sendText(
        msg.channelId,
        'Supergroup pairing is not enabled in this build.',
        replyOpts,
      )
      return
    }

    try {
      const result = await this.pairingConsumer.bindWorkspaceSupergroup({
        platform: adapter.platform,
        chatId: msg.channelId,
        fallbackTitle: msg.senderName,
      })
      this.log.info('pairing code redeemed', {
        event: 'pairing_redeemed',
        kind: 'workspace-supergroup',
        workspaceId: entry.workspaceId,
        platform: adapter.platform,
        channelId: msg.channelId,
        title: result.title,
      })
      await adapter.sendText(
        msg.channelId,
        `✅ Supergroup *${result.title}* paired. Sessions can now be bound to topics in this group.`,
        replyOpts,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      this.log.error('workspace supergroup bind failed', {
        event: 'workspace_supergroup_bind_failed',
        workspaceId: entry.workspaceId,
        platform: adapter.platform,
        channelId: msg.channelId,
        error: err,
      })
      await adapter.sendText(
        msg.channelId,
        `❌ Couldn't pair this supergroup: ${message}`,
        replyOpts,
      )
    }
  }

  private async handleUnbind(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const replyOpts = msg.threadId !== undefined ? { threadId: msg.threadId } : {}
    const removed = this.bindingStore.unbind(adapter.platform, msg.channelId, msg.threadId)
    if (removed) {
      await adapter.sendText(msg.channelId, 'Disconnected from session.', replyOpts)
    } else {
      await adapter.sendText(msg.channelId, 'No session is bound to this chat.', replyOpts)
    }
  }

  private async handleStatus(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const replyOpts = msg.threadId !== undefined ? { threadId: msg.threadId } : {}
    const binding = this.bindingStore.findByChannel(adapter.platform, msg.channelId, msg.threadId)
    if (!binding) {
      await adapter.sendText(msg.channelId, 'No session bound. Use /bind, /new, or /pair.', replyOpts)
      return
    }

    const session = await this.sessionManager.getSession(binding.sessionId)
    const name = session?.name || binding.sessionId.slice(0, 8)
    const mode = binding.config.approvalChannel
    const responseMode = binding.config.responseMode

    await adapter.sendText(
      msg.channelId,
      `Bound to "${name}"\nApproval: ${mode}\nResponse mode: ${responseMode}`,
      replyOpts,
    )
  }

  private async handleStop(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const replyOpts = msg.threadId !== undefined ? { threadId: msg.threadId } : {}
    const binding = this.bindingStore.findByChannel(adapter.platform, msg.channelId, msg.threadId)
    if (!binding) {
      await adapter.sendText(msg.channelId, 'No session bound.', replyOpts)
      return
    }

    try {
      await this.sessionManager.cancelProcessing(binding.sessionId)
      await adapter.sendText(msg.channelId, 'Stopped.', replyOpts)
    } catch {
      await adapter.sendText(msg.channelId, 'Nothing to stop.', replyOpts)
    }
  }

  private async handleHelp(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    const bindLine = adapter.platform === 'whatsapp'
      ? '/bind — list recent sessions (then use /bind <number>)\n'
      : '/bind — pick from recent sessions\n'
    const replyOpts = msg.threadId !== undefined ? { threadId: msg.threadId } : {}

    await adapter.sendText(
      msg.channelId,
      'Commands:\n' +
      '/new [name] — create + bind new session\n' +
      bindLine +
      '/bind <id> — bind to specific session\n' +
      '/pair <code> — redeem an app-generated pairing code\n' +
      '/unbind — disconnect this chat\n' +
      '/status — show current binding\n' +
      '/stop — abort current agent run\n' +
      '/help — show this message',
      replyOpts,
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
      if (index >= 1 && index <= recent.length) {
        return recent[index - 1]
      }
    }
    return this.sessionManager.getSession(bindArg)
  }
}
