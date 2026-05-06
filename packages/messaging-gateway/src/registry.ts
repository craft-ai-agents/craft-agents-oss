/**
 * MessagingGatewayRegistry — owns per-workspace MessagingGateway instances.
 *
 * Responsibilities:
 *   - Satisfies IMessagingGatewayRegistry for the RPC handlers in server-core.
 *   - Acts as a single EventSink consumer fanning session events to the right gateway.
 *   - Owns the in-memory pairing code manager (shared across workspaces; codes are workspace-scoped).
 *   - Owns per-workspace MessagingConfig (messaging/config.json).
 *   - Owns platform adapter lifecycle (initialize/swap/destroy) via CredentialManager.
 *
 * The registry is constructed once, wired into HandlerDeps, then populated with
 * gateways via initializeWorkspace() for every workspace that has messaging enabled.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { PushTarget } from '@craft-agent/shared/protocol'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import type {
  ISessionManager,
  IMessagingGatewayRegistry,
  MessagingBindingInfo,
  MessagingConfigInfo,
} from '@craft-agent/server-core/handlers'

import { MessagingGateway } from './gateway'
import { ConfigStore } from './config-store'
import { PairingCodeManager } from './pairing'
import { TelegramAdapter } from './adapters/telegram/index'
import { WhatsAppAdapter, type WhatsAppEvent } from './adapters/whatsapp/index'
import { LarkAdapter, parseLarkCredentials, type LarkCredentials } from './adapters/lark/index'
import { TopicRegistry } from './topic-registry'
import type { SessionEvent } from './renderer'
import type { EventSinkFn } from './event-fanout'
import type {
  BindingAccessMode,
  ChannelBinding,
  MessagingConfig,
  MessagingLogger,
  MessagingPlatformRuntimeInfo,
  PendingSender,
  PlatformAccessMode,
  PlatformOwner,
  PlatformType,
} from './types'

const consoleLogger: MessagingLogger = {
  info: (message, meta) => console.log('[MessagingRegistry]', message, meta ?? ''),
  warn: (message, meta) => console.warn('[MessagingRegistry]', message, meta ?? ''),
  error: (message, meta) => console.error('[MessagingRegistry]', message, meta ?? ''),
  child(context) {
    return {
      info: (message, meta) => console.log('[MessagingRegistry]', context, message, meta ?? ''),
      warn: (message, meta) => console.warn('[MessagingRegistry]', context, message, meta ?? ''),
      error: (message, meta) => console.error('[MessagingRegistry]', context, message, meta ?? ''),
      child: (next) => consoleLogger.child({ ...context, ...next }),
    }
  },
}

export interface MessagingGatewayRegistryOptions {
  sessionManager: ISessionManager
  credentialManager: CredentialManager
  /** Absolute path to the messaging storage directory for the given workspace. */
  getMessagingDir: (workspaceId: string) => string
  /** Optional legacy messaging dir (pre-relocation) for one-shot migration. */
  getLegacyMessagingDir?: (workspaceId: string) => string | undefined
  /** Broadcasts an RPC push event to UI clients. No-op if undefined. */
  publishEvent?: (channel: string, target: PushTarget, ...args: unknown[]) => void
  /** Optional WhatsApp worker config — required to enable the WhatsApp adapter. */
  whatsapp?: {
    /** Absolute path to the worker entry (packaged/unpacked from @craft-agent/messaging-whatsapp-worker). */
    workerEntry: string
    /** Node binary override (defaults to process.execPath with ELECTRON_RUN_AS_NODE). */
    nodeBin?: string
    /** Pairing flow: 'qr' or 'code'. Defaults to 'code' (phone-number based). */
    pairingMode?: 'qr' | 'code'
  }
  /** Optional logger — shared with the gateway and adapters. */
  logger?: MessagingLogger
}

interface WorkspaceState {
  gateway: MessagingGateway
  configStore: ConfigStore
  topicRegistry: TopicRegistry
  botUsernames: Partial<Record<PlatformType, string>>
  whatsapp: WhatsAppAdapter | null
  whatsappOffEvent?: () => void
  runtime: Record<PlatformType, MessagingPlatformRuntimeInfo>
}

export class MessagingGatewayRegistry implements IMessagingGatewayRegistry {
  private readonly workspaces = new Map<string, WorkspaceState>()
  private readonly pairing = new PairingCodeManager()
  private readonly log: MessagingLogger

  constructor(private readonly opts: MessagingGatewayRegistryOptions) {
    this.log = (opts.logger ?? consoleLogger).child({ component: 'registry' })

    // Install the automation→topic binder hook on the SessionManager so
    // executePromptAutomation can route topic-bound sessions without the
    // SessionManager needing to import this package (avoids a package-level
    // circular dependency).
    opts.sessionManager.setAutomationBinder?.(async (input) => {
      const result = await this.bindAutomationSession(input)
      if (!result.ok) {
        this.log.info('automation topic bind skipped', {
          event: 'automation_topic_bind_skipped',
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          topicName: input.topicName,
          reason: result.reason,
          error: result.error,
        })
      }
    })
  }

  // -------------------------------------------------------------------------
  // Public registry lifecycle (called by the app bootstrap)
  // -------------------------------------------------------------------------

  async initializeWorkspace(workspaceId: string): Promise<void> {
    if (this.workspaces.has(workspaceId)) return

    const state = this.bootstrapWorkspace(workspaceId)
    const config = state.configStore.get()
    if (!config.enabled) return

    await state.gateway.start()
    this.log.info('gateway started for workspace', {
      event: 'gateway_started',
      workspaceId,
    })

    if (isPlatformConfigured(config, 'telegram')) {
      this.setPlatformRuntime(workspaceId, state, 'telegram', {
        configured: true,
        connected: false,
        state: 'connecting',
        lastError: undefined,
      })
      void this.tryConnectTelegram(workspaceId, state).catch((err) => {
        this.log.error('background Telegram connect failed', {
          event: 'telegram_connect_failed',
          workspaceId,
          error: err,
        })
      })
    }

    if (isPlatformConfigured(config, 'lark')) {
      this.setPlatformRuntime(workspaceId, state, 'lark', {
        configured: true,
        connected: false,
        state: 'connecting',
        lastError: undefined,
      })
      void this.tryConnectLark(workspaceId, state).catch((err) => {
        this.log.error('background Lark connect failed', {
          event: 'lark_connect_failed',
          workspaceId,
          error: err,
        })
      })
    }

    if (isPlatformConfigured(config, 'whatsapp')) {
      if (this.hasWhatsAppAuthState(workspaceId)) {
        this.setPlatformRuntime(workspaceId, state, 'whatsapp', {
          configured: true,
          connected: false,
          state: 'connecting',
          lastError: undefined,
        })
        void this.startWhatsAppAdapter(workspaceId, state, { persistConfig: false, reason: 'restore' }).catch((err) => {
          this.log.error('background WhatsApp restore failed', {
            event: 'whatsapp_restore_failed',
            workspaceId,
            error: err,
          })
          this.setPlatformRuntime(workspaceId, state, 'whatsapp', {
            configured: true,
            connected: false,
            state: 'error',
            lastError: err instanceof Error ? err.message : String(err),
          })
        })
      } else {
        this.setPlatformRuntime(workspaceId, state, 'whatsapp', {
          configured: true,
          connected: false,
          state: 'reconnect_required',
          lastError: 'WhatsApp needs to be linked again.',
        })
      }
    }
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    const state = this.workspaces.get(workspaceId)
    if (!state) return
    await state.gateway.stop()
    this.pairing.clearWorkspace(workspaceId)
    this.workspaces.delete(workspaceId)
  }

