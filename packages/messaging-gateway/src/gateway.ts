/**
 * MessagingGateway — orchestrator for messaging platform adapters.
 *
 * Runs in-process alongside SessionManager. Wires adapters, router,
 * renderer, and binding store together. One instance per workspace.
 */

import type { ISessionManager } from '@craft-agent/server-core/handlers'
import type { PushTarget } from '@craft-agent/shared/protocol'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { BindingStore } from './binding-store'
import { Router } from './router'
import { Commands, type PairingCodeConsumer } from './commands'
import { Renderer, type SessionEvent } from './renderer'
import type {
  PlatformAdapter,
  PlatformType,
  IncomingMessage,
  ButtonPress,
  MessagingLogger,
} from './types'

const PREFIX = '[MessagingGateway]'

/** Fallback logger routes to console so callers that don't pass a logger still see output. */
const consoleLogger: MessagingLogger = {
  info: (...args: unknown[]) => console.log(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
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
  /** Optional logger — defaults to console. Pass electron-log scoped logger in Electron. */
  logger?: MessagingLogger
}

export class MessagingGateway {
  private readonly sessionManager: ISessionManager
  private readonly workspaceId: string
  private readonly bindingStore: BindingStore
  private readonly router: Router
  private readonly commands: Commands
  private readonly renderer: Renderer
  private readonly adapters = new Map<PlatformType, PlatformAdapter>()
  private readonly log: MessagingLogger
  private started = false

  constructor(opts: GatewayOptions) {
    this.sessionManager = opts.sessionManager
    this.workspaceId = opts.workspaceId
    this.log = opts.logger ?? consoleLogger
    this.bindingStore = new BindingStore(opts.storageDir, opts.legacyStorageDir)
    if (opts.onBindingChanged) {
      this.bindingStore.onChange(opts.onBindingChanged)
    }
    this.commands = new Commands(
      opts.sessionManager,
      this.bindingStore,
      opts.workspaceId,
      opts.pairingConsumer,
    )
    this.router = new Router(opts.sessionManager, this.bindingStore, this.commands)
    this.renderer = new Renderer()
  }

  // -------------------------------------------------------------------------
  // Adapter registration
  // -------------------------------------------------------------------------

  registerAdapter(adapter: PlatformAdapter): void {
    const existing = this.adapters.get(adapter.platform)
    if (existing) {
      // Replace: stop the old adapter before swapping in the new one.
      existing.destroy().catch(() => {})
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
    } catch (err) {
      this.log.error(`${PREFIX} Failed to destroy adapter ${platform}:`, err)
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
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false

    for (const [platform, adapter] of this.adapters) {
      try {
        await adapter.destroy()
        this.log.info(`${PREFIX} Adapter stopped: ${platform}`)
      } catch (err) {
        this.log.error(`${PREFIX} Failed to stop adapter ${platform}:`, err)
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

    this.log.info(`${PREFIX} Adapter registered: ${adapter.platform}`)
  }

  // -------------------------------------------------------------------------
  // Event handling (called by fan-out EventSink)
  // -------------------------------------------------------------------------

  onSessionEvent(channel: string, _target: PushTarget, ...args: any[]): void {
    if (channel !== RPC_CHANNELS.sessions.EVENT) return

    const event = args[0] as SessionEvent | undefined
    if (!event?.sessionId) return

    const bindings = this.bindingStore.findBySession(event.sessionId)
    if (bindings.length === 0) return

    for (const binding of bindings) {
      const adapter = this.adapters.get(binding.platform)
      if (!adapter || !adapter.isConnected()) continue
      this.renderer.handle(event, binding, adapter).catch((err) => {
        this.log.error(`${PREFIX} Renderer error for ${binding.platform}/${binding.channelId}:`, err)
      })
    }
  }

  // -------------------------------------------------------------------------
  // Button handling
  // -------------------------------------------------------------------------

  private async handleButtonPress(platform: PlatformType, press: ButtonPress): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return

    if (press.buttonId.startsWith('bind:')) {
      const sessionId = press.buttonId.slice('bind:'.length)
      const session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        await adapter.sendText(press.channelId, 'Session not found.')
        return
      }

      this.bindingStore.bind(
        this.workspaceId,
        session.id,
        platform,
        press.channelId,
        undefined,
      )

      await adapter.sendText(
        press.channelId,
        `Bound to "${session.name || session.id}"`,
      )
      return
    }

    if (press.buttonId.startsWith('perm:')) {
      const parts = press.buttonId.split(':')
      const action = parts[1]
      const requestId = parts[2]
      if (!requestId) return

      const binding = this.bindingStore.findByChannel(platform, press.channelId)
      if (!binding) return

      const allowed = action === 'allow'
      this.sessionManager.respondToPermission(
        binding.sessionId,
        requestId,
        allowed,
        false,
      )

      await adapter.sendText(press.channelId, allowed ? '✅ Allowed' : '❌ Denied')
      return
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  getBindingStore(): BindingStore {
    return this.bindingStore
  }

  isStarted(): boolean {
    return this.started
  }
}
