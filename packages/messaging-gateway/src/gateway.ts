/**
 * MessagingGateway — orchestrator for messaging platform adapters.
 *
 * Runs in-process alongside SessionManager. Wires adapters, router,
 * renderer, and binding store together. One instance per workspace.
 */

import type { ISessionManager } from '@craft-agent/server-core/handlers'
import type { PushTarget } from '@craft-agent/shared/protocol'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  evaluateBindingAccess,
  evaluatePreBindingAccess,
  executeRejection,
} from './access-control'
import { BindingStore } from './binding-store'
import { Router } from './router'
import { Commands, type AccessControlDeps, type PairingCodeConsumer } from './commands'
import { Renderer, type SessionEvent } from './renderer'
import { PendingSendersStore } from './pending-senders'
import { PlanTokenRegistry } from './plan-tokens'
import type {
  PlatformAdapter,
  PlatformType,
  IncomingMessage,
  ButtonPress,
  MessagingConfig,
  MessagingLogger,
  PlatformOwner,
} from './types'

const consoleLogger: MessagingLogger = {
  info: (message, meta) => console.log('[MessagingGateway]', message, meta ?? ''),
  warn: (message, meta) => console.warn('[MessagingGateway]', message, meta ?? ''),
  error: (message, meta) => console.error('[MessagingGateway]', message, meta ?? ''),
  child(context) {
    return {
      info: (message, meta) => console.log('[MessagingGateway]', context, message, meta ?? ''),
      warn: (message, meta) => console.warn('[MessagingGateway]', context, message, meta ?? ''),
      error: (message, meta) => console.error('[MessagingGateway]', context, message, meta ?? ''),
      child: (next) => consoleLogger.child({ ...context, ...next }),
    }
  },
}

export interface GatewayOptions {
  sessionManager: ISessionManager
  workspaceId: string
  /** Absolute path to the messaging storage directory. */
  storageDir: string
  /** Optional legacy directory for one-shot migration of bindings.json. */
  legacyStorageDir?: string
  /** Optional consumer that resolves /pair codes issued elsewhere. */
  pairingConsumer?: PairingCodeConsumer
  /** Fired after any binding mutation (bind/unbind). */
  onBindingChanged?: () => void
  /**
   * Reads the workspace's MessagingConfig. Called per-message so config
   * edits (toggling accessMode, adding owners) take effect without restart.
   * Optional — when omitted, the gateway falls back to a permissive
   * "everything is open" config (useful for legacy callers and unit tests).
   */
  getWorkspaceConfig?: () => MessagingConfig
  /**
   * Append `candidate` to the platform's owners list iff the list is
   * currently empty. No-op otherwise. Used by Commands.handlePair to
   * bootstrap ownership the first time anyone redeems a code.
   */
  seedOwnerOnFirstPair?: (
    platform: PlatformType,
    candidate: PlatformOwner,
  ) => Promise<PlatformOwner[]>
  /**
   * Fires after the pending-senders store mutates, so the registry can push
   * an event to the renderer. Mirrors `onBindingChanged`.
   */
  onPendingChanged?: () => void
  /** Optional logger — defaults to console. Pass a structured host logger in Electron. */
  logger?: MessagingLogger
}

/**
 * Per-plan metadata tracked while a plan approval button is live on a chat.
 * Used to disable the inline keyboard after a tap. Keyed by plan token.
 */
interface PlanMessageRecord {
  bindingId: string
  platform: PlatformType
  channelId: string
  messageId: string
}

/**
 * Per-permission-prompt metadata tracked while inline Approve/Deny buttons
 * are live on a chat. Keyed by `requestId`. Two roles:
 *
 *  1. Idempotency claim — `handleButtonPress` removes the entry before doing
 *     anything visible, so a second tap on the same prompt finds nothing and
 *     silently no-ops. Stops the duplicate "✅ Allowed / ❌ Denied" flood.
 *  2. Stale-prompt cleanup — when the agent moves past the permission
 *     (resolved from any channel — desktop, MCP, etc.), `onSessionEvent`
 *     sweeps the entry and clears the inline keyboard so the user can't
 *     even produce a callback by tapping a stale button.
 */
interface PermissionMessageRecord {
  bindingId: string
  sessionId: string
  platform: PlatformType
  channelId: string
  messageId: string
  threadId?: number
}