  async stopAll(): Promise<void> {
    const stops = Array.from(this.workspaces.values()).map((s) => s.gateway.stop().catch(() => {}))
    await Promise.all(stops)
    this.workspaces.clear()
  }

  get size(): number {
    return this.workspaces.size
  }

  // -------------------------------------------------------------------------
  // IMessagingGatewayRegistry — config
  // -------------------------------------------------------------------------

  getConfig(workspaceId: string): MessagingConfigInfo | null {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const cfg = state.configStore.get()
    return {
      enabled: cfg.enabled,
      platforms: cfg.platforms as MessagingConfigInfo['platforms'],
      runtime: {
        telegram: cloneRuntime(state.runtime.telegram),
        whatsapp: cloneRuntime(state.runtime.whatsapp),
        lark: cloneRuntime(state.runtime.lark),
      },
    }
  }

  async updateConfig(
    workspaceId: string,
    partial: Partial<MessagingConfigInfo>,
  ): Promise<void> {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    state.configStore.update({
      enabled: partial.enabled,
      platforms: partial.platforms,
    } as never)

    const cfg = state.configStore.get()
    if (!cfg.enabled) {
      await state.gateway.unregisterAdapter('telegram').catch(() => {})
      await state.gateway.unregisterAdapter('whatsapp').catch(() => {})
      await state.gateway.unregisterAdapter('lark').catch(() => {})
      state.whatsappOffEvent?.()
      state.whatsappOffEvent = undefined
      state.whatsapp = null
      this.setPlatformRuntime(workspaceId, state, 'telegram', {
        configured: false,
        connected: false,
        state: 'disconnected',
        identity: undefined,
        lastError: undefined,
      })
      this.setPlatformRuntime(workspaceId, state, 'whatsapp', {
        configured: false,
        connected: false,
        state: 'disconnected',
        identity: undefined,
        lastError: undefined,
      })
      this.setPlatformRuntime(workspaceId, state, 'lark', {
        configured: false,
        connected: false,
        state: 'disconnected',
        identity: undefined,
        lastError: undefined,
      })
      return
    }

    for (const platform of ['telegram', 'whatsapp', 'lark'] as const) {
      const configured = isPlatformConfigured(cfg, platform)
      if (!configured && state.gateway.getAdapter(platform)) {
        await state.gateway.unregisterAdapter(platform).catch(() => {})
      }
      if (!configured && platform === 'whatsapp') {
        state.whatsappOffEvent?.()
        state.whatsappOffEvent = undefined
        state.whatsapp = null
      }
      if (!configured) {
        this.setPlatformRuntime(workspaceId, state, platform, {
          configured: false,
          connected: false,
          state: 'disconnected',
          identity: undefined,
          lastError: undefined,
        })
      }
    }
  }

  // -------------------------------------------------------------------------
  // IMessagingGatewayRegistry — bindings
  // -------------------------------------------------------------------------

  getBindings(workspaceId: string): MessagingBindingInfo[] {
    const state = this.workspaces.get(workspaceId)
    if (!state) return []
    return state.gateway.getBindingStore().getAll().map(toBindingInfo)
  }

  unbindSession(workspaceId: string, sessionId: string, platform?: string): void {
    const state = this.workspaces.get(workspaceId)
    if (!state) return
    const removed = state.gateway
      .getBindingStore()
      .unbindSession(sessionId, platform as PlatformType | undefined)
    if (removed > 0) this.emitBindingChanged(workspaceId)
  }

  unbindBinding(workspaceId: string, bindingId: string): boolean {
    const state = this.workspaces.get(workspaceId)
    if (!state) return false
    const removed = state.gateway.getBindingStore().unbindById(bindingId)
    if (removed) this.emitBindingChanged(workspaceId)
    return removed
  }

  // -------------------------------------------------------------------------
  // IMessagingGatewayRegistry — pairing
  // -------------------------------------------------------------------------

  generatePairingCode(
    workspaceId: string,
    sessionId: string,
    platform: string,
  ): { code: string; expiresAt: number; botUsername?: string } {
    if (!isKnownPlatform(platform)) {
      throw new Error(`Unknown messaging platform: ${platform}`)
    }
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    if (!state.gateway.hasConnectedAdapter(platform)) {
      throw new Error(`${capitalize(platform)} is not connected`)
    }
    const gen = this.pairing.generate(workspaceId, sessionId, platform)
    this.log.info('pairing code generated', {
      event: 'pairing_generated',
      workspaceId,
      sessionId,
      platform,
      expiresAt: gen.expiresAt,
    })
    return {
      code: gen.code,
      expiresAt: gen.expiresAt,
      botUsername: state.botUsernames[platform],
    }
  }

  /**
   * Issue a workspace-supergroup pairing code. The user types
   * `/pair <code>` from any topic of the desired Telegram supergroup; the
   * bot captures `chat.id` and persists it as the workspace's accepted
   * supergroup, after which the adapter starts accepting messages from it.
   */
  generateSupergroupPairingCode(
    workspaceId: string,
    platform: string,
  ): { code: string; expiresAt: number; botUsername?: string } {
    if (!isKnownPlatform(platform)) {
      throw new Error(`Unknown messaging platform: ${platform}`)
    }
    if (platform !== 'telegram') {
      throw new Error('Workspace-supergroup pairing is only supported on Telegram.')
    }
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    if (!state.gateway.hasConnectedAdapter(platform)) {
      throw new Error(`${capitalize(platform)} is not connected`)
    }
    const gen = this.pairing.generateForSupergroup(workspaceId, platform)
    this.log.info('supergroup pairing code generated', {
      event: 'pairing_generated',
      kind: 'workspace-supergroup',
      workspaceId,
      platform,
      expiresAt: gen.expiresAt,
    })
    return {
      code: gen.code,
      expiresAt: gen.expiresAt,
      botUsername: state.botUsernames[platform],
    }
  }

