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
import type { SessionEvent } from './renderer'
import type { EventSinkFn } from './event-fanout'
import type { ChannelBinding, MessagingLogger, PlatformType } from './types'

const PREFIX = '[MessagingRegistry]'

/** Fallback logger if the host doesn't pass one. */
const consoleLogger: MessagingLogger = {
  info: (...args: unknown[]) => console.log(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
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
  /**
   * Optional logger — shared with the gateway and adapter. Pass the host
   * app's scoped logger (e.g. electron-log) so adapter/polling failures
   * surface in main.log instead of being dropped on stdout.
   */
  logger?: MessagingLogger
}

interface WorkspaceState {
  gateway: MessagingGateway
  configStore: ConfigStore
  botUsernames: Partial<Record<PlatformType, string>>
  whatsapp: WhatsAppAdapter | null
  whatsappOffEvent?: () => void
}

export class MessagingGatewayRegistry implements IMessagingGatewayRegistry {
  private readonly workspaces = new Map<string, WorkspaceState>()
  private readonly pairing = new PairingCodeManager()
  private readonly log: MessagingLogger

  constructor(private readonly opts: MessagingGatewayRegistryOptions) {
    this.log = opts.logger ?? consoleLogger
  }

  // -------------------------------------------------------------------------
  // Public registry lifecycle (called by the app bootstrap)
  // -------------------------------------------------------------------------

  /**
   * Populate the registry for a single workspace. Called at startup (iterating
   * over all workspaces) and on demand when messaging is first enabled.
   */
  async initializeWorkspace(workspaceId: string): Promise<void> {
    if (this.workspaces.has(workspaceId)) return

    const state = this.bootstrapWorkspace(workspaceId)
    const config = state.configStore.get()
    if (!config.enabled) return

    // Start the gateway synchronously so adapter wiring is ready. Telegram
    // connect talks to api.telegram.org (bot.init / deleteWebhook / polling)
    // and must NOT block the main-process bootstrap — a slow or unreachable
    // Telegram API would otherwise stall window creation. Fire-and-forget
    // with a catch that reaches main.log via the injected logger.
    await state.gateway.start()
    this.log.info(`${PREFIX} Gateway started for workspace ${workspaceId}`)

    if (config.platforms.telegram?.enabled) {
      void this.tryConnectTelegram(workspaceId, state).catch((err) => {
        this.log.error(
          `${PREFIX} Background Telegram connect failed for workspace ${workspaceId}:`,
          err,
        )
      })
    }
  }

  /** Tear down and remove a workspace. */
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
    }
  }

  async updateConfig(
    workspaceId: string,
    partial: Partial<MessagingConfigInfo>,
  ): Promise<void> {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    state.configStore.update(partial as never)

    // If messaging is disabled, stop everything. If re-enabled, callers must
    // re-save tokens to bring adapters back online — saveTelegramToken handles it.
    const cfg = state.configStore.get()
    if (!cfg.enabled) {
      await state.gateway.unregisterAdapter('telegram').catch(() => {})
      await state.gateway.unregisterAdapter('whatsapp').catch(() => {})
      this.emitPlatformStatus(workspaceId, 'telegram', false)
      this.emitPlatformStatus(workspaceId, 'whatsapp', false)
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
    // Ensure the workspace state exists so the /pair consumer can find it.
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const gen = this.pairing.generate(workspaceId, sessionId, platform)
    return {
      code: gen.code,
      expiresAt: gen.expiresAt,
      botUsername: state.botUsernames[platform],
    }
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

    // Ensure workspace state and config reflect Telegram being enabled.
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    state.configStore.update({
      enabled: true,
      platforms: { telegram: { enabled: true } },
    })

    await this.tryConnectTelegram(workspaceId, state)
    // Ensure the gateway is started (idempotent).
    await state.gateway.start()
  }

  async disconnectPlatform(workspaceId: string, platform: string): Promise<void> {
    if (!isKnownPlatform(platform)) return
    const state = this.workspaces.get(workspaceId)
    if (!state) return

    // WhatsApp owns its own adapter lifecycle (subprocess).
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

    // Update config.
    state.configStore.update({
      platforms: { [platform]: { enabled: false } },
    })

    // Remove credential (Telegram only — WhatsApp state lives in auth dir,
    // which is left in place so re-connecting from the same device is instant).
    if (platform !== 'whatsapp') {
      await this.opts.credentialManager
        .delete({ type: 'messaging_bearer', workspaceId, name: platform })
        .catch(() => {})
    }

    this.emitPlatformStatus(workspaceId, platform, false)
  }

  // -------------------------------------------------------------------------
  // WhatsApp — subprocess lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start (or restart) the WhatsApp worker for a workspace. Returns immediately;
   * progress (QR / pairing code / connected) is pushed via `WA_UI_EVENT`.
   */
  async startWhatsAppConnect(workspaceId: string): Promise<void> {
    const waConfig = this.opts.whatsapp
    if (!waConfig) {
      throw new Error('WhatsApp support is not configured on this server')
    }
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)

    // Tear down any previous attempt.
    state.whatsappOffEvent?.()
    state.whatsappOffEvent = undefined
    if (state.whatsapp) {
      await state.whatsapp.destroy().catch(() => {})
      state.whatsapp = null
    }

    const adapter = new WhatsAppAdapter()
    state.whatsapp = adapter
    state.whatsappOffEvent = adapter.onEvent((ev) => this.onWhatsAppEvent(workspaceId, ev))

    await adapter.initialize({
      workerEntry: waConfig.workerEntry,
      nodeBin: waConfig.nodeBin,
      authStateDir: `${this.opts.getMessagingDir(workspaceId)}/whatsapp-auth`,
      pairingMode: waConfig.pairingMode ?? 'code',
    })

    // Register so outbound messages flow through the gateway.
    state.gateway.registerAdapter(adapter)
    state.configStore.update({
      enabled: true,
      platforms: { whatsapp: { enabled: true } },
    })
    await state.gateway.start()
  }

  /**
   * Submit a phone number for pairing-code mode. The worker will emit a
   * `pairing_code` event which is broadcast to the UI via `WA_UI_EVENT`.
   */
  async submitWhatsAppPhone(workspaceId: string, phoneNumber: string): Promise<void> {
    const state = this.workspaces.get(workspaceId)
    if (!state?.whatsapp) {
      throw new Error('WhatsApp not started — call startWhatsAppConnect first')
    }
    const cleaned = phoneNumber.replace(/[^\d]/g, '')
    if (cleaned.length < 8) throw new Error('Phone number looks too short')
    await state.whatsapp.requestPairingCode(cleaned)
  }

  private onWhatsAppEvent(workspaceId: string, event: WhatsAppEvent): void {
    // Fan out to UI as a discriminated union — preserves `type` for the client.
    this.opts.publishEvent?.(
      RPC_CHANNELS.messaging.WA_UI_EVENT,
      { to: 'workspace', workspaceId },
      { workspaceId, event },
    )
    if (event.type === 'connected') {
      this.emitPlatformStatus(workspaceId, 'whatsapp', true)
    } else if (event.type === 'disconnected' || event.type === 'unavailable') {
      this.emitPlatformStatus(workspaceId, 'whatsapp', false)
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

  /**
   * Create the gateway + config store for a workspace (without starting it).
   * Idempotent: if the state exists, returns the existing instance.
   */
  private bootstrapWorkspace(workspaceId: string): WorkspaceState {
    const existing = this.workspaces.get(workspaceId)
    if (existing) return existing

    const storageDir = this.opts.getMessagingDir(workspaceId)
    const legacyStorageDir = this.opts.getLegacyMessagingDir?.(workspaceId)

    const configStore = new ConfigStore(storageDir, legacyStorageDir)
    const gateway = new MessagingGateway({
      sessionManager: this.opts.sessionManager,
      workspaceId,
      storageDir,
      legacyStorageDir,
      logger: this.log,
      pairingConsumer: {
        consume: (platform, code) => {
          const entry = this.pairing.consume(workspaceId, platform, code)
          if (!entry) return null
          return { workspaceId: entry.workspaceId, sessionId: entry.sessionId }
        },
      },
      onBindingChanged: () => this.emitBindingChanged(workspaceId),
    })

    const state: WorkspaceState = { gateway, configStore, botUsernames: {}, whatsapp: null }
    this.workspaces.set(workspaceId, state)
    return state
  }

  private async tryConnectTelegram(workspaceId: string, state: WorkspaceState): Promise<void> {
    const cred = await this.opts.credentialManager
      .get({ type: 'messaging_bearer', workspaceId, name: 'telegram' })
      .catch(() => null)

    if (!cred?.value) return

    // Tear down any existing Telegram adapter BEFORE constructing a new one.
    // Two concurrent getUpdates long-polls with the same bot token cause
    // Telegram to return 409 Conflict, and grammY's polling loop exits on
    // that error — silently, if the rejection is swallowed. Awaiting here
    // guarantees the old poller is fully stopped before we start the new one.
    await state.gateway.unregisterAdapter('telegram').catch((err) => {
      this.log.warn(`${PREFIX} unregisterAdapter(telegram) failed (non-fatal):`, err)
    })

    try {
      const adapter = new TelegramAdapter()
      await adapter.initialize({ token: cred.value, logger: this.log })

      // Capture bot username for UI hints.
      try {
        const info = await adapter.getBotInfo()
        state.botUsernames.telegram = info?.username
      } catch {
        // non-fatal
      }

      state.gateway.registerAdapter(adapter)
      this.emitPlatformStatus(workspaceId, 'telegram', true)
    } catch (err) {
      this.log.error(`${PREFIX} Failed to connect Telegram for workspace ${workspaceId}:`, err)
      this.emitPlatformStatus(workspaceId, 'telegram', false)
      throw err
    }
  }

  private emitBindingChanged(workspaceId: string): void {
    // Args are spread positionally into the listener: cb(workspaceId).
    this.opts.publishEvent?.(
      RPC_CHANNELS.messaging.BINDING_CHANGED,
      { to: 'workspace', workspaceId },
      workspaceId,
    )
  }

  private emitPlatformStatus(workspaceId: string, platform: string, connected: boolean): void {
    // Args are spread positionally into the listener: cb(workspaceId, platform, connected).
    this.opts.publishEvent?.(
      RPC_CHANNELS.messaging.PLATFORM_STATUS,
      { to: 'workspace', workspaceId },
      workspaceId,
      platform,
      connected,
    )
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
    channelName: b.channelName,
    enabled: b.enabled,
    createdAt: b.createdAt,
  }
}

function isKnownPlatform(p: string): p is PlatformType {
  return p === 'telegram' || p === 'whatsapp'
}

/**
 * Lightweight getMe call. Avoids booting a full Bot instance and keeps us from
 * depending on grammY internals for a pre-flight check.
 */
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