interface PendingCompactAccept {
  token: string
  sessionId: string
  bindingId: string
  platform: PlatformType
  channelId: string
  /** Forum topic id where the press came from (Telegram supergroup), if any. */
  threadId?: number
  messageId: string
  planPath: string
  createdAt: number
}

const COMPACT_ACCEPT_TTL_MS = 10 * 60 * 1000

export class MessagingGateway {
  private readonly sessionManager: ISessionManager
  private readonly workspaceId: string
  private readonly bindingStore: BindingStore
  private readonly pendingStore: PendingSendersStore
  private readonly router: Router
  private readonly commands: Commands
  private readonly renderer: Renderer
  private readonly planTokens: PlanTokenRegistry
  private readonly planMessages = new Map<string, PlanMessageRecord>()
  /** Live permission prompts, keyed by `requestId`. See PermissionMessageRecord. */
  private readonly permissionMessages = new Map<string, PermissionMessageRecord>()
  private readonly pendingCompactAccepts = new Map<string, PendingCompactAccept>()
  private readonly adapters = new Map<PlatformType, PlatformAdapter>()
  private readonly log: MessagingLogger
  private started = false
  /**
   * Access-control surface — `getWorkspaceConfig` is called per-button so
   * config edits take effect without restart, mirroring the text path.
   * `recentRejectReplies` is a separate cooldown map from Router/Commands
   * so callback-button rejection rate-limiting is independent of text
   * rejection rate-limiting (a stranger spamming buttons doesn't lock
   * out their text-channel reply, and vice versa).
   */
  private readonly accessDeps: AccessControlDeps
  private readonly buttonRecentRejectReplies = new Map<string, number>()

  constructor(opts: GatewayOptions) {
    this.sessionManager = opts.sessionManager
    this.workspaceId = opts.workspaceId
    this.log = (opts.logger ?? consoleLogger).child({
      component: 'gateway',
      workspaceId: opts.workspaceId,
    })
    this.bindingStore = new BindingStore(
      opts.storageDir,
      opts.legacyStorageDir,
      this.log.child({ component: 'binding-store' }),
    )
    if (opts.onBindingChanged) {
      this.bindingStore.onChange(opts.onBindingChanged)
    }

    this.pendingStore = new PendingSendersStore(
      opts.storageDir,
      this.log.child({ component: 'pending-senders' }),
    )
    if (opts.onPendingChanged) {
      this.pendingStore.onChange(opts.onPendingChanged)
    }

    this.accessDeps = {
      getWorkspaceConfig:
        opts.getWorkspaceConfig ?? (() => ({ enabled: false, platforms: {} })),
      seedOwnerOnFirstPair:
        opts.seedOwnerOnFirstPair ?? (async () => []),
      pendingStore: this.pendingStore,
    }

    this.commands = new Commands(
      opts.sessionManager,
      this.bindingStore,
      opts.workspaceId,
      opts.pairingConsumer,
      this.log.child({ component: 'commands' }),
      this.accessDeps,
    )
    this.router = new Router(
      opts.sessionManager,
      this.bindingStore,
      this.commands,
      this.log.child({ component: 'router' }),
      {
        getWorkspaceConfig: this.accessDeps.getWorkspaceConfig,
        pendingStore: this.pendingStore,
      },
    )
    this.planTokens = new PlanTokenRegistry()
    this.renderer = new Renderer({
      planTokens: this.planTokens,
      // The renderer hands us the exact binding that sent the message.
      // We must not resolve it ourselves — `findBySession` returns every
      // binding and picking the first Telegram binding attributes the
      // message to the wrong chat whenever the session has more than one.
      recordPlanMessage: (binding, token, messageId) => {
        this.planMessages.set(token, {
          bindingId: binding.id,
          platform: binding.platform,
          channelId: binding.channelId,
          messageId,
        })
      },
      recordPermissionMessage: (binding, requestId, messageId) => {
        this.permissionMessages.set(requestId, {
          bindingId: binding.id,
          sessionId: binding.sessionId,
          platform: binding.platform,
          channelId: binding.channelId,
          messageId,
          ...(binding.threadId !== undefined ? { threadId: binding.threadId } : {}),
        })
      },
    })
  }

  // -------------------------------------------------------------------------
  // Adapter registration
  // -------------------------------------------------------------------------