  /**
   * Persist a paired supergroup at the workspace level and tell the running
   * adapter to start accepting its messages. Called from the gateway's
   * `pairingConsumer.bindWorkspaceSupergroup` hook after the user types
   * `/pair <code>` in the group, and also reachable directly via RPC for
   * future programmatic flows.
   */
  async bindWorkspaceSupergroup(
    workspaceId: string,
    platform: PlatformType,
    chatId: string,
    fallbackTitle?: string,
  ): Promise<{ title: string }> {
    if (platform !== 'telegram') {
      throw new Error('Workspace-supergroup pairing is only supported on Telegram.')
    }
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const adapter = state.gateway.getAdapter('telegram') as TelegramAdapter | undefined
    if (!adapter) {
      throw new Error('Telegram adapter is not running. Connect the bot first.')
    }

    // Validate the chat is actually a forum supergroup before binding.
    // Without this, `/pair` typed in a DM (or a basic group, or a regular
    // supergroup without topics) "succeeds" at command level but breaks
    // downstream when `createForumTopic` runs — Telegram returns
    // `400: Bad Request: the chat is not a forum`.
    const info = await adapter.getChatInfo(chatId)
    if (!info) {
      throw new Error(
        'Cannot pair as supergroup: unable to read chat metadata. ' +
          'The bot may have been removed from the chat or lost permission to read it.',
      )
    }
    if (info.type !== 'supergroup') {
      throw new Error(
        `Cannot pair as supergroup: chat type is "${info.type}" — must be a supergroup. ` +
          'DMs and basic groups cannot host topics.',
      )
    }
    if (!info.isForum) {
      throw new Error(
        'Cannot pair as supergroup: the supergroup does not have topics enabled. ' +
          'In Telegram, open the group → Edit → enable "Topics", then try /pair again.',
      )
    }

    const title = info.title || fallbackTitle || `Group ${chatId}`

    this.patchTelegramConfig(
      workspaceId,
      {
        enabled: true,
        supergroup: { chatId, title, capturedAt: Date.now() },
      },
      { ensureMessagingEnabled: true },
    )

    adapter.setAcceptedSupergroupChatId(chatId)
    this.log.info('workspace supergroup bound', {
      event: 'workspace_supergroup_bound',
      workspaceId,
      platform,
      chatId,
      title,
    })
    return { title }
  }

  /**
   * Forget the paired supergroup. Existing topic-bound bindings are kept on
   * disk (they reference chatId only) but stop matching inbound updates
   * because the adapter rejects messages from the chat. Reconnecting the
   * same supergroup later restores routing.
   */
  async unbindWorkspaceSupergroup(workspaceId: string): Promise<void> {
    const state = this.workspaces.get(workspaceId)
    if (!state) return
    const cfg = state.configStore.get()
    const tg = cfg.platforms.telegram
    if (!tg?.supergroup) return

    // Drop the supergroup field but keep owners / accessMode / enabled
    // intact. JSON.stringify drops `undefined` values, so this is
    // effectively a key-deletion.
    this.patchTelegramConfig(workspaceId, { supergroup: undefined })

    const adapter = state.gateway.getAdapter('telegram') as TelegramAdapter | undefined
    adapter?.setAcceptedSupergroupChatId(undefined)
    this.log.info('workspace supergroup unbound', {
      event: 'workspace_supergroup_unbound',
      workspaceId,
    })
  }

  /** Read accessor for the current paired supergroup, if any. */
  getWorkspaceSupergroup(workspaceId: string): { chatId: string; title: string; capturedAt: number } | null {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const sg = state.configStore.get().platforms.telegram?.supergroup
    return sg ? { ...sg } : null
  }

