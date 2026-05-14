/**
 * MessagingGatewayRegistry — owns per-workspace MessagingGateway instances.
 *
 * The registry keeps the gateway infrastructure alive without knowing about
 * concrete platform adapters. Hosts may register custom adapters directly on a
 * gateway in future slices; this class only manages workspace config, binding
 * stores, pairing codes, access policy, pending senders, and event fanout.
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

type PlatformPolicy = {
  enabled: boolean
  accessMode?: PlatformAccessMode
  owners?: PlatformOwner[]
}

export interface MessagingGatewayRegistryOptions {
  sessionManager: ISessionManager
  credentialManager: CredentialManager
  getMessagingDir: (workspaceId: string) => string
  getLegacyMessagingDir?: (workspaceId: string) => string | undefined
  publishEvent?: (channel: string, target: PushTarget, ...args: unknown[]) => void
  logger?: MessagingLogger
}

interface WorkspaceState {
  gateway: MessagingGateway
  configStore: ConfigStore
  botUsernames: Partial<Record<PlatformType, string>>
  runtime: Record<PlatformType, MessagingPlatformRuntimeInfo>
}

export class MessagingGatewayRegistry implements IMessagingGatewayRegistry {
  private readonly workspaces = new Map<string, WorkspaceState>()
  private readonly pairing = new PairingCodeManager()
  private readonly log: MessagingLogger

  constructor(private readonly opts: MessagingGatewayRegistryOptions) {
    this.log = (opts.logger ?? consoleLogger).child({ component: 'registry' })

    opts.sessionManager.setAutomationBinder?.(async (input) => {
      const result = await this.bindAutomationSession(input)
      if (!result.ok) {
        this.log.info('automation bind skipped', {
          event: 'automation_bind_skipped',
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          topicName: input.topicName,
          reason: result.reason,
          error: result.error,
        })
      }
    })
  }

  async initializeWorkspace(workspaceId: string): Promise<void> {
    const state = this.bootstrapWorkspace(workspaceId)
    const config = state.configStore.get()
    this.reconcileRuntime(workspaceId, state, config)
    if (config.enabled) await state.gateway.start()
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

  getConfig(workspaceId: string): MessagingConfigInfo | null {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const cfg = state.configStore.get()
    this.reconcileRuntime(workspaceId, state, cfg)
    return {
      enabled: cfg.enabled,
      platforms: cfg.platforms as MessagingConfigInfo['platforms'],
      runtime: cloneRuntimeMap(state.runtime),
    }
  }

  async updateConfig(workspaceId: string, partial: Partial<MessagingConfigInfo>): Promise<void> {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    state.configStore.update({
      enabled: partial.enabled,
      platforms: partial.platforms as MessagingConfig['platforms'] | undefined,
    })
    const cfg = state.configStore.get()
    await this.unregisterDisabledAdapters(state, cfg)
    this.reconcileRuntime(workspaceId, state, cfg)
  }

  getBindings(workspaceId: string): MessagingBindingInfo[] {
    const state = this.workspaces.get(workspaceId)
    if (!state) return []
    return state.gateway.getBindingStore().getAll().map(toBindingInfo)
  }

  unbindSession(workspaceId: string, sessionId: string, platform?: string): void {
    const state = this.workspaces.get(workspaceId)
    if (!state) return
    const removed = state.gateway.getBindingStore().unbindSession(sessionId, platform)
    if (removed > 0) this.emitBindingChanged(workspaceId)
  }

  unbindBinding(workspaceId: string, bindingId: string): boolean {
    const state = this.workspaces.get(workspaceId)
    if (!state) return false
    const removed = state.gateway.getBindingStore().unbindById(bindingId)
    if (removed) this.emitBindingChanged(workspaceId)
    return removed
  }

  generatePairingCode(
    workspaceId: string,
    sessionId: string,
    platform: string,
  ): { code: string; expiresAt: number; botUsername?: string } {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    if (!state.gateway.hasConnectedAdapter(platform)) {
      throw new Error(`${capitalize(platform)} is not connected`)
    }
    const gen = this.pairing.generate(workspaceId, sessionId, platform)
    return {
      code: gen.code,
      expiresAt: gen.expiresAt,
      botUsername: state.botUsernames[platform],
    }
  }

  async bindAutomationSession(_args?: {
    workspaceId: string
    sessionId: string
    topicName: string
  }): Promise<
    { ok: false; reason: 'unsupported'; error?: string }
  > {
    return { ok: false, reason: 'unsupported' }
  }

  async removeAutomationTopic(): Promise<void> {}

  async testTelegramToken(_token?: string): Promise<{ success: boolean; botName?: string; botUsername?: string; error?: string }> {
    return { success: false, error: 'Telegram adapter is not bundled by messaging-gateway core.' }
  }

  async saveTelegramToken(_workspaceId?: string, _token?: string): Promise<void> {
    throw new Error('Telegram adapter is not bundled by messaging-gateway core.')
  }

  async testLarkCredentials(_creds?: { appId: string; appSecret: string; domain: 'lark' | 'feishu' }): Promise<{ success: boolean; botName?: string; error?: string }> {
    return { success: false, error: 'Lark adapter is not bundled by messaging-gateway core.' }
  }

  async saveLarkCredentials(_workspaceId?: string, _creds?: { appId: string; appSecret: string; domain: 'lark' | 'feishu' }): Promise<void> {
    throw new Error('Lark adapter is not bundled by messaging-gateway core.')
  }

  async disconnectPlatform(workspaceId: string, platform: string): Promise<void> {
    const state = this.workspaces.get(workspaceId)
    if (!state) return

    await state.gateway.unregisterAdapter(platform).catch(() => {})
    state.botUsernames[platform] = undefined
    this.pairing.clearWorkspace(workspaceId)

    const cfg = state.configStore.get()
    const current = cfg.platforms[platform] ?? { enabled: true }
    const nextPlatforms = {
      ...cfg.platforms,
      [platform]: { ...current, enabled: false },
    }
    state.configStore.update({
      enabled: Object.values(nextPlatforms).some((entry) => entry?.enabled),
      platforms: nextPlatforms,
    })
    this.setPlatformRuntime(workspaceId, state, platform, {
      configured: false,
      connected: false,
      state: 'disconnected',
      identity: undefined,
      lastError: undefined,
    })
  }

  async forgetPlatform(workspaceId: string, platform: string): Promise<void> {
    await this.disconnectPlatform(workspaceId, platform)
  }

  async startWhatsAppConnect(_workspaceId?: string): Promise<void> {
    throw new Error('WhatsApp adapter is not bundled by messaging-gateway core.')
  }

  async submitWhatsAppPhone(_workspaceId?: string, _phoneNumber?: string): Promise<void> {
    throw new Error('WhatsApp adapter is not bundled by messaging-gateway core.')
  }

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
    const gateway = new MessagingGateway({
      sessionManager: this.opts.sessionManager,
      workspaceId,
      storageDir,
      legacyStorageDir,
      logger: baseLog,
      pairingConsumer: {
        canConsume: (platform, senderId) => this.pairing.canConsume(workspaceId, platform, senderId),
        consume: (platform, code) => {
          const entry = this.pairing.consume(workspaceId, platform, code)
          if (!entry) return null
          return { kind: 'session', workspaceId: entry.workspaceId, sessionId: entry.sessionId }
        },
      },
      getWorkspaceConfig: () => configStore.get(),
      seedOwnerOnFirstPair: async (platform, candidate) =>
        this.seedFirstOwner(workspaceId, platform, candidate),
      onBindingChanged: () => this.emitBindingChanged(workspaceId),
      onPendingChanged: () => this.emitPendingChanged(workspaceId),
    })

    const state: WorkspaceState = {
      gateway,
      configStore,
      botUsernames: {},
      runtime: {},
    }
    this.reconcileRuntime(workspaceId, state, configStore.get())
    this.workspaces.set(workspaceId, state)
    return state
  }

  private async unregisterDisabledAdapters(state: WorkspaceState, cfg: MessagingConfig): Promise<void> {
    for (const platform of Object.keys(state.runtime)) {
      if (cfg.enabled && cfg.platforms[platform]?.enabled) continue
      await state.gateway.unregisterAdapter(platform).catch(() => {})
    }
  }

  private reconcileRuntime(workspaceId: string, state: WorkspaceState, cfg: MessagingConfig): void {
    const platforms = new Set([...Object.keys(state.runtime), ...Object.keys(cfg.platforms)])
    for (const platform of platforms) {
      const configured = Boolean(cfg.enabled && cfg.platforms[platform]?.enabled)
      const adapter = state.gateway.getAdapter(platform)
      this.setPlatformRuntime(workspaceId, state, platform, {
        configured,
        connected: Boolean(configured && adapter?.isConnected()),
        state: configured
          ? adapter?.isConnected()
            ? 'connected'
            : 'disconnected'
          : 'disconnected',
        identity: state.botUsernames[platform],
        lastError: undefined,
      })
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
    const channel = (RPC_CHANNELS.messaging as Record<string, string | undefined>).PENDING_CHANGED
    if (!channel) return
    this.opts.publishEvent?.(channel, { to: 'workspace', workspaceId }, workspaceId)
  }

  private patchPlatformPolicy(
    workspaceId: string,
    platform: PlatformType,
    patch: Partial<PlatformPolicy>,
  ): MessagingConfig {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const cfg = state.configStore.get()
    const current = getPlatformPolicy(cfg, platform)
    return state.configStore.update({
      platforms: {
        ...cfg.platforms,
        [platform]: { ...current, ...patch },
      } as MessagingConfig['platforms'],
    })
  }

  private async seedFirstOwner(
    workspaceId: string,
    platform: PlatformType,
    candidate: PlatformOwner,
  ): Promise<PlatformOwner[]> {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const currentOwners = getPlatformPolicy(state.configStore.get(), platform).owners ?? []
    if (currentOwners.length > 0) return currentOwners
    const nextOwners = [candidate]
    this.patchPlatformPolicy(workspaceId, platform, {
      enabled: true,
      accessMode: 'owner-only',
      owners: nextOwners,
    })
    return nextOwners
  }

  getPlatformOwners(workspaceId: string, platform: PlatformType): PlatformOwner[] {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    return getPlatformPolicy(state.configStore.get(), platform).owners ?? []
  }

  setPlatformOwners(workspaceId: string, platform: PlatformType, owners: PlatformOwner[]): PlatformOwner[] {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    this.patchPlatformPolicy(workspaceId, platform, {
      enabled: getPlatformPolicy(state.configStore.get(), platform).enabled,
      owners: dedupeOwners(owners),
    })
    this.emitBindingChanged(workspaceId)
    return this.getPlatformOwners(workspaceId, platform)
  }

  getPlatformAccessMode(workspaceId: string, platform: PlatformType): PlatformAccessMode {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    return getPlatformPolicy(state.configStore.get(), platform).accessMode ?? 'open'
  }

  setPlatformAccessMode(workspaceId: string, platform: PlatformType, mode: PlatformAccessMode): void {
    this.patchPlatformPolicy(workspaceId, platform, { accessMode: mode })
    if (mode === 'owner-only') this.migrateOpenBindingsToInherit(workspaceId, platform)
    this.emitBindingChanged(workspaceId)
  }

  private migrateOpenBindingsToInherit(workspaceId: string, platform: PlatformType): void {
    const state = this.workspaces.get(workspaceId)
    if (!state) return
    const store = state.gateway.getBindingStore()
    for (const b of store.getAll()) {
      if (b.platform !== platform) continue
      if (b.config.accessMode !== 'open') continue
      store.updateBindingConfig(b.id, { accessMode: 'inherit', allowedSenderIds: [] })
    }
  }

  getPendingSenders(workspaceId: string, platform?: PlatformType): PendingSender[] {
    const state = this.workspaces.get(workspaceId)
    if (!state) return []
    return state.gateway.getPendingStore().list(platform)
  }

  dismissPendingSender(workspaceId: string, platform: PlatformType, userId: string): boolean {
    const state = this.workspaces.get(workspaceId)
    if (!state) return false
    return state.gateway.getPendingStore().dismiss(platform, userId)
  }

  allowPendingSender(
    workspaceId: string,
    platform: PlatformType,
    userId: string,
    entryKey?: { reason?: PendingSender['reason']; bindingId?: string },
  ): { owners: PlatformOwner[]; bindingId?: string } {
    const state = this.workspaces.get(workspaceId) ?? this.bootstrapWorkspace(workspaceId)
    const pending = state.gateway.getPendingStore().list(platform)
    const match = pending.find((p) =>
      p.userId === userId &&
      (entryKey?.reason === undefined || (p.reason ?? 'not-owner') === entryKey.reason) &&
      (entryKey?.bindingId === undefined || p.bindingId === entryKey.bindingId),
    )
    if (!match) throw new Error('Pending sender not found — they may have been dismissed.')

    const reason = match.reason ?? 'not-owner'
    if (reason === 'not-on-binding-allowlist') {
      const bindingId = match.bindingId
      if (!bindingId) throw new Error('Pending entry is binding-scoped but has no bindingId.')
      const store = state.gateway.getBindingStore()
      const binding = store.getAll().find((b) => b.id === bindingId)
      if (!binding) {
        state.gateway.getPendingStore().dismiss(platform, userId, {
          reason: 'not-on-binding-allowlist',
          bindingId,
        })
        throw new Error('Binding no longer exists — pending entry dismissed.')
      }
      store.updateBindingConfig(bindingId, {
        allowedSenderIds: Array.from(new Set([...binding.config.allowedSenderIds, userId])),
        accessMode: 'allow-list',
      })
      state.gateway.getPendingStore().dismiss(platform, userId, {
        reason: 'not-on-binding-allowlist',
        bindingId,
      })
      this.emitBindingChanged(workspaceId)
      return { owners: this.getPlatformOwners(workspaceId, platform), bindingId }
    }

    const existing = this.getPlatformOwners(workspaceId, platform)
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
    const currentMode = this.getPlatformAccessMode(workspaceId, platform)
    this.patchPlatformPolicy(workspaceId, platform, {
      enabled: true,
      owners: nextOwners,
      accessMode: currentMode === 'open' ? 'owner-only' : currentMode,
    })
    state.gateway.getPendingStore().dismiss(platform, userId)
    this.emitBindingChanged(workspaceId)
    return { owners: nextOwners }
  }

  setBindingAccess(
    workspaceId: string,
    bindingId: string,
    access: { mode: BindingAccessMode; allowedSenderIds?: string[] },
  ): void {
    const state = this.workspaces.get(workspaceId)
    if (!state) throw new Error('Workspace not initialised')
    const next = state.gateway.getBindingStore().updateBindingConfig(bindingId, {
      accessMode: access.mode,
      allowedSenderIds: access.mode === 'allow-list' ? [...(access.allowedSenderIds ?? [])] : [],
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
}

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
    accessMode: b.config.accessMode,
    allowedSenderIds: [...b.config.allowedSenderIds],
  }
}

function getPlatformPolicy(config: MessagingConfig, platform: PlatformType): PlatformPolicy {
  return ((config.platforms[platform] ?? { enabled: false }) as PlatformPolicy)
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1)
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
    state: 'disconnected',
    updatedAt: Date.now(),
  }
}

function cloneRuntime(runtime: MessagingPlatformRuntimeInfo): MessagingPlatformRuntimeInfo {
  return { ...runtime }
}

function cloneRuntimeMap(
  runtime: Record<PlatformType, MessagingPlatformRuntimeInfo>,
): Record<string, MessagingPlatformRuntimeInfo> {
  return Object.fromEntries(
    Object.entries(runtime).map(([platform, info]) => [platform, cloneRuntime(info)]),
  )
}