  registerAdapter(adapter: PlatformAdapter): void {
    const existing = this.adapters.get(adapter.platform)
    if (existing) {
      existing.destroy().catch((err) => {
        this.log.warn('failed to destroy existing adapter during replacement', {
          event: 'adapter_replace_destroy_failed',
          platform: adapter.platform,
          error: err,
        })
      })
    }
    this.adapters.set(adapter.platform, adapter)
    if (this.started) {
      this.wireAdapter(adapter)
    }
  }

  async unregisterAdapter(platform: PlatformType): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return
    this.adapters.delete(platform)
    try {
      await adapter.destroy()
      this.log.info('adapter unregistered', {
        event: 'adapter_unregistered',
        platform,
      })
    } catch (err) {
      this.log.error('failed to destroy adapter', {
        event: 'adapter_destroy_failed',
        platform,
        error: err,
      })
    }
  }

  getAdapter(platform: PlatformType): PlatformAdapter | undefined {
    return this.adapters.get(platform)
  }

  hasConnectedAdapter(platform: PlatformType): boolean {
    return this.adapters.get(platform)?.isConnected() ?? false
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    for (const adapter of this.adapters.values()) {
      this.wireAdapter(adapter)
    }
    this.log.info('gateway started', { event: 'gateway_started' })
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false

    for (const [platform, adapter] of this.adapters) {
      try {
        await adapter.destroy()
        this.log.info('adapter stopped', {
          event: 'adapter_stopped',
          platform,
        })
      } catch (err) {
        this.log.error('failed to stop adapter', {
          event: 'adapter_stop_failed',
          platform,
          error: err,
        })
      }
    }
    this.adapters.clear()
  }

  private wireAdapter(adapter: PlatformAdapter): void {
    adapter.onMessage(async (msg: IncomingMessage) => {
      const isCommand = msg.text.trim().startsWith('/')
      if (isCommand) {
        const handled = await this.commands.handleCommand(adapter, msg)
        if (handled) return
      }
      await this.router.route(adapter, msg)
    })

    adapter.onButtonPress(async (press: ButtonPress) => {
      await this.handleButtonPress(adapter.platform, press)
    })

    this.log.info('adapter registered', {
      event: 'adapter_registered',
      platform: adapter.platform,
      capabilities: adapter.capabilities,
    })
  }

  // -------------------------------------------------------------------------
  // Event handling (called by fan-out EventSink)
  // -------------------------------------------------------------------------

  onSessionEvent(channel: string, _target: PushTarget, ...args: any[]): void {
    if (channel !== RPC_CHANNELS.sessions.EVENT) return

    const event = args[0] as SessionEvent | undefined
    if (!event?.sessionId) return

    // If this session has a pending "accept & compact" that is now finishing
    // compaction, dispatch the approval now. Before the fan-out so the
    // renderer's own `info:compaction_complete` path doesn't race.
    if (
      event.type === 'info' &&
      (event as { statusType?: string }).statusType === 'compaction_complete'
    ) {
      void this.finishPendingCompactAccept(event.sessionId)
    }

    // Drop stale permission prompts for this session. The agent halts while
    // a permission is pending, so any non-permission_request event implies
    // the prior prompt was resolved (from the desktop, an MCP allow-list,
    // remember-window auto-approval, etc.). Without this sweep the inline
    // keyboard stays live in Telegram and users keep tapping stale buttons,
    // which is the visible side of #726.
    this.sweepStalePermissions(event)

    const bindings = this.bindingStore.findBySession(event.sessionId)
    if (bindings.length === 0) return

    for (const binding of bindings) {
      const adapter = this.adapters.get(binding.platform)
      if (!adapter || !adapter.isConnected()) {
        this.log.warn('dropping session event — adapter not connected', {
          event: 'adapter_not_connected',
          sessionId: event.sessionId,
          platform: binding.platform,
          eventType: event.type,
        })
        continue
      }
      this.renderer.handle(event, binding, adapter).catch((err) => {
        this.log.error('renderer failed to emit event to chat', {
          event: 'renderer_failed',
          sessionId: event.sessionId,
          bindingId: binding.id,
          platform: binding.platform,
          channelId: binding.channelId,
          error: err,
        })
      })
    }
  }

  /**
   * Drop entries from `permissionMessages` whose requestId differs from the
   * event's current permission request (or all of them, for non-permission
   * events). For each dropped entry we also fire-and-forget a `clearButtons`
   * so Telegram won't deliver any further callbacks for the stale prompt.
   *
   * Same-requestId `permission_request` events are preserved so a re-render
   * (rare but possible when the renderer retries) doesn't blow away the
   * record we'd then need to re-create.
   */
  private sweepStalePermissions(event: SessionEvent): void {
    if (this.permissionMessages.size === 0) return

    const eventRequestId =
      event.type === 'permission_request'
        ? ((event.request as { requestId?: string } | undefined)?.requestId ?? null)
        : null

    for (const [requestId, record] of this.permissionMessages) {
      if (record.sessionId !== event.sessionId) continue
      if (requestId === eventRequestId) continue
      this.permissionMessages.delete(requestId)

      const adapter = this.adapters.get(record.platform)
      if (adapter?.clearButtons && adapter.isConnected()) {
        adapter.clearButtons(record.channelId, record.messageId).catch(() => {})
      }
      this.log.info('cleared stale permission prompt after agent moved on', {
        event: 'perm_prompt_cleared_stale',
        requestId,
        sessionId: record.sessionId,
        triggerEventType: event.type,
      })
    }
  }

  // -------------------------------------------------------------------------
  // Button handling
  // -------------------------------------------------------------------------

  private async handleButtonPress(platform: PlatformType, press: ButtonPress): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return

    // Press metadata reused across all branches so responses post back into
    // the same topic (Telegram supergroup) the button was tapped from.
    const pressOpts = press.threadId !== undefined ? { threadId: press.threadId } : {}

    // Access gate. Inline buttons in supergroup topics are visible to
    // every member of the chat, so without this gate any non-owner could
    // tap `bind:`/`perm:`/`plan:` and bypass the text-side filter. The
    // text path is locked but callbacks would not be — that's exactly
    // the "looks locked but isn't" UX the access control is meant to
    // prevent.
    const allowed = await this.gateButtonPress(adapter, press)
    if (!allowed) return

    if (press.buttonId.startsWith('bind:')) {
      const sessionId = press.buttonId.slice('bind:'.length)
      const session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        await adapter.sendText(press.channelId, 'Session not found.', pressOpts)
        return
      }

      this.bindingStore.bind(
        this.workspaceId,
        session.id,
        platform,
        press.channelId,
        undefined,
        undefined,
        press.threadId,
      )

      await adapter.sendText(
        press.channelId,
        `Bound to "${session.name || session.id}"`,
        pressOpts,
      )
      return
    }

    if (press.buttonId.startsWith('perm:')) {
      if (platform === 'whatsapp') {
        this.log.warn('ignored chat-side permission interaction for WhatsApp', {
          event: 'whatsapp_permission_button_ignored',
          channelId: press.channelId,
          buttonId: press.buttonId,
        })
        await adapter.sendText(
          press.channelId,
          '⏸ Permission required. Approve it in the desktop app to continue.',
          pressOpts,
        )
        return
      }

      await this.handlePermissionButton(adapter, press)
      return
    }

    if (press.buttonId.startsWith('plan:')) {
      await this.handlePlanButton(platform, adapter, press)
      return
    }
  }

  /**
   * Handle an inline `perm:allow:<id>` / `perm:deny:<id>` press.
   *
   * Brought to parity with `handlePlanButton` (#726): claim the prompt via
   * `permissionMessages.delete()` before any visible action so a second tap
   * silently no-ops, clear the inline keyboard so Telegram won't even
   * deliver further callbacks for it, and only post the user-facing
   * `✅ Allowed / ❌ Denied` confirmation when `respondToPermission` reports
   * the response was actually delivered to a live agent.
   */
  private async handlePermissionButton(
    adapter: PlatformAdapter,
    press: ButtonPress,
  ): Promise<void> {
    const startedAt = Date.now()
    const pressOpts = press.threadId !== undefined ? { threadId: press.threadId } : {}

    const parts = press.buttonId.split(':')
    const action = parts[1]
    const requestId = parts[2]
    if (!requestId || (action !== 'allow' && action !== 'deny')) return

    // Idempotency claim: remove the entry up-front. A concurrent second tap
    // (or a race with the stale-prompt sweep in onSessionEvent) finds nothing
    // here and exits silently — no duplicate "✅ Allowed" message.
    const record = this.permissionMessages.get(requestId)
    if (!record) {
      this.log.info('perm press dropped: no live prompt for requestId', {
        event: 'perm_press_stale',
        requestId,
        channelId: press.channelId,
        senderId: press.senderId,
      })
      return
    }
    this.permissionMessages.delete(requestId)

    // Clear the inline keyboard before doing anything else so Telegram won't
    // deliver further callbacks for this prompt at all.
    if (adapter.clearButtons) {
      await adapter.clearButtons(record.channelId, record.messageId).catch(() => {})
    }

    const allowed = action === 'allow'
    const delivered = this.sessionManager.respondToPermission(
      record.sessionId,
      requestId,
      allowed,
      false,
    )

    this.log.info('perm response routed to session manager', {
      event: 'perm_response_routed',
      requestId,
      sessionId: record.sessionId,
      action,
      delivered,
      elapsedMs: Date.now() - startedAt,
    })

    if (!delivered) {
      // Session/agent gone or the prompt was already resolved by another
      // channel between our `permissionMessages.get()` and here. Don't post a
      // misleading "✅ Allowed" — the action did not take effect on this side.
      return
    }

    await adapter.sendText(press.channelId, allowed ? '✅ Allowed' : '❌ Denied', pressOpts)
  }

  private async handlePlanButton(
    platform: PlatformType,
    adapter: PlatformAdapter,
    press: ButtonPress,
  ): Promise<void> {
    const parts = press.buttonId.split(':')
    const action = parts[1]
    const token = parts[2]
    if (!token || (action !== 'accept' && action !== 'compact')) return

    const pressOpts = press.threadId !== undefined ? { threadId: press.threadId } : {}

    const entry = this.planTokens.resolve(token)
    if (!entry) {
      await adapter.sendText(
        press.channelId,
        '⚠️ This plan has expired. Retry from the desktop app.',
        pressOpts,
      )
      return
    }

    // Disable the buttons so the user can't tap twice. Non-fatal if it fails.
    const record = this.planMessages.get(token)
    if (record && adapter.clearButtons) {
      await adapter.clearButtons(record.channelId, record.messageId).catch(() => {})
    }

    this.planTokens.revoke(token)
    this.planMessages.delete(token)

    if (action === 'accept') {
      try {
        await this.sessionManager.acceptPlan(entry.sessionId, entry.planPath)
        await adapter.sendText(press.channelId, '✅ Plan accepted. Agent resuming.', pressOpts)
      } catch (err) {
        this.log.error('acceptPlan failed', {
          event: 'plan_accept_failed',
          sessionId: entry.sessionId,
          error: err,
        })
        await adapter.sendText(
          press.channelId,
          '❌ Couldn\'t accept the plan. Check the desktop app.',
          pressOpts,
        )
      }
      return
    }

    // action === 'compact': persist the "waiting for compaction" intent, send
    // /compact, and let onSessionEvent → finishPendingCompactAccept dispatch
    // the approval once compaction finishes.
    const binding = this.bindingStore.findByChannel(platform, press.channelId, press.threadId)
    if (!binding) return

    this.pendingCompactAccepts.set(entry.sessionId, {
      token,
      sessionId: entry.sessionId,
      bindingId: binding.id,
      platform,
      channelId: press.channelId,
      ...(press.threadId !== undefined ? { threadId: press.threadId } : {}),
      messageId: record?.messageId ?? '',
      planPath: entry.planPath,
      createdAt: Date.now(),
    })

    try {
      await this.sessionManager.setPendingPlanExecution(entry.sessionId, entry.planPath)
      await this.sessionManager.sendMessage(entry.sessionId, '/compact')
      await adapter.sendText(
        press.channelId,
        '♻️ Compacting conversation, then executing the plan…',
        pressOpts,
      )
    } catch (err) {
      this.pendingCompactAccepts.delete(entry.sessionId)
      this.log.error('compact dispatch failed', {
        event: 'plan_compact_failed',
        sessionId: entry.sessionId,
        error: err,
      })
      await adapter.sendText(
        press.channelId,
        '❌ Couldn\'t start compaction. Check the desktop app.',
        pressOpts,
      )
    }
  }

  /**
   * Decide whether a button press may proceed. `bind:` is workspace-owner
   * only (matches the `/bind` text command); `perm:` and `plan:` are gated
   * by the binding's access policy (matches the routing-time check in
   * Router.route). Bot senders are silent-dropped before any other logic.
   *
   * Returns true to proceed, false on reject (caller must return early).
   * The reject path emits the friendly reply and records the sender in
   * the pending-senders store via the shared `executeRejection` helper.
   */
  private async gateButtonPress(
    adapter: PlatformAdapter,
    press: ButtonPress,
  ): Promise<boolean> {
    const senderShape: import('./access-control').RejectableSender = {
      platform: press.platform,
      channelId: press.channelId,
      ...(press.threadId !== undefined ? { threadId: press.threadId } : {}),
      senderId: press.senderId,
      ...(press.senderName ? { senderName: press.senderName } : {}),
      ...(press.senderUsername ? { senderUsername: press.senderUsername } : {}),
    }

    let verdict: import('./access-control').AccessDecision
    let extra: { bindingId?: string; sessionId?: string } = {}

    if (press.buttonId.startsWith('bind:')) {
      // `bind:` runs the same gate as the `/bind` text command — the
      // operator who emitted the keyboard is offering session-binding
      // privileges, but only owners may take them.
      verdict = evaluatePreBindingAccess({
        msg: this.synthesizeMsgForGate(press),
        workspaceConfig: this.accessDeps.getWorkspaceConfig(),
      })
    } else if (
      press.buttonId.startsWith('perm:') ||
      press.buttonId.startsWith('plan:')
    ) {
      // `perm:`/`plan:` are session-level approvals; the sender must have
      // routing access to the binding the button was attached to.
      const binding = this.bindingStore.findByChannel(
        press.platform,
        press.channelId,
        press.threadId,
      )
      if (!binding) {
        // No binding to evaluate against — fall through to the existing
        // "not bound" handling in the caller (which will silently no-op
        // for perm/plan since they require a binding lookup anyway).
        return true
      }
      extra = { bindingId: binding.id, sessionId: binding.sessionId }
      verdict = evaluateBindingAccess({
        msg: this.synthesizeMsgForGate(press),
        workspaceConfig: this.accessDeps.getWorkspaceConfig(),
        binding,
      })
    } else {
      // Unknown button prefix — let the caller handle it.
      return true
    }

    if (verdict.allow) return true

    await executeRejection(
      adapter,
      senderShape,
      verdict.reason,
      {
        recentRejectReplies: this.buttonRecentRejectReplies,
        pendingStore: this.pendingStore,
      },
      this.log,
      extra,
    )
    return false
  }

  /**
   * Build the minimum `IncomingMessage` shape the access evaluators read.
   * The evaluators only consult `platform`, `senderId`, `senderIsBot` —
   * everything else is dummy/empty for the button-press path.
   */
  private synthesizeMsgForGate(press: ButtonPress): IncomingMessage {
    return {
      platform: press.platform,
      channelId: press.channelId,
      ...(press.threadId !== undefined ? { threadId: press.threadId } : {}),
      messageId: press.messageId,
      senderId: press.senderId,
      ...(press.senderName ? { senderName: press.senderName } : {}),
      ...(press.senderUsername ? { senderUsername: press.senderUsername } : {}),
      ...(press.senderIsBot ? { senderIsBot: true } : {}),
      text: '',
      timestamp: Date.now(),
      raw: press,
    }
  }

  private async finishPendingCompactAccept(sessionId: string): Promise<void> {
    const entry = this.pendingCompactAccepts.get(sessionId)
    if (!entry) return
    this.pendingCompactAccepts.delete(sessionId)

    if (Date.now() - entry.createdAt > COMPACT_ACCEPT_TTL_MS) {
      this.log.warn('dropping stale compact-accept entry', {
        event: 'plan_compact_stale',
        sessionId,
      })
      return
    }

    const adapter = this.adapters.get(entry.platform)
    const opts = entry.threadId !== undefined ? { threadId: entry.threadId } : {}
    try {
      await this.sessionManager.acceptPlan(sessionId, entry.planPath)
      await this.sessionManager.clearPendingPlanExecution(sessionId)
      if (adapter?.isConnected()) {
        await adapter.sendText(entry.channelId, '✅ Plan executing after compaction.', opts)
      }
    } catch (err) {
      this.log.error('post-compaction acceptPlan failed', {
        event: 'plan_post_compact_accept_failed',
        sessionId,
        error: err,
      })
      if (adapter?.isConnected()) {
        await adapter.sendText(
          entry.channelId,
          '❌ Compaction finished but the plan couldn\'t execute. Check the desktop app.',
          opts,
        )
      }
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getBindingStore(): BindingStore {
    return this.bindingStore
  }

  getPendingStore(): PendingSendersStore {
    return this.pendingStore
  }

  isStarted(): boolean {
    return this.started
  }
}