  /**
   * Bind a freshly-spawned automation session to a Telegram forum topic in
   * the workspace's paired supergroup. The topic is created on first use and
   * reused thereafter.
   *
   * Best-effort: returns a discriminated result instead of throwing so the
   * caller (SessionManager) can log + continue without blocking the session.
   */
  async bindAutomationSession(args: {
    workspaceId: string
    sessionId: string
    topicName: string
  }): Promise<
    | { ok: true; chatId: string; threadId: number; reused: boolean }
    | {
        ok: false
        reason: 'invalid-name' | 'no-supergroup' | 'no-adapter' | 'topic-create-failed'
        error?: string
      }
  > {
    const trimmed = args.topicName?.trim() ?? ''
    if (trimmed.length === 0 || trimmed.length > 128) {
      return { ok: false, reason: 'invalid-name' }
    }

    const state = this.workspaces.get(args.workspaceId) ?? this.bootstrapWorkspace(args.workspaceId)
    const supergroup = state.configStore.get().platforms.telegram?.supergroup
    if (!supergroup?.chatId) return { ok: false, reason: 'no-supergroup' }

    const adapter = state.gateway.getAdapter('telegram') as TelegramAdapter | undefined
    if (!adapter) return { ok: false, reason: 'no-adapter' }

    const beforeCacheHit = state.topicRegistry.get(trimmed)

    try {
      const entry = await state.topicRegistry.findOrCreate({
        topicName: trimmed,
        chatId: supergroup.chatId,
        createTopic: (name) => adapter.createForumTopic(supergroup.chatId, name),
      })

      state.gateway.getBindingStore().bind(
        args.workspaceId,
        args.sessionId,
        'telegram',
        entry.chatId,
        trimmed,
        undefined,
        entry.threadId,
      )
      this.emitBindingChanged(args.workspaceId)

      return {
        ok: true,
        chatId: entry.chatId,
        threadId: entry.threadId,
        reused: Boolean(beforeCacheHit),
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log.warn('automation topic bind failed', {
        event: 'automation_topic_bind_failed',
        workspaceId: args.workspaceId,
        sessionId: args.sessionId,
        topicName: trimmed,
        error: message,
      })
      return { ok: false, reason: 'topic-create-failed', error: message }
    }
  }

  /**
   * Drop a cached topic entry. Does NOT delete the topic in Telegram (the
   * bot has no signal that the user wants the history gone). Useful when
   * an automation is renamed/removed and the user wants the next use of
   * a topic name to create a fresh topic instead of reusing the cached one.
   */
  async removeAutomationTopic(workspaceId: string, topicName: string): Promise<void> {
    const state = this.workspaces.get(workspaceId)
    if (!state) return
    await state.topicRegistry.remove(topicName.trim())
  }

  // -------------------------------------------------------------------------
  // IMessagingGatewayRegistry — platform lifecycle
  // -------------------------------------------------------------------------

  async testTelegramToken(
    token: string,
  ): Promise<{ success: boolean; botName?: string; botUsername?: string; error?: string }> {
    if (!token || token.trim().length === 0) {
      return { success: false, error: 'Token is empty' }
    }
    try {
      const info = await fetchTelegramBotInfo(token.trim())
      if (!info.ok) {
        return { success: false, error: info.description ?? 'Invalid token' }
      }
      return {
        success: true,
        botName: info.result.first_name ?? info.result.username ?? 'bot',
        botUsername: info.result.username,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Network error',
      }
    }
  }

  async saveTelegramToken(workspaceId: string, token: string): Promise<void> {
    const trimmed = token.trim()
    if (!trimmed) throw new Error('Token is empty')

    const test = await this.testTelegramToken(trimmed)
    if (!test.success) throw new Error(test.error ?? 'Invalid token')

    await this.opts.credentialManager.set(
      {
        type: 'messaging_bearer',
        workspaceId,
        name: 'telegram',
      },
      { value: trimmed },
    )

    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    // Critical: must NOT replace platforms.telegram with `{ enabled: true }`
    // — that would wipe owners / accessMode / supergroup. Patch only the
    // `enabled` flag and let everything else survive.
    this.patchTelegramConfig(workspaceId, { enabled: true }, { ensureMessagingEnabled: true })

    this.setPlatformRuntime(workspaceId, state, 'telegram', {
      configured: true,
      connected: false,
      state: 'connecting',
      lastError: undefined,
    })

    await this.tryConnectTelegram(workspaceId, state)
    await state.gateway.start()
  }

  /**
   * Verify a Lark/Feishu App ID + App Secret pair by exchanging them for a
   * tenant access token. The Open Platform returns a structured error code
   * we forward to the user when the credentials are bad — saves a confused
   * round-trip through "Invalid token" guesses.
   */
  async testLarkCredentials(
    creds: LarkCredentials,
  ): Promise<{ success: boolean; botName?: string; error?: string }> {
    if (!creds.appId || !creds.appSecret) {
      return { success: false, error: 'App ID or App Secret is empty' }
    }
    try {
      const url =
        creds.domain === 'feishu'
          ? 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
          : 'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
      })
      const body = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string }
      if (body.code !== 0 || !body.tenant_access_token) {
        return { success: false, error: body.msg ?? 'Invalid credentials' }
      }
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Network error',
      }
    }
  }

  async saveLarkCredentials(workspaceId: string, creds: LarkCredentials): Promise<void> {
    if (!creds.appId || !creds.appSecret) throw new Error('App ID or App Secret is empty')
    if (creds.domain !== 'lark' && creds.domain !== 'feishu') {
      throw new Error('Domain must be "lark" or "feishu"')
    }

    const test = await this.testLarkCredentials(creds)
    if (!test.success) throw new Error(test.error ?? 'Invalid Lark credentials')

    await this.opts.credentialManager.set(
      {
        type: 'messaging_bearer',
        workspaceId,
        name: 'lark',
      },
      { value: JSON.stringify(creds) },
    )

    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    state.configStore.update({
      enabled: true,
      platforms: { lark: { enabled: true, domain: creds.domain } },
    })

    this.setPlatformRuntime(workspaceId, state, 'lark', {
      configured: true,
      connected: false,
      state: 'connecting',
      lastError: undefined,
    })

    await this.tryConnectLark(workspaceId, state)
    await state.gateway.start()
  }

  async disconnectPlatform(workspaceId: string, platform: string): Promise<void> {
    if (!isKnownPlatform(platform)) return
    const state = this.workspaces.get(workspaceId)
    if (!state) return

    if (platform === 'whatsapp') {
      state.whatsappOffEvent?.()
      state.whatsappOffEvent = undefined
      if (state.whatsapp) {
        await state.whatsapp.destroy().catch(() => {})
        state.whatsapp = null
      }
    }

    await state.gateway.unregisterAdapter(platform).catch(() => {})
    state.botUsernames[platform] = undefined
    this.pairing.clearWorkspace(workspaceId)

    // Preserve per-platform fields (owners / accessMode / supergroup for
    // telegram, selfChatMode for whatsapp, domain for lark) so reconnecting
    // doesn't surprise the operator with a reset to public. Use
    // `forgetPlatform` for the full wipe.
    const currentConfig = state.configStore.get()
    const currentPlatformConfig = currentConfig.platforms[platform] ?? { enabled: true }
    const nextPlatforms = {
      ...currentConfig.platforms,
      [platform]: { ...currentPlatformConfig, enabled: false },
    }
    const anyPlatformEnabled = Object.values(nextPlatforms).some((entry) => entry?.enabled)
    state.configStore.update({
      enabled: anyPlatformEnabled,
      platforms: nextPlatforms,
    })

    if (platform !== 'whatsapp') {
      await this.opts.credentialManager
        .delete({ type: 'messaging_bearer', workspaceId, name: platform })
        .catch(() => {})
    }

    this.setPlatformRuntime(workspaceId, state, platform, {
      configured: false,
      connected: false,
      state: 'disconnected',
      identity: undefined,
      lastError: undefined,
    })
  }

  async forgetPlatform(workspaceId: string, platform: string): Promise<void> {
    if (!isKnownPlatform(platform)) return
    await this.disconnectPlatform(workspaceId, platform)
    if (platform === 'whatsapp') {
      const authDir = this.getWhatsAppAuthStateDir(workspaceId)
      try {
        rmSync(authDir, { recursive: true, force: true })
        this.log.info('forgot WhatsApp auth state', {
          event: 'whatsapp_auth_forgotten',
          workspaceId,
          authDir,
        })
      } catch (err) {
        this.log.error('failed to forget WhatsApp auth state', {
          event: 'whatsapp_auth_forget_failed',
          workspaceId,
          authDir,
          error: err,
        })
        throw err
      }
    }
  }

  // -------------------------------------------------------------------------
  // WhatsApp — subprocess lifecycle
  // -------------------------------------------------------------------------

  async startWhatsAppConnect(workspaceId: string): Promise<void> {
    const waConfig = this.opts.whatsapp
    if (!waConfig) {
      throw new Error('WhatsApp support is not configured on this server')
    }
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    this.setPlatformRuntime(workspaceId, state, 'whatsapp', {
      configured: true,
      connected: false,
      state: 'connecting',
      lastError: undefined,
    })
    await this.startWhatsAppAdapter(workspaceId, state, { persistConfig: true, reason: 'user_connect' })
  }

  async submitWhatsAppPhone(workspaceId: string, phoneNumber: string): Promise<void> {
    const state = this.workspaces.get(workspaceId)
    if (!state?.whatsapp) {
      throw new Error('WhatsApp not started — call startWhatsAppConnect first')
    }
    const cleaned = phoneNumber.replace(/[^\d]/g, '')
    if (cleaned.length < 8) throw new Error('Phone number looks too short')
    await state.whatsapp.requestPairingCode(cleaned)
  }

  private async startWhatsAppAdapter(
    workspaceId: string,
    state: WorkspaceState,
    options: { persistConfig: boolean; reason: 'restore' | 'user_connect' },
  ): Promise<void> {
    const waConfig = this.opts.whatsapp
    if (!waConfig) {
      throw new Error('WhatsApp support is not configured on this server')
    }

    state.whatsappOffEvent?.()
    state.whatsappOffEvent = undefined
    if (state.whatsapp) {
      await state.whatsapp.destroy().catch(() => {})
      state.whatsapp = null
    }

    const adapter = new WhatsAppAdapter()
    state.whatsapp = adapter
    state.whatsappOffEvent = adapter.onEvent((ev) => this.onWhatsAppEvent(workspaceId, ev))

    // selfChatMode: default ON. Persisted to workspace config so it
    // survives restart and can be toggled later if the user wants pure
    // contact-only routing.
    const persistedCfg = state.configStore.get()
    const selfChatMode = persistedCfg.platforms.whatsapp?.selfChatMode ?? true

    await adapter.initialize({
      workerEntry: waConfig.workerEntry,
      nodeBin: waConfig.nodeBin,
      authStateDir: this.getWhatsAppAuthStateDir(workspaceId),
      pairingMode: waConfig.pairingMode ?? 'code',
      selfChatMode,
      logger: this.log.child({
        component: 'whatsapp-adapter',
        workspaceId,
        platform: 'whatsapp',
      }),
    })

    state.gateway.registerAdapter(adapter)
    if (options.persistConfig) {
      state.configStore.update({
        enabled: true,
        platforms: { whatsapp: { enabled: true, selfChatMode } },
      })
    }
    await state.gateway.start()
    this.log.info('WhatsApp adapter started', {
      event: 'whatsapp_adapter_started',
      workspaceId,
      reason: options.reason,
    })
  }

  private onWhatsAppEvent(workspaceId: string, event: WhatsAppEvent): void {
    const state = this.workspaces.get(workspaceId)
    if (!state) return

    this.opts.publishEvent?.(
      RPC_CHANNELS.messaging.WA_UI_EVENT,
      { to: 'workspace', workspaceId },
      { workspaceId, event },
    )

    switch (event.type) {
      case 'qr':
        this.setPlatformRuntime(workspaceId, state, 'whatsapp', {
          configured: true,
          connected: false,
          state: 'reconnect_required',
          lastError: 'QR scan required',
        })
        return
      case 'connected':
        this.setPlatformRuntime(workspaceId, state, 'whatsapp', {
          configured: true,
          connected: true,
          state: 'connected',
          identity: event.name ?? event.jid,
          lastError: undefined,
        })
        return
      case 'disconnected':
        this.setPlatformRuntime(workspaceId, state, 'whatsapp', {
          configured: true,
          connected: false,
          state: event.loggedOut ? 'reconnect_required' : 'disconnected',
          lastError: event.reason,
          identity: undefined,
        })
        return
      case 'unavailable':
        this.setPlatformRuntime(workspaceId, state, 'whatsapp', {
          configured: true,
          connected: false,
          state: 'error',
          lastError: event.message,
          identity: undefined,
        })
        return
      case 'error':
        if (!state.runtime.whatsapp.connected) {
          this.setPlatformRuntime(workspaceId, state, 'whatsapp', {
            configured: true,
            connected: false,
            state: 'error',
            lastError: event.message,
          })
        }
        return
      case 'pairing_code':
        return
    }
  }

  // -------------------------------------------------------------------------
  // EventSink-compatible callback
  // -------------------------------------------------------------------------

  onSessionEvent: EventSinkFn = (channel: string, target: PushTarget, ...args: unknown[]) => {
    if (channel !== RPC_CHANNELS.sessions.EVENT) return

    const event = args[0] as SessionEvent | undefined
    if (!event?.sessionId) return

    const workspaceId =
      'workspaceId' in target ? (target as { workspaceId: string }).workspaceId : undefined
    if (!workspaceId) {
      for (const state of this.workspaces.values()) {
        state.gateway.onSessionEvent(channel, target, ...args)
      }
      return
    }

    const state = this.workspaces.get(workspaceId)
    if (state) state.gateway.onSessionEvent(channel, target, ...args)
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private bootstrapWorkspace(workspaceId: string): WorkspaceState {
    const existing = this.workspaces.get(workspaceId)
    if (existing) return existing

    const storageDir = this.opts.getMessagingDir(workspaceId)
    const legacyStorageDir = this.opts.getLegacyMessagingDir?.(workspaceId)
    const baseLog = this.log.child({ workspaceId })
    const configStore = new ConfigStore(
      storageDir,
      legacyStorageDir,
      baseLog.child({ component: 'config-store' }),
    )
    const cfg = configStore.get()
    const gateway = new MessagingGateway({
      sessionManager: this.opts.sessionManager,
      workspaceId,
      storageDir,
      legacyStorageDir,
      logger: baseLog,
      pairingConsumer: {
        canConsume: (platform, senderId) =>
          this.pairing.canConsume(workspaceId, platform, senderId),
        consume: (platform, code) => {
          const entry = this.pairing.consume(workspaceId, platform, code)
          if (!entry) return null
          if (entry.kind === 'workspace-supergroup') {
            return { kind: 'workspace-supergroup', workspaceId: entry.workspaceId }
          }
          // entry.kind === 'session'
          if (!entry.sessionId) return null
          return { kind: 'session', workspaceId: entry.workspaceId, sessionId: entry.sessionId }
        },
        bindWorkspaceSupergroup: async ({ platform, chatId, fallbackTitle }) => {
          if (!isKnownPlatform(platform)) {
            throw new Error(`Unknown platform for supergroup pairing: ${platform}`)
          }
          return this.bindWorkspaceSupergroup(workspaceId, platform, chatId, fallbackTitle)
        },
      },
      // Read live config so accessMode/owner toggles take effect immediately.
      getWorkspaceConfig: () => configStore.get(),
      seedOwnerOnFirstPair: async (platform, candidate) =>
        this.seedFirstOwner(workspaceId, platform, candidate),
      onBindingChanged: () => this.emitBindingChanged(workspaceId),
      onPendingChanged: () => this.emitPendingChanged(workspaceId),
    })

    const topicRegistry = new TopicRegistry(
      storageDir,
      baseLog.child({ component: 'topic-registry' }),
    )

    const state: WorkspaceState = {
      gateway,
      configStore,
      topicRegistry,
      botUsernames: {},
      whatsapp: null,
      runtime: {
        telegram: createRuntime('telegram', isPlatformConfigured(cfg, 'telegram')),
        whatsapp: createRuntime('whatsapp', isPlatformConfigured(cfg, 'whatsapp')),
        lark: createRuntime('lark', isPlatformConfigured(cfg, 'lark')),
      },
    }
    this.workspaces.set(workspaceId, state)
    return state
  }

  private async tryConnectLark(workspaceId: string, state: WorkspaceState): Promise<void> {
    const cred = await this.opts.credentialManager
      .get({ type: 'messaging_bearer', workspaceId, name: 'lark' })
      .catch(() => null)

    if (!cred?.value) {
      this.setPlatformRuntime(workspaceId, state, 'lark', {
        configured: true,
        connected: false,
        state: 'error',
        lastError: 'Lark credentials are missing.',
      })
      return
    }

    let creds: LarkCredentials
    try {
      creds = parseLarkCredentials(cred.value)
    } catch (err) {
      this.setPlatformRuntime(workspaceId, state, 'lark', {
        configured: true,
        connected: false,
        state: 'error',
        lastError: err instanceof Error ? err.message : 'Lark credentials are malformed',
      })
      return
    }

    await state.gateway.unregisterAdapter('lark').catch((err) => {
      this.log.warn('unregisterAdapter(lark) failed (non-fatal)', {
        event: 'lark_unregister_failed',
        workspaceId,
        error: err,
      })
    })

    try {
      const adapter = new LarkAdapter()
      await adapter.initialize({
        token: cred.value,
        logger: this.log.child({
          component: 'lark-adapter',
          workspaceId,
          platform: 'lark',
        }),
      })

      try {
        const info = await adapter.getBotInfo()
        state.botUsernames.lark = info?.name
      } catch {
        // non-fatal
      }

      state.gateway.registerAdapter(adapter)
      this.setPlatformRuntime(workspaceId, state, 'lark', {
        configured: true,
        connected: true,
        state: 'connected',
        identity: state.botUsernames.lark ?? creds.domain,
        lastError: undefined,
      })
    } catch (err) {
      this.log.error('failed to connect Lark', {
        event: 'lark_connect_failed',
        workspaceId,
        error: err,
      })
      this.setPlatformRuntime(workspaceId, state, 'lark', {
        configured: true,
        connected: false,
        state: 'error',
        lastError: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  private async tryConnectTelegram(workspaceId: string, state: WorkspaceState): Promise<void> {
    const cred = await this.opts.credentialManager
      .get({ type: 'messaging_bearer', workspaceId, name: 'telegram' })
      .catch(() => null)

    if (!cred?.value) {
      this.setPlatformRuntime(workspaceId, state, 'telegram', {
        configured: true,
        connected: false,
        state: 'error',
        lastError: 'Telegram token is missing.',
      })
      return
    }

    await state.gateway.unregisterAdapter('telegram').catch((err) => {
      this.log.warn('unregisterAdapter(telegram) failed (non-fatal)', {
        event: 'telegram_unregister_failed',
        workspaceId,
        error: err,
      })
    })

    try {
      const adapter = new TelegramAdapter()
      const supergroupChatId = state.configStore.get().platforms.telegram?.supergroup?.chatId
      await adapter.initialize({
        token: cred.value,
        ...(supergroupChatId ? { acceptedSupergroupChatId: supergroupChatId } : {}),
        logger: this.log.child({
          component: 'telegram-adapter',
          workspaceId,
          platform: 'telegram',
        }),
      })

      try {
        const info = await adapter.getBotInfo()
        state.botUsernames.telegram = info?.username
      } catch {
        // non-fatal
      }

      state.gateway.registerAdapter(adapter)
      this.setPlatformRuntime(workspaceId, state, 'telegram', {
        configured: true,
        connected: true,
        state: 'connected',
        identity: state.botUsernames.telegram,
        lastError: undefined,
      })
    } catch (err) {
      this.log.error('failed to connect Telegram', {
        event: 'telegram_connect_failed',
        workspaceId,
        error: err,
      })
      this.setPlatformRuntime(workspaceId, state, 'telegram', {
        configured: true,
        connected: false,
        state: 'error',
        lastError: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  private setPlatformRuntime(
    workspaceId: string,
    state: WorkspaceState,
    platform: PlatformType,
    patch: Partial<MessagingPlatformRuntimeInfo>,
  ): void {
    const previous = state.runtime[platform] ?? createRuntime(platform, false)
    const next: MessagingPlatformRuntimeInfo = {
      ...previous,
      ...patch,
      platform,
      updatedAt: Date.now(),
    }
    state.runtime[platform] = next
    this.emitPlatformStatus(workspaceId, platform, next)
  }

  private emitBindingChanged(workspaceId: string): void {
    this.opts.publishEvent?.(
      RPC_CHANNELS.messaging.BINDING_CHANGED,
      { to: 'workspace', workspaceId },
      workspaceId,
    )
  }

  private emitPendingChanged(workspaceId: string): void {
    // Channel name kept symmetric with BINDING_CHANGED. Phase 3 wires the
    // RPC channel constant; for now this is a no-op when the constant is
    // absent.
    const channel = (
      RPC_CHANNELS.messaging as Record<string, string | undefined>
    ).PENDING_CHANGED
    if (!channel) return
    this.opts.publishEvent?.(
      channel,
      { to: 'workspace', workspaceId },
      workspaceId,
    )
  }

  // -------------------------------------------------------------------------
  // Access control — workspace owners + per-binding allow lists
  // -------------------------------------------------------------------------

  /**
   * Patch the Telegram platform config preserving any fields the caller
   * doesn't touch. Critical: every Telegram config write MUST go through
   * this helper — direct `configStore.update({ platforms: { telegram: {...} } })`
   * silently drops `owners` / `accessMode` / `supergroup` / `enabled` from
   * the persisted state because `ConfigStore.update` shallow-merges
   * `platforms` but replaces the per-platform value wholesale.
   *
   * `ensureMessagingEnabled` flips the top-level `enabled` flag to true
   * (used by save-token / connect flows). When false, `enabled` is
   * preserved as-is.
   */
  private patchTelegramConfig(
    workspaceId: string,
    patch: Partial<NonNullable<MessagingConfig['platforms']['telegram']>>,
    options: { ensureMessagingEnabled?: boolean } = {},
  ): MessagingConfig {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const cfg = state.configStore.get()
    const tg = cfg.platforms.telegram ?? { enabled: true }
    return state.configStore.update({
      enabled: options.ensureMessagingEnabled ? true : cfg.enabled,
      platforms: {
        ...cfg.platforms,
        telegram: { ...tg, ...patch },
      },
    })
  }

  /**
   * Append `candidate` to the platform's owners list iff the list is
   * currently empty. Returns the (possibly unchanged) list. Used by the
   * gateway's `/pair` flow to bootstrap the first owner.
   */
  private async seedFirstOwner(
    workspaceId: string,
    platform: PlatformType,
    candidate: PlatformOwner,
  ): Promise<PlatformOwner[]> {
    if (platform !== 'telegram') return []
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const cfg = state.configStore.get()
    const currentOwners = cfg.platforms.telegram?.owners ?? []
    if (currentOwners.length > 0) return currentOwners

    const nextOwners: PlatformOwner[] = [candidate]
    // Workspaces that haven't picked an explicit access mode default
    // to `owner-only` once an owner exists. Existing 'open' workspaces
    // are respected (the operator chose to stay public).
    this.patchTelegramConfig(workspaceId, {
      accessMode: cfg.platforms.telegram?.accessMode ?? 'owner-only',
      owners: nextOwners,
    })
    this.log.info('seeded first owner', {
      event: 'first_owner_seeded',
      workspaceId,
      platform,
      ownerId: candidate.userId,
    })
    return nextOwners
  }

  getPlatformOwners(workspaceId: string, platform: PlatformType): PlatformOwner[] {
    if (platform !== 'telegram') return []
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    return state.configStore.get().platforms.telegram?.owners ?? []
  }

  setPlatformOwners(
    workspaceId: string,
    platform: PlatformType,
    owners: PlatformOwner[],
  ): PlatformOwner[] {
    if (platform !== 'telegram') {
      throw new Error('Owner lists are only supported on Telegram in this build.')
    }
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    this.patchTelegramConfig(workspaceId, { owners: dedupeOwners(owners) })
    this.emitBindingChanged(workspaceId)
    return state.configStore.get().platforms.telegram?.owners ?? []
  }

  getPlatformAccessMode(workspaceId: string, platform: PlatformType): PlatformAccessMode {
    if (platform !== 'telegram') return 'open'
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    return state.configStore.get().platforms.telegram?.accessMode ?? 'open'
  }

  setPlatformAccessMode(
    workspaceId: string,
    platform: PlatformType,
    mode: PlatformAccessMode,
  ): void {
    if (platform !== 'telegram') {
      throw new Error('Access mode is only supported on Telegram in this build.')
    }
    this.patchTelegramConfig(workspaceId, { accessMode: mode })

    // Lock-down semantics: switching the workspace to `owner-only` must
    // also close any binding that's still in `open` mode, otherwise the
    // operator clicks "Lock down", the banner disappears, but legacy
    // bindings remain public — exactly the false-sense-of-security UX
    // the feature is supposed to prevent.
    if (mode === 'owner-only') {
      this.migrateOpenBindingsToInherit(workspaceId)
    }

    this.emitBindingChanged(workspaceId)
  }

  /**
   * Walk all Telegram bindings and flip any with `accessMode === 'open'`
   * to `inherit` (the safe default). Used when locking down the workspace.
   * Telegram-only — other platforms don't yet have per-binding access.
   */
  private migrateOpenBindingsToInherit(workspaceId: string): void {
    const state = this.workspaces.get(workspaceId)
    if (!state) return
    const store = state.gateway.getBindingStore()
    for (const b of store.getAll()) {
      if (b.platform !== 'telegram') continue
      if (b.config.accessMode !== 'open') continue
      store.updateBindingConfig(b.id, { accessMode: 'inherit', allowedSenderIds: [] })
    }
  }

  /** Pending senders surface in Settings → Messaging as "Pending requests". */
  getPendingSenders(workspaceId: string, platform?: PlatformType): PendingSender[] {
    const state = this.workspaces.get(workspaceId)
    if (!state) return []
    return state.gateway.getPendingStore().list(platform)
  }

  dismissPendingSender(
    workspaceId: string,
    platform: PlatformType,
    userId: string,
  ): boolean {
    const state = this.workspaces.get(workspaceId)
    if (!state) return false
    return state.gateway.getPendingStore().dismiss(platform, userId)
  }

  /**
   * Allow a pending sender. Behaviour depends on why the sender was
   * rejected:
   *
   * - `'not-owner'` (workspace-level reject) → add to platform `owners`.
   *   Result: sender can run pre-binding commands and inherits binding
   *   access for `accessMode === 'inherit'` bindings.
   * - `'not-on-binding-allowlist'` (binding-level reject) → append to
   *   that binding's `allowedSenderIds`. Workspace owners list is NOT
   *   touched — closing the privilege-escalation footgun where a Bob
   *   denied by a single sensitive binding would have been promoted to
   *   workspace owner.
   *
   * `entryKey` identifies the specific pending row (a sender may have
   * multiple — one per reason/binding combination). When omitted, the
   * earliest matching entry for the sender is used.
   */
  allowPendingSender(
    workspaceId: string,
    platform: PlatformType,
    userId: string,
    entryKey?: { reason?: PendingSender['reason']; bindingId?: string },
  ): { owners: PlatformOwner[]; bindingId?: string } {
    if (platform !== 'telegram') {
      throw new Error('Owner lists are only supported on Telegram in this build.')
    }
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const pending = state.gateway.getPendingStore().list(platform)
    const match = pending.find((p) =>
      p.userId === userId &&
      (entryKey?.reason === undefined ||
        (p.reason ?? 'not-owner') === entryKey.reason) &&
      (entryKey?.bindingId === undefined || p.bindingId === entryKey.bindingId),
    )
    if (!match) {
      throw new Error('Pending sender not found — they may have been dismissed.')
    }

    const reason = match.reason ?? 'not-owner'

    if (reason === 'not-on-binding-allowlist') {
      // Append to that specific binding's allow-list. Don't touch owners.
      const bindingId = match.bindingId
      if (!bindingId) {
        throw new Error('Pending entry is binding-scoped but has no bindingId.')
      }
      const store = state.gateway.getBindingStore()
      const binding = store.getAll().find((b) => b.id === bindingId)
      if (!binding) {
        // Binding was unbound between reject and Allow. Drop the stale
        // entry and surface a meaningful error so the operator knows to
        // re-pair if needed.
        store // (intentional no-op; keep store reference alive for tooling)
        state.gateway.getPendingStore().dismiss(platform, userId, {
          reason: 'not-on-binding-allowlist',
          bindingId,
        })
        throw new Error('Binding no longer exists — pending entry dismissed.')
      }
      const next = Array.from(new Set([...binding.config.allowedSenderIds, userId]))
      store.updateBindingConfig(bindingId, {
        allowedSenderIds: next,
        // Defensive: ensure the binding is in allow-list mode after
        // promotion. Otherwise a binding that was 'inherit' would still
        // ignore the new allowedSenderIds entry.
        accessMode: binding.config.accessMode === 'allow-list' ? 'allow-list' : 'allow-list',
      })
      state.gateway.getPendingStore().dismiss(platform, userId, {
        reason: 'not-on-binding-allowlist',
        bindingId,
      })
      this.emitBindingChanged(workspaceId)
      const owners = state.configStore.get().platforms.telegram?.owners ?? []
      return { owners, bindingId }
    }

    // reason === 'not-owner': promote to workspace owner.
    const cfg = state.configStore.get()
    const existing = cfg.platforms.telegram?.owners ?? []
    if (existing.some((o) => o.userId === userId)) {
      state.gateway.getPendingStore().dismiss(platform, userId)
      return { owners: existing }
    }
    const nextOwners: PlatformOwner[] = [
      ...existing,
      {
        userId: match.userId,
        ...(match.displayName ? { displayName: match.displayName } : {}),
        ...(match.username ? { username: match.username } : {}),
        addedAt: Date.now(),
      },
    ]
    const tg = cfg.platforms.telegram
    this.patchTelegramConfig(workspaceId, {
      owners: nextOwners,
      accessMode: tg?.accessMode ?? 'owner-only',
    })
    // Dismiss every pending row for this sender — they're now an owner,
    // so any binding-allow-list rejects pending against them have been
    // superseded by the inherit path.
    state.gateway.getPendingStore().dismiss(platform, userId)
    this.emitBindingChanged(workspaceId)
    return { owners: nextOwners }
  }

  /**
   * Update the access policy on a single binding. Uses the in-place
   * `updateBindingConfig` method so the binding's `id` and `createdAt`
   * survive — anything keyed on bindingId (audit logs, deep links, stale
   * renderer closures) keeps working.
   */
  setBindingAccess(
    workspaceId: string,
    bindingId: string,
    access: { mode: BindingAccessMode; allowedSenderIds?: string[] },
  ): void {
    const state = this.workspaces.get(workspaceId)
    if (!state) throw new Error('Workspace not initialised')
    const store = state.gateway.getBindingStore()
    const next = store.updateBindingConfig(bindingId, {
      accessMode: access.mode,
      allowedSenderIds:
        access.mode === 'allow-list' ? [...(access.allowedSenderIds ?? [])] : [],
    })
    if (!next) throw new Error('Binding not found')
    this.emitBindingChanged(workspaceId)
  }

  private emitPlatformStatus(
    workspaceId: string,
    platform: PlatformType,
    status: MessagingPlatformRuntimeInfo,
  ): void {
    this.opts.publishEvent?.(
      RPC_CHANNELS.messaging.PLATFORM_STATUS,
      { to: 'workspace', workspaceId },
      workspaceId,
      platform,
      cloneRuntime(status),
    )
  }

  private hasWhatsAppAuthState(workspaceId: string): boolean {
    const dir = this.getWhatsAppAuthStateDir(workspaceId)
    if (!existsSync(dir)) return false
    try {
      return readdirSync(dir).some((entry) => !entry.startsWith('.'))
    } catch {
      return false
    }
  }

  private getWhatsAppAuthStateDir(workspaceId: string): string {
    return join(this.opts.getMessagingDir(workspaceId), 'whatsapp-auth')
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBindingInfo(b: ChannelBinding): MessagingBindingInfo {
  return {
    id: b.id,
    workspaceId: b.workspaceId,
    sessionId: b.sessionId,
    platform: b.platform,
    channelId: b.channelId,
    ...(b.threadId !== undefined ? { threadId: b.threadId } : {}),
    channelName: b.channelName,
    enabled: b.enabled,
    createdAt: b.createdAt,
    accessMode: b.config.accessMode,
    allowedSenderIds: [...b.config.allowedSenderIds],
  }
}

function isKnownPlatform(p: string): p is PlatformType {
  return p === 'telegram' || p === 'whatsapp' || p === 'lark'
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1)
}

function isPlatformConfigured(
  config: { enabled: boolean; platforms: Record<string, { enabled: boolean } | undefined> },
  platform: PlatformType,
): boolean {
  return Boolean(config.enabled && config.platforms[platform]?.enabled)
}

function dedupeOwners(owners: PlatformOwner[]): PlatformOwner[] {
  const map = new Map<string, PlatformOwner>()
  for (const o of owners) {
    if (!o?.userId) continue
    map.set(o.userId, { ...o })
  }
  return Array.from(map.values())
}

function createRuntime(platform: PlatformType, configured: boolean): MessagingPlatformRuntimeInfo {
  return {
    platform,
    configured,
    connected: false,
    state: configured ? 'disconnected' : 'disconnected',
    updatedAt: Date.now(),
  }
}

function cloneRuntime(runtime: MessagingPlatformRuntimeInfo): MessagingPlatformRuntimeInfo {
  return { ...runtime }
}

async function fetchTelegramBotInfo(
  token: string,
): Promise<{ ok: boolean; result: { username?: string; first_name?: string }; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
  return (await res.json()) as {
    ok: boolean
    result: { username?: string; first_name?: string }
    description?: string
  }
}
